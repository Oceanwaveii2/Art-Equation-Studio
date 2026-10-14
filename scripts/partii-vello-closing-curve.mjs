import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
import { chromium } from 'playwright-core'

// Production serialization against the canonical SVG path and browser Path2D
// rasterization. No app, native scene, project, asset or EXE is opened or saved.
const sourceFiles = ['src/board/VelloBoardBackdrop.tsx', 'src/board/velloEligibility.ts', 'src/model/vector.ts']
const sourceTexts = await Promise.all(sourceFiles.map(path => readFile(path, 'utf8')))
const sourceHashes = Object.fromEntries(sourceFiles.map((path, i) => [path, createHash('sha256').update(sourceTexts[i]).digest('hex')]))
const compile = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const eligibilityUrl = moduleUrl(compile(sourceTexts[1]))
const backdropTree = ts.createSourceFile('VelloBoardBackdrop.tsx', sourceTexts[0], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const functions = backdropTree.statements.filter(n => ts.isFunctionDeclaration(n) && ['commands','velloBoardSnapshot'].includes(n.name?.text)).map(n => n.getText(backdropTree)).join('\n')
const backdropCode = compile(`import {eligibleVelloObjects} from '${eligibilityUrl}';\n${functions}`)
const { velloBoardSnapshot } = await import(moduleUrl(backdropCode))
const { vectorModuleUrl } = await import('./p0-test-module-loader.mjs')
const { vectorPathData } = await import(vectorModuleUrl)

const timestamp = new Date().toISOString()
const output = resolve('output/partii-vello-closing-curve', timestamp.replace(/[:.]/g, '-'))
await mkdir(output, { recursive: true })
const report = { generatedAt: timestamp, passed: false, sourceHashes, checks: [], pixelResults: [], limitations: ['Pure production serializer and isolated browser Path2D pixels; actual native Vello GPU/device pixels and packaged EXE acceptance remain separate gates.'] }
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) }); assert(passed, `${name}: ${JSON.stringify(detail)}`) }
const points = [{ x: 80, y: 40 }, { x: 180, y: 45 }, { x: 170, y: 150 }]
const cases = [
  { name: 'straight closed triangle', closed: true, points },
  { name: 'outgoing closing curve', closed: true, points: [points[0], points[1], { ...points[2], handleOut: { x: -30, y: 75 } }] },
  { name: 'incoming closing curve', closed: true, points: [{ ...points[0], handleIn: { x: -45, y: 40 } }, points[1], points[2]] },
  { name: 'two-handle closing curve', closed: true, points: [{ ...points[0], handleIn: { x: -45, y: 40 } }, points[1], { ...points[2], handleOut: { x: -30, y: 75 } }] },
  { name: 'zero-valued closing controls', closed: true, points: [{ ...points[0], handleIn: { x: 0, y: 0 } }, points[1], { ...points[2], handleOut: { x: 0, y: 0 } }] },
  { name: 'all curved segments', closed: true, points: points.map((point, i) => ({ ...point, handleIn: { x: -30, y: i * 4 - 12 }, handleOut: { x: 20, y: 30 - i * 12 } })) },
  { name: 'open path with unused endpoint handles', closed: false, points: [{ ...points[0], handleIn: { x: -45, y: 40 } }, points[1], { ...points[2], handleOut: { x: -30, y: 75 } }] },
  { name: 'open path with segment curves', closed: false, points: [{ ...points[0], handleOut: { x: 50, y: -25 } }, { ...points[1], handleIn: { x: -35, y: 35 }, handleOut: { x: 20, y: 30 } }, { ...points[2], handleIn: { x: 10, y: -40 } }] },
]
const fixtures = cases.map((fixture, index) => {
  const path = { version: 1, closed: fixture.closed, points: structuredClone(fixture.points) }
  const object = { id: `curve-${index}`, revision: 1, order: 0, kind: 'vector', locked: true, hidden: false, bounds: { x: 0, y: 0, width: 260, height: 260 }, localBounds: { x: 0, y: 0, width: 260, height: 260 }, appearance: { fill: '#c04422', stroke: '#2266bb', opacity: 1, rotation: 0, strokeWidth: index === 1 ? 0 : 3 }, vectorPath: path }
  const scene = { id: 'isolated-closing-curves', revision: 1, objects: [object], connections: [], environment: { background: '#00000000' } }
  const before = JSON.stringify(scene)
  const encoded = velloBoardSnapshot(scene, [])
  const payload = JSON.parse(encoded.json).objects[0]?.payload
  return { ...fixture, path, scene, before, encoded, payload, canonical: vectorPathData(path), batch: payload?.commands.map(command => command.join(' ')).join(' ') }
})

