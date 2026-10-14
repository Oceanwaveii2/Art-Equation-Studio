import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
import { chromium } from 'playwright-core'

// Actual React controls and pointer gestures, isolated in-memory Tauri fixture.
// No user profile, disk project, host clipboard or native scene is changed.
const compile = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const { createBlankProject } = await import(moduleUrl(compile(await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8'))))
const { connectorGeometry, connectorLabelPoint } = await import(moduleUrl(compile(await readFile(new URL('../src/board/connectors.ts', import.meta.url), 'utf8'))))
const out = resolve('output/playwright/partii-connector-ui')
await mkdir(out, { recursive: true })
const report = { passed: false, generatedAt: new Date().toISOString(), checks: [], screenshots: [], browserErrors: [], limitation: 'Actual frontend gestures, save/reload, SVG and disposable 24-image/30-edge fixture. No native Vello pixels, physical DPI/stylus or production disk recovery certification.' }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
const page = await context.newPage()
page.on('pageerror', (e) => report.browserErrors.push(e.message))
const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const x = c.getContext('2d'); for (const [i, color] of ['#f00', '#0f0', '#00f', '#ff0'].entries()) { x.fillStyle = color; x.fillRect(i % 2 * 100, Math.floor(i / 2) * 50, 100, 50) } return c.toDataURL() })
const fixture = createBlankProject('Part II connected image-map QA')
fixture.id = 'partii-connector-ui-memory'
fixture.assets = []
const nodes = Array.from({ length: 24 }, (_, i) => ({ id: `image-${i}`, kind: 'image', imagePresentation: 'artwork', x: 160 + i % 6 * 185, y: 120 + Math.floor(i / 6) * 185, width: 120, height: 90, title: `Reference ${i + 1}`, body: image, color: '#151515', rotation: i === 2 ? 25 : 0 }))
const connectors = Array.from({ length: 30 }, (_, i) => ({ id: `connection-${i}`, sourceId: nodes[i % 24].id, targetId: nodes[(i + 1) % 24].id, sourcePort: 'right', targetPort: 'left', style: ['elbow', 'curve', 'straight'][i % 3], color: ['#60a5fa', '#a78bfa', '#eab308'][i % 3], width: 2, dashed: false, startArrow: false, endArrow: true, animated: false, label: i < 3 ? `Link ${i}` : '', ...(i === 0 ? { bendPoints: [{ x: 315, y: 225 }] } : {}) }))
fixture.boards = [{ id: 'connected-root', title: 'Connected references', linkedFolderPath: `projects/${fixture.id}/boards/connected-root`, nodes, connectors, viewport: { x: 35, y: 20, scale: .7 }, backgroundFollowsTheme: true, gridVisible: true }]
await page.addInitScript((initial) => {
  const stored = localStorage.getItem('partii-connector-memory-project')
  window.__connectorBackend = { project: stored ? JSON.parse(stored) : structuredClone(initial), calls: [], clipboard: [] }
  localStorage.setItem('art-equation.navigator', '0'); localStorage.setItem('art-equation.inspector', '0'); localStorage.setItem('art-equation.canvas-tools', '1'); localStorage.setItem('art-equation.view-mode', 'canvas')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => window.__connectorBackend.clipboard.push(s) } })
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (s) => s, invoke: async (command, args = {}) => {
    const b = window.__connectorBackend; b.calls.push({ command, args: structuredClone(args) })
    if (command === 'workspace_info') return { root: 'MEMORY-ONLY', workspaceId: initial.id, readOnly: false, lockOwned: true }
    if (command === 'list_projects') return [{ id: b.project.id, title: b.project.title, updatedAt: b.project.updatedAt, boardCount: 1, assetCount: 0, status: b.project.status }]
    if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? { schemaVersion: 5, theme: 'dark', viewMode: 'canvas', activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'connected-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:connected-root', viewMode: 'canvas' } } } : b.project)
    if (command === 'save_json') { if (args.relativePath.endsWith('/project.json')) { b.project = structuredClone(args.value); localStorage.setItem('partii-connector-memory-project', JSON.stringify(b.project)) }; return }
    if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten'].includes(command)) return
    if (['list_project_trash', 'list_trashed_projects', 'audit_assets'].includes(command)) return []
    if (['plugin:event|listen', 'plugin:window|scale_factor'].includes(command)) return 1
    if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
    throw new Error(`Memory fixture does not permit ${command}`)
  } }
}, fixture)
const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), detail }); assert(passed, `${name}: ${JSON.stringify(detail)}`) }
const group = (id = 'connection-0') => page.locator(`[data-connector-id="${id}"]`)
const shot = async (name) => { await page.screenshot({ path: resolve(out, `${name}.png`), scale: 'css' }); report.screenshots.push(`${name}.png`) }
const center = (locator) => locator.evaluate((e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
async function chooseConnection(id = 'connection-0') {
  const point = await group(id).locator('.connector-hit').evaluate((path, id) => {
    for (const t of [.1, .2, .3, .4, .6, .7, .8, .9]) { const p = path.getPointAtLength(path.getTotalLength() * t).matrixTransform(path.getScreenCTM()); if (document.elementFromPoint(p.x, p.y)?.closest('[data-connector-id]')?.getAttribute('data-connector-id') === id) return { x: p.x, y: p.y } }
    throw new Error(`No unobscured real hit surface for ${id}`)
  }, id)
  await page.mouse.click(point.x, point.y); await settle(); assert(await group(id).evaluate((e) => e.classList.contains('selected')))
}
async function save() { const before = await page.evaluate(() => window.__connectorBackend.calls.length); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForFunction((n) => window.__connectorBackend.calls.slice(n).some((c) => c.command === 'save_json' && c.args.relativePath.endsWith('/project.json')), before); return page.evaluate(() => structuredClone(window.__connectorBackend.project.boards[0])) }
async function undo() { await page.getByLabel('Undo board change', { exact: true }).click(); await settle() }
async function drag(locator, dx, dy, cancel = false) { const p = await center(locator); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + dx, p.y + dy, { steps: 10 }); await settle(); const during = await group().locator('.connector-path').getAttribute('d'); if (cancel) await page.keyboard.press('Escape'); await page.mouse.up(); await settle(); return during }
try {
  await page.goto(process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'); await group().waitFor(); await settle()
  if (await page.getByRole('button', { name: 'Enter now', exact: true }).isVisible()) await page.getByRole('button', { name: 'Enter now', exact: true }).click()
  await settle()
  check('dense fixture keeps all 24 images and 30 pairwise edges', await page.locator('.board-node.node-image').count() === 24 && await page.locator('.connector-group').count() === 30)
  await chooseConnection(); await shot('01-connected-image-map')
  let before = await save(), path = await group().locator('.connector-path').getAttribute('d')
  const during = await drag(group().locator('[data-endpoint="target"]'), 30, 85)
  let after = await save(), edge = after.connectors[0]
  check('endpoint preview changes the rendered route before release', during !== path)
  check('detaching clears target ID and stores free coordinates', !edge.targetId && Number.isFinite(edge.targetPoint.x) && Number.isFinite(edge.targetPoint.y), edge)
  await undo(); check('one Undo restores endpoint metadata', JSON.stringify((await save()).connectors[0]) === JSON.stringify(before.connectors[0]))
  await chooseConnection(); before = await save(); path = await group().locator('.connector-path').getAttribute('d')
  await drag(group().locator('[data-endpoint="target"]'), 40, 80, true)
  check('Escape cancels endpoint gesture without changing model', JSON.stringify((await save()).connectors[0]) === JSON.stringify(before.connectors[0]))
  check('Escape restores route and removes transient ownership', await group().locator('.connector-path').getAttribute('d') === path && await page.locator('.canvas-stage').getAttribute('data-active-transform') !== 'true')
  await chooseConnection(); before = await save()
  await drag(group().locator('[data-bend-index="0"]'), 38, 27)
  after = await save(); check('waypoint drag stores a moved manual elbow waypoint', after.connectors[0].bendPoints[0].x !== before.connectors[0].bendPoints[0].x)
  await undo(); check('one Undo restores route waypoint', JSON.stringify((await save()).connectors[0].bendPoints) === JSON.stringify(before.connectors[0].bendPoints))
  await chooseConnection(); before = await save()
  await drag(group().locator('.connector-label'), 32, -28)
  after = await save(); check('label drag commits route-relative position', Number.isFinite(after.connectors[0].labelPosition.t))
  const geometry = connectorGeometry(after.connectors[0], after.nodes), label = connectorLabelPoint(after.connectors[0], geometry)
  check('committed label agrees with canonical route math', (await group().locator('.connector-label').getAttribute('transform')).includes(String(label.x)), label)
  await undo(); check('one Undo restores label placement', JSON.stringify((await save()).connectors[0]) === JSON.stringify(before.connectors[0]))
  await chooseConnection(); await page.getByLabel('Connection options', { exact: true }).click(); await page.getByLabel('Connection relationship preset').selectOption('alternative'); await settle()
  after = await save(); check('relationship preset stores dot and readable text cue', after.connectors[0].linePattern === 'dot' && after.connectors[0].relationshipStyle === 'alternative' && after.connectors[0].label === 'Link 0')
  check('dot pattern is visibly rounded', await group().locator('.connector-path').getAttribute('stroke-dasharray') === '1 6' && await group().locator('.connector-path').getAttribute('stroke-linecap') === 'round')
  // Save is outside the flyout and correctly dismisses it; reopen normally.
  await page.getByLabel('Connection options', { exact: true }).click()
  await page.getByLabel('Connection source attachment').selectOption('adaptive'); after = await save(); check('adaptive attachment retains object identity', after.connectors[0].sourcePortMode === 'adaptive' && after.connectors[0].sourceId === 'image-0')
  await page.getByLabel('Connection options', { exact: true }).click()
  await shot('02-connection-options')
  await page.keyboard.press('Escape'); check('Escape closes options and returns opener focus', !await page.locator('.object-options-panel').count() && await page.getByLabel('Connection options', { exact: true }).evaluate((e) => e === document.activeElement))
  await page.getByLabel('Connection options', { exact: true }).click(); const stage = await page.locator('.canvas-stage').boundingBox(); await page.mouse.click(stage.x + stage.width - 200, stage.y + stage.height - 100); await settle(); check('outside click closes options without requiring a second click', !await page.locator('.object-options-panel').count())
  const card = page.locator('[data-node-id="image-23"]'); const p = await center(card); await page.mouse.click(p.x, p.y); await settle(); assert(await card.evaluate((e) => e.classList.contains('selected')))
  await page.getByLabel('Image framing options', { exact: true }).click(); await page.getByLabel('Image fit', { exact: true }).selectOption('cover'); await page.getByLabel('Image crop zoom').fill('1.5'); await page.getByLabel('Image crop zoom').press('Tab'); after = await save()
  const framed = after.nodes.find((n) => n.id === 'image-23'); check('framing controls persist non-destructive crop metadata', framed.imageTransform.fit === 'cover' && framed.imageTransform.zoom === 1.5 && framed.body === image)
  await page.getByLabel('Image framing options', { exact: true }).click()
  await shot('03-image-framing')
  await page.getByRole('button', { name: 'Reset framing', exact: true }).click(); after = await save(); check('reset removes framing only and preserves source image', !after.nodes.find((n) => n.id === 'image-23').imageTransform.fit && after.nodes.find((n) => n.id === 'image-23').body === image)
  await page.keyboard.press('Escape'); await undo(); after = await save(); check('Undo restores cropped framing', after.nodes.find((n) => n.id === 'image-23').imageTransform.fit === 'cover')
  await save(); await page.reload(); await card.waitFor(); await settle(); after = await save(); check('save/reload keeps diagram routing, labels and image framing', after.connectors[0].sourcePortMode === 'adaptive' && after.connectors[0].linePattern === 'dot' && after.nodes.find((n) => n.id === 'image-23').imageTransform.fit === 'cover')
  await page.setViewportSize({ width: 760, height: 900 }); await settle(); await chooseConnection(); await page.getByLabel('Connection options', { exact: true }).click(); const b = await page.locator('.object-options-panel').boundingBox(); check('compact-window options stay within visible viewport', b.x >= 0 && b.x + b.width <= 760 && b.y >= 0 && b.y + b.height <= 900, b); await shot('04-compact-connection-options')
  check('no frontend exceptions', report.browserErrors.length === 0, report.browserErrors)
  report.passed = true
} catch (error) { report.failure = String(error.stack || error); await shot('failure').catch(() => {}) }
finally { await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); console.log(`Part II connector UI: ${report.passed ? 'PASS' : 'FAIL'} ${report.checks.filter((c) => c.passed).length}/${report.checks.length}`); if (!report.passed) { console.error(report.failure); process.exitCode = 1 } }
