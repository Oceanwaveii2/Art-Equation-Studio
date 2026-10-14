import type { BoardConnector, BoardNode, BoardPoint, VectorPathPoint } from '../model/project'

/** Diagram relationships are deliberately separate from board/folder ownership.
 * This optional extension uses the existing JSON node records, not a schema bump. */
export type MindMapMembership = { version: 1; treeId: string; parentId?: string; order: number; collapsed?: boolean }
export type DiagramNode = BoardNode & { hidden?: boolean; mindMap?: MindMapMembership }
export type DiagramConnector = BoardConnector & { mindMap?: { version: 1; treeId: string; childId: string } }
export type StructureIssue = { code: string; nodeId?: string; detail: string }
export type StructureResult<T> = { ok: true; value: T } | { ok: false; issues: StructureIssue[] }
export type ContainerOwner = { kind: 'group' | 'column'; id: string }
const fail = <T = never>(code: string, detail: string, nodeId?: string): StructureResult<T> => ({ ok: false, issues: [{ code, detail, ...(nodeId ? { nodeId } : {}) }] })
const success = <T>(value: T): StructureResult<T> => ({ ok: true, value })
const ownerId = (node: BoardNode) => node.groupId || node.parentColumnId
const finite = (value: number) => typeof value === 'number' && Number.isFinite(value)
const clone = <T>(value: T): T => structuredClone(value)

/** Do not guess at conflicting legacy ownership. Reject it and leave the source
 * untouched so a caller can offer an explicit repair, not silently lose members. */
export function validateContainerOwnership(nodes: readonly DiagramNode[]): StructureResult<Map<string, DiagramNode>> {
  const byId = new Map<string, DiagramNode>(), issues: StructureIssue[] = []
  for (const node of nodes) {
    if (!node.id || typeof node.id !== 'string') issues.push({ code: 'invalid-id', detail: 'Every object needs a nonempty string identity.' })
    else if (byId.has(node.id)) issues.push({ code: 'duplicate-id', nodeId: node.id, detail: 'Object identities must be unique.' })
    else byId.set(node.id, node)
    if (node.groupId && node.parentColumnId) issues.push({ code: 'ambiguous-owner', nodeId: node.id, detail: 'An object cannot belong to both a freeform group/frame and a column.' })
    if (node.containerRole && node.kind !== 'group') issues.push({ code: 'invalid-container-role', nodeId: node.id, detail: 'Only a group-kind object can declare group/frame treatment.' })
  }
  for (const node of nodes) {
    const id = ownerId(node)
    if (!id) continue
    const parent = byId.get(id)
    if (!parent) issues.push({ code: 'missing-owner', nodeId: node.id, detail: `Owner ${id} is not on this board.` })
    else if (id === node.id) issues.push({ code: 'self-owner', nodeId: node.id, detail: 'An object cannot own itself.' })
    else if ((node.groupId && parent.kind !== 'group') || (node.parentColumnId && parent.kind !== 'column')) issues.push({ code: 'wrong-owner-kind', nodeId: node.id, detail: 'Membership must reference the matching group/frame or column kind.' })
  }
  // Each object has at most one owner. Walking previously completed chains is
  // linear and avoids recursion overflow on deeply nested imported diagrams.
  const complete = new Set<string>()
  for (const node of nodes) {
    if (complete.has(node.id)) continue
    const chain: string[] = [], visiting = new Set<string>()
    let current: DiagramNode | undefined = node
    while (current && !complete.has(current.id)) {
      if (visiting.has(current.id)) { issues.push({ code: 'ownership-cycle', nodeId: current.id, detail: 'Container ownership contains a cycle.' }); break }
      visiting.add(current.id); chain.push(current.id)
      current = byId.get(ownerId(current) || '')
    }
    chain.forEach((id) => complete.add(id))
  }
  return issues.length ? { ok: false, issues } : success(byId)
}

export function containerDescendantIds(nodes: readonly DiagramNode[], roots: readonly string[]): StructureResult<string[]> {
  const valid = validateContainerOwnership(nodes)
  if (!valid.ok) return valid
  const selected = new Set(roots)
  for (const id of selected) if (!valid.value.has(id)) return fail('missing-object', `Object ${id} is not on this board.`, id)
  const children = new Map<string, string[]>()
  for (const node of nodes) if (ownerId(node)) { const siblings = children.get(ownerId(node)!) || []; siblings.push(node.id); children.set(ownerId(node)!, siblings) }
  const queue = [...selected]
  for (let cursor = 0; cursor < queue.length; cursor++) for (const child of children.get(queue[cursor]) || []) if (!selected.has(child)) { selected.add(child); queue.push(child) }
  return success(nodes.filter((node) => selected.has(node.id)).map((node) => node.id))
}

