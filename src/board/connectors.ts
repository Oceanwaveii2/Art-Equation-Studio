import type { BoardConnector, BoardNode, BoardPoint, ConnectorLabelPosition, ConnectorLinePattern, ConnectorPort, ConnectorPortMode } from '../model/project'

export type ConnectorCommand = ['M' | 'L', number, number] | ['C', number, number, number, number, number, number]
/** Shared geometry accepts immutable engine snapshots as well as editable models. */
export type ConnectorRecord = Omit<BoardConnector, 'bendPoints'> & { bendPoints?: readonly BoardPoint[] }
export type ConnectorEndpointSpec = { attachment: 'attached'; objectId: string; port: ConnectorPort; portMode?: ConnectorPortMode } | { attachment: 'free'; point: BoardPoint }
export const CONNECTOR_POINT_LIMIT = 1_000_000
export const CONNECTOR_BEND_LIMIT = 32
const finite = (value: unknown, fallback = 0, min = -CONNECTOR_POINT_LIMIT, max = CONNECTOR_POINT_LIMIT) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
const validPoint = (point: unknown): point is BoardPoint => Boolean(point && typeof point === 'object' && typeof (point as BoardPoint).x === 'number' && Number.isFinite((point as BoardPoint).x) && typeof (point as BoardPoint).y === 'number' && Number.isFinite((point as BoardPoint).y))
const boundedPoint = (point: BoardPoint): BoardPoint => ({ ...point, x: finite(point.x), y: finite(point.y) })

/** Only optional metadata is normalized. Unknown record/label fields and legacy
 * routing defaults survive; invalid numeric input never reaches path geometry. */
export function normalizeConnector<T extends ConnectorRecord>(connector: T): T {
  const next = { ...connector }
  for (const key of ['sourcePortMode', 'targetPortMode'] as const) if (next[key] !== 'fixed' && next[key] !== 'adaptive') delete next[key]
  for (const key of ['sourcePoint', 'targetPoint'] as const) if (next[key]) {
    if (validPoint(next[key])) next[key] = boundedPoint(next[key]!)
    else delete next[key]
  }
  if (next.bendPoints !== undefined) next.bendPoints = Array.isArray(next.bendPoints) ? next.bendPoints.filter(validPoint).slice(0, CONNECTOR_BEND_LIMIT).map(boundedPoint) : []
  if (next.labelPosition !== undefined) {
    const position = next.labelPosition
    if (!position || typeof position !== 'object' || Array.isArray(position)) delete next.labelPosition
    else next.labelPosition = { ...position, t: finite(position.t, .5, 0, 1), offsetX: finite(position.offsetX), offsetY: finite(position.offsetY, -10) }
  }
  if (next.linePattern !== undefined && !['solid', 'dash', 'dot', 'dash-dot'].includes(next.linePattern)) delete next.linePattern
  return next
}

/** Reconnection is explicit: attaching clears stale free coordinates, freeing
 * clears the object ID. The other endpoint and unknown metadata stay untouched. */
export function withConnectorEndpoint(connector: BoardConnector, side: 'source' | 'target', endpoint: ConnectorEndpointSpec): BoardConnector {
  const next = { ...connector }
  const id = side === 'source' ? 'sourceId' : 'targetId', point = side === 'source' ? 'sourcePoint' : 'targetPoint'
  const port = side === 'source' ? 'sourcePort' : 'targetPort', mode = side === 'source' ? 'sourcePortMode' : 'targetPortMode'
  if (endpoint.attachment === 'attached') {
    next[id] = endpoint.objectId; delete next[point]; next[port] = endpoint.port; next[mode] = endpoint.portMode || 'fixed'
  } else {
    delete next[id]; next[point] = boundedPoint(endpoint.point); next[mode] = 'fixed'
  }
  return normalizeConnector(next)
}

