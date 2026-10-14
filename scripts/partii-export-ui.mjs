import { geometryModuleUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import ts from 'typescript'

// Only fresh browser contexts and an in-memory Tauri stub are used. Clipboard
// writes are intercepted inside the test page, never sent to the host clipboard.
const model = ts.transpileModule(await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject } = await import(`data:text/javascript;base64,${Buffer.from(model).toString('base64')}`)
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compileSource = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const themeUrl = moduleUrl(await compileSource('../src/canvasTheme.ts'))
const connectorUrl = moduleUrl(await compileSource('../src/board/connectors.ts'))
const coreUrl = moduleUrl(await compileSource('../src/board/diagramStructureCore.ts'))
const paperUrl = pathToFileURL(resolve('node_modules/paper/dist/paper-full.js')).href
const booleanUrl = moduleUrl((await compileSource('../src/model/vectorBooleanGeometry.ts')).replace("from 'paper'", `from '${paperUrl}'`))
const vectorUrl = moduleUrl(await compileSource('../src/model/vector.ts'))
const svgUrl = moduleUrl((await compileSource('../src/board/vectorSvg.ts')).replace("from '../model/vector'", `from '${vectorUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`))
const { toNativeScene } = await import(moduleUrl((await compileSource('../src/board/nativeSceneAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './connectors'", `from '${connectorUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`).replace("from './vectorSvg'", `from '${svgUrl}'`)))
const { createArtEquationCanvasScene } = await import(moduleUrl((await compileSource('../src/board/artEquationCanvasAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`)))
const { eligibleVelloObjects } = await import(moduleUrl(await compileSource('../src/board/velloEligibility.ts')))
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-export')
await mkdir(artifacts, { recursive: true })
const report = { passed: false, generatedAt: new Date().toISOString(), baseUrl, checks: [], screenshots: [], browserErrors: [], alerts: [], limitation: 'Actual React Copy SVG and Flatten interactions in isolated headless Edge. SVG raster pixels checked. Native GPU pixels, real export dialog/files, production asset formats and physical DPI are not established.' }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()
const portrait = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 200; const c = canvas.getContext('2d'); c.fillStyle = '#00ffff'; c.fillRect(0, 0, 100, 200); return canvas.toDataURL('image/png') })
const path = { version: 1, closed: true, points: [{ x: 0, y: 100 }, { x: 80, y: 0 }, { x: 160, y: 100 }] }
const rectangle = { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 100 }, { x: 0, y: 100 }] }
const cutter = { version: 1, closed: true, points: [{ x: 45, y: -20 }, { x: 65, y: -20 }, { x: 65, y: 120 }, { x: 45, y: 120 }] }
const node = (id, x, y, width, height, extra = {}) => ({ id, kind: 'shape', shapeType: 'rectangle', x, y, width, height, title: id, color: '#a07030', strokeColor: '#a07030', strokeWidth: 4, opacity: 1, ...extra })
const fixture = createBlankProject('Part II isolated export QA')
fixture.id = 'partii-export-isolated'
fixture.assets = []
fixture.boards = [{ id: 'export-root', title: 'Export root', linkedFolderPath: `projects/${fixture.id}/boards/export-root`, backgroundColor: '#101010', backgroundFollowsTheme: false, gridVisible: false, viewport: { x: 0, y: 0, scale: 1 },
  nodes: [node('transformed-path', 180, 80, 160, 100, { shapeType: 'path', vectorPath: path, rotation: 12, opacity: .8, vectorTransform: { scaleX: -1, scaleY: 1, skewX: 18, skewY: 9, translateX: 7 } }), node('rotated-rect', 430, 90, 100, 80, { rotation: 30, opacity: .4, color: '#ff0000', strokeColor: '#ff0000', cornerRadius: 0 }), node('rotated-ellipse', 650, 90, 120, 50, { shapeType: 'ellipse', rotation: 45, opacity: .6, color: '#00ff00', strokeColor: '#00ff00' }), node('erased-path', 200, 320, 120, 100, { shapeType: 'path', vectorPath: rectangle, vectorBoolean: { operation: 'subtract', operands: [rectangle, cutter] }, color: '#ff8800', strokeColor: '#ff8800', strokeWidth: 8 }), node('portrait-image', 430, 310, 140, 180, { kind: 'image', shapeType: undefined, body: portrait, rotation: 15, opacity: .5, imageTransform: { opacity: .6, rotation: 90, flipX: true } })],
  connectors: [{ id: 'colored-labeled-link', sourceId: 'rotated-rect', targetId: 'rotated-ellipse', sourcePort: 'right', targetPort: 'left', style: 'curve', color: '#c040d0', width: 3, dashed: true, startArrow: true, endArrow: true, animated: false, label: 'Source <A> & Target' }], }]
