import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { vectorNodeBounds, vectorLocalToBoard, vectorPathBounds } from '../src/model/vector.ts'

// A new isolated browser context with catalog fixtures: no Tauri disk backend,
// production project, portable data directory, or user browser profile is used.
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const artifactDir = resolve('output', 'playwright', 'partii-drawing')
const report = { passed: false, generatedAt: new Date().toISOString(), baseUrl, checks: [], screenshots: [], browserErrors: [], limitation: 'Browser interaction and DOM/minimap evidence; native Vello pixels and physical stylus/scaling require their separate acceptance gate.' }
report.sourceHashes = {}
for (const name of ['src/App.tsx','src/App.css','src/model/project.ts','src/model/vector.ts','src/model/vectorComposition.ts','src/model/vectorBooleanGeometry.ts','src/board/vectorSvg.ts','src/board/columns.ts','src/board/diagramStructureCore.ts','src/board/boardMutationSafety.ts','src/board/artEquationCanvasAdapter.ts','src/board/nativeSceneAdapter.ts','src/board/GesturePresenter.ts','src/board/OverlayPresenter.ts']) report.sourceHashes[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
await mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
page.on('pageerror', (error) => report.browserErrors.push(error.message))
await page.addInitScript(() => {
  localStorage.setItem('art-equation.navigator', '0')
  localStorage.setItem('art-equation.inspector', '0')
  localStorage.setItem('art-equation.canvas-tools', '1')
})
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
const screenshot = async (name) => { await page.screenshot({ path: resolve(artifactDir, `${name}.png`), fullPage: true }); report.screenshots.push(`${name}.png`) }
const check = (name, condition, detail) => { report.checks.push({ name, passed: Boolean(condition), detail }); return Boolean(condition) }
const rail = page.locator('.canvas-tool-rail')
const nodes = page.locator('.board-node.node-shape')
const byId = (id) => page.locator(`.board-node[data-node-id="${id}"]`)
async function tool(label) {
  const button = page.getByLabel(label, { exact: true })
  if (!await button.count()) await rail.getByLabel('More canvas tools').click()
  await button.click()
  await settled()
}
async function drag(from, to, steps = 12) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
  await settled()
}
async function traceGesture(name, from, to) {
  await page.evaluate(() => {
    window.__drawingTrace = []
    window.__drawingTraceListener = (event) => window.__drawingTrace.push({ type: event.type, x: event.clientX, y: event.clientY, target: event.target?.getAttribute?.('class'), transform: document.querySelector('.canvas-stage')?.getAttribute('data-active-transform'), stageTop: document.querySelector('.canvas-stage')?.getBoundingClientRect().top, stageScrollTop: document.querySelector('.canvas-stage')?.scrollTop, stageScrollLeft: document.querySelector('.canvas-stage')?.scrollLeft, worldTop: document.querySelector('.board-world')?.getBoundingClientRect().top, worldTransform: document.querySelector('.board-world')?.getAttribute('style') })
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) window.addEventListener(event, window.__drawingTraceListener, true)
  })
  await drag(from, to)
  report[name] = await page.evaluate(() => {
    for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) window.removeEventListener(event, window.__drawingTraceListener, true)
    return { events: window.__drawingTrace, metrics: document.querySelector('.canvas-stage')?.getAttribute('data-input-metrics'), status: document.querySelector('.status-bar')?.textContent, notice: document.querySelector('.drawing-notice')?.textContent }
  })
}
async function copyNode(id) {
  await tool('Select and move')
  // Deselect first: selected objects must not be mistaken for a different
  // overlapping child object by clipboard inspection. This is a normal click,
  // not a synthetic event forced through another object's hit surface.
  const stage = await page.locator('.canvas-stage').boundingBox()
  await page.mouse.click(stage.x + stage.width * .7, stage.y + stage.height - 35)
  const item = byId(id)
  const vectorHit = item.locator('.shape-hit-area')
  if (await vectorHit.count()) {
    // Subtraction cutters may cross sibling objects. Inspect this fixture from
    // the surviving visible primary edge, never from an unpainted cutter path.
    const visiblePrimary = item.locator('.node-vector-shape path[mask], .node-vector-shape g > path[pointer-events="none"]').first()
    const point = await (await visiblePrimary.count() ? visiblePrimary : vectorHit).evaluate((path, fraction) => { const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM()); return { x: point.x, y: point.y } }, await visiblePrimary.count() ? .05 : .35)
    report.clipboardHits ||= []
    report.clipboardHits.push(await page.evaluate(({ id, point }) => ({ requested: id, point, hit: document.elementFromPoint(point.x, point.y)?.closest('.board-node')?.getAttribute('data-node-id') }), { id, point }))
    await page.mouse.click(point.x, point.y)
  }
  else {
    const dragHandle = item.locator('.node-drag-handle').first()
    if (await dragHandle.count()) {
      // Containers legitimately sit behind artwork. Pick an actually visible
      // header point; never click through an overlaid sibling or force events.
      const point = await dragHandle.evaluate((handle, id) => {
        const box = handle.getBoundingClientRect()
        return [.08, .25, .5, .75, .92].map((fraction) => ({ x: box.x + box.width * fraction, y: box.y + box.height / 2 })).find((point) => document.elementFromPoint(point.x, point.y)?.closest('.board-node')?.getAttribute('data-node-id') === id)
      }, id)
      assert.ok(point, `container ${id} must have a visible header point for clipboard inspection`)
      await page.mouse.click(point.x, point.y)
    } else {
      const box = await item.boundingBox()
      await page.mouse.click(box.x + box.width * .2, box.y + box.height * .2)
    }
  }
  await settled()
  await page.evaluate(() => localStorage.removeItem('art-equation-board-clipboard'))
  await page.keyboard.press('Control+c')
  const copied = await page.evaluate(() => JSON.parse(localStorage.getItem('art-equation-board-clipboard') || '{}').nodes?.[0])
  assert.equal(copied?.id, id, 'clipboard inspection must identify the requested object, never reuse a stale prior copy')
  return copied
}
async function undo() { await rail.getByLabel('Undo board change').click(); await settled() }
async function renderedControls(id, model) {
  return byId(id).evaluate((item, model) => {
    const hit = item.querySelector('.shape-hit-area'), matrix = hit?.getScreenCTM()
    if (!matrix) throw new Error('Visible path has no SVG screen transform')
    const screen = (point) => { const projected = new DOMPoint(point.x, point.y).matrixTransform(matrix); return { x: projected.x, y: projected.y } }
    const center = (element) => { if (!element) return null; const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } }
    return model.vectorPath.points.map((point, index) => ({
      index,
      anchor: center(item.querySelector(`.vector-anchor[data-point-index="${index}"]`)), expectedAnchor: screen(point),
      handleIn: center(item.querySelector(`[aria-label="Adjust incoming curve handle ${index + 1}"]`)),
      expectedIn: point.handleIn ? screen({ x: point.x + point.handleIn.x, y: point.y + point.handleIn.y }) : null,
      handleOut: center(item.querySelector(`[aria-label="Adjust outgoing curve handle ${index + 1}"]`)),
      expectedOut: point.handleOut ? screen({ x: point.x + point.handleOut.x, y: point.y + point.handleOut.y }) : null,
    }))
  }, model)
}

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Search project', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await page.getByLabel('Toggle Appearance panel').click()
  await page.getByLabel('Toggle board filmstrip').click()
  // A root board must have a managed directory. This browser-only harness has
  // no disk backend: acknowledge ONLY folder provisioning while creating the
  // isolated board, then remove the bridge. No production files are touched.
  await page.evaluate(() => {
    window.__drawingFolderCalls = []
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: async (command, args) => {
      if (command === 'plugin:window|scale_factor') return 1
      if (command === 'plugin:window|inner_size') return { width: 1600, height: 1000 }
      if (command !== 'ensure_managed_board_folders') throw new Error(`Drawing fixture does not mock ${command}`)
      window.__drawingFolderCalls.push(args)
    } }
  })
  await page.getByLabel('Board filmstrip').getByRole('button', { name: '＋ Root board' }).click()
  await page.waitForFunction(() => document.querySelector('.canvas-stage') && document.querySelectorAll('.board-node').length === 0)
  report.fixtureFolderCalls = await page.evaluate(() => window.__drawingFolderCalls)
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__ })
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await page.locator('.canvas-stage').waitFor()
  await settled()
  check('fresh root board is genuinely empty, including non-shape content', await page.locator('.board-node').count() === 0 && report.fixtureFolderCalls.length === 1)
  const box = await page.locator('.canvas-stage').boundingBox()
  const p = (x, y) => ({ x: box.x + x, y: box.y + y })

  await page.locator('.canvas-stage').focus()
  await page.keyboard.press('n'); await settled()
  check('N shortcut activates Pencil without the former Node collision', await page.getByLabel('Draw editable Pencil path').count() === 1 && await page.getByLabel('Erase vector shapes').count() === 0)
  await page.keyboard.press('a'); await settled()
  check('A shortcut activates Direct Selection', await page.locator('.canvas-stage.tool-node').count() === 1)

  await tool('Pen tool')
  await page.getByLabel('Place pen path anchors').waitFor()
  const roofPoints = [p(240, 260), p(390, 130), p(540, 260)]
  for (const point of [...roofPoints, roofPoints[0]]) {
    await page.mouse.click(point.x, point.y)
    await settled()
  }
  await nodes.waitFor()
  const roofId = await nodes.last().getAttribute('data-node-id')
  const roof = await copyNode(roofId)
  check('house roof is a closed editable triangle', roof.vectorPath?.closed && roof.vectorPath.points.length === 3)
  const roofFill = byId(roofId).locator('.node-vector-shape > g > path:not(.shape-hit-area):not(.vector-segment-hit):not(.vector-segment-selected)').first()
  check('closed path renders 100 percent fill without hidden .28 factor', Number(await roofFill.getAttribute('fill-opacity') ?? 1) === 1 && roof.opacity === 1)

  const house = [roof]
  for (const [from, to] of [[p(265, 260), p(515, 440)], [p(370, 345), p(410, 440)], [p(210, 445), p(570, 470)]]) {
    await tool('Draw rectangle'); await drag(from, to)
    const id = await nodes.last().getAttribute('data-node-id')
    const shape = await copyNode(id)
    check(`house ${house.length}: shape opacity is truthful`, shape.opacity === 1)
    house.push(shape)
  }
  check('house contains four real editable objects', await nodes.count() === 4)
  await screenshot('01-house-opacity-and-minimap')

  await copyNode(house[1].id)
  const doorBox = await byId(house[2].id).boundingBox()
  await page.mouse.click(doorBox.x + doorBox.width / 2, doorBox.y + doorBox.height / 2)
  await settled()
  await page.evaluate(() => localStorage.removeItem('art-equation-board-clipboard'))
  await page.keyboard.press('Control+c')
  const selectedOverlap = await page.evaluate(() => JSON.parse(localStorage.getItem('art-equation-board-clipboard') || '{}').nodes?.[0]?.id)
  check('selecting the wall does not promote it above the door or intercept the door click', selectedOverlap === house[2].id, JSON.stringify({ selectedOverlap, expected: house[2].id }))

  // The minimap must draw the triangular roof, rather than its rectangular hit
  // envelope. Compare a point inside the triangle with a point in its empty box corner.
  const bounds = house.map(vectorNodeBounds)
  const worldBounds = { minX: Math.min(...bounds.map((b) => b.left)) - 40, minY: Math.min(...bounds.map((b) => b.top)) - 40, maxX: Math.max(...bounds.map((b) => b.right)) + 40, maxY: Math.max(...bounds.map((b) => b.bottom)) + 40 }
  const roofInside = vectorLocalToBoard(roof, { x: roof.width / 2, y: roof.height * .65 })
  const roofOutside = vectorLocalToBoard(roof, { x: roof.width * .06, y: roof.height * .08 })
  await page.waitForFunction(() => { const canvas = document.querySelector('.board-minimap canvas'); return canvas && canvas.width > 0 })
  await settled()
  const minimapPixels = await page.locator('.board-minimap canvas').first().evaluate((canvas, { bounds, inside, outside }) => {
    const scale = Math.min((canvas.clientWidth - 14) / (bounds.maxX - bounds.minX), (canvas.clientHeight - 14) / (bounds.maxY - bounds.minY))
    const offsetX = (canvas.clientWidth - (bounds.maxX - bounds.minX) * scale) / 2, offsetY = (canvas.clientHeight - (bounds.maxY - bounds.minY) * scale) / 2
    const ratio = canvas.width / canvas.clientWidth
    const pixel = (point) => [...canvas.getContext('2d').getImageData(Math.round((offsetX + (point.x - bounds.minX) * scale) * ratio), Math.round((offsetY + (point.y - bounds.minY) * scale) * ratio), 1, 1).data]
    return { inside: pixel(inside), outside: pixel(outside) }
  }, { bounds: worldBounds, inside: roofInside, outside: roofOutside })
  check('minimap uses roof path silhouette rather than rectangle', minimapPixels.inside[3] === 255 && minimapPixels.inside.slice(0, 3).some((value, index) => Math.abs(value - minimapPixels.outside[index]) > 10), JSON.stringify(minimapPixels))

  await copyNode(roofId)
  await tool('Node tool')
  const segment = byId(roofId).locator('.vector-segment-hit').first()
  const midpoint = await segment.evaluate((path) => { const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()); return { x: point.x, y: point.y } })
  report.segmentHit = await page.evaluate(({ x, y }) => { const hit = document.elementFromPoint(x, y); return { tag: hit?.tagName, className: hit?.getAttribute('class'), markup: hit?.outerHTML.slice(0, 800) } }, midpoint)
  await traceGesture('segmentTrace', midpoint, { x: midpoint.x + 22, y: midpoint.y - 25 })
  const reshaped = await copyNode(roofId)
  report.segmentGeometry = { before: roof, after: reshaped }
  check('dragging a segment produces cubic controls', reshaped.vectorPath.points[0].handleOut && reshaped.vectorPath.points[1].handleIn)
  check('segment drag keeps endpoints fixed', reshaped.vectorPath.points.every((point, index) => {
    const before = vectorLocalToBoard(roof, roof.vectorPath.points[index]), after = vectorLocalToBoard(reshaped, point)
    return Math.hypot(before.x - after.x, before.y - after.y) < .01
  }))
  if (JSON.stringify(reshaped) !== JSON.stringify(roof)) {
    await undo()
    const restoredRoof = await copyNode(roofId)
    check('segment reshape undoes in one step', JSON.stringify(restoredRoof.vectorPath) === JSON.stringify(roof.vectorPath))
  } else check('segment reshape undoes in one step', false, 'No segment change was committed; prior fixture edits were not undone.')

  await tool('Node tool')
  await page.getByLabel('Flip path horizontally').click()
  await page.getByLabel('Path horizontal skew').fill('18')
  await page.getByLabel('Path horizontal skew').press('Enter')
  const transformed = await copyNode(roofId)
  const resizeHandle = page.locator(`[data-transform-controls="${roofId}"]`).getByRole('button', { name: /Resize .* from se/ })
  const handle = await resizeHandle.boundingBox()
  report.resizeHit = await page.evaluate(({ x, y }) => { const hit = document.elementFromPoint(x, y); return { tag: hit?.tagName, className: hit?.getAttribute('class'), label: hit?.getAttribute('aria-label'), markup: hit?.outerHTML.slice(0, 700) } }, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 })
  await traceGesture('resizeTrace', { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: handle.x + handle.width / 2 + 45, y: handle.y + handle.height / 2 + 20 })
  const resized = await copyNode(roofId)
  report.resizeGeometry = { before: transformed, after: resized }
  check('transformed resize scales real editable path and bakes inner transform', resized.width > transformed.width && resized.vectorTransform === undefined && JSON.stringify(resized.vectorPath) !== JSON.stringify(transformed.vectorPath))
  if (JSON.stringify(resized) !== JSON.stringify(transformed)) {
    await undo()
    const resizeUndone = await copyNode(roofId)
    check('transformed resize restores geometry and transform in one Undo', JSON.stringify(resizeUndone.vectorPath) === JSON.stringify(transformed.vectorPath) && JSON.stringify(resizeUndone.vectorTransform) === JSON.stringify(transformed.vectorTransform))
  } else check('transformed resize restores geometry and transform in one Undo', false, 'No resize was committed.')

  await tool('Pencil tool')
  const pencilCount = await nodes.count()
  const strokePoints = Array.from({ length: 25 }, (_, index) => p(720 + index * 10, 270 + Math.sin(index / 4) * 35))
  await page.mouse.move(strokePoints[0].x, strokePoints[0].y); await page.mouse.down()
  for (const point of strokePoints.slice(1)) await page.mouse.move(point.x, point.y)
  await page.mouse.up(); await settled()
  check('Pencil gesture creates one editable path', await nodes.count() === pencilCount + 1)
  const pencilId = await nodes.last().getAttribute('data-node-id'), pencilNode = await copyNode(pencilId)
  check('Pencil stores open cubic controls, not a bitmap', !pencilNode.vectorPath.closed && pencilNode.vectorPath.points.some((point) => point.handleIn || point.handleOut))
  await undo()
  check('Pencil whole stroke is one Undo', await nodes.count() === pencilCount)
  await rail.getByLabel('Redo board change').click(); await settled()

  await tool('Vector Eraser')
  const pencilBox = await byId(pencilId).boundingBox()
  const eraseFrom = { x: pencilBox.x + pencilBox.width / 2, y: pencilBox.y - 30 }, eraseTo = { x: pencilBox.x + pencilBox.width / 2, y: pencilBox.y + pencilBox.height + 30 }
  report.openEraserHit = await page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 500), eraseFrom)
  await drag(eraseFrom, eraseTo)
  check('Eraser splits an open Pencil stroke into editable fragments', await nodes.count() === pencilCount + 2)
  await undo()
  check('one Undo restores whole erased Pencil stroke', await nodes.count() === pencilCount + 1)
  const pencilRestored = await copyNode(pencilId)
  check('erasure Undo restores exact Pencil geometry', JSON.stringify(pencilRestored.vectorPath) === JSON.stringify(pencilNode.vectorPath))

  const wallId = house[1].id
  await copyNode(wallId)
  await tool('Vector Eraser')
  const wallBox = await byId(wallId).boundingBox()
  const wallEraseFrom = { x: wallBox.x + wallBox.width * .25, y: wallBox.y - 15 }, wallEraseTo = { x: wallBox.x + wallBox.width * .25, y: wallBox.y + wallBox.height + 15 }
  report.filledEraserHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 700), wallEraseFrom)
  await traceGesture('filledEraserTrace', wallEraseFrom, wallEraseTo)
  const wallErased = await copyNode(wallId)
  report.filledEraserGeometry = { before: house[1], after: wallErased }
  check('filled Eraser removes geometry through subtraction operands', wallErased.vectorBoolean?.operation === 'subtract' && wallErased.vectorBoolean.operands.length > 1)
  if (wallErased.vectorBoolean) {
    const cutters = wallErased.vectorBoolean.operands.slice(1).map(vectorPathBounds)
    check('filled Eraser follows the full rendered wall sweep through its bottom edge', Math.min(...cutters.map((bounds) => bounds.top)) < 0 && Math.max(...cutters.map((bounds) => bounds.bottom)) > wallErased.height, JSON.stringify({ cutters, wallHeight: wallErased.height, wallBox, wallEraseFrom, wallEraseTo }))
  } else check('filled Eraser follows the full rendered wall sweep through its bottom edge', false, 'No filled erasure committed.')
  await screenshot('02-filled-vector-erasure')
  if (JSON.stringify(wallErased) !== JSON.stringify(house[1])) {
    await undo()
    const wallRestored = await copyNode(wallId)
    check('filled erasure restores live wall geometry in one Undo', wallRestored.shapeType === house[1].shapeType && !wallRestored.vectorBoolean)
  } else check('filled erasure restores live wall geometry in one Undo', false, 'No filled erasure was committed.')
  const scroll = await page.locator('.canvas-stage').evaluate((stage) => ({ left: stage.scrollLeft, top: stage.scrollTop }))
  check('keyboard focus and drawing controls do not secretly scroll the camera', scroll.left === 0 && scroll.top === 0 && report.filledEraserTrace.events.every((event) => event.stageScrollTop === 0 && event.stageScrollLeft === 0), JSON.stringify(scroll))

  // A normal cursor must reach transformed controls exactly where the visible
  // SVG path/handles render. This is not a synthetic dispatch into hidden nodes.
  await copyNode(pencilId)
  await tool('Node tool')
  await page.getByLabel('Flip path horizontally').click()
  await page.getByLabel('Path horizontal skew').fill('18')
  await page.getByLabel('Path horizontal skew').press('Enter')
  report.transformedControlPositions = []
  for (const rotation of [0, 30, 90]) {
    await page.locator('.geometry-fields input').nth(4).fill(String(rotation))
    await page.locator('.geometry-fields input').nth(4).press('Enter')
    const model = await copyNode(pencilId)
    await tool('Node tool')
    const controls = await renderedControls(pencilId, model)
    const distances = controls.flatMap((control) => [[control.anchor, control.expectedAnchor], [control.handleIn, control.expectedIn], [control.handleOut, control.expectedOut]])
      .filter(([, expected]) => expected)
      .map(([actual, expected]) => actual ? Math.hypot(actual.x - expected.x, actual.y - expected.y) : Infinity)
    report.transformedControlPositions.push({ rotation, controls, maximumDistance: Math.max(...distances) })
    check(`Direct Select anchors and handles match flipped/skewed SVG at ${rotation} degrees`, distances.length >= model.vectorPath.points.length && Math.max(...distances) <= 1.5, JSON.stringify(report.transformedControlPositions.at(-1)))
  }
  await page.locator('.geometry-fields input').nth(4).fill('30')
  await page.locator('.geometry-fields input').nth(4).press('Enter')
  const controlBaseline = await copyNode(pencilId)
  await tool('Node tool')
  const anchorControls = await renderedControls(pencilId, controlBaseline), anchorStart = anchorControls[0].anchor
  const anchorDelta = { x: 18, y: -16 }, boardScale = await page.locator('.board-world').evaluate((world) => new DOMMatrix(getComputedStyle(world).transform).a)
  report.transformedAnchorHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 500), anchorStart)
  await traceGesture('transformedAnchorTrace', anchorStart, { x: anchorStart.x + anchorDelta.x, y: anchorStart.y + anchorDelta.y })
  const anchorEdited = await copyNode(pencilId), beforeAnchor = vectorLocalToBoard(controlBaseline, controlBaseline.vectorPath.points[0]), afterAnchor = vectorLocalToBoard(anchorEdited, anchorEdited.vectorPath.points[0])
  check('real transformed anchor drag follows board-space pointer', Math.hypot(afterAnchor.x - beforeAnchor.x - anchorDelta.x / boardScale, afterAnchor.y - beforeAnchor.y - anchorDelta.y / boardScale) <= 2, JSON.stringify({ beforeAnchor, afterAnchor, anchorDelta, boardScale }))
  if (JSON.stringify(anchorEdited) !== JSON.stringify(controlBaseline)) {
    await undo()
    check('transformed anchor edit undoes exact path and transform in one step', JSON.stringify(await copyNode(pencilId)) === JSON.stringify(controlBaseline))
  } else check('transformed anchor edit undoes exact path and transform in one step', false, 'Anchor drag did not change geometry; no prior command was undone.')
  await tool('Node tool')
  const handleControls = await renderedControls(pencilId, controlBaseline), handleControl = handleControls.find((control) => control.handleOut)
  const handleStart = handleControl.handleOut, handleDelta = { x: 16, y: 15 }
  await traceGesture('transformedHandleTrace', handleStart, { x: handleStart.x + handleDelta.x, y: handleStart.y + handleDelta.y })
  const handleEdited = await copyNode(pencilId), beforePoint = controlBaseline.vectorPath.points[handleControl.index], afterPoint = handleEdited.vectorPath.points[handleControl.index]
  const beforeHandle = vectorLocalToBoard(controlBaseline, { x: beforePoint.x + beforePoint.handleOut.x, y: beforePoint.y + beforePoint.handleOut.y }), afterHandle = vectorLocalToBoard(handleEdited, { x: afterPoint.x + afterPoint.handleOut.x, y: afterPoint.y + afterPoint.handleOut.y })
  check('real transformed curve-handle drag follows board-space pointer', Math.hypot(afterHandle.x - beforeHandle.x - handleDelta.x / boardScale, afterHandle.y - beforeHandle.y - handleDelta.y / boardScale) <= 2, JSON.stringify({ beforeHandle, afterHandle, handleDelta, boardScale }))
  if (JSON.stringify(handleEdited) !== JSON.stringify(controlBaseline)) {
    await undo()
    check('transformed handle edit undoes exact path and transform in one step', JSON.stringify(await copyNode(pencilId)) === JSON.stringify(controlBaseline))
  } else check('transformed handle edit undoes exact path and transform in one step', false, 'Handle drag did not change geometry; no prior command was undone.')
  await screenshot('03-transformed-direct-controls')

  // Multi-path selection must visibly explain the single-path policy, not
  // display misleading controls or alias one path's indices across another.
  await copyNode(roofId)
  const secondHit = await byId(pencilId).locator('.shape-hit-area').evaluate((path) => { const point = path.getPointAtLength(path.getTotalLength() * .35).matrixTransform(path.getScreenCTM()); return { x: point.x, y: point.y } })
  await page.keyboard.down('Shift'); await page.mouse.click(secondHit.x, secondHit.y); await page.keyboard.up('Shift'); await settled()
  check('normal Shift-click selects two independent paths', await page.locator('.board-node.selected').count() === 2)
  await tool('Node tool')
  check('multiple selected paths show no shared anchor-index controls', await page.locator('.vector-anchor[data-point-index]').count() === 0)
  report.multiplePathPolicy = await page.evaluate(() => ({ selectedIds: [...document.querySelectorAll('.board-node.selected')].map((item) => item.getAttribute('data-node-id')), notice: document.querySelector('.drawing-notice')?.textContent }))
  check('multiple selected paths expose the explicit one-path editing policy', await page.getByText(/Direct Selection edits one path at a time/).isVisible(), JSON.stringify(report.multiplePathPolicy))

  // Paste through the application clipboard workflow. The fixture is tiny and
  // editable, with nested group ownership and two independent lock cases.
  const groupFixture = [
    { id: 'qa-group', kind: 'group', containerRole: 'group', title: 'QA eraser parent', x: 0, y: 0, width: 360, height: 220, color: '#30404d', opacity: 1 },
    { id: 'qa-frame', kind: 'group', containerRole: 'frame', title: 'QA nested frame', groupId: 'qa-group', x: 20, y: 55, width: 205, height: 150, color: '#30404d', opacity: 1 },
    { id: 'qa-unlocked', kind: 'shape', shapeType: 'rectangle', title: 'QA editable child', groupId: 'qa-frame', x: 40, y: 85, width: 75, height: 100, cornerRadius: 0, color: '#3e8295', strokeWidth: 2, opacity: 1 },
    { id: 'qa-locked', kind: 'shape', shapeType: 'rectangle', title: 'QA locked child', groupId: 'qa-frame', locked: true, x: 135, y: 85, width: 75, height: 100, cornerRadius: 0, color: '#a45f3d', strokeWidth: 2, opacity: 1 },
    { id: 'qa-locked-group', kind: 'group', containerRole: 'group', title: 'QA locked ancestor', groupId: 'qa-group', locked: true, x: 240, y: 55, width: 100, height: 145, color: '#30404d', opacity: 1 },
    { id: 'qa-inherited', kind: 'shape', shapeType: 'rectangle', title: 'QA inherited lock child', groupId: 'qa-locked-group', x: 250, y: 85, width: 60, height: 100, cornerRadius: 0, color: '#688153', strokeWidth: 2, opacity: 1 },
    { id: 'qa-outside', kind: 'shape', shapeType: 'rectangle', title: 'QA unselected outside vector', x: 390, y: 85, width: 65, height: 100, cornerRadius: 0, color: '#6a518d', strokeWidth: 2, opacity: 1 },
  ]
  await tool('Select and move')
  await page.evaluate((fixture) => localStorage.setItem('art-equation-board-clipboard', JSON.stringify({ nodes: fixture })), groupFixture)
  await page.locator('.canvas-stage').focus()
  await page.keyboard.press('Control+v'); await settled()
  await page.keyboard.press('Control+c')
  const pastedFixture = await page.evaluate(() => JSON.parse(localStorage.getItem('art-equation-board-clipboard') || '{}').nodes || [])
  const fixtureNode = (title) => pastedFixture.find((node) => node.title === title)
  check('nested editable/locked group fixture pastes with ownership preserved', pastedFixture.length === 7 && fixtureNode('QA editable child')?.groupId === fixtureNode('QA nested frame')?.id && fixtureNode('QA inherited lock child')?.groupId === fixtureNode('QA locked ancestor')?.id)
  const editableBefore = fixtureNode('QA editable child'), lockedBefore = fixtureNode('QA locked child'), inheritedBefore = fixtureNode('QA inherited lock child'), outsideBefore = fixtureNode('QA unselected outside vector'), parent = fixtureNode('QA eraser parent')
  // Paste deliberately selects every pasted object. A click on an already
  // selected group preserves that multi-selection by design; start this scope
  // check with the same ordinary blank-canvas deselection used by copyNode.
  const fixtureStage = await page.locator('.canvas-stage').boundingBox()
  await page.mouse.click(fixtureStage.x + fixtureStage.width * .7, fixtureStage.y + fixtureStage.height - 35)
  await settled()
  const parentHeader = byId(parent.id).locator('.node-drag-handle').first()
  await parentHeader.click(); await settled()
  report.groupSelection = await page.locator('.board-node.selected').evaluateAll((items) => items.map((item) => item.getAttribute('data-node-id')))
  check('normal parent-header click scopes selection to the outer group', report.groupSelection.length === 1 && report.groupSelection[0] === parent.id, JSON.stringify(report.groupSelection))
  const groupBox = await byId(parent.id).boundingBox()
  await tool('Vector Eraser')
  // Continue the same real pointer sweep beyond the selected parent through an
  // unrelated vector. Group scope must not silently fall back to all shapes.
  const groupFrom = { x: groupBox.x + groupBox.width * .05, y: groupBox.y + groupBox.height * .6 }, groupTo = { x: groupBox.x + groupBox.width * 1.35, y: groupBox.y + groupBox.height * .6 }
  await traceGesture('groupEraserTrace', groupFrom, groupTo)
  report.groupEraserSelection = await page.locator('.board-node.selected').evaluateAll((items) => items.map((item) => item.getAttribute('data-node-id')))
  check('group-scoped erasure retains the selected parent rather than selecting its children', report.groupEraserSelection.length === 1 && report.groupEraserSelection[0] === parent.id, JSON.stringify(report.groupEraserSelection))
  const editableAfter = await copyNode(editableBefore.id), lockedAfter = await copyNode(lockedBefore.id), inheritedAfter = await copyNode(inheritedBefore.id), outsideAfter = await copyNode(outsideBefore.id)
  check('selected parent group Eraser reaches editable nested descendants', editableAfter.vectorBoolean?.operation === 'subtract')
  report.booleanHitBounds = await byId(editableBefore.id).evaluate((item) => {
    const primary = item.querySelector('.node-vector-shape path[mask], .node-vector-shape g > path[pointer-events="none"]'), proxy = item.querySelector('.shape-hit-area')
    const bounds = (path) => { const box = path?.getBBox(); return box && { x: box.x, y: box.y, width: box.width, height: box.height } }
    return { primary: bounds(primary), proxy: bounds(proxy) }
  })
  const primaryBounds = report.booleanHitBounds.primary, proxyBounds = report.booleanHitBounds.proxy
  check('subtract Boolean hit proxy does not include invisible cutter geometry outside the primary shape', primaryBounds && proxyBounds && proxyBounds.x >= primaryBounds.x - .1 && proxyBounds.y >= primaryBounds.y - .1 && proxyBounds.x + proxyBounds.width <= primaryBounds.x + primaryBounds.width + .1 && proxyBounds.y + proxyBounds.height <= primaryBounds.y + primaryBounds.height + .1, JSON.stringify(report.booleanHitBounds))
  check('selected parent group Eraser preserves explicitly locked child geometry', JSON.stringify(lockedAfter) === JSON.stringify(lockedBefore))
  check('selected parent group Eraser preserves child under locked ancestor', JSON.stringify(inheritedAfter) === JSON.stringify(inheritedBefore))
  check('group-scoped Eraser preserves an unrelated vector even when the pointer crosses it', JSON.stringify(outsideAfter) === JSON.stringify(outsideBefore))
  if (JSON.stringify(editableAfter) !== JSON.stringify(editableBefore)) {
    await undo()
    check('group-scoped erasure is one exact Undo', JSON.stringify(await copyNode(editableBefore.id)) === JSON.stringify(editableBefore))
  } else check('group-scoped erasure is one exact Undo', false, 'Group erase did not edit the unlocked descendant; no prior command was undone.')
  await copyNode(inheritedBefore.id)
  await tool('Vector Eraser')
  const lockedBox = await byId(inheritedBefore.id).boundingBox()
  await drag({ x: lockedBox.x - 10, y: lockedBox.y + lockedBox.height / 2 }, { x: lockedBox.x + lockedBox.width + 10, y: lockedBox.y + lockedBox.height / 2 })
  report.lockedAncestorNotice = await page.locator('.drawing-notice').textContent()
  check('directly selected inherited-lock child remains unchanged under Eraser', JSON.stringify(await copyNode(inheritedBefore.id)) === JSON.stringify(inheritedBefore))
  check('inherited-lock Eraser gives a visible reason rather than silent failure', /Locked ancestor/.test(report.lockedAncestorNotice || ''), report.lockedAncestorNotice)
  await screenshot('04-group-eraser-lock-scope')

  // Lock policy must cover the actual visible pointer handles, not merely
  // Direct Selection/Eraser. Inspect canonical geometry via normal clipboard
  // selection after every gesture; never dispatch events through a hidden hit.
  report.lockedTransforms = []
  for (const [label, baseline] of [['own lock', lockedBefore], ['inherited lock', inheritedBefore]]) {
    for (const action of ['move', 'resize', 'rotate', 'radius']) {
      await copyNode(baseline.id)
      const item = byId(baseline.id)
      let start
      if (action === 'move') {
        const bounds = await item.boundingBox()
        start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      } else {
        const overlay = page.locator(`[data-transform-controls="${baseline.id}"]`)
        const control = action === 'resize' ? overlay.locator('.node-resize-handle.handle-se') : action === 'rotate' ? overlay.locator('.node-rotate-handle') : overlay.locator('.node-radius-handle')
        const bounds = await control.boundingBox()
        assert.ok(bounds, `${label} ${action} must expose the real control under test`)
        start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      }
      const hit = await page.evaluate(({ x, y }) => { const element = document.elementFromPoint(x, y); return { node: element?.closest('.board-node')?.getAttribute('data-node-id'), controlOwner: element?.closest('[data-transform-controls]')?.getAttribute('data-transform-controls'), label: element?.getAttribute('aria-label'), className: element?.getAttribute('class') } }, start)
      check(`${label} ${action} uses a real visible hit target`, (hit.node === baseline.id || hit.controlOwner === baseline.id) && (action === 'move' || hit.className?.includes(`node-${action === 'radius' ? 'radius' : action}-handle`)), JSON.stringify(hit))
      await traceGesture(`lock-${label}-${action}`, start, { x: start.x + 35, y: start.y + 22 })
      const notice = await page.locator('.drawing-notice').textContent()
      const actual = await copyNode(baseline.id)
      report.lockedTransforms.push({ label, action, before: baseline, after: actual, notice, hit })
      check(`${label} ${action} does not mutate canonical geometry`, JSON.stringify(actual) === JSON.stringify(baseline), JSON.stringify(report.lockedTransforms.at(-1)))
      check(`${label} ${action} provides a visible lock reason`, /locked/i.test(notice || ''), notice)
    }
  }

  const fixtureBaselines = [parent, ...pastedFixture.filter((node) => node.id !== parent.id)]
  async function inspectFixture() { const result = []; for (const baseline of fixtureBaselines) result.push(await copyNode(baseline.id)); return result }
  async function selectParent() {
    await tool('Select and move')
    const bounds = await page.locator('.canvas-stage').boundingBox()
    await page.mouse.click(bounds.x + 90, bounds.y + bounds.height - 25)
    await byId(parent.id).locator('.node-drag-handle').first().click()
    await settled()
    assert.deepEqual(await page.locator('.board-node.selected').evaluateAll((items) => items.map((item) => item.getAttribute('data-node-id'))), [parent.id])
  }
  for (const action of ['move', 'resize', 'rotate']) {
    const before = await inspectFixture()
    await selectParent()
    const overlay = page.locator(`[data-transform-controls="${parent.id}"]`)
    const control = action === 'move' ? byId(parent.id).locator('.node-drag-handle').first() : action === 'resize' ? overlay.locator('.node-resize-handle.handle-se') : overlay.locator('.node-rotate-handle')
    const bounds = await control.boundingBox(), start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    await traceGesture(`locked-parent-${action}`, start, { x: start.x + 35, y: start.y + 22 })
    const notice = await page.locator('.drawing-notice').textContent()
    const after = await inspectFixture()
    check(`parent ${action} fails closed when a descendant is locked`, JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after, notice }))
  }
  await copyNode(outsideBefore.id)
  const ownLockedBox = await byId(lockedBefore.id).boundingBox()
  await page.keyboard.down('Shift'); await page.mouse.click(ownLockedBox.x + ownLockedBox.width / 2, ownLockedBox.y + ownLockedBox.height / 2); await page.keyboard.up('Shift'); await settled()
  check('ordinary Shift-click prepares mixed locked/unlocked selection', await page.locator('.board-node.selected').count() === 2)
  const outsideBox = await byId(outsideBefore.id).boundingBox(), mixedStart = { x: outsideBox.x + outsideBox.width / 2, y: outsideBox.y + outsideBox.height / 2 }
  await traceGesture('mixedLockMove', mixedStart, { x: mixedStart.x + 30, y: mixedStart.y + 20 })
  check('mixed selection move preserves both locked and unlocked geometry', JSON.stringify(await copyNode(outsideBefore.id)) === JSON.stringify(outsideBefore) && JSON.stringify(await copyNode(lockedBefore.id)) === JSON.stringify(lockedBefore))

  // Numeric controls are another transform entry point. Disabled controls are
  // acceptable; enabled controls must enforce the same immutable lock policy.
  for (const [label, baseline] of [['own lock', lockedBefore], ['inherited lock', inheritedBefore]]) {
    await copyNode(baseline.id)
    const xInput = page.locator('.geometry-fields input').first()
    const disabled = await xInput.isDisabled()
    if (!disabled) { await xInput.fill(String(baseline.x + 40)); await xInput.press('Enter'); await settled() }
    const actual = await copyNode(baseline.id)
    check(`${label} numeric X edit cannot bypass transform policy`, JSON.stringify(actual) === JSON.stringify(baseline), JSON.stringify({ disabled, before: baseline, after: actual }))
    if (JSON.stringify(actual) !== JSON.stringify(baseline)) { await undo(); assert.deepEqual(await copyNode(baseline.id), baseline, 'restore only the disposable numeric test mutation') }
  }

  // Unlock only the two fixture locks through real hierarchy controls, then
  // prove a parent movement carries every transitive descendant exactly once.
  if (!await page.getByLabel('Show board hierarchy').count()) await page.getByLabel('Toggle Appearance panel').click()
  await page.getByLabel('Show board hierarchy').click()
  await page.getByLabel('Unlock QA locked child', { exact: true }).click()
  await page.getByLabel('Unlock QA locked ancestor', { exact: true }).click()
  await page.getByLabel('Close board hierarchy').click()
  const unlockedBaseline = await inspectFixture()
  await selectParent()
  const header = await byId(parent.id).locator('.node-drag-handle').first().boundingBox()
  const nestedStart = { x: header.x + header.width * .5, y: header.y + header.height * .5 }
  const nestedScale = await page.locator('.board-world').evaluate((world) => new DOMMatrix(getComputedStyle(world).transform).a)
  await page.keyboard.down('Alt'); await traceGesture('unlockedNestedMove', nestedStart, { x: nestedStart.x + 40, y: nestedStart.y + 25 }); await page.keyboard.up('Alt')
  const nestedMoved = await inspectFixture()
  check('unlocked parent move carries all transitive descendants without shifting outsiders', nestedMoved.every((node, index) => {
    const before = unlockedBaseline[index], member = before.id !== outsideBefore.id
    return Math.abs(node.x - before.x - (member ? 40 / nestedScale : 0)) <= 1 && Math.abs(node.y - before.y - (member ? 25 / nestedScale : 0)) <= 1 && node.width === before.width && node.height === before.height && node.groupId === before.groupId
  }), JSON.stringify({ nestedScale, before: unlockedBaseline, after: nestedMoved }))
  if (JSON.stringify(nestedMoved) !== JSON.stringify(unlockedBaseline)) {
    await undo()
    check('transitive group movement restores every descendant in one Undo', JSON.stringify(await inspectFixture()) === JSON.stringify(unlockedBaseline))
  } else check('transitive group movement restores every descendant in one Undo', false, 'No nested movement committed; no earlier command was undone.')
  await screenshot('05-locked-transforms-and-transitive-group')

  // Pen threshold tests use a second disposable empty root board. Every new
  // anchor is a genuine mouse click, and zoom changes use the visible menu.
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: async (command) => {
      if (command === 'plugin:window|scale_factor') return 1
      if (command === 'plugin:window|inner_size') return { width: 1600, height: 1000 }
      if (command !== 'ensure_managed_board_folders') throw new Error(`Pen fixture does not mock ${command}`)
    } }
  })
  await page.getByLabel('Board filmstrip').getByRole('button', { name: '＋ Root board' }).click()
  await page.waitForFunction(() => document.querySelector('.canvas-stage') && document.querySelectorAll('.board-node').length === 0)
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__ })
  await page.getByRole('button', { name: 'Canvas', exact: true }).click(); await settled()
  report.penCloseThreshold = []
  for (const zoom of [100, 50, 200]) {
    await page.locator('.canvas-zoom-percentage').click()
    await page.getByRole('menuitemradio', { name: `${zoom}%`, exact: true }).click(); await settled()
    await tool('Pen tool')
    const stage = await page.locator('.canvas-stage').boundingBox()
    const points = [{ x: stage.x + 440, y: stage.y + 250 }, { x: stage.x + 600, y: stage.y + 150 }, { x: stage.x + 760, y: stage.y + 250 }]
    for (const point of points) { await page.mouse.click(point.x, point.y); await settled() }
    const first = await page.locator('.pen-draft:not(.freehand-draft) circle').first().evaluate((circle) => { const rect = circle.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, diameter: rect.width } })
    await page.mouse.move(first.x + 14, first.y); await settled()
    const outsideCue = await page.locator('.drawing-notice').textContent()
    check(`Pen ${zoom}% does not show closure outside 12 screen pixels`, !/Click the first anchor to close/.test(outsideCue || ''), outsideCue)
    await page.mouse.move(first.x + 10, first.y); await settled()
    const insideCue = await page.locator('.drawing-notice').textContent(), cursor = await page.getByLabel('Place pen path anchors').evaluate((surface) => getComputedStyle(surface).cursor)
    const hoverDiameter = await page.locator('.pen-draft:not(.freehand-draft) circle').first().evaluate((circle) => circle.getBoundingClientRect().width)
    check(`Pen ${zoom}% shows a closure cue inside 12 screen pixels`, /Click the first anchor to close/.test(insideCue || '') && cursor === 'cell', JSON.stringify({ insideCue, cursor }))
    check(`Pen ${zoom}% anchor affordance remains screen-space sized`, Math.abs(first.diameter - 8) <= .5 && Math.abs(hoverDiameter - 12) <= .5, JSON.stringify({ first: first.diameter, hoverDiameter }))
    await page.mouse.click(first.x + 10, first.y); await settled()
    const id = await nodes.last().getAttribute('data-node-id'), closed = await copyNode(id)
    check(`Pen ${zoom}% actual near-first click closes without adding a duplicate anchor`, closed.vectorPath?.closed && closed.vectorPath.points.length === 3 && await nodes.count() === 1, JSON.stringify(closed))
    await undo(); check(`Pen ${zoom}% closed path is one Undo`, await nodes.count() === 0)
    await tool('Pen tool')
    for (const point of points) { await page.mouse.click(point.x, point.y); await settled() }
    const cancelFirst = await page.locator('.pen-draft:not(.freehand-draft) circle').first().evaluate((circle) => { const rect = circle.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })
    await page.mouse.click(cancelFirst.x + 16, cancelFirst.y); await settled()
    check(`Pen ${zoom}% actual outside-threshold click adds an anchor instead of closing`, await nodes.count() === 0 && await page.locator('.pen-draft:not(.freehand-draft) circle').count() === 4)
    await page.keyboard.press('Escape'); await settled()
    check(`Pen ${zoom}% Escape discards the uncommitted draft and stays in Pen`, await nodes.count() === 0 && await page.locator('.pen-draft:not(.freehand-draft)').count() === 0 && await page.getByLabel('Place pen path anchors').count() === 1)
    await page.keyboard.press('Escape'); await settled()
    check(`Pen ${zoom}% second Escape returns to Select`, await page.getByLabel('Place pen path anchors').count() === 0 && await page.locator('.canvas-stage.tool-select').count() === 1)
    report.penCloseThreshold.push({ zoom, first, hoverDiameter, outsideCue, insideCue, closed })
  }
  await screenshot('06-pen-close-threshold-and-escape')
  check('drawing flow has no browser exceptions', report.browserErrors.length === 0, report.browserErrors.join('\n'))
  report.passed = report.checks.every((check) => check.passed)
  if (!report.passed) report.failure = report.checks.filter((check) => !check.passed).map((check) => `${check.name}${check.detail ? `: ${check.detail}` : ''}`).join('\n')
} catch (error) {
  report.failure = String(error.stack || error)
  await screenshot('failure').catch(() => {})
} finally {
  report.sourceHashesAtEnd = {}
  for (const name of Object.keys(report.sourceHashes)) report.sourceHashesAtEnd[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
  report.sourceChangedDuringRun = JSON.stringify(report.sourceHashes) !== JSON.stringify(report.sourceHashesAtEnd)
  if (report.sourceChangedDuringRun) { report.passed = false; report.failure = `${report.failure || ''}\nProduction source changed during run; rerun against frozen source.` }
  await writeFile(resolve(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`Part II drawing UI: ${report.passed ? 'PASS' : 'FAIL'} (${report.checks.filter((check) => check.passed).length}/${report.checks.length} checks). Report: ${resolve(artifactDir, 'report.json')}`)
if (!report.passed) { console.error(report.failure); process.exitCode = 1 }

