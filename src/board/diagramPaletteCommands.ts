import type { BoardConnector, BoardModel, BoardNode, BoardPoint, ConnectorPort } from '../model/project'
import { createDiagramShape, diagramProjectionStates, type DiagramShapeKind, type StructureResult } from './diagramStructureCore'
import { validateBoardMutation } from './boardMutationSafety'
import { columnChildren, insertNodesIntoColumnResult } from './columns'
import { connectorGeometry, connectorLabelPoint, nearestPort, pointAlongRoute, portPoint, projectConnectorLabelPosition, type ConnectorGeometry } from './connectors'

export type DiagramShapeId = 'process' | 'decision' | 'start-end' | 'document' | 'text' | 'line' | 'arrow'
export const DIAGRAM_SHAPE_CATALOG: readonly { id: DiagramShapeId; label: string; description: string; keywords: string; width: number; height: number }[] = [
  { id: 'process', label: 'Process', description: 'A step or activity', keywords: 'rectangle task action flow', width: 160, height: 96 },
  { id: 'decision', label: 'Decision', description: 'A question or branch', keywords: 'diamond condition choice flow', width: 160, height: 120 },
  { id: 'start-end', label: 'Start / End', description: 'The beginning or end of a flow', keywords: 'terminator capsule rounded flow', width: 160, height: 72 },
  { id: 'document', label: 'Document', description: 'A document or output', keywords: 'paper report file flow', width: 160, height: 112 },
  { id: 'text', label: 'Text', description: 'A free text label', keywords: 'label caption annotation', width: 180, height: 64 },
  { id: 'line', label: 'Line', description: 'An editable line', keywords: 'stroke straight', width: 160, height: 24 },
  { id: 'arrow', label: 'Arrow', description: 'An editable arrow shape', keywords: 'direction pointer straight', width: 160, height: 24 },
]
export const filterDiagramShapes = (query: string) => {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return DIAGRAM_SHAPE_CATALOG.filter((shape) => words.every((word) => `${shape.label} ${shape.description} ${shape.keywords}`.toLocaleLowerCase().includes(word)))
}
export type DiagramNodeRequest = { shape: DiagramShapeId; id: string; center: BoardPoint; title?: string; width?: number; height?: number; color?: string; strokeColor?: string; textColor?: string }
export type DiagramCommand = { board: BoardModel; nodeId: string; connectorIds: string[] }
export type DiagramCommandResult = StructureResult<DiagramCommand>
export type DiagramCommandOptions = { readOnly?: boolean; ownerId?: string | null }
export type DiagramConnectorStyle = Partial<Pick<BoardConnector, 'style' | 'color' | 'width' | 'dashed' | 'linePattern' | 'startArrow' | 'endArrow' | 'animated' | 'label' | 'labelPosition' | 'relationshipStyle' | 'sourcePortMode' | 'targetPortMode'>>
export type ConnectedSuccessorRequest = { sourceId: string; node: Omit<DiagramNodeRequest, 'center'> & { center?: BoardPoint }; connectorId: string; direction?: ConnectorPort; gap?: number; connector?: DiagramConnectorStyle }
export type InsertDiagramNodeRequest = { connectorId: string; node: Omit<DiagramNodeRequest, 'center'> & { center?: BoardPoint }; downstreamConnectorId: string; fraction?: number }
const success = <T,>(value: T): StructureResult<T> => ({ ok: true, value })
const refuse = (code: string, detail: string, nodeId?: string): { ok: false; issues: { code: string; detail: string; nodeId?: string }[] } => ({ ok: false, issues: [{ code, detail, ...(nodeId ? { nodeId } : {}) }] })
const pointIsFinite = (point: BoardPoint | undefined): point is BoardPoint => Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y))
const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Shared core geometry, with no new shape enum or SVG string in saved data. */
export function diagramShapeNode(request: DiagramNodeRequest): StructureResult<BoardNode> {
  const shape = DIAGRAM_SHAPE_CATALOG.find((entry) => entry.id === request.shape)
  if (!shape) return refuse('unsupported-diagram-shape', 'Choose one of the labeled diagram shapes.')
  const width = request.width ?? shape.width, height = request.height ?? shape.height, title = request.title ?? shape.label
  if (typeof request.id !== 'string' || !request.id.trim() || !pointIsFinite(request.center) || ![width, height].every((value) => Number.isFinite(value) && value > 0) || typeof title !== 'string') return refuse('invalid-diagram-node', 'Use a fresh identity, a finite position and positive finite dimensions.')
  if ([request.color, request.strokeColor, request.textColor].some((value) => value !== undefined && (typeof value !== 'string' || !value.trim()))) return refuse('invalid-diagram-appearance', 'Use nonempty color values for the diagram appearance.')
  const appearance = { ...(request.color ? { color: request.color } : {}), ...(request.strokeColor ? { strokeColor: request.strokeColor } : {}), ...(request.textColor ? { textColor: request.textColor } : {}) }
  const frame = { x: request.center.x - width / 2, y: request.center.y - height / 2, width, height }
  if (request.shape === 'text') return success({ id: request.id, kind: 'text', ...frame, title, body: `<p>${escaped(title)}</p>`, textColor: '#e7eef5', opacity: 1, ...appearance })
  if (request.shape === 'line' || request.shape === 'arrow') return success({ id: request.id, kind: 'shape', shapeType: request.shape, ...frame, title, body: '', color: 'transparent', strokeColor: '#afc8dc', strokeWidth: 2, opacity: 1, ...(request.shape === 'arrow' ? { arrowMotion: { enabled: false, speed: 'normal', direction: 'forward', style: 'flow' } as const } : {}), ...appearance })
  const kind: DiagramShapeKind = request.shape === 'start-end' ? 'terminator' : request.shape
  const created = createDiagramShape(kind, request.id, frame, title)
  return created.ok ? success({ ...created.value, body: title, diagramShape: request.shape as 'process' | 'decision' | 'start-end' | 'document', ...appearance }) : created
}

