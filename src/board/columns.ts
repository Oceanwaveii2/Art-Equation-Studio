import type { BoardConnector, BoardModel, BoardNode } from '../model/project'
import { resizeVectorNodeFrame } from '../model/vector'
import { isRectangleErasure, rectangleErasureState, resizeRectangleErasureFrame } from '../model/rectangleErasure'
import { GraphColumnRuntime } from './graphColumnV2'
import { SUBBOARD_ROW_HEIGHT } from './subboardPresentation'
import {
  containerDescendantIds, containerPaintOrder, diagramState, moveContainerWithDescendants,
  reparentContainerNodes, validateContainerOwnership, type StructureResult,
} from './diagramStructureCore'

export const COLUMN_HEADER_HEIGHT = 58
export const COLUMN_PADDING = 10
export const COLUMN_GAP = 10
export const COLUMN_MIN_WIDTH = 230
export const COLUMN_EMPTY_HEIGHT = 150
/** Frame labels sit above their body, unlike regular group headers. */
export const COLUMN_FRAME_HEADER_HEIGHT = 28

export type ColumnDropTarget = { columnId: string; index: number }
export type ColumnDropResult = StructureResult<ColumnDropTarget | null>
export type ColumnCommandResult = StructureResult<BoardModel>
export type ColumnImageSizing = 'responsive' | 'minimum-height'

/** Explicit image framing remains a deliberate crop/transform choice. These
 * rows, image cards and covers keep their existing card-layout rules. */
const responsiveArtwork = (node: BoardNode) => node.kind === 'image' && node.imagePresentation === 'artwork'
  && (node.imageTransform?.fit === undefined || node.imageTransform.fit === 'contain')
  && (node.imageTransform?.zoom === undefined || node.imageTransform.zoom === 1)
  && (node.imageTransform?.rotation === undefined || node.imageTransform.rotation === 0)
  && !node.imageTransform?.flipX && !node.imageTransform?.flipY
  && (node.imageTransform?.positionX === undefined || node.imageTransform.positionX === 50)
  && (node.imageTransform?.positionY === undefined || node.imageTransform.positionY === 50)
const imageSizing = (node: BoardNode): ColumnImageSizing | undefined => {
  const value = node.columnImageSizing
  return value === 'responsive' || value === 'minimum-height' ? value : undefined
}

const success = (value: BoardModel): ColumnCommandResult => ({ ok: true, value })
const failure = <T = BoardModel>(code: string, detail: string, nodeId?: string): StructureResult<T> => ({ ok: false, issues: [{ code, detail, ...(nodeId ? { nodeId } : {}) }] })
export const isFlowColumn = (node: BoardNode | undefined) => Boolean(node && (node.kind === 'column' || (node.kind === 'group' && node.graphColumn)))
export const flowOwnerId = (node: BoardNode, nodes: readonly BoardNode[]) => node.parentColumnId || (nodes.some(owner => owner.id === node.groupId && owner.graphColumn) ? node.groupId : undefined)
const isContainer = (node: BoardNode) => node.kind === 'group' || isFlowColumn(node)
const positive = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
// Legacy typed edges remain distinct from the versioned graph dataflow.
const isNodeColumn = (node: BoardNode | undefined) => isFlowColumn(node) && (node as BoardNode & { columnMode?: string }).columnMode === 'node'
const isNodeGraphConnector = (edge: BoardConnector) => (edge as BoardConnector & { nodeGraph?: { version?: number } }).nodeGraph?.version === 1
const nodeGraphOwner = (board: BoardModel, node: BoardNode) => {
  let parentId = node.parentColumnId
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = board.nodes.find((entry) => entry.id === parentId)
    if (isNodeColumn(parent)) return parent
    parentId = parent?.parentColumnId
  }
  return undefined
}

/** Milanote-style subboards flow as compact rows, never stretched covers. */
export function isColumnSubboardTile(node: BoardNode) {
  return node.kind === 'board-link' && node.boardLinkRole === 'child' && Boolean(node.boardPortal)
}

export function columnChildren(board: BoardModel, columnId: string, excludedIds: ReadonlySet<string> = new Set()) {
  return board.nodes
    .filter((node) => flowOwnerId(node, board.nodes) === columnId && !excludedIds.has(node.id))
    .sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0) || a.y - b.y || a.id.localeCompare(b.id))
}

