import assert from 'node:assert/strict'
import { reverseVectorPath, joinVectorPaths, reshapeVectorSegment, vectorSegmentPoint, nearestVectorSegment, vectorNodeMatrix, vectorLocalToBoard, vectorBoardToLocal, vectorBoardDeltaToLocal, vectorNodeBounds, resizeVectorNodeFrame, transformVectorPath, vectorPathData } from '../src/model/vector.ts'
import { createPencilPath, eraseVectorPath, eraseVectorNode, vectorEraserCutters, editableShapePath } from '../src/model/vectorDrawing.ts'

let checks = 0
const near = (actual, expected, epsilon = 1e-5, message = '') => { assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`); checks++ }
const pointNear = (a, b, epsilon, message) => { near(a.x, b.x, epsilon, message); near(a.y, b.y, epsilon, message) }
const original = { version: 1, closed: false, points: [{ x: 0, y: 0, handleOut: { x: 30, y: 90 } }, { x: 100, y: 20, handleIn: { x: -25, y: 60 } }, { x: 180, y: 40 }] }
const snapshot = JSON.stringify(original)
const reversed = reverseVectorPath(original)
for (let segment = 0; segment < 2; segment++) for (let sample = 0; sample <= 20; sample++) pointNear(vectorSegmentPoint(reversed, 1 - segment, 1 - sample / 20), vectorSegmentPoint(original, segment, sample / 20), 1e-8, 'reversal must preserve curve image')
assert.deepEqual(reverseVectorPath(reversed), original)
assert.equal(JSON.stringify(original), snapshot, 'geometry operations cannot mutate the baseline for Undo')

const reshaped = reshapeVectorSegment(original, 0, .37, { x: 14, y: -28 })
pointNear(reshaped.points[0], original.points[0], 0, 'reshape first endpoint fixed')
pointNear(reshaped.points[1], original.points[1], 0, 'reshape second endpoint fixed')
pointNear(vectorSegmentPoint(reshaped, 0, .37), { x: vectorSegmentPoint(original, 0, .37).x + 14, y: vectorSegmentPoint(original, 0, .37).y - 28 }, 1e-8, 'grabbed cubic point follows the pointer')
for (let sample = 0; sample <= 20; sample++) pointNear(vectorSegmentPoint(reshaped, 1, sample / 20), vectorSegmentPoint(original, 1, sample / 20), 1e-8, 'other segment stays unchanged')
const straight = { version: 1, closed: false, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
assert(reshapeVectorSegment(straight, 0, .5, { x: 0, y: 30 }).points[0].handleOut)
assert.equal(reshapeVectorSegment(original, 3, .5, { x: 2, y: 3 }), original)
const exactHit = vectorSegmentPoint(original, 0, .7), hit = nearestVectorSegment(original, exactHit)
assert.equal(hit.index, 0); near(hit.t, .7, 1e-5); near(hit.distance, 0, .001)
const joined = joinVectorPaths({ ...original, points: original.points.slice(0, 2) }, { version: 1, closed: false, points: [{ x: 170, y: 5, handleOut: { x: -10, y: 10 } }, { ...original.points[1], handleOut: { x: 0, y: 0 } }] }, .001)
assert(joined && joined.points.length === 3, 'nearest endpoint join works after curve reversal')

const node = { id: 'curve', kind: 'shape', shapeType: 'path', x: 40, y: 60, width: 200, height: 100, title: 'Curve', strokeWidth: 0, rotation: 30, vectorPath: original, vectorTransform: { scaleX: -1.4, scaleY: .6, skewX: 25, skewY: -12, translateX: 11, translateY: -9 } }
for (const rotation of [0, 30, 90]) {
  const variant = { ...node, rotation }
  for (const point of [{ x: 0, y: 0 }, { x: 32, y: -14 }, { x: 100, y: 50 }, { x: 240, y: 120 }]) pointNear(vectorBoardToLocal(variant, vectorLocalToBoard(variant, point)), point, 1e-8, 'affine pointer round trip')
  const bounds = vectorNodeBounds(variant)
  for (let segment = 0; segment < 2; segment++) for (let sample = 0; sample <= 100; sample++) {
    const point = vectorLocalToBoard(variant, vectorSegmentPoint(original, segment, sample / 100))
    assert(point.x >= bounds.left - 1e-7 && point.x <= bounds.right + 1e-7 && point.y >= bounds.top - 1e-7 && point.y <= bounds.bottom + 1e-7, 'exact transformed bounds include the complete curve'); checks++
  }
}
// Evaluate the SVG transforms individually; this catches the missing kx*ky term.
const source = { x: 25, y: 70 }, cx = 100, cy = 50, theta = Math.PI / 6
let px = (source.x - cx) * -1.4, py = (source.y - cy) * .6
py += Math.tan(-12 * Math.PI / 180) * px
px += Math.tan(25 * Math.PI / 180) * py
px += 11; py -= 9
pointNear(vectorLocalToBoard(node, source), { x: 40 + cx + px * Math.cos(theta) - py * Math.sin(theta), y: 60 + cy + px * Math.sin(theta) + py * Math.cos(theta) }, 1e-8, 'SVG transform order')
assert.equal(vectorBoardToLocal({ ...node, vectorTransform: { scaleX: 0 } }, source), undefined)
assert.equal(vectorBoardDeltaToLocal({ ...node, vectorTransform: { scaleY: 0 } }, source), undefined)
const delta = { x: -17, y: 26 }, localDelta = vectorBoardDeltaToLocal(node, delta)
const matrix = vectorNodeMatrix(node)
pointNear({ x: matrix.a * localDelta.x + matrix.c * localDelta.y, y: matrix.b * localDelta.x + matrix.d * localDelta.y }, delta, 1e-8, 'inverse delta handles flips and skew')
const resized = resizeVectorNodeFrame(node, { x: 13, y: 21, width: 400, height: 50 })
const snappedResize = resizeVectorNodeFrame(node, { x: 13, y: 21, width: 400, height: 50, guides: [] })
assert.deepEqual(snappedResize, resized, 'UI snap metadata does not disable resize or leak into saved shape fields')
assert.equal(resized.rotation, 30); assert.equal(resized.vectorTransform, undefined)
const baked = transformVectorPath(original, vectorNodeMatrix({ ...node, x: 0, y: 0, rotation: 0 }))
for (let index = 0; index < original.points.length; index++) pointNear(resized.vectorPath.points[index], { x: baked.points[index].x * 2, y: baked.points[index].y * .5 }, 1e-8, 'resize bakes and scales the actual inner geometry')

const samples = Array.from({ length: 401 }, (_, index) => ({ x: index / 2, y: 20 * Math.sin(index / 80) + .1 * Math.sin(index) }))
const pencil = createPencilPath(samples, { tolerance: .8, minDistance: .2, smoothing: .65 })
assert(pencil.points.length < 35 && pencil.points.length >= 4, 'Pencil reduces noisy samples to a useful editable curve')
assert(pencil.points.slice(1, -1).every((point) => point.handleIn && point.handleOut && point.handleMode === 'smooth'))
pointNear(pencil.points[0], samples[0], 0); pointNear(pencil.points.at(-1), samples.at(-1), 0)
assert.equal(createPencilPath(samples, { smoothing: 0 }).points.some((point) => point.handleIn), false)
const boundedPencil = createPencilPath(samples, { maxPoints: 5, tolerance: 0 })
assert.equal(boundedPencil.points.length, 5)
assert.deepEqual(createPencilPath([{ x: NaN, y: 3 }]).points, [])
const circleSamples = Array.from({ length: 41 }, (_, index) => ({ x: 30 * Math.cos(index * Math.PI / 20), y: 30 * Math.sin(index * Math.PI / 20) }))
assert.equal(createPencilPath(circleSamples, { closed: true }).closed, true)

const erasedLine = eraseVectorPath(straight, [{ x: 50, y: 0 }], 10, .01)
assert.equal(erasedLine.changed, true); assert.equal(erasedLine.paths.length, 2)
near(erasedLine.paths[0].points.at(-1).x, 40, .02); near(erasedLine.paths[1].points[0].x, 60, .02)
const distant = eraseVectorPath(original, [{ x: 2000, y: 2000 }], 10)
assert.equal(distant.changed, false); assert.equal(distant.paths[0], original)
assert.deepEqual(eraseVectorPath(straight, [{ x: 50, y: 0 }], 100).paths, [])
const crossing = eraseVectorPath(straight, [{ x: 50, y: -100 }, { x: 50, y: 100 }], .5, .005)
assert.equal(crossing.paths.length, 2, 'Eraser sweep crosses between pointer samples')
near(crossing.paths[0].points.at(-1).x, 49.5, .01)
const curveBrush = vectorSegmentPoint(original, 0, .45)
const erasedCurve = eraseVectorPath(original, [curveBrush], 9, .02)
assert.equal(erasedCurve.paths.length, 2)
for (const fragment of erasedCurve.paths) for (let index = 0; index < fragment.points.length - 1; index++) for (let sample = 0; sample <= 10; sample++) {
  const point = vectorSegmentPoint(fragment, index, sample / 10)
  near(nearestVectorSegment(original, point).distance, 0, .003, 'Eraser preserves original cubic, not a line approximation')
}
assert.equal(JSON.stringify(original), snapshot)

const rect = { id: 'filled', kind: 'shape', shapeType: 'rectangle', x: 100, y: 200, width: 100, height: 80, cornerRadius: 12, title: 'Wall', color: '#9b1212', strokeColor: '#eedccc', strokeWidth: 2, opacity: 1 }
assert.equal(editableShapePath(rect).points.length, 8)
const cssRectRefusal = eraseVectorNode(rect, [{ x: 150, y: 180 }, { x: 150, y: 300 }], 6)
assert.equal(cssRectRefusal.changed, false); assert.equal(cssRectRefusal.nodes[0], rect)
assert(cssRectRefusal.unsupported.includes('inset-border'), 'CSS skin must not become a centered SVG stroke or lose its shadow')
// The filled-path numerical oracle still checks portable subtraction and
// unchanged bounds. An explicit canonical path has no CSS rectangle skin.
const filledPath = { ...rect, shapeType: 'path', vectorPath: editableShapePath(rect) }
const erasedRect = eraseVectorNode(filledPath, [{ x: 150, y: 180 }, { x: 150, y: 300 }], 6)
assert.equal(erasedRect.changed, true); assert.equal(erasedRect.nodes.length, 1)
assert.equal(erasedRect.nodes[0].vectorBoolean.operation, 'subtract')
assert.equal(erasedRect.nodes[0].vectorBoolean.operands.length, 2)
assert.equal(erasedRect.nodes[0].color, rect.color)
const erasedBounds = vectorNodeBounds(erasedRect.nodes[0])
near(erasedBounds.top, 199); near(erasedBounds.bottom, 281, 1e-5, 'off-artwork Eraser cutters do not inflate selection bounds')
const reopened = JSON.parse(JSON.stringify(erasedRect.nodes))[0]
assert.equal(reopened.vectorBoolean.operation, 'subtract')
assert.equal(vectorPathData(reopened.vectorPath), vectorPathData(erasedRect.nodes[0].vectorPath), 'primary editable geometry survives portable JSON round trip')
assert.deepEqual(reopened.vectorBoolean.operands.map(vectorPathData), erasedRect.nodes[0].vectorBoolean.operands.map(vectorPathData), 'all editable cutters survive portable JSON round trip')
assert.equal(eraseVectorNode(rect, [{ x: 2000, y: 0 }], 6).changed, false)
assert.equal(eraseVectorNode({ ...rect, locked: true }, [{ x: 150, y: 250 }], 6).nodes[0].id, 'filled')
assert(eraseVectorNode({ ...rect, kind: 'image', shapeType: undefined }, [{ x: 150, y: 250 }], 6).unsupported)
assert(eraseVectorNode({ ...rect, vectorPath: editableShapePath(rect), vectorBoolean: { operation: 'union', operands: [editableShapePath(rect)] } }, [{ x: 150, y: 250 }], 6).unsupported)
const worldBrush = vectorLocalToBoard(node, vectorSegmentPoint(original, 0, .45))
const erasedTransformed = eraseVectorNode(node, [worldBrush], 9, { tolerance: .01, idFactory: () => 'second-fragment' })
assert.equal(erasedTransformed.changed, true); assert.equal(erasedTransformed.nodes.length, 2)
assert.equal(erasedTransformed.nodes[1].id, 'second-fragment')
for (const fragment of erasedTransformed.nodes) {
  assert.equal(fragment.rotation, 0); assert.equal(fragment.vectorTransform, undefined)
  const worldOriginal = transformVectorPath(original, vectorNodeMatrix(node))
  for (let index = 0; index < fragment.vectorPath.points.length - 1; index++) for (let sample = 0; sample <= 10; sample++) {
    const point = vectorLocalToBoard(fragment, vectorSegmentPoint(fragment.vectorPath, index, sample / 10))
    near(nearestVectorSegment(worldOriginal, point).distance, 0, .004, 'Eraser brush stays circular in board space under skew/flip/rotation')
  }
}
const capsule = vectorEraserCutters([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10)[0]
assert.equal(capsule.closed, true); assert.equal(capsule.points.length, 6)
const capsuleNode = { ...rect, x: 0, y: 0, strokeWidth: 0, vectorPath: capsule }
const capsuleBounds = vectorNodeBounds(capsuleNode)
near(capsuleBounds.left, -10); near(capsuleBounds.right, 110); near(capsuleBounds.top, -10); near(capsuleBounds.bottom, 10)
console.log(`Part II vector foundations and editable Pencil/Eraser: PASS (${checks} numeric and containment checks plus topology/round-trip assertions)`)
