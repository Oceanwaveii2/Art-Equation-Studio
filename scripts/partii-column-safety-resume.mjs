import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

// Actual production helpers with disposable in-memory fixtures only. No host
// clipboard, native filesystem, live projects, source assets or EXEs are touched.
const sources = ['src/board/diagramStructureCore.ts', 'src/board/columns.ts', 'src/board/containerPaintOrder.ts', 'src/model/vector.ts']
const sourceCode = await Promise.all(sources.map((path) => readFile(resolve(path), 'utf8')))
// Load the actual dependency graph. The old data-URL loader substituted only
// two dependencies and fails as production helpers acquire new imports.
const { registerHooks } = await import('node:module')
const { pathToFileURL } = await import('node:url')
registerHooks({resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.'))return next(specifier+'.ts',context);throw error}}})
const D = await import(pathToFileURL(resolve(sources[0])).href)
const C = await import(pathToFileURL(resolve(sources[1])).href)
const P = await import(pathToFileURL(resolve(sources[2])).href)
const checks = [], test = (name, run) => { run(); checks.push(name) }
const node = (id, extra = {}) => ({ id, kind: 'note', title: id, x: 10, y: 20, width: 100, height: 60, ...extra })
const group = (id, extra = {}) => node(id, { kind: 'group', containerRole: 'frame', width: 170, height: 120, ...extra })
const column = (id, extra = {}) => node(id, { kind: 'column', width: 250, height: 300, ...extra })
const board = (nodes, connectors = []) => ({ id: 'disposable-columns', title: 'Column safety fixture', viewport: { x: 0, y: 0, scale: 1 }, nodes, connectors })
const edge = (id, sourceId, targetId, extra = {}) => ({ id, sourceId, targetId, sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#60a5fa', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false, ...extra })
const get = (state, id) => state.nodes.find((entry) => entry.id === id)
const value = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const failure = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert(result.issues.some((issue) => issue.code === code), JSON.stringify(result)); assert(result.issues[0].detail.length > 10) }
const snapshot = (data) => JSON.stringify(data)
const delta = (a, b) => ({ x: b.x - a.x, y: b.y - a.y })

test('Explicit insertion clears old group ownership, preserves unrelated nodes and source input', () => {
  const before = board([group('g'), node('leaf', { groupId: 'g' }), column('dest', { x: 400 }), column('untouched', { x: 900, locked: true }), node('locked', { parentColumnId: 'untouched', locked: true })])
  const saved = snapshot(before), after = value(C.insertNodesIntoColumnResult(before, ['leaf'], { columnId: 'dest', index: 0 }))
  assert.equal(get(after, 'leaf').groupId, undefined); assert.equal(get(after, 'leaf').parentColumnId, 'dest'); assert.equal(get(after, 'leaf').columnOrder, 0)
  value(D.validateContainerOwnership(after.nodes)); assert.equal(get(after, 'untouched'), get(before, 'untouched')); assert.equal(get(after, 'locked'), get(before, 'locked'))
  assert.equal(snapshot(before), saved)
})

test('Mixed parent plus leaf selection reparents only top roots with no duplicated rows', () => {
  const before = board([group('g'), group('inner', { groupId: 'g' }), node('leaf', { groupId: 'inner' }), column('dest', { x: 500 })])
  const after = value(C.insertNodesIntoColumnResult(before, ['leaf', 'g', 'inner', 'g'], { columnId: 'dest', index: 0 }))
  assert.deepEqual(C.columnChildren(after, 'dest').map((entry) => entry.id), ['g'])
  assert.equal(get(after, 'inner').groupId, 'g'); assert.equal(get(after, 'leaf').groupId, 'inner'); assert.equal(get(after, 'leaf').parentColumnId, undefined)
  value(D.validateContainerOwnership(after.nodes))
})

for (const [name, setup, code] of [
  ['locked destination', (nodes) => nodes.map((entry) => entry.id === 'dest' ? { ...entry, locked: true } : entry), 'uneditable-owner'],
  ['hidden destination', (nodes) => nodes.map((entry) => entry.id === 'dest' ? { ...entry, hidden: true } : entry), 'uneditable-owner'],
  ['collapsed destination', (nodes) => nodes.map((entry) => entry.id === 'dest' ? { ...entry, collapsed: true } : entry), 'uneditable-owner'],
  ['destination locked ancestor', (nodes) => [...nodes.map((entry) => entry.id === 'dest' ? { ...entry, groupId: 'owner' } : entry), group('owner', { locked: true })], 'uneditable-owner'],
  ['destination hidden ancestor', (nodes) => [...nodes.map((entry) => entry.id === 'dest' ? { ...entry, groupId: 'owner' } : entry), group('owner', { hidden: true })], 'uneditable-owner'],
  ['moving locked leaf', (nodes) => nodes.map((entry) => entry.id === 'leaf' ? { ...entry, locked: true } : entry), 'locked-object'],
  ['moving inherited lock', (nodes) => [...nodes.map((entry) => entry.id === 'leaf' ? { ...entry, groupId: 'owner' } : entry), group('owner', { locked: true })], 'locked-object'],
  ['moving inherited hidden state', (nodes) => [...nodes.map((entry) => entry.id === 'leaf' ? { ...entry, groupId: 'owner' } : entry), group('owner', { collapsed: true })], 'hidden-object'],
]) test(`Insertion refuses ${name} atomically with actionable reason`, () => {
  const before = board(setup([node('leaf'), column('dest', { x: 400 })])), saved = snapshot(before)
  failure(C.insertNodesIntoColumnResult(before, ['leaf'], { columnId: 'dest', index: 0 }), code)
  assert.equal(C.insertNodesIntoColumn(before, ['leaf'], { columnId: 'dest', index: 0 }), before); assert.equal(snapshot(before), saved)
  assert.equal(C.findColumnDropTarget(before, 450, 100, new Set(['leaf'])), null)
})

test('Destination cycles, dual ownership, missing selection and invalid order fail closed', () => {
  const cycle = board([group('g'), column('dest', { groupId: 'g' }), node('leaf', { parentColumnId: 'dest' })])
  failure(C.insertNodesIntoColumnResult(cycle, ['g'], { columnId: 'dest', index: 0 }), 'ownership-cycle')
  assert.equal(C.findColumnDropTarget(cycle, 30, 100, new Set(['g'])), null)
  failure(C.findColumnDropTargetResult(cycle, 30, 100, new Set(['g'])), 'ownership-cycle')
  const dual = board([group('g'), column('dest'), node('leaf', { groupId: 'g', parentColumnId: 'dest' })])
  failure(C.insertNodesIntoColumnResult(dual, ['leaf'], { columnId: 'dest', index: 0 }), 'ambiguous-owner')
  failure(C.layoutBoardColumnsResult(dual), 'ambiguous-owner')
  const base = board([node('leaf'), column('dest')])
  failure(C.insertNodesIntoColumnResult(base, ['leaf', 'gone'], { columnId: 'dest', index: 0 }), 'missing-object')
  failure(C.insertNodesIntoColumnResult(base, ['leaf'], { columnId: 'dest', index: NaN }), 'invalid-column-index')
  failure(C.insertNodesIntoColumnResult(base, ['leaf'], { columnId: 'dest', index: -1 }), 'invalid-column-index')
  failure(C.insertNodesIntoColumnResult(base, ['leaf'], { columnId: 'leaf', index: 0 }), 'wrong-owner-kind')
  failure(C.findColumnDropTargetResult(board([column('dest', { locked: true }), node('leaf')]), 30, 100, new Set(['leaf'])), 'uneditable-owner')
  assert.equal(value(C.findColumnDropTargetResult(base, 900, 900, new Set(['leaf']))), null)
})

test('Nested frame moves all owned descendants and internal/free routes with one delta', () => {
  const before = board([column('dest', { x: 500, y: 100 }), group('outer', { parentColumnId: 'dest', columnOrder: 0 }), group('inner', { groupId: 'outer', x: 20, y: 30, width: 110, height: 80 }), node('a', { groupId: 'inner', x: 30, y: 40 }), node('b', { groupId: 'outer', x: 55, y: 70 }), node('outside', { x: 900 })], [edge('internal', 'a', 'b', { bendPoints: [{ x: 44, y: 66 }] }), edge('free', 'a', undefined, { targetPoint: { x: 8, y: 9 }, bendPoints: [{ x: 12, y: 13 }] }), edge('boundary', 'a', 'outside', { bendPoints: [{ x: 999, y: 888 }] }), edge('detached', undefined, undefined, { sourcePoint: { x: 1, y: 2 }, targetPoint: { x: 3, y: 4 } })])
  const saved = snapshot(before), after = value(C.layoutBoardColumnsResult(before, ['dest'])), moved = delta(get(before, 'outer'), get(after, 'outer'))
  assert.deepEqual(moved, { x: 500, y: 176 })
  for (const id of ['outer', 'inner', 'a', 'b']) { assert.deepEqual(delta(get(before, id), get(after, id)), moved); assert.deepEqual([get(after, id).width, get(after, id).height], [get(before, id).width, get(before, id).height]) }
  assert.deepEqual(after.connectors[0].bendPoints, [{ x: 544, y: 242 }]); assert.deepEqual(after.connectors[1].targetPoint, { x: 508, y: 185 }); assert.deepEqual(after.connectors[1].bendPoints, [{ x: 512, y: 189 }])
  assert.equal(after.connectors[2], before.connectors[2]); assert.equal(after.connectors[3], before.connectors[3]); assert.equal(get(after, 'outside'), get(before, 'outside')); assert.equal(snapshot(before), saved)
})

test('Parent-only reflow preserves nested column size and translates its contents', () => {
  const before = board([column('parent', { x: 500 }), column('nested', { parentColumnId: 'parent', columnOrder: 0, width: 340, height: 410 }), node('a', { parentColumnId: 'nested', columnOrder: 0 })])
  const after = value(C.layoutBoardColumnsResult(before, ['parent']))
  assert.deepEqual([get(after, 'nested').width, get(after, 'nested').height], [340, 410]); assert.equal(get(after, 'parent').width, 360)
  assert.deepEqual(delta(get(before, 'nested'), get(after, 'nested')), delta(get(before, 'a'), get(after, 'a')))
})

test('Node-scoped entry point includes transitive owning columns and leaves freeform edits alone', () => {
  const base = board([column('outer'), group('frame', { parentColumnId: 'outer', columnOrder: 0, height: 220 }), column('inner', { groupId: 'frame', height: 180 }), node('row', { parentColumnId: 'inner', columnOrder: 0 }), column('unrelated'), node('locked', { parentColumnId: 'unrelated', locked: true }), node('free')])
  const after = value(C.layoutBoardColumnsForNodesResult(base, ['row']))
  assert.equal(get(after, 'row').x, get(after, 'inner').x + C.COLUMN_PADDING)
  assert.equal(get(after, 'frame').y, get(after, 'outer').y + C.COLUMN_HEADER_HEIGHT + C.COLUMN_PADDING + C.COLUMN_FRAME_HEADER_HEIGHT)
  assert.equal(get(after, 'unrelated'), get(base, 'unrelated')); assert.equal(get(after, 'locked'), get(base, 'locked'))
  assert.equal(value(C.layoutBoardColumnsForNodesResult(base, ['free'])), base)
  failure(C.layoutBoardColumnsForNodesResult(base, ['missing']), 'missing-object')
})

for (const treatment of [{ locked: true }, { hidden: true }]) test(`Changed row with ${Object.keys(treatment)[0]} descendant refuses entire scoped layout`, () => {
  const before = board([column('dest', { x: 500 }), group('g', { parentColumnId: 'dest' }), node('leaf', { groupId: 'g', ...treatment })]), saved = snapshot(before)
  failure(C.layoutBoardColumnsResult(before, ['dest']), treatment.locked ? 'locked-object' : 'hidden-object')
  assert.equal(C.layoutBoardColumns(before, ['dest']), before); assert.equal(snapshot(before), saved)
})

test('Insertion/release reflows only source, target and owning columns', () => {
  const base = value(C.layoutBoardColumnsResult(board([column('src'), node('a', { parentColumnId: 'src', columnOrder: 0, freeWidth: 100, freeHeight: 60 }), node('b', { parentColumnId: 'src', columnOrder: 1, freeWidth: 100, freeHeight: 60 }), column('dest', { x: 500 }), column('unrelated', { x: 900 }), node('odd', { parentColumnId: 'unrelated', columnOrder: 8, locked: true, x: -123, y: -456 })]), ['src', 'dest']))
  const inserted = value(C.insertNodesIntoColumnResult(base, ['a'], { columnId: 'dest', index: 0 }))
  assert.equal(get(inserted, 'unrelated'), get(base, 'unrelated')); assert.equal(get(inserted, 'odd'), get(base, 'odd')); assert.equal(get(inserted, 'b').columnOrder, 0)
  const released = value(C.releaseNodesFromColumnsResult(inserted, ['a']))
  assert.equal(get(released, 'a').parentColumnId, undefined); assert.equal(get(released, 'a').columnOrder, undefined); assert.deepEqual([get(released, 'a').width, get(released, 'a').height], [100, 60]); assert.equal(get(released, 'odd'), get(base, 'odd'))
})

test('Reordering a locked target row refuses even when its geometry already fits', () => {
  const base = value(C.layoutBoardColumnsResult(board([column('dest'), node('locked', { parentColumnId: 'dest', columnOrder: 0 }), node('moving')]), ['dest']))
  const before = { ...base, nodes: base.nodes.map((entry) => entry.id === 'locked' ? { ...entry, locked: true } : entry) }
  failure(C.insertNodesIntoColumnResult(before, ['moving'], { columnId: 'dest', index: 0 }), 'locked-object')
  // Appending after an unchanged locked row is allowed: no lock bypass or row movement.
  const after = value(C.insertNodesIntoColumnResult(before, ['moving'], { columnId: 'dest', index: 1 }))
  assert.equal(get(after, 'locked'), get(before, 'locked')); assert.equal(get(after, 'moving').columnOrder, 1)
})

test('Release retains freeform ownership and nested dimensions; refuses locked remaining reflow', () => {
  const freeform = board([group('g'), node('leaf', { groupId: 'g' })])
  assert.equal(value(C.releaseNodesFromColumnsResult(freeform, ['leaf'])), freeform)
  const base = value(C.layoutBoardColumnsResult(board([column('src'), group('g', { parentColumnId: 'src', columnOrder: 0 }), node('leaf', { groupId: 'g' }), node('locked', { parentColumnId: 'src', columnOrder: 1 })]), ['src']))
  const locked = { ...base, nodes: base.nodes.map((entry) => entry.id === 'locked' ? { ...entry, locked: true } : entry) }
  failure(C.releaseNodesFromColumnsResult(locked, ['g', 'leaf']), 'locked-object'); assert.equal(C.releaseNodesFromColumns(locked, ['g']), locked)
  const after = value(C.releaseNodesFromColumnsResult(base, ['g', 'leaf']))
  assert.equal(get(after, 'g').parentColumnId, undefined); assert.equal(get(after, 'leaf').groupId, 'g'); assert.deepEqual([get(after, 'g').width, get(after, 'g').height], [170, 120])
})

test('Whole-board normalization leaves inherited-locked and hidden columns byte-identical', () => {
  const base = board([group('locked-owner', { locked: true }), column('locked-column', { groupId: 'locked-owner' }), node('odd', { parentColumnId: 'locked-column', x: -20 }), column('hidden', { hidden: true }), column('editable', { x: 500 }), node('row', { parentColumnId: 'editable' })])
  const after = value(C.layoutBoardColumnsResult(base))
  for (const id of ['locked-owner', 'locked-column', 'odd', 'hidden']) assert.equal(get(after, id), get(base, id))
  failure(C.layoutBoardColumnsResult(base, ['locked-column']), 'uneditable-owner')
  assert.equal(get(after, 'row').x, 510)
})

test('Compact full-width subboard rows preserve order between mixed content', () => {
  const tile = (id, order) => node(id, { kind: 'board-link', boardLinkRole: 'child', boardPortal: { boardId: id }, parentColumnId: 'dest', columnOrder: order })
  const after = value(C.layoutBoardColumnsResult(board([column('dest', { x: 100, y: 100, width: 290 }), tile('t0', 0), tile('t1', 1), node('middle', { parentColumnId: 'dest', columnOrder: 2 }), tile('t2', 3)]), ['dest']))
  assert.deepEqual([get(after, 't0').x, get(after, 't0').y, get(after, 't0').width, get(after, 't0').height], [110, 168, 270, 72])
  assert.deepEqual([get(after, 't1').x, get(after, 't1').y], [110, 250]); assert.equal(get(after, 'middle').y, 332); assert.equal(get(after, 't2').y, 504)
})

test('Fifty-image scoped reflow and JSON reopen are stable; source/target order remains unique', () => {
  let current = value(C.layoutBoardColumnsResult(board([column('a'), column('b', { x: 400 }), ...Array.from({ length: 50 }, (_, index) => node(`image-${index}`, { kind: 'image', parentColumnId: 'a', columnOrder: index, freeWidth: 100 + index, freeHeight: 60 + index }))]), ['a', 'b']))
  for (let index = 0; index < 10; index++) current = JSON.parse(JSON.stringify(value(C.insertNodesIntoColumnResult(current, [`image-${index}`], { columnId: 'b', index: index % 3 }))))
  value(D.validateContainerOwnership(current.nodes)); assert.equal(C.columnChildren(current, 'a').length, 40); assert.equal(C.columnChildren(current, 'b').length, 10)
  for (const id of ['a', 'b']) assert.deepEqual(C.columnChildren(current, id).map((entry) => entry.columnOrder), Array.from({ length: C.columnChildren(current, id).length }, (_, index) => index))
  assert.equal(snapshot(value(C.layoutBoardColumnsResult(current, ['a', 'b']))), snapshot(current))
})

test('Paint order follows validated parent-before-descendant contiguous subtrees, preserving explicit zero', () => {
  const nodes = [node('content'), column('host'), group('frame', { parentColumnId: 'host', zIndex: -10 }), column('inner', { groupId: 'frame', zIndex: -100 }), node('leaf', { parentColumnId: 'inner', zIndex: -999 }), node('sibling', { parentColumnId: 'host' }), node('zero', { zIndex: 0 })]
  const before = snapshot(nodes), order = value(P.containerPaintOrder(nodes))
  assert.deepEqual(order.orderedIds, ['zero', 'host', 'frame', 'inner', 'leaf', 'sibling', 'content'])
  assert.deepEqual([...order.zIndexById.values()], [0, 1, 2, 3, 4, 5, 6]); assert.equal(snapshot(nodes), before)
  assert(order.zIndexById.get('inner') > order.zIndexById.get('host')); assert(order.zIndexById.get('frame') > order.zIndexById.get('host'))
})

test('Sibling paint layers use explicit values then stable model ties, with no ownership escape', () => {
  const nodes = [group('back', { zIndex: -1 }), node('child-front', { groupId: 'back', zIndex: 10000 }), node('first'), node('second'), group('front', { zIndex: 3 }), node('child-back', { groupId: 'front', zIndex: -10000 })]
  assert.deepEqual(value(P.containerPaintOrder(nodes)).orderedIds, ['back', 'child-front', 'first', 'second', 'front', 'child-back'])
  failure(P.containerPaintOrder([column('c'), group('g'), node('dual', { groupId: 'g', parentColumnId: 'c' })]), 'ambiguous-owner')
  failure(P.containerPaintOrder([group('g', { groupId: 'g' })]), 'self-owner')
  failure(P.containerPaintOrder([node('bad', { zIndex: Infinity })]), 'invalid-layer')
})

test('Deep paint order traverses iteratively and frame labels fit after preceding column cards', () => {
  const nodes = Array.from({ length: 4000 }, (_, index) => group(`deep-${index}`, index ? { groupId: `deep-${index - 1}` } : {}))
  const order = value(P.containerPaintOrder(nodes)); assert.equal(order.orderedIds.length, 4000); assert.equal(order.zIndexById.get('deep-3999'), 3999)
  const laidOut = value(C.layoutBoardColumnsResult(board([column('c'), node('row', { parentColumnId: 'c', columnOrder: 0 }), group('frame', { parentColumnId: 'c', columnOrder: 1 })]), ['c']))
  const row = get(laidOut, 'row'), frame = get(laidOut, 'frame')
  assert.equal(frame.y - C.COLUMN_FRAME_HEADER_HEIGHT, row.y + row.height + C.COLUMN_GAP)
})

const directory = resolve('output/partii-column-safety-resume')
await mkdir(directory, { recursive: true })
await writeFile(resolve(directory, 'report.json'), JSON.stringify({ status: 'passed', generatedAt: new Date().toISOString(), checks: checks.length, passed: checks, sourceHashes: Object.fromEntries(sources.map((path, index) => [path, createHash('sha256').update(sourceCode[index]).digest('hex')])), limitations: ['In-memory production helper regressions; rendered drag/Undo/reload and native acceptance remain separate gates', 'No production projects, host clipboard, native filesystem or existing EXEs modified'] }, null, 2))
console.log(`PASS ${checks.length}/${checks.length} column safety regression groups`)
