import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import './MediaHealthReview.css'

export type MediaHealthReviewProps = { readOnly: boolean; onClose: () => void }
export type MediaReviewKind = 'Image' | 'Video' | 'Document'
export type OriginalHealth = 'available' | 'missing'
export type PreviewHealth = 'ready' | 'pending' | 'decode-failed' | 'unavailable'
export type RelinkFileMetadata = {
  name: string
  size: number
  type: string
  lastModified: number
}
export type MediaReviewItem = {
  readonly id: string
  readonly name: string
  readonly kind: MediaReviewKind
  readonly originalName: string
  readonly originalSource: string
  readonly originalHealth: OriginalHealth
  readonly previewHealth: PreviewHealth
  readonly board: 'House master' | 'Research board'
  readonly dimensions: string
  readonly placements: number
  readonly tile: 'house' | 'water' | 'reference' | 'missing' | 'color' | 'layout'
  readonly retryRequests: number
  readonly relinkProposal?: RelinkFileMetadata
}

// Representative UI fixtures only. These paths do not address project files.
export const MEDIA_REVIEW_FIXTURES: readonly MediaReviewItem[] = [
  { id: 'sample-house', name: 'House study', kind: 'Image', originalName: 'House study.png', originalSource: 'sample://originals/House study.png', originalHealth: 'available', previewHealth: 'ready', board: 'House master', dimensions: '580 × 480 px', placements: 2, tile: 'house', retryRequests: 0 },
  { id: 'sample-water', name: 'Water texture', kind: 'Image', originalName: 'Water texture.png', originalSource: 'sample://originals/Water texture.png', originalHealth: 'available', previewHealth: 'pending', board: 'House master', dimensions: '1920 × 120 px', placements: 1, tile: 'water', retryRequests: 0 },
  { id: 'sample-reference', name: 'Board reference', kind: 'Video', originalName: 'Board reference.mp4', originalSource: 'sample://originals/Board reference.mp4', originalHealth: 'available', previewHealth: 'decode-failed', board: 'House master', dimensions: '1920 × 1080 px · video', placements: 1, tile: 'reference', retryRequests: 0 },
  { id: 'sample-missing', name: 'Missing image', kind: 'Image', originalName: 'Missing image.jpg', originalSource: 'sample://originals/Missing image.jpg', originalHealth: 'missing', previewHealth: 'unavailable', board: 'House master', dimensions: 'Recorded size: 1200 × 800 px', placements: 1, tile: 'missing', retryRequests: 0 },
  { id: 'sample-color', name: 'Color study', kind: 'Image', originalName: 'Color study.png', originalSource: 'sample://originals/Color study.png', originalHealth: 'available', previewHealth: 'ready', board: 'Research board', dimensions: '640 × 480 px', placements: 0, tile: 'color', retryRequests: 0 },
  { id: 'sample-layout', name: 'Layout reference', kind: 'Document', originalName: 'Layout reference.pdf', originalSource: 'sample://originals/Layout reference.pdf', originalHealth: 'available', previewHealth: 'pending', board: 'Research board', dimensions: 'Document · preview not generated', placements: 1, tile: 'layout', retryRequests: 0 },
]

const originalLabels: Record<OriginalHealth, string> = { available: 'Original available', missing: 'Original missing' }
const previewLabels: Record<PreviewHealth, string> = {
  ready: 'Preview ready', pending: 'Thumbnail pending', 'decode-failed': 'Preview decode failed', unavailable: 'Preview unavailable',
}

export type MediaReviewAction =
  | { type: 'retry'; ids: readonly string[] }
  | { type: 'propose-relink'; id: string; file: RelinkFileMetadata }

/** A UI-only transaction. It never changes recorded original or decoder health. */
export function applyMediaReviewSimulation(items: readonly MediaReviewItem[], action: MediaReviewAction, readOnly: boolean): {
  items: readonly MediaReviewItem[]; changed: boolean; message: string
} {
  if (readOnly) return { items, changed: false, message: 'Read-only review: Retry and Relink changes are blocked.' }
  if (action.type === 'retry') {
    const ids = new Set(action.ids)
    let count = 0
    const next = items.map(item => {
      if (!ids.has(item.id) || item.originalHealth !== 'available' || !['pending', 'decode-failed'].includes(item.previewHealth)) return item
      count += 1
      return { ...item, retryRequests: item.retryRequests + 1 }
    })
    return count ? { items: next, changed: true, message: `Simulated retry recorded for ${count} ${count === 1 ? 'source' : 'sources'}. No decoder ran; recorded preview health is unchanged.` }
      : { items, changed: false, message: 'No selected source can retry: select an available original with a pending or failed preview.' }
  }
  const target = items.find(item => item.id === action.id)
  if (!target || !action.file.name || !Number.isFinite(action.file.size) || action.file.size < 0 || !Number.isFinite(action.file.lastModified)) {
    return { items, changed: false, message: 'Relink proposal refused: select an existing source and a valid local file.' }
  }
  const file = { name: action.file.name, size: action.file.size, type: action.file.type, lastModified: action.file.lastModified }
  return {
    items: items.map(item => item.id === target.id ? { ...item, relinkProposal: file } : item), changed: true,
    message: `Relink metadata proposed for ${target.name}. Identity and original source retained; file bytes, disk writes and decoder success are unverified.`,
  }
}

