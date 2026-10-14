import type { BoardModel, BoardNode } from '../model/project'
import { containerDescendantIds, diagramState, diagramProjectionStates, moveContainerWithDescendants, validateContainerOwnership, type StructureResult } from './diagramStructureCore'
import { connectorGeometry } from './connectors'
import { resizeVectorNodeFrame } from '../model/vector'
import { isRectangleErasure, rectangleErasureState, resizeRectangleErasureFrame } from '../model/rectangleErasure'
import { guardColumnRowPosition } from './columnRowPosition'
import { validGradient, validTexture } from './vectorPaint'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
// Imported vectors use fractional coordinates; equivalent translations can differ
// by floating-point roundoff after addition/subtraction. Never accept visible drift.
const sameCoordinate = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7
const refuse = (detail: string): StructureResult<BoardModel> => ({ ok: false, issues: [{ code: 'unsafe-board-edit', detail }] })

/** Final boundary for all board content commands, including inspector/native
 * callbacks. Reject atomically before history or project state is changed. */
export function validateBoardMutation(before: BoardModel, after: BoardModel, readOnly = false): StructureResult<BoardModel> {
  const contentChanged = !same(before.nodes, after.nodes) || !same(before.connectors, after.connectors)
  if (readOnly && !same({ ...before, viewport: undefined }, { ...after, viewport: undefined })) return refuse('This workspace is read-only.')
  if (!contentChanged) return { ok: true, value: after }
  const valid = validateContainerOwnership(after.nodes)
  if (!valid.ok) return valid
  const afterStates = diagramProjectionStates(after.nodes)
  if (!afterStates.ok) return afterStates
  const beforeStates = diagramProjectionStates(before.nodes)
  if (!beforeStates.ok) return beforeStates
  const next = new Map(after.nodes.map((node) => [node.id, node]))
  const originalNodes = new Map(before.nodes.map((node) => [node.id, node]))
  for (const node of before.nodes) {
    const changed = next.get(node.id)
    if (same(node, changed)) continue
    const unlocking = changed && node.locked && changed.locked === false && same({ ...node, locked: false }, changed)
    const showing = changed && node.hidden && changed.hidden === false && same({ ...node, hidden: false }, changed)
    const nodes = unlocking || showing ? before.nodes.map((entry) => entry.id === node.id ? { ...entry, ...(unlocking ? { locked: false } : { hidden: false }) } : entry) : before.nodes
    const unlockedState = unlocking || showing ? diagramState(nodes, node.id) : undefined
    if (unlockedState && !unlockedState.ok) return unlockedState
    const state = unlockedState?.ok ? unlockedState.value : beforeStates.value.get(node.id)!
    if (state.locked || state.hidden) return refuse('The object or its owner is locked, hidden or collapsed; the command was cancelled.')
    if (changed && (node.kind === 'group' || node.kind === 'column') && (changed.x !== node.x || changed.y !== node.y) && changed.width === node.width && changed.height === node.height && changed.rotation === node.rotation) {
      const descendants = containerDescendantIds(before.nodes, [node.id])
      if (!descendants.ok) return descendants
      for (const id of descendants.value) {
        const original = originalNodes.get(id)!, moved = next.get(id)
        if (!moved || !sameCoordinate(moved.x, original.x + (changed.x - node.x)) || !sameCoordinate(moved.y, original.y + (changed.y - node.y))) return refuse('Move the container and all its members together; the command was cancelled.')
      }
    }
  }
  for (const node of after.nodes) {
    if ((node.vectorFillGradient && !validGradient(node.vectorFillGradient)) || (node.vectorStrokeGradient && !validGradient(node.vectorStrokeGradient)) || (node.vectorTexture && !validTexture(node.vectorTexture)) || [node.fillOpacity,node.strokeOpacity].some(value=>value!==undefined && (!Number.isFinite(value)||value<0||value>1))) return refuse('Drawing paint must contain valid gradients, textures and transparency values.')
    if (![node.x, node.y, node.width, node.height, node.rotation ?? 0].every(Number.isFinite) || node.width <= 0 || node.height <= 0) return refuse('Object geometry must be finite with positive dimensions.')
    const previous = originalNodes.get(node.id), owner = node.groupId || node.parentColumnId
    if (node.kind === 'shape' && node.shapeType === 'rectangle' && node.vectorBoolean && !same(previous, node) && !rectangleErasureState(node)) return refuse('Rectangle erasure modifiers must remain valid with their frame; the original artwork is preserved.')
    if (owner && (!previous || owner !== (previous.groupId || previous.parentColumnId))) {
      const destination = beforeStates.value.get(owner)
      if (destination?.locked || destination?.hidden) return refuse('The destination container is locked, hidden or collapsed; the command was cancelled.')
    }
  }
  const ids = new Set(after.nodes.map((node) => node.id)), edges = new Set<string>()
  for (const edge of after.connectors) {
    if (edges.has(edge.id) || (edge.sourceId && !ids.has(edge.sourceId)) || (edge.targetId && !ids.has(edge.targetId))) return refuse('The command would leave an invalid connection identity or endpoint.')
    edges.add(edge.id)
    if ([...(edge.bendPoints || []), ...(edge.sourcePoint ? [edge.sourcePoint] : []), ...(edge.targetPoint ? [edge.targetPoint] : [])].some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return refuse('Connection geometry must be finite.')
  }
  const nextEdges = new Map(after.connectors.map((edge) => [edge.id, edge]))
  for (const edge of before.connectors) {
    if (same(edge, nextEdges.get(edge.id))) continue
    for (const id of [edge.sourceId, edge.targetId]) {
      if (!id) continue
      const state = beforeStates.value.get(id)
      if (!state || state.locked || state.hidden) return refuse('A connection endpoint is locked, hidden or collapsed; the command was cancelled.')
    }
  }
  return { ok: true, value: after }
}

export function patchBoardNode(board: BoardModel, id: string, patch: Partial<BoardNode>, readOnly = false, normalize: (node: BoardNode) => BoardNode = (node) => node): StructureResult<BoardModel> {
  const node = board.nodes.find((entry) => entry.id === id)
  if (!node) return refuse('The selected object is no longer on this board.')
  if (['width', 'height'].some((key) => key in patch && (!Number.isFinite(patch[key as 'width' | 'height']) || patch[key as 'width' | 'height']! <= 0))) return refuse('Object dimensions must be finite and positive.')
  const positionChanged = ('x' in patch && patch.x !== node.x) || ('y' in patch && patch.y !== node.y)
  const frameChanged = ('width' in patch && patch.width !== node.width) || ('height' in patch && patch.height !== node.height)
  if (isRectangleErasure(node) && frameChanged && Object.hasOwn(patch, 'vectorBoolean')) return refuse('Change the rectangle frame and its erasure modifiers in separate validated commands.')
  if (isRectangleErasure(node) && frameChanged && [patch.x ?? node.x, patch.y ?? node.y, patch.width ?? node.width, patch.height ?? node.height].some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) return refuse('Rectangle dimensions exceed the bounded erasure geometry; artwork is preserved.')
  if (positionChanged && !frameChanged) {
    const position = guardColumnRowPosition(board, [id])
    if (!position.ok) return position
  }
  let next = board
  if ('x' in patch || 'y' in patch) {
    const moved = moveContainerWithDescendants(board.nodes, board.connectors, [id], { x: (patch.x ?? node.x) - node.x, y: (patch.y ?? node.y) - node.y })
    if (!moved.ok) return moved
    next = { ...board, nodes: moved.value.nodes, connectors: moved.value.connectors }
  }
  if (['width', 'height', 'rotation'].some((key) => key in patch && patch[key as keyof BoardNode] !== node[key as keyof BoardNode]) && (node.kind === 'group' || node.kind === 'column')) {
    const descendants = containerDescendantIds(board.nodes, [id])
    if (!descendants.ok) return descendants
    for (const child of descendants.value) {
      const state = diagramState(board.nodes, child)
      if (!state.ok) return state
      if (state.value.locked || state.value.hidden) return refuse('A container member is locked, hidden or collapsed; the transform was cancelled.')
    }
  }
  next = { ...next, nodes: next.nodes.map((entry) => {
    if (entry.id !== id) return entry
    const updated = { ...entry, ...patch }
    const resized = isRectangleErasure(entry) && (updated.width !== entry.width || updated.height !== entry.height)
      ? resizeRectangleErasureFrame({ ...updated, x: entry.x, y: entry.y, width: entry.width, height: entry.height }, updated)
      : entry.vectorPath && (updated.width !== entry.width || updated.height !== entry.height)
      ? resizeVectorNodeFrame({ ...updated, x: entry.x, y: entry.y, width: entry.width, height: entry.height }, updated)
      : updated
    return normalize(resized)
  }) }
  return validateBoardMutation(board, next, readOnly)
}

/** Dissolving a container releases direct members in world space. Connections
 * attached to its boundary become detached at their current visible endpoints. */
export function dissolveBoardContainer(board: BoardModel, id: string, readOnly = false): StructureResult<BoardModel> {
  const node = board.nodes.find((entry) => entry.id === id)
  if (!node || (node.kind !== 'group' && node.kind !== 'column')) return refuse('Choose a group, frame or column to dissolve.')
  const descendants = containerDescendantIds(board.nodes, [id])
  if (!descendants.ok) return descendants
  for (const child of descendants.value) {
    const state = diagramState(board.nodes, child)
    if (!state.ok) return state
    if (state.value.locked || state.value.hidden) return refuse('A container member is locked, hidden or collapsed; dissolving was cancelled.')
  }
  const next = { ...board, nodes: board.nodes.filter((entry) => entry.id !== id).map((entry) => {
    if (entry.groupId !== id && entry.parentColumnId !== id) return entry
    const released = { ...entry }; delete released.groupId; delete released.parentColumnId; delete released.columnOrder; delete released.freeWidth; delete released.freeHeight
    if (node.groupId) released.groupId = node.groupId
    else if (node.parentColumnId) { released.parentColumnId = node.parentColumnId; released.columnOrder = entry.columnOrder ?? node.columnOrder ?? 0 }
    return released
  }), connectors: board.connectors.map((edge) => {
    if (edge.sourceId !== id && edge.targetId !== id) return edge
    const geometry = connectorGeometry(edge, board.nodes)
    if (!geometry) return edge // Validation below refuses any unresolved endpoint.
    return { ...edge, ...(edge.sourceId === id ? { sourceId: undefined, sourcePoint: geometry.source } : {}), ...(edge.targetId === id ? { targetId: undefined, targetPoint: geometry.target } : {}) }
  }) }
  return validateBoardMutation(board, next, readOnly)
}