function selectedRoots(board: BoardModel, ids: readonly string[]): StructureResult<BoardNode[]> {
  const valid = validateContainerOwnership(board.nodes)
  if (!valid.ok) return valid
  const requested = new Set(ids)
  for (const id of requested) if (!valid.value.has(id)) return { ok: false, issues: [{ code: 'missing-object', nodeId: id, detail: `Object ${id} is not on this board.` }] }
  return { ok: true, value: [...requested].filter((id) => {
    let node = valid.value.get(id)!
    while (node.groupId || node.parentColumnId) {
      const owner = node.groupId || node.parentColumnId!
      if (requested.has(owner)) return false
      node = valid.value.get(owner)!
    }
    return true
  }).map((id) => valid.value.get(id)!) }
}

/** Propagate inner row heights through owning columns; never infer group size. */
function affectedColumnIds(board: BoardModel, ids: readonly string[]): string[] {
  const byId = new Map(board.nodes.map((node) => [node.id, node])), columns = new Set(ids)
  for (const id of ids) {
    let node = byId.get(id)
    while (node?.groupId || node?.parentColumnId) {
      node = byId.get(node.groupId || node.parentColumnId!)
      if (node && isFlowColumn(node)) columns.add(node.id)
    }
  }
  return [...columns]
}

/** Scoped, atomic reflow uses the production subtree/route movement command.
 * Whole-board normalization skips locked/hidden columns; explicit scope refuses
 * them. Every changed row is checked, including its inherited/descendant locks. */
