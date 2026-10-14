import { geometryModuleUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Exercises production model/projection/SVG functions only. No live project,
// application window, device renderer, clipboard or disk-save API is touched.
const hashes = {}, sources = {}
const compile = async path => {
  const source = await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8')
  sources[path] = source
  hashes[path] = createHash('sha256').update(source).digest('hex')
  return ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
}
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const coreUrl = url(await compile('board/diagramStructureCore.ts'))
const themeUrl = url(await compile('canvasTheme.ts'))
const vectorUrl = url(await compile('model/vector.ts'))
const paperUrl = pathToFileURL(resolve('node_modules/paper/dist/paper-full.js')).href
const booleanUrl = url((await compile('model/vectorBooleanGeometry.ts')).replace("from 'paper'", `from '${paperUrl}'`))
const connectorsUrl = url(await compile('board/connectors.ts'))
const arrangementUrl = url((await compile('board/arrangement.ts')).replace("from '../model/vector'", `from '${vectorUrl}'`))
const svgUrl = url((await compile('board/vectorSvg.ts')).replace("from '../model/vector'", `from '${vectorUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`))
const changesUrl = url(await compile('canvas-engine/changes.ts'))
const adapterUrl = url((await compile('board/artEquationCanvasAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`))
const nativeUrl = url((await compile('board/nativeSceneAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './connectors'", `from '${connectorsUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`).replace("from './vectorSvg'", `from '${svgUrl}'`))
const minimapUrl = url((await compile('board/minimapGeometry.ts')).replace("from './arrangement'", `from '${arrangementUrl}'`).replace("from './connectors'", `from '${connectorsUrl}'`).replace("from './vectorSvg'", `from '${svgUrl}'`))
const { createArtEquationCanvasScene } = await import(adapterUrl)
const { toNativeScene, nativeChanges } = await import(nativeUrl)
const { minimapSceneSvg } = await import(minimapUrl)
const { diffCanvasScenes } = await import(changesUrl)
const { containerPaintOrder } = await import(coreUrl)
const generatedAt = new Date().toISOString(), output = resolve('output/partii-container-paint-projection', generatedAt.replace(/[:.]/g, '-'))
await mkdir(output, { recursive: true })
const report = { generatedAt, passed: false, checks: [], sourceHashes: hashes, limitations: ['Production model/Canvas/native serialization and preview SVG paint order; no actual DOM/device pixels, native gestures or saved-workspace claim.'] }
const test = (name, run) => { run(); report.checks.push(name) }
const node = (id, extra = {}) => ({ id, title: id, kind: 'shape', shapeType: 'rectangle', x: 10, y: 10, width: 80, height: 60, color: '#112233', ...extra })
const group = (id, extra = {}) => node(id, { kind: 'group', ...extra })
const colors = { background: '#000000', grid: '#555555' }, assets = []
const board = nodes => ({ id: 'paint-projection', title: 'Disposable', nodes, connectors: [] })
const canvas = value => createArtEquationCanvasScene(value, assets, colors)
const native = value => toNativeScene({ id: 'paint-project', boards: [value] }, value, 'dark', String(Math.random()))
const ids = scene => scene.objects.map(object => object.id)
const object = (scene, id) => scene.objects.find(value => value.id === id)
const fixture = board([
  node('deep', { groupId: 'inner', zIndex: -500, color: '#114477' }),
  node('front-child', { groupId: 'front', zIndex: -200, color: '#338855' }),
  group('front', { zIndex: 10, color: '#990022' }),
  group('inner', { groupId: 'back', zIndex: 1, color: '#22aacc' }),
  node('outsider', { zIndex: 5, color: '#ee7700' }),
  group('back', { zIndex: 0, color: '#cc33aa' }),
  node('back-child', { groupId: 'back', zIndex: -1, color: '#55cc44' }),
])
const before = JSON.stringify(fixture)
try {
  test('Root/sibling layers form contiguous parent-first branches in Canvas/native projections', () => {
    const expected = ['back', 'back-child', 'inner', 'deep', 'outsider', 'front', 'front-child']
    assert.deepEqual(containerPaintOrder(fixture.nodes).value.orderedIds, expected)
    for (const scene of [canvas(fixture), native(fixture)]) {
      assert.deepEqual(ids(scene), expected)
      for (let order = 0; order < expected.length; order++) assert.equal(object(scene, expected[order]).order, order)
    }
    canvas(fixture).objects.forEach((value, order) => assert.equal(value.zIndex, order))
    assert.equal(object(native(fixture), 'deep').parentId, 'inner')
    assert.equal(object(native(fixture), 'inner').parentId, 'back')
  })
  test('Explicit layer zero and stable sibling ties retain their meanings', () => {
    const value = board([node('first', { zIndex: 0 }), group('container'), node('second', { zIndex: 0 }), node('default')])
    for (const scene of [canvas(value), native(value)]) assert.deepEqual(ids(scene), ['first', 'container', 'second', 'default'])
  })
  test('Ancestor layer changes update unchanged child revisions and native delta order', () => {
    const earlier = canvas(fixture), earlierNative = native(fixture)
    const laterBoard = { ...fixture, nodes: fixture.nodes.map(value => value.id === 'back' ? { ...value, zIndex: 20 } : value) }
    const later = canvas(laterBoard), laterNative = native(laterBoard)
    assert.equal(laterBoard.nodes[0], fixture.nodes[0])
    assert.deepEqual(ids(later), ['outsider', 'front', 'front-child', 'back', 'back-child', 'inner', 'deep'])
    assert.notEqual(object(earlier, 'deep').revision, object(later, 'deep').revision)
    assert(diffCanvasScenes(earlier, later).upsertObjects.some(value => value.id === 'deep' && value.order === 6))
    assert(nativeChanges(earlierNative, laterNative).operations.some(value => value.op === 'upsert-object' && value.object.id === 'deep' && value.object.order === 6))
    assert.equal(canvas(fixture).objects, earlier.objects, 'original projection cache survives other scenes')
    assert.equal(diffCanvasScenes(earlier, canvas(fixture)).upsertObjects.length, 0)
  })
  test('Minimap follows projected ordinals even when saved layers and input array disagree', () => {
    const projected = canvas(fixture)
    const alternate = { ...projected, objects: [...projected.objects].reverse().map(value => ({ ...value, zIndex: -value.order })) }
    const svg = minimapSceneSvg(alternate, fixture.nodes, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 120, 120)
    const expectedFills = ids(projected).map(id => fixture.nodes.find(value => value.id === id).color)
    const actualFills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map(match => match[1]).slice(1)
    assert.deepEqual(actualFills, expectedFills)
    assert.equal(svg, minimapSceneSvg(projected, fixture.nodes, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 120, 120))
  })
  test('Scene-only preview preserves optional vector fill rule, join and cap', () => {
    const path = node('path', { shapeType: 'path', vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 20, y: 40 }, { x: 40, y: 0 }] }, vectorFillRule: 'evenodd', vectorStrokeJoin: 'bevel', vectorStrokeCap: 'square' })
    const scene = canvas(board([path])), bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const fallbackSvg = minimapSceneSvg(scene, undefined, bounds, 120, 120)
    assert.equal(fallbackSvg, minimapSceneSvg(scene, [path], bounds, 120, 120))
    for (const attribute of ['fill-rule="evenodd"', 'stroke-linejoin="bevel"', 'stroke-linecap="square"']) assert(fallbackSvg.includes(attribute))
  })
  test('Invalid ownership and nonfinite layers fail closed without dropping saved records', () => {
    for (const nodes of [[group('owner'), node('missing', { groupId: 'absent' })], [node('bad', { zIndex: Infinity })], [group('owner'), node('dual', { groupId: 'owner', parentColumnId: 'owner' })]]) {
      const value = board(nodes), saved = JSON.stringify(value)
      for (const scene of [canvas(value), native(value)]) {
        assert.equal(scene.objects.length, nodes.length)
        assert(scene.objects.every(object => object.locked && (object.hidden || object.visible === false)))
      }
      assert.equal(JSON.stringify(value), saved)
    }
  })
  test('Parent column and mixed nesting retain ownership, inherited locks and visibility', () => {
    const value = board([node('child', { parentColumnId: 'column' }), node('column', { kind: 'column', groupId: 'root' }), group('root', { locked: true }), node('outside')])
    for (const scene of [canvas(value), native(value)]) {
      assert.deepEqual(ids(scene), ['root', 'column', 'child', 'outside'])
      assert.equal(object(scene, 'child').parentId, 'column')
      assert.equal(object(scene, 'column').parentId, 'root')
      assert.equal(object(scene, 'child').locked, true)
      assert.equal(object(scene, 'outside').locked, false)
    }
  })
  test('Projection never changes saved node order/layers and fingerprints remain stable', () => {
    assert.equal(JSON.stringify(fixture), before)
    assert.deepEqual(fixture.nodes.map(value => value.id), ['deep', 'front-child', 'front', 'inner', 'outsider', 'back', 'back-child'])
  })
  const afterHashes = Object.fromEntries(await Promise.all(Object.keys(hashes).map(async path => [path, createHash('sha256').update(await readFile(new URL(`../src/${path}`, import.meta.url))).digest('hex')])))
  assert.deepEqual(afterHashes, hashes)
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, error: report.error?.split('\n')[0], output }))