export const CONNECTOR_RELATIONSHIP_STYLES = [
  { id: 'reference', name: 'Reference', color: '#60a5fa', linePattern: 'solid', startArrow: false, endArrow: true, cue: 'Reference' },
  { id: 'sequence', name: 'Sequence', color: '#eab308', linePattern: 'dash', startArrow: false, endArrow: true, cue: 'Next' },
  { id: 'alternative', name: 'Alternative', color: '#a78bfa', linePattern: 'dot', startArrow: false, endArrow: true, cue: 'Alternative' },
  { id: 'dependency', name: 'Dependency', color: '#ef4444', linePattern: 'dash-dot', startArrow: true, endArrow: true, cue: 'Requires' },
] as const

export function applyConnectorRelationshipStyle(connector: BoardConnector, id: string): BoardConnector {
  const preset = CONNECTOR_RELATIONSHIP_STYLES.find((style) => style.id === id)
  return preset ? { ...connector, relationshipStyle: preset.id, linePattern: preset.linePattern, color: preset.color, dashed: preset.linePattern !== 'solid', startArrow: preset.startArrow, endArrow: preset.endArrow, label: connector.label?.trim() ? connector.label : preset.cue } : connector
}

export function connectorLinePattern(connector: ConnectorRecord): ConnectorLinePattern { return connector.linePattern || (connector.dashed ? 'dash' : 'solid') }
export function connectorDashArray(connector: ConnectorRecord): string | undefined {
  return { solid: undefined, dash: '9 7', dot: '1 6', 'dash-dot': '9 5 1 5' }[connectorLinePattern(connector)]
}

export type ConnectorGeometry = {
  source: BoardPoint
  target: BoardPoint
  path: string
  midpoint: BoardPoint
  sourcePort: ConnectorPort
  targetPort: ConnectorPort
  points: BoardPoint[]
  commands: ConnectorCommand[]
  sourceTangent: BoardPoint
  targetTangent: BoardPoint
  manual: boolean
}

export function portPoint(node: BoardNode, port: ConnectorPort): BoardPoint {
  const cx = node.x + node.width / 2, cy = node.y + node.height / 2
  const offset = port === 'top' ? { x: 0, y: -node.height / 2 }
    : port === 'right' ? { x: node.width / 2, y: 0 }
      : port === 'bottom' ? { x: 0, y: node.height / 2 } : { x: -node.width / 2, y: 0 }
  const angle = (node.rotation || 0) * Math.PI / 180
  return { x: cx + offset.x * Math.cos(angle) - offset.y * Math.sin(angle), y: cy + offset.x * Math.sin(angle) + offset.y * Math.cos(angle) }
}

export function nearestPort(node: BoardNode, point: BoardPoint): ConnectorPort {
  const ports: ConnectorPort[] = ['top', 'right', 'bottom', 'left']
  return ports.reduce((best, port) => {
    const candidate = portPoint(node, port)
    const current = portPoint(node, best)
    return Math.hypot(point.x - candidate.x, point.y - candidate.y) < Math.hypot(point.x - current.x, point.y - current.y) ? port : best
  }, 'top')
}

export function resolveConnectorEndpoint(connector: ConnectorRecord, side: 'source' | 'target', nodes: readonly BoardNode[], override?: BoardPoint, oppositeOverride?: BoardPoint) {
  const ownId = side === 'source' ? connector.sourceId : connector.targetId
  const otherId = side === 'source' ? connector.targetId : connector.sourceId
  const node = ownId ? nodes.find((item) => item.id === ownId) : undefined
  const otherNode = otherId ? nodes.find((item) => item.id === otherId) : undefined
  const free = side === 'source' ? connector.sourcePoint : connector.targetPoint
  const otherFree = side === 'source' ? connector.targetPoint : connector.sourcePoint
  const fixed = side === 'source' ? connector.sourcePort : connector.targetPort
  const mode = (side === 'source' ? connector.sourcePortMode : connector.targetPortMode) || 'fixed'
  const toward = oppositeOverride || (otherNode ? { x: otherNode.x + otherNode.width / 2, y: otherNode.y + otherNode.height / 2 } : otherFree)
  const port = mode === 'adaptive' && node && toward && validPoint(toward) ? nearestPort(node, toward) : fixed
  const point = override || (connector.relationshipStyle === 'graph-v2' && validPoint(free) ? free : node ? portPoint(node, port) : free)
  return point && validPoint(point) ? { point: boundedPoint(point), port, node, portMode: mode, attachment: node ? 'attached' as const : 'free' as const } : null
}

