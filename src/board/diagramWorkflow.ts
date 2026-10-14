import type { BoardModel, BoardPoint, DiagramTemplate } from '../model/project'
import { validateBoardMutation } from './boardMutationSafety'
import { containerDescendantIds, containerPaintOrder, createMindMapTemplate, createProcessMapTemplate, createSwimlaneTemplate, diagramState, layoutMindMap, mindMapBranchIds, moveContainerWithDescendants, reparentMindMapBranch, validateContainerOwnership, validateMindMap, validateMindMapConnectors, type DiagramConnector, type DiagramNode, type StructureResult } from './diagramStructureCore'

export type { DiagramTemplate } from '../model/project'
export type DiagramWorkflowResult = { board: BoardModel; selectedIds: string[] }
export type DiagramWorkflowCommand =
  | { kind: 'new-root' | 'starter-map' | 'process-map'; namespace: string; origin: BoardPoint; title?: string }
  | { kind: 'swimlane'; namespace: string; origin: BoardPoint; title: string; laneTitles?: string[] }
  | { kind: 'add-child' | 'add-sibling'; id: string; namespace: string; title: string }
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'collapse'; id: string; collapsed: boolean }
  | { kind: 'reparent'; id: string; parentId: string; order?: number }
  | { kind: 'layout'; id: string }
  | { kind: 'move-branch'; id: string; delta: BoardPoint }
  | { kind: 'visibility'; id: string; hidden: boolean }
  | { kind: 'lock'; id: string; locked: boolean }
  | { kind: 'layer'; id: string; direction: 'front' | 'back' }

const failure = <T = never>(detail: string, code = 'diagram-workflow'): StructureResult<T> => ({ ok: false, issues: [{ code, detail }] })
const success = <T>(value: T): StructureResult<T> => ({ ok: true, value })
const owner = (node: DiagramNode) => node.groupId || node.parentColumnId
const validTitle = (value: string) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 160
const existingIds = (board: BoardModel) => [...board.nodes.map(node => node.id), ...board.connectors.map(edge => edge.id)]
const finitePoint = (point: BoardPoint) => Number.isFinite(point.x) && Number.isFinite(point.y)

/** Complete source-graph validation. The caller still owns the one existing
 * board/history publication; this module never writes disk or maintains Undo. */
export function validateDiagramWorkflowGraph(nodes: readonly DiagramNode[], connectors: readonly DiagramConnector[]): StructureResult<true> {
  const ownership = validateContainerOwnership(nodes), trees = validateMindMap(nodes)
  if (!ownership.ok) return ownership
  if (!trees.ok) return trees
  const ids = new Set(nodes.map(node => node.id)), edges = new Set<string>()
  for (const node of nodes) {
    if (!['column', 'group', 'image', 'video', 'model', 'document', 'note', 'text', 'clip', 'shape', 'board-link'].includes(node.kind) || ![node.x, node.y, node.width, node.height, node.rotation ?? 0].every(Number.isFinite) || node.width <= 0 || node.height <= 0) return failure('Every diagram object needs a supported kind, finite geometry and positive dimensions.')
    const paths = [node.vectorPath, ...(node.vectorBoolean?.operands || []), ...(node.vectorBoolean?.resolvedPaths || [])].filter(path => Boolean(path))
    const invalidPaths = paths.some(path => !path || path.version !== 1 || !Array.isArray(path.points) || path.points.length < (path.closed ? 3 : 2) || path.points.some(point => !finitePoint(point) || point.handleIn && !finitePoint(point.handleIn) || point.handleOut && !finitePoint(point.handleOut)))
    const invalidTransform = node.vectorTransform && Object.values(node.vectorTransform).some(value => !Number.isFinite(value))
    if (invalidPaths || invalidTransform) return failure('A diagram path contains invalid editable geometry.')
  }
  for (const edge of connectors) {
    if (!edge.id || ids.has(edge.id) || edges.has(edge.id) || (edge.sourceId && !ids.has(edge.sourceId)) || (edge.targetId && !ids.has(edge.targetId))) return failure('The diagram has a duplicate identity or a missing connector endpoint.')
    edges.add(edge.id)
    if (!edge.sourceId && !edge.sourcePoint || !edge.targetId && !edge.targetPoint) return failure('Every connection needs two attached or detached endpoints.')
    if ([...(edge.bendPoints || []), ...(edge.sourcePoint ? [edge.sourcePoint] : []), ...(edge.targetPoint ? [edge.targetPoint] : [])].some(point => !finitePoint(point))) return failure('Connection coordinates must be finite.')
    if (edge.mindMap && !nodes.some(node => node.mindMap?.treeId === edge.mindMap?.treeId)) return failure('A mind-map connection references a missing tree.')
  }
  for (const treeId of new Set(nodes.flatMap(node => node.mindMap ? [node.mindMap.treeId] : []))) {
    const valid = validateMindMapConnectors(nodes, connectors, treeId)
    if (!valid.ok) return valid
  }
  return success(true)
}

