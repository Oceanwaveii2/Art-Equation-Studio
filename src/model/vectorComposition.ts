import type { BoardNode, VectorBooleanOperation, VectorPath } from './project'
import { joinVectorPaths, transformVectorPath, vectorNodeMatrix, vectorPathBounds } from './vector'

export type VectorCompositionResult =
  | { ok: true; node: BoardNode; sourceIds: string[] }
  | { ok: false; reason: string }

/** Compose editable paths in board space, then give the result a fresh local frame.
 * Ownership/connector mutation remains the caller's atomic board operation.
 * Boolean operands stay exact source geometry; resolving their paint is separate.
 */
export function composeVectorPaths(
  nodes: readonly BoardNode[],
  operation: 'join' | VectorBooleanOperation,
  resultId = nodes[0]?.id,
  options: { joinTolerance?: number } = {},
): VectorCompositionResult {
  const refuse = (reason: string): VectorCompositionResult => ({ ok: false, reason })
  if (nodes.length !== 2 || !resultId || nodes[0].id === nodes[1].id) return refuse('Select exactly two different paths.')
  if (!['join', 'union', 'subtract', 'intersect', 'exclude'].includes(operation)) return refuse('Unknown path operation.')
  const [first, second] = nodes
  if (first.groupId !== second.groupId || first.parentColumnId !== second.parentColumnId) return refuse('Both paths must have the same direct group and column owner.')
  if (nodes.some((node) => node.locked)) return refuse('Unlock both paths before combining them.')
  if (nodes.some((node) => node.kind !== 'shape' || node.shapeType !== 'path' || !node.vectorPath)) return refuse('Both objects must be editable paths.')
  if (nodes.some((node) => node.vectorBoolean)) return refuse('Resolve existing Boolean paths before combining them again.')
  const paths = nodes.map((node) => node.vectorPath!)
  if (paths.some((path) => path.version !== 1 || path.points.length < (path.closed ? 3 : 2))) return refuse('A path has too few anchors or an unsupported version.')
  if (operation === 'join' ? paths.some((path) => path.closed) : paths.some((path) => !path.closed)) return refuse(operation === 'join' ? 'Join requires two open paths.' : 'Boolean operations require two closed paths.')
  if (paths.some((path) => path.points.some((point) => [point.x, point.y, point.handleIn?.x ?? 0, point.handleIn?.y ?? 0, point.handleOut?.x ?? 0, point.handleOut?.y ?? 0].some((value) => !Number.isFinite(value))))) return refuse('A path contains invalid anchor or control coordinates.')
  if (nodes.some((node) => [node.x, node.y, node.width, node.height, node.rotation ?? 0, ...Object.values(node.vectorTransform || {})].some((value) => !Number.isFinite(value)) || node.width <= 0 || node.height <= 0)) return refuse('A path contains invalid frame or transform values.')
  const matrices = nodes.map(vectorNodeMatrix)
  if (matrices.some((matrix) => Object.values(matrix).some((value) => !Number.isFinite(value)) || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-10)) return refuse('A collapsed or singular path transform cannot be combined.')
  const tolerance = options.joinTolerance ?? 12
  if (!Number.isFinite(tolerance) || tolerance < 0) return refuse('Join tolerance must be a finite non-negative distance.')
  const worldPaths = paths.map((path, index) => transformVectorPath(path, matrices[index]))
  const joined = operation === 'join' ? joinVectorPaths(worldPaths[0], worldPaths[1], tolerance) : undefined
  if (operation === 'join' && !joined) return refuse('The selected paths could not be joined.')
  const boundsPaths = joined ? [joined] : operation === 'subtract' ? worldPaths.slice(0, 1) : worldPaths
  const bounds = boundsPaths.map(vectorPathBounds)
  const x = Math.min(...bounds.map((bound) => bound.left)), y = Math.min(...bounds.map((bound) => bound.top))
  const width = Math.max(1, Math.max(...bounds.map((bound) => bound.right)) - x)
  const height = Math.max(1, Math.max(...bounds.map((bound) => bound.bottom)) - y)
  if (![x, y, width, height].every(Number.isFinite)) return refuse('The composed path exceeds finite coordinate bounds.')
  const local = (path: VectorPath) => transformVectorPath(path, { a: 1, b: 0, c: 0, d: 1, e: -x, f: -y })
  const operands = worldPaths.map(local)
  const node: BoardNode = {
    ...first,
    id: resultId,
    title: operation === 'join' ? 'Joined path' : `${operation[0].toUpperCase()}${operation.slice(1)} path`,
    x, y, width, height,
    rotation: 0,
    vectorTransform: undefined,
    strokeWidth: first.strokeWidth ?? 2,
    opacity: first.opacity ?? 1,
    vectorFillRule: operation === 'exclude' ? 'evenodd' : first.vectorFillRule ?? 'nonzero',
    vectorStrokeJoin: first.vectorStrokeJoin ?? 'miter',
    vectorStrokeCap: first.vectorStrokeCap ?? 'butt',
    vectorPath: joined ? local(joined) : operands[0],
    vectorBoolean: joined ? undefined : { operation: operation as VectorBooleanOperation, operands, fillRules: nodes.map((source) => source.vectorFillRule ?? 'nonzero') },
  }
  return { ok: true, node, sourceIds: nodes.map((source) => source.id) }
}
