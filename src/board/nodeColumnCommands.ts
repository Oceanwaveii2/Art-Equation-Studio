import type { BoardConnector, BoardModel, BoardNode, ConnectorPort } from '../model/project'
import { validateBoardMutation } from './boardMutationSafety'
import { computePortPosition, createStandardCardPorts, validatePortConnection, type CardPort, type PortSemanticType } from './cardPorts'
import { EDGE_KIND_COLORS, type EdgeKind } from './graphConnectors'
import { diagramState, type StructureResult } from './diagramStructureCore'

/** Optional, portable extensions of the existing board records. Old columns and
 * connections remain ordinary BoardNode/BoardConnector records. The project
 * loader retains unknown optional fields while it normalizes legacy records. */
export type NodeGraphRole = 'reference' | 'continuity' | 'branch' | 'identity' | 'video' | 'general' | 'evidence' | 'transform'
export type NodeColumnRecord = BoardNode & { columnMode?: 'node'; nodeGraphRole?: NodeGraphRole }
export type NodeGraphEdgeData = { version: 1; sourceSocket: string; targetSocket: string; kind: EdgeKind }
export type NodeGraphConnector = BoardConnector & { nodeGraph?: NodeGraphEdgeData }
export type NodeGraphPort = CardPort & { key: string }

const fail = <T>(code: string, detail: string, nodeId?: string): StructureResult<T> => ({ ok: false, issues: [{ code, detail, ...(nodeId ? { nodeId } : {}) }] })
const roleValues: readonly NodeGraphRole[] = ['reference', 'continuity', 'branch', 'identity', 'video', 'general', 'evidence', 'transform']
const semanticEdgeKind = (semantic: PortSemanticType): EdgeKind => semantic === 'continuity-out' ? 'continuity'
  : semantic === 'branch-out' ? 'branch'
  : semantic === 'identity' ? 'identity'
  : semantic === 'evidence' ? 'evidence'
  : semantic === 'transform' ? 'transform' : 'reference'

export function validateNodeGraphPortConnection(source: CardPort, target: CardPort): { valid: boolean; reason?: string } {
  const directional = validatePortConnection(source, target)
  if (!directional.valid) return directional
  const incoming = target.semanticType
  if (incoming === 'identity' && source.semanticType !== 'identity' && source.semanticType !== 'generic') return { valid: false, reason: 'Identity inputs require an identity or generic source.' }
  if ((incoming === 'continuity-in' || incoming === 'branch-in') && !['continuity-out', 'branch-out', 'generic'].includes(source.semanticType)) return { valid: false, reason: 'Sequence inputs require a continuity or branch source.' }
  if ((incoming === 'evidence' || incoming === 'transform') && source.semanticType !== incoming && source.semanticType !== 'generic') return { valid: false, reason: `${incoming} inputs require a matching source.` }
  return { valid: true }
}

export function isNodeColumn(node: BoardNode | undefined): node is NodeColumnRecord {
  return node?.kind === 'column' && (node as NodeColumnRecord).columnMode === 'node'
}

export function nodeGraphOwner(board: Pick<BoardModel, 'nodes'>, node: BoardNode | undefined, byId?: ReadonlyMap<string, BoardNode>): NodeColumnRecord | undefined {
  if (!node) return undefined
  if (isNodeColumn(node)) return node
  if (node.kind === 'column') return undefined
  let parentId = node.parentColumnId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId?.get(parentId) || board.nodes.find((entry) => entry.id === parentId)
    if (isNodeColumn(parent)) return parent
    parentId = parent?.parentColumnId
  }
  return undefined
}

export function nodeGraphRole(node: BoardNode): NodeGraphRole {
  const explicit = (node as NodeColumnRecord).nodeGraphRole
  if (explicit && roleValues.includes(explicit)) return explicit
  if (node.kind === 'video') return 'video'
  return node.kind === 'column' ? 'general' : 'reference'
}

/** Stable suffixes survive copy/paste and board duplication because the card ID
 * lives on the endpoint, not in the saved socket key. */
export function nodeGraphPorts(board: Pick<BoardModel, 'nodes'>, node: BoardNode | undefined, byId?: ReadonlyMap<string, BoardNode>): NodeGraphPort[] {
  if (!node || !nodeGraphOwner(board, node, byId)) return []
  const role = nodeGraphRole(node)
  const ports: CardPort[] = role === 'evidence' || role === 'transform'
    ? [
      { id: `${node.id}-${role}-in`, cardId: node.id, semanticType: role, side: 'left', normalizedOffset: .5, direction: 'target', label: `${role} input` },
      { id: `${node.id}-${role}-out`, cardId: node.id, semanticType: role, side: 'right', normalizedOffset: .5, direction: 'source', label: `${role} output` },
    ]
    : createStandardCardPorts(node.id, role)
  return ports.map((port) => ({ ...port, key: port.id.slice(node.id.length + 1) }))
}

