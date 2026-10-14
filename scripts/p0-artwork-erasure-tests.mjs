import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { editableShapePath, eraseVectorNode, eraseVectorPath } from '../src/model/vectorDrawing.ts'
import { vectorPathBounds, vectorSegmentPoint, vectorLocalToBoard } from '../src/model/vector.ts'
import { geometryModuleUrl } from './p0-test-module-loader.mjs'

// Canonical saved-node mutations, actual App JSX and live geometry compiler.
// This does not mount CanvasPane or certify CSS shadows/text/native gestures.
const files = ['src/model/vectorDrawing.ts', 'src/model/vector.ts', 'src/App.tsx', 'src/App.css']
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])))
const sourceHashes = Object.fromEntries([...sources].map(([file, source]) => [file, createHash('sha256').update(source).digest('hex')]))
const ast = ts.createSourceFile('App.tsx', sources.get('src/App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const find = predicate => {
  let found
  const visit = node => { if (found) return; if (predicate(node)) found = node; else ts.forEachChild(node, visit) }
  visit(ast); assert(found, 'Actual App paint oracle missing'); return found.getText(ast)
}
const directSelection = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'directSelectionPath')
const lineBranch = find(node => ts.isArrowFunction(node) && !node.parameters.length && node.body.getText(ast).includes('className="shape-arrow-base"'))
const ellipseBranch = find(node => ts.isJsxElement(node) && node.openingElement.getText(ast).includes('className="node-shape-ellipse"'))
const radiusProp = find(node => ts.isPropertyAssignment(node) && node.name.getText(ast) === "'--shape-radius'")
const require = createRequire(new URL('../package.json', import.meta.url))
const { renderToStaticMarkup } = require('react-dom/server')
const code = ts.transpileModule(`${directSelection}\nexport const line=node=>(${lineBranch})();\nexport const ellipse=node=>(${ellipseBranch});\nconst readableForeground=()=> '#000';\nexport const radius=node=>({${radiusProp}})['--shape-radius'];`,
  { fileName: 'actual.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${pathToFileURL(require.resolve('react/jsx-runtime')).href}'`)
const actual = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const { prepareVelloVectorGeometry } = await import(geometryModuleUrl)
const attrs = (markup, name) => Object.fromEntries([...markup.match(new RegExp(`<${name}\\b[^>]*>`))[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]))
const near = (a, b, epsilon = 1e-7) => assert(Math.abs(a - b) <= epsilon, `${a} differs from ${b}`)
const pointNear = (a, b, epsilon) => { near(a.x, b.x, epsilon); near(a.y, b.y, epsilon) }
const checks = [], check = (name, execute) => { execute(); checks.push(name) }
const node = extra => ({ id: 'artwork', kind: 'shape', title: 'Artwork', shapeType: 'rectangle', body: '', x: 0, y: 0, width: 200, height: 100, strokeWidth: 20, color: '#ef9232', strokeColor: '#2198ff', opacity: 1, ...extra })
const anchors = points => ({ version: 1, closed: false, points })

check('plain ellipse conversion uses actual SVG49% radii instead of growing retained artwork', () => {
  const value = node({ shapeType: 'ellipse' }), paint = attrs(renderToStaticMarkup(actual.ellipse(value)), 'ellipse')
  const bounds = vectorPathBounds(editableShapePath(value))
  near(bounds.left, value.width * (Number(paint.cx) - Number(paint.rx)) / 100)
  near(bounds.right, value.width * (Number(paint.cx) + Number(paint.rx)) / 100)
  near(bounds.top, value.height * (Number(paint.cy) - Number(paint.ry)) / 100)
  near(bounds.bottom, value.height * (Number(paint.cy) + Number(paint.ry)) / 100)
})
check('partial ellipse erasure preserves primary contour bounds and surviving portable subtraction', () => {
  const value = node({ shapeType: 'ellipse', x: 20, y: 40 }), before = JSON.stringify(value)
  const result = eraseVectorNode(value, [{ x: 120, y: 90 }], 8)
  assert(result.changed); assert.equal(result.nodes.length, 1)
  const saved = JSON.parse(JSON.stringify(result.nodes[0]))
  assert.equal(saved.vectorBoolean.operation, 'subtract'); assert.equal(saved.vectorBoolean.operands.length, 2)
  const bounds = vectorPathBounds(saved.vectorPath)
  near(bounds.left + saved.x, 22); near(bounds.right + saved.x, 218)
  near(bounds.top + saved.y, 41); near(bounds.bottom + saved.y, 139)
  assert.equal(prepareVelloVectorGeometry(saved).status, 'ready'); assert.equal(JSON.stringify(value), before)
})
check('rectangle default and explicit zero radius agree with current article CSS variable', () => {
  for (const radius of [undefined, 0, 12, 90]) {
    const value = node({ cornerRadius: radius }), path = editableShapePath(value)
    const expected = Math.max(0, Math.min(Number.parseFloat(actual.radius(value)), value.width / 2, value.height / 2))
    near(path.points[0].x, expected); near(path.points[0].y, 0)
    assert.equal(path.points.length, expected ? 8 : 4)
  }
})
check('ordinary ellipse and rectangle malformed frames refuse conversion', () => {
  for (const shapeType of ['ellipse', 'rectangle']) for (const extra of [{ width: 0 }, { height: -1 }, { x: NaN }, { y: Infinity }, { rotation: NaN }]) {
    const value = node({ shapeType, ...extra }), result = eraseVectorNode(value, [{ x: 50, y: 50 }], 10)
    assert.equal(result.changed, false); assert.equal(result.nodes[0], value); assert(result.unsupported)
  }
})
check('CSS rectangle erasure preserves inset border and shadow until complete appearance masking is qualified', () => {
  for (const extra of [{}, { opacity: .4 }, { cornerRadius: 0, strokeWidth: 14 }, { rotation: 37 }]) {
    const value = node(extra), before = JSON.stringify(value), result = eraseVectorNode(value, [{ x: 100, y: 50 }], 12)
    assert.equal(result.changed, false); assert.equal(result.nodes[0], value); assert(result.unsupported.includes('inset-border'))
    assert.equal(JSON.stringify(value), before)
  }
})
check('unconsumed path/Boolean/inner-affine metadata never erases invisible primitive artwork', () => {
  for (const shapeType of ['ellipse', 'rectangle', 'line']) for (const extra of [{ vectorTransform: {} }, { vectorBoolean: { operation: 'subtract', operands: [] } },
    ...(shapeType === 'line' ? [] : [{ vectorPath: anchors([{ x: 0, y: 0 }, { x: 200, y: 100 }]) }])]) {
    const value = node({ shapeType, ...extra }), result = eraseVectorNode(value, [{ x: 50, y: 50 }], 10)
    assert.equal(result.changed, false); assert.equal(result.nodes[0], value); assert(result.unsupported)
  }
})
check('captioned rectangles/ellipses and diagram paths preserve every saved text/geometry field', () => {
  const values = ['rectangle', 'ellipse'].map(shapeType => node({ shapeType, body: 'Keep this caption' }))
  values.push(node({ shapeType: 'path', diagramShape: 'process', vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }] } }))
  for (const value of values) {
    const before = JSON.stringify(value), result = eraseVectorNode(value, [{ x: 70, y: 50 }], 30)
    assert.equal(result.changed, false); assert.equal(result.nodes[0], value); assert(result.unsupported.includes('caption'))
    assert.equal(JSON.stringify(value), before)
  }
})
check('authored lines erase the actual first/last straight segment and ignore invisible controls/intermediate anchors', () => {
  const value = node({ shapeType: 'line', vectorPath: { version: 1, closed: true, points: [
    { x: 10, y: 80, handleOut: { x: 900, y: 900 } }, { x: -400, y: 700 }, { x: 190, y: 20, handleIn: { x: 700, y: 500 } }] } })
  assert.deepEqual(editableShapePath(value), anchors([{ x: 10, y: 80 }, { x: 190, y: 20 }]))
  const result = eraseVectorNode(value, [{ x: 100, y: 50 }], 10, { idFactory: () => 'second' })
  assert(result.changed); assert.equal(result.nodes.length, 2); assert.equal(result.nodes[1].id, 'second')
  for (const fragment of result.nodes) for (let i = 0; i <= 10; i++) {
    const point = vectorLocalToBoard(fragment, vectorSegmentPoint(fragment.vectorPath, 0, i / 10))
    near((point.x - 10) * -60 - (point.y - 80) * 180, 0, 1e-6)
  }
})
check('reversal is reflected once before article-centered world rotation', () => {
  for (const rotation of [0, 33, 90, -45]) {
    const value = node({ shapeType: 'line', body: 'reverse', x: 15, y: 30, rotation, vectorPath: anchors([{ x: 10, y: 80 }, { x: 190, y: 20 }]) })
    const prepared = prepareVelloVectorGeometry(value), converted = editableShapePath(value)
    converted.points.forEach((point, index) => pointNear(vectorLocalToBoard(value, point), { x: prepared.commands[index][1], y: prepared.commands[index][2] }))
    const center = { x: (prepared.commands[0][1] + prepared.commands[1][1]) / 2, y: (prepared.commands[0][2] + prepared.commands[1][2]) / 2 }
    const result = eraseVectorNode(value, [center], 8)
    assert(result.changed); assert.equal(result.nodes.length, 2)
    for (const fragment of result.nodes) assert.equal(prepareVelloVectorGeometry(fragment).status, 'ready')
  }
})
check('line survivors keep actual65% SVG stroke and ignore previously unused cap/join metadata', () => {
  const value = node({ shapeType: 'line', vectorStrokeCap: 'round', vectorStrokeJoin: 'bevel', body: 'reverse' })
  const markup = renderToStaticMarkup(actual.line(value)), base = attrs(markup.match(/<line\b[^>]*class="shape-arrow-base"[^>]*>/)[0], 'line')
  const result = eraseVectorNode(value, [{ x: 100, y: 50 }], 10)
  assert(result.changed)
  for (const fragment of result.nodes) {
    assert.equal(fragment.strokeWidth, Number(base['stroke-width'])); assert.equal(fragment.vectorStrokeCap, 'butt')
    assert.equal(fragment.vectorStrokeJoin, 'miter'); assert.equal(fragment.body, '')
  }
})
check('a line sweep over an invisible bowed control region leaves visible authored stroke unchanged', () => {
  const value = node({ shapeType: 'line', vectorPath: anchors([{ x: 0, y: 50, handleOut: { x: 60, y: 400 } }, { x: 200, y: 50, handleIn: { x: -60, y: 400 } }]) })
  const result = eraseVectorNode(value, [{ x: 100, y: 350 }], 10)
  assert.equal(result.changed, false); assert.equal(result.nodes[0], value)
})
check('arrow semantics, locks and non-vector source media survive explicit unsupported/no-op erasures', () => {
  for (const value of [node({ shapeType: 'arrow' }), node({ locked: true }), node({ kind: 'image', shapeType: undefined, assetId: 'user-resource' })]) {
    const before = JSON.stringify(value), result = eraseVectorNode(value, [{ x: 100, y: 50 }], 10)
    assert.equal(result.changed, false); assert.equal(result.nodes[0], value); assert.equal(JSON.stringify(value), before)
  }
})
check('no-hit erasure leaves the canonical node reference and undo baseline intact', () => {
  const value = node({ shapeType: 'line', body: 'reverse' }), result = eraseVectorNode(value, [{ x: 3000, y: 4000 }], 12)
  assert.equal(result.changed, false); assert.equal(result.nodes[0], value)
})
check('nonfinite/malformed/collapsed vector paths refuse before recursive eraser subdivision', () => {
  for (const extra of [{ vectorPath: { version: 1, closed: false, points: null } },
    { vectorPath: anchors([{ x: 0, y: 0 }, { x: 200, y: NaN }]) },
    { vectorPath: anchors([{ x: 0, y: 0, handleOut: { x: Infinity, y: 10 } }, { x: 200, y: 100 }]) },
    { vectorPath: anchors([{ x: 0, y: 0 }, { x: 200, y: 100 }]), vectorTransform: { scaleX: 0 } },
    { vectorPath: anchors([{ x: 0, y: 0 }, { x: 200, y: 100 }]), vectorTransform: { scaleX: Infinity } },
    { vectorPath: anchors([{ x: 0, y: 0 }, { x: 200, y: 100 }]), vectorBoolean: { operation: 'subtract' } }]) {
    const value = node({ shapeType: 'path', ...extra }), result = eraseVectorNode(value, [{ x: 100, y: 50 }], 10)
    assert.equal(result.changed, false); assert.equal(result.nodes[0], value); assert(result.unsupported)
  }
  for (const vectorPath of [{ version: 1, closed: false, points: null }, anchors([{ x: 1e308, y: 0 }, { x: 200, y: 100 }])]) {
    const value = node({ shapeType: 'line', vectorPath }), result = eraseVectorNode(value, [{ x: 100, y: 50 }], 10)
    assert.equal(result.changed, false); assert.equal(result.nodes[0], value); assert(result.unsupported)
  }
  const invalid = anchors([{ x: 0, y: 0, handleOut: { x: NaN, y: 20 } }, { x: 200, y: 100 }])
  assert.deepEqual(eraseVectorPath(invalid, [{ x: 100, y: 50 }], 10), { changed: false, paths: [invalid] })
})

const evidence = { schemaVersion: 1, scope: 'canonical-erasure-and-actual-App-paint-oracles', passed: checks.length, checks, sourceHashes,
  limitations: ['No mounted CanvasPane', 'No native runtime', 'Ellipse conversion retains existing4-cubic approximation; full GPU ellipse certificate is separate', 'Rectangle CSS border/shadow and glyph layout are not certified by editable-path conversion'] }
const dir = new URL('../../docs/engine-p0/2026-10-03/artwork-coverage/', import.meta.url)
await mkdir(dir, { recursive: true }); await writeFile(new URL('ARTWORK_ERASURE_ACCEPTANCE.json', dir), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify({ passed: checks.length, sourceHashes }))
