import type { BoardModel, BoardNode } from '../model/project'

export const SUBBOARD_ROW_HEIGHT = 72
export const isSubboardPortal = (node: BoardNode) => node.kind === 'board-link' && node.boardLinkRole === 'child' && Boolean(node.boardPortal)
/** Saved wide reference rows remain rows even when nested in a label family. */
export const subboardPresentation = (node: BoardNode) => node.parentColumnId || node.width >= node.height * 2 ? 'row' : 'tile'

export type SubboardSummary = { cards: number; files: number; label: string }
const summaries = new WeakMap<BoardModel, SubboardSummary>()
/** Board identity is immutable. Camera changes reuse counts without walking
 * inactive boards or decoding their assets. Count placements, not media bytes. */
export function subboardSummary(board: BoardModel): SubboardSummary {
  const cached = summaries.get(board)
  if (cached) return cached
  let cards = 0, files = 0
  for (const node of board.nodes) {
    if (node.hidden || node.layoutBackground || node.kind === 'column' || node.kind === 'group') continue
    if (node.assetId) files++
    else cards++
  }
  const label = `${cards} ${cards === 1 ? 'card' : 'cards'}${files ? `, ${files} ${files === 1 ? 'file' : 'files'}` : ''}`
  const result = { cards, files, label }
  summaries.set(board, result)
  return result
}
