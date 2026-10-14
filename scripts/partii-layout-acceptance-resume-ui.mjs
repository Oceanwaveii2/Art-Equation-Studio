import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import ts from 'typescript'

// Isolated browser state and in-memory Tauri backend. No production files or
// user browser profile are loaded. Geometry reads observe the actual DOM;
// interactions use normal Playwright hits and keyboard events, never force.
const projectSource = await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8')
const source = ts.transpileModule(projectSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject, DEFAULT_DOCUMENT_LAYOUT } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const fixture = createBlankProject('Part II layout acceptance memory fixture')
fixture.id = 'partii-layout-resume-memory'
fixture.documents.push({ id: 'layout-rich', title: 'Rich layout acceptance', layout: { ...DEFAULT_DOCUMENT_LAYOUT }, content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Production reference notebook' }] }, ...Array.from({ length: 12 }, (_, index) => ({ type: 'paragraph', content: [{ type: 'text', text: `Section ${index + 1}. Rich document, selected Pen path, images and page inspector must coexist without pane overlap. ` }] }))] } })
fixture.assets = [{ id: 'layout-photo', kind: 'image', extension: 'png', originalName: 'Reference.png', displayName: 'Reference', relativePath: 'originals/reference.png', thumbnailRelativePath: 'thumb/reference.png', byteLength: 1024, width: 600, height: 400, status: 'available', importedAt: new Date().toISOString() }]
fixture.boards = [{ id: 'layout-board', title: 'Layout board', linkedFolderPath: `projects/${fixture.id}/boards/layout-board`, viewport: { x: 24, y: 24, scale: .8 }, connectors: [], nodes: [{ id: 'layout-path', kind: 'shape', shapeType: 'path', title: 'Editable Pen house roof', x: 105, y: 185, width: 220, height: 150, color: '#ae633b', strokeColor: '#dde6ee', strokeWidth: 3, opacity: 1, vectorPath: { closed: true, points: [{ x: 0, y: 150 }, { x: 110, y: 0 }, { x: 220, y: 150 }] } }, { id: 'layout-image', kind: 'image', title: 'Reference card', assetId: 'layout-photo', x: 360, y: 170, width: 240, height: 180 }] }]
const picture = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#286689"/><circle cx="300" cy="200" r="110" fill="#e8bb6a"/></svg>').toString('base64')}`
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-layout-resume', new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(artifacts, { recursive: true })
const report = { generatedAt: new Date().toISOString(), baseUrl, passed: false, sourceHashes: {}, checks: [], cases: [], screenshots: [], browserErrors: [], limitations: ['Fresh headless Edge with memory-only Tauri mock; no production project mutations', 'Browser DPR1/1.5/2 is not physical Windows100/150/200 percent scaling', 'No NVDA, native Vello pixels, pen hardware or full accessibility conformance certification', 'Geometry and focus sample is not an exhaustive UI audit'] }
for (const name of ['src/App.tsx', 'src/App.css', 'src/document/RichDocument.tsx', 'src/media/AssetManager.tsx', 'scripts/partii-layout-acceptance-resume-ui.mjs']) report.sourceHashes[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) }); return Boolean(passed) }
const settled = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
async function shot(page, name) { await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true }); report.screenshots.push(`${name}.png`) }
async function setup(width, height, dpr, theme) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr })
  const page = await context.newPage()
  page.setDefaultTimeout(2500)
  page.on('pageerror', (error) => report.browserErrors.push(error.message))
  page.on('dialog', (dialog) => { report.browserErrors.push(`Unexpected native ${dialog.type()}`); void dialog.dismiss() })
  await page.addInitScript(({ initial, theme, picture }) => {
    const backend = { project: structuredClone(initial), calls: [], entries: [], settings: { schemaVersion: 5, theme, viewMode: 'split', splitRatio: 60, activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'layout-board', activeDocumentId: 'layout-rich', activeNavigatorItem: 'document:layout-rich', viewMode: 'split', splitRatio: 60 } } } }
    window.__layoutBackend = backend
    localStorage.setItem('art-equation.navigator', '1'); localStorage.setItem('art-equation.inspector', '1'); localStorage.setItem('art-equation.view-mode', 'split'); localStorage.setItem('art-equation.canvas-tools', '1')
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: () => picture, invoke: async (command, args = {}) => {
      backend.calls.push({ command, args: structuredClone(args) })
      if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'layout-resume-memory', readOnly: false, lockOwned: true }
      if (command === 'list_projects') return [{ id: initial.id, title: initial.title, updatedAt: initial.updatedAt, boardCount: 1, assetCount: 1, status: initial.status }]
      if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? backend.settings : backend.project)
      if (command === 'save_json') { if (args.relativePath === 'settings.json') backend.settings = structuredClone(args.value); else if (args.relativePath.endsWith('/project.json')) backend.project = structuredClone(args.value); return }
      if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten', 'mini_bridge_launch'].includes(command)) return
      if (['list_trashed_projects', 'audit_assets'].includes(command)) return []
      if (command === 'list_project_trash') return structuredClone(backend.entries)
      if (command === 'record_trash_entry') { backend.entries.push(structuredClone(args.entry)); return }
      if (command === 'remove_trash_entry') { backend.entries = backend.entries.filter((item) => item.id !== args.entryId); return }
      if (command === 'plugin:event|listen' || command === 'plugin:window|scale_factor') return 1
      if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
      if (command === 'semantic_index_status' || command === 'prepare_semantic_index') return { state: 'empty', sourceCount: 1, indexedCount: 0, failedCount: 0, generation: 0, diskBytes: 0, annState: 'notBuilt', annIndexedCount: 0, searchEngine: 'exact' }
      if (command === 'list_system_fonts') return ['Arial', 'Georgia']
      throw new Error(`Memory-only layout mock does not permit ${command}`)
    } }
  }, { initial: fixture, theme, picture })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('.document-editor').waitFor({ timeout: 20000 })
  const splash = page.getByRole('dialog', { name: 'Starting Art Equation Studio', exact: true })
  if (await splash.count()) await splash.getByRole('button', { name: /^Enter now$/i }).click({ timeout: 12000 })
  await splash.waitFor({ state: 'detached', timeout: 20000 })
  await page.locator(`.studio-shell.workspace-${theme}`).waitFor({ timeout: 12000 })
  await settled(page)
  return { context, page }
}
async function pane(page, name) {
  const tabs = page.getByRole('group', { name: 'Split workspace pane', exact: true })
  if (await tabs.count()) { await tabs.getByRole('button', { name, exact: true }).click(); await settled(page) }
}
async function geometry(page) { return page.evaluate(() => {
  const box = (item) => { if (!item) return null; const r = item.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, visibility: getComputedStyle(item).visibility } }
  const doc = document.querySelector('.document-pane'), canvas = document.querySelector('.canvas-pane'), inspector = document.querySelector('.document-layout-inspector'), toolbar = document.querySelector('.document-toolbar')
  const paper = document.querySelector('.paper')
  const rgb = (value) => { const numbers = value.match(/[\d.]+/g)?.map(Number) || []; return { channels: numbers.slice(0, 3), alpha: numbers[3] ?? 1 } }
  const luminance = (channels) => channels.map((value) => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
  const statsContrast = [...document.querySelectorAll('.document-stats strong')].map((item) => {
    const foreground = getComputedStyle(item).color, background = getComputedStyle(item.parentElement).backgroundColor
    const fg = rgb(foreground), bg = rgb(background), opaque = fg.channels.length === 3 && bg.channels.length === 3 && fg.alpha === 1 && bg.alpha === 1
    const a = luminance(fg.channels), b = luminance(bg.channels)
    return { text: item.textContent, foreground, background, opaque, ratio: opaque ? (Math.max(a, b) + .05) / (Math.min(a, b) + .05) : null }
  })
  const stage = document.querySelector('.document-stage'), stageStyle = getComputedStyle(stage)
  return { dpr: devicePixelRatio, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, document: box(doc), canvas: box(canvas), inspector: box(inspector), paper: box(paper), statsContrast, toolbar: { ...box(toolbar), clientWidth: toolbar.clientWidth, scrollWidth: toolbar.scrollWidth, overflowX: getComputedStyle(toolbar).overflowX }, compact: Boolean(document.querySelector('.compact-split-tabs')), documentStage: { ...box(stage), scrollWidth: stage.scrollWidth, gridTemplateRows: stageStyle.gridTemplateRows, gridTemplateColumns: stageStyle.gridTemplateColumns, gridAutoRows: stageStyle.gridAutoRows, alignContent: stageStyle.alignContent }, more: box(document.querySelector('button[aria-label="More formatting"]')) }
}) }
async function formatChecks(page, label) {
  const trigger = page.getByRole('button', { name: 'More formatting', exact: true }), menu = page.getByRole('menu', { name: 'More document tools', exact: true })
  const step = async (name, fn) => { try { await fn() } catch (error) { check(`${label}: ${name}`, false, String(error).slice(0, 450)) } }
  await step('More formatting normal click reachable', async () => {
    await trigger.click(); await menu.waitFor(); await settled(page)
    const bounds = await menu.evaluate((item) => { const r = item.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, topmost: document.elementFromPoint(r.left + r.width / 2, r.top + 20)?.closest('.document-more-menu') === item } })
    check(`${label}: formatting popup in viewport and topmost`, bounds.left >= 0 && bounds.top >= 0 && bounds.right <= await page.evaluate(() => innerWidth) && bounds.bottom <= await page.evaluate(() => innerHeight) && bounds.topmost, bounds)
    if (/^(dark-1440x930|light-760x900)-dpr1$/.test(label)) await shot(page, `03-formatting-popup-${label}`)
    await page.keyboard.press('Escape'); await settled(page)
    check(`${label}: formatting Escape closes and restores trigger focus`, await menu.count() === 0 && await trigger.evaluate((item) => item === document.activeElement))
    if (await menu.count()) await trigger.click()
  })
  await step('More formatting outside click closes', async () => {
    await trigger.click(); await menu.waitFor(); await settled(page)
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await settled(page)
    check(`${label}: formatting outside app-bar click dismisses`, await menu.count() === 0)
    if (await menu.count()) await trigger.click()
  })
  await step('More formatting keyboard opening', async () => {
    await trigger.focus(); await page.keyboard.press('Enter'); await menu.waitFor(); await settled(page)
    check(`${label}: keyboard-open formatting menu focuses first item`, await menu.locator('button').first().evaluate((item) => item === document.activeElement))
    check(`${label}: menu actions expose menuitem semantics`, await menu.getByRole('menuitem').count() >= 20, { menuitems: await menu.getByRole('menuitem').count(), buttons: await menu.getByRole('button').count() })
    await page.keyboard.press('End'); await settled(page)
    check(`${label}: formatting End focuses last action`, await menu.locator('button').last().evaluate((item) => item === document.activeElement))
    await page.keyboard.press('ArrowDown'); await settled(page)
    check(`${label}: formatting Down wraps from last to first`, await menu.locator('button').first().evaluate((item) => item === document.activeElement))
    await page.keyboard.press('ArrowUp'); await settled(page)
    check(`${label}: formatting Up wraps from first to last`, await menu.locator('button').last().evaluate((item) => item === document.activeElement))
    await page.keyboard.press('Home'); await settled(page)
    check(`${label}: formatting Home returns first action`, await menu.locator('button').first().evaluate((item) => item === document.activeElement))
    await page.keyboard.press('Escape'); await settled(page)
    if (await menu.count()) await trigger.click()
  })
  await step('formatting Tab and Shift+Tab navigation', async () => {
    await trigger.focus(); await page.keyboard.press('ArrowUp'); await menu.waitFor(); await settled(page)
    check(`${label}: formatting Up on trigger opens last action`, await menu.locator('button').last().evaluate((item) => item === document.activeElement))
    await page.keyboard.press('Shift+Tab'); await settled(page)
    check(`${label}: formatting Shift+Tab dismisses and reaches preceding inspector control`, await menu.count() === 0 && await page.getByRole('button', { name: 'Toggle page layout inspector', exact: true }).evaluate((item) => item === document.activeElement))
    if (await menu.count()) await trigger.click()
    await trigger.focus(); await page.keyboard.press('ArrowDown'); await menu.waitFor(); await settled(page)
    await page.keyboard.press('Tab'); await settled(page)
    check(`${label}: formatting Tab dismisses and reaches document editor`, await menu.count() === 0 && await page.locator('.document-editor').evaluate((item) => item === document.activeElement))
    if (await menu.count()) await trigger.click()
  })
  await step('formatting keyboard command preserves editor focus', async () => {
    await trigger.focus(); await page.keyboard.press('Enter'); await menu.waitFor(); await settled(page)
    const focusPaint = await menu.locator('button').first().evaluate((item) => { const style = getComputedStyle(item); return { focused: item === document.activeElement, focusVisible: item.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor } })
    check(`${label}: formatting keyboard focus has visible outline`, focusPaint.focused && focusPaint.focusVisible && focusPaint.outlineStyle !== 'none' && parseFloat(focusPaint.outlineWidth) >= 1, focusPaint)
    await page.keyboard.press('Enter'); await settled(page)
    check(`${label}: formatting command closes menu and returns focus to editor`, await menu.count() === 0 && await page.locator('.document-editor').evaluate((item) => item === document.activeElement))
    check(`${label}: formatting command actually creates a bullet list in isolated document`, await page.locator('.document-editor ul').count() > 0)
    if (await menu.count()) await trigger.click()
  })
}
async function documentUsabilityChecks(page, label) {
  const targets = await page.locator('.document-layout-inspector').evaluate((inspector) => {
    const pane = document.querySelector('.document-pane').getBoundingClientRect()
    return [...inspector.querySelectorAll('input,select,button')].map((item) => {
      const r = item.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { name: item.getAttribute('aria-label') || item.closest('label')?.querySelector('span')?.textContent || item.type, width: r.width, height: r.height, insidePane: r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= pane.bottom, topmost: hit === item || item.contains(hit) }
    })
  })
  check(`${label}: all page-inspector controls have unobscured visible hit targets`, targets.length >= 9 && targets.every((item) => item.width > 0 && item.height > 0 && item.insidePane && item.topmost), targets)
  const heading = page.locator('.document-editor h1').first()
  await heading.scrollIntoViewIfNeeded(); await settled(page)
  const hit = await heading.evaluate((item) => {
    const r = item.getBoundingClientRect(), stage = item.closest('.document-stage').getBoundingClientRect()
    const x = Math.max(r.left, stage.left) + 8, y = Math.max(r.top, stage.top) + Math.min(18, r.height / 2)
    return { x, y, unobscured: document.elementFromPoint(x, y)?.closest('.document-editor') === item.closest('.document-editor') }
  })
  if (hit.unobscured) await page.mouse.click(hit.x, hit.y)
  check(`${label}: document paper is reachable and accepts a normal edit hit`, hit.unobscured && await page.locator('.document-editor').evaluate((item) => item === document.activeElement), hit)
}
async function selectedPath(page, label) {
  await pane(page, 'Canvas')
  const path = page.locator('[data-node-id="layout-path"] .shape-hit-area')
  const sampledPoints = await path.evaluate((item) => [.03, .15, .28, .5, .68, .85, .97].map((fraction) => { const p = item.getPointAtLength(item.getTotalLength() * fraction).matrixTransform(item.getScreenCTM()); return { x: p.x, y: p.y, hit: document.elementFromPoint(p.x, p.y)?.closest('.board-node')?.getAttribute('data-node-id'), blockingElement: document.elementFromPoint(p.x, p.y)?.tagName } }))
  const point = sampledPoints.find((item) => item.hit === 'layout-path')
  check(`${label}: path is selectable by unobscured actual hit`, Boolean(point), sampledPoints)
  if (!point) return
  await page.mouse.click(point.x, point.y); await settled(page)
  const controls = page.getByRole('toolbar', { name: 'Canvas controls', exact: true })
  const detail = await controls.evaluate((item) => { const r = item.getBoundingClientRect(); const targets = [...item.querySelectorAll('button,input,select')].filter((control) => getComputedStyle(control).display !== 'none').map((control) => { const b = control.getBoundingClientRect(); return { name: control.getAttribute('aria-label') || control.textContent?.trim().slice(0, 35), left: b.left, right: b.right, width: b.width, height: b.height, clipped: b.left < r.left - 1 || b.right > r.right + 1 } }); return { left: r.left, right: r.right, width: r.width, clientWidth: item.clientWidth, scrollWidth: item.scrollWidth, overflowX: getComputedStyle(item).overflowX, targets } })
  const cap = page.getByLabel('Path stroke cap', { exact: true })
  await cap.focus(); await settled(page)
  // CSS scroll-behavior may tween focus scrolling. Observe the settled
  // rendered geometry instead of declaring a failure after only two frames.
  await page.waitForFunction(() => { const item = document.querySelector('select[aria-label="Path stroke cap"]'); if (!item) return false; const r = item.getBoundingClientRect(), b = item.closest('.canvas-toolbar').getBoundingClientRect(); return item === document.activeElement && r.left >= b.left - 1 && r.right <= b.right + 1 }, null, { timeout: 2000 }).catch(() => {})
  const reached = await cap.evaluate((item) => { const r = item.getBoundingClientRect(); const b = item.closest('.canvas-toolbar').getBoundingClientRect(); return item === document.activeElement && r.left >= b.left - 1 && r.right <= b.right + 1 })
  check(`${label}: selected-path toolbar keyboard can reach initially clipped controls`, reached, detail)
  return detail
}
try {
  for (const [width, height] of [[1440, 930], [1200, 900], [760, 900]]) for (const dpr of [1, 1.5, 2]) for (const theme of ['dark', 'light']) {
    const label = `${theme}-${width}x${height}-dpr${dpr}`, entry = { label, width, height, dpr, theme }
    if (process.env.LAYOUT_CASES_FILTER && !new RegExp(process.env.LAYOUT_CASES_FILTER).test(label)) continue
    const { context, page } = await setup(width, height, dpr, theme)
    try {
      await pane(page, 'Document')
      entry.geometry = await geometry(page)
      const g = entry.geometry
      check(`${label}: no root horizontal overflow`, g.overflow <= 1, g.overflow)
      check(`${label}: requested DPR reported exactly`, g.dpr === dpr)
      check(`${label}: document/canvas panes do not overlap when both visible`, g.compact || g.document.right <= g.canvas.left + 1, { document: g.document, canvas: g.canvas, compact: g.compact })
      check(`${label}: document inspector does not cross document pane into canvas`, !g.inspector || g.inspector.right <= g.document.right + 1, { document: g.document, inspector: g.inspector })
      const intersection = g.inspector && g.paper ? { width: Math.min(g.inspector.right, g.paper.right, g.document.right) - Math.max(g.inspector.left, g.paper.left, g.document.left), height: Math.min(g.inspector.bottom, g.paper.bottom, g.document.bottom) - Math.max(g.inspector.top, g.paper.top, g.document.top) } : null
      check(`${label}: page inspector does not obscure visible document paper`, !intersection || intersection.width <= 1 || intersection.height <= 1, { paper: g.paper, inspector: g.inspector, intersection })
      check(`${label}: opaque document-statistics digits have at least 4.5 contrast`, g.statsContrast.every((item) => !item.opaque || item.ratio >= 4.5), g.statsContrast)
      await shot(page, `01-document-${label}`)
      await documentUsabilityChecks(page, label)
      await formatChecks(page, label)
      entry.pathControls = await selectedPath(page, label)
      await shot(page, `02-selected-path-${label}`)
    } catch (error) { entry.error = String(error); check(`${label}: complete layout case`, false, entry.error); await shot(page, `failure-${label}`).catch(() => {}) }
    finally { report.cases.push(entry); await context.close() }
  }
  const { context, page } = await setup(1200, 900, 1.5, 'light')
  try {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' }); await settled(page)
    check('forced colors and reduced motion media queries active', await page.evaluate(() => matchMedia('(forced-colors: active)').matches && matchMedia('(prefers-reduced-motion: reduce)').matches))
    await pane(page, 'Document'); await shot(page, '03-forced-colors-reduced-motion-split')
    await formatChecks(page, 'forced-colors-reduced-motion')
    const manage = page.getByRole('button', { name: 'Manage files', exact: true }); await manage.focus(); await page.keyboard.press('Enter')
    const bridge = page.getByRole('dialog', { name: 'Project Mini Bridge', exact: true }); await bridge.waitFor(); await settled(page)
    check('Mini Bridge search receives focus in forced-colors/reduced-motion case', await bridge.getByRole('searchbox', { name: 'Search assets', exact: true }).evaluate((item) => item === document.activeElement))
    const row = bridge.getByLabel('Asset Reference; press Shift+F10 for actions', { exact: true }); await row.focus(); await page.keyboard.press('Shift+F10')
    const menu = bridge.getByRole('menu', { name: 'Actions for Reference', exact: true }); await menu.waitFor(); await menu.getByRole('menuitem', { name: 'Rename catalog entry…', exact: true }).click()
    const rename = page.getByRole('dialog', { name: 'Rename catalog entry', exact: true }); await rename.waitFor(); await settled(page)
    check('nested Rename owns focus and suspends Mini Bridge', await rename.evaluate((item) => item.contains(document.activeElement)) && await bridge.evaluate((item) => item.inert))
    await shot(page, '04-forced-colors-nested-rename')
    await page.keyboard.press('Escape'); await settled(page)
    check('nested Rename Escape restores row focus without writing asset', await rename.count() === 0 && await row.evaluate((item) => item === document.activeElement) && await page.evaluate(() => window.__layoutBackend.project.assets[0].displayName === 'Reference'))
    await page.keyboard.press('Escape'); await settled(page)
    check('Mini Bridge Escape restores Manage files focus', await bridge.count() === 0 && await manage.evaluate((item) => item === document.activeElement))
  } catch (error) { check('forced-colors/nested-focus complete case', false, String(error)); await shot(page, 'failure-forced-colors').catch(() => {}) }
  finally { await context.close() }
  check('no unhandled or native dialog errors', report.browserErrors.length === 0, report.browserErrors)
  report.passed = report.checks.every((item) => item.passed)
} catch (error) { report.error = String(error); console.error(error) }
finally {
  report.sourceHashesAfter = {}
  for (const name of Object.keys(report.sourceHashes)) report.sourceHashesAfter[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
  report.sourceChangedDuringRun = Object.keys(report.sourceHashes).filter((name) => report.sourceHashes[name] !== report.sourceHashesAfter[name])
  if (report.sourceChangedDuringRun.length) report.limitations.push(`Source changed while tests were running: ${report.sourceChangedDuringRun.join(', ')}; rerun before source-wide acceptance`)
  check('checked source fingerprints stay unchanged during test run', report.sourceChangedDuringRun.length === 0, report.sourceChangedDuringRun)
  report.passed = !report.error && report.checks.every((item) => item.passed)
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2)); await browser.close()
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter((item) => !item.passed).map(({ name }) => name), screenshots: report.screenshots.length, report: resolve(artifacts, 'report.json') }, null, 2))
if (!report.passed) process.exitCode = 1
