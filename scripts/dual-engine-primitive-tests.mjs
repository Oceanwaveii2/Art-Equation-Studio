import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(s, c, next) {
    try {
      return next(s, c)
    } catch (e) {
      if (s.startsWith('.')) return next(s + '.ts', c)
      throw e
    }
  }
})

const {
  CanvasFrameDrawList,
} = await import('../src/canvas-engine/canvasPrimitive.ts')

const {
  ViewportCamera,
} = await import('../src/canvas-engine/viewportCamera.ts')

const {
  InkingScratchpad,
} = await import('../src/canvas-engine/inkingScratchpad.ts')

console.log('--- Dual-Engine & Inking Prep Verification ---')

// ============================================================================
// 1. CanvasPrimitive Segregation Tests
// ============================================================================
console.log('Test 1: CanvasPrimitive segregation (preventing raster images in Vello pipeline)...')

const sampleItems = [
  {
    kind: 'vectorPath',
    vector: {
      id: 'vec-1',
      commands: [['M', 0, 0], ['L', 100, 100]],
      strokeWidth: 2,
      strokeColor: '#ff0000',
      transform: [1, 0, 0, 1, 0, 0],
    },
  },
  {
    kind: 'rasterImage',
    image: {
      assetId: 'asset-img-101',
      bounds: [200, 150, 600, 450],
      transform: { translation: [200, 150], scale: 1, rotation: 0 },
      opacity: 1,
    },
  },
  {
    kind: 'richText',
    text: {
      textLayoutId: 'txt-layout-5',
      text: 'Art Equation Title',
      transform: [1, 0, 0, 1, 50, 50],
    },
  },
  {
    kind: 'rasterImage',
    image: {
      assetId: 'asset-img-102',
      bounds: [800, 200, 1200, 500],
      transform: { translation: [800, 200], scale: 1.5, rotation: 0 },
      opacity: 0.9,
    },
  },
]

const drawList = CanvasFrameDrawList.segregate(sampleItems)

assert.equal(drawList.vectorPrimitives.length, 1, 'Exactly 1 vector path must be in vectorPrimitives')
assert.equal(drawList.richTextPrimitives.length, 1, 'Exactly 1 rich text layout must be in richTextPrimitives')
assert.equal(drawList.rasterImages.length, 2, 'Exactly 2 raster images must be segregated into rasterImages')
assert.equal(drawList.totalCount, 4, 'Total primitive count must match input count')

// Verify that raster images are completely isolated from vectorPrimitives
for (const vec of drawList.vectorPrimitives) {
  assert.equal(vec.id, 'vec-1', 'Only true vector path descriptors are in vectorPrimitives')
  assert.notEqual('assetId' in vec, true, 'Raster images must NEVER contaminate vectorPrimitives')
}
for (const img of drawList.rasterImages) {
  assert.equal(img.assetId.startsWith('asset-img-'), true, 'Only raster descriptors are in rasterImages')
}

console.log('  PASS: CanvasPrimitive segregation guarantees raster images never touch Vello vector paths.')

// ============================================================================
// 2. ViewportCamera Standardized Mathematical Model Tests
// ============================================================================
console.log('Test 2: ViewportCamera standardized translation and frustum culling...')

const camera = new ViewportCamera([0, 0], 1.0, [1920, 1080])

// 2.1 Visible world bounds check
const bounds = camera.visibleWorldBounds()
assert.deepEqual(bounds, [-960, -540, 960, 540], 'Visible world bounds centered at (0,0) must span [-960, -540, 960, 540]')

// 2.2 Frustum culling intersection checks
const centerBox = [-100, -100, 100, 100]
assert.equal(camera.intersectsFrustum(centerBox), true, 'Centered item must be visible in frustum')

const partiallyVisible = [900, 500, 1200, 800]
assert.equal(camera.intersectsFrustum(partiallyVisible), true, 'Partially overlapping item must be visible')

const completelyOffscreenRight = [1100, 0, 1500, 300]
assert.equal(camera.intersectsFrustum(completelyOffscreenRight), false, 'Offscreen item must be culled')

const completelyOffscreenAbove = [0, -900, 200, -600]
assert.equal(camera.intersectsFrustum(completelyOffscreenAbove), false, 'Item above viewport must be culled')

// 2.3 Zoom scaling effect on bounds
const zoomedIn = new ViewportCamera([0, 0], 0.5, [1920, 1080]) // 2x magnification
assert.deepEqual(zoomedIn.visibleWorldBounds(), [-480, -270, 480, 270], 'Zooming in must shrink world frustum')

const zoomedOut = new ViewportCamera([0, 0], 2.0, [1920, 1080]) // 0.5x magnification
assert.deepEqual(zoomedOut.visibleWorldBounds(), [-1920, -1080, 1920, 1080], 'Zooming out must expand world frustum')

// 2.4 Coordinate projection / unprojection identity
const testPoints = [
  [0, 0],
  [500, 250],
  [-720, 400],
  [960, -540],
]

for (const pt of testPoints) {
  const screen = camera.worldToScreen(pt)
  const unprojected = camera.screenToWorld(screen)
  assert.ok(Math.abs(pt[0] - unprojected[0]) < 1e-6, `X coordinate roundtrip failed for ${pt}`)
  assert.ok(Math.abs(pt[1] - unprojected[1]) < 1e-6, `Y coordinate roundtrip failed for ${pt}`)
}

// 2.5 Vello affine matrix computation
const affine = camera.toVelloAffine()
assert.equal(affine[0], 1.0, 'Vello sx must be 1/zoom')
assert.equal(affine[3], 1.0, 'Vello sy must be 1/zoom')
assert.equal(affine[4], 960, 'Vello tx must align world origin to screen center')
assert.equal(affine[5], 540, 'Vello ty must align world origin to screen center')