function publishCandidate(board: BoardModel, nodes: DiagramNode[], connectors: DiagramConnector[], selectedIds: string[], readOnly: boolean): StructureResult<DiagramWorkflowResult> {
  const graph = validateDiagramWorkflowGraph(nodes, connectors)
  if (!graph.ok) return graph
  const checked = validateBoardMutation(board, { ...board, nodes, connectors }, readOnly)
  if (!checked.ok) return checked
  const visibleSelection = [...new Set(selectedIds)].filter(id => { const state = diagramState(nodes, id); return state.ok && !state.value.hidden })
  return success({ board: checked.value, selectedIds: visibleSelection })
}

const edgeBetween = (id: string, sourceId: string, targetId: string): DiagramConnector => ({ id, sourceId, targetId, sourcePort: 'right', targetPort: 'left', sourcePortMode: 'adaptive', targetPortMode: 'adaptive', style: 'elbow', color: '#60a5fa', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false })
function validNamespace(board: BoardModel, namespace: string, origin?: BoardPoint): StructureResult<true> {
  if (typeof namespace !== 'string' || !namespace || namespace.length > 200 || origin && !finitePoint(origin)) return failure('Use a fresh nonempty identity and finite placement coordinates.')
  if (existingIds(board).some(id => id.startsWith(`${namespace}:`))) return failure('This instance identity already exists; insert again with a fresh identity.')
  return success(true)
}

/** All returned object/edge changes are one candidate board. Rejection leaves
 * every input reference/record intact, including unknown metadata. */