export function layoutBoardColumnsResult(board: BoardModel, columnIds?: readonly string[]): ColumnCommandResult {
  const valid = validateContainerOwnership(board.nodes)
  if (!valid.ok) return valid
  const requested = columnIds ? [...new Set(columnIds)] : board.nodes.filter((node) => isFlowColumn(node)).map((node) => node.id)
  const depths = new Map<string, number>()
  for (const id of requested) {
    const node = valid.value.get(id)
    if (!node) return failure('missing-owner', `Column ${id} is not on this board.`, id)
    if (!isFlowColumn(node)) return failure('wrong-owner-kind', 'Column layout requires a column container.', id)
    const state = diagramState(board.nodes, id)
    if (!state.ok) return state
    if (columnIds && (state.value.locked || state.value.hidden)) return failure('uneditable-owner', 'The column or its ancestor is locked or hidden; layout was cancelled.', id)
    depths.set(id, state.value.containerAncestors.length)
  }
  let next = board
  for (const id of requested.sort((a, b) => depths.get(b)! - depths.get(a)!)) {
    const column = next.nodes.find((node) => node.id === id)!
    if (!columnIds && column.columnFixedLayout) continue
    const state = diagramState(next.nodes, id)
    if (!state.ok) return state
    if (state.value.locked || state.value.hidden) continue
    if (![column.x, column.y].every(Number.isFinite) || !positive(column.width) || !positive(column.height)) return failure('invalid-geometry', 'Column geometry must be finite with positive dimensions.', id)
    const children = columnChildren(next, id)
    if (children.some((child) => !positive(child.width) || !positive(child.height) || ![child.x, child.y].every(Number.isFinite))) return failure('invalid-geometry', 'Every column row must have finite geometry and positive dimensions.', id)
    // Keep nested frame/column dimensions, widening the host if necessary.
    const width = Math.max(COLUMN_MIN_WIDTH, column.width, ...children.filter(isContainer).map((child) => child.width + COLUMN_PADDING * 2))
    if (column.collapsed) {
      if (column.width !== width || column.height !== COLUMN_HEADER_HEIGHT) next = { ...next, nodes: next.nodes.map((node) => node.id === id ? { ...node, width, height: COLUMN_HEADER_HEIGHT } : node) }
      continue
    }
    const innerWidth = width - COLUMN_PADDING * 2
    let y = column.y + COLUMN_HEADER_HEIGHT + COLUMN_PADDING
    for (let index = 0; index < children.length; index++) {
      const child = next.nodes.find((node) => node.id === children[index].id)!
      let x = column.x + COLUMN_PADDING, rowY = y, childWidth = child.width, childHeight = child.height
      if (isColumnSubboardTile(child)) {
        childWidth = innerWidth; childHeight = SUBBOARD_ROW_HEIGHT
        y += childHeight + COLUMN_GAP
      } else {
        if (child.kind === 'group' && (child.containerRole === 'frame' || /\bframe\b/i.test(child.title))) { y += COLUMN_FRAME_HEADER_HEIGHT; rowY = y }
        if (!isContainer(child)) {
          const sourceWidth = positive(child.freeWidth) ? child.freeWidth : child.width
          const sourceHeight = positive(child.freeHeight) ? child.freeHeight : child.height
          const explicitArtworkSizing = responsiveArtwork(child) ? imageSizing(column) : undefined
          childWidth = explicitArtworkSizing ? innerWidth : column.columnPreserveCardSizes ? Math.min(innerWidth, sourceWidth) : innerWidth
          const proportionalHeight = sourceHeight * childWidth / sourceWidth
          childHeight = explicitArtworkSizing === 'responsive' ? proportionalHeight
            : explicitArtworkSizing === 'minimum-height' ? Math.max(78, Math.round(proportionalHeight))
              : column.columnPreserveCardSizes ? proportionalHeight
                : child.kind === 'document' ? Math.max(70, sourceHeight) : Math.max(78, Math.round(sourceHeight * innerWidth / sourceWidth))
        }
        y += childHeight + COLUMN_GAP
      }
      if (![x, rowY, childWidth, childHeight, y].every(Number.isFinite) || !positive(childWidth) || !positive(childHeight)) return failure('invalid-layout', 'Column layout would exceed finite positive geometry.', child.id)
      if (child.x === x && child.y === rowY && child.width === childWidth && child.height === childHeight && child.columnOrder === index) continue
      if (child.kind === 'shape' && child.shapeType === 'rectangle' && child.vectorBoolean && !rectangleErasureState(child)) return failure('invalid-rectangle-erasure', 'This rectangle has invalid erasure modifiers; column layout was cancelled without changing artwork.', child.id)
      const moved = moveContainerWithDescendants(next.nodes, next.connectors, [child.id], { x: x - child.x, y: rowY - child.y })
      if (!moved.ok) return moved
      next = { ...next, nodes: moved.value.nodes.map((node) => {
        if (node.id !== child.id) return node
        const frame = { x: node.x, y: node.y, width: childWidth, height: childHeight }
        const resized = isRectangleErasure(node) ? resizeRectangleErasureFrame(node, frame) : node.vectorPath && (node.width !== childWidth || node.height !== childHeight) ? resizeVectorNodeFrame(node, frame) : { ...node, ...frame }
        return { ...resized, columnOrder: index }
      }), connectors: moved.value.connectors }
    }
    const height = Math.max(COLUMN_EMPTY_HEIGHT, children.length ? y - column.y + (column.graphColumn ? 32 : 0) : COLUMN_EMPTY_HEIGHT)
    if (!Number.isFinite(height)) return failure('invalid-layout', 'Column layout would exceed finite geometry.', id)
    const current = next.nodes.find((node) => node.id === id)!
    if (current.width !== width || current.height !== height) next = { ...next, nodes: next.nodes.map((node) => node.id === id ? { ...node, width, height } : node) }
  }
  return success(next)
}

/** A document command, not a default or load-time migration. Save a paired
 * source frame before a minimum-height floor can overwrite its aspect ratio.
 * Explicit choices also apply to fixed Node Columns; ordinary normalization
 * continues to leave their saved geometry and graph records alone. */
export function setColumnImageSizingResult(
  board: BoardModel, columnId: string, sizing: ColumnImageSizing, readOnly = false,
): ColumnCommandResult {
  if (readOnly) return failure('read-only', 'This workspace is read-only; column image sizing was not changed.', columnId)
  if (sizing !== 'responsive' && sizing !== 'minimum-height') return failure('invalid-image-sizing', 'Choose Responsive or Minimum height.', columnId)
  const valid = validateContainerOwnership(board.nodes)
  if (!valid.ok) return valid
  const column = valid.value.get(columnId)
  if (!column) return failure('missing-owner', `Column ${columnId} is not on this board.`, columnId)
  if (!isFlowColumn(column)) return failure('wrong-owner-kind', 'Image sizing requires a column container.', columnId)
  if (column.collapsed) return failure('uneditable-owner', 'Expand the column before changing its image sizing.', columnId)
  const descendants = containerDescendantIds(board.nodes, [columnId])
  if (!descendants.ok) return descendants
  for (const id of descendants.value) {
    const state = diagramState(board.nodes, id)
    if (!state.ok) return state
    if (state.value.locked || state.value.hidden) return failure('uneditable-owner', 'The column, an ancestor or an affected row is locked or hidden; image sizing was not changed.', id)
  }
  let changed = false
  const nodes = board.nodes.map((node) => {
    if (node.id === columnId) {
      if (imageSizing(node) === sizing) return node
      changed = true
      return { ...node, columnImageSizing: sizing }
    }
    if (flowOwnerId(node, board.nodes) !== columnId || !responsiveArtwork(node)
      || (positive(node.freeWidth) && positive(node.freeHeight))) return node
    changed = true
    // Never combine a valid old width with a newer floored height. Missing or
    // partial free geometry uses the current paired frame once, then persists.
    return { ...node, freeWidth: node.width, freeHeight: node.height }
  })
  const draft = changed ? { ...board, nodes } : board
  return layoutBoardColumnsResult(draft, affectedColumnIds(draft, [columnId]))
}

