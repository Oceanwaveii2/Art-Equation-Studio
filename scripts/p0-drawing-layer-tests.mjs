import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { geometryModuleUrl, p0GeometrySourceHashes } from './p0-test-module-loader.mjs'

const files = ['App.tsx', 'board/drawingLayers.ts', 'board/diagramStructureCore.ts', 'board/artEquationCanvasAdapter.ts', 'board/velloEligibility.ts', 'board/VelloBoardBackdrop.tsx', 'canvasTheme.ts']
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')])))
const hashes = { ...p0GeometrySourceHashes, ...Object.fromEntries([...sources].map(([file, source]) => [file, createHash('sha256').update(source).digest('hex')])) }
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const coreUrl = url(compile(sources.get('board/diagramStructureCore.ts')))
const layersUrl = url(compile(sources.get('board/drawingLayers.ts')).replace(/from ['"]\.\/diagramStructureCore['"]/g, `from '${coreUrl}'`))
const { projectDrawingLayers, changeDrawingLayerOrder: reorder } = await import(layersUrl)
const { containerPaintOrder, diagramProjectionStates } = await import(coreUrl)
const themeUrl = url(compile(sources.get('canvasTheme.ts')))
const { createArtEquationCanvasScene: project } = await import(url(compile(sources.get('board/artEquationCanvasAdapter.ts'))
  .replace(/from ['"]\.\/velloVectorGeometry['"]/g, `from '${geometryModuleUrl}'`)
  .replace(/from ['"]\.\/diagramStructureCore['"]/g, `from '${coreUrl}'`)
  .replace(/from ['"]\.\.\/canvasTheme['"]/g, `from '${themeUrl}'`)))
const eligibilityUrl = url(compile(sources.get('board/velloEligibility.ts')))
const app = ts.createSourceFile('App.tsx', sources.get('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const backdrop = ts.createSourceFile('backdrop.tsx', sources.get('board/VelloBoardBackdrop.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const find = (tree, predicate) => { let found; const visit = node => { if (found) return; if (predicate(node)) found = node; else ts.forEachChild(node, visit) }; visit(tree); assert(found, 'Actual source oracle missing'); return found.getText(tree) }
const named = (tree, name) => find(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === name)
const { velloBoardSnapshot } = await import(url(`import {eligibleVelloObjects} from '${eligibilityUrl}';${compile(`${named(backdrop, 'commands')}\n${named(backdrop, 'velloBoardSnapshot')}`)}`))
const { appLayerCommand } = await import(url(`import {changeDrawingLayerOrder} from '${layersUrl}';${compile(`export function appLayerCommand(board,selectedIds,viewOnly=false,allowed=true){const commits=[],notices=[];const allowTransform=()=>allowed;const setDrawingNotice=v=>notices.push(v);const onBoardChange=b=>commits.push(b);${named(app, 'changeLayer')};return {execute:changeLayer,commits,notices}}`)}`))
const hierarchyDeclaration = find(app, node => ts.isVariableDeclaration(node) && node.name.getText(app) === 'hierarchyProjection')
const { actualHierarchy } = await import(url(`import {projectDrawingLayers} from '${layersUrl}';${compile(`export function actualHierarchy(board){const useMemo=f=>f();const ${hierarchyDeclaration};return hierarchyProjection;}`)}`))

const node = (id, extra = {}) => ({ id, title: id, kind: 'shape', shapeType: 'ellipse', body: '', x: 10, y: 10, width: 100, height: 100, color: '#ff0000', strokeWidth: 0, ...extra })
const unwrap = result => { assert(result.ok, JSON.stringify(result)); return result.value }
const order = nodes => unwrap(containerPaintOrder(nodes)).orderedIds
const board = nodes => ({ id: 'disposable-drawing-layers', title: 'Layer acceptance', nodes, connectors: [], viewport: { x: 0, y: 0, scale: 1 }, gridVisible: false })
const scene = nodes => project(board(nodes), [], { background: '#00000000', grid: '#333333' })
const cases = [], check = (name, run) => { run(); cases.push(name) }

check('regression counterexample: old shared edge rank changed multi-selection order', () => {
  const nodes = [node('upper', { zIndex: 20 }), node('other', { zIndex: 10 }), node('lower', { zIndex: 0 })]
  const old = nodes.map(n => n.id === 'other' ? n : { ...n, zIndex: 21 })
  assert.deepEqual(order(old), ['other', 'upper', 'lower'])
  const next = unwrap(reorder(nodes, ['upper', 'lower'], 'front'))
  assert.deepEqual(order(next), ['other', 'lower', 'upper']); assert.equal(next[1], nodes[1])
})
check('front/back preserve selected and unselected relative order independently of selection order', () => {
  const nodes = [node('a', { zIndex: 10 }), node('b', { zIndex: 0 }), node('c', { zIndex: 5 }), node('d', { zIndex: 20 })]
  assert.deepEqual(order(unwrap(reorder(nodes, ['a', 'b'], 'front'))), ['c', 'd', 'b', 'a'])
  assert.deepEqual(order(unwrap(reorder(nodes, ['b', 'a'], 'back'))), ['b', 'a', 'c', 'd'])
  assert.deepEqual(order(unwrap(reorder(nodes, ['a', 'b', 'a'], 'front'))), ['c', 'd', 'b', 'a'])
})
check('absent/default and tied ranks match actual group/column/shape paint defaults', () => {
  const nodes = [node('shape'), node('group', { kind: 'group' }), node('column', { kind: 'column' }), node('tie')]
  assert.deepEqual(order(nodes), ['group', 'column', 'shape', 'tie'])
  assert.deepEqual(order(unwrap(reorder(nodes, ['column', 'group'], 'front'))), ['shape', 'tie', 'group', 'column'])
  assert.deepEqual(order(unwrap(reorder(nodes, ['shape', 'tie'], 'back'))), ['shape', 'tie', 'group', 'column'])
})
check('selected parent subtree moves once; selected descendants retain authored rank and identity', () => {
  const nodes = [node('group', { kind: 'group' }), node('child', { groupId: 'group', zIndex: -100 }), node('other', { zIndex: 5 })]
  const next = unwrap(reorder(nodes, ['child', 'group'], 'front'))
  assert.deepEqual(order(next), ['other', 'group', 'child']); assert.equal(next[1], nodes[1]); assert.equal(next[2], nodes[2])
})
check('independent sibling owners and column layout order are never reparented or relaid out', () => {
  const nodes = [node('g', { kind: 'group' }), node('a', { groupId: 'g', zIndex: 0 }), node('b', { groupId: 'g', zIndex: 2 }),
    node('c', { kind: 'column' }), node('x', { parentColumnId: 'c', columnOrder: 10, zIndex: 0 }), node('y', { parentColumnId: 'c', columnOrder: 0, zIndex: 2 }), node('top')]
  const next = unwrap(reorder(nodes, ['a', 'x'], 'front'))
  assert.deepEqual(order(next), ['g', 'b', 'a', 'c', 'y', 'x', 'top'])
  for (let i = 0; i < nodes.length; i++) { const { zIndex: before, ...a } = nodes[i], { zIndex: after, ...b } = next[i]; assert.deepEqual(b, a) }
})
check('projection is topmost sibling first, parent before children, and exactly matches scene ordinals', () => {
  const nodes = [node('g', { kind: 'group', zIndex: 10 }), node('a', { groupId: 'g', zIndex: -10 }), node('b', { groupId: 'g', zIndex: 40 }), node('low', { zIndex: 0 })]
  const rows = unwrap(actualHierarchy(board(nodes)))
  assert.deepEqual(rows.map(r => [r.node.id, r.depth]), [['g', 0], ['b', 1], ['a', 1], ['low', 0]])
  for (const row of rows) assert.equal(row.paintOrder, scene(nodes).objects.find(o => o.id === row.node.id).order)
  assert.equal(rows[0].node, nodes[0])
})
check('visibility and locks inherit; local flags survive derivation; locked/hidden selected subtree refuses atomically', () => {
  for (const extra of [{ locked: true }, { hidden: true }, { collapsed: true }]) {
    const nodes = [node('g', { kind: 'group', ...extra }), node('child', { groupId: 'g' }), node('other')], before = JSON.stringify(nodes)
    const row = unwrap(projectDrawingLayers(nodes)).find(r => r.node.id === 'child'), states = unwrap(diagramProjectionStates(nodes))
    assert.equal(row.locked, states.get('child').locked); assert.equal(row.hidden, states.get('child').hidden)
    assert.equal(reorder(nodes, ['child'], 'front').ok, false); assert.equal(reorder(nodes, ['g'], 'front').ok, false)
    assert.equal(JSON.stringify(nodes), before)
  }
  const nodes = [node('g', { kind: 'group' }), node('child', { groupId: 'g', hidden: true }), node('other')]
  assert.equal(reorder(nodes, ['g'], 'front').ok, false)
})
check('unselected locked and hidden siblings stay byte-identical while editable objects can change rank', () => {
  const nodes = [node('a', { zIndex: 0 }), node('b', { zIndex: 2, locked: true }), node('c', { zIndex: 3, hidden: true })]
  const next = unwrap(reorder(nodes, ['a'], 'front')); assert.equal(next[1], nodes[1]); assert.equal(next[2], nodes[2])
  assert.deepEqual(order(next), ['b', 'c', 'a'])
})
check('invalid ownership, duplicate identities and nonfinite ranks fail closed without partial edits', () => {
  for (const nodes of [[node('a', { groupId: 'missing' })], [node('a'), node('a')],
    [node('a', { kind: 'group', groupId: 'b' }), node('b', { kind: 'group', groupId: 'a' })],
    [node('g', { kind: 'group' }), node('c', { kind: 'column' }), node('a', { groupId: 'g', parentColumnId: 'c' })],
    [node('a', { zIndex: Infinity })], [node('a', { zIndex: NaN })]]) {
    const before = structuredClone(nodes); assert.equal(projectDrawingLayers(nodes).ok, false)
    assert.equal(reorder(nodes, ['a'], 'front').ok, false); assert.deepEqual(nodes, before)
  }
})
check('unknown selected identity and invalid mind-map topology reject; empty selection is unchanged', () => {
  const nodes = [node('a')]; assert.equal(reorder(nodes, ['missing'], 'back').ok, false)
  assert.equal(unwrap(reorder(nodes, [], 'front')), nodes)
  const invalid = [node('a', { mindMap: { version: 1, treeId: 't', parentId: 'missing', order: 0 } })]
  assert.equal(projectDrawingLayers(invalid).ok, false); assert.equal(reorder(invalid, ['a'], 'back').ok, false)
})
check('numeric capacity failure is atomic across several sibling families', () => {
  const nodes = [node('g', { kind: 'group' }), node('a', { groupId: 'g', zIndex: 0 }), node('b', { groupId: 'g', zIndex: 2 }),
    node('c', { kind: 'group' }), node('x', { groupId: 'c', zIndex: 0 }), node('y', { groupId: 'c', zIndex: 1e308 })]
  const before = structuredClone(nodes), result = reorder(nodes, ['a', 'x'], 'front')
  assert.equal(result.ok, false); assert.equal(result.issues[0].code, 'layer-rank-capacity'); assert.deepEqual(nodes, before)
  assert.equal(reorder([node('a', { zIndex: 0 }), node('b', { zIndex: -1e308 })], ['a'], 'back').ok, false)
})
check('already-front/back/all-selected requests preserve exact array identity and avoid history writes', () => {
  const nodes = [node('a', { zIndex: 0 }), node('b', { zIndex: 2 })]
  for (const [ids, delta] of [[['b'], 1], [['a'], -1], [['b', 'a'], 1], [[], 1]]) {
    const actual = appLayerCommand(board(nodes), ids); actual.execute(delta); assert.equal(actual.commits.length, 0)
  }
  assert.equal(unwrap(reorder(nodes, ['b'], 'front')), nodes)
})
check('actual App handler creates one history input; read-only/blocked/refused requests create none', () => {
  const nodes = [node('a', { zIndex: 0 }), node('b', { zIndex: 2 })], b = board(nodes)
  const actual = appLayerCommand(b, ['a']); actual.execute(1); assert.equal(actual.commits.length, 1)
  assert.deepEqual(order(actual.commits[0].nodes), ['b', 'a']); assert.equal(actual.commits[0].connectors, b.connectors)
  for (const args of [[b, ['a'], true], [b, ['a'], false, false], [board([node('a', { locked: true })]), ['a']]]) {
    const call = appLayerCommand(...args); call.execute(1); assert.equal(call.commits.length, 0)
  }
  const refused = appLayerCommand(b, ['missing']); refused.execute(-1); assert.equal(refused.commits.length, 0); assert.equal(refused.notices.length, 1)
})
check('pure JSON save/reopen and undo snapshot preserve hierarchy and render revisions', () => {
  const nodes = [node('a', { zIndex: 0 }), node('b', { zIndex: 2 })], before = JSON.stringify(nodes)
  const next = unwrap(reorder(nodes, ['a'], 'front')), reopened = JSON.parse(JSON.stringify(board(next)))
  assert.deepEqual(order(reopened.nodes), ['b', 'a']); assert.equal(JSON.stringify(nodes), before)
  const original = scene(nodes), changed = scene(next)
  assert.notEqual(changed.objects.find(o => o.id === 'a').revision, original.objects.find(o => o.id === 'a').revision)
  assert.deepEqual(scene(nodes).objects.map(o => [o.id, o.order]), original.objects.map(o => [o.id, o.order]))
})
check('deep valid ownership uses iterative row traversal and leaves all saved records untouched', () => {
  const nodes = Array.from({ length: 600 }, (_, i) => node(`g${i}`, { kind: 'group', ...(i ? { groupId: `g${i - 1}` } : {}) }))
  const before = JSON.stringify(nodes), rows = unwrap(projectDrawingLayers(nodes))
  assert.equal(rows.length, 600); assert.equal(rows.at(-1).depth, 599); assert.equal(JSON.stringify(nodes), before)
})

const engine = await import(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm.js', import.meta.url))
const wasm = await readFile(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm', import.meta.url))
await engine.default({ module_or_path: wasm })
const raster = nodes => engine.render_cpu_snapshot(128, 128, velloBoardSnapshot(scene(nodes), [], 1, true).json, 1, 0, 0)
const pixel = image => [...image.slice((60 * 128 + 60) * 4, (60 * 128 + 60) * 4 + 4)]
check('genuine Vello CPU pixel order changes with real multi-selection command and restores on undo', () => {
  const nodes = [node('upper', { zIndex: 20, color: '#ff0000' }), node('other', { zIndex: 30, color: '#00ff00' }), node('lower', { zIndex: 0, color: '#0000ff' })]
  assert.deepEqual(pixel(raster(nodes)), [0, 255, 0, 255])
  assert.deepEqual(pixel(raster(unwrap(reorder(nodes, ['upper', 'lower'], 'front')))), [255, 0, 0, 255])
  assert.deepEqual(pixel(raster(unwrap(reorder(nodes, ['upper', 'lower'], 'back')))), [0, 255, 0, 255])
  assert.deepEqual(pixel(raster(nodes)), [0, 255, 0, 255])
})
check('genuine CPU receives inherited visibility and hidden siblings never paint', () => {
  const nodes = [node('visible', { zIndex: 0 }), node('hidden', { zIndex: 20, color: '#00ff00', hidden: true })]
  assert.deepEqual(pixel(raster(nodes)), [255, 0, 0, 255])
  assert.equal(scene(nodes).objects.find(o => o.id === 'hidden').hidden, true)
})
const evidence = new URL('../../docs/engine-p0/2026-10-03/drawing-layers/', import.meta.url)
await mkdir(evidence, { recursive: true })
await writeFile(new URL('layer-tests.json', evidence), JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, checks: cases.length, cases, hashes,
  wasmSha256: createHash('sha256').update(wasm).digest('hex'), limits: ['Actual App handler extracted from source; not a full mounted CanvasPane or native UI test.',
    'JSON round-trip uses disposable records, not native workspace persistence.', 'No persistent layer schema, isolated group opacity, blend modes, masks or GPU layer-panel acceptance claimed.'] }, null, 2))
console.log(JSON.stringify({ passed: true, checks: cases.length }, null, 2))
