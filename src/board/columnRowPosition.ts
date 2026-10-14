import type { BoardModel } from '../model/project'
import { containerDescendantIds, type StructureResult } from './diagramStructureCore'

export const COLUMN_ROW_POSITION_REASON = 'Detach from column to position freely.'

/** Explicit row-only position commands must not create geometry that hydration
 * discards. Canonical column layout and resize use their existing internal
 * movement helpers; this guard applies only at user position command boundaries. */
export function guardColumnRowPosition(board: BoardModel, ids: readonly string[]): StructureResult<BoardModel> {
  const closure = containerDescendantIds(board.nodes, ids)
  if (!closure.ok) return closure
  const moving = new Set(closure.value)
  for (const node of board.nodes) if (moving.has(node.id) && (node.parentColumnId || board.nodes.some(owner => owner.id === node.groupId && owner.graphColumn)) && !moving.has(node.parentColumnId || node.groupId!)) {
    return { ok: false, issues: [{ code: 'column-row-position', nodeId: node.id, detail: COLUMN_ROW_POSITION_REASON }] }
  }
  return { ok: true, value: board }
}