function checkedBoard(board: BoardModel, readOnly = false) {
  if (readOnly) return refuse('readonly-diagram', 'This workspace is read-only; no diagram objects were created.')
  const states = diagramProjectionStates(board.nodes)
  if (!states.ok) return states
  // Check the existing snapshot as new content, including dangling/duplicate edges.
  const valid = validateBoardMutation({ ...board, nodes: [], connectors: [] }, board)
  return valid.ok ? states : valid
}
function freshIdentity(board: BoardModel, ids: readonly string[]) {
  const existing = new Set([...board.nodes, ...board.connectors].map((entry) => entry.id))
  return ids.some((id) => typeof id !== 'string' || !id.trim() || existing.has(id)) || new Set(ids).size !== ids.length
    ? refuse('diagram-id-collision', 'Use a fresh identity for every new object and connection; existing objects were retained.') : success(true)
}
function putNode(board: BoardModel, node: BoardNode, ownerId?: string | null, index?: number): StructureResult<BoardModel> {
  if (!ownerId) return success({ ...board, nodes: [...board.nodes, node] })
  const owner = board.nodes.find((entry) => entry.id === ownerId)
  if (!owner || (owner.kind !== 'column' && owner.kind !== 'group')) return refuse('invalid-diagram-owner', 'Choose an existing group, frame or column as the owner.', ownerId)
  const states = diagramProjectionStates(board.nodes)
  if (!states.ok) return states
  if (states.value.get(ownerId)?.locked || states.value.get(ownerId)?.hidden || owner.collapsed) return refuse('uneditable-diagram-owner', 'The destination or its owner is locked, hidden or collapsed.', ownerId)
  if (owner.kind === 'group') return success({ ...board, nodes: [...board.nodes, { ...node, groupId: owner.id }] })
  return insertNodesIntoColumnResult({ ...board, nodes: [...board.nodes, node] }, [node.id], { columnId: owner.id, index: index ?? columnChildren(board, owner.id).length })
}
function finish(before: BoardModel, after: BoardModel, nodeId: string, connectorIds: string[], readOnly = false): DiagramCommandResult {
  const checked = validateBoardMutation(before, after, readOnly)
  return checked.ok ? success({ board: checked.value, nodeId, connectorIds }) : checked
}
export function createDiagramNodeResult(board: BoardModel, request: DiagramNodeRequest, options: DiagramCommandOptions = {}): DiagramCommandResult {
  const checked = checkedBoard(board, options.readOnly), fresh = freshIdentity(board, [request.id])
  if (!checked.ok) return checked
  if (!fresh.ok) return fresh
  const created = diagramShapeNode(request)
  if (!created.ok) return created
  const placed = putNode(board, created.value, options.ownerId)
  return placed.ok ? finish(board, placed.value, request.id, [], options.readOnly) : placed
}

