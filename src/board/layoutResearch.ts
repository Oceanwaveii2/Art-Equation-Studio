import type { BoardModel, BoardNode, ProjectAsset } from '../model/project'
import { diagramState, moveContainerWithDescendants } from './diagramStructureCore'
import { layoutBoardColumnsResult } from './columns'
import { boardNodeVisualBounds } from './arrangement'
import { assetIntrinsicSize, fitNaturalImageBounds } from '../model/naturalImageBounds'

export type PersistentLayoutGuide = {
  id: string; title: string; axis: 'x' | 'y'; anchor: 'start' | 'center' | 'end'
  mode?: 'manual' | 'relationship'
  position: number; members: Array<{ id: string; offset: number }>
}
export function createManualGuide(axis: 'x' | 'y', position: number): PersistentLayoutGuide {
  if (!Number.isFinite(position)) throw new Error('Guide position must be finite')
  return { id: crypto.randomUUID(), title: axis === 'x' ? 'Vertical ruler guide' : 'Horizontal ruler guide', axis, anchor: 'start', position, mode: 'manual', members: [] }
}
export type LayoutProposal = { source: string; board: BoardModel; warnings: string[]; moved: number }
export const layoutFingerprint = (board: BoardModel) => JSON.stringify([board.id, board.nodes, board.connectors, board.layoutGuides])
const parent = (node: BoardNode) => node.parentColumnId || node.groupId
const size = (node: BoardNode, axis: 'x' | 'y') => axis === 'x' ? node.width : node.height
const anchorOffset = (node: BoardNode, guide: Pick<PersistentLayoutGuide, 'axis' | 'anchor'>) => guide.anchor === 'start' ? 0 : size(node, guide.axis) * (guide.anchor === 'center' ? .5 : 1)

/** Ownership stays in the established column/group/portal model. */
export function layoutFamily(nodes: BoardNode[], id: string): Set<string> {
  const ids = new Set([id]); let changed = true
  while (changed) { changed = false; for (const node of nodes) if (parent(node) && ids.has(parent(node)!) && !ids.has(node.id)) { ids.add(node.id); changed = true } }
  return ids
}
function movableRoot(nodes: BoardNode[], node: BoardNode) {
  const family = layoutFamily(nodes, node.id)
  return !parent(node) && !node.rotation && !nodes.some((child) => {
    if (!family.has(child.id)) return false
    const state = diagramState(nodes, child.id)
    return !state.ok || state.value.locked || state.value.hidden || child.collapsed
  })
}
function shiftFamily(board: BoardModel, id: string, dx: number, dy: number) {
  const moved = moveContainerWithDescendants(board.nodes, board.connectors, [id], { x: dx, y: dy })
  return moved.ok ? { ...board, nodes: moved.value.nodes, connectors: moved.value.connectors } : board
}
export function createLayoutGuide(board: BoardModel, ids: string[], axis: 'x' | 'y', anchor: PersistentLayoutGuide['anchor']): PersistentLayoutGuide | null {
  const members = board.nodes.filter((node) => ids.includes(node.id) && movableRoot(board.nodes, node))
  if (members.length < 2) return null
  const position = members[0][axis] + anchorOffset(members[0], { axis, anchor })
  return { id: crypto.randomUUID(), title: `${axis === 'x' ? 'Vertical' : 'Horizontal'} ${anchor} guide`, axis, anchor, position,
    members: members.map((node) => ({ id: node.id, offset: node[axis] + anchorOffset(node, { axis, anchor }) - position })) }
}
export function moveLayoutGuide(board: BoardModel, id: string, position: number): BoardModel {
  const guide = board.layoutGuides?.find((entry) => entry.id === id)
  if (!guide || !Number.isFinite(position)) return board
  const members = guide.members.map((member) => board.nodes.find((node) => node.id === member.id))
  if (members.some((node) => !node || !movableRoot(board.nodes, node))) return board
  let next = board
  guide.members.forEach((member) => { const node = next.nodes.find((entry) => entry.id === member.id)!; const delta = position + member.offset - node[guide.axis] - anchorOffset(node, guide); next = shiftFamily(next, node.id, guide.axis === 'x' ? delta : 0, guide.axis === 'y' ? delta : 0) })
  return { ...next, layoutGuides: board.layoutGuides!.map((entry) => entry.id === id ? { ...entry, position } : entry) }
}
/** A manual member move becomes a retained optical tweak, never a snap-back. */
export function reconcileLayoutGuides(before: BoardModel, after: BoardModel): BoardModel {
  if (!after.layoutGuides?.length) return after
  const layoutGuides = after.layoutGuides.map((guide) => ({ ...guide, members: guide.members.filter((member) => after.nodes.some((node) => node.id === member.id && !parent(node))).map((member) => {
    const old = before.nodes.find((node) => node.id === member.id), next = after.nodes.find((node) => node.id === member.id)!
    return old && (old[guide.axis] !== next[guide.axis] || size(old, guide.axis) !== size(next, guide.axis)) && before.layoutGuides?.find((entry) => entry.id === guide.id)?.position === guide.position
      ? { ...member, offset: next[guide.axis] + anchorOffset(next, guide) - guide.position } : member
  }) })).filter((guide) => guide.mode === 'manual' || guide.members.length >= 2)
  return { ...after, layoutGuides }
}
const intersects = (a: BoardNode, b: BoardNode, gap: number) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
function familyFootprint(board: BoardModel, root: BoardNode): BoardNode {
  const family = layoutFamily(board.nodes, root.id), boxes = board.nodes.filter((node) => family.has(node.id)).map(boardNodeVisualBounds)
  const x = Math.min(...boxes.map((box) => box.left)), y = Math.min(...boxes.map((box) => box.top))
  return { ...root, x, y, width: Math.max(...boxes.map((box) => box.right)) - x, height: Math.max(...boxes.map((box) => box.bottom)) - y }
}

