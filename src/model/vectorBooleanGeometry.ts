import paper from 'paper'
import type { VectorBooleanOperation, VectorPath, VectorPathPoint } from './project'

type FillRule = 'nonzero' | 'evenodd'
type Cached = { operands: readonly VectorPath[]; signature: string; value: VectorPath[] | undefined }
// Bound retained immutable source references/results; old document revisions
// must not grow an unbounded renderer cache. No Paper canvas/view is created.
const cache: Cached[] = []
const MAX_CACHE_ENTRIES = 128
const scope = new paper.PaperScope()
new scope.Project(undefined!) // Geometry-only project, without a canvas/view element.

function validPath(path: VectorPath): boolean {
  return path?.closed === true && Array.isArray(path.points) && path.points.length >= 3 && path.points.every(point =>
    Number.isFinite(point.x) && Number.isFinite(point.y) &&
    (!point.handleIn || (Number.isFinite(point.handleIn.x) && Number.isFinite(point.handleIn.y))) &&
    (!point.handleOut || (Number.isFinite(point.handleOut.x) && Number.isFinite(point.handleOut.y))))
}

/** Derived exact Bézier boundary contours. Source operands/rules remain the
 * editable document truth; the returned paths use nonzero outer/hole winding.
 * undefined means unsupported/invalid; [] is a valid empty set result. */
export function resolveVectorBooleanGeometry(
  operation: VectorBooleanOperation,
  operands: readonly VectorPath[],
  fillRules?: readonly FillRule[],
): VectorPath[] | undefined {
  const signature = `${operation}:${operands.map((_, index) => fillRules?.[index] ?? 'nonzero').join(',')}`
  const index = cache.findIndex(entry => entry.operands === operands && entry.signature === signature)
  if (index >= 0) { const [entry] = cache.splice(index, 1); cache.push(entry); return entry.value }
  let value: VectorPath[] | undefined
  if (['union', 'subtract', 'intersect', 'exclude'].includes(operation) && operands.length >= 2 && operands.every(validPath)) {
    const items: paper.PathItem[] = []
    try {
      scope.activate()
      const paths = operands.map((path, index) => {
        const item = new scope.Path({ insert: false, closed: true, fillRule: fillRules?.[index] ?? 'nonzero' })
        for (const point of path.points) item.add(new scope.Segment(
          new scope.Point(point.x, point.y),
          new scope.Point(point.handleIn?.x ?? 0, point.handleIn?.y ?? 0),
          new scope.Point(point.handleOut?.x ?? 0, point.handleOut?.y ?? 0),
        ))
        items.push(item)
        return item
      })
      let result: paper.PathItem = paths[0]
      for (const path of paths.slice(1)) {
        const options = { insert: false, trace: true }
        result = operation === 'union' ? result.unite(path, options)
          : operation === 'subtract' ? result.subtract(path, options)
            : operation === 'intersect' ? result.intersect(path, options) : result.exclude(path, options)
        result.fillRule = 'nonzero'
        items.push(result)
      }
      result.reorient(true, true)
      const contours = result instanceof scope.CompoundPath ? result.children as paper.Path[] : [result as paper.Path]
      value = contours.filter(path => path.segments.length > 0).map(path => ({
        version: 1, closed: true,
        points: path.segments.map(segment => {
          const point: VectorPathPoint = { x: segment.point.x, y: segment.point.y }
          if (!segment.handleIn.isZero()) point.handleIn = { x: segment.handleIn.x, y: segment.handleIn.y }
          if (!segment.handleOut.isZero()) point.handleOut = { x: segment.handleOut.x, y: segment.handleOut.y }
          return point
        }),
      }))
      if (!value.every(path => path.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) &&
        (!point.handleIn || (Number.isFinite(point.handleIn.x) && Number.isFinite(point.handleIn.y))) &&
        (!point.handleOut || (Number.isFinite(point.handleOut.x) && Number.isFinite(point.handleOut.y)))))) value = undefined
    } catch { value = undefined } finally { for (const item of items) item.remove() }
  }
  cache.push({ operands, signature, value })
  if (cache.length > MAX_CACHE_ENTRIES) cache.shift()
  return value
}
