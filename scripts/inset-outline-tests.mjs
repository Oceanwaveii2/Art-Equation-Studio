import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const measuredUrl = url(compile(await readFile(new URL('../src/board/measuredCardPaint.ts', import.meta.url), 'utf8')))
const backgroundUrl = url(compile(await readFile(new URL('../src/board/measuredBackgroundPaint.ts', import.meta.url), 'utf8')).replace(/from ['"]\.\/measuredCardPaint(?:\.ts)?['"]/g, `from '${measuredUrl}'`))
const source = compile(await readFile(new URL('../src/board/completeMeasuredCardPaint.ts', import.meta.url), 'utf8')).replace(/from ['"]\.\/measuredCardPaint(?:\.ts)?['"]/g, `from '${measuredUrl}'`).replace(/from ['"]\.\/measuredBackgroundPaint(?:\.ts)?['"]/g, `from '${backgroundUrl}'`)
const { compileCompleteCardPaint, measuredInsetSolidOutline } = await import(url(source))
const checks = []
const check = (name, body) => { body(); checks.push(name) }
const style = extra => ({ outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '-2px', outlineColor: 'rgb(103, 205, 195)', ...extra })
const metadata = { objectId: 'column', objectRevision: 1, order: 0, layoutRevision: 1, sourceFingerprint: 'measured-inset-outline-fixture' }
const box = extra => ({ id: 'column', size: { width: 364, height: 606 }, transform: [1, 0, 0, 1, 36, 74], radii: [[3, 3], [3, 3], [3, 3], [3, 3]], background: '#13202cff', gradients: [], shadows: [], borderWidths: [2.5, 2.5, 2.5, 2.5], borderColors: ['#55d5e8ff', '#55d5e8ff', '#55d5e8ff', '#55d5e8ff'], opacity: 1, clipContent: true, isolation: 'auto', blendMode: 'normal', zIndex: 0, sourceOrder: 0, contributions: [], children: [], insetOutline: measuredInsetSolidOutline(style()), ...extra })
const outline = result => result.operations.find(operation => operation.type === 'vector' && operation.object.id === 'column:inset-outline')

check('actual Node Column 2px solid/-2px offset is measured with its complete alpha color', () => {
  assert.deepEqual(measuredInsetSolidOutline(style()), { width: 2, color: '#67cdc3ff' })
  assert.deepEqual(measuredInsetSolidOutline(style({ outlineColor: 'rgba(103, 205, 195, .5)' })), { width: 2, color: '#67cdc380' })
  assert.equal(measuredInsetSolidOutline(style({ outlineStyle: 'none' })), undefined)
  assert.equal(measuredInsetSolidOutline(style({ outlineWidth: '0px' })), undefined)
})
check('outside, partly inset, dashed, auto and invalid outline treatments retain typed refusal', () => {
  for (const extra of [{ outlineOffset: '0px' }, { outlineOffset: '-1px' }, { outlineOffset: '-3px' }, { outlineStyle: 'dashed' }, { outlineStyle: 'auto' }, { outlineWidth: 'auto' }, { outlineWidth: '-2px' }, { outlineColor: 'invalid' }]) assert.equal(measuredInsetSolidOutline(style(extra)), null)
})
check('ring keeps the original rounded outer contour and deflates only its interior by exactly 2px', () => {
  const result = compileCompleteCardPaint(box(), metadata)
  assert.equal(result.status, 'ready'); assert.equal(result.completePaint, true)
  const operation = outline(result)
  assert.equal(operation.object.payload.fill, '#67cdc3ff')
  assert.equal(operation.object.payload.vectorFillRule, 'evenodd')
  const commands = operation.object.payload.commands
  assert.equal(commands.length, 20)
  assert.deepEqual(commands[0], ['M', 3, 0])
  assert.deepEqual(commands[1], ['L', 361, 0])
  assert.deepEqual(commands[10], ['M', 3, 2])
  assert.deepEqual(commands[11], ['L', 361, 2])
  assert.deepEqual(commands[13], ['L', 362, 603])
  assert.deepEqual(commands[15], ['L', 3, 604])
  assert.deepEqual(result.visualBounds, { x: 36, y: 74, width: 364, height: 606 })
})
check('ring paints after child artwork and after the content clip, inside the object opacity composite', () => {
  const child = box({ id: 'child', size: { width: 100, height: 50 }, transform: [1, 0, 0, 1, 50, 88], insetOutline: undefined })
  const result = compileCompleteCardPaint(box({ children: [child], opacity: .6 }), metadata)
  assert.equal(result.completePaint, true)
  const index = result.operations.indexOf(outline(result))
  assert(result.operations.findIndex(operation => operation.type === 'vector' && operation.object.id === 'child:background') < index)
  assert(result.operations.findIndex(operation => operation.type === 'pop' && operation.scopeId === 'column:content') < index)
  assert.equal(result.operations[0].type, 'pushComposite')
  assert.equal(result.operations[0].opacity, .6)
  assert.deepEqual(result.operations.at(-1), { type: 'pop', scopeId: 'column:composite' })
})
check('rotated/skewed/reflected articles preserve the exact world matrix once', () => {
  const transform = [-.8, .3, .25, 1.1, 500, 70]
  const result = compileCompleteCardPaint(box({ transform }), metadata)
  assert.equal(result.completePaint, true)
  assert.deepEqual(outline(result).object.transform, transform)
  assert.deepEqual(result.visualBounds, { x: 208.8, y: 70, width: 442.7, height: 775.8000000000001 })
})
check('oversized or invalid rings refuse the whole card and release every emitted operation', () => {
  for (const insetOutline of [{ width: 182, color: '#67cdc3ff' }, { width: NaN, color: '#67cdc3ff' }, { width: -2, color: '#67cdc3ff' }, { width: 2, color: '#67cdc3' }]) {
    const result = compileCompleteCardPaint(box({ insetOutline }), metadata)
    assert.equal(result.completePaint, false); assert.equal(result.status, 'unsupported')
    assert(result.blockers.some(blocker => blocker.includes('CARD_INSET_OUTLINE_GEOMETRY_UNSUPPORTED')))
    assert.deepEqual(result.operations, [])
  }
})
check('transparent measured ring contributes no duplicate operation while card bounds remain valid', () => {
  const result = compileCompleteCardPaint(box({ insetOutline: { width: 2, color: '#67cdc300' } }), metadata)
  assert.equal(result.completePaint, true); assert.equal(outline(result), undefined)
})
console.log(JSON.stringify({ scope: 'INSET_OUTLINE_COMPILER_ONLY', passed: checks.length, checks, limits: ['Browser/WebView2 outline pixel parity and production ownership remain separate checks.'] }, null, 2))