export function containerState(nodes: readonly DiagramNode[], id: string): StructureResult<{ locked: boolean; hidden: boolean; ancestors: string[] }> {
  const valid = validateContainerOwnership(nodes)
  if (!valid.ok) return valid
  return indexedContainerState(valid.value, id)
}

function indexedContainerState(byId: Map<string, DiagramNode>, id: string): StructureResult<{ locked: boolean; hidden: boolean; ancestors: string[] }> {
  const node = byId.get(id)
  if (!node) return fail('missing-object', `Object ${id} is not on this board.`, id)
  const ancestors: string[] = []
  let locked = Boolean(node.locked), hidden = Boolean(node.hidden), current = node
  while (ownerId(current)) {
    current = byId.get(ownerId(current)!)!
    ancestors.push(current.id); locked ||= Boolean(current.locked); hidden ||= Boolean(current.hidden || current.collapsed)
  }
  return success({ locked, hidden, ancestors })
}

export function diagramState(nodes: readonly DiagramNode[], id: string): StructureResult<{ locked: boolean; hidden: boolean; containerAncestors: string[]; mindMapAncestors: string[] }> {
  const containers = validateContainerOwnership(nodes), trees = validateMindMap(nodes)
  if (!containers.ok) return containers
  if (!trees.ok) return trees
  return indexedDiagramState(containers.value, trees.value, id)
}

function indexedDiagramState(containers: Map<string, DiagramNode>, trees: Map<string, DiagramNode>, id: string): StructureResult<{ locked: boolean; hidden: boolean; containerAncestors: string[]; mindMapAncestors: string[] }> {
  const own = indexedContainerState(containers, id)
  if (!own.ok) return own
  let { locked, hidden } = own.value
  const mindMapAncestors: string[] = []
  let current = containers.get(id)!
  while (current.mindMap?.parentId) {
    current = trees.get(current.mindMap.parentId)!
    const state = indexedContainerState(containers, current.id)
    if (!state.ok) return state
    mindMapAncestors.push(current.id); locked ||= state.value.locked; hidden ||= state.value.hidden || Boolean(current.mindMap?.collapsed)
  }
  return success({ locked, hidden, containerAncestors: own.value.ancestors, mindMapAncestors })
}

function editableSet(nodes: readonly DiagramNode[], ids: readonly string[]): StructureResult<string[]> {
  const expanded = containerDescendantIds(nodes, ids)
  if (!expanded.ok) return expanded
  const valid = validateContainerOwnership(nodes)
  if (!valid.ok) return valid
  const trees = validateMindMap(nodes)
  if (!trees.ok) return trees
  // A hidden child must not move accidentally when a visible owner is moved.
  for (const id of expanded.value) {
    const state = indexedDiagramState(valid.value, trees.value, id)
    if (!state.ok) return state
    if (state.value.locked) return fail('locked-object', 'The object or its container is locked; the whole command was cancelled.', id)
    if (state.value.hidden) return fail('hidden-object', 'The object or its container is hidden/collapsed; the whole command was cancelled.', id)
  }
  return expanded
}

/** Only the topmost requested roots are reparented; their descendants keep their
 * internal ownership. World-space geometry is never laid out implicitly here. */
export function reparentContainerNodes<T extends DiagramNode>(nodes: readonly T[], ids: readonly string[], owner?: ContainerOwner): StructureResult<T[]> {
  const editable = editableSet(nodes, ids)
  if (!editable.ok) return editable
  const valid = validateContainerOwnership(nodes)
  if (!valid.ok) return valid
  const requested = new Set(ids), roots = new Set(ids.filter((id) => {
    let node = valid.value.get(id)!
    while (ownerId(node)) { if (requested.has(ownerId(node)!)) return false; node = valid.value.get(ownerId(node)!)! }
    return true
  }))
  if (owner) {
    const target = valid.value.get(owner.id)
    if (!target) return fail('missing-owner', `Owner ${owner.id} is not on this board.`)
    if (target.kind !== owner.kind) return fail('wrong-owner-kind', 'The requested owner does not have the matching container kind.', owner.id)
    if (editable.value.includes(owner.id)) return fail('ownership-cycle', 'An object cannot be reparented inside its own descendants.', owner.id)
    const state = containerState(nodes, owner.id)
    if (!state.ok) return state
    if (state.value.locked || state.value.hidden) return fail('uneditable-owner', 'The destination container is locked or hidden.', owner.id)
  }
  const existingOrders = owner?.kind === 'column' ? nodes.filter((node) => node.parentColumnId === owner.id && !roots.has(node.id)).map((node) => finite(node.columnOrder!) ? node.columnOrder! : 0) : []
  let nextOrder = existingOrders.length ? Math.max(...existingOrders) + 1 : 0
  const next = nodes.map((node) => {
    if (!roots.has(node.id)) return node
    const moved = { ...node }; delete moved.groupId; delete moved.parentColumnId; delete moved.columnOrder
    if (owner?.kind === 'group') moved.groupId = owner.id
    else if (owner?.kind === 'column') { moved.parentColumnId = owner.id; moved.columnOrder = nextOrder++ }
    return moved
  })
  const checked = validateContainerOwnership(next)
  return checked.ok ? success(next) : checked
}