export type MediaReviewFilters = {
  query: string
  scope: 'all' | 'current' | 'unplaced'
  kind: 'all' | MediaReviewKind
  health: 'all' | 'attention' | 'missing' | 'pending' | 'decode-failed' | 'ready'
}

export function filterMediaReviewItems(items: readonly MediaReviewItem[], filters: MediaReviewFilters): readonly MediaReviewItem[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return items.filter(item => {
    if (filters.scope === 'current' && item.board !== 'House master') return false
    if (filters.scope === 'unplaced' && item.placements !== 0) return false
    if (filters.kind !== 'all' && item.kind !== filters.kind) return false
    if (filters.health === 'attention' && item.originalHealth !== 'missing' && item.previewHealth === 'ready') return false
    if (filters.health === 'missing' && item.originalHealth !== 'missing') return false
    if (['pending', 'decode-failed', 'ready'].includes(filters.health) && item.previewHealth !== filters.health) return false
    return !query || [item.id, item.name, item.originalName, item.originalSource, item.board, item.kind, item.relinkProposal?.name ?? ''].join(' ').toLocaleLowerCase().includes(query)
  })
}

function displayBytes(size: number) {
  return size < 1024 ? `${size} bytes` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function MediaHealthReview({ readOnly, onClose }: MediaHealthReviewProps) {
  const prefix = useId()
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const picker = useRef<HTMLInputElement>(null)
  const pickerTarget = useRef<string | null>(null)
  const [items, setItems] = useState<readonly MediaReviewItem[]>(MEDIA_REVIEW_FIXTURES)
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(['sample-house'])
  const [filters, setFilters] = useState<MediaReviewFilters>({ query: '', scope: 'all', kind: 'all', health: 'all' })
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [draft, setDraft] = useState<{ id: string; file: RelinkFileMetadata } | null>(null)
  const [message, setMessage] = useState('Six representative sources. Selection, search and filters are available; all mutation results are simulations.')
  const visible = useMemo(() => filterMediaReviewItems(items, filters), [items, filters])
  const selected = items.filter(item => selectedIds.includes(item.id))
  const single = selected.length === 1 ? selected[0] : undefined
  const hiddenSelectedCount = selected.filter(item => !visible.some(row => row.id === item.id)).length
  const retryable = selected.filter(item => item.originalHealth === 'available' && ['pending', 'decode-failed'].includes(item.previewHealth))
  const selectionKey = selectedIds.join('|')

  useEffect(() => {
    pickerTarget.current = null
    setDraft(null)
    if (picker.current) picker.current.value = ''
  }, [readOnly, selectionKey])

  function chooseSelection(ids: readonly string[]) {
    pickerTarget.current = null
    setDraft(null)
    setSelectedIds(ids)
  }

  function toggleSelection(id: string) {
    chooseSelection(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id])
  }

  function retrySelected() {
    // Guard the callback as well as its button, including a changed permission.
    const result = applyMediaReviewSimulation(items, { type: 'retry', ids: selectedIds }, readOnlyRef.current)
    if (result.changed) setItems(result.items)
    setMessage(result.message)
  }

  function chooseRelinkFile() {
    if (readOnlyRef.current) { setMessage('Read-only review: local file chooser was not opened.'); return }
    if (!single) { setMessage('Select exactly one source to propose a relink.'); return }
    pickerTarget.current = single.id
    setDraft(null)
    if (picker.current) { picker.current.value = ''; picker.current.click() }
  }

  function receiveFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    const target = pickerTarget.current
    event.currentTarget.value = ''
    pickerTarget.current = null
    if (readOnlyRef.current) { setDraft(null); setMessage('Read-only review: the file result was refused; original metadata is unchanged.'); return }
    if (!file) { setMessage('No local file selected; original metadata is unchanged.'); return }
    if (!target || single?.id !== target) { setMessage('Selection changed while choosing a file. Select a source and choose again.'); return }
    setDraft({ id: target, file: { name: file.name, size: file.size, type: file.type, lastModified: file.lastModified } })
    setMessage('Local file metadata read. Review the proposal before applying its simulated metadata; no file bytes were read.')
  }

  function applyProposal() {
    if (!draft || single?.id !== draft.id) { setMessage('Relink proposal expired because the selection changed.'); return }
    const result = applyMediaReviewSimulation(items, { type: 'propose-relink', id: draft.id, file: draft.file }, readOnlyRef.current)
    if (result.changed) setItems(result.items)
    setDraft(null)
    setMessage(result.message)
  }

  const mutationReason = readOnly ? 'Read-only review blocks changes.' : undefined

  return <section className="media-health-review" aria-labelledby={`${prefix}-title`} data-readonly={readOnly}>
    <header className="mh-header">
      <div><p className="mh-eyebrow">Media / Mini Bridge</p><h2 id={`${prefix}-title`}>Source health review</h2><p>House master · representative local browser state</p></div>
      <button type="button" className="mh-done" onClick={onClose}>Done</button>
    </header>
    <div className="mh-scope-note"><strong>{readOnly ? 'Read-only review' : 'Browser simulation'}</strong><span>Original availability and preview health are separate. These six sample sources are not your project files. {readOnly ? 'Selection and navigation remain available; Retry and Relink are blocked.' : 'Retry and Relink record local review metadata only.'}</span></div>
    <div className="mh-filters">
      <label className="mh-field mh-search" htmlFor={`${prefix}-search`}>Search sample sources<input id={`${prefix}-search`} data-media-initial-focus type="search" placeholder="Name, source path or proposed file…" value={filters.query} onChange={event => setFilters({ ...filters, query: event.target.value })} /></label>
      <label className="mh-field" htmlFor={`${prefix}-scope`}>Source scope<select id={`${prefix}-scope`} value={filters.scope} onChange={event => setFilters({ ...filters, scope: event.target.value as MediaReviewFilters['scope'] })}><option value="all">All sample sources</option><option value="current">Current board</option><option value="unplaced">Unplaced sources</option></select></label>
      <label className="mh-field" htmlFor={`${prefix}-kind`}>Type<select id={`${prefix}-kind`} value={filters.kind} onChange={event => setFilters({ ...filters, kind: event.target.value as MediaReviewFilters['kind'] })}><option value="all">All types</option><option>Image</option><option>Video</option><option>Document</option></select></label>
      <label className="mh-field" htmlFor={`${prefix}-health`}>Health<select id={`${prefix}-health`} value={filters.health} onChange={event => setFilters({ ...filters, health: event.target.value as MediaReviewFilters['health'] })}><option value="all">All health states</option><option value="attention">Needs attention</option><option value="missing">Original missing</option><option value="pending">Thumbnail pending</option><option value="decode-failed">Decode failed</option><option value="ready">Preview ready</option></select></label>
    </div>
    <div className="mh-selection-bar">
      <p><strong>{selected.length} selected</strong> · {visible.length} of {items.length} shown{hiddenSelectedCount > 0 && <span className="mh-hidden-count"> · {hiddenSelectedCount} selected outside this filter</span>}</p>
      <div className="mh-selection-actions"><button type="button" disabled={!visible.length} onClick={() => chooseSelection(visible.map(item => item.id))}>Select shown</button><button type="button" disabled={!selected.length} onClick={() => chooseSelection([])}>Clear selection</button><div className="mh-view-switch" role="group" aria-label="Source view"><button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button></div></div>
    </div>
    <div className="mh-content">
      <section className={`mh-source-list mh-${view}`} aria-label="Sample sources">
        {visible.map(item => <article className="mh-source" data-selected={selectedIds.includes(item.id)} key={item.id}>
          <div className={`mh-tile mh-tile-${item.tile}`} aria-hidden="true"><span>{item.tile === 'house' ? '⌂' : item.tile === 'reference' ? '▷' : item.tile === 'missing' ? '?' : item.tile === 'layout' ? '▤' : '◈'}</span><small>Sample tile</small></div>
          <div className="mh-source-info"><div className="mh-source-title"><input id={`${prefix}-${item.id}`} type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelection(item.id)} aria-label={`Select ${item.name}`} /><button type="button" className="mh-inspect-name" aria-label={`Inspect ${item.name}`} onClick={() => chooseSelection([item.id])}>{item.name}</button></div>
            <p className="mh-source-meta">{item.kind} · {item.board}</p>
            <p className="mh-health-line" data-health={item.originalHealth}><span className="mh-health-dot" />{originalLabels[item.originalHealth]}</p>
            <p className="mh-health-line" data-health={item.previewHealth}><span className="mh-health-dot" />{previewLabels[item.previewHealth]}</p>
            {(item.retryRequests > 0 || item.relinkProposal) && <p className="mh-local-change">{item.relinkProposal ? 'Relink proposal recorded · simulation' : `Retry requested ×${item.retryRequests} · simulation`}</p>}
          </div>
        </article>)}
        {!visible.length && <div className="mh-empty"><h3>No matching sample sources</h3><p>Change the search or filters. {selected.length > 0 ? 'Your existing selection remains in the Inspector.' : 'No source is selected.'}</p><button type="button" onClick={() => setFilters({ query: '', scope: 'all', kind: 'all', health: 'all' })}>Reset filters</button></div>}
      </section>
      <aside className="mh-inspector" aria-labelledby={`${prefix}-inspector`}>
        <h3 id={`${prefix}-inspector`}>Source Inspector</h3>
        {!selected.length ? <p className="mh-muted">Select one source for its identity, original and preview details. Select several to review their health together.</p> : single ? <>
          <h4>{single.name}</h4><dl className="mh-details"><dt>Identity retained</dt><dd><code>{single.id}</code></dd><dt>Type / size</dt><dd>{single.kind} · {single.dimensions}</dd><dt>Original name</dt><dd>{single.originalName}</dd><dt>Original source (sample)</dt><dd className="mh-path">{single.originalSource}</dd><dt>Original status</dt><dd>{originalLabels[single.originalHealth]}</dd><dt>Preview status</dt><dd>{previewLabels[single.previewHealth]}</dd><dt>Placements</dt><dd>{single.placements} · {single.board}</dd></dl>
          <p className="mh-health-explanation">{single.originalHealth === 'missing' ? 'The recorded original is missing. A relink proposal does not prove that the file is restored.' : single.previewHealth === 'decode-failed' ? 'Preview decoding failed. The sample original remains available; this is not source loss.' : single.previewHealth === 'pending' ? 'The sample original is available. Its thumbnail has not been generated.' : 'This scenario records an available original and ready preview. The tile is illustrative, not a decoded file.'}</p>
          {single.retryRequests > 0 && <p className="mh-local-change">Simulated Retry requests: {single.retryRequests}. Recorded health is unchanged.</p>}
          {single.relinkProposal && <section className="mh-proposal-record" aria-label="Recorded relink proposal"><h4>Relink proposal · simulation</h4><p>{single.relinkProposal.name} · {displayBytes(single.relinkProposal.size)}</p><p>{single.relinkProposal.type || 'Type not provided'}</p><p>Original identity, name and source remain above. No restoration or successful decode is claimed.</p></section>}
        </> : <><h4>{selected.length} sources selected</h4><p className="mh-muted">The Inspector uses the same selected identities as the source list, including filtered-out selections.</p><dl className="mh-details"><dt>Originals available</dt><dd>{selected.filter(item => item.originalHealth === 'available').length}</dd><dt>Originals missing</dt><dd>{selected.filter(item => item.originalHealth === 'missing').length}</dd><dt>Pending thumbnails</dt><dd>{selected.filter(item => item.previewHealth === 'pending').length}</dd><dt>Decode failures</dt><dd>{selected.filter(item => item.previewHealth === 'decode-failed').length}</dd></dl><ul className="mh-selected-names">{selected.map(item => <li key={item.id}>{item.name}{!visible.some(row => row.id === item.id) && <small> · outside filter</small>}</li>)}</ul></>}
        <div className="mh-mutation-actions"><button type="button" disabled={readOnly || !retryable.length} title={mutationReason ?? (!retryable.length ? 'Select an available original with a pending or failed preview.' : 'Records a simulated request; no decoder runs.')} onClick={retrySelected}>Retry preview · simulation</button><button type="button" disabled={readOnly || !single} title={mutationReason ?? (!single ? 'Select exactly one source.' : 'Choose local file metadata; preserve the original source.')} onClick={chooseRelinkFile}>Relink source…</button></div>
        <p className="mh-muted">{readOnly ? 'Read-only: file chooser, Retry and proposal changes are blocked.' : 'Relink accepts file metadata only. Choose one source; review before applying a proposal.'}</p>
        {draft && single?.id === draft.id && <section className="mh-relink-draft" aria-labelledby={`${prefix}-proposal`}><h4 id={`${prefix}-proposal`}>Review local file proposal</h4><p><strong>{draft.file.name}</strong></p><p>{displayBytes(draft.file.size)} · {draft.file.type || 'Type not provided'}</p><p>File bytes are not read. This proposal will retain <code>{draft.id}</code> and its original source.</p><button type="button" disabled={readOnly} onClick={applyProposal}>Apply proposal · simulation</button><button type="button" onClick={() => { setDraft(null); setMessage('Relink proposal cancelled. Original metadata is unchanged.') }}>Cancel proposal</button></section>}
        <input ref={picker} type="file" hidden tabIndex={-1} aria-label="Choose local relink proposal file" disabled={readOnly} onChange={receiveFile} />
      </aside>
    </div>
    <p className="mh-feedback" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    <footer className="mh-footer">Local review state resets when this component closes. No project import, filesystem replacement, decoder, thumbnail worker or persistence is connected. Parent modal owns focus and Escape.</footer>
  </section>
}