/** Compatibility entry point preserves the supplied snapshot on refusal. */
export function layoutBoardColumns(board: BoardModel, columnIds?: readonly string[]): BoardModel {
  const result = layoutBoardColumnsResult(board, columnIds)
  return result.ok ? result.value : board
}

/** Layout for an edit to specific objects: their own/owning columns only.
 * Callers supply all fresh clone/paste IDs when those include nested columns. */
export function layoutBoardColumnsForNodesResult(board: BoardModel, ids: readonly string[]): ColumnCommandResult {
  const valid = validateContainerOwnership(board.nodes)
  if (!valid.ok) return valid
  const columns = new Set<string>()
  for (const id of new Set(ids)) {
    let node = valid.value.get(id)
    if (!node) return failure('missing-object', `Object ${id} is not on this board.`, id)
    if (isFlowColumn(node)) columns.add(node.id)
    while (node.groupId || node.parentColumnId) {
      node = valid.value.get(node.groupId || node.parentColumnId!)!
      if (isFlowColumn(node)) columns.add(node.id)
    }
  }
  return layoutBoardColumnsResult(board, affectedColumnIds(board, [...columns]))
}

/** Distinguish a refused visible destination from dropping onto free canvas.
 * Callers can roll a refused gesture back without detaching its source row. */
export function findColumnDropTargetResult(board: BoardModel, worldX: number, worldY: number, movingIds: ReadonlySet<string>): ColumnDropResult {
  if (![worldX, worldY].every(Number.isFinite)) return failure('invalid-drop-position', 'Drop coordinates must be finite board-space positions.')
  const descendants = containerDescendantIds(board.nodes, [...movingIds])
  if (!descendants.ok) return descendants
  const paint = containerPaintOrder(board.nodes)
  if (!paint.ok) return paint
  const excluded = new Set(descendants.value)
  const candidates = board.nodes.filter((node) => isFlowColumn(node) && (!node.graphColumn || !excluded.has(node.id))
    && worldX >= node.x && worldX <= node.x + node.width
    && worldY >= node.y + COLUMN_HEADER_HEIGHT * .45 && worldY <= node.y + (node.collapsed ? COLUMN_HEADER_HEIGHT : Math.max(node.height, COLUMN_EMPTY_HEIGHT) + 36))
  const carriesTypedEdge = candidates.length > 0 && board.connectors.some((edge) => isNodeGraphConnector(edge) && (excluded.has(edge.sourceId || '') || excluded.has(edge.targetId || '')))
  // Match the visible object layer rather than the saved array order. A locked
  // topmost column must refuse the drop instead of falling through behind it.
  for (const column of candidates.sort((a, b) => paint.value.zIndexById.get(b.id)! - paint.value.zIndexById.get(a.id)!)) {
    const state = diagramState(board.nodes, column.id)
    if (!state.ok) return state
    if (state.value.hidden) continue
    if (state.value.locked || column.collapsed) return failure('uneditable-owner', 'The destination column is locked or collapsed; the drop was cancelled.', column.id)
    if (carriesTypedEdge && !isNodeColumn(column)) return failure('typed-edge-outside-node-column', 'Disconnect typed edges before moving their cards into a regular Column.', column.id)
    const reparented = reparentContainerNodes(board.nodes, [...movingIds], { kind: column.kind as 'group' | 'column', id: column.id })
    if (!reparented.ok) return reparented
    const children = columnChildren(board, column.id, excluded)
    const index = children.findIndex((child) => worldY < child.y + child.height / 2)
    return { ok: true, value: { columnId: column.id, index: index < 0 ? children.length : index } }
  }
  return { ok: true, value: null }
}

