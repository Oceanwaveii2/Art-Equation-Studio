import assert from 'node:assert/strict'
import { vectorDirectSelectionPolicy, vectorEditorControls, vectorEraserScope, vectorEditBlockReason } from '../src/model/vectorEditing.ts'
import { vectorLocalToBoard, joinVectorPaths, reverseVectorPath, vectorSegmentPoint, vectorPathData, resizeVectorNodeFrame } from '../src/model/vector.ts'
import { eraseVectorNode, editableShapePath } from '../src/model/vectorDrawing.ts'

let checks = 0
const near = (a, b, message, epsilon = 1e-8) => { assert(Math.abs(a - b) <= epsilon, `${message}: ${a} != ${b}`); checks++ }
const pointNear = (a, b, message) => { near(a.x, b.x, message); near(a.y, b.y, message) }
const path = { version: 1, closed: false, points: [{ x: 0, y: 40, handleOut: { x: 30, y: -35 } }, { x: 120, y: 40, handleIn: { x: -25, y: -40 } }] }
const shape = { id: 'curve', title: 'Curve', kind: 'shape', shapeType: 'path', x: 170, y: 90, width: 120, height: 80, vectorPath: path, opacity: 1 }
const snapshot = JSON.stringify(shape)
for (const rotation of [0, 30, 90]) for (const transform of [undefined, { scaleX: -1, scaleY: .65, skewX: 18, skewY: -11, translateX: 16, translateY: -9 }]) {
  const node = { ...shape, rotation, vectorTransform: transform }, controls = vectorEditorControls(node)
  const rad = rotation * Math.PI / 180, cx = node.width / 2, cy = node.height / 2
  const outer = (point) => ({ x: node.x + cx + (point.x - cx) * Math.cos(rad) - (point.y - cy) * Math.sin(rad), y: node.y + cy + (point.x - cx) * Math.sin(rad) + (point.y - cy) * Math.cos(rad) })
  for (const [index, point] of path.points.entries()) {
    pointNear(outer(controls[index].anchor), vectorLocalToBoard(node, point), 'overlay anchor agrees with SVG at rotation/flip/skew')
    for (const key of ['handleIn', 'handleOut']) if (point[key]) pointNear(outer(controls[index][key]), vectorLocalToBoard(node, { x: point.x + point[key].x, y: point.y + point[key].y }), 'overlay handle agrees with SVG')
  }
}
assert.equal(JSON.stringify(shape), snapshot, 'overlay projection cannot modify saved geometry')
assert.equal(vectorDirectSelectionPolicy([shape], []).state, 'none')
assert.equal(vectorDirectSelectionPolicy([shape], [shape.id]).nodeId, shape.id)
assert.equal(vectorDirectSelectionPolicy([shape], [shape.id, shape.id]).state, 'single', 'duplicate selection IDs do not manufacture multiple paths')
assert.equal(vectorDirectSelectionPolicy([shape, { ...shape, id: 'curve2' }], ['curve', 'curve2']).state, 'multiple')
assert(vectorDirectSelectionPolicy([shape, { ...shape, id: 'curve2' }], ['curve', 'curve2']).message.includes('not supported yet'))
assert.equal(vectorDirectSelectionPolicy([{ ...shape, vectorBoolean: { operation: 'union', operands: [path, path] } }], ['curve']).state, 'unsupported')
assert.equal(vectorDirectSelectionPolicy([{ ...shape, vectorTransform: { scaleX: 0 } }], ['curve']).state, 'unsupported')
assert.equal(vectorDirectSelectionPolicy([{ ...shape, locked: true }], ['curve']).state, 'locked')
assert.equal(vectorEditorControls({ ...shape, vectorPath: undefined }).length, 0)