export function nodeGraphPort(board: BoardModel, nodeId: string, socket: string): NodeGraphPort | undefined {
  const node = board.nodes.find((entry) => entry.id === nodeId)
  return nodeGraphPorts(board, node).find((port) => port.key === socket)
}

export function nodeGraphPortPosition(board: BoardModel, nodeId: string, socket: string) {
  const node = board.nodes.find((entry) => entry.id === nodeId)
  const port = nodeGraphPort(board, nodeId, socket)
  if (!node || !port) return undefined
  const point = computePortPosition(port, node)
  const angle = (node.rotation || 0) * Math.PI / 180
  if (!angle) return point
  const cx = node.x + node.width / 2, cy = node.y + node.height / 2
  const dx = point.x - cx, dy = point.y - cy
  return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) }
}

export function isNodeGraphConnector(edge: BoardConnector): edge is NodeGraphConnector & { nodeGraph: NodeGraphEdgeData } {
  const data = (edge as NodeGraphConnector).nodeGraph
  return data?.version === 1 && typeof data.sourceSocket === 'string' && typeof data.targetSocket === 'string'
}

export function hasConnectedNodeGraphEdges(board: BoardModel, nodeIds: readonly string[]): boolean {
  const ids = new Set(nodeIds)
  return board.connectors.some((edge) => isNodeGraphConnector(edge)
    && Boolean(edge.sourceId && ids.has(edge.sourceId) || edge.targetId && ids.has(edge.targetId)))
}

/** Pasted cards only retain typed edges when both copied endpoints still
 * belong to a Node Column. A partial clipboard may intentionally detach
 * cards, in which case retaining the edge would persist missing sockets. */
export function retainPastedNodeGraphConnectors(boardWithCopiedNodes: BoardModel, connectors: readonly BoardConnector[]): BoardConnector[] {
  return connectors.filter((edge) => {
    if (!isNodeGraphConnector(edge)) return true
    const source = nodeGraphPort(boardWithCopiedNodes, edge.sourceId || '', edge.nodeGraph.sourceSocket)
    const target = nodeGraphPort(boardWithCopiedNodes, edge.targetId || '', edge.nodeGraph.targetSocket)
    return Boolean(source && target && validateNodeGraphPortConnection(source, target).valid)
  })
}

export function createNodeColumnResult(board: BoardModel, node: BoardNode, readOnly = false): StructureResult<BoardModel> {
  if (node.kind !== 'column') return fail('wrong-kind', 'Node Column creation requires a column container.', node.id)
  if (board.nodes.some((entry) => entry.id === node.id)) return fail('duplicate-id', 'This column identity already exists.', node.id)
  if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) return fail('invalid-geometry', 'Node Column geometry must be finite and positive.', node.id)
  const created: NodeColumnRecord = { ...node, columnMode: 'node', nodeGraphRole: 'general' }
  return validateBoardMutation(board, { ...board, nodes: [...board.nodes, created] }, readOnly)
}

export function setNodeGraphRoleResult(board: BoardModel, nodeId: string, role: NodeGraphRole, readOnly = false): StructureResult<BoardModel> {
  const node = board.nodes.find((entry) => entry.id === nodeId)
  if (!node || !nodeGraphOwner(board, node)) return fail('not-node-graph', 'Choose a Node Column or one of its cards.', nodeId)
  if (!roleValues.includes(role)) return fail('invalid-role', 'Choose a supported graph role.', nodeId)
  const next = { ...board, nodes: board.nodes.map((entry) => entry.id === nodeId ? { ...entry, nodeGraphRole: role } satisfies NodeColumnRecord : entry) }
  for (const edge of next.connectors) {
    if (!isNodeGraphConnector(edge) || (edge.sourceId !== nodeId && edge.targetId !== nodeId)) continue
    const source = nodeGraphPort(next, edge.sourceId || '', edge.nodeGraph.sourceSocket)
    const target = nodeGraphPort(next, edge.targetId || '', edge.nodeGraph.targetSocket)
    if (!source || !target || !validateNodeGraphPortConnection(source, target).valid) return fail('incompatible-edge', 'Reconnect existing typed edges before changing this card role.', nodeId)
  }
  return validateBoardMutation(board, next, readOnly)
}