export function runDiagramWorkflow(board: BoardModel, command: DiagramWorkflowCommand, readOnly = false): StructureResult<DiagramWorkflowResult> {
  if (readOnly) return failure('This workspace is read-only.')
  const graph = validateDiagramWorkflowGraph(board.nodes, board.connectors)
  if (!graph.ok) return graph
  if ('namespace' in command) { const fresh = validNamespace(board, command.namespace, 'origin' in command ? command.origin : undefined); if (!fresh.ok) return fresh }
  const nodes: DiagramNode[] = [...board.nodes], connectors: DiagramConnector[] = [...board.connectors]
  if (command.kind === 'starter-map') {
    const created = createMindMapTemplate(command.namespace, command.origin, existingIds(board))
    if (!created.ok) return created
    return publishCandidate(board, [...nodes, ...created.value.nodes], [...connectors, ...created.value.connectors], [created.value.nodes[0].id], readOnly)
  }
  if (command.kind === 'new-root') {
    const title = command.title?.trim() || 'Root idea'
    if (!validTitle(title)) return failure('Use a nonempty label of at most 160 characters.')
    const id = `${command.namespace}:node:0`, treeId = `${command.namespace}:tree`
    nodes.push({ id, kind: 'note', title, body: '', ...command.origin, width: 180, height: 90, color: '#405b78', mindMap: { version: 1, treeId, order: 0 } })
    return publishCandidate(board, nodes, connectors, [id], readOnly)
  }
  if (command.kind === 'process-map') {
    const created = createProcessMapTemplate(command.namespace, command.origin, existingIds(board))
    if (!created.ok) return created
    return publishCandidate(board, [...nodes, ...created.value.nodes], [...connectors, ...created.value.connectors], created.value.nodes.map(node => node.id), readOnly)
  }
  if (command.kind === 'swimlane') {
    const created = createSwimlaneTemplate(command.namespace, command.origin, command.title, command.laneTitles, existingIds(board))
    if (!created.ok) return created
    return publishCandidate(board, [...nodes, ...created.value.nodes], connectors, [created.value.nodes[0].id], readOnly)
  }
  if (!('id' in command)) return failure('Unsupported diagram creation command.')
  const node = board.nodes.find(node => node.id === command.id) as DiagramNode | undefined
  if (!node) return failure('The selected diagram object is no longer on this board.')
  if (command.kind === 'add-child' || command.kind === 'add-sibling') {
    if (!node.mindMap || !validTitle(command.title)) return failure('Select a mind-map branch and enter a nonempty label of at most 160 characters.')
    const parent = command.kind === 'add-child' ? node : nodes.find(entry => entry.id === node.mindMap!.parentId)
    if (!parent?.mindMap) return failure('The tree root has no sibling. Add a child or create another root.')
    const state = diagramState(nodes, parent.id)
    if (!state.ok) return state
    if (state.value.locked || state.value.hidden || parent.mindMap.collapsed || parent.collapsed) return failure('Expand and unlock the destination branch before adding content.')
    const siblings = nodes.filter(entry => entry.mindMap?.parentId === parent.id)
    const id = `${command.namespace}:node:0`, order = siblings.length ? Math.max(...siblings.map(entry => entry.mindMap!.order)) + 1 : 0
    nodes.push({ id, kind: 'note', title: command.title.trim(), body: '', x: parent.x + parent.width + 80, y: siblings.length ? Math.max(...siblings.map(entry => entry.y + entry.height)) + 24 : parent.y, width: 180, height: 90, color: '#405b78', ...(parent.groupId ? { groupId: parent.groupId } : {}), ...(parent.parentColumnId ? { parentColumnId: parent.parentColumnId, columnOrder: Math.max(-1, ...nodes.filter(entry => entry.parentColumnId === parent.parentColumnId).map(entry => entry.columnOrder ?? 0)) + 1 } : {}), mindMap: { version: 1, treeId: parent.mindMap.treeId, parentId: parent.id, order } })
    connectors.push({ ...edgeBetween(`${command.namespace}:edge:0`, parent.id, id), endArrow: false, mindMap: { version: 1, treeId: parent.mindMap.treeId, childId: id } })
    return publishCandidate(board, nodes, connectors, [id], readOnly)
  }
  if (command.kind === 'reparent') {
    const result = reparentMindMapBranch(nodes, connectors, node.id, command.parentId, command.order)
    return result.ok ? publishCandidate(board, result.value.nodes, result.value.connectors, [node.id], readOnly) : result
  }
  if (command.kind === 'move-branch') {
    const branch = mindMapBranchIds(nodes, node.id)
    if (!branch.ok) return branch
    const moved = moveContainerWithDescendants(nodes, connectors, branch.value, command.delta)
    return moved.ok ? publishCandidate(board, moved.value.nodes, moved.value.connectors, [node.id], readOnly) : moved
  }
  if (command.kind === 'layout') {
    if (!node.mindMap) return failure('Select a mind-map branch to arrange its tree.')
    const laidOut = layoutMindMap(nodes, node.mindMap.treeId)
    return laidOut.ok ? publishCandidate(board, laidOut.value, connectors, [node.id], readOnly) : laidOut
  }
  let updated: DiagramNode
  if (command.kind === 'rename') {
    if (!validTitle(command.title)) return failure('Use a nonempty label of at most 160 characters.')
    updated = { ...node, title: command.title.trim(), ...(node.diagramShape ? { body: command.title.trim() } : {}) }
  } else if (command.kind === 'collapse') {
    if (node.mindMap) updated = { ...node, mindMap: { ...node.mindMap, collapsed: command.collapsed } }
    else if (node.kind === 'group' || node.kind === 'column') updated = { ...node, collapsed: command.collapsed }
    else return failure('Only mind-map branches and containers can collapse.')
  } else if (command.kind === 'visibility') updated = { ...node, hidden: command.hidden }
  else if (command.kind === 'lock') updated = { ...node, locked: command.locked }
  else if (command.kind === 'layer') {
    const state = diagramState(nodes, node.id)
    if (!state.ok) return state
    if (state.value.locked || state.value.hidden) return failure('Show and unlock the object before changing its layer.')
    const siblings = nodes.filter(entry => owner(entry) === owner(node)), layers = siblings.map(entry => entry.zIndex ?? (entry.kind === 'group' ? 0 : entry.kind === 'column' ? 1 : 2))
    const zIndex = command.direction === 'front' ? Math.max(...layers) + 1 : Math.min(...layers) - 1
    if (!Number.isFinite(zIndex) || layers.includes(zIndex)) return failure('The current layer values cannot be reordered safely.')
    updated = { ...node, zIndex }
  } else return failure('Unsupported diagram command.')
  return publishCandidate(board, nodes.map(entry => entry.id === node.id ? updated : entry), connectors, [node.id], readOnly)
}