/** One atomic model command. Routes with both attached endpoints moved, or one
 * moved attachment plus one detached anchor, travel with the subtree. Two-object
 * boundary routes and wholly detached edges stay fixed-world. */
export function moveContainerWithDescendants<T extends DiagramNode, E extends BoardConnector>(nodes: readonly T[], connectors: readonly E[], ids: readonly string[], delta: BoardPoint): StructureResult<{ nodes: T[]; connectors: E[]; movedIds: string[] }> {
  if (!finite(delta.x) || !finite(delta.y)) return fail('invalid-delta', 'Movement must use finite board-space coordinates.')
  const editable = editableSet(nodes, ids)
  if (!editable.ok) return editable
  const moved = new Set(editable.value), edgeIds = new Set<string>(), nodeIds = new Set(nodes.map(node => node.id))
  for (const edge of connectors) {
    if (edgeIds.has(edge.id)) return fail('duplicate-connector', 'Connection identities must be unique.')
    edgeIds.add(edge.id)
    if ((edge.sourceId && !nodeIds.has(edge.sourceId)) || (edge.targetId && !nodeIds.has(edge.targetId))) return fail('missing-endpoint', `Connection ${edge.id} references a missing object.`)
    if (edge.bendPoints?.some((point) => !finite(point.x) || !finite(point.y))) return fail('invalid-route', `Connection ${edge.id} has a non-finite manual waypoint.`)
    for (const point of [edge.sourcePoint, edge.targetPoint]) if (point && (!finite(point.x) || !finite(point.y))) return fail('invalid-endpoint', `Connection ${edge.id} has a non-finite detached anchor.`)
  }
  const shifted = nodes.map((node) => moved.has(node.id) ? { ...node, x: node.x + delta.x, y: node.y + delta.y } : node)
  if (shifted.some((node) => !finite(node.x) || !finite(node.y))) return fail('invalid-geometry', 'A movement would produce non-finite object geometry.')
  const translate = (point: BoardPoint) => ({ ...point, x: point.x + delta.x, y: point.y + delta.y })
  const edges = connectors.map((edge) => {
    const sourceMoved = Boolean(edge.sourceId && moved.has(edge.sourceId)), targetMoved = Boolean(edge.targetId && moved.has(edge.targetId))
    const sourceDetached = !edge.sourceId && Boolean(edge.sourcePoint), targetDetached = !edge.targetId && Boolean(edge.targetPoint)
    const internal = (sourceMoved && targetMoved) || (sourceMoved && targetDetached) || (targetMoved && sourceDetached)
    if (!internal) return edge
    return { ...edge, ...(edge.bendPoints ? { bendPoints: edge.bendPoints.map(translate) } : {}), ...(sourceDetached ? { sourcePoint: translate(edge.sourcePoint!) } : {}), ...(targetDetached ? { targetPoint: translate(edge.targetPoint!) } : {}) }
  })
  if (edges.some((edge) => [...(edge.bendPoints || []), ...(edge.sourcePoint ? [edge.sourcePoint] : []), ...(edge.targetPoint ? [edge.targetPoint] : [])].some((point) => !finite(point.x) || !finite(point.y)))) return fail('invalid-route', 'Movement would produce non-finite route geometry.')
  return success({ nodes: shifted, connectors: edges, movedIds: editable.value })
}

