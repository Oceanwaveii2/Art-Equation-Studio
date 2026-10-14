import { useMemo, useState } from 'react'
import type { BoardModel } from '../model/project'
import { acceptLayoutProposal, createLayoutGuide, createManualGuide, groupHierarchySuggestion, moveLayoutGuide, proposeLayout, suggestLayoutHierarchy, type LayoutProposal } from './layoutResearch'
import './LayoutResearchPanel.css'

export function PersistentGuideLayer({ board }: { board: BoardModel }) {
  return <svg className="persistent-layout-guides" aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>
    {(board.layoutGuides || []).map((guide) => {
      const members = board.nodes.filter((node) => guide.members.some((member) => member.id === node.id))
      if (!members.length && guide.mode !== 'manual') return null
      const lo = guide.mode === 'manual' ? -(guide.axis === 'x' ? board.viewport.y : board.viewport.x) / board.viewport.scale : Math.min(...members.map((node) => guide.axis === 'x' ? node.y : node.x)) - 24
      const hi = guide.mode === 'manual' ? lo + 10000 / board.viewport.scale : Math.max(...members.map((node) => guide.axis === 'x' ? node.y + node.height : node.x + node.width)) + 24
      return <line key={guide.id} x1={guide.axis === 'x' ? guide.position : lo} x2={guide.axis === 'x' ? guide.position : hi} y1={guide.axis === 'y' ? guide.position : lo} y2={guide.axis === 'y' ? guide.position : hi} stroke="#c084fc" strokeDasharray="7 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    })}
  </svg>
}

export function LayoutPlanPreview({ before, after }: { before: BoardModel; after: BoardModel }) {
  const nodes = [...before.nodes, ...after.nodes]
  const x = Math.min(0, ...nodes.map((node) => node.x)), y = Math.min(0, ...nodes.map((node) => node.y))
  const w = Math.max(1, ...nodes.map((node) => node.x + node.width)) - x, h = Math.max(1, ...nodes.map((node) => node.y + node.height)) - y
  return <svg role="img" aria-label="Layout preview: dashed original positions and colored proposed positions" viewBox={`${x - 20} ${y - 20} ${w + 40} ${h + 40}`}>
    {before.nodes.map((node) => <rect key={`old-${node.id}`} x={node.x} y={node.y} width={node.width} height={node.height} fill="none" stroke="#9ca3af" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />)}
    {after.nodes.map((node) => <g key={node.id}><rect x={node.x} y={node.y} width={node.width} height={node.height} fill={node.locked ? '#705843' : '#267e78'} fillOpacity={.35} stroke="#5eead4" vectorEffect="non-scaling-stroke" /><title>{node.title || node.id}{node.locked ? ' (locked)' : ''}</title></g>)}
  </svg>
}

export function LayoutResearchPanel({ board, boards, selectedIds, onChange, onNavigate, onClose }: {
  board: BoardModel; boards: BoardModel[]; selectedIds: string[]; onChange: (board: BoardModel) => unknown; onNavigate: (id: string) => void; onClose: () => void
}) {
  const [mode, setMode] = useState<'rows' | 'columns'>('rows'), [gap, setGap] = useState(24)
  const [proposal, setProposal] = useState<LayoutProposal | null>(null), [notice, setNotice] = useState('')
  const hierarchy = useMemo(() => suggestLayoutHierarchy(board), [board])
  const trail: BoardModel[] = []; let current: BoardModel | undefined = board; const seen = new Set<string>()
  while (current && !seen.has(current.id)) { trail.unshift(current); seen.add(current.id); current = boards.find((entry) => entry.id === current!.parentBoardId) }
  const apply = () => { if (!proposal) return; const next = acceptLayoutProposal(board, proposal); if (!next) { setNotice('The board changed. Generate a fresh preview.'); return }; if (onChange(next) !== false) { setProposal(null); setNotice('Layout applied. Canvas Undo restores the previous layout.') } }
  return <aside className="layout-research-panel" role="dialog" aria-label="Layout research tools">
    <header><h2>Layout tools</h2><button type="button" onClick={onClose} aria-label="Close layout tools">×</button></header>
    <nav aria-label="Board breadcrumbs">{trail.map((entry, index) => <span key={entry.id}>{index > 0 && ' / '}<button type="button" onClick={() => onNavigate(entry.id)}>{entry.title}</button></span>)}</nav>
    <section><h3>Constrained arrangement</h3><p>Preserves card sizes, column contents, nested board links and locked families. Preview before applying.</p>
      <label>Flow <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="rows">Rows</option><option value="columns">Columns</option></select></label>
      <label>Gap <input type="number" min="0" max="1000" value={gap} onChange={(event) => setGap(Math.min(1000, Math.max(0, Number(event.target.value))))} /></label>
      <button type="button" onClick={() => { setProposal(proposeLayout(board, selectedIds, mode, gap)); setNotice('') }}>Preview {selectedIds.length ? 'selection' : 'board'}</button>
      {proposal && <><LayoutPlanPreview before={board} after={proposal.board} /><p>{proposal.moved} root objects move; dashed outlines show original positions.</p>{proposal.warnings.map((warning) => <p key={warning}>{warning}</p>)}<button type="button" disabled={!proposal.moved} onClick={apply}>Apply layout</button><button type="button" onClick={() => setProposal(null)}>Discard</button></>}
    </section>
    <section><h3>Persistent guides</h3><p>Bind selected free objects or containers. Moving the guide moves each whole family. Individual moves remain as optical offsets.</p>
      {(['x', 'y'] as const).map(axis => <button key={'manual-' + axis} type="button" onClick={() => onChange({ ...board, layoutGuides: [...(board.layoutGuides || []), createManualGuide(axis, -board.viewport[axis] / board.viewport.scale + 100)] })}>Add {axis === 'x' ? 'vertical' : 'horizontal'} ruler guide</button>)}
      {(['x', 'y'] as const).map((axis) => <button key={axis} type="button" disabled={selectedIds.length < 2} onClick={() => { const guide = createLayoutGuide(board, selectedIds, axis, 'start'); if (!guide) { setNotice('Select at least two unlocked top-level objects.'); return }; onChange({ ...board, layoutGuides: [...(board.layoutGuides || []), guide] }) }}>Keep {axis === 'x' ? 'vertical' : 'horizontal'} relationship</button>)}
      {(board.layoutGuides || []).map((guide) => <div key={guide.id}><label>{guide.title} <input aria-label={`${guide.title} position`} type="number" step="any" value={guide.position} onChange={(event) => { const next = moveLayoutGuide(board, guide.id, Number(event.target.value)); if (next === board) setNotice('Guide movement blocked by a lock or ownership change.'); else onChange(next) }} /></label><small>{guide.mode === 'manual' ? 'Independent ruler guide' : guide.members.length + ' objects · offsets retained'}</small><button type="button" onClick={() => onChange({ ...board, layoutGuides: board.layoutGuides?.filter((entry) => entry.id !== guide.id) })}>Release guide</button></div>)}
    </section>
    <section><h3>Possible text relationships</h3><p>Spatial suggestions, requiring your review. No text is attached automatically.</p>{hierarchy.map((suggestion) => <p key={suggestion.childId}><strong>{board.nodes.find((node) => node.id === suggestion.childId)?.title || suggestion.childId}</strong> → {board.nodes.find((node) => node.id === suggestion.parentId)?.title}<br />{suggestion.reason}<button type="button" onClick={() => { const next = groupHierarchySuggestion(board, suggestion); if (next === board) setNotice('This relationship changed or contains protected content.'); else onChange(next) }}>Group media and text</button></p>)}{!hierarchy.length && <p>No unambiguous nearby text candidates.</p>}</section>
    <section><h3>Subboards in this layout</h3><p>Subboards remain real board portals. A column is their visual container; ownership and navigation stay independent.</p>{board.nodes.filter((node) => node.targetBoardId).map((node) => { const target = boards.find((entry) => entry.id === node.targetBoardId); return <div key={node.id}><button type="button" disabled={!target} onClick={() => target && onNavigate(target.id)}>{target?.title || node.title}</button><small>{node.parentColumnId ? `In column: ${board.nodes.find((entry) => entry.id === node.parentColumnId)?.title || node.parentColumnId}` : 'Free on canvas'} · {node.boardLinkRole === 'child' || node.boardPortal ? 'Owned subboard' : 'Shortcut'}</small></div> })}</section>
    {notice && <p role="status">{notice}</p>}
  </aside>
}
