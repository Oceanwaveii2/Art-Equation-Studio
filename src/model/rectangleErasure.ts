import type { BoardNode, BoardPoint, VectorPath } from './project'
import { editableShapePath, vectorEraserCutters, type VectorEraseResult } from './vectorDrawing.ts'
import { scaleVectorPath, transformVectorPath, vectorNodeMatrix } from './vector.ts'
import { resolveVectorBooleanGeometry } from './vectorBooleanGeometry.ts'

const MAX_CUTTERS = 512, MAX_COORDINATE = 1e9
const validPoint = (p: BoardPoint) => Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= MAX_COORDINATE && Math.abs(p.y) <= MAX_COORDINATE)
const validPath = (path: VectorPath) => Boolean(path?.version === 1 && path.closed && Array.isArray(path.points) && path.points.length >= 3 && path.points.length <= 16 && path.points.every(p => validPoint(p) && (!p.handleIn || validPoint(p.handleIn)) && (!p.handleOut || validPoint(p.handleOut))))
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-7
const sameContour = (a: VectorPath, b: VectorPath) => a.points.length === b.points.length && a.points.every((p, i) => {
  const q = b.points[i]
  return near(p.x, q.x) && near(p.y, q.y) && ['handleIn', 'handleOut'].every(key => {
    const left = p[key as 'handleIn'], right = q[key as 'handleIn']
    return near(left?.x ?? 0, right?.x ?? 0) && near(left?.y ?? 0, right?.y ?? 0)
  })
})
// Green's theorem integrated over cubic power coefficients, including holes.
// This is exact Bézier area rather than a sampled/bounding-box hit estimate.
const filledArea = (paths: readonly VectorPath[]) => Math.abs(paths.reduce((total, path) => total + path.points.reduce((area, p, i) => {
  const q = path.points[(i + 1) % path.points.length]
  const coefficients = (axis: 'x' | 'y') => {
    const a = p[axis], b = a + (p.handleOut?.[axis] ?? 0), d = q[axis], c = d + (q.handleIn?.[axis] ?? 0)
    return [a, 3 * (b - a), 3 * (a - 2 * b + c), -a + 3 * b - 3 * c + d]
  }
  const x = coefficients('x'), y = coefficients('y')
  let integral = 0
  for (let a = 0; a < 4; a++) for (let b = 1; b < 4; b++) integral += (x[a] * b * y[b] - y[a] * b * x[b]) / (a + b)
  return area + integral / 2
}, 0), 0))

/** The existing Boolean operands are document truth. The first operand is the
 * authored CSS rectangle's parametric contour; following operands are local
 * eraser cutters. No replacement path, raster or second appearance model is saved. */
export function rectangleErasureState(node: BoardNode): { base: VectorPath; cutters: readonly VectorPath[] } | undefined {
  if (node.kind !== 'shape' || node.shapeType !== 'rectangle' || node.vectorPath !== undefined || node.vectorTransform !== undefined || node.diagramShape
    || ![node.x, node.y, node.width, node.height, node.rotation ?? 0, node.cornerRadius ?? 14].every(Number.isFinite)
    || [node.x, node.y, node.width, node.height].some(v => Math.abs(v) > MAX_COORDINATE) || node.width <= 0 || node.height <= 0) return undefined
  const base = editableShapePath({ ...node, vectorBoolean: undefined })
  if (!base) return undefined
  if (!node.vectorBoolean) return { base, cutters: [] }
  const expression = node.vectorBoolean
  if (expression.operation !== 'subtract' || !Array.isArray(expression.operands) || expression.operands.length < 2 || expression.operands.length > MAX_CUTTERS + 1
    || expression.operands.some(path => !validPath(path)) || expression.fillRules?.some(rule => rule !== 'nonzero')) return undefined
  // Radius remains a live CSS parameter. A radius edit regenerates this base;
  // only an old parametric rectangle, never arbitrary hidden geometry, is accepted.
  const stored = expression.operands[0], radius = stored.points.length === 4 ? 0 : stored.points[0].x
  const oldBase = editableShapePath({ ...node, cornerRadius: radius, vectorBoolean: undefined })
  if (!oldBase || !sameContour(stored, oldBase)) return undefined
  return { base, cutters: expression.operands.slice(1) }
}

export function isRectangleErasure(node: BoardNode): boolean {
  return Boolean(node.vectorBoolean && rectangleErasureState(node))
}

/** Commit only after the caller qualifies CSS and engine whole-appearance
 * clipping. This helper deliberately does not bypass eraseVectorNode's guard. */
