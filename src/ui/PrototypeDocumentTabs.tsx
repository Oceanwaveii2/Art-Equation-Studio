import { requestAppFrame } from '../canvas-engine/appFrameClock'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import './PrototypeDocumentTabs.css'

export type DocumentTabItem = { id: string; title: string }
export const documentPanelId = (id: string) => 'integration-document-panel-' + encodeURIComponent(id)
export const documentTabId = (id: string) => 'integration-document-tab-' + encodeURIComponent(id)

type Props = {
  documents: DocumentTabItem[]
  openIds: string[]
  activeId: string
  readOnly: boolean
  onOpen: (id: string) => void
  onClose: (id: string) => void
  onCreate: () => void
}

/** Open document views are independent of saved documents and board navigation. */
export function PrototypeDocumentTabs({ documents, openIds, activeId, readOnly, onOpen, onClose, onCreate }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const chooser = useRef<HTMLDetailsElement>(null)
  const [query, setQuery] = useState('')
  const open = openIds.map(id => documents.find(item => item.id === id)).filter((item): item is DocumentTabItem => !!item)
  const selected = open.some(item => item.id === activeId) ? activeId : open[0]?.id
  const focusTab = (id?: string) => requestAppFrame(() => {
    const target = id ? document.getElementById(documentTabId(id)) : chooser.current?.querySelector('summary')
    if (target instanceof HTMLElement) target.focus({ preventScroll: true })
  })
  const close = (id: string) => {
    const index = open.findIndex(item => item.id === id)
    const remaining = open.filter(item => item.id !== id)
    onClose(id)
    focusTab(id === activeId ? remaining[Math.min(index, remaining.length - 1)]?.id : activeId)
  }
  const key = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === 'Delete') {
      event.preventDefault()
      event.stopPropagation()
      close(id)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const index = open.findIndex(item => item.id === id)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? open.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + open.length) % open.length
    const target = open[next]
    if (target) { onOpen(target.id); focusTab(target.id) }
  }
  const choose = (id: string) => {
    onOpen(id)
    if (chooser.current) chooser.current.open = false
    setQuery('')
    focusTab(id)
  }
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (chooser.current && !chooser.current.contains(event.target as Node)) chooser.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  useEffect(() => {
    document.getElementById(documentTabId(activeId))?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, openIds])
  const matches = documents.filter(item => item.title.toLowerCase().includes(query.toLowerCase()))
  return <div className="p25-document-tabs" ref={root}>
    <div role="tablist" aria-label="Open documents" aria-owns={open.map(item => documentTabId(item.id)).join(" ")} />
    <div className="p25-document-tabs-track">
      {open.map(item => <div className={'p25-document-tab' + (item.id === activeId ? ' selected' : '')} key={item.id} role="presentation">
        <button type="button" role="tab" id={documentTabId(item.id)} aria-controls={documentPanelId(item.id)} aria-selected={item.id === activeId} tabIndex={item.id === selected ? 0 : -1} title={item.title} onClick={() => onOpen(item.id)} onKeyDown={event => key(event, item.id)}><span aria-hidden="true">¶</span><span>{item.title}</span></button>
        <button type="button" className="p25-document-tab-close" tabIndex={-1} aria-label={'Close document tab: ' + item.title} title="Close tab · Delete when tab is focused" onClick={() => close(item.id)}><span aria-hidden="true">×</span></button>
      </div>)}
      {!open.length && <span className="p25-no-document-tabs">No open documents</span>}
    </div>
    <details className="p25-document-chooser" ref={chooser} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (chooser.current) chooser.current.open = false; chooser.current?.querySelector('summary')?.focus() }
    }} onToggle={event => { if ((event.target as HTMLDetailsElement).open) requestAppFrame(() => chooser.current?.querySelector('input')?.focus()) }}>
      <summary aria-label="Open or create a document" title="Open or create a document"><span aria-hidden="true">＋</span></summary>
      <div className="p25-document-chooser-panel">
        <label>Open document<input value={query} placeholder="Find a document…" onChange={event => setQuery(event.target.value)} /></label>
        <div className="p25-document-chooser-list">{matches.map(item => <button type="button" key={item.id} onClick={() => choose(item.id)} title={item.title}><span>{item.title}</span>{openIds.includes(item.id) && <small>Open</small>}</button>)}{!matches.length && <p>No matching documents.</p>}</div>
        <button type="button" className="p25-document-create" disabled={readOnly} onClick={() => { if (chooser.current) chooser.current.open = false; onCreate() }}>＋ New document</button>
      </div>
    </details>
  </div>
}