export function captureDiagramTemplate(board: BoardModel, selectedIds: readonly string[], id: string, title: string): StructureResult<DiagramTemplate> {
  if (!id || !validTitle(title) || !selectedIds.length) return failure('Select diagram objects and give the template a name of at most 160 characters.')
  const valid = validateDiagramWorkflowGraph(board.nodes, board.connectors)
  if (!valid.ok) return valid
  const selected = new Set(selectedIds)
  for (const selectedId of selected) if (!board.nodes.some(node => node.id === selectedId)) return failure('A selected template object is no longer on this board.')
  // Capture complete owned regions and branches, repeatedly until both graphs
  // reach a fixed point. Board portals stay outside diagram reuse.
  let size = -1
  while (size !== selected.size) {
    size = selected.size
    const descendants = containerDescendantIds(board.nodes, [...selected])
    if (!descendants.ok) return descendants
    descendants.value.forEach(value => selected.add(value))
    for (const node of board.nodes) if (selected.has(node.id) && node.mindMap) {
      const branch = mindMapBranchIds(board.nodes, node.id)
      if (!branch.ok) return branch
      branch.value.forEach(value => selected.add(value))
    }
  }
  const picked = board.nodes.filter(node => selected.has(node.id)) as DiagramNode[]
  if (picked.some(node => node.kind === 'board-link')) return failure('Board portals are not diagram templates. Select diagram content without board links.')
  const left = Math.min(...picked.map(node => node.x)), top = Math.min(...picked.map(node => node.y))
  const nodes = structuredClone(picked).map(node => {
    const next = { ...node, x: node.x - left, y: node.y - top }
    if (next.groupId && !selected.has(next.groupId)) delete next.groupId
    if (next.parentColumnId && !selected.has(next.parentColumnId)) { delete next.parentColumnId; delete next.columnOrder }
    if (next.mindMap?.parentId && !selected.has(next.mindMap.parentId)) next.mindMap = { ...next.mindMap, parentId: undefined, order: 0 }
    return next
  })
  // Separate disconnected captured branches into independent valid trees.
  const treeOf = new Map<string, string>()
  let treeIndex = 0
  for (const root of nodes.filter(node => node.mindMap && !node.mindMap.parentId)) {
    const treeId = `${id}:captured-tree:${treeIndex++}`, queue = [root.id]
    for (let index = 0; index < queue.length; index++) { treeOf.set(queue[index], treeId); queue.push(...nodes.filter(node => node.mindMap?.parentId === queue[index]).map(node => node.id)) }
  }
  nodes.forEach(node => { if (node.mindMap) node.mindMap = { ...node.mindMap, treeId: treeOf.get(node.id)! } })
  const translate = (point: BoardPoint) => ({ ...point, x: point.x - left, y: point.y - top })
  const connectors = structuredClone(board.connectors.filter(edge => (edge.sourceId ? selected.has(edge.sourceId) : true) && (edge.targetId ? selected.has(edge.targetId) : true) && Boolean(edge.sourceId && selected.has(edge.sourceId) || edge.targetId && selected.has(edge.targetId)))) as DiagramConnector[]
  for (const edge of connectors) {
    if (edge.sourcePoint) edge.sourcePoint = translate(edge.sourcePoint)
    if (edge.targetPoint) edge.targetPoint = translate(edge.targetPoint)
    if (edge.bendPoints) edge.bendPoints = edge.bendPoints.map(translate)
    if (edge.mindMap) edge.mindMap = { ...edge.mindMap, treeId: treeOf.get(edge.mindMap.childId)! }
  }
  const checked = validateDiagramWorkflowGraph(nodes, connectors)
  return checked.ok ? success({ version: 1, id, title: title.trim(), nodes, connectors }) : checked
}

