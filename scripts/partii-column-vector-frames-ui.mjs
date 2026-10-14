import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const compile = async path => ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject } = await import(`data:text/javascript;base64,${Buffer.from(await compile('src/model/project.ts')).toString('base64')}`)
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const generatedAt = new Date().toISOString(), output = resolve('output/playwright/partii-column-vector-frames', generatedAt.replace(/[:.]/g, '-')); await mkdir(output, { recursive: true })
const inputs = ['src/App.tsx', 'src/App.css', 'src/model/project.ts', 'src/model/vector.ts', 'src/model/vectorBooleanGeometry.ts', 'src/board/vectorSvg.ts', 'src/board/columns.ts', 'src/board/diagramPaletteCommands.ts', 'src/board/DiagramPalette.tsx', 'src/board/DiagramPalette.css', 'src/board/diagramStructureCore.ts', 'src/board/boardMutationSafety.ts', 'scripts/partii-column-vector-frames-ui.mjs']
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
const report = { generatedAt, baseUrl, passed: false, scenarios: [], checks: [], browserErrors: [], sourceHashes: await hashes(), limitations: ['Actual headless Edge React UI with normal pointer/keyboard/menu input and disposable memory Tauri storage. Real OS clipboard, production disk, EXEs, native canvas/device pixels and screen-reader speech are preserved/unverified here. DOM SVG is rasterized independently through the browser image loader.'] }
const snapshot = value => JSON.stringify(value), rectangle = (id, left, top, right, bottom) => ({ version: 1, closed: true, points: [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y], index) => ({ id: `${id}-${index}`, x, y })) })
const shape = (id, x, y, extra = {}) => ({ id, kind: 'shape', shapeType: 'path', title: id, body: '', x, y, width: 160, height: 96, vectorPath: rectangle(id, 0, 0, 160, 96), color: '#60a5fa', strokeColor: '#b9d4e7', strokeWidth: 2, opacity: 1, ...extra })
function fixture(mode) {
  const project = createBlankProject('Disposable Part II diagram palette and column vectors'); project.id = 'diagram-column-memory-fixture'
  const nodes = mode === 'flow' ? [] : mode === 'insert' ? [shape('source', 200, 160, { diagramShape: 'process', title: 'Input', body: 'Input' }), shape('target', 1000, 480, { diagramShape: 'process', title: 'Output', body: 'Output' }), { id: 'unrelated', kind: 'note', title: 'Preserve', body: 'Unrelated locked object', x: 120, y: 650, width: 180, height: 110, locked: true }] : [shape('free-path', 160, 200), { id: 'dest', kind: 'column', title: 'Destination column', x: 650, y: 140, width: 260, height: 180 }, { id: 'unrelated', kind: 'note', title: 'Preserve', body: 'Unrelated locked object', x: 1050, y: 140, width: 180, height: 110, locked: true }]
  if (mode === 'boolean') { const operands = [rectangle('outer', 0, 0, 160, 96), rectangle('hole', 40, 24, 120, 72)]; nodes[0].vectorPath = operands[0]; nodes[0].vectorBoolean = { operation: 'subtract', operands, resolvedPaths: [operands[0], { ...operands[1], points: [...operands[1].points].reverse() }], fillRules: ['nonzero', 'nonzero'] } }
  const connectors = mode === 'insert' ? [{ id: 'existing-edge', sourceId: 'source', targetId: 'target', sourcePort: 'right', targetPort: 'left', sourcePortMode: 'fixed', targetPortMode: 'fixed', style: 'elbow', color: '#60a5fa', width: 2, dashed: false, linePattern: 'dot', startArrow: true, endArrow: true, animated: false, bendPoints: [{ x: 600, y: 208 }, { x: 600, y: 528 }], label: 'Review before publishing', labelPosition: { t: .62, offsetX: 8, offsetY: -20, extension: { keep: true } }, extension: { preserve: 7 } }] : []
  project.boards = [{ id: 'diagram-root', title: 'Diagram UI fixture', viewport: { x: 0, y: 0, scale: 1 }, backgroundColor: '#151a20', backgroundFollowsTheme: mode === 'flow', gridVisible: false, snapToGrid: false, nodes, connectors }]; return project
}
const board = project => project.boards.find(item => item.id === 'diagram-root'), semantic = project => ({ nodes: board(project).nodes, connectors: board(project).connectors }), get = (project, id) => board(project).nodes.find(node => node.id === id)
const check = (name, condition, detail) => { report.checks.push({ name, passed: Boolean(condition), ...(detail !== undefined ? { detail } : {}) }); assert(condition, name) }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true }); report.browserVersion = browser.version()
let context, page
const byId = id => page.locator(`.board-node[data-node-id="${id}"]`), settled = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
async function enter() { const enter = page.getByRole('button', { name: 'Enter now', exact: true }); if (await enter.count()) await enter.click(); await page.locator('.canvas-stage').waitFor(); await page.getByRole('button', { name: 'Canvas', exact: true }).click(); await page.getByLabel('Select and move', { exact: true }).click(); await settled() }
async function boot(mode) {
  context = await browser.newContext({ viewport: { width: 1600, height: 1040 } }); page = await context.newPage(); page.on('pageerror', error => report.browserErrors.push(error.message))
  await page.addInitScript(initial => {
    const key = 'diagram-column-backend', backend = JSON.parse(sessionStorage.getItem(key) || 'null') || { project: structuredClone(initial), calls: [], clipboard: [] }, persist = () => sessionStorage.setItem(key, JSON.stringify(backend)); window.__diagramColumnBackend = backend
    localStorage.setItem('art-equation.navigator', '0'); localStorage.setItem('art-equation.inspector', '0'); localStorage.setItem('art-equation.canvas-tools', '1'); localStorage.setItem('art-equation.view-mode', 'canvas')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { backend.clipboard.push(text); persist() }, read: async () => [] } })
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: value => value, invoke: async (command, args = {}) => {
      backend.calls.push({ command, args: structuredClone(args) }); persist()
      if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'isolated-diagram-column-ui', readOnly: false, lockOwned: true }
      if (command === 'list_projects') return [{ id: backend.project.id, title: backend.project.title, updatedAt: backend.project.updatedAt, boardCount: 1, assetCount: 0, status: backend.project.status }]
      if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? { schemaVersion: 5, theme: 'dark', viewMode: 'canvas', activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'diagram-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:diagram-root', viewMode: 'canvas' } } } : backend.project)
      if (command === 'save_json') { if (args.relativePath.endsWith('/project.json')) { backend.project = structuredClone(args.value); persist() } return }
      if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten'].includes(command)) return
      if (['list_project_trash', 'list_trashed_projects', 'audit_assets'].includes(command)) return []
      if (['plugin:event|listen', 'plugin:window|scale_factor'].includes(command)) return 1
      if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
      if (command === 'mini_bridge_launch') return null
      throw new Error('Disposable diagram fixture refuses native command ' + command)
    } }
  }, fixture(mode))
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await enter()
}
async function save() { const before = await page.evaluate(() => window.__diagramColumnBackend.calls.length); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForFunction(before => window.__diagramColumnBackend.calls.slice(before).some(call => call.command === 'save_json' && call.args.relativePath.endsWith('/project.json')), before); return page.evaluate(() => structuredClone(window.__diagramColumnBackend.project)) }
async function choose(id) {
  const surface = () => byId(id).locator('.shape-hit-area').first().evaluate((path, id) => { for (const fraction of [.1, .18, .25, .32, .4, .6, .68, .75, .82, .9]) { const p = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM()); if (document.elementFromPoint(p.x, p.y)?.closest('.board-node')?.getAttribute('data-node-id') === id) return { x: p.x, y: p.y } } throw new Error('No unobscured path for ' + id) }, id)
  const point = await surface(); await page.mouse.click(point.x, point.y); await settled(); assert(await byId(id).evaluate(item => item.classList.contains('selected')), 'normal pointer selected ' + id)
  // Selection mounts transform controls outside the article. Recheck the actual
  // hit surface rather than starting a later drag/context menu on a new handle.
  return surface()
}
async function undo() { await page.getByLabel('Undo board change', { exact: true }).click(); await settled() }
async function redo() { await page.getByLabel('Redo board change', { exact: true }).click(); await settled() }
async function history(before, after, label) { await undo(); check(label + ' one Undo restores exact nodes/edges', snapshot(semantic(await save())) === snapshot(semantic(before))); await redo(); check(label + ' one Redo restores identical IDs/geometry', snapshot(semantic(await save())) === snapshot(semantic(after))) }
async function reload(after, label) { await page.reload({ waitUntil: 'domcontentloaded' }); await enter(); check(label + ' memory Save survives full React reload exactly', snapshot(semantic(await save())) === snapshot(semantic(after))) }
async function screenshot(name) { await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true }) }
async function palette(label, mode = 'create', keyboard = false) {
  if (mode === 'create') { await page.getByRole('button', { name: 'More canvas tools', exact: true }).click(); await page.getByRole('button', { name: 'Diagram shapes', exact: true }).click() }
  else await page.getByRole('button', { name: mode === 'successor' ? 'Add connected diagram shape' : 'Insert diagram shape on connection', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: mode === 'create' ? 'Diagram shapes' : mode === 'successor' ? 'Add a connected shape' : 'Insert a shape' }); await dialog.waitFor()
  if (keyboard) { await dialog.getByRole('searchbox', { name: 'Find a diagram shape' }).fill(label); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter') }
  else await dialog.getByRole('button', { name: label, exact: true }).click()
  await dialog.waitFor({ state: 'hidden' }); await settled()
}
async function copySvg(id) { const point = await choose(id), before = await page.evaluate(() => window.__diagramColumnBackend.clipboard.length); await page.mouse.click(point.x, point.y, { button: 'right' }); await page.getByRole('menu', { name: 'Canvas context menu' }).getByRole('menuitem', { name: 'Copy SVG', exact: true }).click(); await page.waitForFunction(before => window.__diagramColumnBackend.clipboard.length > before, before); return page.evaluate(() => window.__diagramColumnBackend.clipboard.at(-1)) }
async function pixels(node, name, exported = false) {
  const svg = exported ? await copySvg(node.id) : await byId(node.id).locator('.node-vector-shape').evaluate((element, node) => { const clone = element.cloneNode(true); clone.querySelectorAll('.shape-hit-area,.vector-segment-hit').forEach(item => item.remove()); return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width + 16}" height="${node.height + 16}" viewBox="${node.x - 8} ${node.y - 8} ${node.width + 16} ${node.height + 16}"><g transform="translate(${node.x} ${node.y})">${clone.innerHTML}</g></svg>` }, node)
  const probes = [[.125, .125], [.5, .5], [.875, .875], [1.05, .5]].map(([x, y]) => ({ x: node.x + node.width * x, y: node.y + node.height * y }))
  const raster = await page.evaluate(async ({ svg, probes }) => { const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement, view = root.getAttribute('viewBox').split(/\s+/).map(Number), image = new Image(), loaded = new Promise((done, reject) => { image.onload = done; image.onerror = reject }); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await loaded; const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return { alpha: probes.map(point => { const x = Math.round((point.x - view[0]) * image.width / view[2]), y = Math.round((point.y - view[1]) * image.height / view[3]); return x < 0 || y < 0 || x >= canvas.width || y >= canvas.height ? 0 : context.getImageData(x, y, 1, 1).data[3] }), png: canvas.toDataURL('image/png') } }, { svg, probes })
  await writeFile(resolve(output, name + '.svg'), svg); await writeFile(resolve(output, name + '.png'), Buffer.from(raster.png.split(',')[1], 'base64')); return raster.alpha
}
async function scenario(name, mode, run) { const before = report.checks.length; try { await boot(mode); await run(); report.scenarios.push({ name, passed: true, checks: report.checks.length - before }) } catch (error) { report.scenarios.push({ name, passed: false, error: error.message, stack: error.stack }); if (page) await screenshot('failure-' + name) } finally { await context?.close(); await writeFile(resolve(output, 'checkpoint.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.scenarios.at(-1))) } }
try {
  await scenario('ten-node-palette-connected-branching-flow', 'flow', async () => {
    const initial = await save(); await page.getByRole('button', { name: 'More canvas tools', exact: true }).click(); await page.getByRole('button', { name: 'Diagram shapes', exact: true }).click(); await page.keyboard.press('Escape'); await settled()
    check('Integrated palette Escape cancels without any board command', snapshot(semantic(await save())) === snapshot(semantic(initial)))
    const ids = []; let last = initial
    for (let index = 0; index < 10; index++) {
      if (index) { await page.getByRole('button', { name: 'Fit board', exact: true }).first().click(); await settled(); await choose(ids[Math.floor((index - 1) / 2)]) }
      const label = index === 0 ? 'Start / End' : index === 9 ? 'Document' : index % 3 === 0 ? 'Decision' : 'Process'
      await palette(label, index ? 'successor' : 'create', index % 2 === 0); await page.waitForFunction(count => document.querySelectorAll('.board-node').length === count, index + 1)
      const after = await save(), node = board(after).nodes.find(node => !ids.includes(node.id)); ids.push(node.id)
      check('Flow step ' + index + ' creates one tagged editable caption/path', Boolean(node.diagramShape) && node.vectorPath.closed && await byId(node.id).locator('.diagram-caption-svg text').count() > 0)
      if (index) { const edge = board(after).connectors.at(-1); check('Flow step ' + index + ' wires chosen parent and one fresh successor', edge.sourceId === ids[Math.floor((index - 1) / 2)] && edge.targetId === node.id && board(after).connectors.length === index) }
      await history(last, after, 'Flow step ' + index); last = after
    }
    check('Ten-node integrated branching flow has19 distinct saved identities', board(last).nodes.length === 10 && board(last).connectors.length === 9 && new Set([...board(last).nodes, ...board(last).connectors].map(item => item.id)).size === 19)
    await page.getByRole('button', { name: 'Fit board', exact: true }).first().click(); await settled(); await screenshot('ten-node-process-flow')
    const exported = await copySvg(ids[0]); check('Copy SVG includes the tagged start/end caption and editable path geometry', exported.includes('Start / End') && exported.includes('<path'))
    await writeFile(resolve(output, 'ten-node-map.json'), JSON.stringify(last, null, 2)); await reload(last, 'Ten-node map')
    await page.getByRole('button', { name: 'Use light theme', exact: true }).click(); await settled()
    for (const label of ['Text', 'Line', 'Arrow']) {
      const baseline = await save(); await palette(label, 'create', true); await page.waitForFunction(() => document.querySelectorAll('.board-node').length === 11); const after = await save(), node = board(after).nodes.find(node => !ids.includes(node.id))
      check('Integrated light palette creates ' + label + ' using the existing editable model', label === 'Text' ? node.kind === 'text' && node.body.includes('Text') : node.shapeType === label.toLowerCase())
      const colors = await byId(node.id).evaluate((element, label) => {
        const target = element.querySelector(label === 'Text' ? '.board-text-editor' : '.shape-arrow-base'), foreground = label === 'Text' ? getComputedStyle(target).color : getComputedStyle(target).stroke, background = getComputedStyle(label === 'Text' ? element.querySelector('.board-rich-text') : document.querySelector('.canvas-stage')).backgroundColor
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0), a = luminance(foreground), b = luminance(background)
        return { foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
      }, label)
      check('Palette ' + label + ' has sufficient contrast on its actual light surface', colors.ratio >= (label === 'Text' ? 4.5 : 3), colors)
      await history(baseline, after, 'Light palette ' + label); await undo(); check('Light palette ' + label + ' cleanup returns the ten-node map exactly', snapshot(semantic(await save())) === snapshot(semantic(baseline)))
    }
  })
  await scenario('insert-node-preserves-edge-identity-manual-route-world-label', 'insert', async () => {
    const before = await save(), old = board(before).connectors[0], label = await page.locator('[data-connector-id="existing-edge"] .connector-label').getAttribute('transform')
    const point = await page.locator('[data-connector-id="existing-edge"] .connector-hit').evaluate(path => { const p = path.getPointAtLength(path.getTotalLength() * .4).matrixTransform(path.getScreenCTM()); return { x: p.x, y: p.y } }); await page.mouse.click(point.x, point.y); await settled()
    await palette('Document', 'insert', true); await page.waitForFunction(() => document.querySelectorAll('.board-node').length === 4)
    const after = await save(), incoming = board(after).connectors.find(edge => edge.id === old.id), outgoing = board(after).connectors.find(edge => edge.id !== old.id), inserted = board(after).nodes.find(node => !board(before).nodes.some(old => old.id === node.id))
    check('Integrated insertion retains old incoming edge ID and fresh downstream identity', incoming.targetId === inserted.id && outgoing.sourceId === inserted.id && outgoing.id !== old.id && incoming.sourceId === old.sourceId && outgoing.targetId === old.targetId)
    check('Integrated insertion keeps outside arrows, manual route portions and relationship metadata', incoming.startArrow && !incoming.endArrow && !outgoing.startArrow && outgoing.endArrow && snapshot([...incoming.bendPoints, ...outgoing.bendPoints]) === snapshot(old.bendPoints) && snapshot(incoming.extension) === snapshot(old.extension) && snapshot(outgoing.extension) === snapshot(old.extension))
    check('Integrated insertion transfers original label/position metadata to incoming only', incoming.label === old.label && outgoing.label === undefined && snapshot(incoming.labelPosition.extension) === snapshot(old.labelPosition.extension))
    const nextLabel = await page.locator('[data-connector-id="existing-edge"] .connector-label').getAttribute('transform'), coords = value => value.match(/[-\d.]+/g).map(Number)
    check('Actual painted label remains at its previous world coordinates', Math.hypot(...coords(nextLabel).map((value, index) => value - coords(label)[index])) < 1e-6, { label, nextLabel })
    check('Insertion retains exact original nodes and locked outsider', board(before).nodes.every(node => snapshot(get(after, node.id)) === snapshot(node)))
    await history(before, after, 'Insert node'); await reload(after, 'Inserted route'); await screenshot('inserted-document-manual-relationship')
  })
  for (const mode of ['plain', 'boolean']) await scenario(mode + '-vector-pointer-column-drop-detach', mode, async () => {
    const before = await save(), original = get(before, 'free-path'), point = await choose('free-path'), target = await byId('dest').boundingBox()
    await page.keyboard.down('Alt'); await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(target.x + target.width * .6, target.y + 85, { steps: 14 }); await page.mouse.up(); await page.keyboard.up('Alt'); await settled(); const dropped = await save(), columnNode = get(dropped, 'free-path')
    check(mode + ' actual drop scales vector local geometry into240×144 column frame', columnNode.parentColumnId === 'dest' && columnNode.width === 240 && columnNode.height === 144 && Math.max(...columnNode.vectorPath.points.map(point => point.x)) === columnNode.width && Math.max(...columnNode.vectorPath.points.map(point => point.y)) === columnNode.height, columnNode)
    const expected = mode === 'boolean' ? [255, 0, 255, 0] : [255, 255, 255, 0]
    check(mode + ' dropped DOM raster aligns filled regions/hole with the saved frame', snapshot(await pixels(columnNode, mode + '-dropped-dom')) === snapshot(expected))
    check(mode + ' drop preserves exact locked outsider', snapshot(get(dropped, 'unrelated')) === snapshot(get(before, 'unrelated')))
    await history(before, dropped, mode + ' column drop'); await reload(dropped, mode + ' dropped path')
    const start = await choose('free-path'), stage = await page.locator('.canvas-stage').boundingBox()
    await page.keyboard.down('Alt'); await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(stage.x + 300, stage.y + 620, { steps: 14 }); await page.mouse.up(); await page.keyboard.up('Alt'); await settled(); const detached = await save(), free = get(detached, 'free-path')
    check(mode + ' actual detach restores160×96 frame and exclusive free ownership', !free.parentColumnId && !free.groupId && free.width === original.width && free.height === original.height && snapshot(free.vectorPath) === snapshot(original.vectorPath), free)
    if (mode === 'boolean') check('Boolean detach restores exact operands and resolved contours together', snapshot(free.vectorBoolean) === snapshot(original.vectorBoolean))
    check(mode + ' detached DOM raster fits free frame with matching geometry', snapshot(await pixels(free, mode + '-detached-dom')) === snapshot(expected))
    check(mode + ' Copy SVG raster matches the detached visible geometry', snapshot(await pixels(free, mode + '-detached-export', true)) === snapshot(expected))
    await history(dropped, detached, mode + ' detach'); await reload(detached, mode + ' detached path'); await screenshot(mode + '-detached-column-path')
    check(mode + ' reloaded DOM geometry remains correctly scaled', snapshot(await pixels(get(detached, 'free-path'), mode + '-reloaded-dom')) === snapshot(expected))
  })
} finally {
  report.sourceHashesAtEnd = await hashes(); report.sourceChangedDuringRun = snapshot(report.sourceHashes) !== snapshot(report.sourceHashesAtEnd)
  report.passed = report.scenarios.length === 4 && report.scenarios.every(scenario => scenario.passed) && report.browserErrors.length === 0 && !report.sourceChangedDuringRun
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, passedChecks: report.checks.filter(check => check.passed).length, scenarios: report.scenarios.map(({ name, passed, error }) => ({ name, passed, error })), browserErrors: report.browserErrors, sourceChangedDuringRun: report.sourceChangedDuringRun, output }, null, 2)); await browser.close(); if (!report.passed) process.exitCode = 1
}