function clearFrame(board: BoardModel, node: BoardNode, direction: ConnectorPort): BoardPoint | null {
  const horizontal = direction === 'left' || direction === 'right'
  for (let index = 0; index < 100; index++) {
    const offset = index ? Math.ceil(index / 2) * (index % 2 ? 1 : -1) : 0
    const candidate = { ...node, x: node.x + (horizontal ? 0 : offset * (node.width + 24)), y: node.y + (horizontal ? offset * (node.height + 24) : 0) }
    if (!board.nodes.some((entry) => entry.kind !== 'group' && entry.kind !== 'column' && candidate.x < entry.x + entry.width + 12 && candidate.x + candidate.width + 12 > entry.x && candidate.y < entry.y + entry.height + 12 && candidate.y + candidate.height + 12 > entry.y)) return { x: candidate.x + candidate.width / 2, y: candidate.y + candidate.height / 2 }
  }
  return null
}
export function createConnectedSuccessorResult(board: BoardModel, request: ConnectedSuccessorRequest, options: DiagramCommandOptions = {}): DiagramCommandResult {
  const checked = checkedBoard(board, options.readOnly), fresh = freshIdentity(board, [request.node.id, request.connectorId])
  if (!checked.ok) return checked
  if (!fresh.ok) return fresh
  const source = board.nodes.find((entry) => entry.id === request.sourceId), state = checked.value.get(request.sourceId)
  if (!source || !state) return refuse('missing-diagram-source', 'Select an existing object to create its connected successor.')
  if (state.locked || state.hidden) return refuse('uneditable-diagram-source', 'The source or its owner is locked, hidden or collapsed.', source.id)
  const direction = request.direction ?? 'right', gap = request.gap ?? 80
  if (!['top', 'right', 'bottom', 'left'].includes(direction) || !Number.isFinite(gap) || gap < 0) return refuse('invalid-successor-placement', 'Choose a connection side and finite nonnegative spacing.')
  const sample = diagramShapeNode({ ...request.node, center: request.node.center ?? { x: 0, y: 0 } })
  if (!sample.ok) return sample
  const port = portPoint(source, direction), sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 }, length = Math.hypot(port.x - sourceCenter.x, port.y - sourceCenter.y)
  const nx = (port.x - sourceCenter.x) / length, ny = (port.y - sourceCenter.y) / length, extent = Math.abs(nx) * sample.value.width / 2 + Math.abs(ny) * sample.value.height / 2
  const proposed = request.node.center ?? { x: port.x + nx * (gap + extent), y: port.y + ny * (gap + extent) }
  const candidate = diagramShapeNode({ ...request.node, center: proposed })
  if (!candidate.ok) return candidate
  const center = request.node.center ?? clearFrame(board, candidate.value, direction)
  if (!center) return refuse('no-successor-space', 'There is no clear nearby position; choose a position for the successor.')
  const created = diagramShapeNode({ ...request.node, center })
  if (!created.ok) return created
  const ownerId = options.ownerId !== undefined ? options.ownerId : source.groupId ?? source.parentColumnId
  const placed = putNode(board, created.value, ownerId, source.parentColumnId === ownerId ? (source.columnOrder ?? 0) + 1 : undefined)
  if (!placed.ok) return placed
  const target = placed.value.nodes.find((entry) => entry.id === request.node.id)!, nextSource = placed.value.nodes.find((entry) => entry.id === source.id)!
  const edge: BoardConnector = { style: 'elbow', color: '#60a5fa', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false, ...request.connector, id: request.connectorId, sourceId: source.id, targetId: target.id, sourcePort: direction, targetPort: nearestPort(target, portPoint(nextSource, direction)), sourcePortMode: request.connector?.sourcePortMode ?? 'fixed', targetPortMode: request.connector?.targetPortMode ?? 'fixed' }
  if (!['straight', 'elbow', 'curve'].includes(edge.style) || !Number.isFinite(edge.width) || edge.width <= 0 || !connectorGeometry(edge, placed.value.nodes)) return refuse('invalid-successor-connection', 'Use a supported route and positive finite connection width.')
  return finish(board, { ...placed.value, connectors: [...placed.value.connectors, edge] }, target.id, [edge.id], options.readOnly)
}

function routeFraction(geometry: ConnectorGeometry, point: BoardPoint) { return projectConnectorLabelPosition(geometry, point).t }
function commonOwner(board: BoardModel, edge: BoardConnector) {
  const source = board.nodes.find((node) => node.id === edge.sourceId), target = board.nodes.find((node) => node.id === edge.targetId)
  const a = source?.groupId ?? source?.parentColumnId, b = target?.groupId ?? target?.parentColumnId
  return a && a === b ? a : undefined
}
/** Old ID/label stay on source→inserted; a fresh downstream ID retains the old
 * target and end arrow. Only the two outside arrowheads survive. Labels retain
 * world position, including unknown label metadata. Straight routes remain
 * straight; elbow waypoints are partitioned; automatic curves reroute as two
 * curves (their current model stores no independently editable cubic handles). */
