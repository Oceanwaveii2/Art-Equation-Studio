import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const source = ts.transpileModule(await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const fixture = createBlankProject('Part II isolated Mini Bridge QA')
fixture.id = 'partii-mini-bridge-isolated'
fixture.assets = [{ id: 'bridge-photo', kind: 'image', extension: 'png', originalName: 'High-resolution source.png', displayName: 'High-resolution source', relativePath: 'originals/source.png', thumbnailRelativePath: 'thumb/source.png', byteLength: 1600000, width: 2400, height: 1800, status: 'available', aliases: [], virtualFolder: 'Reference images', importedAt: new Date().toISOString() }, { id: 'bridge-missing', kind: 'image', extension: 'jpg', originalName: 'Missing reference.jpg', displayName: 'Missing reference', relativePath: 'originals/missing.jpg', byteLength: 2048, status: 'missing', aliases: [], virtualFolder: 'Reference images', importedAt: new Date().toISOString() }]
fixture.boards = [{ id: 'bridge-root', title: 'Bridge root', linkedFolderPath: `projects/${fixture.id}/boards/bridge-root`, viewport: { x: 0, y: 0, scale: 1 }, connectors: [], nodes: [{ id: 'bridge-image', kind: 'image', title: 'Placed reference', assetId: 'bridge-photo', x: 150, y: 140, width: 240, height: 180 }, { id: 'bridge-missing-card', kind: 'image', title: 'Missing card', assetId: 'bridge-missing', x: 430, y: 140, width: 240, height: 180 }] }]
fixture.assets.push({ ...fixture.assets[0], id: 'bridge-tiled', requiresTiledPreview: true, displayName: 'Tiled reference', originalName: 'Tiled reference.png', relativePath: 'originals/tiled.png', thumbnailRelativePath: 'thumb/tiled.png' })
fixture.boards[0].nodes.push({ id: 'bridge-tiled-card', kind: 'image', title: 'Tiled reference', assetId: 'bridge-tiled', x: 710, y: 140, width: 240, height: 180 })
const picture = (width, height) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#3271ae"/><circle cx="${width / 2}" cy="${height / 2}" r="${height / 3}" fill="#deb269"/></svg>`).toString('base64')}`
const pictures = { original: picture(2400, 1800), thumbnail: picture(128, 96) }
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-mini-bridge')
await mkdir(artifacts, { recursive: true })
const report = { generatedAt: new Date().toISOString(), baseUrl, passed: false, checks: [], screenshots: [], browserErrors: [], axe: {}, contrast: {}, limitations: ['Fresh Edge browser with in-memory Tauri mock only', 'Scoped axe sample is not full accessibility conformance', 'No native WebView, physical DPI, paid model or production data test'] }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', (error) => report.browserErrors.push(error.message))
page.on('dialog', (dialog) => { report.browserErrors.push(`Unexpected native dialog: ${dialog.type()}`); void dialog.dismiss() })
await page.addInitScript(({ initial, pictures }) => {
  const backend = { project: initial, calls: [], entries: [], converts: [], settings: { schemaVersion: 5, theme: 'dark', viewMode: 'canvas', activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'bridge-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:bridge-root', viewMode: 'canvas' } } } }
  window.__bridgeBackend = backend
  localStorage.setItem('art-equation.navigator', '1'); localStorage.setItem('art-equation.inspector', '0'); localStorage.setItem('art-equation.view-mode', 'canvas'); localStorage.setItem('art-equation.canvas-tools', '1')
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (value) => { backend.converts.push(value); return value.includes('thumb') ? pictures.thumbnail : pictures.original }, invoke: async (command, args = {}) => {
    backend.calls.push({ command, args: structuredClone(args) })
    if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'bridge-isolated', readOnly: false, lockOwned: true }
    if (command === 'list_projects') return [{ id: backend.project.id, title: backend.project.title, updatedAt: backend.project.updatedAt, boardCount: 1, assetCount: backend.project.assets.length, status: backend.project.status }]
    if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? backend.settings : backend.project)
    if (command === 'save_json') { if (args.relativePath.endsWith('/project.json')) backend.project = structuredClone(args.value); else if (args.relativePath === 'settings.json') backend.settings = structuredClone(args.value); return }
    if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten'].includes(command)) return
    if (['list_trashed_projects', 'audit_assets'].includes(command)) return []
    if (command === 'list_project_trash') return structuredClone(backend.entries)
    if (command === 'record_trash_entry') { backend.entries.push(structuredClone(args.entry)); return }
    if (command === 'remove_trash_entry') { backend.entries = backend.entries.filter((entry) => entry.id !== args.entryId); return }
    if (command === 'plugin:event|listen' || command === 'plugin:window|scale_factor') return 1
    if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
    if (command === 'semantic_index_status' || command === 'prepare_semantic_index') return { state: 'empty', sourceCount: 2, indexedCount: 0, failedCount: 0, generation: 0, diskBytes: 0, annState: 'notBuilt', annIndexedCount: 0, searchEngine: 'exact' }
    if (command === 'mini_bridge_launch') return null
    throw new Error(`Isolated Mini Bridge mock does not permit ${command}`)
  } }
}, { initial: fixture, pictures })
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) }); assert(passed, name) }
const screenshot = async (name) => { await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true }); report.screenshots.push(`${name}.png`) }
const bridge = () => page.getByRole('dialog', { name: 'Project Mini Bridge', exact: true })
const row = () => bridge().getByLabel('Asset High-resolution source; press Shift+F10 for actions', { exact: true })
const assetMenu = () => bridge().getByRole('menu', { name: 'Actions for High-resolution source', exact: true })
const tools = () => bridge().getByRole('button', { name: 'Tools', exact: false }).first()
const toolsMenu = () => bridge().getByRole('menu', { name: 'Mini Bridge tools', exact: true })
const openBridge = async () => { await page.getByRole('button', { name: 'Manage files', exact: true }).focus(); await page.getByRole('button', { name: 'Manage files', exact: true }).click(); await bridge().waitFor(); await settled() }
const openAssetMenu = async () => { await row().focus(); await page.keyboard.press('Shift+F10'); await assetMenu().waitFor(); await settled() }
const assets = () => page.evaluate(() => structuredClone(window.__bridgeBackend.project.assets))
const sampledContrast = () => bridge().evaluate((dialog) => {
  const rgba = (value) => { const parts = value.match(/[\d.]+/g)?.map(Number); return parts ? [parts[0], parts[1], parts[2], parts[3] ?? 1] : [0, 0, 0, 0] }
  const over = (color, background) => color.slice(0, 3).map((channel, index) => channel * color[3] + background[index] * (1 - color[3]))
  const luminance = (color) => color.map((channel) => channel / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)
  return [...dialog.querySelectorAll('.bridge-inspector-tabs button,.bridge-detail-panel h3,.bridge-identity-panel dt,.asset-row label small,.asset-status,.warning,.open-with-panel strong,.semantic-index-panel strong')].filter((item) => item.getClientRects().length && getComputedStyle(item).visibility !== 'hidden').map((item) => {
    const chain = []; for (let current = item; current; current = current.parentElement) chain.unshift(current)
    const background = chain.reduce((color, current) => over(rgba(getComputedStyle(current).backgroundColor), color), [255, 255, 255])
    const foreground = over(rgba(getComputedStyle(item).color), background)
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    return { text: item.textContent?.trim().slice(0, 90), selector: item.className || item.tagName.toLowerCase(), ratio: Math.round(((values[0] + .05) / (values[1] + .05)) * 100) / 100 }
  })
})
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await page.locator('[data-node-id="bridge-image"]').waitFor(); await settled()
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') { await page.getByRole('button', { name: 'Use light theme', exact: true }).click(); await settled() }
    await openBridge()
    check(`${theme}: search receives modal initial focus`, await bridge().getByRole('searchbox', { name: 'Search assets' }).evaluate((item) => item === document.activeElement))
    check(`${theme}: background Save is inert while Mini Bridge is open`, await page.getByRole('button', { name: 'Save', exact: true, includeHidden: true }).evaluate((item) => Boolean(item.closest('[inert]'))))
    await bridge().locator('.bridge-preview img').waitFor(); await page.waitForFunction(() => document.querySelector('.bridge-preview img')?.naturalWidth > 0)
    check(`${theme}: large preview uses sharp original while catalog keeps thumbnail`, await bridge().locator('.bridge-preview img').evaluate((item) => item.naturalWidth === 2400) && await row().locator('.asset-thumbnail img').evaluate((item) => item.naturalWidth === 128))
    await bridge().getByRole('checkbox', { name: 'Select Tiled reference', exact: true }).check(); await settled(); await page.waitForFunction(() => document.querySelector('.bridge-preview img')?.naturalWidth === 128)
    check(`${theme}: tiled/high-memory image preview stays on safe thumbnail`, await bridge().locator('.bridge-preview img').evaluate((item) => item.naturalWidth === 128))
    await bridge().getByRole('checkbox', { name: 'Select High-resolution source', exact: true }).check(); await settled()
    const catalogGeometry = await bridge().evaluate((dialog) => { const catalog = dialog.querySelector('.asset-catalog'); const card = dialog.querySelector('.asset-row'); const checkbox = card.querySelector('input[type="checkbox"]'); const kind = card.querySelector('.asset-type'); const cardBox = card.getBoundingClientRect(); const checkBox = checkbox.getBoundingClientRect(); return { anchored: checkbox.offsetParent === card, checkboxWithinCard: checkBox.left >= cardBox.left && checkBox.top >= cardBox.top && checkBox.right <= cardBox.right && checkBox.bottom <= cardBox.bottom, typeWidth: kind.getBoundingClientRect().width, catalogBottom: catalog.getBoundingClientRect().bottom, centerBottom: catalog.parentElement.getBoundingClientRect().bottom } })
    check(`${theme}: grid-card checkbox and type metadata stay within scrolling catalog`, catalogGeometry.anchored && catalogGeometry.checkboxWithinCard && catalogGeometry.typeWidth > 100 && catalogGeometry.catalogBottom <= catalogGeometry.centerBottom + 1, catalogGeometry)
    const focusEnds = await bridge().evaluate((dialog) => { const items = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])')].filter((item) => { if (!item.getClientRects().length || item.closest('[inert]') || item.tabIndex < 0 || getComputedStyle(item).visibility === 'hidden') return false; for (let parent = item.parentElement; parent && parent !== dialog; parent = parent.parentElement) if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(item)) return false; return true }); items[0].setAttribute('data-bridge-first', 'true'); items.at(-1).setAttribute('data-bridge-last', 'true'); return items.length })
    await bridge().locator('[data-bridge-last]').focus(); await page.keyboard.press('Tab')
    check(`${theme}: last Tab wraps to first control`, focusEnds > 1 && await bridge().locator('[data-bridge-first]').evaluate((item) => item === document.activeElement), await bridge().evaluate((item) => ({ count: item.querySelectorAll('button,input,select,summary').length, active: document.activeElement?.outerHTML, first: item.querySelector('[data-bridge-first]')?.outerHTML, last: item.querySelector('[data-bridge-last]')?.outerHTML })))
    await page.keyboard.press('Shift+Tab')
    check(`${theme}: first Shift+Tab wraps to last control`, await bridge().locator('[data-bridge-last]').evaluate((item) => item === document.activeElement))
    await tools().focus(); await page.keyboard.press('ArrowDown'); await toolsMenu().waitFor(); await settled()
    check(`${theme}: Tools keyboard opening focuses first action`, await toolsMenu().getByRole('menuitem', { name: /Local upscaler/ }).evaluate((item) => item === document.activeElement))
    await page.keyboard.press('End')
    check(`${theme}: Tools End skips disabled semantic command`, await toolsMenu().getByRole('menuitem', { name: /Scan integrity/ }).evaluate((item) => item === document.activeElement))
    await page.keyboard.press('ArrowDown')
    check(`${theme}: Tools arrows wrap over enabled actions`, await toolsMenu().getByRole('menuitem', { name: /Local upscaler/ }).evaluate((item) => item === document.activeElement))
    await page.keyboard.press('Escape'); await settled()
    check(`${theme}: Escape closes only Tools and restores its trigger`, await toolsMenu().count() === 0 && await bridge().count() === 1 && await tools().evaluate((item) => item === document.activeElement))
    await tools().click(); await toolsMenu().waitFor(); await bridge().getByRole('searchbox').click(); await settled()
    check(`${theme}: click outside Tools dismisses without stealing clicked focus`, await toolsMenu().count() === 0 && await bridge().getByRole('searchbox').evaluate((item) => item === document.activeElement))
    await tools().focus(); await page.keyboard.press('ArrowDown'); await toolsMenu().waitFor(); await settled(); await page.keyboard.press('Tab'); await settled()
    check(`${theme}: Tools Tab dismisses and advances to next dialog control`, await toolsMenu().count() === 0 && await bridge().getByRole('button', { name: 'Pop out', exact: true }).evaluate((item) => item === document.activeElement))
    await openAssetMenu(); await page.keyboard.press('End')
    check(`${theme}: asset action keyboard End focuses recoverable Trash`, await assetMenu().getByRole('menuitem', { name: 'Move to Trash…', exact: true }).evaluate((item) => item === document.activeElement))
    await page.keyboard.press('Escape'); await settled()
    check(`${theme}: asset Escape returns focus to its row`, await assetMenu().count() === 0 && await row().evaluate((item) => item === document.activeElement))
    await openAssetMenu(); await page.keyboard.press('Tab'); await settled()
    check(`${theme}: asset Tab dismisses and advances to its checkbox`, await assetMenu().count() === 0 && await row().getByRole('checkbox').evaluate((item) => item === document.activeElement))
    const originalAssets = await assets()
    await openAssetMenu(); await assetMenu().getByRole('menuitem', { name: 'Rename catalog entry…', exact: true }).click()
    const rename = page.getByRole('dialog', { name: 'Rename catalog entry', exact: true }); await rename.waitFor(); await settled()
    check(`${theme}: nested Rename owns focus instead of fighting Mini Bridge`, await rename.evaluate((item) => item.contains(document.activeElement)) && await bridge().evaluate((item) => item.inert))
    await rename.getByRole('button', { name: 'Cancel', exact: true }).click(); await settled()
    check(`${theme}: Rename Cancel restores Mini Bridge row without editing assets`, await row().evaluate((item) => item === document.activeElement) && !(await bridge().evaluate((item) => item.inert)) && JSON.stringify(await assets()) === JSON.stringify(originalAssets))
    await openAssetMenu(); await assetMenu().getByRole('menuitem', { name: 'Move to Trash…', exact: true }).click()
    const decision = page.getByRole('alertdialog', { name: 'Move asset to Trash', exact: true }); await decision.waitFor(); await settled()
    check(`${theme}: asset deletion defaults to Cancel and suspends Mini Bridge`, await decision.getByRole('button', { name: 'Cancel', exact: true }).evaluate((item) => item === document.activeElement) && await bridge().evaluate((item) => item.inert))
    await decision.getByRole('button').last().focus(); await page.keyboard.press('Tab')
    check(`${theme}: nested confirmation traps Tab`, await decision.getByRole('button').first().evaluate((item) => item === document.activeElement))
    await page.keyboard.press('Escape'); await settled()
    check(`${theme}: Trash Escape returns row focus and creates no recovery record`, await row().evaluate((item) => item === document.activeElement) && JSON.stringify(await assets()) === JSON.stringify(originalAssets) && await page.evaluate(() => window.__bridgeBackend.entries.length) === 0)
    const previewTab = bridge().getByRole('tab', { name: 'preview', exact: true }); await previewTab.focus(); await page.keyboard.press('ArrowRight')
    check(`${theme}: inspector tabs have keyboard selection and named panel`, await bridge().getByRole('tab', { name: 'metadata', exact: true }).getAttribute('aria-selected') === 'true' && await bridge().getByRole('tabpanel', { name: 'metadata' }).count() === 1)
    await page.keyboard.press('End'); check(`${theme}: inspector End selects placements`, await bridge().getByRole('tab', { name: 'placements', exact: true }).getAttribute('aria-selected') === 'true')
    await page.addScriptTag({ path: resolve('node_modules/axe-core/axe.min.js') })
    report.axe[theme] = await page.evaluate(async () => { const result = await window.axe.run('.mini-bridge', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }); return { violations: result.violations.map((item) => ({ id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })) })), incomplete: result.incomplete.map((item) => ({ id: item.id, count: item.nodes.length })) } })
    check(`${theme}: sampled Mini Bridge has no axe violations`, report.axe[theme].violations.length === 0, report.axe[theme])
    await bridge().locator('.bridge-advanced-settings > summary').click(); await settled()
    report.axe[`${theme}-advanced`] = await page.evaluate(async () => { const result = await window.axe.run('.mini-bridge', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }); return { violations: result.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })) })), incomplete: result.incomplete.map((item) => ({ id: item.id, count: item.nodes.length })) } })
    check(`${theme}: expanded advanced-controls axe sample has no violations`, report.axe[`${theme}-advanced`].violations.length === 0, report.axe[`${theme}-advanced`])
    report.contrast[theme] = await sampledContrast()
    check(`${theme}: sampled tabs, labels, status and advanced headings have at least 4.5:1 text contrast`, report.contrast[theme].length > 10 && report.contrast[theme].every((item) => item.ratio >= 4.5), report.contrast[theme])
    await screenshot(`03-advanced-${theme}-1440`)
    await bridge().locator('.bridge-advanced-settings > summary').click(); await settled()
    await screenshot(`01-mini-bridge-${theme}-1440`)
    await page.setViewportSize({ width: 1040, height: 1000 }); await openAssetMenu()
    const bounds = await assetMenu().evaluate((item) => { const box = item.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, topmost: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.asset-item-menu') === item } })
    check(`${theme}: compact asset menu is visible and topmost`, bounds.x >= 0 && bounds.y >= 0 && bounds.right <= 1040 && bounds.bottom <= 1000 && bounds.topmost, bounds)
    await screenshot(`02-asset-menu-${theme}-1040`); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settled()
    check(`${theme}: closing Mini Bridge restores Manage files trigger`, await bridge().count() === 0 && await page.getByRole('button', { name: 'Manage files', exact: true }).evaluate((item) => item === document.activeElement))
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  check('browser raised no unhandled or native-dialog errors', report.browserErrors.length === 0, report.browserErrors)
  report.passed = true
} catch (error) { report.error = String(error); await screenshot('failure').catch(() => undefined); console.error(error) }
finally { await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