function polylineGeometry(source: BoardPoint, target: BoardPoint, points: BoardPoint[], ports: { sourcePort: ConnectorPort; targetPort: ConnectorPort }, manual = false): ConnectorGeometry {
  const commands: ConnectorCommand[] = points.map((point, index) => [index ? 'L' : 'M', point.x, point.y])
  const midpoint = manual ? pointAlongRoute(points, .5) : { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
  return { source, target, ...ports, points, commands, manual, path: commands.map((command) => command.join(' ')).join(' '), midpoint,
    sourceTangent: points.find((point) => Math.hypot(point.x - source.x, point.y - source.y) > .00001) || target,
    targetTangent: [...points].reverse().find((point) => Math.hypot(point.x - target.x, point.y - target.y) > .00001) || source }
}

export function connectorGeometry(input: ConnectorRecord, nodes: readonly BoardNode[], sourceOverride?: BoardPoint, targetOverride?: BoardPoint): ConnectorGeometry | null {
  const connector = normalizeConnector(input)
  const a = resolveConnectorEndpoint(connector, 'source', nodes, sourceOverride, targetOverride)
  const b = resolveConnectorEndpoint(connector, 'target', nodes, targetOverride, sourceOverride)
  if (!a || !b) return null
  const source = a.point, target = b.point, ports = { sourcePort: a.port, targetPort: b.port }
  if (connector.style === 'straight') return polylineGeometry(source, target, [source, target], ports)
  if (connector.style === 'elbow') {
    const normal = portNormal(a.port, a.node?.rotation), horizontal = Math.abs(normal.x) >= Math.abs(normal.y)
    if (connector.bendPoints?.length) {
      const points = [source]
      const append = (point: BoardPoint) => { const last = points[points.length - 1]; if (point.x !== last.x || point.y !== last.y) points.push(point) }
      connector.bendPoints.forEach((bend, index) => {
        const last = points[points.length - 1]
        const horizontalFirst = index === 0 ? horizontal : Math.abs(bend.x - last.x) >= Math.abs(bend.y - last.y)
        append(horizontalFirst ? { x: bend.x, y: last.y } : { x: last.x, y: bend.y }); append(bend)
      })
      const last = points[points.length - 1], targetNormal = portNormal(b.port, b.node?.rotation)
      append(Math.abs(targetNormal.x) >= Math.abs(targetNormal.y) ? { x: last.x, y: target.y } : { x: target.x, y: last.y }); append(target)
      return polylineGeometry(source, target, points, ports, true)
    }
    return polylineGeometry(source, target, horizontal
      ? [source, { x: (source.x + target.x) / 2, y: source.y }, { x: (source.x + target.x) / 2, y: target.y }, target]
      : [source, { x: source.x, y: (source.y + target.y) / 2 }, { x: target.x, y: (source.y + target.y) / 2 }, target], ports)
  }
  const sourceNormal = portNormal(a.port, a.node?.rotation)
  const targetNormal = portNormal(b.port, b.node?.rotation)
  const distance = Math.max(60, Math.min(260, Math.hypot(target.x - source.x, target.y - source.y) * .42))
  const c1 = { x: source.x + sourceNormal.x * distance, y: source.y + sourceNormal.y * distance }
  const c2 = { x: target.x + targetNormal.x * distance, y: target.y + targetNormal.y * distance }
  return {
    source,
    target,
    ...ports,
    points: Array.from({ length: 33 }, (_, index) => cubicPoint(source, c1, c2, target, index / 32)),
    commands: [['M', source.x, source.y], ['C', c1.x, c1.y, c2.x, c2.y, target.x, target.y]],
    sourceTangent: c1,
    targetTangent: c2,
    manual: false,
    path: `M ${source.x} ${source.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${target.x} ${target.y}`,
    midpoint: cubicPoint(source, c1, c2, target, .5),
  }
}

export function pointAlongRoute(points: readonly BoardPoint[], t: number): BoardPoint {
  if (!points.length) return { x: 0, y: 0 }
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y))
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * finite(t, .5, 0, 1)
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index] && lengths[index] > 0) {
      const ratio = remaining / lengths[index], a = points[index], b = points[index + 1]
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
    }
    remaining -= lengths[index]
  }
  return points[points.length - 1]
}