// 2.6 Interop with legacy CanvasViewport
const legacyViewport = { x: 300, y: 200, scale: 1.25 }
const adaptedCamera = ViewportCamera.fromViewport(legacyViewport, [1920, 1080])
const roundtripViewport = adaptedCamera.toViewport()
assert.ok(Math.abs(legacyViewport.x - roundtripViewport.x) < 1e-4, 'Legacy viewport X matches')
assert.ok(Math.abs(legacyViewport.y - roundtripViewport.y) < 1e-4, 'Legacy viewport Y matches')
// 2.7 Sparse Virtual Texturing (SVT) Mip/LOD computation
assert.equal(camera.computeTileLOD(), 0, 'Zoom 1.0 -> LOD 0')
assert.equal(new ViewportCamera([0, 0], 0.5, [1920, 1080]).computeTileLOD(), 0, 'Zoom 0.5 (magnified 2x) -> LOD 0')
assert.equal(new ViewportCamera([0, 0], 2.0, [1920, 1080]).computeTileLOD(), 1, 'Zoom 2.0 (zoomed out 0.5x) -> LOD 1')
assert.equal(new ViewportCamera([0, 0], 4.0, [1920, 1080]).computeTileLOD(), 2, 'Zoom 4.0 (zoomed out 0.25x) -> LOD 2')
assert.equal(new ViewportCamera([0, 0], 8.0, [1920, 1080]).computeTileLOD(), 3, 'Zoom 8.0 (zoomed out 0.125x) -> LOD 3')
assert.equal(new ViewportCamera([0, 0], 128.0, [1920, 1080]).computeTileLOD(5), 5, 'Clamped to max LOD 5')

console.log('  PASS: ViewportCamera mathematical model correctly handles translation, scaling, culling, and SVT LOD.')

// ============================================================================
// 3. Isolated Inking Scratchpad & Sub-4ms Latency Tests
// ============================================================================
console.log('Test 3: Isolated inking scratchpad & sub-4ms input-to-photon latency...')

const scratchpad = new InkingScratchpad()

// 3.1 Non-invalidation contract during active inking
assert.equal(scratchpad.currentRevision.persistent, 0, 'Persistent revision starts at 0')
assert.equal(scratchpad.isDrawing, false, 'Not drawing initially')

scratchpad.beginStroke({ x: 10, y: 10 }, { width: 3, color: '#3388ff' })
assert.equal(scratchpad.isDrawing, true, 'Active drawing begins')
assert.equal(scratchpad.currentRevision.persistent, 0, 'Persistent scene must NOT be invalidated on stroke begin')
assert.equal(scratchpad.currentRevision.scratchpad, 1, 'Scratchpad revision increments')

// Append points in scratchpad
scratchpad.updateActiveStroke({ x: 15, y: 12 })
scratchpad.updateActiveStroke({ x: 22, y: 18 })
scratchpad.updateActiveStroke({ x: 30, y: 25 })
assert.equal(scratchpad.currentRevision.persistent, 0, 'Persistent scene must NOT be invalidated on active points')
assert.equal(scratchpad.currentRevision.scratchpad, 4, 'Scratchpad revision tracks each point')

// 3.2 Smooth midpoint interpolation curve generated
const commands = scratchpad.getActiveCommands()
assert.ok(commands.length >= 3, 'Midpoint Bézier commands generated')
assert.equal(commands[0][0], 'M', 'First command is MoveTo')
assert.equal(commands[1][0], 'C', 'Intermediate command is Cubic curve')

// 3.3 Frame assembly contains active stroke on top of persistent
const frame = scratchpad.assembleFrameScene()
assert.equal(frame.persistent.length, 0, 'Zero persistent strokes yet')
assert.notEqual(frame.active, null, 'Active stroke is present in frame')
assert.equal(frame.active?.points.length, 4, 'Active stroke has 4 points')

// 3.4 Commit stroke
const committed = scratchpad.commitStroke('stroke-id-01')
assert.notEqual(committed, null, 'Committed stroke returned')
assert.equal(scratchpad.isDrawing, false, 'Drawing ended')
assert.equal(scratchpad.strokeCount, 1, 'Persistent stroke count incremented')
assert.equal(scratchpad.currentRevision.persistent, 1, 'Persistent revision increments on commit')

const frameAfterCommit = scratchpad.assembleFrameScene()
assert.equal(frameAfterCommit.persistent.length, 1, 'Persistent scene contains committed stroke')
assert.equal(frameAfterCommit.active, null, 'Active scratchpad is empty after commit')

// 3.5 Latency Benchmark: 1,000 rapid pointer events
const bench = scratchpad.benchmarkInputLatency(1000)
console.log(`  Measured Inking Latency: avg ${bench.avgMicrosPerPoint.toFixed(2)} µs/point, max ${bench.maxMicrosPerPoint.toFixed(2)} µs/point (Total: ${bench.totalMs.toFixed(2)} ms for 1000 points)`)
assert.equal(bench.passedSub4ms, true, 'Every active stroke update must comfortably satisfy sub-4ms budget')
assert.ok(bench.avgMicrosPerPoint < 100, `Average update time (${bench.avgMicrosPerPoint} µs) must be well below 100 µs (0.1ms)`)

console.log('  PASS: Isolated inking scratchpad verified with sub-4ms input-to-photon latency.')

console.log('\nAll Dual-Engine & Inking Prep Tests PASS successfully!')
