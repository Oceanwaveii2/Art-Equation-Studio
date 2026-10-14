import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import ts from 'typescript'

// Real React pointer controls and memory-only fixture persistence. No commands
// enter the production workspace, operating-system clipboard or existing EXEs.
const projectCode = await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(projectCode, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-column-safety-resume')
await mkdir(artifacts, { recursive: true })
const report = { passed: false, generatedAt: new Date().toISOString(), baseUrl, checks: [], scenarios: [], browserErrors: [], screenshots: [], sourceHashes: {}, limitation: 'Real headless Edge React pointer/Undo/save/reload; persistence is an isolated memory backend. Native disk, renderer pixels, physical Windows DPI and stylus acceptance are separate.' }
for (const path of ['src/App.tsx', 'src/board/columns.ts', 'src/board/diagramStructureCore.ts', 'src/board/containerPaintOrder.ts']) report.sourceHashes[path] = createHash('sha256').update(await readFile(resolve(path))).digest('hex')
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
report.browserVersion = browser.version()
const node = (id, kind, x, y, width, height, extra = {}) => ({ id, kind, title: id, body: id, x, y, width, height, ...extra })
const connector = (id, extra = {}) => ({ id, sourcePort: 'right', targetPort: 'left', sourcePortMode: 'fixed', targetPortMode: 'fixed', style: 'elbow', color: '#60a5fa', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false, ...extra })
const project = createBlankProject('Disposable Part II column safety')
project.id = 'partii-column-safety-memory-only'
project.boards = [{ id: 'columns-root', title: 'Columns safety', viewport: { x: 0, y: 0, scale: 1 }, backgroundColor: '#151a20', backgroundFollowsTheme: false, snapToGrid: false, gridVisible: false,
  nodes: [
    node('src', 'column', 50, 100, 230, 310),
    node('src-row', 'note', 60, 168, 210, 130, { parentColumnId: 'src', columnOrder: 0, freeWidth: 180, freeHeight: 110 }),
    node('outer', 'group', 340, 90, 280, 450, { containerRole: 'frame' }),
    node('inner-column', 'column', 365, 145, 230, 220, { groupId: 'outer' }),
    node('inner-row', 'note', 375, 213, 210, 130, { parentColumnId: 'inner-column', columnOrder: 0, freeWidth: 180, freeHeight: 110 }),
    node('group-leaf', 'note', 375, 410, 170, 100, { groupId: 'outer' }),
    node('dest', 'column', 720, 100, 250, 330),
    node('dest-row', 'note', 730, 168, 230, 140, { parentColumnId: 'dest', columnOrder: 0, freeWidth: 180, freeHeight: 110 }),
    node('locked-dest', 'column', 1040, 100, 230, 310, { locked: true }),
    node('locked-row', 'note', 1050, 168, 210, 130, { parentColumnId: 'locked-dest', columnOrder: 0, locked: true }),
  ],
  connectors: [connector('internal-route', { sourceId: 'inner-row', targetId: 'group-leaf', bendPoints: [{ x: 630, y: 300 }, { x: 630, y: 450 }], label: 'Internal route' }), connector('internal-free', { sourceId: 'group-leaf', targetPoint: { x: 600, y: 510 }, bendPoints: [{ x: 565, y: 500 }], label: 'Internal free' }), connector('boundary', { sourceId: 'group-leaf', targetId: 'src-row', bendPoints: [{ x: 320, y: 460 }], label: 'Boundary' })],
}]
const board = (data) => data.boards.find((entry) => entry.id === 'columns-root')
const semantic = (data) => ({ nodes: board(data).nodes, connectors: board(data).connectors })
const get = (data, id) => board(data).nodes.find((entry) => entry.id === id)
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), detail }); assert(passed, `${name}: ${JSON.stringify(detail)}`) }
const hash = (data) => JSON.stringify(data)
let context, page
async function boot() {
  context = await browser.newContext({ viewport: { width: 1600, height: 1040 }, deviceScaleFactor: 1 })
  page = await context.newPage()
  page.on('pageerror', (error) => report.browserErrors.push(error.message))
  await page.addInitScript((initial) => {
    const backend = { project: JSON.parse(sessionStorage.getItem('column-fixture-project') || 'null') || structuredClone(initial), calls: [] }
    window.__columnBackend = backend
    localStorage.setItem('art-equation.navigator', '0'); localStorage.setItem('art-equation.inspector', '0'); localStorage.setItem('art-equation.canvas-tools', '1'); localStorage.setItem('art-equation.view-mode', 'canvas')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {}, read: async () => [] } })
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (value) => value,
      invoke: async (command, args = {}) => {
        backend.calls.push({ command, args: structuredClone(args) })
        if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'isolated-column-safety', readOnly: false, lockOwned: true }
        if (command === 'list_projects') return [{ id: backend.project.id, title: backend.project.title, updatedAt: backend.project.updatedAt, boardCount: 1, assetCount: 0, status: backend.project.status }]
        if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? { schemaVersion: 5, theme: 'dark', viewMode: 'canvas', activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'columns-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:columns-root', viewMode: 'canvas' } } } : backend.project)
        if (command === 'save_json') { if (args.relativePath.endsWith('/project.json')) { backend.project = structuredClone(args.value); sessionStorage.setItem('column-fixture-project', JSON.stringify(backend.project)) } return }
        if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten'].includes(command)) return
        if (['list_project_trash', 'list_trashed_projects', 'audit_assets'].includes(command)) return []
        if (['plugin:event|listen', 'plugin:window|scale_factor'].includes(command)) return 1
        if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
        if (command === 'mini_bridge_launch') return null
        throw new Error(`Column safety fixture refuses ${command}`)
      } }
  }, project)
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await enter()
}
const byId = (id) => page.locator(`.board-node[data-node-id="${id}"]`)
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
async function enter() { const button = page.getByRole('button', { name: 'Enter now', exact: true }); if (await button.count()) await button.click(); await byId('outer').waitFor(); await page.getByRole('button', { name: 'Canvas', exact: true }).click(); await page.getByLabel('Select and move', { exact: true }).click(); await settled() }
async function save() { const before = await page.evaluate(() => window.__columnBackend.calls.length); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForFunction((before) => window.__columnBackend.calls.slice(before).some((call) => call.command === 'save_json' && call.args.relativePath.endsWith('/project.json')), before); return page.evaluate(() => structuredClone(window.__columnBackend.project)) }
async function screenshot(name) { await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true }); report.screenshots.push(`${name}.png`) }
async function choose(id, additive = false) {
  const item = byId(id); await item.waitFor()
  const point = await item.evaluate((item, id) => {
    for (const handle of item.querySelectorAll('.node-drag-handle')) { const bounds = handle.getBoundingClientRect(); for (const fraction of [.1, .25, .5, .75, .9]) { const point = { x: bounds.x + bounds.width * fraction, y: bounds.y + bounds.height / 2 }; if (document.elementFromPoint(point.x, point.y)?.closest('.board-node')?.getAttribute('data-node-id') === id) return point } }
    const bounds = item.getBoundingClientRect(); for (const fraction of [.15, .35, .65, .85]) { const point = { x: bounds.x + bounds.width * fraction, y: bounds.y + bounds.height * fraction }; if (document.elementFromPoint(point.x, point.y)?.closest('.board-node')?.getAttribute('data-node-id') === id) return point }
    return null
  }, id)
  assert(point, `No unobscured real pointer surface for ${id}`)
  if (additive) await page.keyboard.down('Shift'); await page.mouse.click(point.x, point.y); if (additive) await page.keyboard.up('Shift'); await settled()
  assert(await item.evaluate((item) => item.classList.contains('selected')), `Pointer did not select ${id}`)
  return point
}
async function drop(id, targetId, { index = 'bottom', mixedLeaf } = {}) {
  const point = await choose(id)
  if (mixedLeaf) await choose(mixedLeaf, true)
  const target = await byId(targetId).boundingBox(); assert(target)
  const targetPoint = { x: target.x + target.width * .6, y: target.y + (index === 'top' ? 85 : Math.max(85, target.height - 22)) }
  await page.keyboard.down('Alt'); await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 14 }); await page.mouse.up(); await page.keyboard.up('Alt'); await settled()
}
async function undo() { await page.getByLabel('Undo board change', { exact: true }).click(); await settled() }
async function headerState(id) { return byId(id).evaluate((item) => { const header = item.querySelector('.node-drag-handle'), bounds = header.getBoundingClientRect(); return { topHitId: document.elementFromPoint(bounds.x + bounds.width * .4, bounds.y + bounds.height / 2)?.closest('.board-node')?.getAttribute('data-node-id'), top: bounds.top, bottom: bounds.bottom, zIndex: Number(getComputedStyle(item).zIndex) } }) }
async function scenario(name, run) { const first = report.checks.length; try { await boot(); await run(); report.scenarios.push({ name, passed: true, checks: report.checks.length - first }) } catch (error) { report.scenarios.push({ name, passed: false, error: error.message, stack: error.stack }); if (page) await screenshot(`failure-${name}`) } finally { await context?.close() } }

