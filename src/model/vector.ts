import type { BoardNode, BoardPoint, VectorPath, VectorPathPoint } from './project'
import { transformVectorPaint } from '../board/vectorPaint.ts'

export type VectorBounds = { left: number; top: number; right: number; bottom: number }
type Cubic = { p0: BoardPoint; p1: BoardPoint; p2: BoardPoint; p3: BoardPoint }

const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits
const add = (a: BoardPoint, b: BoardPoint): BoardPoint => ({ x: a.x + b.x, y: a.y + b.y })
const subtract = (a: BoardPoint, b: BoardPoint): BoardPoint => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (a: BoardPoint, factor: number): BoardPoint => ({ x: a.x * factor, y: a.y * factor })
const lerp = (a: BoardPoint, b: BoardPoint, t: number): BoardPoint => add(a, scale(subtract(b, a), t))
const distance = (a: BoardPoint, b: BoardPoint) => Math.hypot(a.x - b.x, a.y - b.y)

function segment(path: VectorPath, index: number): Cubic | undefined {
  const from = path.points[index]
  const nextIndex = index === path.points.length - 1 ? (path.closed ? 0 : -1) : index + 1
  if (!from || nextIndex < 0) return undefined
  const to = path.points[nextIndex]
  return {
    p0: { x: from.x, y: from.y },
    p1: from.handleOut ? add(from, from.handleOut) : { x: from.x, y: from.y },
    p2: to.handleIn ? add(to, to.handleIn) : { x: to.x, y: to.y },
    p3: { x: to.x, y: to.y },
  }
}

function pointFromCubic(point: BoardPoint, handleIn?: BoardPoint, handleOut?: BoardPoint, mode?: VectorPathPoint['handleMode']): VectorPathPoint {
  const valid = (handle?: BoardPoint) => handle && Math.hypot(handle.x, handle.y) > .001 ? { x: round(handle.x), y: round(handle.y) } : undefined
  const incoming = valid(handleIn), outgoing = valid(handleOut)
  return { x: round(point.x), y: round(point.y), ...(incoming ? { handleIn: incoming } : {}), ...(outgoing ? { handleOut: outgoing } : {}), ...(mode && (incoming || outgoing) ? { handleMode: mode } : {}) }
}

/** Insert a point at t on a segment using De Casteljau subdivision. */
export function insertVectorPathPoint(path: VectorPath, index: number, t = .5): VectorPath {
  const boundedT = Math.max(.001, Math.min(.999, t))
  const nextIndex = index === path.points.length - 1 ? (path.closed ? 0 : -1) : index + 1
  const curve = segment(path, index)
  if (!curve || nextIndex < 0) return path
  const q0 = lerp(curve.p0, curve.p1, boundedT), q1 = lerp(curve.p1, curve.p2, boundedT), q2 = lerp(curve.p2, curve.p3, boundedT)
  const r0 = lerp(q0, q1, boundedT), r1 = lerp(q1, q2, boundedT), s = lerp(r0, r1, boundedT)
  const from = path.points[index], to = path.points[nextIndex], curved = Boolean(from.handleOut || to.handleIn)
  const first = curved ? { ...from, handleOut: pointFromCubic(q0, undefined, subtract(q0, curve.p0)).handleOut, handleMode: from.handleMode } : { ...from }
  const inserted = pointFromCubic(s, curved ? subtract(r0, s) : undefined, curved ? subtract(r1, s) : undefined, curved ? 'corner' : undefined)
  const updatedTo = curved ? { ...to, handleIn: pointFromCubic(q2, subtract(q2, curve.p3)).handleIn } : { ...to }
  const points = path.points.slice()
  points[index] = first
  if (nextIndex === 0) { points[0] = updatedTo; points.push(inserted) } else { points[nextIndex] = updatedTo; points.splice(nextIndex, 0, inserted) }
  return { ...path, points }
}

