import type { BoardModel, BoardNode } from '../model/project'
import { validateContainerOwnership, moveContainerWithDescendants, reparentContainerNodes, type StructureResult } from './diagramStructureCore'
import { columnChildren, insertNodesIntoColumnResult, releaseNodesFromColumnsResult, flowOwnerId, isFlowColumn } from './columns'
import { validateBoardMutation } from './boardMutationSafety'

type Options = { readOnly?: boolean }
export type ColumnRowActionState = {
  visible: boolean
  earlier: boolean
  later: boolean
  previousColumn: boolean
  nextColumn: boolean
  detach: boolean
  ancestor: boolean
  reason?: string
}
const refuse = <T = BoardModel>(detail: string): StructureResult<T> => ({ ok: false, issues: [{ code: 'column-row-command', detail }] })

function selectedRows(board: BoardModel, ids: readonly string[], options: Options): StructureResult<BoardNode[]> {
  if (options.readOnly) return refuse('This workspace is read-only.')
  const valid = validateContainerOwnership(board.nodes)
  if (!valid.ok) return valid
  const requested = new Set(ids)
  if (!requested.size) return refuse('Select a column row first.')
  for (const id of requested) if (!valid.value.has(id)) return refuse('A selected row is no longer on this board.')
  const roots = [...requested].filter((id) => {
    let node = valid.value.get(id)!
    while (node.groupId || node.parentColumnId) {
      const owner = node.groupId || node.parentColumnId!
      if (requested.has(owner)) return false
      node = valid.value.get(owner)!
    }
    return true
  }).map((id) => valid.value.get(id)!)
  if (!roots.length || roots.some((node) => !flowOwnerId(node, board.nodes))) return refuse('Select rows directly owned by a column.')
  const editable = moveContainerWithDescendants(board.nodes, board.connectors, roots.map((node) => node.id), { x: 0, y: 0 })
  return editable.ok ? { ok: true, value: roots } : editable
}

function orderedBlock(board: BoardModel, rows: BoardNode[]): StructureResult<{ columnId: string; ids: string[]; first: number; count: number; total: number }> {
  const columns = new Set(rows.map((row) => flowOwnerId(row, board.nodes)!))
  if (columns.size !== 1) return refuse('Select rows from one column to change their order.')
  const columnId = flowOwnerId(rows[0], board.nodes)!, children = columnChildren(board, columnId), selected = new Set(rows.map((row) => row.id))
  const indexes = children.flatMap((row, index) => selected.has(row.id) ? [index] : [])
  if (indexes.some((index, order) => index !== indexes[0] + order)) return refuse('Select adjacent rows to move them together.')
  return { ok: true, value: { columnId, ids: children.filter((row) => selected.has(row.id)).map((row) => row.id), first: indexes[0], count: indexes.length, total: children.length } }
}

function siblingColumns(board: BoardModel, currentColumnId: string): { previous?: BoardNode; next?: BoardNode } {
  const current = board.nodes.find((n) => n.id === currentColumnId && isFlowColumn(n))
  if (!current) return {}
  const siblings = board.nodes
    .filter((n) => isFlowColumn(n) && n.groupId === current.groupId)
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))
  const index = siblings.findIndex((n) => n.id === currentColumnId)
  if (index < 0) return {}
  return {
    previous: index > 0 ? siblings[index - 1] : undefined,
    next: index < siblings.length - 1 ? siblings[index + 1] : undefined,
  }
}

/** Move one row or an adjacent selected block one row earlier/later. Supplied
 * selection order never changes the saved mixed-content order. */
export function moveColumnRowsResult(board: BoardModel, ids: readonly string[], direction: 'earlier' | 'later', options: Options = {}): StructureResult<BoardModel> {
  const rows = selectedRows(board, ids, options)
  if (!rows.ok) return rows
  const block = orderedBlock(board, rows.value)
  if (!block.ok) return block
  if (direction !== 'earlier' && direction !== 'later') return refuse('Choose whether to move rows earlier or later.')
  const { columnId, first, count, total } = block.value
  if ((direction === 'earlier' && first === 0) || (direction === 'later' && first + count === total)) return { ok: true, value: board }
  const moved = insertNodesIntoColumnResult(board, block.value.ids, { columnId, index: first + (direction === 'earlier' ? -1 : 1) })
  return moved.ok ? validateBoardMutation(board, moved.value, Boolean(options.readOnly)) : moved
}

/** Move one row or an adjacent block to an adjacent sibling column on the board. */
export function moveColumnRowsToSiblingColumnResult(
  board: BoardModel,
  ids: readonly string[],
  direction: 'previous' | 'next',
  options: Options = {}
): StructureResult<BoardModel> {
  const rows = selectedRows(board, ids, options)
  if (!rows.ok) return rows
  const block = orderedBlock(board, rows.value)
  if (!block.ok) return block
  const { previous, next } = siblingColumns(board, block.value.columnId)
  const target = direction === 'previous' ? previous : next
  if (!target) return refuse(`No ${direction} sibling column available.`)
  if (target.locked || target.hidden || target.collapsed) return refuse(`The target column is ${target.locked ? 'locked' : target.hidden ? 'hidden' : 'collapsed'}.`)
  const targetChildren = columnChildren(board, target.id)
  const moved = insertNodesIntoColumnResult(board, block.value.ids, { columnId: target.id, index: targetChildren.length })
  return moved.ok ? validateBoardMutation(board, moved.value, Boolean(options.readOnly)) : moved
}