export function connectorLabelPoint(connector: ConnectorRecord, geometry: ConnectorGeometry): BoardPoint {
  const position = normalizeConnector(connector).labelPosition
  if (!position) return { x: geometry.midpoint.x, y: geometry.midpoint.y - 10 }
  const point = pointAlongRoute(geometry.points, position.t)
  return { x: point.x + position.offsetX, y: point.y + position.offsetY }
}

/** Route projection for label dragging. The residual offset stays in board units. */
export function projectConnectorLabelPosition(geometry: ConnectorGeometry, point: BoardPoint): ConnectorLabelPosition {
  const total = geometry.points.slice(1).reduce((sum, end, index) => sum + Math.hypot(end.x - geometry.points[index].x, end.y - geometry.points[index].y), 0)
  let traveled = 0, best = { distance: Infinity, t: .5, offsetX: 0, offsetY: -10 }
  for (let index = 1; index < geometry.points.length; index++) {
    const a = geometry.points[index - 1], b = geometry.points[index], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (!length) continue
    const u = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (length * length)))
    const x = a.x + u * dx, y = a.y + u * dy, distance = Math.hypot(point.x - x, point.y - y)
    if (distance < best.distance) best = { distance, t: (traveled + u * length) / total, offsetX: finite(point.x - x), offsetY: finite(point.y - y) }
    traveled += length
  }
  return { t: best.t, offsetX: best.offsetX, offsetY: best.offsetY }
}

function portNormal(port: ConnectorPort, rotation = 0): BoardPoint {
  const normal = port === 'top' ? { x: 0, y: -1 } : port === 'right' ? { x: 1, y: 0 } : port === 'bottom' ? { x: 0, y: 1 } : { x: -1, y: 0 }
  const angle = rotation * Math.PI / 180
  return { x: normal.x * Math.cos(angle) - normal.y * Math.sin(angle), y: normal.x * Math.sin(angle) + normal.y * Math.cos(angle) }
}

/** One connector owns its marker color. Start arrows reverse at the source,
 * and label text is escaped rather than interpreted as SVG markup. */
export function connectorSvgMarkup(connector: ConnectorRecord, nodes: readonly BoardNode[], prefix = 'board-connector'): string {
  const geometry = connectorGeometry(connector, nodes)
  if (!geometry) return ''
  const safe = (value: string | number) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const identity = [...`${prefix}:${connector.id}`].map((character) => character.codePointAt(0)!.toString(16)).join('-')
  const markerId = `arrow-${identity}`
  const color = safe(connector.color || '#b9d4e7')
  const width = Number.isFinite(connector.width) ? Math.max(.1, connector.width) : 2
  const marker = connector.startArrow || connector.endArrow ? `<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="${color}"/></marker></defs>` : ''
  const labelPoint = connectorLabelPoint(connector, geometry), dash = connectorDashArray(connector)
  const label = connector.label?.trim() ? `<text x="${safe(labelPoint.x)}" y="${safe(labelPoint.y)}" text-anchor="middle" fill="${color}" font-family="Inter, sans-serif" font-size="12">${safe(connector.label)}</text>` : ''
  return `${marker}<path d="${safe(geometry.path)}" fill="none" stroke="${color}" stroke-width="${safe(width)}"${dash ? ` stroke-dasharray="${dash}"` : ''}${connectorLinePattern(connector) === 'dot' ? ' stroke-linecap="round"' : ''}${connector.startArrow ? ` marker-start="url(#${markerId})"` : ''}${connector.endArrow ? ` marker-end="url(#${markerId})"` : ''}/>${label}`
}

function cubicPoint(p0: BoardPoint, p1: BoardPoint, p2: BoardPoint, p3: BoardPoint, t: number) {
  const mt = 1 - t
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  }
}