/** Remove an anchor while retaining neighbouring tangent controls. */
export function removeVectorPathPoint(path: VectorPath, index: number): VectorPath {
  const minimum = path.closed ? 3 : 2
  if (index < 0 || index >= path.points.length || path.points.length <= minimum) return path
  const points = path.points.slice(), previousIndex = index === 0 ? (path.closed ? points.length - 1 : -1) : index - 1, nextIndex = index === points.length - 1 ? (path.closed ? 0 : -1) : index + 1
  const removed = points[index]
  // A point with a complete pair was itself a curve subdivision (or an
  // authored curve anchor); removing it must not manufacture new controls on
  // otherwise straight neighbours.
  if (removed.handleIn && removed.handleOut) {
    const cleaned = points.filter((_, pointIndex) => pointIndex !== index)
    if (removed.handleMode === 'corner' && previousIndex >= 0 && nextIndex >= 0 && !points[previousIndex].handleMode && !points[nextIndex].handleMode) {
      const previous = cleaned[previousIndex >= index ? previousIndex - 1 : previousIndex]
      const next = cleaned[nextIndex > index ? nextIndex - 1 : nextIndex]
      if (previous) { const { handleOut: _handleOut, ...withoutOut } = previous; cleaned[previousIndex >= index ? previousIndex - 1 : previousIndex] = withoutOut }
      if (next) { const { handleIn: _handleIn, ...withoutIn } = next; cleaned[nextIndex > index ? nextIndex - 1 : nextIndex] = withoutIn }
    }
    return { ...path, points: cleaned }
  }
  if (previousIndex >= 0 && nextIndex >= 0 && previousIndex !== nextIndex) {
    const previous = points[previousIndex], next = points[nextIndex]
    const previousHandle = previous.handleOut || (removed.handleIn ? scale(removed.handleIn, -1) : undefined)
    const nextHandle = next.handleIn || (removed.handleOut ? scale(removed.handleOut, -1) : undefined)
    points[previousIndex] = { ...previous, ...(previousHandle ? { handleOut: previousHandle } : {}) }
    points[nextIndex] = { ...next, ...(nextHandle ? { handleIn: nextHandle } : {}) }
  }
  points.splice(index, 1)
  return { ...path, points }
}

/** Smooth conversion aligns existing handles; corner conversion preserves them. */
export function setVectorPointMode(point: VectorPathPoint, mode: NonNullable<VectorPathPoint['handleMode']>): VectorPathPoint {
  if (mode === 'corner') return { ...point, handleMode: 'corner' }
  if (!point.handleIn && !point.handleOut) return { ...point, handleMode: 'smooth' }
  const direction = point.handleOut || (point.handleIn ? scale(point.handleIn, -1) : { x: 1, y: 0 })
  const magnitude = Math.hypot(direction.x, direction.y) || 1, axis = scale(direction, 1 / magnitude)
  const lengthIn = Math.hypot(point.handleIn?.x || 0, point.handleIn?.y || 0) || Math.hypot(point.handleOut?.x || 0, point.handleOut?.y || 0)
  const lengthOut = Math.hypot(point.handleOut?.x || 0, point.handleOut?.y || 0) || lengthIn
  return { ...point, handleIn: scale(axis, -lengthIn), handleOut: scale(axis, lengthOut), handleMode: 'smooth' }
}

export function reverseVectorPath(path: VectorPath): VectorPath {
  // Controls are anchor-relative positions, not tangent direction vectors.
  // Reversing traversal swaps them without mirroring their positions.
  return { ...path, points: path.points.slice().reverse().map((point) => {
    const { handleIn, handleOut, ...anchor } = point
    return { ...anchor, ...(handleOut ? { handleIn: { ...handleOut } } : {}), ...(handleIn ? { handleOut: { ...handleIn } } : {}) }
  }) }
}

/** Scale editable local geometry as one operation, including Bézier controls. */
export function scaleVectorPath(path: VectorPath, scaleX: number, scaleY: number): VectorPath {
  const scaleHandle = (handle: BoardPoint | undefined) => handle && { x: handle.x * scaleX, y: handle.y * scaleY }
  return {
    ...path,
    points: path.points.map((point) => ({
      ...point,
      x: point.x * scaleX,
      y: point.y * scaleY,
      ...(point.handleIn ? { handleIn: scaleHandle(point.handleIn)! } : {}),
      ...(point.handleOut ? { handleOut: scaleHandle(point.handleOut)! } : {}),
    })),
  }
}

