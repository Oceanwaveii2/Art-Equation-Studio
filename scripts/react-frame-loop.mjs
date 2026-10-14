import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { LiveCamera } from '../src/canvas-engine/liveCamera.ts'

const initial = { x: 0, y: 0, scale: 1 }, camera = new LiveCamera(initial)
initial.x = 10
assert.equal(camera.current.x, 0)
let delivered = 0
const unsubscribe = camera.subscribe(() => delivered++)
assert.equal(camera.present({ x: 0, y: 0, scale: 1 }), false)
camera.present({ x: 1, y: 2, scale: 2 }); unsubscribe()
camera.present({ x: 2, y: 2, scale: 2 })
assert.equal(delivered, 1); assert.equal(camera.revision, 2)
assert.throws(() => camera.present({ x: NaN, y: 0, scale: 1 }))
assert.throws(() => camera.present({ x: 0, y: 0, scale: 0 }))

const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const report = { generatedAt: new Date().toISOString(), browser: await browser.version(), core: 'copy isolation, unchanged snapshot, delivery, unsubscribe, invalid transforms passed', modes: [] }
try {
  for (const mode of ['dom', 'retained']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${process.env.PERF_TEST_BASE_URL || 'http://127.0.0.1:5173'}/?catalog=demo&canvas-renderer=${mode}`)
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await page.getByRole('button', { name: '＋ Board', exact: true }).first().click()
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await page.evaluate(() => {
      localStorage.setItem('art-equation-board-clipboard', JSON.stringify({ nodes: [0, 1, 2].map(i => ({ id: `live-${i}`, kind: 'shape', shapeType: 'rectangle', title: `Live ${i}`, body: 'Test', x: 160 + i * 260, y: 200, width: 160, height: 130, color: '#6688aa' })) }))
      window.dispatchEvent(new ClipboardEvent('paste'))
    })
    await page.getByLabel('Fit selection', { exact: true }).click()
    await page.waitForTimeout(500)
    const stage = page.locator('.canvas-stage')
    const samples = []
    for (const zoom of [false, true]) {
      const sample = await page.evaluate(async zoom => {
        const stage = document.querySelector('.canvas-stage'), box = stage.getBoundingClientRect()
        const commits = Number(stage.dataset.reactCommits), revision = Number(stage.dataset.cameraFrames || 0)
        const frames = []; let last
        for (let index = 0; index < 60; index++) {
          await new Promise(resolve => requestAnimationFrame(now => { if (last) frames.push(now-last); last=now; resolve() }))
          stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: zoom, deltaX: zoom ? 0 : index % 2 ? 3 : -3, deltaY: index % 2 ? 3 : -3, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }))
        }
        await new Promise(resolve => requestAnimationFrame(resolve))
        const matrix = getComputedStyle(document.querySelector('.board-world')).transform
        return { operation: zoom ? 'zoom' : 'pan', commits: Number(stage.dataset.reactCommits)-commits, frames: Number(stage.dataset.cameraFrames)-revision, matrix, camera: JSON.parse(stage.dataset.liveCamera), percent: document.querySelector('.canvas-zoom-percentage').textContent, frameIntervals: frames }
      }, zoom)
      assert.equal(sample.commits, 0, `${mode} ${sample.operation} should not reconcile CanvasPane`)
      assert(sample.frames >= 55); assert.equal(parseInt(sample.percent), Math.round(sample.camera.scale*100))
      samples.push(sample); await page.waitForTimeout(300)
    }
    // Synthetic sustained pen samples retain deterministic pointer identity.
    const target = await page.locator('.board-node').first().evaluate(element => { const box = element.getBoundingClientRect(); return { id: element.dataset.nodeId, x: box.x+35, y: box.y+35, left: parseFloat(element.style.left), top: parseFloat(element.style.top) } })
    await page.evaluate(target => document.querySelector(`[data-node-id="${target.id}"]`).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 801, pointerType: 'pen', button: 0, buttons: 1, altKey: true, clientX: target.x, clientY: target.y })), target)
    await page.waitForTimeout(100)
    const move = await page.evaluate(async target => {
      const stage = document.querySelector('.canvas-stage'), commits = Number(stage.dataset.reactCommits), frames = Number(stage.dataset.gestureFrames || 0)
      for (let index=1; index<=40; index++) { window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 801, buttons: 1, altKey: true, clientX: target.x+index, clientY: target.y+index/2 })); await new Promise(resolve => requestAnimationFrame(resolve)) }
      await new Promise(resolve => requestAnimationFrame(resolve))
      const node = document.querySelector(`[data-node-id="${target.id}"]`)
      return { operation: 'move', commits: Number(stage.dataset.reactCommits)-commits, frames: Number(stage.dataset.gestureFrames)-frames, left: parseFloat(node.style.left), preview: stage.dataset.gesturePreview }
    }, target)
    assert.equal(move.commits, 0, `${mode} movement should not reconcile CanvasPane`); assert(move.frames >= 35); assert.notEqual(move.left, target.left); assert.equal(move.preview, 'true')
    samples.push(move)
    await page.evaluate(target => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 801, clientX: target.x+40, clientY: target.y+20, altKey: true })), target)
    await page.waitForTimeout(100)
    assert.equal(await stage.getAttribute('data-gesture-preview'), 'false')
    const node = page.locator(`[data-node-id="${target.id}"]`)
    assert.equal(await node.evaluate(element => parseFloat(element.style.left)), move.left)
    await page.getByLabel('Undo board change', { exact: true }).click()
    assert.equal(await node.evaluate(element => parseFloat(element.style.left)), target.left)
    await page.keyboard.press('Escape')
    await page.getByLabel('Draw ellipse', { exact: true }).click()
    const bounds = await stage.boundingBox()
    await page.mouse.move(bounds.x+600, bounds.y+350); await page.mouse.down(); await page.waitForTimeout(100)
    const startCommits = Number(await stage.getAttribute('data-react-commits'))
    for (let i=1;i<=20;i++) { await page.mouse.move(bounds.x+600+i*4, bounds.y+350+i*3); await page.waitForTimeout(18) }
    const drawCommits = Number(await stage.getAttribute('data-react-commits'))-startCommits
    assert.equal(drawCommits, 0, `${mode} drawing should not reconcile CanvasPane`)
    assert.equal(await page.locator('[data-live-draft="true"] ellipse').count(), 1)
    await page.screenshot({ path: `output/playwright/react-${mode}-drawing.png` })
    await page.mouse.up(); await page.waitForTimeout(100)
    assert.equal(await page.locator('[data-live-draft]').count(), 0)
    assert.equal(await page.locator('.node-shape-ellipse').count(), 1)
    await page.getByLabel('Undo board change', { exact: true }).click()
    assert.equal(await page.locator('.node-shape-ellipse').count(), 0)
    samples.push({ operation: 'drawing', commits: drawCommits, finalCommitAndUndo: true })
    await page.getByLabel('Select and move', { exact: true }).click()
    await page.keyboard.press('Escape'); await node.click({ force: true })
    for (const [operation, selector] of [['resize', '.handle-se'], ['rotate', '.node-rotate-handle'], ['radius', '.node-radius-handle']]) {
      const control = node.locator(selector)
      const controlBox = await control.boundingBox()
      const origin = { x: controlBox.x+controlBox.width/2, y: controlBox.y+controlBox.height/2 }
      const before = await node.getAttribute('style')
      await control.dispatchEvent('pointerdown', { bubbles: true, pointerId: 802, button: 0, buttons: 1, clientX: origin.x, clientY: origin.y })
      await page.waitForTimeout(80)
      const commits = Number(await stage.getAttribute('data-react-commits'))
      await page.evaluate(async origin => {
        for (let index=1;index<=24;index++) { window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 802, buttons: 1, clientX: origin.x+index*2, clientY: origin.y+index })); await new Promise(resolve => requestAnimationFrame(resolve)) }
        await new Promise(resolve => requestAnimationFrame(resolve))
      }, origin)
      assert.equal(Number(await stage.getAttribute('data-react-commits'))-commits, 0, `${mode} ${operation} should not reconcile CanvasPane`)
      assert.notEqual(await node.getAttribute('style'), before)
      await page.keyboard.press('Escape'); await page.waitForTimeout(80)
      assert.equal(await stage.getAttribute('data-gesture-preview'), 'false')
      assert.equal(await node.getAttribute('style'), before, `${operation} cancellation restores geometry`)
      samples.push({ operation, commits: 0, cancellation: true })
      await node.click({ force: true })
    }
    assert.deepEqual(errors, [])
    report.modes.push({ mode, samples, errors }); console.log(JSON.stringify({ mode, samples: samples.map(({ frameIntervals, ...rest }) => rest) }))
    await page.close()
  }
  // Transform handlers clone their baseline; unchanged offscreen paths must
  // stay culled instead of being mistaken for edited geometry.
  const stress = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await stress.goto(`${process.env.PERF_TEST_BASE_URL || 'http://127.0.0.1:5173'}/?benchmark=generation-0&stress=1000&stress-profile=vector`)
  await stress.getByRole('button', { name: 'Canvas', exact: true }).click()
  const targetId = await stress.evaluate(() => {
    const stage = document.querySelector('.canvas-stage').getBoundingClientRect()
    return [...document.querySelectorAll('.board-node')].find(element => { const box = element.getBoundingClientRect(); return box.left > stage.left + 80 && box.top > stage.top + 40 && box.right < stage.right - 40 && box.bottom < stage.bottom - 40 }).dataset.nodeId
  })
  const stressNode = stress.locator(`[data-node-id="${targetId}"]`)
  await stressNode.click({ force: true })
  const resize = stressNode.locator('.handle-se'), resizeBox = await resize.boundingBox()
  const start = { x: resizeBox.x+resizeBox.width/2, y: resizeBox.y+resizeBox.height/2 }
  await resize.dispatchEvent('pointerdown', { pointerId: 803, button: 0, buttons: 1, clientX: start.x, clientY: start.y })
  await stress.waitForTimeout(100)
  const stressSample = await stress.evaluate(async start => {
    const stage = document.querySelector('.canvas-stage'), count = document.querySelectorAll('.board-node').length, commits = Number(stage.dataset.reactCommits)
    for (let i=1;i<=24;i++) { window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 803, buttons: 1, clientX: start.x+i, clientY: start.y+i })); await new Promise(resolve => requestAnimationFrame(resolve)) }
    await new Promise(resolve => requestAnimationFrame(resolve))
    return { before: count, after: document.querySelectorAll('.board-node').length, commits: Number(stage.dataset.reactCommits)-commits }
  }, start)
  assert.equal(stressSample.after, stressSample.before); assert(stressSample.after < 100); assert.equal(stressSample.commits, 0)
  await stress.keyboard.press('Escape')
  await stress.getByLabel('Node tool', { exact: true }).click(); await stressNode.click({ force: true })
  const anchor = stressNode.locator('.vector-anchor').first(), anchorBox = await anchor.boundingBox()
  const anchorStart = { x: anchorBox.x+anchorBox.width/2, y: anchorBox.y+anchorBox.height/2 }
  const originalPath = await stressNode.locator('.node-vector-shape > g > path').first().getAttribute('d')
  await anchor.dispatchEvent('pointerdown', { pointerId: 804, button: 0, buttons: 1, clientX: anchorStart.x, clientY: anchorStart.y })
  await stress.waitForTimeout(80)
  const anchorSample = await stress.evaluate(async start => {
    const stage = document.querySelector('.canvas-stage'), commits = Number(stage.dataset.reactCommits)
    for(let i=1;i<=24;i++){window.dispatchEvent(new PointerEvent('pointermove',{pointerId:804,buttons:1,clientX:start.x+i,clientY:start.y+i}));await new Promise(resolve=>requestAnimationFrame(resolve))}
    await new Promise(resolve=>requestAnimationFrame(resolve))
    return {commits:Number(stage.dataset.reactCommits)-commits}
  }, anchorStart)
  assert.equal(anchorSample.commits, 0)
  assert.notEqual(await stressNode.locator('.node-vector-shape > g > path').first().getAttribute('d'), originalPath)
  await stress.keyboard.press('Escape')
  assert.equal(await stressNode.locator('.node-vector-shape > g > path').first().getAttribute('d'), originalPath)
  report.anchorPreview = { ...anchorSample, geometryUpdated: true, cancellation: true }
  await stress.close()
  report.clonedVectorBaseline = stressSample
  console.log(JSON.stringify({ clonedVectorBaseline: stressSample }))
  await mkdir('artifacts/react-frame-loop', { recursive: true })
  await writeFile('artifacts/react-frame-loop/report.json', JSON.stringify(report, null, 2))
} finally { await browser.close() }