const group = { id: 'group', kind: 'group', title: 'House', x: 0, y: 0, width: 300, height: 300, containerRole: 'group' }
const frame = { ...group, id: 'frame', groupId: 'group', containerRole: 'frame' }
const column = { id: 'column', kind: 'column', title: 'References', x: 0, y: 0, width: 300, height: 300 }
const inside = { ...shape, id: 'inside', groupId: 'frame' }
const sibling = { ...shape, id: 'sibling', groupId: 'group' }
const columnChild = { ...shape, id: 'column-child', parentColumnId: 'column' }
const outside = { ...shape, id: 'outside' }
const media = { ...shape, id: 'photo', kind: 'image', vectorPath: undefined }
const nodes = [group, frame, column, inside, sibling, columnChild, outside, media]
assert.deepEqual(new Set(vectorEraserScope(nodes, ['group']).nodeIds), new Set(['inside', 'sibling']), 'group scope includes nested frame vectors only')
assert.deepEqual(vectorEraserScope(nodes, ['inside']).nodeIds, ['inside'], 'selected member does not erase its siblings')
assert.deepEqual(vectorEraserScope(nodes, ['column']).nodeIds, ['column-child'])
assert.deepEqual(new Set(vectorEraserScope(nodes, []).nodeIds), new Set(['inside', 'sibling', 'column-child', 'outside']))
assert.deepEqual(vectorEraserScope(nodes, ['photo']).nodeIds, [], 'unsupported selection never falls back to board-wide erase')
assert.equal(vectorEraserScope(nodes, ['photo']).blocked.length, 1)
assert.deepEqual(vectorEraserScope(nodes, ['missing']).nodeIds, [])
assert.deepEqual(vectorEraserScope(nodes.map((node) => node.id === 'group' ? { ...node, locked: true } : node), ['inside']).nodeIds, [])
assert.deepEqual(vectorEraserScope(nodes.map((node) => node.id === 'frame' ? { ...node, locked: true } : node), ['group']).nodeIds, ['sibling'])
assert.deepEqual(vectorEraserScope(nodes.map((node) => node.id === 'column' ? { ...node, locked: true } : node), ['column-child']).nodeIds, [])
assert.equal(vectorDirectSelectionPolicy(nodes.map((node) => node.id === 'group' ? { ...node, locked: true } : node), ['inside']).state, 'locked')
assert.match(vectorEditBlockReason([{ ...shape, groupId: 'missing' }], 'curve'), /Missing/)
assert.match(vectorEditBlockReason([{ ...shape, groupId: 'outside' }, outside], 'curve'), /Invalid group/)
assert.match(vectorEditBlockReason([shape, { ...shape }], 'curve'), /duplicate/)
const cyclic = [{ ...group, groupId: 'frame' }, frame, inside]
assert.match(vectorEditBlockReason(cyclic, 'inside'), /Cyclic/)
assert.deepEqual(vectorEraserScope(cyclic, ['group']).nodeIds, [])
const diamond = [{ ...group, id: 'top' }, { ...group, groupId: 'top' }, { ...column, groupId: 'top' }, { ...inside, groupId: 'group', parentColumnId: 'column' }]
assert.equal(vectorEditBlockReason(diamond, 'inside'), undefined, 'shared ancestor through group and column is not a cycle')
assert.equal(JSON.stringify(shape), snapshot)

// All four endpoint orientations must retain exact cubic control images when
// joining coincident endpoints; reversing swaps, rather than negates, handles.
const second = { version: 1, closed: false, points: [{ x: 120, y: 40, handleOut: { x: 35, y: 55 } }, { x: 230, y: 30, handleIn: { x: -35, y: 45 } }] }
for (const [a, b] of [[path, second], [path, reverseVectorPath(second)], [reverseVectorPath(path), second], [reverseVectorPath(path), reverseVectorPath(second)]]) {
  const joined = joinVectorPaths(a, b, 0)
  assert(joined && joined.points.length === 3 && !joined.closed)
  const json = JSON.parse(JSON.stringify(joined))
  assert.equal(vectorPathData(json), vectorPathData(joined))
  for (let step = 0; step <= 20; step++) {
    pointNear(vectorSegmentPoint(joined, 0, step / 20), vectorSegmentPoint(path, 0, step / 20), 'joined incoming segment retains original cubic')
    pointNear(vectorSegmentPoint(joined, 1, step / 20), vectorSegmentPoint(second, 0, step / 20), 'joined outgoing segment retains original cubic')
  }
}
assert.equal(joinVectorPaths({ ...path, closed: true }, second), undefined)
const far = { ...second, points: second.points.map((point) => ({ ...point, x: point.x + 1000 })) }
assert.equal(joinVectorPaths(path, far, 0).points.length, 4, 'far endpoint join inserts bridge instead of merging distant vertices')

// Erased Boolean geometry and every operand must survive JSON and transformed
// resize; hidden cutters are geometry, not an opaque paint-over screenshot.
const rect = { ...shape, id: 'wall', shapeType: 'path', vectorPath: editableShapePath({ kind: 'shape', shapeType: 'rectangle', x: 0, y: 0, width: 160, height: 120, cornerRadius: 8 }), x: 0, y: 0, width: 160, height: 120, cornerRadius: 8, rotation: 30, vectorTransform: { scaleX: -1, skewX: 18 } }
const boardCut = vectorLocalToBoard(rect, { x: 70, y: 60 })
const result = eraseVectorNode(rect, [boardCut], 10)
assert(result.changed)
const erased = result.nodes[0], portable = JSON.parse(JSON.stringify(erased))
assert.deepEqual(portable.vectorBoolean.operands.map(vectorPathData), erased.vectorBoolean.operands.map(vectorPathData))
assert.equal(portable.opacity, 1)
const resized = resizeVectorNodeFrame(portable, { x: 20, y: 30, width: portable.width * 2, height: portable.height * .5 })
assert.equal(resized.vectorBoolean.operation, 'subtract')
assert.deepEqual(JSON.parse(JSON.stringify(resized)).vectorBoolean, resized.vectorBoolean)
assert.equal(resized.vectorBoolean.operands.length, portable.vectorBoolean.operands.length)
assert.equal(JSON.stringify(shape), snapshot)
console.log(`Part II vector editing policy, transformed overlays, inherited locks and join/Boolean round trips: PASS (${checks} numerical comparisons plus policy/topology assertions)`)
