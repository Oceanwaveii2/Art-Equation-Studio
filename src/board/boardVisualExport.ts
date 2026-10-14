import type { BoardConnector, BoardModel, BoardNode } from '../model/project'
import { vectorNodeMatrix } from '../model/vector'
import { boardNodeVisualBounds, type ArrangementBounds } from './arrangement'
import { connectorGeometry, connectorLabelPoint } from './connectors'
import { projectGraphColumns } from './graphColumnV2'
import { containerDescendantIds, containerPaintOrder, diagramProjectionStates, validateMindMapConnectors, type StructureResult } from './diagramStructureCore'

export type BoardVisualExportTarget = 'full' | 'viewport' | 'selection' | 'frame'
export type BoardVisualExportOptions = {
  target: BoardVisualExportTarget
  selectedIds?: readonly string[]
  viewportSize: { width: number; height: number }
}
export type BoardVisualExport = {
  target: BoardVisualExportTarget
  nodes: BoardNode[]
  connectors: BoardConnector[]
  bounds: { left: number; top: number; width: number; height: number }
  frameId?: string
}
const fail = (code: string, detail: string, nodeId?: string): StructureResult<BoardVisualExport> => ({ ok: false, issues: [{ code, detail, ...(nodeId ? { nodeId } : {}) }] })
const finitePoint = (point: { x: number; y: number }) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
const frameNode = (node: BoardNode) => node.kind === 'group' && (node.containerRole === 'frame' || /\bframe\b/i.test(node.title))
const expand = (bounds: ArrangementBounds, amount: number): ArrangementBounds => ({ left: bounds.left - amount, top: bounds.top - amount, right: bounds.right + amount, bottom: bounds.bottom + amount })
const union = (bounds: readonly ArrangementBounds[]): ArrangementBounds => ({
  left: Math.min(...bounds.map((box) => box.left)), top: Math.min(...bounds.map((box) => box.top)),
  right: Math.max(...bounds.map((box) => box.right)), bottom: Math.max(...bounds.map((box) => box.bottom)),
})

/** Conservative bounds match the existing SVG serializer. Cubic control hulls
 * contain the entire route without sampling error. Default SVG marker units
 * scale the 8x8 arrow by stroke width; radius 9 also covers the refX offset.
 * Labels use 12px Inter/sans-serif at a baseline: 24px per UTF-16 unit, 24px
 * ascent and 12px descent allow generous fallback glyph metrics, plus 2px.
 * These are artifact bounds, not measured text/hit-test bounds. */
export function connectorVisualExportBounds(connector: BoardConnector, nodes: readonly BoardNode[]): ArrangementBounds | null {
  const geometry = connectorGeometry(connector, nodes)
  if (!geometry) return null
  const points = geometry.commands.flatMap((command) => {
    const result: { x: number; y: number }[] = []
    for (let index = 1; index < command.length; index += 2) result.push({ x: command[index] as number, y: command[index + 1] as number })
    return result
  })
  if (!points.length || points.some((point) => !finitePoint(point))) return null
  const width = Number.isFinite(connector.width) ? Math.max(.1, connector.width) : 2
  const margin = Math.max(width * 2, connector.startArrow || connector.endArrow ? width * 9 : 0)
  const route = expand({ left: Math.min(...points.map((point) => point.x)), top: Math.min(...points.map((point) => point.y)), right: Math.max(...points.map((point) => point.x)), bottom: Math.max(...points.map((point) => point.y)) }, margin)
  if (!connector.label?.trim()) return route
  const point = connectorLabelPoint(connector, geometry)
  if (!finitePoint(point)) return null
  const halfWidth = connector.label.length * 12 + 2
  return union([route, { left: point.x - halfWidth, right: point.x + halfWidth, top: point.y - 26, bottom: point.y + 14 }])
}

