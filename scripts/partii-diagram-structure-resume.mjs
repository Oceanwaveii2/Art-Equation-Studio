import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'

// In-memory fixtures only. No Tauri calls, user projects, original assets or EXEs.
const sourcePath = process.env.PARTII_STRUCTURE_SOURCE || new URL('../src/board/diagramStructureCore.ts', import.meta.url)
const code = await readFile(sourcePath, 'utf8')
const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const D = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
const checks = [], test = (name, run) => { run(); checks.push(name) }
const node = (id, extra = {}) => ({ id, kind: 'note', title: id, x: 10, y: 20, width: 100, height: 60, ...extra })
const group = (id, extra = {}) => node(id, { kind: 'group', containerRole: 'group', ...extra })
const column = (id, extra = {}) => node(id, { kind: 'column', ...extra })
const edge = (id, sourceId, targetId, extra = {}) => ({ id, sourceId, targetId, sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#60a5fa', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false, ...extra })
const value = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
const failure = (result, code) => { assert.equal(result.ok, false); assert(result.issues.some((issue) => issue.code === code), JSON.stringify(result)) }
const base = [group('outer'), group('inner', { groupId: 'outer', containerRole: 'frame' }), column('col', { groupId: 'inner' }), node('a', { parentColumnId: 'col', columnOrder: 0 }), node('b', { groupId: 'inner' }), node('external')]
const digest = (input) => JSON.stringify(input)

test('Group, frame and column remain distinct with valid nested ownership', () => {
  value(D.validateContainerOwnership(base))
  assert.equal(base[1].containerRole, 'frame'); assert.equal(base[2].kind, 'column')
  assert.deepEqual(value(D.containerDescendantIds(base, ['outer'])), ['outer', 'inner', 'col', 'a', 'b'])
})
for (const [name, nodes, code] of [
  ['duplicate identities', [node('a'), node('a')], 'duplicate-id'],
  ['empty identities', [node('')], 'invalid-id'],
  ['dual ownership', [group('g'), column('c'), node('a', { groupId: 'g', parentColumnId: 'c' })], 'ambiguous-owner'],
  ['missing owners', [node('a', { groupId: 'missing' })], 'missing-owner'],
  ['wrong group owner', [column('c'), node('a', { groupId: 'c' })], 'wrong-owner-kind'],
  ['wrong column owner', [group('g'), node('a', { parentColumnId: 'g' })], 'wrong-owner-kind'],
  ['self parenting', [group('g', { groupId: 'g' })], 'self-owner'],
  ['mixed ownership cycles', [group('g', { parentColumnId: 'c' }), column('c', { groupId: 'g' })], 'ownership-cycle'],
  ['frame role on a noncontainer', [node('a', { containerRole: 'frame' })], 'invalid-container-role'],
]) test(`Ownership rejects ${name}`, () => failure(D.validateContainerOwnership(nodes), code))

test('Long imported ownership chains validate iteratively without stack overflow', () => {
  const nodes = Array.from({ length: 4000 }, (_, index) => group(`g${index}`, index ? { groupId: `g${index - 1}` } : {}))
  assert.equal(value(D.validateContainerOwnership(nodes)).size, 4000)
  assert.equal(value(D.containerDescendantIds(nodes, ['g0'])).length, 4000)
})
test('Missing selection is an error, not silent partial mutation', () => failure(D.containerDescendantIds(base, ['outer', 'missing']), 'missing-object'))
test('Inherited lock, hidden and collapse states do not leak selection', () => {
  for (const treatment of [{ locked: true }, { hidden: true }, { collapsed: true }]) {
    const nodes = base.map((entry) => entry.id === 'outer' ? { ...entry, ...treatment } : entry)
    const state = value(D.containerState(nodes, 'a'))
    assert.deepEqual(state.ancestors, ['col', 'inner', 'outer'])
    assert.equal(state.locked, Boolean(treatment.locked)); assert.equal(state.hidden, Boolean(treatment.hidden || treatment.collapsed))
    if (!treatment.locked) assert.deepEqual(value(D.visibleDiagramNodeIds(nodes)), treatment.hidden ? ['external'] : ['outer', 'external'])
  }
  assert.equal(value(D.containerState([group('own', { collapsed: true })], 'own')).hidden, false)
})
test('Unknown object state and unrelated corrupt ownership fail closed', () => {
  failure(D.containerState(base, 'missing'), 'missing-object')
  failure(D.moveContainerWithDescendants([...base, node('bad', { groupId: 'gone' })], [], ['b'], { x: 1, y: 1 }), 'missing-owner')
})

test('Reparent removes old column owner/order, preserves geometry and metadata', () => {
  const before = digest(base), moved = value(D.reparentContainerNodes(base, ['a'], { kind: 'group', id: 'outer' })).find((entry) => entry.id === 'a')
  assert.equal(moved.groupId, 'outer'); assert.equal(moved.parentColumnId, undefined); assert.equal(moved.columnOrder, undefined)
  assert.deepEqual([moved.x, moved.y, moved.width, moved.height], [10, 20, 100, 60]); assert.equal(digest(base), before)
})
test('Reparent appends stable column order without automatic layout', () => {
  const moved = value(D.reparentContainerNodes(base, ['b'], { kind: 'column', id: 'col' })).find((entry) => entry.id === 'b')
  assert.equal(moved.groupId, undefined); assert.equal(moved.parentColumnId, 'col'); assert.equal(moved.columnOrder, 1); assert.equal(moved.y, 20)
})
test('Nested selected roots are not flattened or assigned two owners', () => {
  const moved = value(D.reparentContainerNodes(base, ['inner', 'col', 'a']))
  assert.equal(moved.find((entry) => entry.id === 'inner').groupId, undefined)
  assert.equal(moved.find((entry) => entry.id === 'col').groupId, 'inner')
  assert.equal(moved.find((entry) => entry.id === 'a').parentColumnId, 'col')
})
for (const [name, result, code] of [
  ['self-descendant parent', D.reparentContainerNodes(base, ['outer'], { kind: 'group', id: 'inner' }), 'ownership-cycle'],
  ['missing parent', D.reparentContainerNodes(base, ['b'], { kind: 'group', id: 'missing' }), 'missing-owner'],
  ['wrong destination kind', D.reparentContainerNodes(base, ['b'], { kind: 'column', id: 'outer' }), 'wrong-owner-kind'],
  ['locked destination', D.reparentContainerNodes(base.map((entry) => entry.id === 'col' ? { ...entry, locked: true } : entry), ['external'], { kind: 'column', id: 'col' }), 'uneditable-owner'],
  ['hidden destination', D.reparentContainerNodes(base.map((entry) => entry.id === 'col' ? { ...entry, hidden: true } : entry), ['external'], { kind: 'column', id: 'col' }), 'uneditable-owner'],
]) test(`Reparent rejects ${name}`, () => failure(result, code))

test('Atomic descendant move shifts internal waypoints and leaves boundary routing fixed', () => {
  const edges = [edge('internal', 'a', 'b', { bendPoints: [{ x: 20, y: 30 }], vendorData: { retained: true } }), edge('boundary', 'b', 'external', { bendPoints: [{ x: 99, y: 88 }] }), edge('free', undefined, 'b', { sourcePoint: { x: 4, y: 5 }, bendPoints: [{ x: 66, y: 77 }] })]
  const before = digest({ base, edges }), moved = value(D.moveContainerWithDescendants(base, edges, ['outer', 'a'], { x: 23, y: -7 }))
  assert.deepEqual(moved.movedIds, ['outer', 'inner', 'col', 'a', 'b'])
  moved.nodes.forEach((entry) => assert.deepEqual([entry.x, entry.y], entry.id === 'external' ? [10, 20] : [33, 13]))
  assert.deepEqual(moved.connectors[0].bendPoints, [{ x: 43, y: 23 }]); assert.deepEqual(moved.connectors[0].vendorData, { retained: true })
  assert.equal(moved.connectors[1], edges[1]); assert.deepEqual(moved.connectors[2].sourcePoint, { x: 27, y: -2 }); assert.deepEqual(moved.connectors[2].bendPoints, [{ x: 89, y: 70 }]); assert.equal(digest({ base, edges }), before)
})
test('Detached anchors follow their sole moved attachment once; wholly free routes stay fixed', () => {
  const edges = [edge('free-target', 'a', undefined, { targetPoint: { x: 99, y: 77 }, bendPoints: [{ x: 20, y: 30 }] }), edge('free-source', undefined, 'a', { sourcePoint: { x: 66, y: 44 }, bendPoints: [{ x: 50, y: 60 }] }), edge('fully-free', undefined, undefined, { sourcePoint: { x: 1, y: 2 }, targetPoint: { x: 3, y: 4 }, bendPoints: [{ x: 5, y: 6 }] }), edge('outside-attachment', 'external', undefined, { targetPoint: { x: 7, y: 8 } })]
  const moved = value(D.moveContainerWithDescendants(base, edges, ['outer', 'a'], { x: 10, y: 20 }))
  assert.deepEqual(moved.connectors[0].targetPoint, { x: 109, y: 97 }); assert.deepEqual(moved.connectors[0].bendPoints, [{ x: 30, y: 50 }])
  assert.deepEqual(moved.connectors[1].sourcePoint, { x: 76, y: 64 }); assert.deepEqual(moved.connectors[1].bendPoints, [{ x: 60, y: 80 }])
  assert.equal(moved.connectors[2], edges[2]); assert.equal(moved.connectors[3], edges[3])
  failure(D.moveContainerWithDescendants(base, [edge('bad-free', 'a', undefined, { targetPoint: { x: NaN, y: 1 } })], ['a'], { x: 1, y: 2 }), 'invalid-endpoint')
})
for (const [name, treatment, code] of [['own lock', { locked: true }, 'locked-object'], ['explicit hidden descendant', { hidden: true }, 'hidden-object'], ['collapsed owner', { collapsed: true }, 'hidden-object']]) test(`Atomic movement rejects ${name} without mutating its source`, () => {
  const nodes = base.map((entry) => entry.id === (name === 'collapsed owner' ? 'inner' : 'a') ? { ...entry, ...treatment } : entry), before = digest(nodes)
  failure(D.moveContainerWithDescendants(nodes, [], ['outer'], { x: 5, y: 6 }), code); assert.equal(digest(nodes), before)
})
test('Movement rejects nonfinite coordinates, invalid routes and dangling endpoints', () => {
  failure(D.moveContainerWithDescendants(base, [], ['outer'], { x: Infinity, y: 2 }), 'invalid-delta')
  failure(D.moveContainerWithDescendants(base, [edge('bad', 'a', 'b', { bendPoints: [{ x: NaN, y: 2 }] })], ['outer'], { x: 1, y: 2 }), 'invalid-route')
  failure(D.moveContainerWithDescendants(base, [edge('bad', 'gone', 'b')], ['outer'], { x: 1, y: 2 }), 'missing-endpoint')
  failure(D.moveContainerWithDescendants(base, [edge('same', 'a', 'b'), edge('same', 'a', 'b')], ['outer'], { x: 1, y: 2 }), 'duplicate-connector')
})

const template = value(D.createMindMapTemplate('first-instance', { x: 200, y: 300 }))
test('The template has exactly 20 independent nodes and 19 child-identity edges', () => {
  assert.equal(template.nodes.length, 20); assert.equal(template.connectors.length, 19)
  assert.equal(value(D.validateMindMap(template.nodes, template.treeId)).size, 20)
  value(D.validateMindMapConnectors(template.nodes, template.connectors, template.treeId))
  assert(template.nodes.every((entry) => !entry.groupId && !entry.parentColumnId && !entry.targetBoardId))
})
test('Two template instances share no IDs or tree identities', () => {
  const second = value(D.createMindMapTemplate('second-instance', { x: 800, y: 100 }, [...template.nodes, ...template.connectors].map((entry) => entry.id)))
  assert.notEqual(second.treeId, template.treeId)
  assert.equal(new Set([...template.nodes, ...template.connectors, ...second.nodes, ...second.connectors].map((entry) => entry.id)).size, 78)
  value(D.validateMindMap([...template.nodes, ...second.nodes]))
  failure(D.createMindMapTemplate('first-instance', { x: 0, y: 0 }, template.nodes.map((entry) => entry.id)), 'template-id-collision')
})
test('Template rejects invalid namespace and nonfinite placement', () => {
  failure(D.createMindMapTemplate(''), 'invalid-namespace'); failure(D.createMindMapTemplate('invalid', { x: NaN, y: 0 }), 'invalid-layout')
})
test('Deterministic layout is idempotent and does not overlap any visible nodes', () => {
  const once = value(D.layoutMindMap(template.nodes, template.treeId)), twice = value(D.layoutMindMap(once, template.treeId))
  assert.deepEqual(once, twice)
  for (let a = 0; a < once.length; a++) for (let b = a + 1; b < once.length; b++) assert(!(once[a].x < once[b].x + once[b].width && once[a].x + once[a].width > once[b].x && once[a].y < once[b].y + once[b].height && once[a].y + once[a].height > once[b].y), `Overlap: ${once[a].id}/${once[b].id}`)
  assert.deepEqual([once[0].x, once[0].y], [200, 300])
})
test('Variable dimensions and spacing remain deterministic and finite', () => {
  const nodes = template.nodes.map((entry, index) => ({ ...entry, width: 100 + index * 4, height: 40 + index * 3 }))
  const arranged = value(D.layoutMindMap(nodes, template.treeId, { horizontalGap: 13, verticalGap: 7, origin: { x: -100, y: -200 } }))
  assert(arranged.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y)))
  assert.deepEqual(arranged, value(D.layoutMindMap(nodes, template.treeId, { horizontalGap: 13, verticalGap: 7, origin: { x: -100, y: -200 } })))
})
test('Collapsed branches hide descendants without deleting or relaying out them', () => {
  const nodes = template.nodes.map((entry, index) => index === 1 ? { ...entry, mindMap: { ...entry.mindMap, collapsed: true } } : entry), branch = value(D.mindMapBranchIds(nodes, nodes[1].id))
  const visible = value(D.visibleDiagramNodeIds(nodes))
  assert(visible.includes(nodes[1].id)); branch.slice(1).forEach((id) => assert(!visible.includes(id)))
  const arranged = value(D.layoutMindMap(nodes, template.treeId)); assert.equal(arranged.length, 20)
  branch.slice(1).forEach((id) => assert.deepEqual(arranged.find((entry) => entry.id === id), nodes.find((entry) => entry.id === id)))
})
test('Explicitly hidden branches hide their full mind-map subtree', () => {
  const nodes = template.nodes.map((entry, index) => index === 1 ? { ...entry, hidden: true } : entry), branch = value(D.mindMapBranchIds(nodes, nodes[1].id)), visible = value(D.visibleDiagramNodeIds(nodes))
  branch.forEach((id) => assert(!visible.includes(id)))
})
test('Mind-map visibility inherits hidden container ancestors across branch membership', () => {
  const owner = group('hidden-region', { hidden: true })
  const nodes = [owner, ...template.nodes.map((entry, index) => index === 1 ? { ...entry, groupId: owner.id } : entry)]
  const branch = value(D.mindMapBranchIds(nodes, template.nodes[1].id)), visible = value(D.visibleDiagramNodeIds(nodes))
  branch.forEach((id) => assert(!visible.includes(id)))
  assert.equal(value(D.diagramState(nodes, template.nodes[17].id)).hidden, true)
})
test('Mind-map descendants inherit parent locks without pretending they are group members', () => {
  const nodes = template.nodes.map((entry, index) => index === 1 ? { ...entry, locked: true } : entry)
  const state = value(D.diagramState(nodes, nodes[17].id))
  assert.equal(state.locked, true); assert.equal(state.hidden, false); assert.deepEqual(state.containerAncestors, [])
  assert.deepEqual(state.mindMapAncestors, [nodes[5].id, nodes[1].id, nodes[0].id])
  failure(D.moveContainerWithDescendants(nodes, template.connectors, [nodes[17].id], { x: 2, y: 3 }), 'locked-object')
})
test('Visible locked branch makes layout atomic while hidden locked descendants remain unchanged', () => {
  const locked = template.nodes.map((entry, index) => index === 5 ? { ...entry, locked: true } : entry), before = digest(locked)
  failure(D.layoutMindMap(locked, template.treeId), 'locked-object'); assert.equal(digest(locked), before)
  const collapsed = locked.map((entry, index) => index === 1 ? { ...entry, mindMap: { ...entry.mindMap, collapsed: true } } : entry)
  value(D.layoutMindMap(collapsed, template.treeId))
})
test('Branch reparent preserves identity, descendants, one edge and snapshot Undo', () => {
  const snapshot = D.cloneDiagramSnapshot(template.nodes, template.connectors), id = template.nodes[5].id, oldChild = template.nodes[17].id, destination = template.nodes[2].id
  const moved = value(D.reparentMindMapBranch(template.nodes, template.connectors, id, destination, 1))
  assert.equal(moved.nodes.find((entry) => entry.id === id).mindMap.parentId, destination)
  assert.equal(moved.nodes.find((entry) => entry.id === oldChild).mindMap.parentId, id)
  const movedEdge = moved.connectors.find((entry) => entry.mindMap.childId === id), originalEdge = template.connectors.find((entry) => entry.mindMap.childId === id)
  assert.equal(movedEdge.id, originalEdge.id); assert.equal(movedEdge.sourceId, destination)
  assert.deepEqual(moved.nodes.map((entry) => [entry.x, entry.y]), template.nodes.map((entry) => [entry.x, entry.y]))
  assert.deepEqual(D.cloneDiagramSnapshot(snapshot.nodes, snapshot.connectors), snapshot); assert.deepEqual(template.nodes, snapshot.nodes)
  value(D.validateMindMapConnectors(moved.nodes, moved.connectors, template.treeId))
})
test('Same-parent branch reorder compacts stable integer sibling order', () => {
  const moved = value(D.reparentMindMapBranch(template.nodes, template.connectors, template.nodes[4].id, template.nodes[0].id, 0))
  assert.equal(moved.nodes[4].mindMap.order, 0); assert.deepEqual(moved.nodes.slice(1, 4).map((entry) => entry.mindMap.order), [1, 2, 3])
  assert.deepEqual(moved.connectors.map((entry) => entry.id), template.connectors.map((entry) => entry.id))
})
test('Plain JSON reopen preserves unknown fields, optional hidden and mind-map metadata', () => {
  const nodes = template.nodes.map((entry, index) => index === 4 ? { ...entry, hidden: true, vendorFuture: { intact: 1 } } : entry), connectors = template.connectors.map((entry) => ({ ...entry, future: 'retain' })), reopened = JSON.parse(JSON.stringify({ nodes, connectors }))
  assert.deepEqual(reopened, { nodes, connectors }); value(D.validateMindMapConnectors(reopened.nodes, reopened.connectors, template.treeId))
  assert.deepEqual(reopened.nodes[4].vendorFuture, { intact: 1 })
})
for (const [name, make, code] of [
  ['tree cycles', (nodes) => nodes.map((entry, index) => index === 1 ? { ...entry, mindMap: { ...entry.mindMap, parentId: nodes[5].id } } : entry), 'mind-map-cycle'],
  ['missing tree parent', (nodes) => nodes.map((entry, index) => index === 1 ? { ...entry, mindMap: { ...entry.mindMap, parentId: 'gone' } } : entry), 'missing-mind-map-parent'],
  ['two roots', (nodes) => nodes.map((entry, index) => index === 1 ? { ...entry, mindMap: { ...entry.mindMap, parentId: undefined } } : entry), 'mind-map-root-count'],
  ['fractional order', (nodes) => nodes.map((entry, index) => index === 1 ? { ...entry, mindMap: { ...entry.mindMap, order: .5 } } : entry), 'invalid-mind-map'],
  ['duplicate branch order', (nodes) => nodes.map((entry, index) => index === 2 ? { ...entry, mindMap: { ...entry.mindMap, order: 0 } } : entry), 'duplicate-branch-order'],
  ['version mismatch', (nodes) => nodes.map((entry, index) => index === 1 ? { ...entry, mindMap: { ...entry.mindMap, version: 2 } } : entry), 'invalid-mind-map'],
  ['container branch masquerading as a mind-map node', (nodes) => nodes.map((entry, index) => index === 1 ? { ...entry, kind: 'group' } : entry), 'invalid-mind-map-kind'],
]) test(`Mind-map validation rejects ${name}`, () => failure(D.validateMindMap(make(template.nodes), template.treeId), code))
test('Reparent rejects root changes, cycles, cross-tree changes and lock bypasses', () => {
  failure(D.reparentMindMapBranch(template.nodes, template.connectors, template.nodes[0].id, template.nodes[1].id), 'root-reparent')
  failure(D.reparentMindMapBranch(template.nodes, template.connectors, template.nodes[1].id, template.nodes[17].id), 'mind-map-cycle')
  failure(D.reparentMindMapBranch(template.nodes, template.connectors, template.nodes[1].id, 'gone'), 'cross-tree-reparent')
  const locked = template.nodes.map((entry, index) => index === 17 ? { ...entry, locked: true } : entry)
  failure(D.reparentMindMapBranch(locked, template.connectors, locked[1].id, locked[2].id), 'locked-object')
  failure(D.reparentMindMapBranch(template.nodes, template.connectors, template.nodes[1].id, template.nodes[2].id, NaN), 'invalid-branch-order')
})
test('Missing, duplicate and wrong-parent persistent mind-map edges are rejected', () => {
  failure(D.validateMindMapConnectors(template.nodes, template.connectors.slice(1), template.treeId), 'missing-mind-map-edge')
  failure(D.validateMindMapConnectors(template.nodes, [...template.connectors, { ...template.connectors[0], id: 'duplicate-child' }], template.treeId), 'invalid-mind-map-edge')
  failure(D.validateMindMapConnectors(template.nodes, template.connectors.map((entry, index) => index === 0 ? { ...entry, sourceId: 'wrong' } : entry), template.treeId), 'invalid-mind-map-edge')
})
test('Invalid layout spacing and zero-sized geometry are rejected', () => {
  failure(D.layoutMindMap(template.nodes, template.treeId, { horizontalGap: -1 }), 'invalid-layout')
  failure(D.layoutMindMap(template.nodes.map((entry, index) => index === 1 ? { ...entry, width: 0 } : entry), template.treeId), 'invalid-geometry')
  failure(D.layoutMindMap(template.nodes, 'missing-tree'), 'missing-tree')
})

