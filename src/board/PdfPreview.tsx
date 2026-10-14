import { useEffect, useMemo, useState } from 'react'
import './PdfPreview.css'

type Props = { source: string; title: string }

/** Browser-native PDF rendering keeps the original file on disk and avoids a second decode/cache path. */
export function PdfPreview({ source, title }: Props) {
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(100)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const viewerSource = useMemo(() => `${source}#page=${page}&zoom=${zoom}`, [source, page, zoom])
  useEffect(() => {
    setState('loading')
    const timer = window.setTimeout(() => setState((current) => current === 'loading' ? 'error' : current), 12_000)
    return () => window.clearTimeout(timer)
  }, [viewerSource])
  return <section className="pdf-preview" aria-label={`PDF reader: ${title}`}>
    <div className="pdf-preview-toolbar">
      <button type="button" title="Previous page" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button>
      <label>Page <input aria-label="PDF page" min="1" type="number" value={page} onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))}/></label>
      <button type="button" title="Next page" aria-label="Next page" onClick={() => setPage((current) => current + 1)}>›</button>
      <span />
      <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(50, current - 25))}>−</button>
      <output>{zoom}%</output>
      <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(200, current + 25))}>＋</button>
      <a href={source} download title="Download original PDF">⇩</a>
      <button type="button" title="Open PDF in a separate system window" onClick={() => window.open(source, '_blank', 'noopener')}>↗</button>
    </div>
    <iframe src={viewerSource} title={title} onLoad={() => setState('ready')} />
    {state === 'loading' && <div className="pdf-preview-status">Loading PDF…</div>}
    {state === 'error' && <div className="pdf-preview-status error"><strong>Preview unavailable</strong><span>Use ↗ to open the original file in your assigned PDF reader.</span></div>}
  </section>
}