/** Join two open paths by the nearest pair of endpoints. */
export function joinVectorPaths(first: VectorPath, second: VectorPath, tolerance = 12): VectorPath | undefined {
  if (first.closed || second.closed || first.points.length < 2 || second.points.length < 2) return undefined
  const variants = [
    { a: first, b: second, distance: distance(first.points.at(-1)!, second.points[0]!) },
    { a: first, b: reverseVectorPath(second), distance: distance(first.points.at(-1)!, second.points.at(-1)!) },
    { a: reverseVectorPath(first), b: second, distance: distance(first.points[0]!, second.points[0]!) },
    { a: reverseVectorPath(first), b: reverseVectorPath(second), distance: distance(first.points[0]!, second.points.at(-1)!) },
  ].sort((a, b) => a.distance - b.distance)
  const choice = variants[0]
  if (!choice) return undefined
  const points = [...choice.a.points, ...choice.b.points]
  if (choice.distance <= tolerance) {
    const leftIndex = choice.a.points.length - 1, left = points[leftIndex], right = points[leftIndex + 1]
    points.splice(leftIndex, 2, { ...left, x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, handleOut: right.handleOut || left.handleOut, handleMode: left.handleMode || right.handleMode })
  }
  return { version: 1, closed: false, points }
}

export function vectorPathData(path: VectorPath) {
  if (!path.points.length) return ''
  const point = (entry: BoardPoint) => `${round(entry.x)} ${round(entry.y)}`
  let data = `M ${point(path.points[0])}`
  for (let index = 1; index < path.points.length; index += 1) {
    const from = path.points[index - 1], to = path.points[index], out = from.handleOut, incoming = to.handleIn
    data += out || incoming ? ` C ${point({ x: from.x + (out?.x || 0), y: from.y + (out?.y || 0) })} ${point({ x: to.x + (incoming?.x || 0), y: to.y + (incoming?.y || 0) })} ${point(to)}` : ` L ${point(to)}`
  }
  if (path.closed && path.points.length > 2) {
    const from = path.points.at(-1)!, to = path.points[0], out = from.handleOut, incoming = to.handleIn
    if (out || incoming) data += ` C ${point({ x: from.x + (out?.x || 0), y: from.y + (out?.y || 0) })} ${point({ x: to.x + (incoming?.x || 0), y: to.y + (incoming?.y || 0) })} ${point(to)}`
    data += ' Z'
  }
  return data
}

export function vectorTransformData(node: BoardNode) {
  const transform = node.vectorTransform
  if (!transform) return undefined
  const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback
  const tx = finite(transform.translateX, 0), ty = finite(transform.translateY, 0), sx = finite(transform.scaleX, 1), sy = finite(transform.scaleY, 1), skewX = finite(transform.skewX, 0), skewY = finite(transform.skewY, 0), cx = node.width / 2, cy = node.height / 2
  return `translate(${round(tx)} ${round(ty)}) translate(${round(cx)} ${round(cy)}) skewX(${round(skewX)}) skewY(${round(skewY)}) scale(${round(sx)} ${round(sy)}) translate(${round(-cx)} ${round(-cy)})`
}

function cubicExtrema(a: number, b: number, c: number, d: number) {
  const A = -a + 3 * b - 3 * c + d, B = 2 * (a - 2 * b + c), C = b - a, values = [0, 1]
  if (Math.abs(A) < 1e-9) { if (Math.abs(B) > 1e-9) { const t = -C / B; if (t > 0 && t < 1) values.push(t) } } else {
    const discriminant = B * B - 4 * A * C
    if (discriminant >= 0) for (const t of [(-B + Math.sqrt(discriminant)) / (2 * A), (-B - Math.sqrt(discriminant)) / (2 * A)]) if (t > 0 && t < 1) values.push(t)
  }
  return values
}
function cubicValue(a: number, b: number, c: number, d: number, t: number) { const u = 1 - t; return u ** 3 * a + 3 * u ** 2 * t * b + 3 * u * t ** 2 * c + t ** 3 * d }
function cubicBounds(curve: Cubic): VectorBounds {
  const xs = cubicExtrema(curve.p0.x, curve.p1.x, curve.p2.x, curve.p3.x).map((t) => cubicValue(curve.p0.x, curve.p1.x, curve.p2.x, curve.p3.x, t)), ys = cubicExtrema(curve.p0.y, curve.p1.y, curve.p2.y, curve.p3.y).map((t) => cubicValue(curve.p0.y, curve.p1.y, curve.p2.y, curve.p3.y, t))
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}