export function validateMindMap(nodes: readonly DiagramNode[], treeId?: string): StructureResult<Map<string, DiagramNode>> {
  const ownership = validateContainerOwnership(nodes)
  if (!ownership.ok) return ownership
  const members = nodes.filter((node) => node.mindMap && (!treeId || node.mindMap.treeId === treeId)), byId = new Map(members.map((node) => [node.id, node])), issues: StructureIssue[] = []
  const roots = new Map<string, string[]>(), siblingOrders = new Set<string>()
  if (treeId && !members.length) return fail('missing-tree', `Mind-map tree ${treeId} is not on this board.`)
  for (const node of members) {
    const data = node.mindMap!
    if (node.kind === 'group' || node.kind === 'column' || node.kind === 'board-link') issues.push({ code: 'invalid-mind-map-kind', nodeId: node.id, detail: 'A mind-map branch is a content object, not a container or board portal.' })
    if (data.version !== 1 || !data.treeId || typeof data.treeId !== 'string' || !Number.isSafeInteger(data.order) || data.order < 0) issues.push({ code: 'invalid-mind-map', nodeId: node.id, detail: 'Mind-map membership needs version 1, a tree ID and a nonnegative integer order.' })
    const orderKey = JSON.stringify([data.treeId, data.parentId || '', data.order])
    if (siblingOrders.has(orderKey)) issues.push({ code: 'duplicate-branch-order', nodeId: node.id, detail: 'Sibling branch orders must be unique.' })
    siblingOrders.add(orderKey)
    if (!data.parentId) { const list = roots.get(data.treeId) || []; list.push(node.id); roots.set(data.treeId, list) }
    else {
      const parent = byId.get(data.parentId)
      if (!parent || parent.mindMap?.treeId !== data.treeId) issues.push({ code: 'missing-mind-map-parent', nodeId: node.id, detail: 'A branch must reference a parent within its own tree.' })
      if (data.parentId === node.id) issues.push({ code: 'mind-map-cycle', nodeId: node.id, detail: 'A branch cannot parent itself.' })
    }
  }
  for (const id of new Set(members.map((node) => node.mindMap!.treeId))) if ((roots.get(id)?.length || 0) !== 1) issues.push({ code: 'mind-map-root-count', detail: `Tree ${id} must have exactly one root.` })
  const complete = new Set<string>()
  for (const node of members) {
    const visiting = new Set<string>(), chain: string[] = []
    let current: DiagramNode | undefined = node
    while (current && !complete.has(current.id)) {
      if (visiting.has(current.id)) { issues.push({ code: 'mind-map-cycle', nodeId: current.id, detail: 'Mind-map parenting contains a cycle.' }); break }
      visiting.add(current.id); chain.push(current.id); current = byId.get(current.mindMap?.parentId || '')
    }
    chain.forEach((id) => complete.add(id))
  }
  return issues.length ? { ok: false, issues } : success(byId)
}

function orderedChildren(nodes: readonly DiagramNode[], parentId: string): DiagramNode[] { return nodes.filter((node) => node.mindMap?.parentId === parentId).sort((a, b) => a.mindMap!.order - b.mindMap!.order || a.id.localeCompare(b.id)) }
export function mindMapBranchIds(nodes: readonly DiagramNode[], id: string): StructureResult<string[]> {
  const node = nodes.find((entry) => entry.id === id)
  if (!node?.mindMap) return fail('missing-branch', 'The requested object is not a mind-map branch.', id)
  const valid = validateMindMap(nodes, node.mindMap.treeId)
  if (!valid.ok) return valid
  const queue = [id]
  for (let index = 0; index < queue.length; index++) queue.push(...orderedChildren([...valid.value.values()], queue[index]).map((child) => child.id))
  return success(queue)
}

/** Derived visibility; no content is removed or recovery records modified. */
export function visibleDiagramNodeIds(nodes: readonly DiagramNode[]): StructureResult<string[]> {
  const containers = validateContainerOwnership(nodes), trees = validateMindMap(nodes)
  if (!containers.ok) return containers
  if (!trees.ok) return trees
  const visible = nodes.filter((node) => {
    const state = indexedDiagramState(containers.value, trees.value, node.id)
    return state.ok && !state.value.hidden
  })
  return success(visible.map((node) => node.id))
}

export type DiagramProjectionState = { locked: boolean; hidden: boolean }

/** Renderer-facing state is derived from the same ownership/tree policy as
 * editing. Validate each graph once for the scene, rather than once per object;
 * callers must fail closed if the imported hierarchy is invalid. */
export function diagramProjectionStates(nodes: readonly DiagramNode[]): StructureResult<Map<string, DiagramProjectionState>> {
  const containers = validateContainerOwnership(nodes), trees = validateMindMap(nodes)
  if (!containers.ok) return containers
  if (!trees.ok) return trees
  const states = new Map<string, DiagramProjectionState>()
  for (const node of nodes) {
    const state = indexedDiagramState(containers.value, trees.value, node.id)
    if (!state.ok) return state
    states.set(node.id, { locked: state.value.locked, hidden: state.value.hidden })
  }
  return success(states)
}

