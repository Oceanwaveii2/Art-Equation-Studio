import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const load = (code) => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const { createBlankProject } = await load(ts.transpileModule(await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const sourceFixture = resolve('builds/previews/partii-organization-2026-09-30/native-validation-workspace/fixture-final-baseline.json')
const preservedExe = resolve('builds/previews/partii-organization-2026-09-30/native-validation-workspace/Art Equation - Part II Organization Preview 2026-09-30.exe')
const beforeHashes = {}
for (const path of [resolve('src/App.tsx'), resolve('src/App.css'), sourceFixture, preservedExe]) beforeHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex')
assert.equal(beforeHashes[resolve('src/App.tsx')].toUpperCase(), '0097168DF34E8B9CB6DD80EC840B2F826DEBF9DD69CA518A7AB76B814475A36C')
const native = JSON.parse(await readFile(sourceFixture, 'utf8')).project.boards.find((board) => board.id === 'native-root')
const fixture = createBlankProject('Part II isolated node-body drag activation')
fixture.id = 'partii-node-drag-activation-memory'
fixture.assets = []
const board = structuredClone(native)
board.nodes = board.nodes.filter((node) => ['House frame', 'Wall', 'Roof', 'Closing curve', 'References'].includes(node.id))
board.nodes.push({ id: 'column-row', title: 'Column row', kind: 'note', x: 1050, y: 188, width: 240, height: 120, color: '#56748e', parentColumnId: 'References', columnOrder: 0, freeWidth: 120, freeHeight: 60 },
  { id: 'free-note', title: 'Free note', kind: 'note', x: 700, y: 620, width: 140, height: 100, color: '#56748e' })
board.gridSpacing = 44
board.snapToGrid = true
fixture.boards = [board]
const base = new URL(process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo')
base.searchParams.set('canvas-renderer', 'dom')
const baseUrl = base.href
const artifacts = resolve('output/playwright/partii-node-drag-activation/' + new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'))
await mkdir(artifacts, { recursive: true })
const report = { generatedAt: new Date().toISOString(), passed: false, baseUrl, checks: [], sourceHashes: beforeHashes, browserErrors: [], alerts: [], scenarios: [], limitation: 'Actual production React pointer handlers in isolated headless Edge with explicit DOM renderer. Precise synthetic pointer dispatch plus a normal browser mouse drag. Memory-only Tauri project hydration/Save; no native GUI input, host workspace write, native renderer pixels or disk restart proof. Earlier failing source replay and native EXE are preserved.' }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } }), page = await context.newPage()
report.browserVersion = browser.version()
page.on('pageerror', (error) => report.browserErrors.push(error.message))
page.on('dialog', async (dialog) => { report.alerts.push(dialog.message()); await dialog.accept() })
await page.addInitScript((initial) => {
  const stored = sessionStorage.getItem('node-drag-fixture')
  const backend = window.__nodeDragBackend = { project: stored ? JSON.parse(stored) : structuredClone(initial), calls: [] }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('No host clipboard permitted') } } })
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (value) => value,
    invoke: async (command, args = {}) => {
      backend.calls.push({ command, args: structuredClone(args) })
      if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'node-drag-qa', readOnly: false, lockOwned: true }
      if (command === 'list_projects') return [{ id: initial.id, title: initial.title, updatedAt: initial.updatedAt, boardCount: 1, assetCount: 0, status: initial.status }]
      if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? { schemaVersion: 5, theme: 'dark', canvasEnginePreference: 'generation-1', viewMode: 'canvas', activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'native-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:native-root', viewMode: 'canvas' } } } : backend.project)
      if (command === 'save_json') { if (args.relativePath.endsWith('/project.json')) backend.project = structuredClone(args.value); return }
      if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten'].includes(command)) return
      if (['list_project_trash', 'list_trashed_projects', 'audit_assets'].includes(command)) return []
      if (['plugin:event|listen', 'plugin:window|scale_factor'].includes(command)) return 1
      if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
      if (command === 'mini_bridge_launch') return null
      throw Error('Isolated node drag refuses ' + command)
    } }
}, fixture)
const byId = (id) => page.locator('.board-node[data-node-id="' + id + '"]')
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), detail }); console.log((passed ? 'PASS ' : 'FAIL ') + name); assert(passed, name + ': ' + JSON.stringify(detail)) }
const content = (project) => JSON.stringify({ nodes: project.boards[0].nodes, connectors: project.boards[0].connectors })
const nodeAt = (project, id) => project.boards[0].nodes.find((node) => node.id === id)
async function save() {
  const before = await page.evaluate(() => window.__nodeDragBackend.calls.length)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction((before) => window.__nodeDragBackend.calls.slice(before).some((call) => call.command === 'save_json' && call.args.relativePath.endsWith('/project.json')), before)
  await settled()
  return page.evaluate(() => structuredClone(window.__nodeDragBackend.project))
}
async function reset(project = fixture) {
  await page.evaluate((project) => sessionStorage.setItem('node-drag-fixture', JSON.stringify(project)), project)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await byId('Wall').waitFor()
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await page.getByLabel('Select and move', { exact: true }).click()
  await settled()
  return save()
}
async function point(id) {
  const found = await byId(id).evaluate((item, id) => {
    for (const handle of item.querySelectorAll('.node-drag-handle')) {
      const b = handle.getBoundingClientRect()
      for (const fraction of [.15, .3, .7]) {
        const p = { x: Math.round(b.x + b.width * fraction), y: Math.round(b.y + b.height / 2) }
        if (document.elementFromPoint(p.x, p.y)?.closest('.board-node')?.getAttribute('data-node-id') === id) return p
      }
    }
    const b = item.getBoundingClientRect()
    for (const fx of [.5, .35, .65, .2, .8]) for (const fy of [.6, .8, .4, .2]) {
      const p = { x: Math.round(b.x + b.width * fx), y: Math.round(b.y + b.height * fy) }
      const hit = document.elementFromPoint(p.x, p.y)
      if (hit?.closest('.board-node')?.getAttribute('data-node-id') === id && !hit.closest('input,button,textarea,[contenteditable=true]')) return p
    }
    return null
  }, id)
  assert(found, 'No visible production node-body pointer surface for ' + id)
  return found
}
let pointerId = 200
async function down(id, options = {}) {
  const p = await point(id), pid = ++pointerId
  await page.evaluate(({ id, p, pid, options }) => {
    const target = document.elementFromPoint(p.x, p.y)
    if (target?.closest('.board-node')?.getAttribute('data-node-id') !== id) throw Error('Pointer surface changed before down')
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: pid, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: p.x, clientY: p.y, ...options }))
  }, { id, p, pid, options })
  await settled()
  return { id, p, pid, options }
}
async function sample(state, type, dx, dy, options = {}) {
  await page.evaluate(({ state, type, dx, dy, options }) => window.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: state.pid, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: state.p.x + dx, clientY: state.p.y + dy, ...state.options, ...options })), { state, type, dx, dy, options })
  await settled()
}
async function gesture(id, dx, dy, { move = false, altKey = false } = {}) {
  const state = await down(id, { altKey })
  if (move) await sample(state, 'pointermove', dx, dy)
  await sample(state, 'pointerup', dx, dy)
  return save()
}
async function undo() { await page.getByLabel('Undo board change', { exact: true }).click(); await settled(); return save() }
async function redo() { await page.getByLabel('Redo board change', { exact: true }).click(); await settled(); return save() }
async function emptyHistory(expected) { return content(await undo()) === content(expected) }
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  const enter = page.getByRole('button', { name: 'Enter now', exact: true }); if (await enter.count()) await enter.click()
  let before = await reset()
  check('Native-source fixture hydrates Wall off-grid y280 at70% zoom', nodeAt(before, 'Wall').y === 280 && before.boards[0].viewport.scale === .7, before.boards[0].viewport)
  for (const scenario of [
    { name: 'Exact down/up click', dx: 0, dy: 0 },
    { name: 'Same-coordinate pointermove click', dx: 0, dy: 0, move: true },
    { name: '1CSSpx right pointerup only', dx: 1, dy: 0 },
    { name: '1CSSpx up pointerup only', dx: 0, dy: -1 },
    { name: '1CSSpx pointermove and up', dx: 1, dy: -1, move: true },
    { name: '3CSSpx pointerup only', dx: 0, dy: -3 },
    { name: '3CSSpx pointermove and up', dx: 3, dy: 0, move: true },
  ]) {
    const after = await gesture('Wall', scenario.dx, scenario.dy, scenario)
    check(scenario.name + ' preserves entire geometry/routes and creates no undo command', content(after) === content(before) && await emptyHistory(before), { wall: nodeAt(after, 'Wall') })
    check(scenario.name + ' still selects Wall', await byId('Wall').evaluate((item) => item.classList.contains('selected')))
    report.scenarios.push({ ...scenario, before: nodeAt(before, 'Wall'), after: nodeAt(after, 'Wall') })
  }
  const activated = await gesture('Wall', 0, -4)
  check('4CSSpx pointerup alone activates existing snap and records one undo command', nodeAt(activated, 'Wall').y === 275 && nodeAt(activated, 'Wall').x === 210 && content(activated) !== content(before), nodeAt(activated, 'Wall'))
  check('Activated body drag preserves dimensions, ownership and external manual route', nodeAt(activated, 'Wall').width === 230 && nodeAt(activated, 'Wall').height === 200 && nodeAt(activated, 'Wall').groupId === 'House frame' && JSON.stringify(activated.boards[0].connectors) === JSON.stringify(before.boards[0].connectors))
  check('One undo restores4CSSpx drag exact baseline', content(await undo()) === content(before) && await emptyHistory(before))
  for (const step of [{ dx: 1, dy: 0 }, { dx: 3, dy: 0 }]) await gesture('Wall', step.dx, step.dy, { move: true })
  check('Subthreshold clicks preserve redo branch after undo', content(await redo()) === content(activated))
  const activatedAgain = await save()
  await gesture('Wall', 1, 0, { move: true })
  check('Subthreshold click creates no extra history above existing movement', content(await undo()) === content(before) && await emptyHistory(before))
  check('Existing redo command survives click-only selection', content(await redo()) === content(activatedAgain))
  before = await reset()
  const diagonal = await gesture('Wall', 3, 3, { altKey: true, move: true })
  check('3by3CSSpx diagonal activates4px radial threshold with full baseline delta', nodeAt(diagonal, 'Wall').x === 214 && nodeAt(diagonal, 'Wall').y === 284, nodeAt(diagonal, 'Wall'))
  check('Diagonal movement is one atomic undo command', content(await undo()) === content(before) && await emptyHistory(before))
  before = await reset()
  const normal = await gesture('Wall', 20, 40, { altKey: true, move: true })
  check('70% real drag retains full CSS-to-world precision without subtracting threshold', nodeAt(normal, 'Wall').x === 239 && nodeAt(normal, 'Wall').y === 337, nodeAt(normal, 'Wall'))
  check('Normal movement is one exact undo and redo', content(await undo()) === content(before) && content(await redo()) === content(normal))
  const zoomed = structuredClone(fixture); zoomed.boards[0].viewport = { x: 0, y: 0, scale: 1.4 }
  before = await reset(zoomed)
  check('3CSSpx at140% still counts as a click, independent of world zoom', content(await gesture('Wall', 3, 0, { move: true })) === content(before) && await emptyHistory(before))
  const zoomDrag = await gesture('Wall', 4, 0, { altKey: true })
  check('4CSSpx at140% activates and retains rounded world displacement', nodeAt(zoomDrag, 'Wall').x === 213 && nodeAt(zoomDrag, 'Wall').y === 280)
  before = await reset()
  const realPoint = await point('Wall')
  await page.keyboard.down('Alt'); await page.mouse.move(realPoint.x, realPoint.y); await page.mouse.down(); await page.mouse.move(realPoint.x + 21, realPoint.y + 14, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Alt'); await settled()
  const mouseMoved = await save()
  check('Ordinary browser mouse drag activates and moves30by20 world units at70%', nodeAt(mouseMoved, 'Wall').x === 240 && nodeAt(mouseMoved, 'Wall').y === 300, nodeAt(mouseMoved, 'Wall'))
  check('Ordinary mouse drag retains one undo command', content(await undo()) === content(before) && await emptyHistory(before))
  before = await reset()
  const rowBefore = structuredClone(before)
  check('Column row1px click neither detaches nor reflows source column', content(await gesture('column-row', 1, 0, { move: true })) === content(before) && await emptyHistory(before))
  check('Column row3px click remains owned and same free dimensions', content(await gesture('column-row', 3, 0)) === content(before))
  const rowReleased = await gesture('column-row', -100, 0, { altKey: true, move: true })
  check('Ordinary column row drag can still release onto canvas', !nodeAt(rowReleased, 'column-row').parentColumnId && nodeAt(rowReleased, 'column-row').width === 120 && nodeAt(rowReleased, 'column-row').height === 60, nodeAt(rowReleased, 'column-row'))
  check('Released row restores column ownership/routes with one undo', content(await undo()) === content(rowBefore) && await emptyHistory(before))
  const freeDown = await down('free-note', { altKey: true })
  const dest = await byId('References').boundingBox(), dx = Math.round(dest.x + dest.width / 2) - freeDown.p.x, dy = Math.round(dest.y + 90) - freeDown.p.y
  await sample(freeDown, 'pointermove', dx, dy); await sample(freeDown, 'pointerup', dx, dy)
  const inserted = await save()
  check('Activated body drag still inserts a free card into visible column', nodeAt(inserted, 'free-note').parentColumnId === 'References', nodeAt(inserted, 'free-note'))
  check('Column insertion remains one atomic undo', content(await undo()) === content(before) && await emptyHistory(before))
  before = await reset()
  for (const distance of [1, 24]) {
    const after = await gesture('Closing curve', distance, 0, { move: true })
    check('Locked node refuses' + distance + 'CSSpx gesture without geometry or history', content(after) === content(before) && await emptyHistory(before))
  }
  const lockedFixture = structuredClone(fixture); nodeAt(lockedFixture, 'Roof').locked = true
  before = await reset(lockedFixture)
  check('Frame with locked descendant refuses whole body drag', content(await gesture('House frame', 20, 20, { move: true, altKey: true })) === content(before) && await emptyHistory(before))
  before = await reset()
  const cancelOrigin = await byId('Wall').boundingBox(); const cancelled = await down('Wall', { altKey: true }); await sample(cancelled, 'pointermove', 20, 20)
  const cancelPreview = await byId('Wall').boundingBox(); check('Active drag presents20CSSpx preview while memory Save preserves committed baseline', Math.abs(cancelPreview.x - cancelOrigin.x - 20) <= 1 && Math.abs(cancelPreview.y - cancelOrigin.y - 20) <= 1 && content(await save()) === content(before), { cancelOrigin, cancelPreview })
  await page.keyboard.press('Escape'); await settled(); await sample(cancelled, 'pointerup', 40, 40)
  check('Escape cancels active preview and rejects late pointerup without history', content(await save()) === content(before) && await emptyHistory(before))
  const pointerCancelled = await down('Wall', { altKey: true }); await sample(pointerCancelled, 'pointermove', 20, 20); await sample(pointerCancelled, 'pointercancel', 20, 20); await sample(pointerCancelled, 'pointerup', 40, 40)
  check('Pointercancel restores baseline and rejects stale completion', content(await save()) === content(before) && await emptyHistory(before))
  const clickCancelled = await down('Wall'); await sample(clickCancelled, 'pointermove', 1, 0); await sample(clickCancelled, 'pointercancel', 1, 0); await sample(clickCancelled, 'pointerup', 30, 0)
  check('Cancelled subthreshold click cannot snap or become a delayed drag', content(await save()) === content(before) && await emptyHistory(before))
  const calls = await page.evaluate(() => window.__nodeDragBackend.calls)
  check('Fixture backend permits only memory Save and read commands, no host mutation', !calls.some((call) => ['export_binary', 'import_file', 'write_asset_bytes', 'delete_file', 'trash_nodes'].includes(call.command)))
  check('All body pointer checks produce no unexpected browser errors or dialogs', !report.browserErrors.length && !report.alerts.length, { errors: report.browserErrors, alerts: report.alerts })
  const afterHashes = {}; for (const path of Object.keys(beforeHashes)) afterHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex')
  report.finalSourceHashes = afterHashes
  check('App/CSS/native fixture and earlier native EXE remain byte-for-byte unchanged during checks', JSON.stringify(afterHashes) === JSON.stringify(beforeHashes))
  report.passed = report.checks.every((entry) => entry.passed)
} catch (error) { report.failure = String(error.stack || error); await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {}) }
finally { await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); await browser.close() }
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.filter((entry) => entry.passed).length, total: report.checks.length, artifacts }))
if (!report.passed) { console.error(report.failure); process.exitCode = 1 }