export function connectNodeGraphPortsResult(
  board: BoardModel,
  input: { id: string; sourceId: string; sourceSocket: string; targetId: string; targetSocket: string },
  readOnly = false,
): StructureResult<BoardModel> {
  if (!input.id || board.connectors.some((edge) => edge.id === input.id)) return fail('duplicate-edge', 'A new connection needs a unique identity.')
  const source = nodeGraphPort(board, input.sourceId, input.sourceSocket)
  const target = nodeGraphPort(board, input.targetId, input.targetSocket)
  if (!source || !target) return fail('missing-socket', 'Connect two sockets on Node Columns or their cards.')
  const sourceState = diagramState(board.nodes, input.sourceId), targetState = diagramState(board.nodes, input.targetId)
  if (!sourceState.ok) return sourceState
  if (!targetState.ok) return targetState
  if (sourceState.value.locked || sourceState.value.hidden || targetState.value.locked || targetState.value.hidden) return fail('uneditable-endpoint', 'A locked, hidden or collapsed card cannot be connected.')
  const allowed = validateNodeGraphPortConnection(source, target)
  if (!allowed.valid) return fail('incompatible-sockets', allowed.reason || 'The two sockets are incompatible.')
  if (board.connectors.some((edge) => isNodeGraphConnector(edge) && edge.sourceId === input.sourceId && edge.targetId === input.targetId
    && edge.nodeGraph.sourceSocket === input.sourceSocket && edge.nodeGraph.targetSocket === input.targetSocket)) return fail('duplicate-edge', 'These sockets are already connected.')
  const kind = semanticEdgeKind(source.semanticType)
  const edge: NodeGraphConnector = {
    id: input.id, sourceId: input.sourceId, targetId: input.targetId,
    sourcePort: source.side as ConnectorPort, targetPort: target.side as ConnectorPort,
    style: 'curve', color: EDGE_KIND_COLORS[kind], width: 2.5, dashed: false,
    startArrow: false, endArrow: true, animated: false,
    nodeGraph: { version: 1, sourceSocket: source.key, targetSocket: target.key, kind },
  }
  return validateBoardMutation(board, { ...board, connectors: [...board.connectors, edge] }, readOnly)
}

/** Reattach a typed edge to a socket while preserving its visual edits. */
export function reconnectNodeGraphPortResult(
  board: BoardModel, edgeId: string, end: 'source' | 'target', nodeId: string, socket: string, readOnly = false,
): StructureResult<BoardModel> {
  const edge = board.connectors.find((entry) => entry.id === edgeId)
  if (!edge || !isNodeGraphConnector(edge)) return fail('missing-edge', 'Choose a typed graph connection first.')
  const sourceId = end === 'source' ? nodeId : edge.sourceId || ''
  const targetId = end === 'target' ? nodeId : edge.targetId || ''
  const sourceSocket = end === 'source' ? socket : edge.nodeGraph.sourceSocket
  const targetSocket = end === 'target' ? socket : edge.nodeGraph.targetSocket
  const source = nodeGraphPort(board, sourceId, sourceSocket), target = nodeGraphPort(board, targetId, targetSocket)
  if (!source || !target) return fail('missing-socket', 'Both endpoints need an existing graph socket.')
  const sourceState = diagramState(board.nodes, sourceId), targetState = diagramState(board.nodes, targetId)
  if (!sourceState.ok) return sourceState
  if (!targetState.ok) return targetState
  if (sourceState.value.locked || sourceState.value.hidden || targetState.value.locked || targetState.value.hidden) return fail('uneditable-endpoint', 'A locked, hidden or collapsed card cannot be connected.')
  const allowed = validateNodeGraphPortConnection(source, target)
  if (!allowed.valid) return fail('incompatible-sockets', allowed.reason || 'The two sockets are incompatible.')
  if (board.connectors.some((other) => other.id !== edgeId && isNodeGraphConnector(other) && other.sourceId === sourceId && other.targetId === targetId
    && other.nodeGraph.sourceSocket === sourceSocket && other.nodeGraph.targetSocket === targetSocket)) return fail('duplicate-edge', 'These sockets are already connected.')
  if (edge.sourceId === sourceId && edge.targetId === targetId && edge.nodeGraph.sourceSocket === sourceSocket && edge.nodeGraph.targetSocket === targetSocket) return { ok: true, value: board }
  const nextEdge: NodeGraphConnector = {
    ...edge, sourceId, targetId,
    sourcePort: source.side as ConnectorPort, targetPort: target.side as ConnectorPort,
    nodeGraph: { ...edge.nodeGraph, sourceSocket, targetSocket, kind: semanticEdgeKind(source.semanticType) },
  }
  delete nextEdge.sourcePoint
  delete nextEdge.targetPoint
  return validateBoardMutation(board, { ...board, connectors: board.connectors.map((entry) => entry.id === edgeId ? nextEdge : entry) }, readOnly)
}