/** Mind-map edges are one persistent identity per child, not regenerated from
 * endpoints during render. Unrelated connectors are retained byte-for-byte. */
export function validateMindMapConnectors(nodes: readonly DiagramNode[], connectors: readonly DiagramConnector[], treeId: string): StructureResult<true> {
  const valid = validateMindMap(nodes, treeId)
  if (!valid.ok) return valid
  const seen = new Set<string>(), edgeIds = new Set<string>(), issues: StructureIssue[] = []
  for (const edge of connectors) {
    if (edgeIds.has(edge.id)) issues.push({ code: 'duplicate-connector', detail: `Connection identity ${edge.id} is duplicated.` })
    edgeIds.add(edge.id)
    if (edge.mindMap?.treeId !== treeId) continue
    const child = valid.value.get(edge.mindMap.childId)
    if (edge.mindMap.version !== 1 || !child?.mindMap?.parentId || edge.targetId !== child.id || edge.sourceId !== child.mindMap.parentId || seen.has(child.id)) issues.push({ code: 'invalid-mind-map-edge', detail: `Connection ${edge.id} does not uniquely match its child branch.` })
    else seen.add(child.id)
  }
  for (const node of valid.value.values()) if (node.mindMap!.parentId && !seen.has(node.id)) issues.push({ code: 'missing-mind-map-edge', nodeId: node.id, detail: 'Every non-root branch needs one stable identity connection.' })
  return issues.length ? { ok: false, issues } : success(true)
}

export function reparentMindMapBranch<T extends DiagramNode, E extends DiagramConnector>(nodes: readonly T[], connectors: readonly E[], id: string, parentId: string, order?: number): StructureResult<{ nodes: T[]; connectors: E[] }> {
  const branch = mindMapBranchIds(nodes, id)
  if (!branch.ok) return branch
  const node = nodes.find((entry) => entry.id === id)!, parent = nodes.find((entry) => entry.id === parentId)
  if (!node.mindMap!.parentId) return fail('root-reparent', 'The tree root cannot be reparented.', id)
  if (!parent?.mindMap || parent.mindMap.treeId !== node.mindMap!.treeId) return fail('cross-tree-reparent', 'Branches can only be reparented within their own tree.', id)
  if (branch.value.includes(parentId)) return fail('mind-map-cycle', 'A branch cannot be reparented inside its descendants.', id)
  const safe = editableSet(nodes, [...branch.value, parentId])
  if (!safe.ok) return safe
  const edges = validateMindMapConnectors(nodes, connectors, node.mindMap!.treeId)
  if (!edges.ok) return edges
  if (order !== undefined && (!Number.isSafeInteger(order) || order < 0)) return fail('invalid-branch-order', 'Branch placement must be a nonnegative integer index.', id)
  const newSiblings = orderedChildren(nodes, parentId).filter((entry) => entry.id !== id)
  newSiblings.splice(Math.min(order ?? newSiblings.length, newSiblings.length), 0, node)
  const orders = new Map(newSiblings.map((entry, index) => [entry.id, index]))
  if (node.mindMap!.parentId !== parentId) orderedChildren(nodes, node.mindMap!.parentId!).filter((entry) => entry.id !== id).forEach((entry, index) => orders.set(entry.id, index))
  const next = nodes.map((entry) => orders.has(entry.id) ? { ...entry, mindMap: { ...entry.mindMap!, order: orders.get(entry.id)!, ...(entry.id === id ? { parentId } : {}) } } : entry)
  const nextEdges = connectors.map((edge) => edge.mindMap?.treeId === node.mindMap!.treeId && edge.mindMap.childId === id ? { ...edge, sourceId: parentId, sourcePoint: undefined } : edge)
  const checked = validateMindMapConnectors(next, nextEdges, node.mindMap!.treeId)
  return checked.ok ? success({ nodes: next, connectors: nextEdges }) : checked
}

/** Deterministic right-growing tree layout. Hidden/collapsed descendants keep
 * their previous coordinates; visible locked objects cancel the whole command. */