/** Exact local geometry bounds for an editable path, including Bézier extrema. */
export function vectorPathBounds(path: VectorPath): VectorBounds {
  let bounds: VectorBounds | undefined
  for (let index = 0; index < path.points.length; index += 1) {
    const curve = segment(path, index)
    if (!curve) continue
    const current = cubicBounds(curve)
    bounds = bounds
      ? { left: Math.min(bounds.left, current.left), top: Math.min(bounds.top, current.top), right: Math.max(bounds.right, current.right), bottom: Math.max(bounds.bottom, current.bottom) }
      : current
  }
  if (bounds) return bounds
  const first = path.points[0]
  return first ? { left: first.x, top: first.y, right: first.x, bottom: first.y } : { left: 0, top: 0, right: 0, bottom: 0 }
}

export function vectorNodeBounds(node: BoardNode): VectorBounds {
  const operands = node.vectorBoolean?.operands
  // Subtraction cutters may extend beyond the original artwork. Their hidden
  // geometry must not enlarge the visible selection frame or minimap.
  const paths = operands?.length ? node.vectorBoolean?.operation === 'subtract' ? operands.slice(0, 1) : operands : node.vectorPath ? [node.vectorPath] : []
  if (!paths.length) return { left: node.x, top: node.y, right: node.x + node.width, bottom: node.y + node.height }
  const mapPoint = (point: BoardPoint) => vectorLocalToBoard(node, point)
  let bounds: VectorBounds | undefined
  for (const path of paths) for (let index = 0; index < path.points.length; index += 1) {
    const curve = segment(path, index)
    if (!curve) continue
    const current = cubicBounds({ p0: mapPoint(curve.p0), p1: mapPoint(curve.p1), p2: mapPoint(curve.p2), p3: mapPoint(curve.p3) })
    bounds = bounds ? { left: Math.min(bounds.left, current.left), top: Math.min(bounds.top, current.top), right: Math.max(bounds.right, current.right), bottom: Math.max(bounds.bottom, current.bottom) } : current
  }
  const padding = Math.max(0, node.strokeWidth ?? 2) / 2
  return bounds ? { left: bounds.left - padding, top: bounds.top - padding, right: bounds.right + padding, bottom: bounds.bottom + padding } : { left: node.x, top: node.y, right: node.x + node.width, bottom: node.y + node.height }
}

export type VectorAffine = { a: number; b: number; c: number; d: number; e: number; f: number }
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback

/** Exact SVG order: T(board centre) R T(local offset) skewX skewY S T(-centre). */
export function vectorNodeMatrix(node: BoardNode): VectorAffine {
  const transform = node.vectorTransform || {}, cx = node.width / 2, cy = node.height / 2
  const sx = finite(transform.scaleX, 1), sy = finite(transform.scaleY, 1)
  const kx = Math.tan(finite(transform.skewX, 0) * Math.PI / 180), ky = Math.tan(finite(transform.skewY, 0) * Math.PI / 180)
  const theta = finite(node.rotation, 0) * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta)
  const aa = sx * (1 + kx * ky), bb = sx * ky, cc = sy * kx, dd = sy
  const a = cos * aa - sin * bb, b = sin * aa + cos * bb, c = cos * cc - sin * dd, d = sin * cc + cos * dd
  const tx = finite(transform.translateX, 0), ty = finite(transform.translateY, 0)
  return { a, b, c, d, e: node.x + cx + cos * tx - sin * ty - a * cx - c * cy, f: node.y + cy + sin * tx + cos * ty - b * cx - d * cy }
}

export function vectorLocalToBoard(node: BoardNode, point: BoardPoint): BoardPoint {
  const m = vectorNodeMatrix(node)
  return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f }
}

/** Undefined for collapsed/singular transforms: never manufacture a pointer delta. */
export function vectorBoardDeltaToLocal(node: BoardNode, delta: BoardPoint): BoardPoint | undefined {
  const m = vectorNodeMatrix(node), determinant = m.a * m.d - m.b * m.c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return undefined
  return { x: (m.d * delta.x - m.c * delta.y) / determinant, y: (-m.b * delta.x + m.a * delta.y) / determinant }
}

export function vectorBoardToLocal(node: BoardNode, point: BoardPoint): BoardPoint | undefined {
  const m = vectorNodeMatrix(node)
  return vectorBoardDeltaToLocal(node, { x: point.x - m.e, y: point.y - m.f })
}

export function transformVectorPath(path: VectorPath, matrix: VectorAffine): VectorPath {
  const handle = (value: BoardPoint | undefined) => value && { x: matrix.a * value.x + matrix.c * value.y, y: matrix.b * value.x + matrix.d * value.y }
  return { ...path, points: path.points.map((point) => ({ ...point, x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f, ...(point.handleIn ? { handleIn: handle(point.handleIn) } : {}), ...(point.handleOut ? { handleOut: handle(point.handleOut) } : {}) })) }
}