await page.addInitScript((initial) => {
  const backend = { project: structuredClone(initial), calls: [], clipboard: [] }
  window.__exportBackend = backend
  localStorage.setItem('art-equation.navigator', '0'); localStorage.setItem('art-equation.inspector', '0'); localStorage.setItem('art-equation.canvas-tools', '1'); localStorage.setItem('art-equation.view-mode', 'canvas')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => backend.clipboard.push(text) } })
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (value) => value,
    invoke: async (command, args = {}) => {
      backend.calls.push({ command, args: structuredClone(args) })
      if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'isolated-export', readOnly: false, lockOwned: true }
      if (command === 'list_projects') return [{ id: backend.project.id, title: backend.project.title, updatedAt: backend.project.updatedAt, boardCount: 1, assetCount: 0, status: backend.project.status }]
      if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? { schemaVersion: 5, theme: 'dark', viewMode: 'canvas', activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'export-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:export-root', viewMode: 'canvas' } } } : backend.project)
      if (command === 'save_json') { if (args.relativePath.endsWith('/project.json')) backend.project = structuredClone(args.value); return }
      if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten'].includes(command)) return
      if (['list_project_trash', 'list_trashed_projects', 'audit_assets'].includes(command)) return []
      if (['plugin:event|listen', 'plugin:window|scale_factor'].includes(command)) return 1
      if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
      if (command === 'mini_bridge_launch') return null
      throw new Error(`Isolated export mock does not permit ${command}`)
    } }
}, fixture)
page.on('pageerror', (error) => report.browserErrors.push(error.message))
page.on('dialog', async (dialog) => { report.alerts.push(dialog.message()); await dialog.accept() })
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
const byId = (id) => page.locator(`.board-node[data-node-id="${id}"]`)
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), detail }); assert(passed, `${name}${detail ? `: ${JSON.stringify(detail)}` : ''}`) }
const screenshot = async (name) => { await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true }); report.screenshots.push(`${name}.png`) }
async function choose(id, additive = false) {
  const item = byId(id), hit = item.locator('.shape-hit-area')
  let point
  if (await hit.count()) point = await hit.evaluate((path, id) => {
    for (const fraction of [.35, .65, .8, .1, .5, .9]) {
      const p = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(path.getScreenCTM())
      if (document.elementFromPoint(p.x, p.y)?.closest('.board-node')?.getAttribute('data-node-id') === id) return { x: p.x, y: p.y }
    }
    throw new Error(`No visible pointer target on fixture ${id}; do not force through a connector`)
  }, id)
  else { const b = await item.boundingBox(); point = { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  if (additive) await page.keyboard.down('Shift')
  await page.mouse.click(point.x, point.y)
  if (additive) await page.keyboard.up('Shift')
  await settled()
  assert(await item.evaluate((node) => node.classList.contains('selected')), `Fixture ${id} was not actually selected`)
}
async function menuFor(id) { const box = await byId(id).boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' }); await page.getByRole('menu', { name: 'Canvas context menu' }).waitFor(); await settled() }
async function saveFixture() { const before = await page.evaluate(() => window.__exportBackend.calls.length); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForFunction((before) => window.__exportBackend.calls.slice(before).some((call) => call.command === 'save_json' && call.args.relativePath.endsWith('/project.json')), before); return page.evaluate(() => structuredClone(window.__exportBackend.project)) }
try {
  const plain = node('plain-locked', 950, 80, 160, 100, { shapeType: 'path', vectorPath: path, locked: true })
  const routingBoard = { ...fixture.boards[0], nodes: [...fixture.boards[0].nodes.map((entry) => ({ ...entry, locked: true, rotation: 0 })), plain] }
  const routingScene = createArtEquationCanvasScene(routingBoard, [], { background: '#101010', grid: '#444444' })
  const routedIds = eligibleVelloObjects(routingScene, []).map((item) => item.id)
  check('Vello adapter preserves Boolean/inner transform semantics and routes complex locked paths to SVG fallback', routingScene.objects.find((item) => item.id === 'erased-path').vectorBoolean.operation === 'subtract' && routingScene.objects.find((item) => item.id === 'transformed-path').vectorTransform.skewY === 9 && JSON.stringify(routedIds) === '["plain-locked"]', routedIds)
  check('selected locked path is immediately DOM-owned', eligibleVelloObjects(routingScene, ['plain-locked']).length === 0)
  const artwork = { ...fixture.boards[0], nodes: [{ ...fixture.boards[0].nodes.at(-1), imagePresentation: 'artwork' }] }
  const nativeArtwork = toNativeScene({ id: fixture.id, boards: [artwork] }, artwork, 'dark', 'artwork-1')
  const nativeCard = toNativeScene(fixture, fixture.boards[0], 'dark', 'card-1')
  check('native payload retains artwork presentation and legacy/imported images default to cards', nativeArtwork.objects[0].payload.imagePresentation === 'artwork' && nativeCard.objects.at(-1).payload.imagePresentation === 'card')
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }); await byId('transformed-path').waitFor(); await page.getByRole('button', { name: 'Canvas', exact: true }).click(); await page.getByRole('button', { name: 'Select and move', exact: true }).click(); await settled()
  const loaded = await saveFixture()
  for (const [index, entry] of fixture.boards[0].nodes.entries()) await choose(entry.id, index > 0)
  check('all five fixture objects are selected through normal UI pointer input', await page.locator('.board-node.selected').count() === 5)
  await screenshot('01-mixed-export-selection')
  await menuFor('transformed-path'); await page.getByRole('menu', { name: 'Canvas context menu' }).getByRole('menuitem', { name: 'Copy SVG', exact: true }).click()
  await page.waitForFunction(() => window.__exportBackend.clipboard.length === 1)
  const svg = await page.evaluate(() => window.__exportBackend.clipboard[0])
  await writeFile(resolve(artifacts, 'selection.svg'), svg)
  const parsed = await page.evaluate((svg) => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'), root = doc.documentElement
    const ancestors = (item) => { const list = []; for(let p = item?.parentElement; p && p !== root; p = p.parentElement) list.push({ tag: p.tagName, transform: p.getAttribute('transform'), opacity: p.getAttribute('opacity'), mask: p.getAttribute('mask'), clip: p.getAttribute('clip-path') }); return list }
    const shape = (selector) => { const item = doc.querySelector(selector); return item ? { markup: item.outerHTML, ancestors: ancestors(item), opacity: item.getAttribute('opacity'), fillOpacity: item.getAttribute('fill-opacity') } : null }
    const link = doc.querySelector('path[stroke="#c040d0"]'), markerId = link?.getAttribute('marker-end')?.match(/#([^)]*)/)?.[1]
    return { parseError: doc.querySelector('parsererror')?.textContent, viewBox: root.getAttribute('viewBox').split(/\s+/).map(Number), transformed: shape('path[fill="#a07030"]'), erased: shape('path[fill="#ff8800"]'), rect: shape('rect[fill="#ff0000"]'), ellipse: shape('ellipse[fill="#00ff00"]'), image: shape('image'), imageFit: doc.querySelector('image')?.getAttribute('preserveAspectRatio'), imageOpacity: doc.querySelector('image')?.getAttribute('opacity'), link: link?.outerHTML, marker: markerId ? doc.getElementById(markerId)?.outerHTML : null, label: [...doc.querySelectorAll('text')].find((item) => item.textContent === 'Source <A> & Target')?.outerHTML, maskCount: doc.querySelectorAll('mask').length }
  }, svg)
  report.svg = parsed
  check('Copy SVG returns a valid standalone SVG with real embedded image source', !parsed.parseError && parsed.image?.markup.includes('data:image/png;base64,') && !svg.includes('[object Promise]'))
  check('transformed path preserves both skews, flip and outer rotation', parsed.transformed?.ancestors.some((item) => item.transform?.includes('skewX(18)') && item.transform.includes('skewY(9)') && item.transform.includes('scale(-1 1)')) && parsed.transformed.ancestors.some((item) => item.transform?.includes('rotate(12')))
  check('erased path exports resolved boundaries with coherent fill and stroke', parsed.maskCount === 0 && parsed.erased?.markup.includes('stroke="#ff8800"') && parsed.erased.markup.includes('fill-rule="nonzero"'))
  const objectAlpha = (shape) => Number(shape?.opacity ?? 1) * shape?.ancestors.reduce((alpha, item) => alpha * Number(item.opacity ?? 1), 1)
  const hasRotation = (shape, degrees) => shape?.ancestors.some((item) => item.transform?.includes(`rotate(${degrees}`)) || shape?.markup.includes(`rotate(${degrees}`)
  check('rotated rectangle preserves 30 degree rotation and whole-object .4 alpha', hasRotation(parsed.rect, 30) && Math.abs(objectAlpha(parsed.rect) - .4) < 1e-9, parsed.rect)
  check('rotated ellipse preserves 45 degree rotation and whole-object .6 alpha', hasRotation(parsed.ellipse, 45) && Math.abs(objectAlpha(parsed.ellipse) - .6) < 1e-9, parsed.ellipse)
  const imageRect = await page.evaluate((svg) => { const e = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('image'); return ['x','y','width','height'].map((key) => Number(e.getAttribute(key))) }, svg)
  check('image preserves explicit contain rectangle and object/image alpha product .3', parsed.imageFit === 'none' && JSON.stringify(imageRect) === '[455,310,90,180]' && Math.abs(objectAlpha(parsed.image) - .3) < 1e-9, { fit: parsed.imageFit, rectangle: imageRect, alpha: objectAlpha(parsed.image) })
  check('connector keeps both arrows, its own marker color, dashed style and escaped label', parsed.link?.includes('marker-start=') && parsed.link.includes('marker-end=') && parsed.link.includes('stroke-dasharray=') && parsed.marker?.includes('fill="#c040d0"') && parsed.marker.includes('auto-start-reverse') && parsed.label?.includes('&lt;A&gt; &amp; Target'))
  const pixels = await page.evaluate(async (svg) => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'), view = doc.documentElement.getAttribute('viewBox').split(/\s+/).map(Number)
    const image = new Image(); const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject }); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await loaded
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const c = canvas.getContext('2d'); c.drawImage(image, 0, 0)
    const pixel = (x, y) => [...c.getImageData(Math.round((x - view[0]) * image.width / view[2]), Math.round((y - view[1]) * image.height / view[3]), 1, 1).data]
    const rawAlpha = { rectangle: pixel(480, 130)[3], ellipse: pixel(710, 115)[3], eraseGap: pixel(255, 320)[3], image: pixel(500, 400)[3] }
    c.globalCompositeOperation = 'destination-over'; c.fillStyle = '#101010'; c.fillRect(0, 0, canvas.width, canvas.height)
    return { rawAlpha, rectangle: pixel(480, 130), ellipse: pixel(710, 115), eraseGap: pixel(255, 320), eraseOutline: pixel(220, 320), image: pixel(500, 400) }
  }, svg)
  report.pixels = pixels
  const near = (actual, expected) => actual.every((value, index) => Math.abs(value - expected[index]) <= 2)
  check('rendered exported rectangle and ellipse pixels apply alpha once', near(pixels.rectangle, [112, 10, 10, 255]) && near(pixels.ellipse, [6, 159, 6, 255]), pixels)
  check('selection export preserves real transparency for artwork and erased gaps', Math.abs(pixels.rawAlpha.rectangle - 102) <= 1 && Math.abs(pixels.rawAlpha.ellipse - 153) <= 1 && pixels.rawAlpha.eraseGap === 0 && Math.abs(pixels.rawAlpha.image - 77) <= 1, pixels.rawAlpha)
  check('exported Eraser removes original outline at gap but preserves untouched outline', near(pixels.eraseGap, [16, 16, 16, 255]) && near(pixels.eraseOutline, [255, 136, 0, 255]), pixels)
  check('exported image pixel combines .5 object and .6 image opacity', near(pixels.image, [11, 88, 88, 255]), pixels)
  await menuFor('transformed-path'); await page.getByRole('menu', { name: 'Canvas context menu' }).getByRole('menuitem', { name: 'Flatten selected', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.board-node').length === 6); await settled()
  const after = await saveFixture(), flattened = after.boards[0].nodes.find((item) => item.title === 'Flattened selection')
  check('Flatten adds artwork-only valid SVG rather than a Promise string', flattened?.imagePresentation === 'artwork' && flattened.body.startsWith('data:image/svg+xml;charset=utf-8,') && decodeURIComponent(flattened.body.split(',').slice(1).join(',')).startsWith('<svg ') && !flattened.body.includes('Promise'), { id: flattened?.id, presentation: flattened?.imagePresentation, encodedBytes: flattened?.body.length })
  const sourceChanges = loaded.boards[0].nodes.filter((original) => !after.boards[0].nodes.some((item) => item.id === original.id && JSON.stringify(item) === JSON.stringify(original))).map((item) => item.id)
  check('Flatten retains the actual loaded editable source objects without changes', sourceChanges.length === 0, sourceChanges)
  const [left, top, width, height] = parsed.viewBox
  check('Flatten frame matches exported viewBox without padding-related geometry shift', Math.abs(flattened.x - left) < .001 && Math.abs(flattened.y - top) < .001 && Math.abs(flattened.width - width) < .001 && Math.abs(flattened.height - height) < .001, { frame: { x: flattened.x, y: flattened.y, width: flattened.width, height: flattened.height }, viewBox: parsed.viewBox })
  await screenshot('02-flattened-preserving-sources')
  await byId(flattened.id).locator('.format-image-preview > img').waitFor()
  const originalRect = await byId('rotated-rect').boundingBox()
  const flattenedPlacement = await byId(flattened.id).locator('.format-image-preview > img').evaluate((image, { viewBox, worldPoint, originalCenter }) => {
    const box = image.getBoundingClientRect(), scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight)
    const point = { x: box.x + (box.width - image.naturalWidth * scale) / 2 + (worldPoint.x - viewBox[0]) / viewBox[2] * image.naturalWidth * scale, y: box.y + (box.height - image.naturalHeight * scale) / 2 + (worldPoint.y - viewBox[1]) / viewBox[3] * image.naturalHeight * scale }
    return { projectedPoint: point, originalCenter, error: Math.hypot(point.x - originalCenter.x, point.y - originalCenter.y), imageFit: getComputedStyle(image).objectFit, previewHeight: box.height }
  }, { viewBox: parsed.viewBox, worldPoint: { x: 480, y: 130 }, originalCenter: { x: originalRect.x + originalRect.width / 2, y: originalRect.y + originalRect.height / 2 } })
  check('Flatten preserves displayed artwork coordinates as well as saved bounds', flattenedPlacement.error <= 2, flattenedPlacement)
  check('no real filesystem/export operation or host clipboard was permitted', !report.alerts.length && !(await page.evaluate(() => window.__exportBackend.calls)).some((call) => ['export_binary', 'import_file', 'delete_file'].includes(call.command)))
  check('UI export flow raised no browser errors', !report.browserErrors.length, report.browserErrors)
  report.passed = report.checks.every((item) => item.passed)
} catch (error) { report.failure = String(error.stack || error); await screenshot('failure').catch(() => {}) }
finally { await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(`Part II export UI: ${report.passed ? 'PASS' : 'FAIL'} (${report.checks.filter((item) => item.passed).length}/${report.checks.length} checks). Report: ${resolve(artifacts, 'report.json')}`)
if (!report.passed) { console.error(report.failure); process.exitCode = 1 }