export function layoutMindMap<T extends DiagramNode>(nodes: readonly T[], treeId: string, options: { origin?: BoardPoint; horizontalGap?: number; verticalGap?: number } = {}): StructureResult<T[]> {
  const valid = validateMindMap(nodes, treeId)
  if (!valid.ok) return valid
  const visibility = visibleDiagramNodeIds(nodes)
  if (!visibility.ok) return visibility
  const visible = new Set(visibility.value), members = [...valid.value.values()].filter((node) => visible.has(node.id)), root = [...valid.value.values()].find((node) => !node.mindMap!.parentId)!
  const allNodes = new Map(nodes.map((node) => [node.id, node]))
  const hGap = options.horizontalGap ?? 80, vGap = options.verticalGap ?? 24, origin = options.origin || { x: root.x, y: root.y }
  if (!finite(hGap) || hGap < 0 || !finite(vGap) || vGap < 0 || !finite(origin.x) || !finite(origin.y)) return fail('invalid-layout', 'Layout origin and nonnegative spacing must be finite.')
  for (const node of members) {
    const state = indexedDiagramState(allNodes, valid.value, node.id)
    if (!state.ok) return state
    if (state.value.locked) return fail('locked-object', 'A visible branch is locked; the whole layout was cancelled.', node.id)
    if (!finite(node.width) || !finite(node.height) || node.width <= 0 || node.height <= 0) return fail('invalid-geometry', 'Visible branches need positive finite dimensions.', node.id)
  }
  if (!visible.has(root.id)) return success([...nodes])
  const children = new Map(members.map((node) => [node.id, orderedChildren(members, node.id)])), traversal = [root]
  for (let index = 0; index < traversal.length; index++) traversal.push(...children.get(traversal[index].id)!)
  const spans = new Map<string, number>()
  for (const node of [...traversal].reverse()) { const list = children.get(node.id)!; spans.set(node.id, Math.max(node.height, list.reduce((sum, child) => sum + spans.get(child.id)!, 0) + Math.max(0, list.length - 1) * vGap)) }
  const placed = new Map<string, BoardPoint>(), queue = [{ node: root, x: origin.x, top: origin.y + root.height / 2 - spans.get(root.id)! / 2 }]
  for (let index = 0; index < queue.length; index++) {
    const { node, x, top } = queue[index], span = spans.get(node.id)!, list = children.get(node.id)!
    placed.set(node.id, { x, y: top + span / 2 - node.height / 2 })
    const childrenSpan = list.reduce((sum, child) => sum + spans.get(child.id)!, 0) + Math.max(0, list.length - 1) * vGap
    let childTop = top + (span - childrenSpan) / 2
    for (const child of list) { queue.push({ node: child, x: x + node.width + hGap, top: childTop }); childTop += spans.get(child.id)! + vGap }
  }
  if ([...placed.values()].some((point) => !finite(point.x) || !finite(point.y))) return fail('invalid-layout', 'Layout would exceed finite geometry.')
  return success(nodes.map((node) => placed.has(node.id) ? { ...node, ...placed.get(node.id)! } : node))
}

export function createMindMapTemplate(namespace: string, origin: BoardPoint = { x: 0, y: 0 }, existingIds: readonly string[] = []): StructureResult<{ nodes: DiagramNode[]; connectors: DiagramConnector[]; treeId: string }> {
  if (!namespace || typeof namespace !== 'string' || namespace.length > 200) return fail('invalid-namespace', 'Use a fresh nonempty namespace no longer than 200 characters for each template instance.')
  const treeId = `${namespace}:tree`, existing = new Set(existingIds), nodes: DiagramNode[] = [], connectors: DiagramConnector[] = []
  const add = (title: string, parentIndex?: number, order = 0) => {
    const index = nodes.length, id = `${namespace}:node:${index}`
    const parentId = parentIndex === undefined ? undefined : `${namespace}:node:${parentIndex}`
    nodes.push({ id, kind: 'note', title, body: '', x: origin.x, y: origin.y, width: 180, height: 90, color: parentId ? '#405b78' : '#38516d', opacity: 1, mindMap: { version: 1, treeId, ...(parentId ? { parentId } : {}), order } })
    if (parentId) connectors.push({ id: `${namespace}:edge:${index}`, sourceId: parentId, targetId: id, sourcePort: 'right', targetPort: 'left', sourcePortMode: 'adaptive', targetPortMode: 'adaptive', style: 'elbow', color: '#60a5fa', width: 2, dashed: false, startArrow: false, endArrow: false, animated: false, mindMap: { version: 1, treeId, childId: id } })
    return index
  }
  add('Project')
  const branches = ['Research', 'Design', 'Build', 'Review'].map((title, index) => add(title, 0, index))
  const leaves: number[] = []
  for (const parentIndex of branches) for (let order = 0; order < 3; order++) leaves.push(add(['Inputs', 'Work', 'Checks'][order], parentIndex, order))
  leaves.slice(0, 3).forEach((parentIndex) => add('Detail', parentIndex))
  for (const item of [...nodes, ...connectors]) if (existing.has(item.id)) return fail('template-id-collision', `Template identity ${item.id} already exists; generate another namespace.`)
  const laidOut = layoutMindMap(nodes, treeId, { origin })
  return laidOut.ok ? success({ nodes: laidOut.value, connectors, treeId }) : laidOut
}

