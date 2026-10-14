import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'
import ts from 'typescript'
import sharp from 'sharp'

// Entire compiled production App. Only the Tauri IPC transport is replaced by
// bounded disposable files. This establishes browser App/history/persistence;
// Rust IO, packaged WebView2, physical exhaustion and native input remain open.
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5184/'
const output = resolve(process.argv[2] || '../docs/engine-p0/2026-10-03/resource-acceptance/full-app-browser')
await mkdir(output, { recursive: false }) // Every test run requires a fresh target.
const workspace = resolve(output, 'disposable-workspace'); await mkdir(workspace)
// Run the actual read-only Windows font command body. Font payloads remain in
// private fixture storage; public reports retain only exact tuple/hash metadata.
const privateFontRoot = resolve('C:/Users/User/.codex/worktrees/2439/Art_Equation_Studio_2026-08-27_v81-combined-with-desktop-scope/tmp', 'p0-full-app-fonts-' + randomUUID()); await mkdir(privateFontRoot)
const fontResolver = resolve('../docs/engine-p0/2026-10-03/shaped-text/native-resolver-check/target/debug/ae-p0-native-font-resolver-check.exe')
const exec = promisify(execFile), fontCalls = new Map(), fontReceipts = []
async function resolveActualFont(request) {
  assert(request && typeof request.family === 'string' && request.family.length <= 200 && Number.isInteger(request.weight) && request.weight >= 100 && request.weight <= 1000 && typeof request.italic === 'boolean', 'Invalid exact font tuple')
  const key = JSON.stringify(request)
  if (fontCalls.has(key)) return fontCalls.get(key)
  const work = (async () => {
    const target = resolve(privateFontRoot, createHash('sha256').update(key).digest('hex') + '.json')
    try {
      await exec(fontResolver, [request.family, String(request.weight), String(request.italic), target], { maxBuffer: 100_000, windowsHide: true })
      const value = JSON.parse(await readFile(target, 'utf8'))
      fontReceipts.push({ request, status: 'resolved', family: value.family, faceIndex: value.faceIndex, contentHash: value.contentHash, bytes: Buffer.from(value.bytesBase64, 'base64').length, axes: value.axes })
      return value
    } catch (error) {
      if (String(error.stderr).includes('FONT_FAMILY_NOT_FOUND')) { fontReceipts.push({ request, status: 'FONT_FAMILY_NOT_FOUND' }); throw new Error('FONT_FAMILY_NOT_FOUND: ' + request.family) }
      throw error
    }
  })()
  fontCalls.set(key, work); return work
}
async function resolveActualFallbacks(request) {
  assert(request && Array.isArray(request.families) && request.families.length <= 16 && request.families.every(family => typeof family === 'string' && family.length <= 256) && typeof request.text === 'string' && request.text.length <= 32768 && Number.isInteger(request.weight) && typeof request.italic === 'boolean', 'Invalid native fallback tuple')
  const key = 'fallback:' + JSON.stringify(request)
  if (fontCalls.has(key)) return fontCalls.get(key)
  const work = (async () => {
    const prefix = resolve(privateFontRoot, createHash('sha256').update(key).digest('hex'))
    await writeFile(prefix + '.input.json', JSON.stringify(request))
    await exec(fontResolver, ['--fallbacks', prefix + '.input.json', prefix + '.output.json'], { maxBuffer: 100_000, windowsHide: true })
    const value = JSON.parse(await readFile(prefix + '.output.json', 'utf8'))
    fontReceipts.push({ status: 'native-fallbacks', families: request.families, weight: request.weight, italic: request.italic, textCodePoints: [...request.text].length, receipt: value }); return value
  })()
  fontCalls.set(key, work); return work
}
const compile = ts.transpileModule(await readFile('src/model/project.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject, DEFAULT_DOCUMENT_LAYOUT } = await import(`data:text/javascript;base64,${Buffer.from(compile).toString('base64')}`)
const project = createBlankProject('P0 full App disposable acceptance'); project.id = 'p0-full-app-fixture'
project.boards = [{ id: 'artwork', title: 'Empty artwork fixture', nodes: [], connectors: [], viewport: { x: 28, y: 28, scale: 1 }, gridVisible: false, linkedFolderPath: 'projects/p0-full-app-fixture/boards/artwork' }]
const workloadCount = Number(process.env.P0_APP_WORKLOAD || 0)
assert([0, 100, 1000, 5000, 20000].includes(workloadCount), 'Invalid bounded App workload')
if (workloadCount) project.boards.push({ id: 'workload', title: `P0 workload ${workloadCount}`, nodes: Array.from({ length: workloadCount }, (_, i) => ({ id: `workload-${i}`, kind: 'shape', shapeType: 'rectangle', x: (i % 40) * 300, y: Math.floor(i / 40) * 220, width: 150, height: 100, title: '', body: '', color: i % 2 ? '#7896b0' : '#6ba39b', strokeColor: '#d4ebff', strokeWidth: 2, cornerRadius: 4, opacity: 1 })), connectors: [], viewport: { x: 28, y: 28, scale: 1 }, gridVisible: false, linkedFolderPath: 'projects/p0-full-app-fixture/boards/workload' })
const mixedCards = process.env.P0_APP_MIXED_CARDS === '1'
const flowProbe=process.env.P0_APP_FLOW === '1'
const mixedProbeOnly = process.env.P0_APP_MIXED_PROBE === '1'||flowProbe; assert(!mixedProbeOnly || mixedCards||flowProbe)
if(flowProbe)project.boards.push({id:'flow',title:'P0 animated arrow fixture',nodes:[
 {id:'flow-live',kind:'shape',shapeType:'arrow',title:'',body:'',x:60,y:70,width:240,height:100,strokeColor:'#58c8c1',strokeWidth:3,opacity:1,arrowMotion:{enabled:true,speed:'normal',direction:'forward',style:'flow'}},
 {id:'flow-static',kind:'shape',shapeType:'arrow',title:'',body:'reverse',x:60,y:250,width:240,height:100,strokeColor:'#7896b0',strokeWidth:3,opacity:.8,arrowMotion:{enabled:false,speed:'normal',direction:'forward',style:'flow'}},
],connectors:[],viewport:{x:28,y:28,scale:1},gridVisible:false,linkedFolderPath:'projects/p0-full-app-fixture/boards/flow'})
const smallImage = process.env.P0_APP_SMALL_IMAGE === '1'
const mixedDeviceLoss = process.env.P0_APP_GPU_LOSS === '1'; assert(!mixedDeviceLoss || (mixedCards && !smallImage))
const rectangleMask = process.env.P0_APP_RECT_ERASE === '1'; assert(!rectangleMask || !mixedProbeOnly)
const imageReload = process.env.P0_APP_IMAGE_RELOAD === '1'; assert(!imageReload || (mixedCards && mixedProbeOnly && !smallImage))
let imageServer, imageServerVersion = 0, reloadImageSource
const imageRequests = []
if (rectangleMask) project.boards.push({ id: 'rect-mask', title: 'P0 rectangle mask fixture', nodes: [
  { id: 'mask-underlay', kind: 'shape', shapeType: 'rectangle', title: '', body: '', x: 80, y: 80, width: 300, height: 220, color: '#eb8050', strokeColor: '#d4ebff', strokeWidth: 2, cornerRadius: 14, opacity: 1 },
  { id: 'mask-top', kind: 'shape', shapeType: 'rectangle', title: '', body: '', x: 120, y: 100, width: 220, height: 150, color: '#6ba39b', strokeColor: '#d4ebff', strokeWidth: 4, cornerRadius: 14, opacity: .7 },
], connectors: [], viewport: { x: 28, y: 28, scale: 1 }, gridVisible: false, linkedFolderPath: 'projects/p0-full-app-fixture/boards/rect-mask' })
if (mixedCards) {
  const imageWidth = smallImage ? 64 : 1024, imageHeight = smallImage ? 32 : 512
  const raw = Buffer.alloc(imageWidth * imageHeight * 4)
  for (let i = 0; i < raw.length; i += 4) raw.set(i / 4 % imageWidth < imageWidth / 2 ? [0, 180, 200, 255] : [240, 80, 40, 255], i)
  const png = await sharp(raw, { raw: { width: imageWidth, height: imageHeight, channels: 4 } }).png().toBuffer()
  let imageSource = 'data:image/png;base64,' + png.toString('base64')
  if (imageReload) {
    const frames = [png]
    for (const color of [[180, 40, 220, 255], [220, 180, 20, 255]]) {
      const pixels = Buffer.from(raw)
      for (let i = 0; i < pixels.length; i += 4) if (i / 4 % imageWidth < imageWidth / 2) pixels.set(color, i)
      frames.push(await sharp(pixels, { raw: { width: imageWidth, height: imageHeight, channels: 4 } }).png().toBuffer())
    }
    imageServer = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/same-image.png') { response.writeHead(404); response.end(); return }
      imageRequests.push({ version: imageServerVersion, at: performance.now() })
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); response.end(frames[imageServerVersion])
    })
    await new Promise((done, fail) => { imageServer.once('error', fail); imageServer.listen(0, '127.0.0.1', done) })
    // A saved image body is an accepted data URL, not a remote asset. Exercise
    // the loopback reload through its mounted image provider after it loads.
    reloadImageSource = `http://127.0.0.1:${imageServer.address().port}/same-image.png`
  }
  project.boards.push({ id: 'mixed-cards', title: 'P0 mixed card fixture', nodes: [
    { id: 'mixed-note', kind: 'note', title: 'Measured note title', body: 'Actual note typography wraps within its measured content box. office affix café.', x: 50, y: 30, width: 270, height: 180, color: '#a58b64', opacity: 1 },
    { id: 'mixed-rich', kind: 'text', title: 'Actual rich text', body: '<p>Actual rich text typography wraps within its content box. office affix café.</p><p><strong>Styled bold stays editable.</strong></p>', x: 380, y: 30, width: 300, height: 190, color: '#a58b64', opacity: 1 },
    { id: 'mixed-image', kind: 'image', title: 'Static PNG framing', body: imageSource, x: 50, y: 270, width: 270, height: 200, color: '#6b8297', opacity: .8, imageTransform: { fit: 'contain' } },
    // Empty header columns have a canonical 150px height in board/columns.ts.
    { id: 'mixed-column', kind: 'column', title: 'Measured actual column', body: '', x: 380, y: 270, width: 300, height: 150, color: '#6ba39b', opacity: 1, columnPresentation: 'header' },
  ], connectors: [], viewport: { x: 28, y: 28, scale: 1 }, gridVisible: false, linkedFolderPath: 'projects/p0-full-app-fixture/boards/mixed-cards' })
}
project.documents = [{ id: 'doc', title: 'Document fixture', layout: DEFAULT_DOCUMENT_LAYOUT, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Disposable document input' }] }, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Actual document heading' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Actual body typography wraps within the measured page width. 日本語 العربية. ' .repeat(7) }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Final paragraph for history acceptance' }] }] } }]
const settings = { schemaVersion: 5, theme: 'dark', viewMode: 'canvas', splitRatio: 50, activeProjectId: project.id, canvasEnginePreference: 'generation-1', projectNavigation: { [project.id]: { activeBoardId: 'artwork', activeDocumentId: 'doc', activeNavigatorItem: 'board:artwork', viewMode: 'canvas' } } }
const events = [], checks = [], errors = [], unhandled = [], screenshots = []
const report = { schema: 'art-equation.full-app-browser-acceptance', generatedAt: new Date().toISOString(), passed: false, baseUrl, workspace, browser: '', checks, browserErrors: errors, unhandledIpc: unhandled, screenshots, limitations: ['Whole production App runs in an isolated headless browser with controlled disposable file-backed IPC. This is not the native Tauri process, native atomic IO, physical GPU exhaustion, Windows scaling, native IME or screen-reader acceptance.', 'Source/build identity belongs to this compiled snapshot; root engine work may continue separately.'] }
const inside = name => { if (typeof name !== 'string' || !name.trim() || isAbsolute(name)) throw new Error('Fixture path must be relative'); const target = resolve(workspace, name), rel = relative(workspace, target); if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Fixture path escapes isolated workspace'); return target }
let fileWork = Promise.resolve(), writeId = 0
function fileOperation(work) { const next = fileWork.then(work); fileWork = next.catch(() => {}); return next }
async function load(name) { return fileOperation(async () => JSON.parse(await readFile(inside(name), 'utf8'))) }
async function save(name, value) { return fileOperation(async () => { const target = inside(name); await mkdir(dirname(target), { recursive: true }); const temporary = target + '.writing-' + ++writeId; await writeFile(temporary, JSON.stringify(value)); await rename(temporary, target) }) }
await save('projects/' + project.id + '/project.json', project); await save('settings.json', settings)
const projectPath = 'projects/' + project.id + '/project.json'
async function invoke(command, args = {}) {
  events.push({ command, relativePath: args.relativePath, at: performance.now() })
  if (command === 'workspace_info') return { root: workspace, workspaceId: 'p0-headless-disposable', readOnly: false, lockOwned: true }
  if (command === 'load_json') return load(args.relativePath)
  if (command === 'save_json') { await save(args.relativePath, args.value); return { relativePath: args.relativePath, bytesWritten: JSON.stringify(args.value).length, backupCreated: false } }
  if (command === 'list_projects') { const current = await load(projectPath); return [{ id: current.id, title: current.title, updatedAt: current.updatedAt, boardCount: current.boards.length, assetCount: current.assets.length }] }
  if (command === 'list_trashed_projects' || command === 'list_project_trash' || command === 'audit_project_assets') return []
  if (command === 'mini_bridge_launch') return null
  if (command === 'project_b_preflight_context') return { enabled: false }
  if (command === 'list_system_fonts') return []
  if (command === 'resolve_system_font') return resolveActualFont(args.request)
  if (command === 'resolve_system_font_fallbacks') return resolveActualFallbacks(args.request)
  if (command === 'ensure_project_workspace') return
  if (command === 'ensure_managed_board_folders') { assert.equal(args.projectId, project.id); for (const id of args.boardIds) { assert(/^[a-zA-Z0-9_-]+$/.test(id)); await mkdir(inside(`projects/${project.id}/boards/${id}`), { recursive: true }) } return }
  if (command === 'plugin:window|scale_factor') return 1
  if (command === 'plugin:window|inner_size') return { width: 1440, height: 900 }
  if (command === 'plugin:event|listen') return events.length
  if (command === 'plugin:event|unlisten' || command === 'plugin:window|set_title' || command === 'record_frontend_diagnostic') return
  unhandled.push({ command, args }); throw new Error('Disposable IPC does not accept ' + command)
}
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
report.browser = await browser.version()
const deviceScaleFactor = Number(process.env.P0_APP_DPR || 1)
assert([1, 1.5, 2].includes(deviceScaleFactor), 'App browser DPR must be one of the acceptance values')
report.deviceScaleFactor = deviceScaleFactor
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor })
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
await page.exposeFunction('__p0TestInvoke', invoke)
await page.addInitScript(({ observeGpu }) => {
  let callbackId = 0
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: (command, args) => window.__p0TestInvoke(command, args), transformCallback: callback => { const id = ++callbackId; window['_' + id] = callback; return id }, unregisterCallback: id => { delete window['_' + id] } }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  if (observeGpu && navigator.gpu) {
    // Keep genuine browser adapters/devices; observe the actual acquisition in
    // this disposable page only so device.destroy can exercise full App loss.
    window.__p0ObservedGpuDevices = []
    const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu)
    navigator.gpu.requestAdapter = async (...args) => {
      const adapter = await requestAdapter(...args)
      if (adapter && !Object.hasOwn(adapter, '__p0Observed')) {
        Object.defineProperty(adapter, '__p0Observed', { value: true })
        const requestDevice = adapter.requestDevice.bind(adapter)
        adapter.requestDevice = async (...deviceArgs) => { const device = await requestDevice(...deviceArgs); window.__p0ObservedGpuDevices.push(device); return device }
      }
      return adapter
    }
  }
}, { observeGpu: mixedDeviceLoss })
async function check(name, run) { const started = performance.now(); await run(); (report.checkTimings ??= []).push({ name, durationMs: performance.now() - started }); checks.push(name); console.log('PASS ' + name) }
async function savedProject() { return load(projectPath) }
async function waitSaved(test) { const deadline = performance.now() + 6000; while (performance.now() < deadline) { const current = await savedProject(); if (test(current)) return current; await new Promise(resolve => setTimeout(resolve, 80)) } throw new Error('Disposable autosave did not reach the expected model') }
async function shot(name) { await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true }); screenshots.push(name + '.png') }
async function documentLayout() { return page.locator('.tiptap p, .tiptap h1, .tiptap h2').evaluateAll(nodes => nodes.slice(0, 12).map(node => { const s = getComputedStyle(node), r = node.getBoundingClientRect(); return { tag: node.tagName, text: node.textContent, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, fontStyle: s.fontStyle, lineHeight: s.lineHeight, whiteSpace: s.whiteSpace, wordBreak: s.wordBreak, textAlign: s.textAlign, letterSpacing: s.letterSpacing, padding: s.padding, margin: s.margin, color: s.color, width: r.width, height: r.height, left: r.left, top: r.top, fontCheck: document.fonts.check(`${s.fontWeight} ${s.fontSize} ${s.fontFamily}`) } })) }
async function draw(tool, x1, y1, x2, y2) { const rail = page.locator('.canvas-tool-rail'); const direct = rail.getByLabel(tool, { exact: true }); if (!await direct.count()) await rail.getByLabel('More canvas tools', { exact: true }).click(); await page.getByLabel(tool, { exact: true }).click(); const r = await page.locator('.canvas-stage').boundingBox(); assert(r); await page.mouse.move(r.x + x1, r.y + y1); await page.mouse.down(); await page.mouse.move(r.x + x2, r.y + y2, { steps: 8 }); await page.mouse.up(); await page.keyboard.press('Escape') }
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await page.locator('.boot-loader').waitFor({ state: 'hidden' }); await page.getByLabel('Search project', { exact: true }).waitFor(); await page.getByText('Empty artwork fixture', { exact: true }).first().waitFor(); await page.locator('.canvas-stage').waitFor(); await page.waitForFunction(() => document.querySelector('.canvas-stage') && document.querySelectorAll('.board-node').length === 0)
  if (!mixedProbeOnly) {
  await check('full production App loads disposable canonical project and empty board', async () => { assert(await page.locator('.studio-shell').isVisible()); assert.equal(await page.locator('.board-node').count(), 0); assert(events.some(e => e.command === 'workspace_info')); assert(events.some(e => e.command === 'load_json' && e.relativePath === projectPath)) })
  const rail = page.locator('.canvas-tool-rail')
  await check('persistent toolbar and Appearance are present in actual App', async () => { assert(await rail.isVisible()); for (const name of ['Select and move', 'Node tool', 'Type tool', 'Pen tool', 'Draw rectangle', 'Draw ellipse', 'Hand tool', 'Zoom tool', 'Undo board change', 'Redo board change']) assert(await rail.getByLabel(name, { exact: true }).isVisible()); assert(await page.getByRole('button', { name: 'Toggle Appearance panel' }).isVisible()) })
  await check('inspector tabs support roving keyboard focus and matching panels', async () => { const projectTab = page.locator('#inspector-tab-project'), docTab = page.locator('#inspector-tab-document'), selectionTab = page.locator('#inspector-tab-selection'); await projectTab.focus(); await page.keyboard.press('End'); assert.equal(await selectionTab.getAttribute('aria-selected'), 'true'); assert.equal(await selectionTab.evaluate(node => node === document.activeElement), true); assert(await page.locator('#inspector-panel-selection').isVisible()); await page.keyboard.press('Home'); assert.equal(await projectTab.getAttribute('aria-selected'), 'true'); await page.keyboard.press('ArrowRight'); assert.equal(await docTab.getAttribute('aria-selected'), 'true'); assert(await page.locator('#inspector-panel-document').isVisible()); await page.keyboard.press('ArrowLeft'); assert.equal(await projectTab.getAttribute('aria-selected'), 'true'); assert.equal(await page.locator('.inspector-dock-scopes [role="tab"][tabindex="0"]').count(), 1) })
  await page.getByRole('button', { name: 'Toggle Appearance panel' }).click(); await page.getByRole('dialog', { name: 'Appearance' }).waitFor()
  await check('Appearance opens and exposes canvas diagnostics', async () => assert(await page.getByLabel('Show canvas diagnostics', { exact: true }).isVisible()))
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Toggle Appearance panel' }).click(); await page.keyboard.press('Escape')
  await check('rectangle gesture creates one canonical node and autosaves', async () => { await draw('Draw rectangle', 240, 160, 420, 280); const current = await waitSaved(p => p.boards[0].nodes.length === 1); const node = current.boards[0].nodes[0]; assert.equal(node.kind, 'shape'); assert.equal(node.shapeType, 'rectangle'); assert(node.width > 150 && node.height > 90); report.rectangle = { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }; assert.equal(await page.locator('.board-node').count(), 1) })
  await check('drawing undo removes exactly one gesture and redo restores stable identity', async () => { await rail.getByLabel('Undo board change').click(); await waitSaved(p => p.boards[0].nodes.length === 0); assert.equal(await page.locator('.board-node').count(), 0); await rail.getByLabel('Redo board change').click(); const current = await waitSaved(p => p.boards[0].nodes.length === 1); assert.equal(current.boards[0].nodes[0].id, report.rectangle.id) })
  await check('ellipse gesture saves bounded artwork geometry', async () => { await draw('Draw ellipse', 470, 170, 610, 290); const current = await waitSaved(p => p.boards[0].nodes.length === 2); const node = current.boards[0].nodes[1]; assert.equal(node.shapeType, 'ellipse'); assert(node.width > 0 && node.height > 0); report.ellipseId = node.id })
  await check('line gesture saves its canonical diagonal frame geometry', async () => { await draw('Draw line', 260, 380, 450, 420); const current = await waitSaved(p => p.boards[0].nodes.length === 3); const node = current.boards[0].nodes[2]; assert.equal(node.shapeType, 'line'); assert.equal(node.width, 190); assert.equal(node.height, 40); report.lineId = node.id })
  await check('Pen closes a real three-anchor path and autosaves canonical anchors', async () => { await rail.getByLabel('Pen tool', { exact: true }).click(); await page.getByLabel('Place pen path anchors').waitFor(); const r = await page.locator('.canvas-stage').boundingBox(); assert(r); for (const [x, y] of [[500, 400], [650, 420], [560, 540], [500, 400]]) await page.mouse.click(r.x + x, r.y + y); const current = await waitSaved(p => p.boards[0].nodes.length === 4); const node = current.boards[0].nodes[3]; assert.equal(node.shapeType, 'path'); assert.equal(node.vectorPath.closed, true); assert.equal(node.vectorPath.points.length, 3); report.penId = node.id; await page.keyboard.press('Escape') })
  await check('Escape discards unfinished Pen draft without another saved gesture', async () => { await rail.getByLabel('Pen tool', { exact: true }).click(); const r = await page.locator('.canvas-stage').boundingBox(); await page.mouse.click(r.x + 700, r.y + 520); await page.keyboard.press('Escape'); assert.equal(await page.locator('.pen-draft').count(), 0); assert.equal((await savedProject()).boards[0].nodes.length, 4) })
  await check('real production App reopen restores saved identities and artwork', async () => { const current = await savedProject(); report.beforeReopen = current; await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.boot-loader').waitFor({ state: 'hidden' }); await page.locator('.canvas-stage').waitFor(); await page.locator(`article[data-node-id="${report.lineId}"]`).waitFor(); const mounted = await page.locator('article.board-node[data-node-id]').evaluateAll(nodes => nodes.map(n => n.dataset.nodeId)); assert.deepEqual(new Set(mounted), new Set(current.boards[0].nodes.map(n => n.id))); const reopened = await savedProject(); assert.deepEqual(reopened.boards[0].nodes, current.boards[0].nodes); assert.deepEqual(reopened.documents, current.documents) })
  await check('wheel camera changes leave saved artwork coordinates and path anchors unchanged', async () => { const before = (await savedProject()).boards[0].nodes; const stage = page.locator('.canvas-stage'), r = await stage.boundingBox(), worldBefore = await page.locator('.board-world').getAttribute('style'); const pointer = { x: r.x + r.width * .7, y: r.y + r.height * .7 }; report.cameraProbe = { bounds: r, pointer, worldBefore, target: await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, pointer) }; await stage.evaluate(node => node.addEventListener('wheel', event => { window.__p0WheelReceipt = { target: event.target.className, deltaY: event.deltaY, defaultPrevented: event.defaultPrevented, shiftKey: event.shiftKey } }, { once: true, capture: true })); await page.mouse.move(pointer.x, pointer.y); await page.mouse.wheel(0, 48); await page.waitForTimeout(300); report.cameraProbe.after = await page.evaluate(() => ({ world: document.querySelector('.board-world')?.getAttribute('style'), liveCamera: document.querySelector('.canvas-stage')?.dataset.liveCamera, wheel: window.__p0WheelReceipt })); await page.waitForFunction(previous => document.querySelector('.board-world')?.getAttribute('style') !== previous, worldBefore); await page.keyboard.down('Shift'); await page.mouse.wheel(0, 48); await page.keyboard.up('Shift'); const current = await waitSaved(p => p.boards[0].viewport.scale !== 1 || p.boards[0].viewport.x !== 28); assert.deepEqual(current.boards[0].nodes, before); report.cameraAfterInteraction = current.boards[0].viewport })
  await check('Document edit autosaves rich content while Split and Canvas retain artwork', async () => { await page.getByRole('button', { name: 'Document', exact: true }).click(); const editor = page.locator('.tiptap').first(); await editor.waitFor(); assert.equal(await page.locator('.canvas-stage').count(), 0); await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' — P0 accepted edit 日本語 العربية'); await waitSaved(p => JSON.stringify(p.documents).includes('P0 accepted edit 日本語 العربية')); report.documentLayout = await documentLayout(); assert.equal(await editor.evaluate(node => node === document.activeElement || node.contains(document.activeElement)), true); await page.keyboard.press('Control+z'); await waitSaved(p => !JSON.stringify(p.documents).includes('P0 accepted edit 日本語 العربية')); await page.keyboard.press('Control+Shift+z'); await waitSaved(p => JSON.stringify(p.documents).includes('P0 accepted edit 日本語 العربية')); assert.equal((await savedProject()).boards[0].nodes.length, 4); await page.getByRole('button', { name: 'Split', exact: true }).click(); await page.locator('.canvas-stage').waitFor(); assert(await editor.isVisible()); await page.getByRole('button', { name: 'Canvas', exact: true }).click(); assert(await rail.isVisible()); assert.equal(await page.locator('.board-node').count(), 4) })
  await check('both themes apply to the actual production App', async () => { await page.getByRole('button', { name: 'Use light theme' }).click(); assert.equal(await page.locator('.studio-shell.workspace-light').count(), 1); await shot('APP-LIGHT'); await page.getByRole('button', { name: 'Use dark theme' }).click(); assert.equal(await page.locator('.studio-shell.workspace-dark').count(), 1); await shot('APP-DARK') })
  }
  if (rectangleMask) await check('actual rectangle eraser preserves appearance, history, resize, hole picking and saved canonical mask', async () => {
    const rail = page.locator('.canvas-tool-rail')
    const initial = structuredClone(project.boards.find(board => board.id === 'rect-mask').nodes)
    await page.locator('.board-tree-row').filter({ hasText: 'P0 rectangle mask fixture' }).click()
    const top = page.locator('article[data-node-id="mask-top"]'), underlay = page.locator('article[data-node-id="mask-underlay"]')
    await top.waitFor()
    const complete = () => page.waitForFunction(() => { const host = document.querySelector('.vello-board'); return host?.dataset.pending === 'false' && host.dataset.acceptedGeneration === host.dataset.generation && host.dataset.measuredCardComplete === '2' })
    await complete()
    const bounds = await top.boundingBox(); assert(bounds)
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const pixelAt = async point => { const decoded = await sharp(await page.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const x = Math.round(point.x * deviceScaleFactor), y = Math.round(point.y * deviceScaleFactor); assert(x >= 0 && y >= 0 && x < decoded.info.width && y < decoded.info.height); const i = (y * decoded.info.width + x) * 4; return [...decoded.data.subarray(i, i + 4)] }
    await page.mouse.move(50, 20); const beforePixel = await pixelAt(center)
    await page.mouse.click(bounds.x + 35, bounds.y + 35)
    await page.waitForFunction(() => document.querySelector('article[data-node-id="mask-top"]')?.classList.contains('selected'))
    await page.keyboard.press('Shift+E'); await page.getByLabel('Vector eraser size', { exact: true }).waitFor()
    const eraserSize = Number(await page.getByLabel('Vector eraser size', { exact: true }).inputValue()); assert(eraserSize >= 4 && eraserSize <= 120)
    await page.mouse.move(center.x - 6, center.y); await page.mouse.down(); await page.mouse.move(center.x + 6, center.y, { steps: 4 }); await page.mouse.up()
    let current = await waitSaved(p => p.boards.find(board => board.id === 'rect-mask').nodes.find(node => node.id === 'mask-top').vectorBoolean?.operands.length >= 2)
    const erased = structuredClone(current.boards.find(board => board.id === 'rect-mask').nodes)
    const erasedTop = erased.find(node => node.id === 'mask-top')
    assert.equal(erasedTop.shapeType, 'rectangle'); assert.equal(erasedTop.vectorPath, undefined); assert.equal(erasedTop.vectorTransform, undefined); assert.equal(erasedTop.vectorBoolean.operation, 'subtract')
    for (const key of ['x', 'y', 'width', 'height', 'color', 'strokeColor', 'strokeWidth', 'cornerRadius', 'opacity']) assert.equal(erasedTop[key], initial[1][key], key + ' must preserve authored appearance')
    assert.deepEqual(erased[0], initial[0]); await page.keyboard.press('Escape'); await page.mouse.move(50, 20); await complete()
    const erasedPixel = await pixelAt(center)
    assert(erasedPixel.slice(0, 3).some((value, i) => Math.abs(value - beforePixel[i]) > 25), 'Erasure must change the actual completed appearance pixel')
    await rail.getByLabel('Undo board change').click(); await waitSaved(p => !p.boards.find(board => board.id === 'rect-mask').nodes.find(node => node.id === 'mask-top').vectorBoolean)
    assert.deepEqual((await savedProject()).boards.find(board => board.id === 'rect-mask').nodes, initial)
    await rail.getByLabel('Redo board change').click(); await waitSaved(p => Boolean(p.boards.find(board => board.id === 'rect-mask').nodes.find(node => node.id === 'mask-top').vectorBoolean))
    assert.deepEqual((await savedProject()).boards.find(board => board.id === 'rect-mask').nodes, erased); await complete()
    const stageBounds = await page.locator('.canvas-stage').boundingBox(); assert(stageBounds)
    await page.mouse.click(stageBounds.x + 20, stageBounds.y + 20); await page.mouse.click(center.x, center.y)
    await page.waitForFunction(() => document.querySelector('article[data-node-id="mask-underlay"]')?.classList.contains('selected'))
    assert(!(await top.getAttribute('class')).includes('selected'), 'The erased hole must select artwork behind it')
    await page.mouse.click(bounds.x + 35, bounds.y + 35)
    const handle = page.locator('[data-transform-controls="mask-top"] .handle-se'); await handle.waitFor()
    const handleBounds = await handle.boundingBox(); assert(handleBounds)
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2); await page.mouse.down(); await page.mouse.move(handleBounds.x + handleBounds.width / 2 + 44, handleBounds.y + handleBounds.height / 2 + 30, { steps: 6 }); await page.mouse.up()
    current = await waitSaved(p => p.boards.find(board => board.id === 'rect-mask').nodes.find(node => node.id === 'mask-top').width > erasedTop.width + 30)
    const resized = structuredClone(current.boards.find(board => board.id === 'rect-mask').nodes), resizedTop = resized.find(node => node.id === 'mask-top')
    assert(resizedTop.height > erasedTop.height + 20); assert.equal(resizedTop.shapeType, 'rectangle'); assert.equal(resizedTop.vectorPath, undefined); assert.equal(resizedTop.vectorBoolean.operation, 'subtract')
    for (let n = 1; n < erasedTop.vectorBoolean.operands.length; n++) for (let i = 0; i < erasedTop.vectorBoolean.operands[n].points.length; i++) {
      const before = erasedTop.vectorBoolean.operands[n].points[i], after = resizedTop.vectorBoolean.operands[n].points[i]
      assert(Math.abs(after.x - before.x * resizedTop.width / erasedTop.width) < .00001 && Math.abs(after.y - before.y * resizedTop.height / erasedTop.height) < .00001, 'Resize must scale canonical eraser cutters exactly once')
    }
    for (const key of ['color', 'strokeColor', 'strokeWidth', 'cornerRadius', 'opacity']) assert.equal(resizedTop[key], erasedTop[key])
    await rail.getByLabel('Undo board change').click(); await waitSaved(p => p.boards.find(board => board.id === 'rect-mask').nodes.find(node => node.id === 'mask-top').width === erasedTop.width)
    assert.deepEqual((await savedProject()).boards.find(board => board.id === 'rect-mask').nodes, erased)
    await rail.getByLabel('Redo board change').click(); await waitSaved(p => p.boards.find(board => board.id === 'rect-mask').nodes.find(node => node.id === 'mask-top').width === resizedTop.width)
    assert.deepEqual((await savedProject()).boards.find(board => board.id === 'rect-mask').nodes, resized)
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.boot-loader').waitFor({ state: 'hidden' }); await top.waitFor(); await complete()
    assert.deepEqual((await savedProject()).boards.find(board => board.id === 'rect-mask').nodes, resized)
    const reopenedBounds = await top.boundingBox(); assert(reopenedBounds)
    await page.mouse.click(reopenedBounds.x + reopenedBounds.width / 2, reopenedBounds.y + reopenedBounds.height / 2)
    await page.waitForFunction(() => document.querySelector('article[data-node-id="mask-underlay"]')?.classList.contains('selected'))
    report.rectangleMask = { initial, erased, resized, eraserSize, beforePixel, erasedPixel, presenter: await page.locator('.vello-board').evaluate(node => ({ ...node.dataset })), limitation: 'Actual App browser gestures and controlled file-backed reload; native IO/runtime and shadow-only eraser sweeps remain separate.' }
    await shot('RECTANGLE-MASK-REOPENED')
    await page.locator('.board-tree-row').filter({ hasText: 'Empty artwork fixture' }).click(); await page.waitForFunction(() => Number(document.querySelector('.canvas-stage')?.dataset.totalNodes) === 4)
  })
  if(flowProbe)await check('actual App flow retains complete ownership, advances frames and honors pause/resume/reduced motion',async()=>{
    await page.locator('.board-tree-row').filter({hasText:'P0 animated arrow fixture'}).click();await page.mouse.move(50,20)
    await page.waitForFunction(()=>document.querySelector('article[data-node-id="flow-live"]')?.dataset.velloCardPaint==='complete'&&document.querySelector('article[data-node-id="flow-static"]')?.dataset.velloCardPaint==='complete')
    const generation=()=>page.locator('.vello-board').evaluate(element=>Number(element.dataset.acceptedGeneration))
    const first=await generation();await page.waitForFunction(previous=>Number(document.querySelector('.vello-board')?.dataset.acceptedGeneration)>previous,first)
    await page.locator('article[data-node-id="flow-live"] svg').evaluate(svg=>svg.getAnimations({subtree:true}).forEach(animation=>animation.pause()))
    await page.waitForTimeout(700);const paused=await generation();await page.waitForTimeout(700)
    report.pausedFlowDiagnostic=await page.locator('article[data-node-id="flow-live"] svg').evaluate(svg=>svg.getAnimations({subtree:true}).map(animation=>({name:animation.animationName,state:animation.playState,pending:animation.pending,currentTime:animation.currentTime})))
    assert.equal(await generation(),paused)
    await page.locator('article[data-node-id="flow-live"] svg').evaluate(svg=>svg.getAnimations({subtree:true}).forEach(animation=>animation.play()))
    await page.waitForFunction(previous=>Number(document.querySelector('.vello-board')?.dataset.acceptedGeneration)>previous,paused)
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(700);const reduced=await generation();await page.waitForTimeout(700);assert.equal(await generation(),reduced)
    await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(previous=>Number(document.querySelector('.vello-board')?.dataset.acceptedGeneration)>previous,reduced)
    report.flow={first,paused,reduced,presenter:await page.locator('.vello-board').evaluate(element=>({...element.dataset}))}
    await shot('APP-FLOW-QUALIFIED');await page.locator('.board-tree-row').filter({hasText:'Empty artwork fixture'}).click();await page.waitForFunction(()=>Number(document.querySelector('.canvas-stage')?.dataset.totalNodes)===0)
  })
  if (imageReload) await check('actual image provider invalidates accepted reload and replacement at the same URI and dimensions', async () => {
    await page.locator('.board-tree-row').filter({ hasText: 'P0 mixed card fixture' }).click()
    await page.locator('article[data-node-id="mixed-image"] img').evaluate((image,uri)=>new Promise((resolve,reject)=>{image.crossOrigin='anonymous';image.addEventListener('load',resolve,{once:true});image.addEventListener('error',reject,{once:true});image.src=uri}),reloadImageSource)
    await page.waitForFunction(() => { const host = document.querySelector('.vello-board'); return host?.dataset.pending === 'false' && host.dataset.acceptedGeneration === host.dataset.generation && host.dataset.measuredCardComplete === '4' })
    const model = (await savedProject()).boards.find(board => board.id === 'mixed-cards').nodes
    const img = page.locator('article[data-node-id="mixed-image"] img'), bounds = await img.boundingBox(); assert(bounds)
    const sample = async () => { const decoded = await sharp(await page.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const x = Math.round((bounds.x + bounds.width * .25) * deviceScaleFactor), y = Math.round((bounds.y + bounds.height * .5) * deviceScaleFactor), offset = (y * decoded.info.width + x) * 4; return [...decoded.data.subarray(offset, offset + 4)] }
    const receipt = () => page.locator('.vello-board').evaluate(node => ({ ...node.dataset }))
    const reference = host => JSON.parse(host.frameMetadata).imageResources.references.find(item => item.key.includes('mixed-image'))
    const original = { host: await receipt(), pixel: await sample() }; original.reference = reference(original.host)
    const sources = [await img.getAttribute('src')]
    const replacements = []
    for (const replacement of [false, true]) {
      imageServerVersion++
      await img.evaluate((current, replace) => new Promise(resolve => {
        const uri = current.src, target = replace ? current.cloneNode(true) : current
        target.src = ''; if (replace) current.replaceWith(target)
        target.addEventListener('load', () => resolve({ naturalWidth: target.naturalWidth, naturalHeight: target.naturalHeight }), { once: true })
        requestAnimationFrame(() => { target.src = uri })
      }), replacement)
      const prior = replacements.at(-1) || original
      await page.waitForFunction(previous => { const host = document.querySelector('.vello-board'); if (host?.dataset.pending !== 'false' || host.dataset.acceptedGeneration !== host.dataset.generation || host.dataset.measuredCardComplete !== '4') return false; try { return JSON.parse(host.dataset.frameMetadata).imageResources.references.find(item => item.key.includes('mixed-image'))?.revision > previous } catch { return false } }, prior.reference.revision)
      const current = { replacement, host: await receipt(), pixel: await sample() }; current.reference = reference(current.host)
      const decodedPixel=await img.evaluate(image=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.drawImage(image,image.naturalWidth*.25,image.naturalHeight*.5,1,1,0,0,1,1);return [...context.getImageData(0,0,1,1).data]})
      report.reloadPixelDiagnostic={pixel:current.pixel,decodedPixel,originalPixel:original.pixel,bounds,replacement,reference:current.reference}
      const canonicalState=await page.evaluate(()=>{const host=document.querySelector('.vello-board');const state={opacity:host.style.opacity,cards:[...document.querySelectorAll('article.board-node')].map(article=>({id:article.dataset.nodeId,card:article.getAttribute('data-vello-card-paint'),vector:article.getAttribute('data-vello-paint')}))};host.style.opacity='0';for(const article of document.querySelectorAll('article.board-node')){article.removeAttribute('data-vello-card-paint');article.removeAttribute('data-vello-paint')}return state})
      let canonicalPixel
      try{canonicalPixel=await sample()}finally{await page.evaluate(state=>{document.querySelector('.vello-board').style.opacity=state.opacity;for(const saved of state.cards){const article=document.querySelector(`article[data-node-id="${saved.id}"]`);if(saved.card!==null)article.setAttribute('data-vello-card-paint',saved.card);if(saved.vector!==null)article.setAttribute('data-vello-paint',saved.vector)}},canonicalState)}
      report.reloadPixelDiagnostic.canonicalPixel=canonicalPixel
      assert(current.pixel.slice(0,3).every((value,i)=>Math.abs(value-canonicalPixel[i])<8),'Accepted engine pixels must match current canonical DOM compositing; identical URI assignment may reuse decoded browser pixels')
      current.decodedPixel=decodedPixel
      assert.equal(current.reference.width, original.reference.width); assert.equal(current.reference.height, original.reference.height); assert.equal(current.reference.key, original.reference.key)
      assert.equal(JSON.parse(current.host.frameMetadata).imageResources.count, 1, 'Old immutable revisions must be retired after accepted replacement')
      sources.push(await img.getAttribute('src')); replacements.push(current)
    }
    assert(sources.every(source => source === sources[0])); assert.deepEqual((await savedProject()).boards.find(board => board.id === 'mixed-cards').nodes, model)
    report.imageReload = { original, replacements, imageRequests, sources, limitation: 'Synthetic same-URI no-store loopback PNG reload/replacement through actual production provider; current App metadata proves residency, separate resource pipeline fixture proves managed lease disposal.' }
    await shot('SAME-URI-IMAGE-REPLACED')
  })
  if (mixedCards) await check(smallImage ? 'tiny SOURCE LIMIT image preserves visible DOM artwork and typed complete-paint refusal' : 'actual mixed cards obtain complete Vello paint with exact loaded fonts and immutable PNG', async () => {
    const board = project.boards.find(board => board.id === 'mixed-cards'), baseline = structuredClone(board.nodes)
    await page.locator('.board-tree-row').filter({ hasText: board.title }).click()
    await page.waitForFunction(() => Number(document.querySelector('.canvas-stage')?.dataset.totalNodes) === 4)
    await page.locator('article[data-node-id="mixed-image"] img').waitFor()
    await page.waitForFunction(width => document.querySelector('article[data-node-id="mixed-image"] img')?.naturalWidth === width, process.env.P0_APP_SMALL_IMAGE === '1' ? 64 : 1024)
    await page.mouse.move(50, 20)
    await page.waitForFunction(() => { const host = document.querySelector('.vello-board'); return host?.dataset.pending === 'false' && (host?.dataset.paintOwnership === 'vello' || host?.dataset.renderState === 'error') })
    report.mixedCards = await page.locator('.vello-board').evaluate(host => ({ host: { ...host.dataset }, mounted: [...document.querySelectorAll('article.board-node')].map(node => ({ id: node.dataset.nodeId, velloPaint: node.dataset.velloPaint, velloCardPaint: node.dataset.velloCardPaint })) }))
    report.mixedCardStyles = await page.locator('article.board-node').evaluateAll(nodes => nodes.map(article => ({ id: article.dataset.nodeId, nodes: [article, ...article.querySelectorAll('*')].slice(0, 200).map(node => { const s = getComputedStyle(node), r = node.getBoundingClientRect(); return { tag: node.tagName, class: node.className, text: node.children.length ? undefined : node.textContent?.slice(0, 100), bounds: { x: r.x, y: r.y, width: r.width, height: r.height }, ancestors: [...function* () { let p = node.parentElement; while (p && p !== article.parentElement) { const c = getComputedStyle(p); yield { tag: p.tagName, class: p.className, position: c.position, zIndex: c.zIndex, opacity: c.opacity, transform: c.transform, isolation: c.isolation, mixBlendMode: c.mixBlendMode }; p = p.parentElement } }()], style: Object.fromEntries(['filter', 'backdrop-filter', 'text-shadow', 'outline', 'clip-path', 'position', 'z-index', 'opacity', 'isolation', 'mix-blend-mode', 'transform', 'perspective', 'display', 'overflow', 'background-image', 'background-clip', 'border-width', 'border-style', 'white-space', 'font-stretch', 'animation-name', 'transition-property'].map(key => [key, s.getPropertyValue(key)])) } }) })))
    if (smallImage) {
      const image = page.locator('article[data-node-id="mixed-image"]'), badge = image.locator('.raster-detail-badge.limited')
      assert(await badge.isVisible(), 'The actual SOURCE LIMIT badge must remain visible')
      assert.match(await badge.innerText(), /SOURCE LIMIT/i)
      assert.notEqual(await image.getAttribute('data-vello-card-paint'), 'complete', 'Unsupported badge effects must not hide DOM image paint')
      const blockers = JSON.parse(report.mixedCards.host.completePaintBlockers || '{}')['mixed-image'] || []
      assert(blockers.some(blocker => /CARD_STYLE_EFFECT_UNSUPPORTED|CARD_ESCAPING_STACKING_CONTEXT_PENDING/.test(blocker)), 'Badge refusal must remain explicit and typed')
      const bounds = await image.locator('img').boundingBox(); assert(bounds)
      const png = await page.screenshot(), decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const x = Math.round((bounds.x + bounds.width * .25) * deviceScaleFactor), y = Math.round((bounds.y + bounds.height * .5) * deviceScaleFactor)
      assert(x >= 0 && y >= 0 && x < decoded.info.width && y < decoded.info.height)
      const pixel = [...decoded.data.subarray((y * decoded.info.width + x) * 4, (y * decoded.info.width + x) * 4 + 4)]
      assert(pixel[1] > pixel[0] + 40 && pixel[2] > pixel[0] + 40, 'Fallback must preserve an actual visible cyan image pixel')
      report.sourceLimitRefusal = { blockers, visiblePixel: pixel, logicalSample: { x: bounds.x + bounds.width * .25, y: bounds.y + bounds.height * .5 }, limitation: 'Explicit DOM fallback qualification; this image badge is not complete Vello coverage.' }
      assert.deepEqual((await savedProject()).boards.find(board => board.id === 'mixed-cards').nodes, baseline)
      await shot('SOURCE-LIMIT-DOM-FALLBACK')
      return
    }
    assert.equal(report.mixedCards.host.paintOwnership, 'vello', report.mixedCards.host.renderError)
    assert.equal(Number(report.mixedCards.host.measuredCardComplete), 4, report.mixedCards.host.completePaintBlockers)
    assert(report.mixedCards.mounted.every(node => node.velloCardPaint === 'complete'), 'Every qualified card must receive ownership only from a completed frame')
    assert(fontReceipts.some(value => value.status === 'resolved'), 'Actual fonts must be resolved rather than fabricated')
    assert.deepEqual((await savedProject()).boards.find(board => board.id === 'mixed-cards').nodes, baseline)
    await shot('APP-MIXED-CARDS')
    if (!mixedProbeOnly && !mixedDeviceLoss) { await page.locator('.board-tree-row').filter({ hasText: 'Empty artwork fixture' }).click(); await page.waitForFunction(() => Number(document.querySelector('.canvas-stage')?.dataset.totalNodes) === 4) }
  })
  if (mixedDeviceLoss) await check('actual mounted mixed App device loss restores complete genuine CPU artwork', async () => {
    const beforeModel = (await savedProject()).boards.find(board => board.id === 'mixed-cards').nodes
    const imageBounds = await page.locator('article[data-node-id="mixed-image"] img').boundingBox(); assert(imageBounds)
    const samplePoint = { x: Math.round((imageBounds.x + imageBounds.width * .25) * deviceScaleFactor), y: Math.round((imageBounds.y + imageBounds.height * .5) * deviceScaleFactor) }
    const pixel = async () => { const decoded = await sharp(await page.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); assert(samplePoint.x < decoded.info.width && samplePoint.y < decoded.info.height); const i = (samplePoint.y * decoded.info.width + samplePoint.x) * 4; return [...decoded.data.subarray(i, i + 4)] }
    const gpuPixel = await pixel()
    const gpu = await page.locator('.vello-board').evaluate(node => ({ ...node.dataset })); assert.equal(gpu.backend, 'gpu')
    const deviceCount = await page.evaluate(() => { const devices = window.__p0ObservedGpuDevices; if (!devices?.length) throw new Error('No genuine App GPU device was observed'); devices.at(-1).destroy(); return devices.length })
    await page.waitForFunction(() => { const host = document.querySelector('.vello-board'); return host?.dataset.backend === 'cpu' && host.dataset.acceptedBackend === 'cpu' && host.dataset.pending === 'false' && host.dataset.acceptedGeneration === host.dataset.generation && host.dataset.measuredCardComplete === '4' })
    const cpu = await page.locator('.vello-board').evaluate(node => ({ ...node.dataset })), cpuPixel = await pixel()
    assert.equal(cpu.renderer, 'vello-cpu'); assert.equal(Number(cpu.paintedObjects), 4)
    assert.deepEqual([cpu.acceptedX, cpu.acceptedY, cpu.acceptedScale, cpu.acceptedCssWidth, cpu.acceptedCssHeight], [gpu.acceptedX, gpu.acceptedY, gpu.acceptedScale, gpu.acceptedCssWidth, gpu.acceptedCssHeight])
    assert.equal(await page.locator('.vello-board canvas').count(), 1)
    assert(await page.locator('article.board-node').evaluateAll(nodes => nodes.every(node => node.dataset.velloCardPaint === 'complete')))
    assert(cpuPixel.slice(0, 3).every((value, i) => Math.abs(value - gpuPixel[i]) <= 4), 'Mounted GPU and genuine CPU image composite samples must agree')
    assert.deepEqual((await savedProject()).boards.find(board => board.id === 'mixed-cards').nodes, beforeModel)
    report.mixedDeviceLoss = { deviceCount, gpu, cpu, gpuPixel, cpuPixel, samplePoint, limitation: 'Deliberate actual device.destroy in disposable browser App; not physical VRAM exhaustion or native WebView2.' }
    await shot('MIXED-CPU-DEVICE-LOSS')
    if (!mixedProbeOnly) { await page.locator('.board-tree-row').filter({ hasText: 'Empty artwork fixture' }).click(); await page.waitForFunction(() => Number(document.querySelector('.canvas-stage')?.dataset.totalNodes) === 4) }
  })
  if (workloadCount) await check('bounded mounted App workload reports camera, DOM and frame observations', async () => {
    const name = `P0 workload ${workloadCount}`, baseline = project.boards[1].nodes
    const started = performance.now(); await page.locator('.board-tree-row').filter({ hasText: name }).click()
    await page.waitForFunction(count => Number(document.querySelector('.canvas-stage')?.dataset.totalNodes) === count, workloadCount)
    await page.waitForFunction(() => { const host = document.querySelector('.vello-board'); return host?.dataset.pending === 'false' && host?.dataset.paintOwnership === 'vello' })
    const stage = page.locator('.canvas-stage'), r = await stage.boundingBox(); assert(r)
    const sample = () => stage.evaluate(node => ({ ...node.dataset, mountedNodes: document.querySelectorAll('.board-node').length, renderer: { ...document.querySelector('.vello-board')?.dataset } }))
    const before = await sample(), readyMs = performance.now() - started
    assert(Number(before.renderer.paintedObjects) > 0, 'This workload must actually paint Vello objects')
    const frames = page.evaluate(() => new Promise(resolve => { const intervals = []; let previous = performance.now(); const run = now => { intervals.push(now - previous); previous = now; if (intervals.length === 120) resolve(intervals.slice(1)); else requestAnimationFrame(run) }; requestAnimationFrame(run) }))
    await page.mouse.move(r.x + r.width * .7, r.y + r.height * .5)
    for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, i % 2 ? 18 : -18); await page.waitForTimeout(8) }
    const beforeFinalWheel = await page.locator('.board-world').getAttribute('style')
    await page.mouse.wheel(0, 120)
    await page.waitForFunction(previous => document.querySelector('.board-world')?.getAttribute('style') !== previous, beforeFinalWheel)
    const intervals = (await frames).sort((a, b) => a - b)
    await page.waitForFunction(() => { const host = document.querySelector('.vello-board'); return host?.dataset.pending === 'false' && host?.dataset.acceptedGeneration === host?.dataset.generation && host.dataset.acceptedX === host.dataset.cameraX && host.dataset.acceptedY === host.dataset.cameraY && host.dataset.acceptedScale === host.dataset.cameraScale })
    const current = await waitSaved(p => p.boards[1].viewport.scale !== 1)
    const after = await sample()
    assert.deepEqual(current.boards[1].nodes, baseline)
    assert.equal(Number(after.totalNodes), workloadCount); assert.equal(Number(after.spatialIndexSize), workloadCount)
    assert(after.mountedNodes < 250, 'Offscreen rectangle workload should remain spatially bounded')
    report.workload = { count: workloadCount, readyMs, before, after, cameraFrames: intervals.length, p50Ms: intervals[Math.ceil(intervals.length * .5) - 1], p95Ms: intervals[Math.ceil(intervals.length * .95) - 1], p99Ms: intervals[Math.ceil(intervals.length * .99) - 1], limitation: 'Headless browser rectangle corpus with controlled IPC; excludes mixed image/text/native physical memory and perceived latency.' }
    report.workload.finalMounted = await page.locator('article.board-node').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.nodeId, paint: node.dataset.velloPaint, cardPaint: node.dataset.velloCardPaint })))
    assert(Number(after.renderer.paintedObjects) > 0, 'The settled workload must retain genuine Vello paint after camera interaction')
    assert.equal(Number(after.renderer.measuredCardComplete), after.mountedNodes, 'Every mounted rectangle must regain complete ownership after camera interaction')
    assert(report.workload.finalMounted.every(node => node.cardPaint === 'complete'), 'No settled rectangle may silently remain in DOM ownership')
    await page.locator('.board-tree-row').filter({ hasText: 'Empty artwork fixture' }).click(); await page.waitForFunction(() => Number(document.querySelector('.canvas-stage')?.dataset.totalNodes) === 4)
  })
  await check('idle mounted App retains accepted generation and allocation counters', async () => { await page.mouse.move(50, 20); await page.waitForTimeout(300); await page.waitForFunction(() => { const host = document.querySelector('.vello-board'); return host?.dataset.pending === 'false' && host?.dataset.paintOwnership === 'vello' }); await page.locator('.canvas-stage').evaluate(stage => {
    const events = []; window.__p0IdleEvents = events
    const record = value => { if (events.length < 1000) events.push({ ...value, at: performance.now(), generation: document.querySelector('.vello-board')?.dataset.generation }) }
    for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout', 'transitionend', 'animationend']) stage.addEventListener(type, event => record({ type, class: event.target.className, nodeId: event.target.closest?.('[data-node-id]')?.dataset.nodeId, propertyName: event.propertyName, animationName: event.animationName }), true)
    const observer = new MutationObserver(records => { for (const record of records) { const node = record.target; if (record.type === 'childList') record.type; else if (node.closest?.('article.board-node')) { const entry = { type: 'mutation', attribute: record.attributeName, class: node.className, nodeId: node.closest('[data-node-id]').dataset.nodeId, value: node.getAttribute(record.attributeName) }; if (events.length < 1000) events.push(entry) } if (record.type === 'childList' && events.length < 1000) events.push({ type: 'childList', class: node.className, added: [...record.addedNodes].map(n => ({ tag: n.nodeName, class: n.className })), removed: [...record.removedNodes].map(n => ({ tag: n.nodeName, class: n.className })) }) } }); observer.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] }); window.__p0IdleObserver = observer
  }); const sample = () => page.locator('.vello-board').evaluate(node => ({ acceptedGeneration: node.dataset.acceptedGeneration, generation: node.dataset.generation, pending: node.dataset.pending, ownership: node.dataset.paintOwnership, measuredCardLayoutRevision: node.dataset.measuredCardLayoutRevision, completePaintBlockers: node.dataset.completePaintBlockers, targetAllocations: node.dataset.targetAllocations, surfaceConfigurations: node.dataset.surfaceConfigurations, paintedObjects: node.dataset.paintedObjects })); const before = await sample(); await page.waitForTimeout(1200); const after = await sample(); const events = await page.evaluate(() => { window.__p0IdleObserver.disconnect(); return window.__p0IdleEvents }); report.idle = { durationMs: 1200, before, after, events, limitation: 'Short idle stability observation is not sustained process/driver resource or performance qualification.' }; assert.deepEqual(after, before) })
  report.presenters = await page.locator('.vello-board').evaluateAll(nodes => nodes.map(node => ({ ...node.dataset })))
  const accessibility = await new AxeBuilder({ page }).include('.studio-shell').disableRules(['color-contrast']).analyze()
  report.accessibility = accessibility.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, count: nodes.length, targets: nodes.slice(0, 4).flatMap(n => n.target) }))
  await check('actual App has no critical accessibility violations in tested Canvas state', async () => assert.equal(report.accessibility.filter(v => v.impact === 'critical').length, 0))
  await check('controlled transport never performs unknown IPC or emits page errors', async () => { assert.deepEqual(unhandled, []); assert.deepEqual(errors, []) })
  report.savedFile = { bytes: (await stat(inside(projectPath))).size, sha256: createHash('sha256').update(await readFile(inside(projectPath))).digest('hex') }
  report.passed = true
} catch (error) { report.error = error.message; await shot('APP-FAILURE').catch(() => {}); report.visibleState = await page.locator('body').innerText().catch(() => 'unavailable'); report.failurePresenters = await page.locator('.vello-board').evaluateAll(nodes => nodes.map(node => ({ ...node.dataset }))).catch(() => []); process.exitCode = 1 }
finally {
  if(!report.passed)report.failureImageStyles=await page.locator('article[data-node-id="mixed-image"]').evaluateAll(nodes=>nodes.flatMap(article=>[article,...article.querySelectorAll('*')].map(element=>{const style=getComputedStyle(element);return {tag:element.tagName,class:element.className,text:element.children.length?'':element.textContent,source:element instanceof HTMLImageElement?{src:element.currentSrc,width:element.naturalWidth,height:element.naturalHeight}:undefined,style:Object.fromEntries(['filter','backdrop-filter','text-shadow','position','z-index','outline','animation-name'].map(key=>[key,style.getPropertyValue(key)]))}}))).catch(()=>[])
  report.ipcEvents = events; report.exactNativeFontReceipts = fontReceipts; await writeFile(resolve(output, 'FULL_APP_BROWSER_ACCEPTANCE.json'), JSON.stringify(report, null, 2)); await context.close(); await browser.close(); if (imageServer) await new Promise(done => imageServer.close(done))
}
console.log(JSON.stringify({ passed: report.passed, checks: checks.length, output, ...(report.error ? { error: report.error } : {}) }))
