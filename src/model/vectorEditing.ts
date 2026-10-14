import type { BoardNode, BoardPoint } from './project'
import { vectorBoardDeltaToLocal, vectorLocalToBoard } from './vector.ts'

type NodeIndex = { byId: Map<string, BoardNode>; duplicates: Set<string> }
function indexNodes(nodes: BoardNode[]): NodeIndex {
  const byId = new Map<string, BoardNode>(), duplicates = new Set<string>()
  for (const node of nodes) { if (byId.has(node.id)) duplicates.add(node.id); byId.set(node.id, node) }
  return { byId, duplicates }
}
const owners = (node: BoardNode) => [
  ...(node.groupId ? [{ id: node.groupId, kind: 'group' }] : []),
  ...(node.parentColumnId ? [{ id: node.parentColumnId, kind: 'column' }] : []),
]

/** Editing inherits both freeform-group and column locks. Corrupt ownership
 * fails closed; no geometry helper may edit through a missing/ambiguous owner. */
function editBlockReason(index: NodeIndex, nodeId: string): string | undefined {
  const stack: { id: string; exit?: boolean; expectedKind?: string }[] = [{ id: nodeId }]
  const active = new Set<string>(), visited = new Set<string>()
  while (stack.length) {
    const item = stack.pop()!
    if (item.exit) { active.delete(item.id); visited.add(item.id); continue }
    if (index.duplicates.has(item.id)) return `Ambiguous duplicate object ID: ${item.id}.`
    const node = index.byId.get(item.id)
    if (!node) return `Missing owner or object: ${item.id}.`
    if (item.expectedKind && node.kind !== item.expectedKind) return `Invalid ${item.expectedKind} owner: ${item.id}.`
    if (active.has(item.id)) return 'Cyclic object ownership; repair the hierarchy before editing.'
    if (visited.has(item.id)) continue
    if (node.locked) return item.id === nodeId ? 'This object is locked.' : `Locked ancestor: ${node.title || node.id}.`
    active.add(item.id); stack.push({ id: item.id, exit: true })
    for (const owner of owners(node)) stack.push({ id: owner.id, expectedKind: owner.kind })
  }
  return undefined
}

export function vectorEditBlockReason(nodes: BoardNode[], nodeId: string): string | undefined {
  return editBlockReason(indexNodes(nodes), nodeId)
}

export type VectorDirectSelectionPolicy = {
  state: 'single' | 'none' | 'multiple' | 'locked' | 'unsupported'
  nodeId?: string
  message: string
}

/** Explicit first-pass policy: anchor indices belong to one editable path only.
 * Simultaneous multi-path anchor editing requires per-node identities and is not
 * silently approximated by applying the first path's indices to other paths. */
export function vectorDirectSelectionPolicy(nodes: BoardNode[], selectedIds: string[]): VectorDirectSelectionPolicy {
  const ids = [...new Set(selectedIds)]
  if (!ids.length) return { state: 'none', message: 'Select one editable path to edit its anchors and segments.' }
  if (ids.length > 1) return { state: 'multiple', message: 'Direct Selection edits one path at a time. Select a single path; simultaneous multi-path anchor editing is not supported yet.' }
  const index = indexNodes(nodes), node = index.byId.get(ids[0]), blocked = editBlockReason(index, ids[0])
  if (blocked) return { state: 'locked', message: blocked }
  if (node?.kind === 'shape' && node.shapeType === 'rectangle' && node.vectorBoolean) return { state: 'unsupported', message: 'This rectangle retains its inset border, shadow and caption with editable erasure cuts. Anchor conversion is unavailable until the complete appearance can be preserved; resize and radius controls remain available.' }
  if (node?.kind !== 'shape' || !node.vectorPath || node.vectorBoolean) return { state: 'unsupported', message: 'Select a single editable path. Live shapes and Boolean results must be converted before anchor editing.' }
  if (!vectorBoardDeltaToLocal(node, { x: 1, y: 0 })) return { state: 'unsupported', message: 'This path has a singular transform. Reset its transform before editing anchors.' }
  return { state: 'single', nodeId: node.id, message: '' }
}

export type VectorEditorControl = { index: number; anchor: BoardPoint; handleIn?: BoardPoint; handleOut?: BoardPoint }

/** HTML controls live inside the outer node container, which already supplies
 * board translation and rotation. Apply ONLY the inner SVG transform here;
 * applying vectorLocalToBoard(node, ...) directly would double that rotation. */
export function vectorEditorControls(node: BoardNode): VectorEditorControl[] {
  if (!node.vectorPath) return []
  const innerNode = { ...node, x: 0, y: 0, rotation: 0 }
  const project = (point: BoardPoint) => vectorLocalToBoard(innerNode, point)
  return node.vectorPath.points.map((point, index) => ({
    index, anchor: project(point),
    ...(point.handleIn ? { handleIn: project({ x: point.x + point.handleIn.x, y: point.y + point.handleIn.y }) } : {}),
    ...(point.handleOut ? { handleOut: project({ x: point.x + point.handleOut.x, y: point.y + point.handleOut.y }) } : {}),
  }))
}

export type VectorEraserScope = { nodeIds: string[]; blocked: { nodeId: string; reason: string }[] }

/** A selected group/frame/column scopes the Eraser to its descendant vectors.
 * Empty selection targets board vectors, never media. Any selection (even an
 * unsupported item) disables the board-wide fallback. Locks remain inherited. */
export function vectorEraserScope(nodes: BoardNode[], selectedIds: string[]): VectorEraserScope {
  const index = indexNodes(nodes), candidates = new Set(selectedIds.length ? selectedIds : nodes.map((node) => node.id))
  const children = new Map<string, string[]>()
  for (const node of nodes) for (const owner of owners(node)) {
    const members = children.get(owner.id)
    if (members) members.push(node.id)
    else children.set(owner.id, [node.id])
  }
  const queue = [...candidates]
  for (let position = 0; position < queue.length; position++) {
    const parent = index.byId.get(queue[position])
    if (!parent || (parent.kind !== 'group' && parent.kind !== 'column')) continue
    for (const child of children.get(parent.id) || []) if (!candidates.has(child)) { candidates.add(child); queue.push(child) }
  }
  const nodeIds: string[] = [], blocked: VectorEraserScope['blocked'] = []
  for (const id of candidates) {
    const node = index.byId.get(id), reason = editBlockReason(index, id)
    if (reason) { blocked.push({ nodeId: id, reason }); continue }
    if (node?.kind === 'shape') nodeIds.push(id)
    else if (selectedIds.includes(id) && node?.kind !== 'group' && node?.kind !== 'column') blocked.push({ nodeId: id, reason: 'Eraser edits vector shapes only; source media is preserved.' })
  }
  return { nodeIds, blocked }
}