export function createProcessMapTemplate(namespace: string, origin: BoardPoint = { x: 0, y: 0 }, existingIds: readonly string[] = []): StructureResult<{ nodes: DiagramNode[]; connectors: DiagramConnector[] }> {
  if (!namespace || typeof namespace !== 'string' || namespace.length > 200) return fail('invalid-namespace', 'Use a fresh nonempty namespace no longer than 200 characters for each template instance.')
  const existing = new Set(existingIds)
  const titles = ['Start', 'Collect references', 'Explore ideas', 'Choose direction', 'Plan work', 'Build draft', 'Review', 'Refine', 'Document', 'Finish']
  const nodes: DiagramNode[] = []
  for (let index = 0; index < titles.length; index++) {
    const kind: DiagramShapeKind = index === 0 || index === 9 ? 'terminator' : index === 3 || index === 6 ? 'decision' : index === 8 ? 'document' : 'process'
    const id = `${namespace}:node:${index}`
    if (existing.has(id)) return fail('template-id-collision', `Template identity ${id} already exists; generate another namespace.`)
    const shape = createDiagramShape(kind, id, { x: origin.x + (index % 5) * 240, y: origin.y + Math.floor(index / 5) * 200, width: 180, height: 100 }, titles[index])
    if (!shape.ok) return shape
    nodes.push({ ...shape.value, body: titles[index], diagramShape: kind === 'terminator' ? 'start-end' : kind })
  }
  const connectors: DiagramConnector[] = []
  for (let index = 0; index < nodes.length - 1; index++) {
    const edgeId = `${namespace}:edge:${index}`
    if (existing.has(edgeId)) return fail('template-id-collision', `Template identity ${edgeId} already exists; generate another namespace.`)
    connectors.push({
      id: edgeId,
      sourceId: nodes[index].id,
      targetId: nodes[index + 1].id,
      sourcePort: 'right',
      targetPort: 'left',
      sourcePortMode: 'adaptive',
      targetPortMode: 'adaptive',
      style: 'elbow',
      color: '#60a5fa',
      width: 2,
      dashed: false,
      startArrow: false,
      endArrow: true,
      animated: false,
      ...(index === 3 || index === 6 ? { label: 'Continue' } : {})
    })
  }
  return success({ nodes, connectors })
}

export function createSwimlaneTemplate(namespace: string, origin: BoardPoint = { x: 0, y: 0 }, title = 'Workflow', laneTitles: readonly string[] = ['Research', 'Production', 'Review'], existingIds: readonly string[] = []): StructureResult<{ nodes: DiagramNode[]; connectors: DiagramConnector[] }> {
  if (!namespace || typeof namespace !== 'string' || namespace.length > 200) return fail('invalid-namespace', 'Use a fresh nonempty namespace no longer than 200 characters for each template instance.')
  const existing = new Set(existingIds)
  const trimmedTitle = (title || '').trim()
  const titles = laneTitles && laneTitles.length ? laneTitles : ['Research', 'Production', 'Review']
  if (!trimmedTitle || trimmedTitle.length > 160 || titles.length < 2 || titles.length > 8 || titles.some(t => !t.trim() || t.trim().length > 160)) {
    return fail('invalid-swimlane-spec', 'Name the swimlane and between 2 and 8 lanes, with labels up to 160 characters.')
  }
  const rootId = `${namespace}:frame`
  if (existing.has(rootId)) return fail('template-id-collision', `Template identity ${rootId} already exists; generate another namespace.`)
  const root: DiagramNode = {
    id: rootId,
    kind: 'group',
    containerRole: 'frame',
    diagramRole: 'swimlane',
    title: trimmedTitle,
    x: origin.x,
    y: origin.y,
    width: 960,
    height: 36 + titles.length * 152,
    color: '#405b78'
  }
  const lanes: DiagramNode[] = []
  for (let index = 0; index < titles.length; index++) {
    const laneId = `${namespace}:lane:${index}`
    if (existing.has(laneId)) return fail('template-id-collision', `Template identity ${laneId} already exists; generate another namespace.`)
    lanes.push({
      id: laneId,
      kind: 'group',
      containerRole: 'frame',
      diagramRole: 'lane',
      title: titles[index].trim(),
      groupId: rootId,
      x: origin.x + 18,
      y: origin.y + 48 + index * 152,
      width: 924,
      height: 120,
      color: '#405b78'
    })
  }
  return success({ nodes: [root, ...lanes], connectors: [] })
}

