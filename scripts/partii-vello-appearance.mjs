import { geometryModuleUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
import { chromium } from 'playwright-core'

// Actual board projection and runtime serialization. Independent board-style
// Path2D pixels check meaning, without launching any native or production app.
const files = ['src/canvas-engine/contracts.ts', 'src/board/artEquationCanvasAdapter.ts', 'src/board/VelloBoardBackdrop.tsx', 'src/board/velloEligibility.ts', 'src/board/diagramStructureCore.ts', 'src/model/vector.ts', 'src/canvasTheme.ts']
const texts = await Promise.all(files.map(file => readFile(file, 'utf8')))
const hashes = Object.fromEntries(files.map((file, i) => [file, createHash('sha256').update(texts[i]).digest('hex')]))
const code = path => ts.transpileModule(texts[files.indexOf(path)], { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const themeUrl = url(code('src/canvasTheme.ts')), coreUrl = url(code('src/board/diagramStructureCore.ts'))
const adapterUrl = url(code('src/board/artEquationCanvasAdapter.ts').replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`))
const eligibilityUrl = url(code('src/board/velloEligibility.ts'))
const reactUrl = url('export const useEffect=()=>{},useLayoutEffect=()=>{},useRef=()=>{};')
const rendererUrl = url('export function createVelloPresenter(){throw new Error("Native GPU is not authorized by this regression")}')
const backdropUrl = url(code('src/board/VelloBoardBackdrop.tsx').replace(/import\s+['"]\.\/VelloBoardBackdrop\.css['"];?\s*/g, '').replace("from 'react'", `from '${reactUrl}'`).replace("from '../project-b/p0-surface/presenter'", `from '${rendererUrl}'`).replace("from './velloEligibility'", `from '${eligibilityUrl}'`))
const { createArtEquationCanvasScene } = await import(adapterUrl)
const { velloBoardSnapshot } = await import(backdropUrl)
const { vectorPathData } = await import(url(code('src/model/vector.ts')))

const timestamp = new Date().toISOString(), output = resolve('output/partii-vello-appearance', timestamp.replace(/[:.]/g, '-'))
await mkdir(output, { recursive: true })
const report = { generatedAt: timestamp, passed: false, sourceHashes: hashes, checks: [], pixelResults: [], limitations: ['Actual production board projection/serializer and isolated browser Path2D meaning only; native Vello GPU pixels and final EXE remain separate acceptance.'] }
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) }); assert(passed, `${name}: ${JSON.stringify(detail)}`) }
const closedPoints = [{ x: 120, y: 20 }, { x: 181, y: 200 }, { x: 25, y: 85 }, { x: 215, y: 85 }, { x: 59, y: 200 }]
const openPoints = [{ x: 30, y: 120 }, { x: 100, y: 50 }, { x: 180, y: 170 }]
const variants = []
for (const closed of [true, false]) for (const fill of ['evenodd', 'nonzero']) for (const join of ['round', 'bevel', 'miter']) for (const cap of ['round', 'square', 'butt']) {
  variants.push({ name: `${closed ? 'closed' : 'open'} ${fill}/${join}/${cap}`, closed, vectorFillRule: fill, vectorStrokeJoin: join, vectorStrokeCap: cap })
}
variants.push({ name: 'legacy closed defaults', closed: true }, { name: 'legacy open defaults', closed: false })
const cases = variants.map((variant, index) => {
  const node = { id: `style-${index}`, kind: 'shape', shapeType: 'path', x: 0, y: 0, width: 240, height: 240, title: variant.name, locked: true, strokeWidth: 14, color: '#dd4422', strokeColor: '#2277bb', opacity: .7, vectorPath: { version: 1, closed: variant.closed, points: structuredClone(variant.closed ? closedPoints : openPoints) }, ...(variant.vectorFillRule ? { vectorFillRule: variant.vectorFillRule, vectorStrokeJoin: variant.vectorStrokeJoin, vectorStrokeCap: variant.vectorStrokeCap } : {}) }
  const board = { id: 'style-fixture', nodes: [node], connectors: [] }, before = JSON.stringify(board)
  const scene = createArtEquationCanvasScene(board, [], { background: '#00000000', grid: '#444444' })
  const snapshot = JSON.parse(velloBoardSnapshot(scene, []).json)
  return { name: variant.name, board, before, scene, payload: snapshot.objects[0]?.payload, node, path: vectorPathData(node.vectorPath) }
})

let browser
try {
  for (const fixture of cases) {
    const appearance = fixture.scene.objects[0].appearance
    for (const [field, fallback] of [['vectorFillRule', 'nonzero'], ['vectorStrokeJoin', 'miter'], ['vectorStrokeCap', 'butt']]) {
      check(`${fixture.name}: board-to-engine ${field}`, appearance[field] === fixture.node[field], { expected: fixture.node[field], actual: appearance[field] })
      check(`${fixture.name}: engine-to-Vello ${field}`, fixture.payload[field] === (fixture.node[field] ?? fallback), { expected: fixture.node[field] ?? fallback, actual: fixture.payload[field] })
    }
    check(`${fixture.name}: source records unchanged`, JSON.stringify(fixture.board) === fixture.before)
    check(`${fixture.name}: selected path remains DOM-owned`, velloBoardSnapshot(fixture.scene, [fixture.node.id]).ids.size === 0)
    const boolean = { ...fixture.scene.objects[0], id: 'boolean', vectorBoolean: { operation: 'subtract', operands: [fixture.node.vectorPath, fixture.node.vectorPath] } }
    const transformed = { ...fixture.scene.objects[0], id: 'transformed', vectorTransform: { skewX: 10 } }
    const hidden = { ...fixture.scene.objects[0], id: 'hidden', hidden: true }
    const rotated = { ...fixture.scene.objects[0], id: 'rotated', appearance: { ...appearance, rotation: 30 } }
    const fallbackScene = { ...fixture.scene, objects: [boolean, transformed, hidden, rotated] }
    check(`${fixture.name}: complex/hidden/rotated fallbacks are excluded`, velloBoardSnapshot(fallbackScene, []).ids.size === 0)
    check(`${fixture.name}: fallback style metadata is retained`, fallbackScene.objects.every(object => object.appearance.vectorFillRule === fixture.node.vectorFillRule && object.appearance.vectorStrokeJoin === fixture.node.vectorStrokeJoin && object.appearance.vectorStrokeCap === fixture.node.vectorStrokeCap))
  }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
  const page = await browser.newPage()
  report.pixelResults = await page.evaluate(fixtures => fixtures.flatMap(fixture => [.5, 1, 2].map(scale => {
    const paint = (fillRule, join, cap) => {
      const canvas = document.createElement('canvas'); canvas.width = 520; canvas.height = 520
      const context = canvas.getContext('2d'); context.translate(10, 10); context.scale(scale, scale); context.globalAlpha = fixture.opacity
      const path = new Path2D(fixture.path)
      if (fixture.closed) { context.fillStyle = fixture.fill; context.fill(path, fillRule) }
      context.lineWidth = fixture.width; context.lineJoin = join; context.lineCap = cap; context.strokeStyle = fixture.stroke; context.stroke(path)
      return context.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const expected = paint(fixture.reference.fill, fixture.reference.join, fixture.reference.cap), actual = paint(fixture.actual.fill, fixture.actual.join, fixture.actual.cap)
    let changedChannels = 0, coloredPixels = 0
    for (let i = 0; i < actual.length; i++) { if (actual[i] !== expected[i]) changedChannels++; if (i % 4 === 3 && actual[i]) coloredPixels++ }
    // Ensure the oracle fixture can detect the lost semantics rather than
    // relying only on field equality: the star's centre, corners and line ends
    // visibly distinguish at least one non-default style from legacy paint.
    const defaults = paint('nonzero', 'miter', 'butt')
    let differentFromDefaults = 0
    for (let i = 0; i < expected.length; i++) if (expected[i] !== defaults[i]) differentFromDefaults++
    return { name: fixture.name, scale, changedChannels, coloredPixels, differentFromDefaults }
  })), cases.map(({ name, node, path, payload }) => ({ name, path, closed: node.vectorPath.closed, width: node.strokeWidth, opacity: node.opacity, fill: node.color, stroke: node.strokeColor, reference: { fill: node.vectorFillRule ?? 'nonzero', join: node.vectorStrokeJoin ?? 'miter', cap: node.vectorStrokeCap ?? 'butt' }, actual: { fill: payload.vectorFillRule, join: payload.vectorStrokeJoin, cap: payload.vectorStrokeCap } })))
  for (const result of report.pixelResults) check(`${result.name}: canonical style pixels at ${result.scale * 100}%`, result.changedChannels === 0 && result.coloredPixels > 0, result)
  check('closed evenodd fixture visibly differs from default nonzero', report.pixelResults.some(result => result.name === 'closed evenodd/miter/butt' && result.differentFromDefaults > 0))
  check('open round caps visibly differ from default butt caps', report.pixelResults.some(result => result.name === 'open nonzero/miter/round' && result.differentFromDefaults > 0))
  check('bevel joins visibly differ from default miter joins', report.pixelResults.some(result => result.name === 'open nonzero/bevel/butt' && result.differentFromDefaults > 0))
  const after = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  check('all source fingerprints stable throughout run', JSON.stringify(after) === JSON.stringify(hashes))
  report.passed = true
  console.log(JSON.stringify({ passed: true, checks: report.checks.length, pixelCases: report.pixelResults.length, report: resolve(output, 'report.json') }, null, 2))
} catch (error) {
  report.failure = String(error); console.error(report.failure); process.exitCode = 1
} finally {
  await browser?.close()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