export function proposeLayout(board: BoardModel, ids: string[], mode: 'rows' | 'columns', gap = 24): LayoutProposal {
  gap = Math.max(0, Number.isFinite(gap) ? gap : 24)
  const selected = new Set(ids.length ? ids : board.nodes.filter((node) => !parent(node)).map((node) => node.id))
  const roots = board.nodes.filter((node) => selected.has(node.id) && movableRoot(board.nodes, node))
  const warnings = board.nodes.filter((node) => selected.has(node.id) && !movableRoot(board.nodes, node)).map((node) => `${node.title || node.id}: retained because it is locked, contains a lock, or belongs to a container.`)
  if (!roots.length) return { source: layoutFingerprint(board), board, warnings, moved: 0 }
  const families = new Set(roots.flatMap((node) => [...layoutFamily(board.nodes, node.id)]))
  const obstacles = board.nodes.filter((node) => !families.has(node.id) && !parent(node)).map((node) => familyFootprint(board, node))
  const limit = Math.max(1, Math.ceil(Math.sqrt(roots.length)))
  let x = Math.min(...roots.map((node) => node.x)), y = Math.min(...roots.map((node) => node.y)), cross = 0, draft = board
  const startX = x, startY = y, placed: BoardNode[] = []
  roots.forEach((node, index) => {
    if (index && index % limit === 0) { if (mode === 'rows') { x = startX; y += cross + gap } else { y = startY; x += cross + gap }; cross = 0 }
    const footprint = familyFootprint(board, node)
    let candidate = { ...footprint, x, y }
    // A finite monotone sweep past each intersecting obstacle; never resize content.
    for (let pass = 0; pass <= obstacles.length + placed.length; pass++) {
      const hits = [...obstacles, ...placed].filter((obstacle) => intersects(candidate, obstacle, gap))
      if (!hits.length) break
      candidate = { ...candidate, y: Math.max(...hits.map((hit) => hit.y + hit.height + gap)) }
    }
    draft = shiftFamily(draft, node.id, candidate.x - footprint.x, candidate.y - footprint.y); placed.push(candidate)
    if (mode === 'rows') { x = candidate.x + footprint.width + gap; cross = Math.max(cross, candidate.y - y + footprint.height) }
    else { y = candidate.y + footprint.height + gap; cross = Math.max(cross, footprint.width) }
  })
  const next = reconcileLayoutGuides(board, draft)
  return { source: layoutFingerprint(board), board: next, warnings, moved: roots.filter((root) => { const node = draft.nodes.find((node) => node.id === root.id)!; return root.x !== node.x || root.y !== node.y }).length }
}
export function acceptLayoutProposal(board: BoardModel, proposal: LayoutProposal): BoardModel | null {
  return layoutFingerprint(board) === proposal.source ? proposal.board : null
}

export type HierarchySuggestion = { parentId: string; childId: string; reason: string; confidence: 'spatial' }
export function suggestLayoutHierarchy(board: BoardModel): HierarchySuggestion[] {
  const result: HierarchySuggestion[] = []
  const images = board.nodes.filter((node) => ['image', 'video', 'document'].includes(node.kind))
  for (const text of board.nodes.filter((node) => ['note', 'text'].includes(node.kind) && !parent(node))) {
    const candidates = images.filter((image) => !parent(image) && image.y + image.height <= text.y && text.y - image.y - image.height <= 48 && Math.min(image.x + image.width, text.x + text.width) - Math.max(image.x, text.x) >= Math.min(image.width, text.width) * .65)
      .sort((a, b) => text.y - a.y - a.height - (text.y - b.y - b.height))
    if (candidates.length && (candidates.length === 1 || candidates[0].y + candidates[0].height !== candidates[1].y + candidates[1].height)) result.push({ parentId: candidates[0].id, childId: text.id, reason: 'Text immediately below overlapping media; review as a possible caption.', confidence: 'spatial' })
    else {
      const below = images.filter((image) => !parent(image) && image.y >= text.y + text.height && image.y - text.y - text.height <= 48 && Math.min(image.x + image.width, text.x + text.width) - Math.max(image.x, text.x) >= Math.min(image.width, text.width) * .65)
      if (below.length === 1) result.push({ parentId: below[0].id, childId: text.id, reason: 'Text immediately above overlapping media; review as a possible heading.', confidence: 'spatial' })
    }
  }
  return result
}