/** Bake only the inner transform, then resize its editable geometry with the frame.
 * Rotation stays editable. This prevents stale skew/translation centres after resize. */
export function resizeVectorNodeFrame(node: BoardNode, frame: { x: number; y: number; width: number; height: number }): BoardNode {
  if (!node.vectorPath || node.width <= 0 || node.height <= 0 || frame.width <= 0 || frame.height <= 0 || ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) return node
  const matrix = vectorNodeMatrix({ ...node, x: 0, y: 0, rotation: 0 })
  const resize = (path: VectorPath) => scaleVectorPath(transformVectorPath(path, matrix), frame.width / node.width, frame.height / node.height)
  return { ...node, ...transformVectorPaint(node, [matrix.a*frame.width/node.width,matrix.b*frame.height/node.height,matrix.c*frame.width/node.width,matrix.d*frame.height/node.height,matrix.e*frame.width/node.width,matrix.f*frame.height/node.height]), x: frame.x, y: frame.y, width: frame.width, height: frame.height, vectorTransform: undefined, vectorPath: resize(node.vectorPath), ...(node.vectorBoolean ? { vectorBoolean: { ...node.vectorBoolean, operands: node.vectorBoolean.operands.map(resize), ...(node.vectorBoolean.resolvedPaths ? { resolvedPaths: node.vectorBoolean.resolvedPaths.map(resize) } : {}) } } : {}) }
}

export function vectorSegmentPoint(path: VectorPath, index: number, t: number): BoardPoint | undefined {
  const curve = segment(path, index)
  if (!curve) return undefined
  const bounded = Math.max(0, Math.min(1, t))
  return { x: cubicValue(curve.p0.x, curve.p1.x, curve.p2.x, curve.p3.x, bounded), y: cubicValue(curve.p0.y, curve.p1.y, curve.p2.y, curve.p3.y, bounded) }
}

/** Move the grabbed cubic point exactly while endpoints and other segments remain fixed. */
export function reshapeVectorSegment(path: VectorPath, index: number, t: number, delta: BoardPoint): VectorPath {
  const curve = segment(path, index)
  if (!curve || ![t, delta.x, delta.y].every(Number.isFinite)) return path
  const bounded = Math.max(.02, Math.min(.98, t)), u = 1 - bounded
  const weightOut = 3 * u * u * bounded, weightIn = 3 * u * bounded * bounded, denominator = weightOut ** 2 + weightIn ** 2
  const nextIndex = (index + 1) % path.points.length, points = path.points.slice()
  points[index] = { ...points[index], handleOut: add(subtract(curve.p1, curve.p0), scale(delta, weightOut / denominator)), handleMode: 'corner' }
  points[nextIndex] = { ...points[nextIndex], handleIn: add(subtract(curve.p2, curve.p3), scale(delta, weightIn / denominator)), handleMode: 'corner' }
  return { ...path, points }
}

/** Coarse bracketing plus local refinement avoids choosing a distant curve lobe. */
export function nearestVectorSegment(path: VectorPath, point: BoardPoint): { index: number; t: number; point: BoardPoint; distance: number } | undefined {
  let best: { index: number; t: number; point: BoardPoint; distance: number } | undefined
  const count = path.closed ? path.points.length : path.points.length - 1
  for (let index = 0; index < count; index++) {
    let sampleT = 0, sampleDistance = Infinity
    for (let sample = 0; sample <= 32; sample++) {
      const t = sample / 32, p = vectorSegmentPoint(path, index, t)!, d = distance(p, point)
      if (d < sampleDistance) { sampleDistance = d; sampleT = t }
    }
    let low = Math.max(0, sampleT - 1 / 32), high = Math.min(1, sampleT + 1 / 32)
    for (let iteration = 0; iteration < 24; iteration++) {
      const left = low + (high - low) / 3, right = high - (high - low) / 3
      if (distance(vectorSegmentPoint(path, index, left)!, point) < distance(vectorSegmentPoint(path, index, right)!, point)) high = right
      else low = left
    }
    const t = (low + high) / 2, p = vectorSegmentPoint(path, index, t)!, d = distance(p, point)
    if (!best || d < best.distance) best = { index, t, point: p, distance: d }
  }
  return best
}