export function insertDiagramNodeOnConnectorResult(board: BoardModel, request: InsertDiagramNodeRequest, options: DiagramCommandOptions = {}): DiagramCommandResult {
  const checked = checkedBoard(board, options.readOnly), fresh = freshIdentity(board, [request.node.id, request.downstreamConnectorId])
  if (!checked.ok) return checked
  if (!fresh.ok) return fresh
  const edge = board.connectors.find((entry) => entry.id === request.connectorId)
  if (!edge) return refuse('missing-insert-connection', 'Select an existing relationship to insert a node.')
  if ((edge as BoardConnector & { mindMap?: unknown }).mindMap) return refuse('mind-map-insert', 'Use the mind-map child command to extend this branch; its tree relationship was retained.')
  for (const id of [edge.sourceId, edge.targetId].filter((id): id is string => Boolean(id))) if (checked.value.get(id)?.locked || checked.value.get(id)?.hidden) return refuse('uneditable-insert-endpoint', 'A relationship endpoint or its owner is locked, hidden or collapsed.', id)
  const original = connectorGeometry(edge, board.nodes)
  if (!original) return refuse('invalid-insert-route', 'The relationship endpoints cannot be resolved; no objects were changed.')
  if (original.points.slice(1).reduce((length, point, index) => length + Math.hypot(point.x - original.points[index].x, point.y - original.points[index].y), 0) < .001) return refuse('zero-insert-route', 'This relationship has no visible route length to insert into.')
  const fraction = request.fraction ?? (request.node.center ? routeFraction(original, request.node.center) : .5)
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return refuse('invalid-insert-position', 'Insert between the relationship endpoints, away from its start and end.')
  const created = diagramShapeNode({ ...request.node, center: request.node.center ?? pointAlongRoute(original.points, fraction) })
  if (!created.ok) return created
  const ownerId = options.ownerId !== undefined ? options.ownerId : commonOwner(board, edge), target = board.nodes.find((node) => node.id === edge.targetId)
  const placed = putNode(board, created.value, ownerId, target && ownerId && target.parentColumnId === ownerId ? target.columnOrder : undefined)
  if (!placed.ok) return placed
  const inserted = placed.value.nodes.find((node) => node.id === request.node.id)!, center = { x: inserted.x + inserted.width / 2, y: inserted.y + inserted.height / 2 }
  const placedEdge = placed.value.connectors.find((entry) => entry.id === edge.id)!, route = connectorGeometry(placedEdge, placed.value.nodes)
  if (!route) return refuse('invalid-insert-route', 'The arranged relationship cannot be resolved; no objects were changed.')
  const split = routeFraction(route, center), before = pointAlongRoute(route.points, Math.max(0, split - .01)), after = pointAlongRoute(route.points, Math.min(1, split + .01))
  const incoming: BoardConnector = { ...placedEdge, targetId: inserted.id, targetPort: nearestPort(inserted, before), targetPortMode: 'fixed', endArrow: false }
  delete incoming.targetPoint
  const outgoing: BoardConnector = { ...placedEdge, id: request.downstreamConnectorId, sourceId: inserted.id, sourcePort: nearestPort(inserted, after), sourcePortMode: 'fixed', startArrow: false }
  delete outgoing.sourcePoint; delete outgoing.label; delete outgoing.labelPosition
  if (edge.style === 'elbow') {
    // Keep exact old manual waypoints outside the inserted frame, on their side.
    const outside = (point: BoardPoint) => point.x < inserted.x || point.x > inserted.x + inserted.width || point.y < inserted.y || point.y > inserted.y + inserted.height
    const points = route.manual ? placedEdge.bendPoints ?? [] : route.points.slice(1, -1)
    incoming.bendPoints = points.filter((point) => outside(point) && routeFraction(route, point) < split).map((point) => ({ ...point }))
    outgoing.bendPoints = points.filter((point) => outside(point) && routeFraction(route, point) >= split).map((point) => ({ ...point }))
  }
  if (edge.label !== undefined || edge.labelPosition !== undefined) {
    const nextGeometry = connectorGeometry(incoming, placed.value.nodes)
    if (!nextGeometry) return refuse('invalid-insert-label', 'The source segment could not preserve the relationship label.')
    incoming.labelPosition = { ...edge.labelPosition, ...projectConnectorLabelPosition(nextGeometry, connectorLabelPoint(edge, original)) }
  }
  const connectors = placed.value.connectors.flatMap((entry) => entry.id === edge.id ? [incoming, outgoing] : [entry])
  return finish(board, { ...placed.value, connectors }, inserted.id, [incoming.id, outgoing.id], options.readOnly)
}
