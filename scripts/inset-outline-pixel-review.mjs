import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import ts from 'typescript'

// Independent static outline probe. It does not run the production GPU engine,
// disable its animation, or provide production acceptance timing evidence.
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const measuredUrl = url(compile(await readFile(new URL('../src/board/measuredCardPaint.ts', import.meta.url), 'utf8')))
const { normalizeCornerRadii, normalizeMeasuredColor } = await import(measuredUrl)
const backgroundUrl = url(compile(await readFile(new URL('../src/board/measuredBackgroundPaint.ts', import.meta.url), 'utf8')).replace(/from ['"]\.\/measuredCardPaint(?:\.ts)?['"]/g, `from '${measuredUrl}'`))
const source = compile(await readFile(new URL('../src/board/completeMeasuredCardPaint.ts', import.meta.url), 'utf8')).replace(/from ['"]\.\/measuredCardPaint(?:\.ts)?['"]/g, `from '${measuredUrl}'`).replace(/from ['"]\.\/measuredBackgroundPaint(?:\.ts)?['"]/g, `from '${backgroundUrl}'`)
const { compileCompleteCardPaint, measuredInsetSolidOutline } = await import(url(source))
const output = resolve(process.argv[2] || `../output/playwright/inset-outline-${Date.now()}`)
await mkdir(output, { recursive: true })
const css = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style><style>html,body{margin:0;background:#0b1118}.studio-shell{display:flex!important;gap:24px!important;width:1000px!important;height:700px!important;background:#0b1118!important}.sample{position:relative;width:420px;height:650px;flex:none;overflow:hidden}.sample>article,.sample>svg{position:absolute;left:24px;top:24px;transform-origin:0 0}.sample>article{width:364px;height:606px;background:#13202c!important;border:0!important;box-shadow:none!important;transition:none!important}.sample>svg{width:364px;height:606px;overflow:visible}.sample svg path{fill:#67cdc3;fill-rule:evenodd}</style></head><body><main class="studio-shell"><div class="sample" id="dom"><article class="board-node node-column node-graph-column"></article></div><div class="sample" id="compiled"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 364 606"><rect width="364" height="606" fill="#13202c"/><path/></svg></div></main></body></html>'
const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const executablePath = process.env.UI_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
let browser
try {
  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const measured = await page.locator('article').evaluate(element => { const style = getComputedStyle(element); return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, outlineColor: style.outlineColor, backgroundColor: style.backgroundColor, radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius] } })
  const size = { width: 364, height: 606 }, radii = normalizeCornerRadii(measured.radii, size)
  assert(radii && measuredInsetSolidOutline(measured), 'Actual production Node Column outline must meet the narrow measured gate')
  const result = compileCompleteCardPaint({ id: 'column', size, radii, transform: [1, 0, 0, 1, 0, 0], background: normalizeMeasuredColor(measured.backgroundColor), gradients: [], shadows: [], borderWidths: [0, 0, 0, 0], borderColors: ['#00000000', '#00000000', '#00000000', '#00000000'], opacity: 1, clipContent: false, isolation: 'auto', blendMode: 'normal', zIndex: 0, sourceOrder: 0, contributions: [], children: [], insetOutline: measuredInsetSolidOutline(measured) }, { objectId: 'column', objectRevision: 1, order: 0, layoutRevision: 1, sourceFingerprint: 'actual-css-inset-ring-pixels' })
  assert(result.completePaint)
  const ring = result.operations.find(operation => operation.type === 'vector' && operation.object.id.endsWith(':inset-outline'))
  const path = ring.object.payload.commands.map(command => command.join(' ')).join(' ')
  await page.locator('svg path').evaluate((element, path) => element.setAttribute('d', path), path)
  // Match the measured outer corner rather than changing the production CSS.
  const outer = result.operations.find(operation => operation.type === 'vector' && operation.object.id.endsWith(':background'))
  await page.locator('svg rect').evaluate((element, paint) => { const replacement = document.createElementNS('http://www.w3.org/2000/svg', 'path'); replacement.setAttribute('d', paint.path); replacement.setAttribute('style', `fill:${paint.fill};fill-rule:nonzero`); element.replaceWith(replacement) }, { path: outer.object.payload.commands.map(command => command.join(' ')).join(' '), fill: outer.object.payload.fill })
  const reviews = []
  for (const scale of [1, .5387900761681397, .25]) {
    await page.evaluate(scale => { for (const element of document.querySelectorAll('.sample>article,.sample>svg')) element.style.transform = `scale(${scale})` }, scale)
    const dom = await page.locator('#dom').screenshot(), compiled = await page.locator('#compiled').screenshot()
    await writeFile(resolve(output, `dom-${scale}.png`), dom); await writeFile(resolve(output, `compiled-${scale}.png`), compiled)
    const left = await sharp(dom).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), right = await sharp(compiled).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.deepEqual(left.info, right.info)
    let different = 0, maxDelta = 0, error = 0
    for (let index = 0; index < left.data.length; index += 4) { let delta = 0; for (let channel = 0; channel < 3; channel++) delta = Math.max(delta, Math.abs(left.data[index + channel] - right.data[index + channel])); if (delta) different++; maxDelta = Math.max(maxDelta, delta); error += delta }
    const pixels = left.info.width * left.info.height
    reviews.push({ scale, pixels, different, maxDelta, meanMaxChannelDelta: error / pixels, identical: different === 0 })
  }
  await writeFile(resolve(output, 'review.json'), JSON.stringify({ scope: 'CHROMIUM_STATIC_INSET_OUTLINE_PIXEL_REVIEW_ONLY', measured, reviews, productionQualification: false }, null, 2))
  console.log(JSON.stringify({ output, reviews, qualification: false }, null, 2))
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