export function eraseRectangleAppearance(node: BoardNode, sweep: readonly BoardPoint[], radius: number): VectorEraseResult {
  const unchanged = (unsupported?: string): VectorEraseResult => ({ changed: false, nodes: [node], ...(unsupported ? { unsupported } : {}) })
  if (node.locked || node.hidden) return unchanged()
  const state = rectangleErasureState(node)
  if (!state || !Number.isFinite(radius) || radius <= 0 || radius > MAX_COORDINATE || !Array.isArray(sweep) || !sweep.length || sweep.length > MAX_CUTTERS + 1 || sweep.some(point => !validPoint(point))) return unchanged('Rectangle erasure geometry is invalid or exceeds its bounded cutter budget; artwork is preserved.')
  const m = vectorNodeMatrix(node), determinant = m.a * m.d - m.b * m.c
  if (![m.a, m.b, m.c, m.d, m.e, m.f, determinant].every(Number.isFinite) || Math.abs(determinant) < 1e-10) return unchanged('Rectangle transform is invalid; artwork is preserved.')
  const inverse = { a: m.d / determinant, b: -m.b / determinant, c: -m.c / determinant, d: m.a / determinant, e: (m.c * m.f - m.d * m.e) / determinant, f: (m.b * m.e - m.a * m.f) / determinant }
  const added = vectorEraserCutters([...sweep], radius).map(path => transformVectorPath(path, inverse))
  if (!added.length || added.some(path => !validPath(path)) || added.length + state.cutters.length > MAX_CUTTERS) return unchanged('Rectangle erasure cutter budget reached; artwork is preserved.')
  // Exact Boolean subtraction also provides hit/no-op detection. Repeated
  // cutters cannot re-fill overlaps as an even-odd concatenation would.
  const previous = state.cutters.length ? resolveVectorBooleanGeometry('subtract', [state.base, ...state.cutters]) : [state.base]
  const next = resolveVectorBooleanGeometry('subtract', [state.base, ...state.cutters, ...added])
  if (!previous || !next) return unchanged('Rectangle subtraction failed; artwork is preserved.')
  if (JSON.stringify(previous) === JSON.stringify(next) || (!previous.length && !next.length)) return unchanged()
  const beforeArea = filledArea(previous), afterArea = filledArea(next)
  if (!Number.isFinite(beforeArea) || !Number.isFinite(afterArea)) return unchanged('Rectangle subtraction area is invalid; artwork is preserved.')
  if (beforeArea - afterArea <= Math.max(1e-8, beforeArea * 1e-12)) return unchanged()
  return { changed: true, nodes: [{ ...node, vectorBoolean: { operation: 'subtract', operands: [state.base, ...state.cutters, ...added], fillRules: [state.base, ...state.cutters, ...added].map(() => 'nonzero') } }] }
}

/** Drag resize scales existing local cuts once from the immutable baseline;
 * CSS radius remains absolute and is clamped/rebuilt for the new frame. */
export function resizeRectangleErasureFrame(node: BoardNode, frame: { x: number; y: number; width: number; height: number }): BoardNode {
  const state = rectangleErasureState(node)
  if (!state || !state.cutters.length || ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) || frame.width <= 0 || frame.height <= 0 || Object.values(frame).some(v => Math.abs(v) > MAX_COORDINATE)) return node
  const resized = { ...node, ...frame, vectorBoolean: undefined }, base = editableShapePath(resized)
  const cutters = state.cutters.map(path => scaleVectorPath(path, frame.width / node.width, frame.height / node.height))
  if (!base || cutters.some(path => !validPath(path))) return node
  return { ...resized, vectorBoolean: { operation: 'subtract', operands: [base, ...cutters], fillRules: [base, ...cutters].map(() => 'nonzero') } }
}

/** Derived contours use resolved nonzero winding, including unioned cutter
 * overlaps. The optional envelope preserves paint outside the border box. */
export function resolveRectangleErasureMask(node: BoardNode, envelope?: { x: number; y: number; width: number; height: number }): VectorPath[] | undefined {
  const state = rectangleErasureState(node)
  if (!state) return undefined
  let base = state.base
  if (envelope) {
    if (![envelope.x, envelope.y, envelope.width, envelope.height].every(Number.isFinite) || envelope.width <= 0 || envelope.height <= 0 || [envelope.x, envelope.y, envelope.width, envelope.height].some(v => Math.abs(v) > MAX_COORDINATE)
      || envelope.x > 0 || envelope.y > 0 || envelope.x + envelope.width < node.width || envelope.y + envelope.height < node.height) return undefined
    const { x, y, width, height } = envelope
    base = { version: 1, closed: true, points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] }
  }
  return state.cutters.length ? resolveVectorBooleanGeometry('subtract', [base, ...state.cutters]) : [base]
}
