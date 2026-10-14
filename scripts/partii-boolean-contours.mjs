import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { chromium } from 'playwright-core'

const hashes = {}, sources = {}
const compile = async path => {
  const source = await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8')
  sources[path] = source
  hashes[path] = createHash('sha256').update(source).digest('hex')
  return ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
}
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const paperUrl = pathToFileURL(resolve('node_modules/paper/dist/paper-full.js')).href
const booleanCode = await compile('model/vectorBooleanGeometry.ts')
const booleanUrl = url(booleanCode.replace("from 'paper'", `from '${paperUrl}'`))
const vectorUrl = url(await compile('model/vector.ts'))
const themeUrl = url(await compile('canvasTheme.ts'))
const coreUrl = url(await compile('board/diagramStructureCore.ts'))
const connectorsUrl = url(await compile('board/connectors.ts'))
const svgUrl = url((await compile('board/vectorSvg.ts')).replace("from '../model/vector'", `from '${vectorUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`))
const nativeUrl = url((await compile('board/nativeSceneAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from './connectors'", `from '${connectorsUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`).replace("from './vectorSvg'", `from '${svgUrl}'`))
const { resolveVectorBooleanGeometry: resolveGeometry } = await import(booleanUrl)
const { vectorPathData, reverseVectorPath } = await import(vectorUrl)
const { vectorNodeSvgMarkup } = await import(svgUrl)
const { toNativeScene } = await import(nativeUrl)
const generatedAt = new Date().toISOString(), output = resolve('output/partii-boolean-contours', generatedAt.replace(/[:.]/g, '-'))
await mkdir(output, { recursive: true })
const report = { generatedAt, passed: false, checks: [], sourceHashes: hashes, pixels: [], membership: [], limitations: ['Production curve resolver, native payload and SVG browser pixels; actual native GPU/device pixels and real disk restart remain root gates.'] }
const check = (name, condition, detail) => { report.checks.push({ name, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) }); assert(condition, `${name}: ${JSON.stringify(detail)}`) }
const polygon = points => ({ version: 1, closed: true, points: points.map(([x, y]) => ({ x, y })) })
const rectangle = (x, y, width, height) => polygon([[x, y], [x + width, y], [x + width, y + height], [x, y + height]])
const circle = (cx, cy, r) => {
  const k = r * .5522847498307936
  return { version: 1, closed: true, points: [
    { x: cx + r, y: cy, handleIn: { x: 0, y: -k }, handleOut: { x: 0, y: k } },
    { x: cx, y: cy + r, handleIn: { x: k, y: 0 }, handleOut: { x: -k, y: 0 } },
    { x: cx - r, y: cy, handleIn: { x: 0, y: k }, handleOut: { x: 0, y: -k } },
    { x: cx, y: cy - r, handleIn: { x: -k, y: 0 }, handleOut: { x: k, y: 0 } },
  ] }
}
const a = rectangle(20, 20, 120, 100), b = reverseVectorPath(rectangle(70, 40, 100, 100))
const golden = {
  union: [polygon([[20,20],[140,20],[140,40],[170,40],[170,140],[70,140],[70,120],[20,120]])],
  subtract: [polygon([[20,20],[140,20],[140,40],[70,40],[70,120],[20,120]])],
  intersect: [rectangle(70,40,70,80)],
  exclude: [polygon([[20,20],[140,20],[140,40],[70,40],[70,120],[20,120]]), polygon([[140,40],[170,40],[170,140],[70,140],[70,120],[140,120]])],
}
const operations = ['union', 'subtract', 'intersect', 'exclude']
const fixtures = operations.flatMap(operation => [
  { name: `${operation} opposite winding rectangles`, operation, operands: [a, b], golden: golden[operation] },
  { name: `${operation} curved circles`, operation, operands: [circle(90,100,70), reverseVectorPath(circle(140,100,60))] },
  { name: `${operation} self-crossing evenodd`, operation, operands: [polygon([[110,20],[155,170],[30,70],[190,70],[65,170]]), rectangle(80,60,100,80)], fillRules: ['evenodd', 'nonzero'] },
])
fixtures.push({ name: 'subtract hole boundary', operation: 'subtract', operands: [rectangle(20,20,160,160), rectangle(60,60,80,80)], golden: [rectangle(20,20,160,160), reverseVectorPath(rectangle(60,60,80,80))] })
fixtures.push({ name: 'intersect empty', operation: 'intersect', operands: [rectangle(20,20,30,30), rectangle(140,140,30,30)], golden: [] })
fixtures.push({ name: 'subtract identical empty', operation: 'subtract', operands: [a, a], golden: [] })
fixtures.push({ name: 'three-operand intersection', operation: 'intersect', operands: [rectangle(20,20,160,160), rectangle(40,40,120,120), rectangle(60,60,80,80)], golden: [rectangle(60,60,80,80)] })
const makeNode = (fixture, stored = false) => ({ id: fixture.name, title: fixture.name, kind: 'shape', shapeType: 'path', x: 0, y: 0, width: 220, height: 220, vectorPath: fixture.operands[0], vectorBoolean: { operation: fixture.operation, operands: fixture.operands, ...(fixture.fillRules ? { fillRules: fixture.fillRules } : {}), ...(stored ? { resolvedPaths: fixture.result } : {}) }, color: '#dd4422', strokeColor: '#2277bb', strokeWidth: 8, opacity: .7 })
let browser
try {
  for (const fixture of fixtures) {
    fixture.before = JSON.stringify(fixture.operands)
    fixture.result = resolveGeometry(fixture.operation, fixture.operands, fixture.fillRules)
    check(`${fixture.name}: resolves supported contours`, Array.isArray(fixture.result))
    check(`${fixture.name}: immutable-source cache hit`, fixture.result === resolveGeometry(fixture.operation, fixture.operands, fixture.fillRules))
    check(`${fixture.name}: original operand/control data unchanged`, fixture.before === JSON.stringify(fixture.operands))
    check(`${fixture.name}: result is closed with finite coordinates`, fixture.result.every(path => path.closed && path.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))))
    const legacy = makeNode(fixture), stored = makeNode(fixture, true), original = JSON.stringify(legacy)
    const board = { id: 'boolean-fixture', title: 'Disposable', nodes: [legacy], connectors: [] }
    const native = toNativeScene({ id: 'boolean-project', boards: [board] }, board, 'dark', 'derived')
    check(`${fixture.name}: native receives exact derived contours`, JSON.stringify(native.objects[0].payload.resolvedPaths) === JSON.stringify(fixture.result))
    check(`${fixture.name}: native retains original operands and rules`, JSON.stringify(native.objects[0].payload.vectorBoolean) === JSON.stringify(legacy.vectorBoolean))
    check(`${fixture.name}: legacy and stored SVG agree`, vectorNodeSvgMarkup(legacy) === vectorNodeSvgMarkup(stored))
    check(`${fixture.name}: no legacy masking/clip stroke remains`, !/<mask|<clipPath/.test(vectorNodeSvgMarkup(legacy)))
    check(`${fixture.name}: native/SVG derivation does not persist into source`, original === JSON.stringify(legacy))
  }
  check('curved Boolean results retain authored cubic segments', fixtures.filter(fixture => fixture.name.includes('curved')).every(fixture => fixture.result.some(path => path.points.some(point => point.handleIn || point.handleOut))))
  check('disjoint/identical empty results remain explicit empty arrays', fixtures.filter(fixture => fixture.name.includes('empty')).every(fixture => fixture.result.length === 0))
  for (const invalid of [[{ ...a, closed: false }, b], [{ ...a, points: [{ x: NaN, y: 0 }] }, b], []]) check('invalid/open input returns unsupported without mutation', resolveGeometry('union', invalid) === undefined)
  const starOperands = fixtures.find(fixture => fixture.name === 'union self-crossing evenodd').operands
  const evenodd = resolveGeometry('union', starOperands, ['evenodd', 'nonzero']), nonzero = resolveGeometry('union', starOperands, ['nonzero', 'nonzero'])
  check('cache fill-rule signature distinguishes same immutable operands', evenodd !== nonzero)
  const legacyFixture = fixtures.find(fixture => fixture.name === 'intersect self-crossing evenodd')
  const legacyRuleNode = { ...makeNode(legacyFixture), vectorFillRule: 'evenodd', vectorBoolean: { operation: 'intersect', operands: legacyFixture.operands } }
  const explicitRuleNode = { ...legacyRuleNode, vectorBoolean: { ...legacyRuleNode.vectorBoolean, fillRules: ['evenodd', 'evenodd'] } }
  const legacyRuleBoard = { id: 'legacy-fill-rule', title: 'Disposable', nodes: [legacyRuleNode], connectors: [] }
  const legacyRuleNative = toNativeScene({ id: 'boolean-project', boards: [legacyRuleBoard] }, legacyRuleBoard, 'dark', 'legacy-rule')
  check('legacy node-wide evenodd rule matches explicit operand rules in SVG', vectorNodeSvgMarkup(legacyRuleNode) === vectorNodeSvgMarkup(explicitRuleNode))
  check('legacy node-wide evenodd rule reaches derived native contours', JSON.stringify(legacyRuleNative.objects[0].payload.resolvedPaths) === JSON.stringify(resolveGeometry('intersect', legacyFixture.operands, ['evenodd', 'evenodd'])))
  check('resolver cache stays bounded while evicted source results remain exact', (() => {
    const first = resolveGeometry('union', [a, b]), inputs = [a, b], saved = resolveGeometry('union', inputs)
    for (let index = 0; index < 140; index++) resolveGeometry('union', [a, rectangle(index + 300, 20, 20, 20)])
    const after = resolveGeometry('union', inputs)
    return saved !== after && JSON.stringify(saved) === JSON.stringify(after) && Array.isArray(first)
  })())
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
  const page = await browser.newPage()
  await page.addScriptTag({ path: resolve('node_modules/paper/dist/paper-full.js') })
  const browserBooleanUrl = url(booleanCode.replace("from 'paper'", `from '${url('export default window.paper')}'`))
  const browserResults = await page.evaluate(async ({ moduleUrl, fixtures }) => {
    const { resolveVectorBooleanGeometry } = await import(moduleUrl)
    return fixtures.map(fixture => resolveVectorBooleanGeometry(fixture.operation, fixture.operands, fixture.fillRules))
  }, { moduleUrl: browserBooleanUrl, fixtures })
  check('browser Paper module without canvas dependency matches Node exact contours', JSON.stringify(browserResults) === JSON.stringify(fixtures.map(fixture => fixture.result)))
  report.membership = await page.evaluate(fixtures => fixtures.map(fixture => {
    const context = document.createElement('canvas').getContext('2d')
    const source = fixture.paths.map(path => new Path2D(path)), result = new Path2D(fixture.result)
    let samples = 0, mismatches = 0
    for (let y = 1.137; y < 219; y += 2) for (let x = 1.731; x < 219; x += 2) {
      const inside = source.map((path, index) => context.isPointInPath(path, x, y, fixture.fillRules?.[index] ?? 'nonzero'))
      const expected = fixture.operation === 'union' ? inside.some(Boolean) : fixture.operation === 'subtract' ? inside[0] && !inside.slice(1).some(Boolean) : fixture.operation === 'intersect' ? inside.every(Boolean) : inside.filter(Boolean).length % 2 === 1
      if (context.isPointInPath(result, x, y, 'nonzero') !== expected) mismatches++
      samples++
    }
    return { name: fixture.name, samples, mismatches }
  }), fixtures.map(fixture => ({ name: fixture.name, operation: fixture.operation, fillRules: fixture.fillRules, paths: fixture.operands.map(vectorPathData), result: fixture.result.map(vectorPathData).join(' ') })))
  for (const value of report.membership) check(`${value.name}: independent source-set membership`, value.mismatches === 0, value)
  // Compare independent golden result geometry with one object-opacity group.
  const goldenPixels = await page.evaluate(async fixtures => {
    const output = []
    const raster = async (svg, scale) => {
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(240 * scale); canvas.height = Math.ceil(240 * scale)
      const context = canvas.getContext('2d'); context.scale(scale, scale)
      const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode(); context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, canvas.width, canvas.height).data
    }
    for (const fixture of fixtures) for (const scale of [.05, .5, 1, 2]) {
      const actual = await raster(fixture.svg, scale), expected = await raster(fixture.goldenSvg, scale)
      let changedChannels = 0, maximumDelta = 0
      for (let index = 0; index < expected.length; index++) { const delta = Math.abs(actual[index] - expected[index]); if (delta) changedChannels++; maximumDelta = Math.max(maximumDelta, delta) }
      output.push({ name: fixture.name, scale, changedChannels, maximumDelta })
    }
    return output
  }, fixtures.filter(fixture => fixture.golden).map(fixture => ({ name: fixture.name, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">${vectorNodeSvgMarkup(makeNode(fixture))}</svg>`, goldenSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g opacity=".7"><path d="${fixture.golden.map(vectorPathData).join(' ')}" fill="#dd4422" fill-rule="nonzero" stroke="#2277bb" stroke-width="8" stroke-linejoin="miter" stroke-linecap="butt"/></g></svg>` })))
  report.pixels = goldenPixels
  for (const value of goldenPixels) check(`${value.name}: independent result-boundary SVG pixels at ${value.scale * 100}%`, value.changedChannels === 0, value)
  const afterHashes = Object.fromEntries(await Promise.all(Object.keys(hashes).map(async path => [path, createHash('sha256').update(await readFile(new URL(`../src/${path}`, import.meta.url))).digest('hex')])))
  check('all production fingerprints stable during run', JSON.stringify(afterHashes) === JSON.stringify(hashes))
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 } finally { await browser?.close() }
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, membershipCases: report.membership.length, pixelCases: report.pixels.length, error: report.error?.split('\n')[0], output }))