export function findColumnDropTarget(board: BoardModel, worldX: number, worldY: number, movingIds: ReadonlySet<string>): ColumnDropTarget | null {
  const result = findColumnDropTargetResult(board, worldX, worldY, movingIds)
  return result.ok ? result.value : null
}

export function columnInsertionY(board: BoardModel, target: ColumnDropTarget, movingIds: ReadonlySet<string>) {
  const column = board.nodes.find((node) => node.id === target.columnId)
  if (!column) return 0
  const children = columnChildren(board, target.columnId, movingIds)
  if (!children.length || target.index === 0) return column.y + COLUMN_HEADER_HEIGHT + COLUMN_PADDING
  const previous = children[Math.min(target.index, children.length) - 1]
  return previous.y + previous.height + COLUMN_GAP / 2
}

export function insertNodesIntoColumnResult(board: BoardModel, movingIds: readonly string[], target: ColumnDropTarget): ColumnCommandResult {
  if (!movingIds.length) return success(board)
  if (!Number.isSafeInteger(target.index) || target.index < 0) return failure('invalid-column-index', 'Drop placement must be a nonnegative integer row index.', target.columnId)
  const roots = selectedRoots(board, movingIds)
  if (!roots.ok) return roots
  const column = board.nodes.find((node) => node.id === target.columnId)
  if (!column) return failure('missing-owner', 'The destination column no longer exists.', target.columnId)
  if (!isFlowColumn(column)) return failure('wrong-owner-kind', 'The destination must be a Column or Graph Column.', target.columnId)
  if (column?.collapsed) return failure('uneditable-owner', 'Expand the destination column before adding rows.', column.id)
  if (column && !isNodeColumn(column) && !roots.value.every(isNodeColumn)) {
    const descendants = containerDescendantIds(board.nodes, movingIds)
    if (!descendants.ok) return descendants
    const moving = new Set(descendants.value)
    if (board.connectors.some((edge) => isNodeGraphConnector(edge) && (moving.has(edge.sourceId || '') || moving.has(edge.targetId || '')))) {
      return failure('typed-edge-outside-node-column', 'Disconnect typed edges before moving their cards into a regular Column.', column.id)
    }
  }
  const reparented = reparentContainerNodes(board.nodes, movingIds, { kind: (column?.kind || 'column') as 'group' | 'column', id: target.columnId })
  if (!reparented.ok) return reparented
  const moving = new Set(roots.value.map((node) => node.id)), sourceColumns = roots.value.flatMap((node) => flowOwnerId(node, board.nodes) ? [flowOwnerId(node, board.nodes)!] : [])
  const order = columnChildren(board, target.columnId, moving).map((node) => node.id)
  order.splice(Math.min(target.index, order.length), 0, ...moving)
  const orders = new Map(order.map((id, index) => [id, index]))
  // A locked row cannot be renumbered even if its geometry already matches.
  for (const node of board.nodes) if (!moving.has(node.id) && orders.has(node.id) && node.columnOrder !== orders.get(node.id)) {
    const editable = moveContainerWithDescendants(board.nodes, board.connectors, [node.id], { x: 0, y: 0 })
    if (!editable.ok) return editable
  }
  const nodes = reparented.value.map((node) => {
    if (!orders.has(node.id)) return node
    if (!moving.has(node.id)) return node.columnOrder === orders.get(node.id) ? node : { ...node, columnOrder: orders.get(node.id) }
    return { ...node, columnOrder: orders.get(node.id), ...(isContainer(node) ? {} : { freeWidth: positive(node.freeWidth) ? node.freeWidth : node.width, freeHeight: positive(node.freeHeight) ? node.freeHeight : node.height }) }
  })
  const draft = { ...board, nodes }
  try { const runtime=new GraphColumnRuntime();for(const graph of draft.nodes)if(graph.graphColumn)runtime.evaluate(draft,graph.id) }
  catch(error) { return failure('invalid-graph-containment', String(error), target.columnId) }
  return layoutBoardColumnsResult(draft, affectedColumnIds(draft, [...sourceColumns, target.columnId]))
}