try {
  await scenario('grouped-leaf-drop', async () => {
    const before = await save(); await drop('group-leaf', 'dest'); const after = await save(), leaf = get(after, 'group-leaf')
    check('Actual grouped leaf drop creates exclusive column ownership', leaf.parentColumnId === 'dest' && !leaf.groupId, leaf)
    check('Leaf drop preserves source frame dimensions and unrelated locked subtree', get(after, 'outer').width === get(before, 'outer').width && get(after, 'outer').height === get(before, 'outer').height && hash(get(after, 'locked-dest')) === hash(get(before, 'locked-dest')) && hash(get(after, 'locked-row')) === hash(get(before, 'locked-row')))
    check('Target column rows have stable unique orders', board(after).nodes.filter((entry) => entry.parentColumnId === 'dest').map((entry) => entry.columnOrder).sort().join(',') === '0,1')
    await screenshot('01-grouped-leaf-column-drop'); await undo(); check('Grouped leaf drop Undo restores exact ownership/geometry/routes', hash(semantic(await save())) === hash(semantic(before)))
  })
  await scenario('nested-container-drop-and-reload', async () => {
    const before = await save(); await drop('outer', 'dest', { mixedLeaf: 'group-leaf' }); const after = await save(), moved = { x: get(after, 'outer').x - get(before, 'outer').x, y: get(after, 'outer').y - get(before, 'outer').y }
    check('Mixed parent-plus-leaf drop inserts only the top requested frame', get(after, 'outer').parentColumnId === 'dest' && get(after, 'group-leaf').groupId === 'outer' && !get(after, 'group-leaf').parentColumnId && get(after, 'inner-column').groupId === 'outer')
    for (const id of ['outer', 'inner-column', 'inner-row', 'group-leaf']) check(`Actual column reflow translates ${id} once and retains size`, get(after, id).x === get(before, id).x + moved.x && get(after, id).y === get(before, id).y + moved.y && get(after, id).width === get(before, id).width && get(after, id).height === get(before, id).height, { before: get(before, id), after: get(after, id), moved })
    const beforeEdges = board(before).connectors, afterEdges = board(after).connectors
    for (const id of ['internal-route', 'internal-free']) { const old = beforeEdges.find((entry) => entry.id === id), next = afterEdges.find((entry) => entry.id === id); check(`${id} follows descendant translation`, hash(next.bendPoints) === hash(old.bendPoints.map((point) => ({ ...point, x: point.x + moved.x, y: point.y + moved.y }))) && (!old.targetPoint || hash(next.targetPoint) === hash({ x: old.targetPoint.x + moved.x, y: old.targetPoint.y + moved.y }))) }
    check('Boundary route remains fixed-world during reflow', hash(afterEdges.find((entry) => entry.id === 'boundary').bendPoints) === hash(beforeEdges.find((entry) => entry.id === 'boundary').bendPoints))
    const hostHeader = await headerState('dest'), frameHeader = await headerState('outer'), nestedHeader = await headerState('inner-column'), precedingRow = await byId('dest-row').boundingBox()
    check('Dropped frame label remains visibly hit-testable above its owning column', frameHeader.topHitId === 'outer' && frameHeader.zIndex > hostHeader.zIndex, { hostHeader, frameHeader })
    check('Nested column header remains visibly hit-testable above frame and host backgrounds', nestedHeader.topHitId === 'inner-column' && nestedHeader.zIndex > frameHeader.zIndex, { frameHeader, nestedHeader })
    check('Dropped frame label has clear vertical space after the preceding row', frameHeader.top >= precedingRow.y + precedingRow.height + 6, { frameHeader, precedingRow })
    await screenshot('02-nested-frame-column-drop'); await undo(); check('Nested frame drop Undo restores exact snapshot in one step', hash(semantic(await save())) === hash(semantic(before)))
    await drop('outer', 'dest'); const saved = await save(); await page.reload({ waitUntil: 'domcontentloaded' }); await enter(); check('Saved nested drop survives full React reload with unchanged IDs/ownership/routes', hash(semantic(await save())) === hash(semantic(saved)))
    check('Reload retains unobscured nested container headers', (await headerState('outer')).topHitId === 'outer' && (await headerState('inner-column')).topHitId === 'inner-column')
  })
  await scenario('locked-destination-rollback', async () => {
    const before = await save(); await drop('src-row', 'locked-dest'); const after = await save()
    check('Drop on visible locked destination restores complete gesture baseline', hash(semantic(after)) === hash(semantic(before)), { before: get(before, 'src-row'), after: get(after, 'src-row') })
    check('Refused locked drop retains original source-column membership', get(after, 'src-row').parentColumnId === 'src')
    await screenshot('03-locked-column-drop-refused')
  })
  await scenario('descendant-column-cycle-rollback', async () => {
    const before = await save(); await drop('outer', 'inner-column'); const after = await save()
    check('Frame drop onto owned descendant column refuses cycle and restores baseline', hash(semantic(after)) === hash(semantic(before)), { before: get(before, 'outer'), after: get(after, 'outer') })
    check('Cycle refusal retains exclusive original nested ownership', !get(after, 'outer').parentColumnId && get(after, 'inner-column').groupId === 'outer')
    await screenshot('04-column-cycle-refused')
  })
} finally {
  report.sourceHashesAtEnd = {}
  for (const path of Object.keys(report.sourceHashes)) report.sourceHashesAtEnd[path] = createHash('sha256').update(await readFile(resolve(path))).digest('hex')
  report.sourceChangedDuringRun = hash(report.sourceHashes) !== hash(report.sourceHashesAtEnd)
  report.passed = report.scenarios.length === 4 && report.scenarios.every((entry) => entry.passed) && report.browserErrors.length === 0 && !report.sourceChangedDuringRun
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, passedChecks: report.checks.filter((entry) => entry.passed).length, scenarios: report.scenarios.map(({ name, passed, error }) => ({ name, passed, error })), browserErrors: report.browserErrors, sourceChangedDuringRun: report.sourceChangedDuringRun, report: resolve(artifacts, 'report.json') }, null, 2))
  await browser.close(); if (!report.passed) process.exitCode = 1
}