for (const kind of ['process', 'decision', 'terminator', 'document']) test(`${kind} is an editable existing-schema path, not a new shape enum`, () => {
  const shape = value(D.createDiagramShape(kind, `${kind}-id`, { x: 12, y: -40, width: 200, height: 100 }))
  assert.equal(shape.shapeType, 'path'); assert.equal(shape.kind, 'shape'); assert.equal(shape.vectorPath.version, 1); assert.equal(shape.vectorPath.closed, true); assert.equal(shape.opacity, 1)
  assert(shape.vectorPath.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 200 && point.y >= 0 && point.y <= 100))
  assert.deepEqual(JSON.parse(JSON.stringify(shape)), shape)
  if (kind === 'terminator' || kind === 'document') assert(shape.vectorPath.points.some((point) => point.handleIn || point.handleOut))
})
test('Invalid shape input does not create partial geometry', () => {
  failure(D.createDiagramShape('triangle', 'shape', { x: 0, y: 0, width: 100, height: 100 }), 'unsupported-shape')
  failure(D.createDiagramShape('process', '', { x: 0, y: 0, width: 100, height: 100 }), 'invalid-shape-frame')
  failure(D.createDiagramShape('process', 'shape', { x: 0, y: 0, width: -1, height: 100 }), 'invalid-shape-frame')
})
test('Repeated reparent/reopen/layout keeps every ID and branch edge stable', () => {
  let current = D.cloneDiagramSnapshot(template.nodes, template.connectors)
  for (let index = 0; index < 30; index++) {
    current = value(D.reparentMindMapBranch(current.nodes, current.connectors, template.nodes[5].id, template.nodes[1 + index % 4].id, index % 3))
    current.nodes = value(D.layoutMindMap(current.nodes, template.treeId))
    current = JSON.parse(JSON.stringify(current))
    value(D.validateMindMapConnectors(current.nodes, current.connectors, template.treeId))
    assert.deepEqual(current.nodes.map((entry) => entry.id), template.nodes.map((entry) => entry.id)); assert.deepEqual(current.connectors.map((entry) => entry.id), template.connectors.map((entry) => entry.id))
  }
})

const directory = resolve('output', 'partii-diagram-structure-resume')
await mkdir(directory, { recursive: true })
await writeFile(resolve(directory, 'report.json'), JSON.stringify({ status: 'passed', generatedAt: new Date().toISOString(), checks: checks.length, passed: checks, sourceSha256: createHash('sha256').update(code).digest('hex'), limitations: ['Pure in-memory model regression, not rendered UI', 'Plain JSON retention is not proof of Tauri/native projected metadata preservation', 'No production workspace migration, saved user template library, Layer panel, swimlane or import/export format claim'] }, null, 2))
console.log(`PASS ${checks.length}/${checks.length} structure and mind-map regression groups`)