export function validateDiagramTemplate(value: unknown): value is DiagramTemplate {
  if (!value || typeof value !== 'object') return false
  const template = value as DiagramTemplate
  if (template.version !== 1 || typeof template.id !== 'string' || !template.id || !validTitle(template.title) || !Array.isArray(template.nodes) || !template.nodes.length || template.nodes.length > 5000 || !Array.isArray(template.connectors) || template.nodes.some(node => !node || node.kind === 'board-link') || template.connectors.some(edge => !edge)) return false
  try { return validateDiagramWorkflowGraph(template.nodes, template.connectors).ok } catch { return false }
}

export function instantiateDiagramTemplate(board: BoardModel, template: DiagramTemplate, namespace: string, origin: BoardPoint, readOnly = false): StructureResult<DiagramWorkflowResult> {
  if (!validateDiagramTemplate(template)) return failure('The saved template is invalid or unsupported; the board was left unchanged.')
  const fresh = validNamespace(board, namespace, origin)
  if (!fresh.ok) return fresh
  const ids = new Map(template.nodes.map((node, index) => [node.id, `${namespace}:node:${index}`])), trees = new Map([...new Set(template.nodes.flatMap(node => node.mindMap ? [node.mindMap.treeId] : []))].map((treeId, index) => [treeId, `${namespace}:tree:${index}`]))
  const translate = (point: BoardPoint) => ({ ...point, x: point.x + origin.x, y: point.y + origin.y })
  const nodes = structuredClone(template.nodes).map(node => ({ ...node, ...translate(node), id: ids.get(node.id)!, ...(node.groupId ? { groupId: ids.get(node.groupId)! } : {}), ...(node.parentColumnId ? { parentColumnId: ids.get(node.parentColumnId)! } : {}), ...(node.mindMap ? { mindMap: { ...node.mindMap, treeId: trees.get(node.mindMap.treeId)!, ...(node.mindMap.parentId ? { parentId: ids.get(node.mindMap.parentId)! } : {}) } } : {}) }))
  const connectors = structuredClone(template.connectors).map((edge, index) => ({ ...edge, id: `${namespace}:edge:${index}`, ...(edge.sourceId ? { sourceId: ids.get(edge.sourceId)! } : {}), ...(edge.targetId ? { targetId: ids.get(edge.targetId)! } : {}), ...(edge.sourcePoint ? { sourcePoint: translate(edge.sourcePoint) } : {}), ...(edge.targetPoint ? { targetPoint: translate(edge.targetPoint) } : {}), ...(edge.bendPoints ? { bendPoints: edge.bendPoints.map(translate) } : {}), ...(edge.mindMap ? { mindMap: { ...edge.mindMap, treeId: trees.get(edge.mindMap.treeId)!, childId: ids.get(edge.mindMap.childId)! } } : {}) }))
  return publishCandidate(board, [...board.nodes, ...nodes], [...board.connectors, ...connectors], nodes.filter(node => !owner(node) && !node.mindMap?.parentId).map(node => node.id), readOnly)
}

export function diagramObjectRows(nodes: readonly DiagramNode[]): StructureResult<{ node: DiagramNode; depth: number; locked: boolean; hidden: boolean; inheritedLock: boolean; inheritedHidden: boolean }[]> {
  const order = containerPaintOrder(nodes)
  if (!order.ok) return order
  const byId = new Map(nodes.map(node => [node.id, node])), rows = []
  for (const id of order.value.orderedIds) {
    const node = byId.get(id)!, state = diagramState(nodes, id)
    if (!state.ok) return state
    const withoutOwn = diagramState(nodes.map(entry => entry.id === id ? { ...entry, locked: false, hidden: false } : entry), id)
    if (!withoutOwn.ok) return withoutOwn
    rows.push({ node, depth: state.value.containerAncestors.length + state.value.mindMapAncestors.length, locked: state.value.locked, hidden: state.value.hidden, inheritedLock: withoutOwn.value.locked, inheritedHidden: withoutOwn.value.hidden })
  }
  return success(rows)
}