export function groupHierarchySuggestion(board: BoardModel, suggestion: HierarchySuggestion): BoardModel {
  if (!suggestLayoutHierarchy(board).some((entry) => entry.parentId === suggestion.parentId && entry.childId === suggestion.childId)) return board
  const members = board.nodes.filter((node) => [suggestion.parentId, suggestion.childId].includes(node.id))
  if (members.length !== 2 || members.some((node) => !movableRoot(board.nodes, node))) return board
  const id = `research-group-${crypto.randomUUID()}`, x = Math.min(...members.map((node) => node.x)) - 12, y = Math.min(...members.map((node) => node.y)) - 32
  const group: BoardNode = { id, kind: 'group', title: members.find((node) => node.id === suggestion.childId)?.title || 'Media and text', x, y, width: Math.max(...members.map((node) => node.x + node.width)) - x + 12, height: Math.max(...members.map((node) => node.y + node.height)) - y + 12, color: '#38516d' }
  return reconcileLayoutGuides(board, { ...board, nodes: [...board.nodes.map((node) => members.includes(node) ? { ...node, groupId: id } : node), group] })
}

export function semanticClusterLabel(assetIds: string[], assets: ProjectAsset[], index: number) {
  const counts = new Map<string, number>()
  for (const id of assetIds) for (const tag of new Set(assets.find((asset) => asset.id === id)?.tags || [])) counts.set(tag, (counts.get(tag) || 0) + 1)
  const shared = [...counts].filter(([, count]) => count >= Math.max(2, assetIds.length * .5)).sort((a, b) => b[1] - a[1])[0]?.[0]
  return shared || `Visual references ${index + 1}`
}

export function organizeSemanticClusters(board: BoardModel, clusters: Array<{ title: string; assetIds: string[] }>, target: 'groups' | 'columns', assets: ProjectAsset[]): LayoutProposal {
  const source = layoutFingerprint(board), warnings: string[] = [], claimed = new Set<string>(), moved = new Set<string>()
  let nodes = [...board.nodes], x = Math.max(0, ...nodes.map((node) => node.x + node.width)) + 90
  clusters.forEach((cluster, clusterIndex) => {
    const id = `semantic-${board.id}-${clusterIndex}-${target}-${board.nodes.length}`, cards: BoardNode[] = []
    if (nodes.some((node) => node.id === id)) { warnings.push('A generated group identity already exists; retry the review.'); return }
    cluster.assetIds.forEach((assetId) => {
      if (claimed.has(assetId)) return; claimed.add(assetId)
      const existing = nodes.filter((node) => node.assetId === assetId)
      if (existing.some((node) => !movableRoot(nodes, node) || node.kind === 'group' || node.kind === 'column')) { warnings.push(`${assets.find((asset) => asset.id === assetId)?.displayName || assetId}: kept in its existing container or lock.`); return }
      const asset = assets.find((entry) => entry.id === assetId)
      if (!existing.length && !asset) return
      const fitted = fitNaturalImageBounds(assetIntrinsicSize(asset), { width: 250, height: 180 })
      if (!existing.length && !fitted) { warnings.push(`${asset!.displayName}: original dimensions unavailable; retained in Mini Bridge.`); return }
      const base = existing.length ? existing : [{ id: `${id}-asset-${cards.length}`, kind: 'image' as const, imagePresentation: 'artwork' as const, title: asset!.displayName, assetId, x: 0, y: 0, ...fitted! }]
      for (const node of base) { cards.push({ ...node, groupId: target === 'groups' ? id : undefined, parentColumnId: target === 'columns' ? id : undefined, columnOrder: target === 'columns' ? cards.length : undefined }); moved.add(node.id) }
    })
    if (!cards.length) return
    const width = Math.max(...cards.map((card) => card.width)) + 32
    let y = 142
    const positioned = cards.map((card) => { const next = { ...card, x: x + 16, y }; y += card.height + 24; return next })
    nodes = nodes.filter((node) => !positioned.some((card) => card.id === node.id))
    nodes.push({ id, kind: target === 'groups' ? 'group' : 'column', x, y: 90, width, height: y - 90, title: cluster.title, color: '#765a40', columnPreserveCardSizes: target === 'columns' }, ...positioned)
    x += width + 40
  })
  let next = { ...board, nodes }
  if (target === 'columns') {
    const newColumns = nodes.filter((node) => node.kind === 'column' && !board.nodes.some((old) => old.id === node.id)).map((node) => node.id)
    const result = layoutBoardColumnsResult(next, newColumns)
    if (!result.ok) return { source, board, warnings: [...warnings, result.issues[0]?.detail || 'Column arrangement refused.'], moved: 0 }
    next = result.value
  }
  return { source, board: reconcileLayoutGuides(board, next), warnings, moved: moved.size }
}