let browser
try {
  for (const fixture of fixtures) {
    check(`${fixture.name}: remains eligible`, fixture.encoded.ids.has(fixture.scene.objects[0].id))
    check(`${fixture.name}: source remains unchanged`, fixture.before === JSON.stringify(fixture.scene))
    check(`${fixture.name}: batch matches canonical SVG path`, fixture.batch === fixture.canonical, { canonical: fixture.canonical, batch: fixture.batch })
    const curvedClosing = fixture.closed && Boolean(fixture.points.at(-1).handleOut || fixture.points[0].handleIn)
    check(`${fixture.name}: closing segment contract`, curvedClosing ? fixture.payload.commands.at(-2)?.[0] === 'C' && fixture.payload.commands.at(-1)?.[0] === 'Z' : fixture.closed ? fixture.payload.commands.at(-1)?.[0] === 'Z' : fixture.payload.commands.every(command => command[0] !== 'Z'))
    check(`${fixture.name}: explicit stroke width preserved`, fixture.payload.strokeWidth === fixture.scene.objects[0].appearance.strokeWidth)
    check(`${fixture.name}: selected path remains DOM-owned`, velloBoardSnapshot(fixture.scene, [fixture.scene.objects[0].id]).ids.size === 0)
  }
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
  const page = await browser.newPage()
  report.pixelResults = await page.evaluate((fixtures) => {
    const results = []
    for (const fixture of fixtures) for (const scale of [.05, .5, 1, 2]) {
      const paint = data => {
        const canvas = document.createElement('canvas'); canvas.width = 540; canvas.height = 540
        const context = canvas.getContext('2d'); context.translate(8, 8); context.scale(scale, scale)
        const path = new Path2D(data)
        if (fixture.closed) { context.fillStyle = '#c04422'; context.fill(path) }
        if (fixture.strokeWidth > 0) { context.lineWidth = fixture.strokeWidth; context.strokeStyle = '#2266bb'; context.stroke(path) }
        return context.getImageData(0, 0, canvas.width, canvas.height).data
      }
      const reference = paint(fixture.canonical), actual = paint(fixture.batch)
      let changedChannels = 0, maxDelta = 0, coloredPixels = 0
      for (let i = 0; i < actual.length; i++) { const delta = Math.abs(actual[i] - reference[i]); if (delta) changedChannels++; maxDelta = Math.max(maxDelta, delta); if (i % 4 === 3 && actual[i]) coloredPixels++ }
      results.push({ name: fixture.name, scale, changedChannels, maxDelta, coloredPixels })
    }
    return results
  }, fixtures.map(({ name, closed, canonical, batch, payload }) => ({ name, closed, canonical, batch, strokeWidth: payload.strokeWidth })))
  for (const result of report.pixelResults) check(`${result.name}: raster agrees at ${result.scale * 100}%`, result.changedChannels === 0 && result.maxDelta === 0 && result.coloredPixels > 0, result)
  const finalHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
  check('source fingerprints remain stable throughout regression', JSON.stringify(finalHashes) === JSON.stringify(sourceHashes))
  report.passed = true
  console.log(JSON.stringify({ passed: true, checks: report.checks.length, pixelCases: report.pixelResults.length, report: resolve(output, 'report.json') }, null, 2))
} catch (error) {
  report.failure = String(error)
  console.error(report.failure)
  process.exitCode = 1
} finally {
  await browser?.close()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
