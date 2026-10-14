import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const baseUrl = process.env.PERF_TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const report = { checks: [], errors }
const check = (label) => { report.checks.push(label); console.log(`PASS: ${label}`) }
const renderMetrics = () => page.locator('.gpu-board').evaluate((element) => JSON.parse(element.dataset.renderMetrics))
const inputMetrics = () => page.locator('.canvas-stage').evaluate((element) => JSON.parse(element.dataset.inputMetrics || '{}'))
try {
  await page.goto(`${baseUrl}/?benchmark=generation-0&stress=1000&stress-profile=vector&canvas-renderer=${process.env.CANVAS_RENDERER || 'dom'}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.gpu-board')?.getAttribute('data-render-metrics'))
  await page.waitForTimeout(200)
  const idleStart = await renderMetrics()
  await page.waitForTimeout(600)
  const idleEnd = await renderMetrics()
  assert.equal(idleEnd.renders, idleStart.renders)
  assert.equal(await page.locator('.gpu-board').getAttribute('data-ticker-running'), 'false')
  report.idleRenderDelta = idleEnd.renders - idleStart.renders
  check('idle backdrop submits zero new frames and ticker sleeps')

  const connectorBuilds = await page.locator('.connector-layer').getAttribute('data-geometry-builds')
  const stage = page.locator('.canvas-stage')
  const rect = await stage.boundingBox()
  await page.mouse.move(rect.x + rect.width * .7, rect.y + rect.height * .5)
  await page.mouse.wheel(0, 40)
  await page.waitForTimeout(250)
  const panned = await renderMetrics()
  assert(panned.renders > idleEnd.renders)
  assert.equal(panned.gridBuilds, idleEnd.gridBuilds)
  assert.equal(panned.structureBuilds, idleEnd.structureBuilds)
  assert.equal(await page.locator('.connector-layer').getAttribute('data-geometry-builds'), connectorBuilds)
  check('pan wakes rendering without rebuilding grid, columns, or connector geometry')

  const target = await page.evaluate(() => {
    const stage = document.querySelector('.canvas-stage').getBoundingClientRect()
    const node = [...document.querySelectorAll('.board-node')].find((node) => {
      const box = node.getBoundingClientRect()
      return box.left > stage.left + 65 && box.top > stage.top + 15 && box.right < stage.right - 20 && box.bottom < stage.bottom - 20
    })
    if (!node) throw new Error('No visible stress node')
    const box = node.getBoundingClientRect()
    return { id: node.dataset.nodeId, x: box.x + 20, y: box.y + 20, left: parseFloat(node.style.left), top: parseFloat(node.style.top), scale: box.width / parseFloat(node.style.width) }
  })
  const node = page.locator(`[data-node-id="${target.id}"]`)
  const burst = async (pointerId, count = 1000) => page.evaluate(({ target, pointerId, count }) => {
    const node = document.querySelector(`[data-node-id="${target.id}"]`)
    const initial = { bubbles: true, pointerId, pointerType: 'pen', button: 0, buttons: 1, clientX: target.x, clientY: target.y, altKey: true }
    node.dispatchEvent(new PointerEvent('pointerdown', initial))
    for (let index = 1; index <= count; index++) {
      const event = new PointerEvent('pointermove', { ...initial, clientX: target.x + 80 * index / count, pressure: .7 })
      if (index === 1) Object.defineProperty(event, 'getCoalescedEvents', { value: () => [new PointerEvent('pointermove', { ...initial, clientX: target.x + .01, pressure: .6 })] })
      window.dispatchEvent(event)
    }
    return node.style.left
  }, { target, pointerId, count })
  assert.equal(parseFloat(await burst(91)), target.left, 'raw event burst must not mutate geometry synchronously')
  await page.waitForFunction(() => document.querySelector('.canvas-stage').dataset.gesturePreview === 'true')
  const queued = await inputMetrics()
  assert.equal(queued.maxPending, 64)
  assert(queued.dropped > 900 && queued.coalesced >= 1)
  assert.equal(queued.applied, 1, 'a burst must apply only one frame update')
  check('1000-event coalesced burst stays bounded and applies one transient update')

  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 92, clientX: x, clientY: y })), target)
  assert.equal(await stage.getAttribute('data-gesture-preview'), 'true', 'a second pointer must not finish the active gesture')
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 91, clientX: x + 120, clientY: y + 40, altKey: true })), target)
  await page.waitForFunction(() => document.querySelector('.canvas-stage').dataset.gesturePreview === 'false')
  const moved = await node.evaluate((element) => ({ left: parseFloat(element.style.left), top: parseFloat(element.style.top) }))
  assert.equal(moved.left, Math.round(target.left + 120 / target.scale))
  assert.equal(moved.top, Math.round(target.top + 40 / target.scale))
  await page.getByLabel('Undo board change', { exact: true }).click()
  assert.equal(await node.evaluate((element) => parseFloat(element.style.left)), target.left)
  check('final pointer-up position is preserved, foreign pointers ignored, and one undo restores baseline')

  await burst(93, 20)
  await page.waitForFunction(() => document.querySelector('.canvas-stage').dataset.gesturePreview === 'true')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  assert.equal(await node.evaluate((element) => parseFloat(element.style.left)), target.left)
  assert.equal(await stage.getAttribute('data-gesture-preview'), 'false')
  await burst(94, 20)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForTimeout(100)
  assert.equal(await node.evaluate((element) => parseFloat(element.style.left)), target.left)
  assert.equal(await stage.getAttribute('data-gesture-preview'), 'false')
  check('Escape and blur discard queued or displayed previews without stale replay')

  await page.getByLabel('Redo board change', { exact: true }).click()
  assert.equal(await node.evaluate((element) => parseFloat(element.style.left)), moved.left)
  await burst(95, 20)
  await page.waitForFunction(() => document.querySelector('.canvas-stage').dataset.gesturePreview === 'true')
  await page.getByLabel('Undo board change', { exact: true }).click()
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 95, clientX: x + 160, clientY: y + 40 })), target)
  await page.waitForTimeout(100)
  assert.equal(await node.evaluate((element) => parseFloat(element.style.left)), target.left)
  assert.equal(await stage.getAttribute('data-gesture-preview'), 'false')
  check('undo during a drag cancels stale callbacks and survives late pointer-up')

  const beforeTheme = await renderMetrics()
  await page.getByRole('button', { name: 'Use light theme' }).click()
  await page.waitForTimeout(100)
  const afterTheme = await renderMetrics()
  assert.equal(afterTheme.gridBuilds, beforeTheme.gridBuilds + 1)
  assert.equal(afterTheme.structureBuilds, beforeTheme.structureBuilds)
  check('theme grid change rebuilds only the grid layer')

  const beforeMinimap = await page.locator('.board-world').getAttribute('style')
  await page.getByRole('button', { name: 'Board minimap. Click to navigate.' }).click({ position: { x: 80, y: 40 } })
  await page.waitForTimeout(100)
  assert.notEqual(await page.locator('.board-world').getAttribute('style'), beforeMinimap)
  check('minimap navigation wakes the idle backdrop')

  // Navigation utilities now live in the compact rail's More submenu.
  await page.getByLabel('More canvas tools', { exact: true }).click()
  await page.getByLabel('Fit selection', { exact: true }).click()
  await page.mouse.move(10, 10)
  await page.waitForTimeout(300)
  const beforeLoss = await page.locator('.gpu-board-canvas').screenshot()

  const supportsLoss = await page.evaluate(() => {
    const canvas = document.querySelector('.gpu-board-canvas')
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl')
    window.__contextLossTest = context?.getExtension('WEBGL_lose_context')
    if (!window.__contextLossTest) return false
    window.__contextLossTest.loseContext()
    return true
  })
  assert(supportsLoss, 'test browser must support context-loss injection')
  await page.waitForFunction(() => document.querySelector('.gpu-board').dataset.renderState === 'context-lost')
  await page.waitForTimeout(100)
  await page.evaluate(() => window.__contextLossTest.restoreContext())
  await page.waitForFunction(() => JSON.parse(document.querySelector('.gpu-board').dataset.renderMetrics).contextRecoveries === 1)
  const afterLoss = await page.locator('.gpu-board-canvas').screenshot()
  await mkdir('output/playwright', { recursive: true })
  await writeFile('output/playwright/p3-p4-before-loss.png', beforeLoss)
  await writeFile('output/playwright/p3-p4-after-loss.png', afterLoss)
  const pixelDifference = await page.evaluate(async ({ before, after }) => {
    const decode = async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data }
    }
    const a = await decode(before), b = await decode(after)
    if (a.width !== b.width || a.height !== b.height) throw new Error('Recovery changed screenshot dimensions')
    let changedPixels = 0, maxChannelDelta = 0
    for (let i = 0; i < a.pixels.length; i += 4) {
      let changed = false
      for (let c = 0; c < 4; c++) {
        const delta = Math.abs(a.pixels[i + c] - b.pixels[i + c])
        maxChannelDelta = Math.max(maxChannelDelta, delta)
        changed ||= delta > 0
      }
      if (changed) changedPixels++
    }
    return { changedPixels, maxChannelDelta, fraction: changedPixels / (a.width * a.height) }
  }, { before: beforeLoss.toString('base64'), after: afterLoss.toString('base64') })
  report.recoveryPixels = pixelDifference
  // GPU antialiasing may round isolated edge channels by one after restoration.
  assert(pixelDifference.maxChannelDelta <= 1 && pixelDifference.fraction <= .001, `context recovery pixel mismatch: ${JSON.stringify(pixelDifference)}`)
  check('forced WebGL context loss recovers and redraws retained layers')

  const finalIdle = await renderMetrics()
  await page.waitForTimeout(500)
  assert.deepEqual(await renderMetrics(), finalIdle)
  assert.equal(errors.length, 0, errors.join('\n'))
  report.render = finalIdle
  report.input = await inputMetrics()
  await mkdir('output/playwright', { recursive: true })
  await page.screenshot({ path: 'output/playwright/p3-p4-canvas.png' })
  await writeFile('output/playwright/p3-p4-validation.json', JSON.stringify(report, null, 2))
  console.log('P3/P4 browser checks: PASS')
} finally {
  await browser.close()
}
