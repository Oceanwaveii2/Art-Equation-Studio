import { useCallback, useLayoutEffect, useRef } from 'react'
import type { BoardModel } from '../model/project'

/** Gesture previews are presented outside React. Only final commands reach persistence. */
export function useGestureBoard(persisted: BoardModel, commit: (board: BoardModel, historyBase?: BoardModel | null, mergeKey?: string) => void, presenter: { present(base: BoardModel, next: BoardModel): void; clear(committed?: BoardModel): void; repaint(): void }) {
  const active = useRef(false)
  const currentBoard = useRef(persisted)
  useLayoutEffect(() => {
    const previous = currentBoard.current
    currentBoard.current = persisted
    if (previous !== persisted) { active.current = false; presenter.clear(persisted) }
  }, [persisted, presenter])
  useLayoutEffect(() => { presenter.repaint() })
  useLayoutEffect(() => () => presenter.clear(), [presenter])
  const beginPreview = useCallback(() => { active.current = true }, [])
  const endPreview = useCallback(() => { active.current = false; presenter.clear() }, [presenter])
  const change = useCallback((board: BoardModel, historyBase?: BoardModel | null, mergeKey?: string) => {
    // An undo or external command can replace the board during a drag. Old
    // gesture callbacks must never overwrite that newer committed snapshot.
    if (currentBoard.current !== persisted) return
    if (active.current && historyBase === null) {
      presenter.present(persisted, board)
    } else {
      presenter.clear()
      if (board !== persisted || historyBase !== null) commit(board, historyBase, mergeKey)
    }
  }, [persisted, commit, presenter])
  return { board: persisted, change, beginPreview, endPreview }
}
