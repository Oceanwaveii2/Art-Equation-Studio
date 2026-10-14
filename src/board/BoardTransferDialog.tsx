import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BoardModel } from '../model/project'
import { boardAncestors } from './boardHierarchy'
import { useModalFocus } from '../ui/useModalFocus'

type Props = { board: BoardModel; boards: BoardModel[]; selectedIds: string[]; onMove: (destinationId: string) => boolean; onClose: () => void }
export function BoardTransferDialog({ board, boards, selectedIds, onMove, onClose }: Props) {
  const dialog = useRef<HTMLElement>(null), select = useRef<HTMLSelectElement>(null)
  const targets = useMemo(() => boards.filter((entry) => entry.id !== board.id), [boards, board.id])
  const [targetId, setTargetId] = useState(targets[0]?.id || '')
  const count = selectedIds.length
  useModalFocus(dialog, select)
  return createPortal(<div className="text-entry-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <section ref={dialog} className="text-entry-dialog board-transfer-dialog" role="dialog" aria-modal="true" aria-label="Move to board" tabIndex={-1}>
      <header><h2>Move to board</h2><button type="button" aria-label="Close move to board" onClick={onClose}>×</button></header>
      <p>{count} selected object{count === 1 ? '' : 's'} from {board.title}. Container members and complete mind-map trees move together.</p>
      <label>Destination<select ref={select} aria-label="Destination board" value={targetId} onChange={(event) => setTargetId(event.target.value)}>{targets.map((entry) => <option key={entry.id} value={entry.id}>{[...boardAncestors(boards, entry.id), entry].map((item) => item.title).join(' / ')}</option>)}</select></label>
      <p id="transfer-policy">Internal connections move with their objects. Connections to objects left behind stay here with a detached endpoint. Owned subboards keep their contents and become children of the destination. Disk files stay in place.</p>
      <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="button" disabled={!targetId} aria-describedby="transfer-policy" onClick={() => { if (onMove(targetId)) onClose() }}>Move objects</button></footer>
    </section>
  </div>, document.querySelector('.studio-shell') || document.body)
}