export function insertNodesIntoColumn(board: BoardModel, movingIds: string[], target: ColumnDropTarget): BoardModel {
  const result = insertNodesIntoColumnResult(board, movingIds, target)
  return result.ok ? result.value : board
}

export function releaseNodesFromColumnsResult(board: BoardModel, movingIds: readonly string[]): ColumnCommandResult {
  const roots = selectedRoots(board, movingIds)
  if (!roots.ok) return roots
  // Freeform drags retain existing group/frame membership.
  const released = roots.value.filter((node) => flowOwnerId(node, board.nodes))
  if (!released.length) return success(board)
  const descendants = containerDescendantIds(board.nodes, released.map((node) => node.id))
  if (!descendants.ok) return descendants
  const moving = new Set(descendants.value)
  if (released.some((node) => !isNodeColumn(node) && nodeGraphOwner(board, node))
    && board.connectors.some((edge) => isNodeGraphConnector(edge) && (moving.has(edge.sourceId || '') || moving.has(edge.targetId || '')))) {
    return failure('typed-edge-outside-node-column', 'Disconnect typed edges before removing their cards from a Node Column.')
  }
  for (const node of released) if (node.kind === 'shape' && node.shapeType === 'rectangle' && node.vectorBoolean && !rectangleErasureState(node)) return failure('invalid-rectangle-erasure', 'This rectangle has invalid erasure modifiers; releasing its row was cancelled without changing artwork.', node.id)
  const reparented = reparentContainerNodes(board.nodes, released.map((node) => node.id))
  if (!reparented.ok) return reparented
  const releasedRoots = new Set(released.map((node) => node.id))
  const draft = { ...board, nodes: reparented.value.map((node) => {
    if (!releasedRoots.has(node.id) || isContainer(node)) return node
    const frame = { x: node.x, y: node.y, width: positive(node.freeWidth) ? node.freeWidth : node.width, height: positive(node.freeHeight) ? node.freeHeight : node.height }
    return isRectangleErasure(node) ? resizeRectangleErasureFrame(node, frame) : node.vectorPath && (node.width !== frame.width || node.height !== frame.height) ? resizeVectorNodeFrame(node, frame) : { ...node, ...frame }
  }) }
  return layoutBoardColumnsResult(draft, affectedColumnIds(draft, released.map((node) => flowOwnerId(node, board.nodes)!)))
}

export function releaseNodesFromColumns(board: BoardModel, movingIds: string[]): BoardModel {
  const result = releaseNodesFromColumnsResult(board, movingIds)
  return result.ok ? result.value : board
}

export type FlatColumnItem = {
  id: string
  columnId: string
  index: number
  x: number
  y: number
  width: number
  height: number
}

/** Flat coordinate layout calculation for columns.
 * Produces a linear coordinate list for fast viewport spatial queries without DOM tree thrashing. */
const flatColumnIndexes=new WeakMap<readonly BoardNode[],{owners:Map<string,BoardNode>;children:Map<string,BoardNode[]>;rows:Map<string,FlatColumnItem[]>}>()
export function computeFlatColumnCoordinates(board: BoardModel, columnIds?: readonly string[]): FlatColumnItem[] {
  let index=flatColumnIndexes.get(board.nodes)
  if(!index){
    const owners=new Map(board.nodes.filter(isFlowColumn).map(n=>[n.id,n])),children=new Map<string,BoardNode[]>()
    for(const node of board.nodes){const owner=node.parentColumnId||(node.groupId&&owners.get(node.groupId)?.graphColumn?node.groupId:undefined);if(!owner)continue;const list=children.get(owner)||[];list.push(node);children.set(owner,list)}
    index={owners,children,rows:new Map()};flatColumnIndexes.set(board.nodes,index)
  }
  const items:FlatColumnItem[]=[]
  for(const id of columnIds||index.owners.keys()){
    const column=index.owners.get(id);if(!column||column.collapsed)continue
    let rows=index.rows.get(id)
    if(!rows){rows=(index.children.get(id)||[]).slice().sort((a,b)=>(a.columnOrder??0)-(b.columnOrder??0)||a.y-b.y||a.id.localeCompare(b.id)).map((child,i)=>({id:child.id,columnId:id,index:i,x:child.x,y:child.y,width:child.width,height:child.height}));index.rows.set(id,rows)}
    items.push(...rows)
  }
  return items
}
