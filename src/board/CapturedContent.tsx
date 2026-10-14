import { useEffect, useState } from 'react'
import type { CapturedContent } from '../model/project'
import { BoardRichText } from './BoardRichText'
import './CapturedContent.css'

type ClipTab = 'article' | 'comments' | 'transcript'

function plainText(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  return container.textContent?.trim() || ''
}

function tabHtml(content: CapturedContent, tab: ClipTab) {
  return tab === 'article' ? content.articleHtml : tab === 'comments' ? content.commentsHtml : content.transcriptHtml
}

function countLabel(html: string) {
  const text = plainText(html)
  return text ? `${text.split(/\s+/).length} words` : 'empty'
}

export function CapturedContentCard({ content, mediaUrl, mediaKind, onChange, onEdit, onMine, onRequestText }: {
  content: CapturedContent
  mediaUrl?: string
  mediaKind?: 'image' | 'video'
  onChange: (content: CapturedContent) => void
  onEdit: () => void
  onMine?: () => void
  onRequestText: (options: { title: string; label: string; initialValue?: string }) => Promise<string | null>
}) {
  const [tab, setTab] = useState<ClipTab>('article')
  const html = tabHtml(content, tab)
  const updateHtml = (next: string) => onChange({ ...content, ...(tab === 'article' ? { articleHtml: next } : tab === 'comments' ? { commentsHtml: next } : { transcriptHtml: next }) })
  return <div className={`capture-card ${mediaUrl ? 'with-media' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
    <div className="capture-source"><span title={content.sourceUrl || 'No source URL saved'}>{content.sourceLabel || 'Saved reference'}</span><strong title={content.author || 'No author saved'}>{content.author || 'Unknown author'}</strong>{onMine && <button type="button" title="Send this capture to the Eclipse DEV Miner as a text job" onClick={onMine}>Mine ⛏</button>}<button type="button" title="Edit source details and captured text" onClick={onEdit}>Edit capture</button></div>
    {mediaUrl && <div className="capture-media">{mediaKind === 'video' ? <video src={mediaUrl} controls preload="metadata" /> : <img src={mediaUrl} alt="Captured reference" draggable={false} />}</div>}
    <div className="capture-reading">
      <div className="capture-tabs" role="tablist" aria-label="Captured content sections">
        {(['article', 'comments', 'transcript'] as ClipTab[]).map((entry) => <button className={tab === entry ? 'active' : ''} type="button" title={`Show saved ${entry}`} role="tab" aria-selected={tab === entry} key={entry} onClick={() => setTab(entry)}><span>{entry}</span><small>{countLabel(tabHtml(content, entry))}</small></button>)}
      </div>
      <BoardRichText html={html || '<p></p>'} selected={false} onChange={updateHtml} onRequestText={onRequestText} />
    </div>
  </div>
}

export function CaptureEditorDialog({ initialValue, mediaLabel, onSave, onClose, onRequestText }: {
  initialValue: CapturedContent
  mediaLabel?: string
  onSave: (content: CapturedContent, title: string) => void
  onClose: () => void
  onRequestText: (options: { title: string; label: string; initialValue?: string }) => Promise<string | null>
}) {
  const [draft, setDraft] = useState(initialValue)
  const [title, setTitle] = useState(() => plainText(initialValue.articleHtml).slice(0, 80) || 'Saved reference')
  const [tab, setTab] = useState<ClipTab>('article')
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  const html = tabHtml(draft, tab)
  const updateHtml = (next: string) => setDraft((current) => ({ ...current, ...(tab === 'article' ? { articleHtml: next } : tab === 'comments' ? { commentsHtml: next } : { transcriptHtml: next }) }))
  return <div className="capture-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="capture-dialog" role="dialog" aria-modal="true" aria-label="Save article or social post">
      <header><div><span>RESEARCH CAPTURE</span><strong>Preserve the reference, not just the screenshot.</strong></div><button type="button" aria-label="Close capture editor" onClick={onClose}>×</button></header>
      <div className="capture-fields">
        <label><span>Card title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Reference title" /></label>
        <label><span>Content type</span><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as CapturedContent['kind'] })}><option value="social-post">Social post</option><option value="article">Article / blog</option><option value="transcript">Transcript</option><option value="script">Script</option><option value="local-document">Local document</option></select></label>
        <label><span>Source / platform</span><input value={draft.sourceLabel} onChange={(event) => setDraft({ ...draft, sourceLabel: event.target.value })} placeholder="Instagram, TikTok, Ars Technica…" /></label>
        <label><span>Author / account</span><input value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} placeholder="Author or account" /></label>
        <label className="capture-url"><span>Source URL</span><input value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="https://…" /></label>
        <label><span>Published</span><input value={draft.publishedAt} onChange={(event) => setDraft({ ...draft, publishedAt: event.target.value })} placeholder="Date or original label" /></label>
        {mediaLabel && <p className="capture-attached">▧ Attached disk media: <strong>{mediaLabel}</strong></p>}
      </div>
      <div className="capture-composer-tabs" role="tablist">{(['article', 'comments', 'transcript'] as ClipTab[]).map((entry) => <button className={tab === entry ? 'active' : ''} type="button" role="tab" aria-selected={tab === entry} key={entry} onClick={() => setTab(entry)}><strong>{entry === 'article' ? 'Article / caption' : entry}</strong><small>{countLabel(tabHtml(draft, entry))}</small></button>)}</div>
      <div className="capture-composer"><BoardRichText html={html || '<p></p>'} selected onChange={updateHtml} onRequestText={onRequestText} variant="composer" /></div>
      <footer><p>Paste formatted text directly. Long captions, comments, scripts, and transcripts remain searchable and scroll inside the canvas card.</p><button type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="button" onClick={() => onSave({ ...draft, capturedAt: draft.capturedAt || new Date().toISOString() }, title.trim() || 'Saved reference')}>Save capture</button></footer>
    </section>
  </div>
}