/** Canonical export projection only: no rasterizer, source embedding, mutation,
 * workspace write or new format. Validate complete ownership/tree/edge graphs
 * before choosing a region, including hidden records. Hidden/collapsed branches
 * never appear in artifacts. Lock state does not hide otherwise visible art.
 *
 * Selection/frame includes transitive container membership and only edges
 * whose attachments are all in the region, including tethered free endpoints.
 * Wholly detached routes are retained for full/viewport only. Frames remain
 * non-clipping world-space regions; bounds union visible members and routes.
 * Viewport is an explicit camera crop, so offscreen artwork is intentionally
 * clipped; full/selection/frame extend to complete supported artwork bounds. */
export function prepareBoardVisualExport(board: BoardModel, options: BoardVisualExportOptions): StructureResult<BoardVisualExport> {
  const { target, viewportSize } = options
  if (!['full', 'viewport', 'selection', 'frame'].includes(target)) return fail('invalid-export-target', 'Choose an existing board export target.')
  if (![viewportSize.width, viewportSize.height].every((value) => Number.isFinite(value) && value > 0) || ![board.viewport.x, board.viewport.y, board.viewport.scale].every(Number.isFinite) || board.viewport.scale <= 0) return fail('invalid-export-viewport', 'The export camera and viewport dimensions must be finite and positive.')
  const states = diagramProjectionStates(board.nodes)
  if (!states.ok) return states
  const paint = containerPaintOrder(board.nodes)
  if (!paint.ok) return paint
  const byId = new Map(board.nodes.map((node) => [node.id, node]))
  for (const node of board.nodes) {
    if (![node.x, node.y, node.width, node.height, node.rotation ?? 0].every(Number.isFinite) || node.width <= 0 || node.height <= 0) return fail('invalid-export-geometry', 'Object geometry must be finite with positive dimensions.', node.id)
    if (node.strokeWidth !== undefined && (!Number.isFinite(node.strokeWidth) || node.strokeWidth < 0)) return fail('invalid-export-stroke', 'Object strokes must be finite and nonnegative.', node.id)
  }
  const edgeIds = new Set<string>()
  for (const edge of board.connectors) {
    if (!edge.id || edgeIds.has(edge.id)) return fail('duplicate-export-connector', 'Connection identities must be nonempty and unique.')
    edgeIds.add(edge.id)
    if ((edge.sourceId && !byId.has(edge.sourceId)) || (edge.targetId && !byId.has(edge.targetId))) return fail('missing-export-endpoint', `Connection ${edge.id} references a missing object.`)
    if ((!edge.sourceId && !edge.sourcePoint) || (!edge.targetId && !edge.targetPoint)) return fail('missing-export-anchor', `Connection ${edge.id} needs both attached or free endpoints.`)
    if ([...(edge.bendPoints || []), ...(edge.sourcePoint ? [edge.sourcePoint] : []), ...(edge.targetPoint ? [edge.targetPoint] : [])].some((point) => !finitePoint(point))) return fail('invalid-export-route', `Connection ${edge.id} has a non-finite route.`)
    if (edge.labelPosition && ![edge.labelPosition.t, edge.labelPosition.offsetX, edge.labelPosition.offsetY].every(Number.isFinite)) return fail('invalid-export-label', `Connection ${edge.id} has a non-finite label position.`)
  }
  const treeIds = new Set([...board.nodes.flatMap((node) => node.mindMap ? [node.mindMap.treeId] : []), ...board.connectors.flatMap((edge) => edge.mindMap ? [edge.mindMap.treeId] : [])])
  for (const id of treeIds) {
    const valid = validateMindMapConnectors(board.nodes, board.connectors, id)
    if (!valid.ok) return valid
  }
  let region: Set<string> | undefined, frameId: string | undefined
  if (target === 'selection' || target === 'frame') {
    const ids = options.selectedIds || []
    let roots = ids
    if (target === 'frame') {
      // Match the existing selected-frame, first-frame, selected-container rule.
      const frame = board.nodes.find((node) => ids.includes(node.id) && frameNode(node))
        || board.nodes.find(frameNode)
        || board.nodes.find((node) => ids.includes(node.id) && (node.kind === 'group' || node.kind === 'column'))
      if (!frame) return fail('missing-export-frame', 'Create or select a frame before exporting a frame.')
      roots = [frame.id]; frameId = frame.id
    }
    if (!roots.length) return fail('empty-export-selection', 'Select at least one card to export.')
    const descendants = containerDescendantIds(board.nodes, roots)
    if (!descendants.ok) return descendants
    region = new Set(descendants.value)
  }
  const nodes = paint.value.orderedIds.map((id) => byId.get(id)!).filter((node) => !states.value.get(node.id)!.hidden && (!region || region.has(node.id)))
  if (region && !nodes.length) return fail('hidden-export-region', 'The chosen region has no visible objects to export.')
  const maskedRectangle = nodes.find(node => node.kind === 'shape' && node.shapeType === 'rectangle' && node.vectorBoolean)
  if (maskedRectangle) return fail('rectangle-appearance-export-pending', 'This rectangle has editable erasure cuts. Visual export and image/SVG copy need its complete inset border, shadow and caption appearance; no incomplete artifact was produced.', maskedRectangle.id)
  const exportedIds = new Set(nodes.map((node) => node.id))
  const connectors = [...board.connectors, ...projectGraphColumns(board).connections].filter((edge) => {
    const attachments = [edge.sourceId, edge.targetId].filter((id): id is string => Boolean(id))
    if (attachments.some((id) => states.value.get(id)!.hidden)) return false
    return !region || (attachments.length > 0 && attachments.every((id) => exportedIds.has(id)))
  })
  const camera = { left: -board.viewport.x / board.viewport.scale, top: -board.viewport.y / board.viewport.scale, width: viewportSize.width / board.viewport.scale, height: viewportSize.height / board.viewport.scale }
  if (target === 'viewport') return { ok: true, value: { target, nodes, connectors, bounds: camera } }
  const boundedFrame = frameId ? byId.get(frameId) : undefined
  if (target === 'frame' && boundedFrame?.boundedCanvas) return { ok: true, value: { target, nodes, connectors, frameId, bounds: { left: boundedFrame.x, top: boundedFrame.y, width: boundedFrame.width, height: boundedFrame.height } } }
  const boxes: ArrangementBounds[] = []
  for (const node of nodes) {
    const box = boardNodeVisualBounds(node), stroke = node.strokeWidth ?? (node.kind === 'shape' ? 2 : 1)
    // Path geometry includes half-stroke already; this extra margin also covers
    // miter joins and a scaled/skewed inner affine in vectorNodeSvgMarkup.
    const matrix = node.shapeType === 'path' && node.vectorPath ? vectorNodeMatrix(node) : undefined
    const factor = matrix ? Math.hypot(matrix.a, matrix.b, matrix.c, matrix.d) : 1
    const margin = node.shapeType === 'arrow' ? stroke * 9 : stroke * 2 * Math.max(1, factor)
    const padded = expand(box, margin)
    if (!Object.values(padded).every(Number.isFinite)) return fail('invalid-export-bounds', 'Artwork bounds must remain finite.', node.id)
    boxes.push(padded)
  }
  for (const edge of connectors) {
    const box = connectorVisualExportBounds(edge, board.nodes)
    if (!box || !Object.values(box).every(Number.isFinite)) return fail('invalid-export-bounds', `Connection ${edge.id} could not be bounded safely.`)
    boxes.push(box)
  }
  const padding = target === 'frame' ? 0 : target === 'selection' ? 24 : 42
  const box = boxes.length ? expand(union(boxes), padding) : { left: 0, top: 0, right: camera.width, bottom: camera.height }
  const bounds = { left: box.left, top: box.top, width: Math.max(1, box.right - box.left), height: Math.max(1, box.bottom - box.top) }
  if (!Object.values(bounds).every(Number.isFinite)) return fail('invalid-export-bounds', 'The export bounds exceed finite board coordinates.')
  return { ok: true, value: { target, nodes, connectors, bounds, ...(frameId ? { frameId } : {}) } }
}