/** Retract in/out/both Bézier handles at anchor index without leaving stale {0, 0} objects. */
export function retractVectorHandle(path: VectorPath, index: number, which: 'in' | 'out' | 'both'): VectorPath {
  if (index < 0 || index >= path.points.length) return path
  const points = path.points.slice()
  const current = points[index]
  const updated: VectorPathPoint = { ...current }
  if (which === 'in' || which === 'both') delete updated.handleIn
  if (which === 'out' || which === 'both') delete updated.handleOut
  updated.handleMode = 'corner'
  points[index] = updated
  return { ...path, points }
}

/** Extend a handle from an anchor with optional collinear symmetric counterpart. */
export function extendVectorHandle(path: VectorPath, index: number, which: 'in' | 'out', delta: BoardPoint, symmetric = false): VectorPath {
  if (index < 0 || index >= path.points.length || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return path
  const points = path.points.slice()
  const current = points[index]
  const updated: VectorPathPoint = { ...current }
  const len = Math.hypot(delta.x, delta.y)
  if (len < 1e-4) {
    if (which === 'in') delete updated.handleIn
    else delete updated.handleOut
    if (!updated.handleIn && !updated.handleOut) updated.handleMode = 'corner'
    points[index] = updated
    return { ...path, points }
  }
  if (which === 'in') {
    updated.handleIn = { x: round(delta.x), y: round(delta.y) }
    if (symmetric) {
      updated.handleOut = { x: round(-delta.x), y: round(-delta.y) }
      updated.handleMode = 'smooth'
    } else {
      updated.handleMode = 'corner'
    }
  } else {
    updated.handleOut = { x: round(delta.x), y: round(delta.y) }
    if (symmetric) {
      updated.handleIn = { x: round(-delta.x), y: round(-delta.y) }
      updated.handleMode = 'smooth'
    } else {
      updated.handleMode = 'corner'
    }
  }
  points[index] = updated
  return { ...path, points }
}

export type VectorSnapResult = {
  point: BoardPoint
  snapped: boolean
  snapType?: 'anchor' | 'axis-x' | 'axis-y'
  reference?: BoardPoint
}

/** Snap a pointer coordinate to nearby path anchors or orthogonal axes. */
export function snapPointToVectorGuides(
  point: BoardPoint,
  anchors: readonly BoardPoint[],
  options: { tolerance?: number; snapAxes?: boolean; axisReference?: BoardPoint } = {},
): VectorSnapResult {
  const tolerance = Math.max(1, options.tolerance ?? 8)
  let bestDistance = Infinity
  let snappedPoint = { ...point }
  let snapType: VectorSnapResult['snapType'] = undefined
  let reference: BoardPoint | undefined = undefined

  for (const anchor of anchors) {
    const d = distance(point, anchor)
    if (d <= tolerance && d < bestDistance) {
      bestDistance = d
      snappedPoint = { x: anchor.x, y: anchor.y }
      snapType = 'anchor'
      reference = anchor
    }
  }
  if (snapType === 'anchor') {
    return { point: snappedPoint, snapped: true, snapType, reference }
  }

  if (options.snapAxes && options.axisReference) {
    const ref = options.axisReference
    const dx = Math.abs(point.x - ref.x)
    const dy = Math.abs(point.y - ref.y)
    if (dx <= tolerance && dx <= dy) {
      return { point: { x: ref.x, y: point.y }, snapped: true, snapType: 'axis-x', reference: ref }
    }
    if (dy <= tolerance) {
      return { point: { x: point.x, y: ref.y }, snapped: true, snapType: 'axis-y', reference: ref }
    }
  }

  return { point, snapped: false }
}

/** Keep an imported affine stroke editable when its baked fill path changes. */
export function synchronizeVectorStroke(node: BoardNode): BoardNode {
  const g=node.vectorStrokeGeometry
  if(!g || !node.vectorPath || g.paths.length!==1 || node.vectorBoolean)return node
  const [a,b,c,d,e,f]=g.transform,det=a*d-b*c
  if(Math.abs(det)<1e-12)return node
  const path=transformVectorPath(node.vectorPath,{a:d/det,b:-b/det,c:-c/det,d:a/det,e:(c*f-d*e)/det,f:(b*e-a*f)/det})
  return {...node,vectorStrokeGeometry:{...g,paths:[{...path,closed:g.paths[0].closed}]}}
}
