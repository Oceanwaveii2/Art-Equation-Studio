import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const compile = async (relative) => ts.transpileModule(await readFile(new URL(relative, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const load = (code) => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const { createBlankProject } = await load(await compile('../src/model/project.ts'))
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-board-export/' + new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'))
await mkdir(artifacts, { recursive: true })
const report = { generatedAt: new Date().toISOString(), passed: false, baseUrl, checks: [], sourceHashes: {}, browserErrors: [], alerts: [], artifacts: [], limitation: 'Actual React board-export PNG actions and generated SVG/raster pixels in isolated headless Edge. Save/export dialogs and binary writes are captured in fixture memory. No host file, clipboard, real native dialog, native Vello pixel, physical DPI or disk restart proof.' }
for (const name of ['src/App.tsx', 'src/App.css', 'src/model/project.ts', 'src/board/boardVisualExport.ts', 'src/board/diagramStructureCore.ts', 'src/board/connectors.ts', 'src/board/arrangement.ts', 'src/model/vector.ts', 'src/board/vectorSvg.ts', 'src/board/researchExport.ts']) report.sourceHashes[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } }), page = await context.newPage()
report.browserVersion = browser.version()
page.on('pageerror', (error) => report.browserErrors.push(error.message))
page.on('dialog', async (dialog) => { report.alerts.push(dialog.message()); await dialog.accept() })
const portrait = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 50; canvas.height = 100; const c = canvas.getContext('2d'); c.fillStyle = '#00ffff'; c.fillRect(0, 0, 50, 100); return canvas.toDataURL('image/png') })
const node = (id, kind, x, y, width, height, extra = {}) => ({ id, title: id, kind, x, y, width, height, color: '#303030', strokeColor: '#303030', strokeWidth: 0, opacity: 1, ...extra })
const edge = (id, extra) => ({ id, sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#e09020', width: 4, dashed: false, startArrow: true, endArrow: true, animated: false, label: id, ...extra })
const fixture = createBlankProject('Part II isolated full board export QA')
fixture.id = 'partii-board-export-memory'
fixture.assets = []
fixture.boards = [{ id: 'export-root', title: 'Board export root', linkedFolderPath: 'projects/' + fixture.id + '/boards/export-root', backgroundColor: '#101010', backgroundFollowsTheme: false, gridVisible: false, viewport: { x: 0, y: 0, scale: 1 }, nodes: [
  node('owned-red', 'shape', 200, 180, 140, 100, { shapeType: 'rectangle', groupId: 'frame-high-layer', zIndex: -999, color: '#ff0000', strokeColor: '#ff0000', cornerRadius: 0 }),
  node('hidden-secret', 'note', 240, 220, 100, 60, { groupId: 'frame-high-layer', hidden: true, title: 'HIDDEN_SECRET_TOKEN' }),
  node('frame-high-layer', 'group', 120, 90, 420, 330, { containerRole: 'frame', zIndex: 900, title: 'VISIBLE_FRAME', color: '#001080', strokeColor: '#001080' }),
  node('rotated-note', 'note', 720, 130, 200, 120, { title: 'ROTATED_NOTE', body: 'BODY_LONG_TOKEN '.repeat(30), color: '#ff0000', strokeColor: '#ff0000', rotation: 30, opacity: .4 }),
  node('portrait-image', 'image', 1000, 150, 120, 180, { body: portrait, imagePresentation: 'artwork', opacity: .5, imageTransform: { opacity: .6, fit: 'contain' } }),
  node('tree-root', 'note', 720, 400, 150, 100, { title: 'VISIBLE_TREE', mindMap: { version: 1, treeId: 'export-tree', order: 0, collapsed: true } }),
  node('tree-child', 'note', 900, 450, 120, 80, { title: 'COLLAPSED_SECRET_TOKEN', mindMap: { version: 1, treeId: 'export-tree', parentId: 'tree-root', order: 0 } }),
], connectors: [
  edge('tethered-visible', { sourceId: 'owned-red', targetPoint: { x: 1400, y: 760 }, bendPoints: [{ x: -420, y: -260 }, { x: 1400, y: -260 }], label: 'ROUTE <approved> & preserved', labelPosition: { t: .55, offsetX: 500, offsetY: -720 } }),
  edge('free-curve', { sourcePoint: { x: 1300, y: -300 }, targetPoint: { x: 1600, y: -220 }, style: 'curve', sourcePort: 'top', targetPort: 'bottom', label: 'FREE_CURVE_LABEL' }),
  edge('hidden-edge', { sourceId: 'hidden-secret', targetId: 'rotated-note', label: 'HIDDEN_EDGE_TOKEN' }),
  edge('tree-edge', { sourceId: 'tree-root', targetId: 'tree-child', mindMap: { version: 1, treeId: 'export-tree', childId: 'tree-child' }, label: 'COLLAPSED_EDGE_TOKEN' }),
] }]
await page.addInitScript((initial) => {
  const backend = { project: JSON.parse(sessionStorage.getItem('board-export-fixture') || 'null') || structuredClone(initial), calls: [], svgs: [], binaries: [] }
  window.__boardExportBackend = backend
  localStorage.setItem('art-equation.navigator', '0'); localStorage.setItem('art-equation.inspector', '0'); localStorage.setItem('art-equation.canvas-tools', '1'); localStorage.setItem('art-equation.view-mode', 'canvas')
  const create = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (blob) => { if (blob.type === 'image/svg+xml') blob.text().then((svg) => backend.svgs.push(svg)); return create(blob) }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('No host clipboard permitted') } } })
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (value) => value,
    invoke: async (command, args = {}) => {
      backend.calls.push({ command, args: structuredClone(args) })
      if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'board-export-qa', readOnly: false, lockOwned: true }
      if (command === 'list_projects') return [{ id: backend.project.id, title: backend.project.title, updatedAt: backend.project.updatedAt, boardCount: 1, assetCount: 0, status: backend.project.status }]
      if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? { schemaVersion: 5, theme: 'dark', viewMode: 'canvas', activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'export-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:export-root', viewMode: 'canvas' } } } : backend.project)
      if (command === 'save_json') { if (args.relativePath.endsWith('/project.json')) backend.project = structuredClone(args.value); return }
      if (command === 'plugin:dialog|save') return 'MEMORY-ONLY-EXPORT/' + args.options.defaultPath
      if (command === 'export_binary') { backend.binaries.push(structuredClone(args)); return { relativePath: args.destinationPath, bytesWritten: args.bytes.length, backupCreated: false } }
      if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten'].includes(command)) return
      if (['list_project_trash', 'list_trashed_projects', 'audit_assets'].includes(command)) return []
      if (['plugin:event|listen', 'plugin:window|scale_factor'].includes(command)) return 1
      if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
      if (command === 'mini_bridge_launch') return null
      throw Error('Isolated board export refuses ' + command)
    } }
}, fixture)
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), detail }); assert(passed, name + ': ' + JSON.stringify(detail)) }
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
const byId = (id) => page.locator('.board-node[data-node-id="' + id + '"]')
async function saveFixture() {
  const before = await page.evaluate(() => window.__boardExportBackend.calls.length)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction((before) => window.__boardExportBackend.calls.slice(before).some((call) => call.command === 'save_json' && call.args.relativePath.endsWith('/project.json')), before)
  return page.evaluate(() => structuredClone(window.__boardExportBackend.project))
}
async function select(id) {
  const point = await byId(id).evaluate((item, id) => {
    for (const handle of item.querySelectorAll('.node-drag-handle')) {
      const b = handle.getBoundingClientRect()
      for (const t of [.1, .2, .5, .8]) { const p = { x: b.x + b.width * t, y: b.y + b.height / 2 }; if (document.elementFromPoint(p.x, p.y)?.closest('.board-node')?.getAttribute('data-node-id') === id) return p }
    }
    const b = item.getBoundingClientRect()
    for (const fraction of [.5, .35, .65, .2, .8]) {
      const p = { x: b.x + b.width * fraction, y: b.y + b.height * fraction }
      if (document.elementFromPoint(p.x, p.y)?.closest('.board-node')?.getAttribute('data-node-id') === id) return p
    }
    return null
  }, id)
  assert(point, 'No actual pointer surface for ' + id)
  await page.mouse.click(point.x, point.y); await settled()
  assert(await byId(id).evaluate((item) => item.classList.contains('selected')), 'Pointer did not select ' + id)
}
async function exportTarget(target, name) {
  await page.getByLabel('More canvas tools', { exact: true }).click()
  await page.getByLabel('Export board', { exact: true }).click()
  await page.getByLabel('Board export source', { exact: true }).selectOption(target)
  await page.getByLabel('Board export format', { exact: true }).selectOption('png')
  await page.getByLabel('Board export scale', { exact: true }).selectOption('1')
  const before = await page.evaluate(() => window.__boardExportBackend.binaries.length)
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  await page.waitForFunction((before) => window.__boardExportBackend.binaries.length > before, before)
  const result = await page.evaluate(() => ({ svg: window.__boardExportBackend.svgs.at(-1), binary: window.__boardExportBackend.binaries.at(-1) }))
  await writeFile(resolve(artifacts, name + '.svg'), result.svg, { flag: 'wx' })
  await writeFile(resolve(artifacts, name + '.png'), new Uint8Array(result.binary.bytes), { flag: 'wx' })
  report.artifacts.push(name + '.svg', name + '.png')
  return result
}
async function inspect(svg) {
  return page.evaluate((svg) => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'), root = doc.documentElement
    const title = (value) => [...doc.querySelectorAll('text')].find((text) => text.textContent === value)
    const object = (element) => { const parents = []; for (let p = element; p && p !== root; p = p.parentElement) parents.push({ tag: p.tagName, transform: p.getAttribute('transform'), opacity: p.getAttribute('opacity'), clip: p.getAttribute('clip-path') }); return parents }
    const note = title('ROTATED_NOTE'), image = doc.querySelector('image')
    return { parseError: doc.querySelector('parsererror')?.textContent, viewBox: root.getAttribute('viewBox').split(/\s+/).map(Number), text: doc.documentElement.textContent, owned: doc.querySelector('rect[fill="#ff0000"]')?.outerHTML, noteAncestors: object(note), imageAncestors: object(image), rotatedMarkup: note?.parentElement?.outerHTML, clippedGroups: [...doc.querySelectorAll('g[clip-path]')].map((g) => g.outerHTML), labels: [...doc.querySelectorAll('text')].map((text) => text.textContent), elementSequence: [...root.querySelectorAll('rect,text')].map((item) => ({ tag: item.tagName, text: item.textContent, fill: item.getAttribute('fill'), x: item.getAttribute('x'), y: item.getAttribute('y') })), connectorPaths: [...doc.querySelectorAll('path[stroke="#e09020"]')].map((p) => p.outerHTML) }
  }, svg)
}
async function pixels(svg, samples, binary) {
  return page.evaluate(async ({ svg, samples, bytes }) => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'), v = doc.documentElement.getAttribute('viewBox').split(/\s+/).map(Number)
    const img = new Image(), ready = new Promise((done, reject) => { img.onload = done; img.onerror = reject })
    img.src = bytes ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' })) : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await ready
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const c = canvas.getContext('2d'); c.drawImage(img, 0, 0)
    return Object.fromEntries(Object.entries(samples).map(([key, point]) => [key, [...c.getImageData(Math.round((point.x - v[0]) * img.width / v[2]), Math.round((point.y - v[1]) * img.height / v[3]), 1, 1).data]]))
  }, { svg, samples, bytes: binary?.bytes })
}
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  const enter = page.getByRole('button', { name: 'Enter now', exact: true }); if (await enter.count()) await enter.click()
  await byId('frame-high-layer').waitFor(); await page.getByRole('button', { name: 'Canvas', exact: true }).click(); await page.getByLabel('Select and move', { exact: true }).click(); await settled()
  const before = await saveFixture(), content = (project) => JSON.stringify({ nodes: project.boards[0].nodes, connectors: project.boards[0].connectors, assets: project.assets })
  check('Actual board hides hidden/collapsed descendants before export', await byId('hidden-secret').count() === 0 && await byId('tree-child').count() === 0)
  const full = await exportTarget('full', '01-full'), fullParsed = await inspect(full.svg)
  report.full = fullParsed
  check('Full action emits standalone SVG and actual PNG signature into fixture memory', !fullParsed.parseError && JSON.stringify(full.binary.bytes.slice(0, 8)) === '[137,80,78,71,13,10,26,10]' && full.binary.destinationPath.startsWith('MEMORY-ONLY-EXPORT/'))
  check('Full export suppresses hidden and collapsed nodes plus semantic/ordinary edges', !full.svg.includes('HIDDEN_SECRET_TOKEN') && !full.svg.includes('COLLAPSED_SECRET_TOKEN') && !full.svg.includes('HIDDEN_EDGE_TOKEN') && !full.svg.includes('COLLAPSED_EDGE_TOKEN'))
  const frameIndex = fullParsed.elementSequence.findIndex((item) => item.text === 'VISIBLE_FRAME'), childIndex = fullParsed.elementSequence.findIndex((item) => item.fill === '#ff0000' && item.x === '200')
  check('Container paints before child despite source array order and conflicting zIndex', frameIndex >= 0 && childIndex > frameIndex, { frameIndex, childIndex })
  const ownedPixels = await pixels(full.svg, { child: { x: 270, y: 240 } }, full.binary)
  check('Exported PNG/SVG red child remains opaque above its container', ownedPixels.child[0] >= 250 && ownedPixels.child[1] <= 2 && ownedPixels.child[2] <= 2 && ownedPixels.child[3] === 255, ownedPixels)
  check('Full bounds include remote bend/free endpoint and long offset label with both colored arrows', fullParsed.viewBox[0] < -450 && fullParsed.viewBox[1] < -900 && fullParsed.viewBox[0] + fullParsed.viewBox[2] > 1620 && fullParsed.connectorPaths.length === 2 && fullParsed.connectorPaths.every((path) => path.includes('marker-start=') && path.includes('marker-end=')) && fullParsed.labels.includes('ROUTE <approved> & preserved') && fullParsed.labels.includes('FREE_CURVE_LABEL'), fullParsed.viewBox)
  const noteAlpha = fullParsed.noteAncestors.reduce((value, ancestor) => value * Number(ancestor.opacity ?? 1), 1)
  check('Generic note title/body/stroke share 30 degree rotation and .4 object alpha once', fullParsed.noteAncestors.some((ancestor) => ancestor.transform?.includes('rotate(30')) && Math.abs(noteAlpha - .4) < 1e-9, fullParsed.noteAncestors)
  check('Generic overflowing text is clipped to its own card without clipping members', fullParsed.noteAncestors.some((ancestor) => ancestor.clip) && fullParsed.rotatedMarkup.includes('BODY_LONG_TOKEN'), fullParsed.noteAncestors)
  await select('frame-high-layer')
  const selected = await exportTarget('selection', '02-selection'), selectedParsed = await inspect(selected.svg)
  report.selection = selectedParsed
  check('Selection expands frame descendants at original world coordinates and keeps tethered route', selected.svg.includes('x="200" y="180"') && selectedParsed.labels.includes('VISIBLE_FRAME') && selectedParsed.connectorPaths.length === 1 && selectedParsed.labels.includes('ROUTE <approved> & preserved') && !selectedParsed.labels.includes('ROTATED_NOTE') && !selectedParsed.labels.includes('FREE_CURVE_LABEL') && !selected.svg.includes('HIDDEN_SECRET_TOKEN'))
  const frame = await exportTarget('frame', '03-frame'), frameParsed = await inspect(frame.svg)
  check('Frame region retains non-clipping members/routes with zero region padding', frameParsed.connectorPaths.length === 1 && frameParsed.viewBox[2] < selectedParsed.viewBox[2] && frameParsed.viewBox[3] < selectedParsed.viewBox[3] && frame.svg.includes('x="200" y="180"'), { selected: selectedParsed.viewBox, frame: frameParsed.viewBox })
  await select('rotated-note')
  const noteExport = await exportTarget('selection', '04-note-selection')
  const notePixel = await pixels(noteExport.svg, { center: { x: 820, y: 210 } }, noteExport.binary)
  check('Generic note selection raster applies .4 alpha to opaque fill once', Math.abs(notePixel.center[3] - 102) <= 2 && notePixel.center[0] >= 245 && notePixel.center[1] <= 3, notePixel)
  await select('portrait-image')
  const imageExport = await exportTarget('selection', '05-image-selection')
  const imagePixel = await pixels(imageExport.svg, { center: { x: 1060, y: 240 } }, imageExport.binary)
  check('Image selection raster multiplies .5 object and .6 image opacity once', Math.abs(imagePixel.center[3] - 77) <= 2 && imagePixel.center[0] <= 3 && imagePixel.center[1] >= 245 && imagePixel.center[2] >= 245, imagePixel)
  const stage = await page.locator('.canvas-stage').boundingBox()
  const viewport = await exportTarget('viewport', '06-viewport'), viewportParsed = await inspect(viewport.svg)
  check('Viewport export uses exact current camera crop, omitting hidden/collapsed artwork', Math.abs(viewportParsed.viewBox[2] - stage.width) <= 1 && Math.abs(viewportParsed.viewBox[3] - stage.height) <= 1 && !viewport.svg.includes('HIDDEN_SECRET_TOKEN') && !viewport.svg.includes('COLLAPSED_SECRET_TOKEN'), { stage, viewBox: viewportParsed.viewBox })
  const after = await saveFixture()
  check('Every export leaves original nodes/routes/assets byte-for-byte unchanged', content(after) === content(before))
  const calls = await page.evaluate(() => window.__boardExportBackend.calls)
  check('Native dialog and binary export are intercepted; no host project/source/delete/import write permitted', calls.filter((call) => call.command === 'export_binary').length === 6 && calls.filter((call) => call.command === 'plugin:dialog|save').length === 6 && !calls.some((call) => ['import_file', 'delete_file', 'trash_nodes', 'write_asset_bytes'].includes(call.command)))
  check('Actual board export actions raise no browser errors or alerts', !report.browserErrors.length && !report.alerts.length, { errors: report.browserErrors, alerts: report.alerts })
  const warningFixture = structuredClone(before)
  warningFixture.boards[0].nodes.push(
    node('missing-reference', 'image', 1100, 470, 180, 130, { title: 'MISSING_IMAGE_REFERENCE', assetId: 'absent-original-record' }),
    ...['video', 'model', 'document', 'clip'].map((kind, index) => node('summary-' + kind, kind, 680 + index * 140, 660, 120, 100, { title: 'SUMMARY_' + kind.toUpperCase(), body: 'Referenced original remains untouched' })),
    node('child-portal', 'board-link', 140, 470, 160, 120, { title: 'OWNED_CHILD_REFERENCE', targetBoardId: 'owned-child', boardLinkRole: 'child', boardPortal: true }),
  )
  warningFixture.boards.push({ id: 'owned-child', title: 'Separate child research', parentBoardId: 'export-root', viewport: { x: 0, y: 0, scale: 1 }, nodes: [node('child-note', 'note', 0, 0, 100, 100, { title: 'CHILD_CONTENT_MUST_NOT_EXPORT' })], connectors: [] })
  await page.evaluate((project) => sessionStorage.setItem('board-export-fixture', JSON.stringify(project)), warningFixture)
  await page.reload({ waitUntil: 'domcontentloaded' }); await byId('missing-reference').waitFor(); await settled()
  const warningBefore = await saveFixture(), warningAlertsBefore = report.alerts.length
  check('Missing image retains its named placeholder and source identity in actual App', (await byId('missing-reference').textContent()).includes('MISSING_IMAGE_REFERENCE') && warningBefore.boards[0].nodes.find((item) => item.id === 'missing-reference').assetId === 'absent-original-record')
  await page.getByLabel('More canvas tools', { exact: true }).click(); await page.getByLabel('Export board', { exact: true }).click(); await page.getByLabel('Board export source', { exact: true }).selectOption('full'); await settled()
  const contract = await page.locator('.board-export-contract').textContent(), details = await page.locator('.board-export-warnings').textContent()
  report.warningDetails = { contract, details }
  check('Current board/subboards separate/previews and originals scope is visible before export', contract.includes('Current board') && contract.includes('Subboards require separate exports') && contract.includes('rendered previews') && contract.includes('original files are not bundled'), contract)
  check('Missing catalog record and every unsupported media treatment are named in actual preflight', details.includes('MISSING_IMAGE_REFERENCE') && details.includes('asset record') && ['VIDEO', 'MODEL', 'DOCUMENT', 'CLIP'].every((kind) => details.includes('SUMMARY_' + kind)) && details.includes('summary card') && details.includes('not embedded'), details)
  const warningBackendBefore = await page.evaluate(() => ({ binaries: window.__boardExportBackend.binaries.length, dialogs: window.__boardExportBackend.calls.filter((call) => call.command === 'plugin:dialog|save').length }))
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  const refusalDialog = page.getByRole('dialog', { name: 'Action could not finish', exact: true })
  await refusalDialog.waitFor()
  const refusalMessage = await refusalDialog.textContent()
  report.refusalMessage = refusalMessage
  check('Missing image refuses before native save/binary calls; no incomplete artifact is saved', refusalMessage.includes('MISSING_IMAGE_REFERENCE') && refusalMessage.includes('no incomplete export was saved') && await page.evaluate((before) => window.__boardExportBackend.binaries.length === before.binaries && window.__boardExportBackend.calls.filter((call) => call.command === 'plugin:dialog|save').length === before.dialogs, warningBackendBefore), refusalMessage)
  await refusalDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByLabel('Close board export', { exact: true }).click(); await select('frame-high-layer')
  await page.getByLabel('More canvas tools', { exact: true }).click(); await page.getByLabel('Export board', { exact: true }).click(); await page.getByLabel('Board export source', { exact: true }).selectOption('selection'); await settled()
  const selectedDetails = await page.locator('.board-export-warnings').textContent()
  check('Selected region filters unrelated missing media and summary warnings', !selectedDetails.includes('MISSING_IMAGE_REFERENCE') && !selectedDetails.includes('SUMMARY_VIDEO') && !selectedDetails.includes('SUMMARY_MODEL') && !selectedDetails.includes('SUMMARY_DOCUMENT') && !selectedDetails.includes('SUMMARY_CLIP'), selectedDetails)
  await page.getByLabel('Close board export', { exact: true }).click()
  const warningAfter = await saveFixture()
  check('Missing-media refusal and region review preserve complete source graph/assets', content(warningAfter) === content(warningBefore) && JSON.stringify(warningAfter.boards[1]) === JSON.stringify(warningBefore.boards[1]))
  check('Warning/refusal path raises only the expected missing-image notice and no browser errors', !report.browserErrors.length && report.alerts.length === warningAlertsBefore, { errors: report.browserErrors, alerts: report.alerts })

  const afterHashes = {}
  for (const name of Object.keys(report.sourceHashes)) afterHashes[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
  report.finalSourceHashes = afterHashes
  check('Ten product source fingerprints remain stable during actual App export pass', JSON.stringify(afterHashes) === JSON.stringify(report.sourceHashes))
  report.passed = report.checks.every((item) => item.passed)
} catch (error) { report.failure = String(error.stack || error); await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {}) }
finally { await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); await browser.close() }
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.filter((item) => item.passed).length, total: report.checks.length, artifacts }))
if (!report.passed) { console.error(report.failure); process.exitCode = 1 }