export type DiagramShapeKind = 'process' | 'decision' | 'terminator' | 'document'
/** Original portable geometry; no SVG strings, external libraries or new shape
 * enum values. All four forms remain editable with the current Pen/node tools. */
export function createDiagramShape(kind: DiagramShapeKind, id: string, frame: { x: number; y: number; width: number; height: number }, title?: string): StructureResult<DiagramNode> {
  const { x, y, width: w, height: h } = frame
  if (!id || ![x, y, w, h].every(finite) || w <= 0 || h <= 0) return fail('invalid-shape-frame', 'Diagram shapes require an identity and a finite positive frame.')
  let points: VectorPathPoint[]
  if (kind === 'process') points = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
  else if (kind === 'decision') points = [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }]
  else if (kind === 'terminator') {
    const r = Math.min(w / 2, h / 2), k = .5522847498307936 * r
    points = [{ x: r, y: 0, handleIn: { x: -k, y: 0 } }, { x: w - r, y: 0, handleOut: { x: k, y: 0 } }, { x: w, y: r, handleIn: { x: 0, y: -k } }, { x: w, y: h - r, handleOut: { x: 0, y: k } }, { x: w - r, y: h, handleIn: { x: k, y: 0 } }, { x: r, y: h, handleOut: { x: -k, y: 0 } }, { x: 0, y: h - r, handleIn: { x: 0, y: k } }, { x: 0, y: r, handleOut: { x: 0, y: -k } }]
  } else if (kind === 'document') {
    const r = h * .12
    points = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h - r, handleOut: { x: -w / 6, y: r } }, { x: w / 2, y: h - r, handleIn: { x: w / 6, y: r }, handleOut: { x: -w / 6, y: -r }, handleMode: 'smooth' }, { x: 0, y: h - r, handleIn: { x: w / 6, y: -r } }]
  } else return fail('unsupported-shape', 'Only process, decision, terminator and document shapes are supported.')
  return success({ id, kind: 'shape', ...frame, title: title ?? ({ process: 'Process', decision: 'Decision', terminator: 'Start / End', document: 'Document' })[kind], shapeType: 'path', vectorPath: { version: 1, closed: true, points }, color: '#405b78', strokeColor: '#afc8dc', strokeWidth: 2, opacity: 1, vectorFillRule: 'nonzero', vectorStrokeJoin: 'round', vectorStrokeCap: 'round' })
}

/** A snapshot is plain JSON/structuredClone data. Undo and native persistence
 * belong to the caller; this function does not write a workspace or migrate it. */
export function cloneDiagramSnapshot<T extends DiagramNode, E extends DiagramConnector>(nodes: readonly T[], connectors: readonly E[]): { nodes: T[]; connectors: E[] } { return clone({ nodes: [...nodes], connectors: [...connectors] }) }

export type ContainerPaintOrder = { orderedIds: string[]; zIndexById: Map<string, number> }
const containerPaintLayer = (node: BoardNode) => node.zIndex ?? (node.graphColumn ? 2 : node.kind === 'group' ? 0 : node.kind === 'column' ? 1 : 2)

/** Layers order sibling subtrees, never a child behind its owning container.
 * Ordinals are a render projection; saved zIndex/model order are preserved.
 * Iterative traversal tolerates deeply nested imported ownership trees. */
export function containerPaintOrder(nodes: readonly BoardNode[]): StructureResult<ContainerPaintOrder> {
  const valid = validateContainerOwnership(nodes)
  if (!valid.ok) return valid
  const children = new Map<string | undefined, BoardNode[]>(), index = new Map(nodes.map((node, ordinal) => [node.id, ordinal]))
  for (const node of nodes) {
    if (node.zIndex !== undefined && !Number.isFinite(node.zIndex)) return fail('invalid-layer', 'Object layer values must be finite; paint ordering was cancelled.', node.id)
    const owner = ownerId(node)
    const siblings = children.get(owner) || []
    siblings.push(node); children.set(owner, siblings)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => containerPaintLayer(a) - containerPaintLayer(b) || index.get(a.id)! - index.get(b.id)!)
  const orderedIds: string[] = [], stack = [...(children.get(undefined) || [])].reverse()
  while (stack.length) {
    const node = stack.pop()!
    orderedIds.push(node.id)
    const descendants = children.get(node.id) || []
    for (let cursor = descendants.length - 1; cursor >= 0; cursor--) stack.push(descendants[cursor])
  }
  return success({ orderedIds, zIndexById: new Map(orderedIds.map((id, ordinal) => [id, ordinal])) })
}
