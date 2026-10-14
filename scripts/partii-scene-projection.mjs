import { geometryModuleUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Model/projection fixtures only: no app UI, workspace APIs, host clipboard or
// live projects. Imports run the production helpers, not copied policies.
const sources = new Map()
const compile = async (path) => {
  const text = await readFile(new URL(path, import.meta.url), 'utf8')
  sources.set(path, createHash('sha256').update(text).digest('hex'))
  return ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
}
const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const coreUrl = url(await compile('../src/board/diagramStructureCore.ts'))
const themeUrl = url(await compile('../src/canvasTheme.ts'))
const connectorsUrl = url(await compile('../src/board/connectors.ts'))
const changesUrl = url(await compile('../src/canvas-engine/changes.ts'))
const paperUrl = pathToFileURL(resolve('node_modules/paper/dist/paper-full.js')).href
const booleanUrl = url((await compile('../src/model/vectorBooleanGeometry.ts')).replace("from 'paper'", `from '${paperUrl}'`))
const svgUrl = url((await compile('../src/board/vectorSvg.ts')).replace("from '../model/vector'", `from '${url(await compile('../src/model/vector.ts'))}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`))
const adapter = await import(url((await compile('../src/board/artEquationCanvasAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`)))
const native = await import(url((await compile('../src/board/nativeSceneAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './connectors'", `from '${connectorsUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`).replace("from './vectorSvg'", `from '${svgUrl}'`)))
const { diagramProjectionStates, diagramState, visibleDiagramNodeIds } = await import(coreUrl)
const { diffCanvasScenes } = await import(changesUrl)
const { vectorNodeSvgMarkup } = await import(svgUrl)
const report = { generatedAt: new Date().toISOString(), scope: 'production model helpers and derived engine/native projections; no native pixels/disk/gestures', checks: [], errors: [] }
const test = (name, run) => { run(); report.checks.push(name) }
const colors = { background: '#181a1f', grid: '#3a3f49' }, assets = []
const node = (id, extra = {}) => ({ id, title: id, kind: 'shape', shapeType: 'rectangle', x: 10, y: 20, width: 80, height: 40, ...extra })
const edge = (id, extra = {}) => ({ id, sourcePort: 'right', targetPort: 'left', style: 'straight', color: '#ff0000', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false, ...extra })
const connectors = [
  edge('deep-outside', { sourceId: 'deep', targetId: 'outside' }),
  edge('root-outside', { sourceId: 'outer', targetId: 'outside' }),
  edge('deep-free', { sourceId: 'deep', targetPoint: { x: 900, y: 50 } }),
  edge('free', { sourcePoint: { x: 0, y: 0 }, targetPoint: { x: 200, y: 200 } }),
  edge('missing', { sourceId: 'missing', sourcePoint: { x: 0, y: 0 }, targetId: 'outside' }),
]
const nodes = [node('outer', { kind: 'group', containerRole: 'frame' }), node('middle', { kind: 'group', groupId: 'outer' }), node('column', { kind: 'column', groupId: 'middle' }), node('deep', { parentColumnId: 'column' }), node('outside')]
const board = { id: 'projection-fixture', title: 'Disposable', nodes, connectors, viewport: { x: 0, y: 0, scale: 1 } }
const project = { id: 'projection-project', boards: [board] }
const original = JSON.stringify({ project, assets })
const engineScene = (value) => adapter.createArtEquationCanvasScene(value, assets, colors)
const nativeScene = (value, revision) => native.toNativeScene({ ...project, boards: [value] }, value, 'dark', revision)
const lookup = (scene, id) => scene.objects.find((object) => object.id === id)
const collapsed = { ...board, nodes: nodes.map((value) => value.id === 'outer' ? { ...value, collapsed: true } : value) }
const baseEngine = engineScene(board), collapsedEngine = engineScene(collapsed)
const baseNative = nativeScene(board, 'base'), collapsedNative = nativeScene(collapsed, 'collapsed')
try {
  test('Core batch state matches single-object policy through three container levels', () => {
    const states = diagramProjectionStates(collapsed.nodes)
    assert(states.ok)
    for (const value of nodes) {
      const own = diagramState(collapsed.nodes, value.id)
      assert(own.ok)
      assert.deepEqual(states.value.get(value.id), { locked: own.value.locked, hidden: own.value.hidden })
    }
    assert.deepEqual(visibleDiagramNodeIds(collapsed.nodes).value, ['outer', 'outside'])
  })
  test('Collapse keeps container visible and hides all transitive descendants in both projections', () => {
    for (const id of ['middle', 'column', 'deep']) { assert.equal(lookup(collapsedEngine, id).hidden, true); assert.equal(lookup(collapsedNative, id).visible, false) }
    for (const id of ['outer', 'outside']) { assert.equal(lookup(collapsedEngine, id).hidden, false); assert.equal(lookup(collapsedNative, id).visible, true) }
    assert.equal(collapsedEngine.objects.length, nodes.length)
    assert.equal(collapsedNative.objects.length, nodes.length)
    assert.equal(lookup(baseNative, 'middle').parentId, 'outer')
    assert.equal(lookup(baseNative, 'column').parentId, 'middle')
    assert.equal(lookup(baseNative, 'deep').parentId, 'column')
  })
  test('Connections attached to hidden or missing endpoints disappear; free and visible edges survive', () => {
    assert.deepEqual(baseEngine.connections.map((value) => value.id), ['deep-outside', 'root-outside', 'deep-free', 'free'])
    assert.deepEqual(baseNative.connections.map((value) => value.id), baseEngine.connections.map((value) => value.id))
    assert.deepEqual(collapsedEngine.connections.map((value) => value.id), ['root-outside', 'free'])
    assert.deepEqual(collapsedNative.connections.map((value) => value.id), ['root-outside', 'free'])
    assert.equal(board.connectors, collapsed.connectors, 'cache invalidation must depend on node visibility despite same connector array')
    assert.equal(collapsed.connectors.length, connectors.length, 'projection never drops saved edges')
  })
  test('Ancestor-derived hidden revisions update unchanged children and remove/re-add cached connectors', () => {
    assert.equal(board.nodes[3], collapsed.nodes[3], 'child source object remains unchanged')
    const delta = diffCanvasScenes(baseEngine, collapsedEngine)
    for (const id of ['middle', 'column', 'deep']) assert(delta.upsertObjects.some((value) => value.id === id && value.hidden))
    assert.deepEqual(delta.removeConnectionIds, ['deep-outside', 'deep-free'])
    const restored = diffCanvasScenes(collapsedEngine, engineScene({ ...board }))
    for (const id of ['middle', 'column', 'deep']) assert(restored.upsertObjects.some((value) => value.id === id && !value.hidden))
    assert.deepEqual(restored.upsertConnections.map((value) => value.id), ['deep-outside', 'deep-free'])
    assert.equal(engineScene(board).objects, baseEngine.objects, 'same source references preserve cache')
    assert.equal(engineScene(board).connections, baseEngine.connections)
    const nativeDelta = native.nativeChanges(baseNative, collapsedNative)
    assert.deepEqual(nativeDelta.operations.filter((value) => value.op === 'remove-connection').map((value) => value.connectionId), ['deep-outside', 'deep-free'])
    assert(nativeDelta.operations.some((value) => value.op === 'upsert-object' && value.object.id === 'deep' && !value.object.visible))
  })
  test('Inherited locks project and produce child updates without writing descendant records', () => {
    const locked = { ...board, nodes: nodes.map((value) => value.id === 'outer' ? { ...value, locked: true } : value) }
    const engine = engineScene(locked), nativeLocked = nativeScene(locked, 'locked')
    for (const id of ['outer', 'middle', 'column', 'deep']) { assert.equal(lookup(engine, id).locked, true); assert.equal(lookup(nativeLocked, id).locked, true) }
    assert.equal(lookup(engine, 'outside').locked, false)
    assert.equal(lookup(nativeLocked, 'outside').locked, false)
    const delta = diffCanvasScenes(baseEngine, engine)
    for (const id of ['middle', 'column', 'deep']) assert(delta.upsertObjects.some((value) => value.id === id && value.locked))
    assert.equal(locked.nodes[3], board.nodes[3])
    assert.equal(locked.nodes[3].locked, undefined)
  })
  test('Explicit hidden ancestors hide themselves, descendants and attached edges', () => {
    const hidden = { ...board, nodes: nodes.map((value) => value.id === 'outer' ? { ...value, hidden: true } : value) }
    const engine = engineScene(hidden), nativeHidden = nativeScene(hidden, 'hidden')
    assert.deepEqual(engine.objects.filter((value) => !value.hidden).map((value) => value.id), ['outside'])
    assert.deepEqual(nativeHidden.objects.filter((value) => value.visible).map((value) => value.id), ['outside'])
    assert.deepEqual(engine.connections.map((value) => value.id), ['free'])
    assert.deepEqual(nativeHidden.connections.map((value) => value.id), ['free'])
  })
  test('Mind-map collapse and lock use the same derived policy in both render paths', () => {
    const tree = 'projection-tree'
    const treeNodes = [node('tree-root', { kind: 'note', locked: true, mindMap: { version: 1, treeId: tree, order: 0, collapsed: true } }), node('tree-child', { kind: 'note', mindMap: { version: 1, treeId: tree, parentId: 'tree-root', order: 0 } }), node('tree-leaf', { mindMap: { version: 1, treeId: tree, parentId: 'tree-child', order: 0 } })]
    const treeBoard = { ...board, nodes: treeNodes, connectors: [edge('branch', { sourceId: 'tree-root', targetId: 'tree-child' })] }
    const engine = engineScene(treeBoard), nativeTree = nativeScene(treeBoard, 'tree')
    assert.equal(lookup(engine, 'tree-root').hidden, false)
    for (const id of ['tree-child', 'tree-leaf']) { assert.equal(lookup(engine, id).hidden, true); assert.equal(lookup(engine, id).locked, true); assert.equal(lookup(nativeTree, id).visible, false); assert.equal(lookup(nativeTree, id).locked, true) }
    assert.equal(engine.connections.length, 0)
    assert.equal(nativeTree.connections.length, 0)
  })
  test('Corrupt ownership fails closed without throwing, mutating or projecting attached edges', () => {
    for (const invalidNodes of [[node('orphan', { groupId: 'missing' })], [node('same'), node('same')], [node('dual', { groupId: 'outer', parentColumnId: 'column' }), ...nodes]]) {
      const invalid = { ...board, nodes: invalidNodes, connectors: [edge('bad', { sourceId: invalidNodes[0].id, targetPoint: { x: 0, y: 0 } })] }
      const before = JSON.stringify(invalid), engine = engineScene(invalid), projected = nativeScene(invalid, 'invalid')
      assert(engine.objects.every((value) => value.hidden && value.locked))
      assert(projected.objects.every((value) => !value.visible && value.locked))
      assert.equal(engine.connections.length, 0)
      assert.equal(projected.connections.length, 0)
      assert.equal(JSON.stringify(invalid), before)
    }
  })
  test('All Boolean operations and affine path metadata survive JSON and native/export projection', () => {
    const first = { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }] }
    const second = { version: 1, closed: true, points: [{ x: 30, y: -10 }, { x: 90, y: -10 }, { x: 90, y: 30 }, { x: 30, y: 30 }] }
    for (const operation of ['union', 'subtract', 'intersect', 'exclude']) {
      const shape = node(operation, { shapeType: 'path', vectorPath: first, vectorBoolean: { operation, operands: [first, second] }, vectorTransform: { scaleX: -1, scaleY: .75, skewX: 17, skewY: -11, translateX: 6, translateY: 4 }, rotation: 30, vectorFillRule: 'evenodd', opacity: .6 })
      const reopened = JSON.parse(JSON.stringify(shape)), before = JSON.stringify(reopened), fixture = { ...board, nodes: [reopened], connectors: [] }
      const projected = nativeScene(fixture, operation), markup = vectorNodeSvgMarkup(reopened)
      assert.deepEqual(projected.objects[0].payload.vectorBoolean, shape.vectorBoolean)
      assert.deepEqual(projected.objects[0].payload.vectorTransform, shape.vectorTransform)
      assert.equal(projected.objects[0].opacity, .6)
      assert.equal(vectorNodeSvgMarkup(shape), markup)
      assert.equal(JSON.stringify(reopened), before)
    }
  })
  test('Source fixture remains exact through projection and no derived state is persisted', () => assert.equal(JSON.stringify({ project, assets }), original))
  report.passed = true
} catch (error) {
  report.passed = false
  report.errors.push(error.stack || String(error))
  process.exitCode = 1
} finally {
  report.sourceHashes = Object.fromEntries(sources)
  report.sourcesUnchanged = true
  for (const [path, hash] of sources) if (createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex') !== hash) report.sourcesUnchanged = false
  if (!report.sourcesUnchanged) { report.passed = false; process.exitCode = 1; report.errors.push('Production helper source changed during run') }
  const directory = resolve('output/playwright/partii-scene-projection-2026-09-30')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