/** Move selected items out of their immediate column or frame to their ancestor container. */
export function moveSelectionToAncestorResult(
  board: BoardModel,
  ids: readonly string[],
  options: Options = {}
): StructureResult<BoardModel> {
  if (options.readOnly) return refuse('This workspace is read-only.')
  const valid = validateContainerOwnership(board.nodes)
  if (!valid.ok) return valid
  const requested = new Set(ids)
  if (!requested.size) return refuse('Select objects to move to ancestor container.')

  const roots = [...requested].filter((id) => {
    let node = valid.value.get(id)!
    while (node.groupId || node.parentColumnId) {
      const owner = node.groupId || node.parentColumnId!
      if (requested.has(owner)) return false
      node = valid.value.get(owner)!
    }
    return true
  }).map((id) => valid.value.get(id)!)

  if (!roots.length) return refuse('No editable objects selected.')

  const columnRowRoots = roots.filter((node) => flowOwnerId(node, board.nodes))
  if (columnRowRoots.length === roots.length) {
    const column = valid.value.get(flowOwnerId(columnRowRoots[0], board.nodes)!)
    if (column?.groupId) {
      const parentFrame = valid.value.get(column.groupId)
      if (parentFrame && parentFrame.kind === 'group') {
        const released = releaseNodesFromColumnsResult(board, roots.map((r) => r.id))
        if (!released.ok) return released
        const reparented = reparentContainerNodes(released.value.nodes, roots.map((r) => r.id), { kind: 'group', id: parentFrame.id })
        if (!reparented.ok) return reparented
        return validateBoardMutation(board, { ...board, nodes: reparented.value }, Boolean(options.readOnly))
      }
    }
    return detachColumnRowsResult(board, roots.map((r) => r.id), options)
  }

  const groupRoots = roots.filter((node) => node.groupId)
  if (groupRoots.length === roots.length) {
    const parentGroup = valid.value.get(groupRoots[0].groupId!)
    if (parentGroup?.groupId) {
      const grandParent = valid.value.get(parentGroup.groupId)
      if (grandParent && grandParent.kind === 'group') {
        const reparented = reparentContainerNodes(board.nodes, roots.map((r) => r.id), { kind: 'group', id: grandParent.id })
        return reparented.ok ? validateBoardMutation(board, { ...board, nodes: reparented.value }, Boolean(options.readOnly)) : reparented
      }
    }
    const reparented = reparentContainerNodes(board.nodes, roots.map((r) => r.id))
    return reparented.ok ? validateBoardMutation(board, { ...board, nodes: reparented.value }, Boolean(options.readOnly)) : reparented
  }

  const released = releaseNodesFromColumnsResult(board, roots.map((r) => r.id))
  if (!released.ok) return released
  const reparented = reparentContainerNodes(released.value.nodes, roots.map((r) => r.id))
  return reparented.ok ? validateBoardMutation(board, { ...board, nodes: reparented.value }, Boolean(options.readOnly)) : reparented
}

/** Release rows through the same source reflow/free-frame restoration as a
 * pointer detach, retaining their current world position and all source bytes. */
export function detachColumnRowsResult(board: BoardModel, ids: readonly string[], options: Options = {}): StructureResult<BoardModel> {
  const rows = selectedRows(board, ids, options)
  if (!rows.ok) return rows
  const released = releaseNodesFromColumnsResult(board, rows.value.map((row) => row.id))
  return released.ok ? validateBoardMutation(board, released.value, Boolean(options.readOnly)) : released
}

export function columnRowActionState(board: BoardModel, ids: readonly string[], options: Options = {}): ColumnRowActionState {
  const visible = ids.some((id) => board.nodes.some(node => node.id === id && flowOwnerId(node, board.nodes)))
  const rows = selectedRows(board, ids, options)
  if (!rows.ok) return { visible, earlier: false, later: false, previousColumn: false, nextColumn: false, detach: false, ancestor: false, reason: rows.issues[0]?.detail }
  const block = orderedBlock(board, rows.value)
  if (!block.ok) return { visible, earlier: false, later: false, previousColumn: false, nextColumn: false, detach: true, ancestor: true, reason: block.issues[0]?.detail }
  const { previous, next } = siblingColumns(board, block.value.columnId)
  return {
    visible,
    earlier: block.value.first > 0,
    later: block.value.first + block.value.count < block.value.total,
    previousColumn: Boolean(previous && !previous.locked && !previous.hidden && !previous.collapsed),
    nextColumn: Boolean(next && !next.locked && !next.hidden && !next.collapsed),
    detach: true,
    ancestor: true,
  }
}
