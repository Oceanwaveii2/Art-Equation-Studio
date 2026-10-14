import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import ts from 'typescript'
import { vectorLocalToBoard } from '../src/model/vector.ts'

// Real toolbar/selection/export/recovery commands. All persistence and clipboard
// calls end inside this browser context; native projects/assets/EXEs are untouched.
const code = ts.transpileModule(await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-vector-operations')
await mkdir(artifacts, { recursive: true })
const sourceFiles = ['src/App.tsx', 'src/App.css', 'src/model/project.ts', 'src/model/vector.ts', 'src/model/vectorComposition.ts', 'src/model/vectorBooleanGeometry.ts', 'src/board/vectorSvg.ts', 'src/board/boardMutationSafety.ts', 'src/board/OverlayPresenter.ts', 'src/board/nativeCommandJournal.ts']
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async (path) => [path, createHash('sha256').update(await readFile(resolve(path))).digest('hex')])))
const report = { passed: false, generatedAt: new Date().toISOString(), baseUrl, sourceHashes: await sourceHashes(), checks: [], scenarios: [], browserErrors: [], screenshots: [], raster: {}, limitation: 'Normal React toolbar/pointer/Undo/Redo/CopySVG and memory-backed Save/reload/Trash/restore; SVG rendered to pixels by Edge. No native GPU pixels, actual native disk recovery, host clipboard, physical DPI or stylus claims.' }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
report.browserVersion = browser.version()
const rectangle = { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 120 }, { x: 0, y: 120 }] }
const shape = (id, x, y, extra = {}) => ({ id, kind: 'shape', shapeType: 'path', title: id, x, y, width: 160, height: 120, color: '#f04444', strokeColor: '#111111', strokeWidth: 8, opacity: 1, vectorPath: structuredClone(rectangle), ...extra })
function fixture(mode = 'closed') {
  const initial = createBlankProject(`Disposable ${mode} drawing operations`); initial.id = `vector-operations-${mode}`
  let a = shape('operand-a', 180, 150), b = shape('operand-b', 260, 200)
  if (mode.includes('open')) { a = shape('operand-a', 180, 200, { height: 12, color: 'transparent', vectorPath: { version: 1, closed: false, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }] } }); b = shape('operand-b', 340, 200, { width: 100, height: 80, color: 'transparent', vectorPath: { version: 1, closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 80 }] } }) }
  if (mode === 'transformed-closed') { a.rotation = 90; b.x = 300; b.y = 230 }
  if (mode === 'reversed-winding') b.vectorPath.points.reverse()
  if (mode === 'transformed-open') { a.rotation = 90; b.x = 266; b.y = 286 }
  initial.boards = [{ id: 'operations-root', title: 'Vector operations', viewport: { x: 0, y: 0, scale: 1 }, backgroundColor: '#151a20', backgroundFollowsTheme: false, gridVisible: false, snapToGrid: false, nodes: [a, b, { id: 'untouched', kind: 'note', title: 'Untouched', body: 'Preserve me', x: 650, y: 160, width: 180, height: 110 }], connectors: mode === 'connected' ? [{ id: 'existing-link', sourceId: 'operand-b', targetId: 'untouched', sourcePort: 'right', targetPort: 'left', sourcePortMode: 'fixed', targetPortMode: 'adaptive', style: 'elbow', color: '#60a5fa', width: 2, dashed: false, linePattern: 'dot', startArrow: false, endArrow: true, animated: false, bendPoints: [{ x: 500, y: 280 }, { x: 550, y: 230 }], label: 'Preserve identity, route and label', labelPosition: { t: .35, offsetX: 8, offsetY: -20, future: 'keep' } }] : [] }]
  return initial
}
const board = (data) => data.boards.find((entry) => entry.id === 'operations-root')
const semantic = (data) => ({ nodes: board(data).nodes, connectors: board(data).connectors })
const digest = (data) => JSON.stringify(data)
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), detail }); assert(passed, `${name}: ${JSON.stringify(detail)}`) }
let context, page
const byId = (id) => page.locator(`.board-node[data-node-id="${id}"]`)
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
async function enter() { const button = page.getByRole('button', { name: 'Enter now', exact: true }); if (await button.count()) await button.click(); await byId('untouched').waitFor(); await page.getByRole('button', { name: 'Canvas', exact: true }).click(); await page.getByLabel('Select and move', { exact: true }).click(); await settled() }
async function boot(mode) {
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); page = await context.newPage()
  page.on('pageerror', (error) => report.browserErrors.push(error.message))
  await page.addInitScript((initial) => {
    const key = 'vector-operation-backend', backend = JSON.parse(sessionStorage.getItem(key) || 'null') || { project: structuredClone(initial), entries: [], clipboard: [], calls: [] }
    window.__vectorOperationBackend = backend
    const persist = () => sessionStorage.setItem(key, JSON.stringify(backend))
    localStorage.setItem('art-equation.navigator', '1'); localStorage.setItem('art-equation.inspector', '0'); localStorage.setItem('art-equation.canvas-tools', '1'); localStorage.setItem('art-equation.view-mode', 'canvas')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { backend.clipboard.push(text); persist() }, read: async () => [] } })
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (value) => value,
      invoke: async (command, args = {}) => {
        backend.calls.push({ command, args: structuredClone(args) }); persist()
        if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'isolated-vector-operations', readOnly: false, lockOwned: true }
        if (command === 'list_projects') return [{ id: backend.project.id, title: backend.project.title, updatedAt: backend.project.updatedAt, boardCount: 1, assetCount: 0, status: backend.project.status }]
        if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? { schemaVersion: 5, theme: 'dark', viewMode: 'canvas', activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'operations-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:operations-root', viewMode: 'canvas' } } } : backend.project)
        if (command === 'save_json') { if (args.relativePath.endsWith('/project.json')) { backend.project = structuredClone(args.value); persist() } return }
        if (command === 'record_trash_entry') { backend.entries = backend.entries.filter((entry) => entry.id !== args.entry.id); backend.entries.push(structuredClone(args.entry)); persist(); return }
        if (command === 'list_project_trash') return structuredClone(backend.entries)
        if (command === 'remove_trash_entry') { backend.entries = backend.entries.filter((entry) => entry.id !== args.entryId); persist(); return }
        if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten'].includes(command)) return
        if (['list_trashed_projects', 'audit_assets'].includes(command)) return []
        if (['plugin:event|listen', 'plugin:window|scale_factor'].includes(command)) return 1
        if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
        if (command === 'mini_bridge_launch') return null
        throw new Error(`Vector operation fixture refuses ${command}`)
      } }
  }, fixture(mode))
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await enter()
}
async function save() { const before = await page.evaluate(() => window.__vectorOperationBackend.calls.length); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForFunction((before) => window.__vectorOperationBackend.calls.slice(before).some((call) => call.command === 'save_json' && call.args.relativePath.endsWith('/project.json')), before); return page.evaluate(() => structuredClone(window.__vectorOperationBackend.project)) }
async function choose(id, additive = false) {
  const item = byId(id); await item.waitFor()
  const point = await item.locator('.shape-hit-area').evaluate((path, id) => { for (const fraction of [.1, .25, .4, .6, .75, .9]) { const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM()); if (document.elementFromPoint(point.x, point.y)?.closest('.board-node')?.getAttribute('data-node-id') === id) return { x: point.x, y: point.y } } throw new Error(`No unobscured actual shape surface for ${id}`) }, id)
  if (additive) await page.keyboard.down('Shift'); await page.mouse.click(point.x, point.y); if (additive) await page.keyboard.up('Shift'); await settled()
  assert(await item.evaluate((item) => item.classList.contains('selected')), `Pointer did not select ${id}`)
  return point
}
async function selectedPair() { await choose('operand-a'); await choose('operand-b', true); check('Two operands are selected with normal additive pointer input', await page.locator('.board-node.selected').count() === 2) }
async function undo() { await page.getByLabel('Undo board change', { exact: true }).click(); await settled() }
async function redo() { await page.getByLabel('Redo board change', { exact: true }).click(); await settled() }
async function screenshot(name) { await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true }); report.screenshots.push(`${name}.png`) }
async function copySvg(id) {
  const point = await choose(id); const before = await page.evaluate(() => window.__vectorOperationBackend.clipboard.length)
  await page.mouse.click(point.x, point.y, { button: 'right' }); const menu = page.getByRole('menu', { name: 'Canvas context menu' }); await menu.waitFor(); await menu.getByRole('menuitem', { name: 'Copy SVG', exact: true }).click(); await page.waitForFunction((before) => window.__vectorOperationBackend.clipboard.length > before, before)
  return page.evaluate(() => window.__vectorOperationBackend.clipboard.at(-1))
}
async function pixels(svg, probes, name) {
  const result = await page.evaluate(async ({ svg, probes }) => {
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement, view = root.getAttribute('viewBox').split(/\s+/).map(Number)
    const image = new Image(), loaded = new Promise((done, reject) => { image.onload = done; image.onerror = reject }); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await loaded
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const c = canvas.getContext('2d'); c.drawImage(image, 0, 0)
    const sample = (point) => { const x = Math.round((point.x - view[0]) * image.width / view[2]), y = Math.round((point.y - view[1]) * image.height / view[3]); return x < 0 || y < 0 || x >= canvas.width || y >= canvas.height ? [0, 0, 0, 0] : [...c.getImageData(x, y, 1, 1).data] }
    return { viewBox: view, size: [canvas.width, canvas.height], pixels: probes.map(sample), png: canvas.toDataURL('image/png') }
  }, { svg, probes })
  await writeFile(resolve(artifacts, `${name}.svg`), svg); await writeFile(resolve(artifacts, `${name}.png`), Buffer.from(result.png.split(',')[1], 'base64')); delete result.png; report.raster[name] = result
  return result
}
async function domSvg(node) { return byId(node.id).locator('.node-vector-shape').evaluate((item, node) => { const clone = item.cloneNode(true); clone.querySelectorAll('.shape-hit-area,.vector-segment-hit').forEach((entry) => entry.remove()); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width + 16}" height="${node.height + 16}" viewBox="${node.x - 8} ${node.y - 8} ${node.width + 16} ${node.height + 16}"><g transform="translate(${node.x} ${node.y}) rotate(${node.rotation || 0} ${node.width / 2} ${node.height / 2})">${clone.innerHTML}</g></svg>` }, node) }
async function historyAndRecovery(before, after, resultId, operation) {
  await undo(); check(`${operation}: Undo restores exact operand nodes and ordering`, digest(semantic(await save())) === digest(semantic(before)))
  await redo(); check(`${operation}: Redo restores identical result identity/geometry`, digest(semantic(await save())) === digest(semantic(after)))
  await page.reload({ waitUntil: 'domcontentloaded' }); await enter(); check(`${operation}: saved result survives full React reload exactly`, digest(semantic(await save())) === digest(semantic(after)))
  await choose(resultId); await page.locator('.canvas-stage').focus(); await page.keyboard.press('Delete'); await page.waitForFunction(() => window.__vectorOperationBackend.entries.length === 1); await settled(); const removed = await save(), entries = await page.evaluate(() => structuredClone(window.__vectorOperationBackend.entries))
  check(`${operation}: Trash record preserves exact result vector metadata`, board(removed).nodes.length === 1 && entries[0].nodes.some((node) => node.id === resultId && digest(node) === digest(board(after).nodes.find((node) => node.id === resultId))))
  await page.getByTestId('trash-button').click(); const viewer = page.getByTestId('trash-viewer'); await viewer.waitFor(); const start = await page.evaluate(() => window.__vectorOperationBackend.calls.length); await viewer.getByRole('button', { name: /Restore/ }).click(); await page.waitForFunction(() => window.__vectorOperationBackend.entries.length === 0); await settled()
  check(`${operation}: Trash restore returns exact result and untouched outsider`, digest(semantic(await save())) === digest(semantic(after)))
  const calls = await page.evaluate((start) => window.__vectorOperationBackend.calls.slice(start), start), saveAt = calls.findIndex((call) => call.command === 'save_json' && call.args.relativePath.endsWith('/project.json')), clearAt = calls.findIndex((call) => call.command === 'remove_trash_entry')
  check(`${operation}: restore saves before clearing recovery record`, saveAt >= 0 && clearAt > saveAt)
}
async function scenario(name, mode, run) { const first = report.checks.length; try { await boot(mode); await run(); report.scenarios.push({ name, passed: true, checks: report.checks.length - first }) } catch (error) { report.scenarios.push({ name, passed: false, error: error.message, stack: error.stack }); if (page) await screenshot(`failure-${name}`) } finally { await context?.close() } }

try {
  const probes = [{ x: 210, y: 180 }, { x: 300, y: 240 }, { x: 390, y: 300 }, { x: 470, y: 350 }]
  for (const [operation, expected] of [['Union', [true, true, true, false]], ['Subtract', [true, false, false, false]], ['Intersect', [false, true, false, false]], ['Exclude', [true, false, true, false]]]) await scenario(operation.toLowerCase(), 'closed', async () => {
    const before = await save(); await selectedPair(); await page.getByRole('button', { name: operation, exact: true }).click(); await settled(); const after = await save(), result = board(after).nodes.find((node) => node.id !== 'untouched')
    check(`${operation}: one new composite replaces both selected operands`, board(after).nodes.length === 2 && !['operand-a', 'operand-b'].includes(result.id) && result.vectorBoolean?.operation === operation.toLowerCase() && result.vectorBoolean.operands.length === 2, result)
    check(`${operation}: outsider remains unchanged`, digest(board(after).nodes.find((node) => node.id === 'untouched')) === digest(board(before).nodes.find((node) => node.id === 'untouched')))
    const svg = await copySvg(result.id), raster = await pixels(svg, probes, `${operation.toLowerCase()}-export`), dom = await pixels(await domSvg(result), probes, `${operation.toLowerCase()}-dom`)
    check(`${operation}: Copy SVG filled regions match operation`, raster.pixels.every((pixel, index) => expected[index] ? pixel[3] > 240 : pixel[3] < 5), { expected, actual: raster.pixels })
    check(`${operation}: live DOM SVG filled regions match exported geometry`, dom.pixels.every((pixel, index) => expected[index] ? pixel[3] > 240 : pixel[3] < 5), { expected, actual: dom.pixels })
    if (operation === 'Intersect') {
      const outlineProbe = await pixels(await domSvg(result), [{ x: 180, y: 210 }], 'intersect-dom-outline')
      check('Intersect live DOM omits primary outline outside the clipped intersection', outlineProbe.pixels[0][3] < 5, outlineProbe)
    }
    await screenshot(`${operation.toLowerCase()}-result`); await historyAndRecovery(before, after, result.id, operation)
  })
  await scenario('join', 'open', async () => {
    const before = await save(); await selectedPair(); await page.getByRole('button', { name: 'Join paths', exact: true }).click(); await settled(); const after = await save(), result = board(after).nodes.find((node) => node.id !== 'untouched')
    check('Join retains first identity and merges shared endpoint into three open anchors', board(after).nodes.length === 2 && result.id === 'operand-a' && !result.vectorPath.closed && result.vectorPath.points.length === 3 && !result.vectorBoolean, result)
    const svg = await copySvg(result.id), raster = await pixels(svg, [{ x: 230, y: 200 }, { x: 390, y: 240 }, { x: 200, y: 260 }], 'join-export')
    check('Join Copy SVG paints both original segments and keeps open fill transparent', raster.pixels[0][3] > 240 && raster.pixels[1][3] > 240 && raster.pixels[2][3] < 5, raster.pixels)
    await screenshot('join-result'); await historyAndRecovery(before, after, result.id, 'Join')
  })
  await scenario('transformed-union', 'transformed-closed', async () => {
    const before = await save(); await selectedPair(); await page.getByRole('button', { name: 'Union', exact: true }).click(); await settled(); const after = await save(), result = board(after).nodes.find((node) => node.id !== 'untouched')
    const raster = await pixels(await copySvg(result.id), [{ x: 220, y: 160 }, { x: 310, y: 260 }, { x: 430, y: 330 }, { x: 190, y: 170 }], 'transformed-union-export')
    check('Union bakes differing operand transforms in world space without moving original painted regions', raster.pixels[0][3] > 240 && raster.pixels[1][3] > 240 && raster.pixels[2][3] > 240 && raster.pixels[3][3] < 5, { result, pixels: raster.pixels })
    await historyAndRecovery(before, after, result.id, 'Transformed Union')
  })
  await scenario('transformed-join', 'transformed-open', async () => {
    const before = await save(), a = board(before).nodes.find((node) => node.id === 'operand-a'), b = board(before).nodes.find((node) => node.id === 'operand-b'), endA = vectorLocalToBoard(a, a.vectorPath.points.at(-1)), startB = vectorLocalToBoard(b, b.vectorPath.points[0])
    check('Rotated Join fixture endpoints meet in visible world space', Math.hypot(endA.x - startB.x, endA.y - startB.y) < .01, { endA, startB })
    await selectedPair(); await page.getByRole('button', { name: 'Join paths', exact: true }).click(); await settled(); const after = await save(), result = board(after).nodes.find((node) => node.id !== 'untouched')
    const actual = result.vectorPath.points.map((point) => vectorLocalToBoard(result, point)), expected = [vectorLocalToBoard(a, a.vectorPath.points[0]), endA, vectorLocalToBoard(b, b.vectorPath.points.at(-1))]
    check('Join merges rotated and plain visible endpoints while preserving world anchors', actual.length === 3 && actual.every((point, index) => Math.hypot(point.x - expected[index].x, point.y - expected[index].y) < .01), { actual, expected, result })
    await historyAndRecovery(before, after, result.id, 'Transformed Join')
  })
  await scenario('union-reversed-winding', 'reversed-winding', async () => {
    await selectedPair(); await page.getByRole('button', { name: 'Union', exact: true }).click(); await settled(); const after = await save(), result = board(after).nodes.find((node) => node.id !== 'untouched')
    const raster = await pixels(await copySvg(result.id), probes, 'union-reversed-winding-export')
    check('Union preserves overlap for opposite operand contour directions', raster.pixels.slice(0, 3).every((pixel) => pixel[3] > 240) && raster.pixels[3][3] < 5, raster)
  })
  await scenario('connected-operation-reattachment', 'connected', async () => {
    const before = await save(); await selectedPair(); await page.getByRole('button', { name: 'Union', exact: true }).click(); await settled()
    const after = await save(), result = board(after).nodes.find((node) => node.id !== 'untouched'), edge = board(after).connectors[0], expected = { ...board(before).connectors[0], sourceId: result.id }
    check('Connected Union replaces both operands and remaps its existing edge atomically', board(after).nodes.length === 2 && result.vectorBoolean?.operation === 'union' && board(after).connectors.length === 1 && edge.sourceId === result.id && edge.targetId === 'untouched', { result, edge })
    check('Connected Union preserves exact edge identity, routing, ports, style and label metadata', digest(edge) === digest(expected), { edge, expected })
    await historyAndRecovery(before, after, result.id, 'Connected Union')
  })
  await scenario('boolean-inspector-resize', 'closed', async () => {
    await selectedPair(); await page.getByRole('button', { name: 'Union', exact: true }).click(); await settled()
    const original = await save(), result = board(original).nodes.find((node) => node.id !== 'untouched')
    await choose(result.id); await page.getByLabel('Show the inspector panel', { exact: true }).click()
    const width = page.getByLabel(`width of ${result.title || result.kind}`, { exact: true }), height = page.getByLabel(`height of ${result.title || result.kind}`, { exact: true })
    await width.fill(String(result.width * 2)); await width.press('Enter'); await settled()
    await height.fill(String(result.height * 1.5)); await height.press('Enter'); await settled()
    const resized = await save(), next = board(resized).nodes.find((node) => node.id === result.id), scaledProbes = probes.map((point) => ({ x: result.x + (point.x - result.x) * 2, y: result.y + (point.y - result.y) * 1.5 }))
    check('Inspector resizes Boolean frame through normal width and height input', next.width === result.width * 2 && next.height === result.height * 1.5 && next.x === result.x && next.y === result.y, { before: result, after: next })
    const expected = [true, true, true, false], exported = await pixels(await copySvg(next.id), scaledProbes, 'boolean-resized-export'), dom = await pixels(await domSvg(next), scaledProbes, 'boolean-resized-dom')
    check('Resized Boolean Copy SVG contours follow scaled operands at all region probes', exported.pixels.every((pixel, index) => expected[index] ? pixel[3] > 240 : pixel[3] < 5), exported)
    check('Resized Boolean live DOM contours follow scaled operands at all region probes', dom.pixels.every((pixel, index) => expected[index] ? pixel[3] > 240 : pixel[3] < 5), dom)
    await undo(); await undo(); const undone = await save(); check('Two inspector resize Undos restore exact original composite snapshot', digest(semantic(undone)) === digest(semantic(original)), { expected: semantic(original), actual: semantic(undone) })
    await redo(); await redo(); const redone = await save(); check('Two inspector resize Redos restore exact scaled composite snapshot', digest(semantic(redone)) === digest(semantic(resized)), { expected: semantic(resized), actual: semantic(redone) })
    await page.reload({ waitUntil: 'domcontentloaded' }); await enter(); const reloaded = await save(), loaded = board(reloaded).nodes.find((node) => node.id === next.id)
    check('Resized Boolean derived contours and operands survive Save/reload exactly', digest(semantic(reloaded)) === digest(semantic(resized)))
    const raster = await pixels(await copySvg(loaded.id), scaledProbes, 'boolean-resized-reloaded-export')
    check('Reloaded resized Boolean paints the same scaled regions', raster.pixels.every((pixel, index) => expected[index] ? pixel[3] > 240 : pixel[3] < 5), raster)
    await screenshot('boolean-inspector-resize-result')
  })
} finally {
  report.sourceHashesAtEnd = await sourceHashes(); report.sourceChangedDuringRun = digest(report.sourceHashes) !== digest(report.sourceHashesAtEnd)
  report.passed = report.scenarios.length === 10 && report.scenarios.every((entry) => entry.passed) && report.browserErrors.length === 0 && !report.sourceChangedDuringRun
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, passedChecks: report.checks.filter((entry) => entry.passed).length, scenarios: report.scenarios.map(({ name, passed, error }) => ({ name, passed, error })), browserErrors: report.browserErrors, sourceChangedDuringRun: report.sourceChangedDuringRun, report: resolve(artifacts, 'report.json') }, null, 2)); await browser.close(); if (!report.passed) process.exitCode = 1
}
