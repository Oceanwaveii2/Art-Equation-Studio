import type { BoardConnector, BoardNode, BoardPoint, ProjectModel } from '../model/project'
import { containerDescendantIds, diagramProjectionStates, mindMapBranchIds, type StructureResult } from './diagramStructureCore'
import { validateBoardMutation } from './boardMutationSafety'
import { canReparentBoard } from './boardHierarchy'
import { connectorGeometry } from './connectors'
import { layoutBoardColumnsForNodesResult } from './columns'

type TransferResult = { project: ProjectModel; movedIds: string[]; transportedConnectorIds: string[]; detachedConnectorIds: string[] }
const fail = (detail: string): StructureResult<TransferResult> => ({ ok: false, issues: [{ code: 'unsafe-board-transfer', detail }] })

/** Atomic placement/ownership transaction; no filesystem operations.
 * Internal edges travel; boundary edges retain a visible detached source anchor. */
export function transferBoardSelection(project: ProjectModel, sourceId: string, destinationId: string, requestedIds: readonly string[], options: { readOnly?: boolean; position?: BoardPoint } = {}): StructureResult<TransferResult> {
  if (options.readOnly) return fail('This workspace is read-only.')
  if (sourceId === destinationId) return fail('Choose a different destination board.')
  const source = project.boards.find((board) => board.id === sourceId), destination = project.boards.find((board) => board.id === destinationId)
  if (!source || !destination || !requestedIds.length) return fail('Choose existing objects and a destination board.')
  const initial = containerDescendantIds(source.nodes, requestedIds)
  if (!initial.ok) return initial
  const branches = new Set(initial.value)
  for (const id of initial.value) {
    const node = source.nodes.find((entry) => entry.id === id)!
    if (!node.mindMap) continue
    const root = source.nodes.find((entry) => entry.mindMap?.treeId === node.mindMap!.treeId && !entry.mindMap.parentId)
    if (!root || !branches.has(root.id)) return fail('Move the mind-map root to move its complete tree; individual branches stay on their board.')
    const branch = mindMapBranchIds(source.nodes, root.id)
    if (!branch.ok) return branch
    branch.value.forEach((child) => branches.add(child))
  }
  const expanded = containerDescendantIds(source.nodes, [...branches])
  if (!expanded.ok) return expanded
  const moved = new Set(expanded.value), states = diagramProjectionStates(source.nodes)
  if (source.nodes.some(node => node.graphColumn?.inputs.some(input => moved.has(node.id) !== moved.has(input.sourceId)))) return fail('Move the connected graph and its sources together, or disconnect its inputs first. Graph data references stay on one board.')
  if (!states.ok) return states
  for (const id of moved) {
    const state = states.value.get(id)!
    if (state.locked || state.hidden) return fail('A selected object or owner is locked, hidden or collapsed; nothing was moved.')
  }
  for (const node of source.nodes.filter((entry) => moved.has(entry.id) && entry.mindMap)) if (source.nodes.some((entry) => entry.mindMap?.treeId === node.mindMap!.treeId && !moved.has(entry.id))) return fail('Move a complete mind-map tree; partial trees cannot cross boards.')
  const incoming = source.nodes.filter((entry) => moved.has(entry.id))
  if (incoming.some((node) => destination.nodes.some((entry) => entry.id === node.id))) return fail('The destination has a conflicting object identity; nothing was overwritten.')
  if (incoming.some((node) => node.mindMap && destination.nodes.some((entry) => entry.mindMap?.treeId === node.mindMap!.treeId))) return fail('The destination has a conflicting mind-map identity.')
  const parents = new Map<string, string>()
  for (const node of incoming) if (node.kind === 'board-link' && node.boardLinkRole === 'child') {
    const child = project.boards.find((board) => board.id === node.targetBoardId)
    if (!child || child.parentBoardId !== sourceId) return fail('The owning portal does not match its board parent; repair that identity before moving it.')
    const owners = project.boards.flatMap((board) => board.nodes).filter((entry) => entry.kind === 'board-link' && entry.boardLinkRole === 'child' && entry.targetBoardId === child.id)
    if (owners.length !== 1 || !canReparentBoard(project.boards, child.id, destinationId)) return fail('This destination would duplicate ownership or create a board cycle.')
    parents.set(child.id, destinationId)
  }
  const left = Math.min(...incoming.map((node) => node.x)), top = Math.min(...incoming.map((node) => node.y))
  const delta = options.position ? { x: options.position.x - left, y: options.position.y - top } : { x: 0, y: 0 }
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return fail('The destination position must be finite.')
  const translate = (point: BoardPoint) => ({ ...point, x: point.x + delta.x, y: point.y + delta.y })
  const nodes = incoming.map((node) => {
    const next: BoardNode = { ...node, x: node.x + delta.x, y: node.y + delta.y }
    if (node.groupId && !moved.has(node.groupId)) delete next.groupId
    if (node.parentColumnId && !moved.has(node.parentColumnId)) { delete next.parentColumnId; delete next.columnOrder; delete next.freeWidth; delete next.freeHeight }
    return next
  })
  const travelling: BoardConnector[] = [], remaining: BoardConnector[] = [], detached: string[] = []
  for (const edge of source.connectors) {
    const sourceMoved = Boolean(edge.sourceId && moved.has(edge.sourceId)), targetMoved = Boolean(edge.targetId && moved.has(edge.targetId))
    const sourceFree = !edge.sourceId && Boolean(edge.sourcePoint), targetFree = !edge.targetId && Boolean(edge.targetPoint)
    if ((sourceMoved && targetMoved) || (sourceMoved && targetFree) || (targetMoved && sourceFree)) travelling.push({ ...edge, ...(edge.bendPoints ? { bendPoints: edge.bendPoints.map(translate) } : {}), ...(edge.sourcePoint ? { sourcePoint: translate(edge.sourcePoint) } : {}), ...(edge.targetPoint ? { targetPoint: translate(edge.targetPoint) } : {}) })
    else if (sourceMoved || targetMoved) {
      const geometry = connectorGeometry(edge, source.nodes)
      if (!geometry) return fail('A boundary connection could not be resolved; nothing was moved.')
      remaining.push({ ...edge, ...(sourceMoved ? { sourceId: undefined, sourcePoint: { ...geometry.source } } : {}), ...(targetMoved ? { targetId: undefined, targetPoint: { ...geometry.target } } : {}) })
      detached.push(edge.id)
    } else remaining.push(edge)
  }
  if (travelling.some((edge) => destination.connectors.some((entry) => entry.id === edge.id))) return fail('The destination has a conflicting connection identity; nothing was overwritten.')
  const sourceColumns = [...new Set(incoming.flatMap((node) => node.parentColumnId && !moved.has(node.parentColumnId) ? [node.parentColumnId] : []))]
  // Newly detached boundary anchors describe where the removed objects were.
  // They stay in world space while remaining rows tighten their source column.
  const detachedIds = new Set(detached)
  const sourceLayout = layoutBoardColumnsForNodesResult({ ...source, nodes: source.nodes.filter((node) => !moved.has(node.id)), connectors: remaining.filter((edge) => !detachedIds.has(edge.id)) }, sourceColumns)
  if (!sourceLayout.ok) return sourceLayout
  const laidOutEdges = new Map(sourceLayout.value.connectors.map((edge) => [edge.id, edge]))
  const nextSource = { ...sourceLayout.value, connectors: remaining.map((edge) => laidOutEdges.get(edge.id) || edge) }
  const nextDestination = { ...destination, nodes: [...destination.nodes, ...nodes], connectors: [...destination.connectors, ...travelling] }
  for (const [before, after] of [[source, nextSource], [destination, nextDestination]]) { const checked = validateBoardMutation(before, after); if (!checked.ok) return checked }
  const boards = project.boards.map((board) => { const updated = board.id === sourceId ? nextSource : board.id === destinationId ? nextDestination : board; return parents.has(board.id) ? { ...updated, parentBoardId: parents.get(board.id)! } : updated })
  return { ok: true, value: { project: { ...project, boards }, movedIds: incoming.map((node) => node.id), transportedConnectorIds: travelling.map((edge) => edge.id), detachedConnectorIds: detached } }
}
