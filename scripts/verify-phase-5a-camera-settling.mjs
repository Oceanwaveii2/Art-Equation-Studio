import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText

const layoutSource = await readFile('src/board/measuredCardPaint.ts', 'utf8')
const { measuredCameraMatrixCurrent, reconstructWorldMatrix } = await import(url(compile(layoutSource)))

const cameraSource = await readFile('src/canvas-engine/liveCamera.ts', 'utf8')
const { LiveCamera } = await import(url(compile(cameraSource)))

console.log('--- Phase 5A: Camera Settling & Subpixel Matrix Precision Tests ---')

// 1. Test measuredCameraMatrixCurrent across fractional scale & pan combinations
const viewport = { width: 1920, height: 1080 }
const testCases = [
  { scale: 0.125, x: 0, y: 0 },
  { scale: 0.33333333, x: 123.456, y: -789.012 },
  { scale: 0.70710678, x: -45.67, y: 89.12 },
  { scale: 1.0, x: 0, y: 0 },
  { scale: 1.33333333, x: 1000.5, y: 2000.25 },
  { scale: 2.0, x: -500.123, y: 300.789 },
  { scale: 2.71828182, x: 12.34567, y: -98.76543 },
  { scale: 3.14159265, x: 456.789, y: 123.456 },
  { scale: 8.0, x: 9999.99, y: -9999.99 },
]

for (const tc of testCases) {
  const camera = { x: tc.x, y: tc.y, scale: tc.scale }
  // Simulate browser CSSOM matrix serialization (which rounds matrix coefficients to e.g. 6 decimal places)
  const a = Math.round(tc.scale * 1e6) / 1e6
  const d = a
  const e = Math.round(tc.x * 1e6) / 1e6
  const f = Math.round(tc.y * 1e6) / 1e6
  const domMatrix = { a, b: 0, c: 0, d, e, f, is2D: true }
  
  const current = measuredCameraMatrixCurrent(domMatrix, camera, viewport)
  assert.equal(current, true, `Fractional camera should be current for scale=${tc.scale}, pan=(${tc.x}, ${tc.y})`)
}
console.log('✔ All 9 fractional scale & pan configurations accepted by measuredCameraMatrixCurrent')

// 2. Test rejection of physically stale cameras (> 0.01 px drift at viewport corners)
{
  const camera = { x: 100, y: 200, scale: 1.5 }
  // Drift by 0.02 px in pan
  const staleMatrix = { a: 1.5, b: 0, c: 0, d: 1.5, e: 100.02, f: 200, is2D: true }
  assert.equal(measuredCameraMatrixCurrent(staleMatrix, camera, viewport), false, 'Should reject 0.02px pan drift')

  // Drift in scale causing > 0.01 px difference at corner (1920 / 1.5 * deltaScale)
  // For width 1920, deltaScale of 1e-4 causes 1920/1.5 * 1e-4 = 0.128 px > 0.01 px
  const staleScaleMatrix = { a: 1.5001, b: 0, c: 0, d: 1.5001, e: 100, f: 200, is2D: true }
  assert.equal(measuredCameraMatrixCurrent(staleScaleMatrix, camera, viewport), false, 'Should reject stale scale causing > 0.01px error at corners')
}
console.log('✔ Stale camera transforms strictly rejected when residual > 0.01 px')

// 3. Test LiveCamera listener notification and convergence
{
  const cam = new LiveCamera({ x: 0, y: 0, scale: 1 })
  let notifications = 0
  let lastState = null
  const unsub = cam.subscribe(viewport => {
    notifications++
    lastState = viewport
  })

  // Smooth gesture sequence (e.g. 60 FPS pinch-zoom & pan)
  for (let frame = 1; frame <= 60; frame++) {
    const t = frame / 60
    const x = t * 150.5
    const y = t * -80.25
    const scale = 1.0 + t * 0.5
    cam.present({ x, y, scale })
  }

  assert.equal(notifications, 60, 'LiveCamera should synchronously emit to subscribers on every frame')
  assert.equal(cam.current.x, 150.5)
  assert.equal(cam.current.y, -80.25)
  assert.equal(cam.current.scale, 1.5)
  assert.deepEqual(lastState, { x: 150.5, y: -80.25, scale: 1.5 })

  unsub()
  cam.present({ x: 200, y: 200, scale: 2.0 })
  assert.equal(notifications, 60, 'Unsubscribed listener must receive zero further updates')
}
console.log('✔ LiveCamera smoothly handles high-frequency subpixel pan/zoom sequence')

// 4. Test world matrix reconstruction under fractional camera and rotation
{
  const camera = { x: 50.5, y: -25.25, scale: 1.25 }
  const stageOrigin = { x: 10, y: 15 }
  const size = { width: 300, height: 200 }
  const linear = [1, 0, 0, 1] // No rotation
  // World position (100, 150)
  // Screen pos = (100 * 1.25 + 50.5 + 10) = 185.5, y = (150 * 1.25 - 25.25 + 15) = 177.25
  const rect = { x: 185.5, y: 177.25, width: 300 * 1.25, height: 200 * 1.25 }
  const worldMatrix = reconstructWorldMatrix(rect, size, linear, camera, stageOrigin)
  assert.ok(worldMatrix, 'World matrix should be reconstructed')
  assert.equal(Math.abs(worldMatrix[4] - 100) < 0.01, true, `World X should be 100, got ${worldMatrix[4]}`)
  assert.equal(Math.abs(worldMatrix[5] - 150) < 0.01, true, `World Y should be 150, got ${worldMatrix[5]}`)
}
console.log('✔ World matrix accurately reconstructed from fractional screen bounds')

console.log('--- Phase 5A Camera Settling Verification PASSED ---')
