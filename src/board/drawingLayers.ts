import type { BoardNode } from '../model/project'
import { containerDescendantIds, containerPaintOrder, diagramProjectionStates, type StructureResult } from './diagramStructureCore'

const ownerOf = (node: BoardNode) => node.groupId || node.parentColumnId
const rankOf = (node: BoardNode) => node.zIndex ?? (node.kind === 'group' ? 0 : node.kind === 'column' ? 1 : 2)
const refuse = (code: string, detail: string, nodeId?: string): StructureResult<never> => ({ ok: false, issues: [{ code, detail, ...(nodeId ? { nodeId } : {}) }] })

export type DrawingLayerRow = { node: BoardNode; depth: number; paintOrder: number; locked: boolean; hidden: boolean }

/** A derived view of existing node identities, never a second saved layer model.
 * Topmost siblings appear first; an owner precedes its children. */
export function projectDrawingLayers(nodes: readonly BoardNode[]): StructureResult<DrawingLayerRow[]> {
  const paint = containerPaintOrder(nodes), states = diagramProjectionStates(nodes)
  if (!paint.ok) return paint
  if (!states.ok) return states
  const byId = new Map(nodes.map(node => [node.id, node])), siblings = new Map<string | undefined, BoardNode[]>()
  for (const id of paint.value.orderedIds) {
    const node = byId.get(id)!, owner = ownerOf(node), family = siblings.get(owner) || []
    family.push(node); siblings.set(owner, family)
  }
  const rows: DrawingLayerRow[] = [], stack = (siblings.get(undefined) || []).map(node => ({ node, depth: 0 }))
  while (stack.length) {
    const { node, depth } = stack.pop()!
    rows.push({ node, depth, paintOrder: paint.value.zIndexById.get(node.id)!, ...states.value.get(node.id)! })
    for (const child of siblings.get(node.id) || []) stack.push({ node: child, depth: depth + 1 })
  }
  return { ok: true, value: rows }
}

/** Move selected sibling subtrees together, keeping their existing relative
 * paint order. Ownership, geometry, array order and untouched records survive.
 * Refuse exhausted numeric ranks rather than rewriting unrelated saved data. */
export function changeDrawingLayerOrder<T extends BoardNode>(nodes: T[], ids: readonly string[], direction: 'front' | 'back'): StructureResult<T[]> {
  const paint = containerPaintOrder(nodes), states = diagramProjectionStates(nodes)
  if (!paint.ok) return paint
  if (!states.ok) return states
  const expanded = containerDescendantIds(nodes, ids)
  if (!expanded.ok) return expanded
  for (const id of expanded.value) {
    const state = states.value.get(id)!
    if (state.locked || state.hidden) return refuse('blocked-layer', 'The object or a container member is locked, hidden or collapsed; the whole layer command was cancelled.', id)
  }
  const byId = new Map(nodes.map(node => [node.id, node])), selected = new Set(ids), covered = new Set<string>(), roots = new Set<string>()
  const siblings = new Map<string | undefined, T[]>()
  // Parent-first canonical order also removes redundant selected descendants.
  for (const id of paint.value.orderedIds) {
    const node = byId.get(id)!, owner = ownerOf(node), family = siblings.get(owner) || []
    family.push(node); siblings.set(owner, family)
    if (owner && covered.has(owner)) covered.add(id)
    else if (selected.has(id)) { roots.add(id); covered.add(id) }
  }
  const replacements = new Map<string, T>()
  for (const family of siblings.values()) {
    const moved = family.filter(node => roots.has(node.id)), kept = family.filter(node => !roots.has(node.id))
    if (!moved.length || !kept.length) continue
    const desired = direction === 'front' ? [...kept, ...moved] : [...moved, ...kept]
    if (desired.every((node, index) => node === family[index])) continue
    let edge = rankOf(family[0])
    for (const node of family) edge = direction === 'front' ? Math.max(edge, rankOf(node)) : Math.min(edge, rankOf(node))
    let previous = direction === 'front' ? edge : -Infinity
    for (let index = 0; index < moved.length; index++) {
      const rank = direction === 'front' ? edge + index + 1 : edge - moved.length + index
      if (!Number.isFinite(rank) || rank <= previous || (direction === 'back' && rank >= edge)) {
        return refuse('layer-rank-capacity', 'Saved layer ranks have no safe numeric space for this command; ordering was left unchanged.', moved[index].id)
      }
      replacements.set(moved[index].id, { ...moved[index], zIndex: rank }); previous = rank
    }
  }
  return { ok: true, value: replacements.size ? nodes.map(node => replacements.get(node.id) || node) : nodes }
}
