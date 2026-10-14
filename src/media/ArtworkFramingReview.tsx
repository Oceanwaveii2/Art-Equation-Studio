import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import house from '../assets/house.svg'

export type ArtworkFramingReviewProps = { readOnly: boolean; onClose: () => void }
type FramingMode = 'fit' | 'fill'
type Aspect = 'source' | 'square' | 'landscape' | 'portrait'
type Framing = { mode: FramingMode; aspect: Aspect; x: number; y: number }
type Source = { url: string; name: string; width: number; height: number; local: boolean }
type Review = { source: Source; framing: Framing }
type PendingImage = { image: HTMLImageElement; url: string; timeout: number }

const DEFAULT_FRAMING: Framing = { mode: 'fit', aspect: 'source', x: 50, y: 50 }
const HOUSE_SOURCE: Source = { url: house, name: 'House study · raster reference crop', width: 720, height: 590, local: false }
const MAX_FILE_BYTES = 12 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const ASPECTS: { value: Aspect; label: string }[] = [
  { value: 'source', label: 'Source proportions' },
  { value: 'square', label: 'Square · 1:1' },
  { value: 'landscape', label: 'Landscape · 16:9' },
  { value: 'portrait', label: 'Portrait · 3:4' },
]
const aspectRatio = (review: Review) => review.framing.aspect === 'source'
  ? review.source.width / review.source.height
  : review.framing.aspect === 'square' ? 1 : review.framing.aspect === 'landscape' ? 16 / 9 : 3 / 4

/** Source coordinates visible through a CSS object-fit/object-position frame. No pixels are rewritten. */
export function artworkVisibleSourceRect(sourceWidth: number, sourceHeight: number, frameRatio: number, mode: FramingMode, x: number, y: number) {
  if (![sourceWidth, sourceHeight, frameRatio, x, y].every(Number.isFinite) || sourceWidth <= 0 || sourceHeight <= 0 || frameRatio <= 0) return null
  const frameWidth = frameRatio
  const scale = mode === 'fit' ? Math.min(frameWidth / sourceWidth, 1 / sourceHeight) : Math.max(frameWidth / sourceWidth, 1 / sourceHeight)
  const offsetX = (frameWidth - sourceWidth * scale) * Math.max(0, Math.min(100, x)) / 100
  const offsetY = (1 - sourceHeight * scale) * Math.max(0, Math.min(100, y)) / 100
  return {
    x: Math.max(0, -offsetX / scale), y: Math.max(0, -offsetY / scale),
    width: Math.min(sourceWidth, frameWidth / scale), height: Math.min(sourceHeight, 1 / scale),
  }
}

function sameReview(a: Review, b: Review) {
  return a.source.url === b.source.url && a.framing.mode === b.framing.mode && a.framing.aspect === b.framing.aspect && a.framing.x === b.framing.x && a.framing.y === b.framing.y
}

export function ArtworkFramingReview({ readOnly, onClose }: ArtworkFramingReviewProps) {
  const id = useId()
  const [applied, setApplied] = useState<Review>(() => ({ source: HOUSE_SOURCE, framing: { ...DEFAULT_FRAMING } }))
  const [draft, setDraft] = useState<Review>(() => ({ source: HOUSE_SOURCE, framing: { ...DEFAULT_FRAMING } }))
  const [guides, setGuides] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Adjust a draft, then Apply it to this review.')
  const fileInput = useRef<HTMLInputElement>(null)
  const pending = useRef<PendingImage | null>(null)
  const ownedUrls = useRef(new Set<string>())
  const generation = useRef(0)
  const mounted = useRef(true)
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  const revoke = (url: string) => {
    if (ownedUrls.current.delete(url)) URL.revokeObjectURL(url)
  }
  const cancelDecode = () => {
    generation.current += 1
    if (pending.current) {
      window.clearTimeout(pending.current.timeout)
      pending.current.image.onload = null
      pending.current.image.onerror = null
      pending.current.image.src = ''
      revoke(pending.current.url)
      pending.current = null
    }
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelDecode()
      for (const url of ownedUrls.current) URL.revokeObjectURL(url)
      ownedUrls.current.clear()
    }
  }, [])

  // Keep both last-applied and pending draft sources alive; discard superseded replacements.
  useEffect(() => {
    for (const url of ownedUrls.current) {
      if (url !== applied.source.url && url !== draft.source.url && url !== pending.current?.url) revoke(url)
    }
  }, [applied.source.url, draft.source.url])

  useEffect(() => {
    if (readOnly) {
      cancelDecode()
      setLoading(false)
      setDraft(applied)
      setError('')
      setStatus('Read-only review. Applied framing is available to inspect.')
    } else {
      setStatus('Adjust a draft, then Apply it to this review.')
    }
  }, [readOnly, applied])

  const updateFraming = (patch: Partial<Framing>) => {
    if (readOnlyRef.current || loading) return
    setDraft(current => ({ ...current, framing: { ...current.framing, ...patch } }))
    setStatus('Draft framing · not yet applied.')
  }

  const replaceImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // Selecting the same file again must trigger a new review.
    if (!file || readOnlyRef.current) return
    cancelDecode()
    setError('')
    if (!ALLOWED_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
      setLoading(false)
      setError('Choose a nonempty PNG, JPEG or WebP image up to 12 MB. Your previous preview is retained.')
      return
    }
    const url = URL.createObjectURL(file)
    ownedUrls.current.add(url)
    const image = new Image()
    const attempt = generation.current
    setLoading(true)
    setStatus(`Reading ${file.name} locally…`)
    const fail = (message: string) => {
      if (!mounted.current || attempt !== generation.current) return
      image.onload = null
      image.onerror = null
      if (pending.current) window.clearTimeout(pending.current.timeout)
      pending.current = null
      revoke(url)
      setLoading(false)
      setError(message)
      setStatus('Replacement was not applied. Your previous preview is retained.')
    }
    image.onerror = () => fail('This file could not be decoded as an image. Choose another PNG, JPEG or WebP.')
    image.onload = () => {
      if (!mounted.current || attempt !== generation.current || readOnlyRef.current) { revoke(url); return }
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (width <= 0 || height <= 0 || width > 16000 || height > 16000 || width * height > 40_000_000) {
        fail('Use an image no larger than 16,000 pixels per side and 40 megapixels for this local review.')
        return
      }
      image.onload = null
      image.onerror = null
      if (pending.current) window.clearTimeout(pending.current.timeout)
      pending.current = null
      setDraft({ source: { url, name: file.name, width, height, local: true }, framing: { ...DEFAULT_FRAMING } })
      setLoading(false)
      setStatus('Replacement draft ready. The source file is unchanged; Apply affects this review only.')
    }
    pending.current = { image, url, timeout: window.setTimeout(() => fail('The image did not finish decoding. Choose another file; your previous preview is retained.'), 15_000) }
    image.src = url
  }

  const close = () => { cancelDecode(); onClose() }
  const cancel = () => { cancelDecode(); setDraft(applied); onClose() }
  const reset = () => {
    if (readOnlyRef.current || loading) return
    setDraft(current => ({ ...current, framing: { ...DEFAULT_FRAMING } }))
    setError('')
    setStatus('Framing reset in the draft. The selected source image is retained.')
  }
  const apply = () => {
    if (readOnlyRef.current || loading) return
    setApplied(draft)
    setError('')
    setStatus('Applied to this mounted review only. No project asset or source file was changed.')
  }
  const ratio = aspectRatio(draft)
  const visible = artworkVisibleSourceRect(draft.source.width, draft.source.height, ratio, draft.framing.mode, draft.framing.x, draft.framing.y)
  const dirty = !sameReview(draft, applied)
  const imageStyle: CSSProperties = { objectFit: draft.framing.mode === 'fit' ? 'contain' : 'cover', objectPosition: `${draft.framing.x}% ${draft.framing.y}%` }
  const frameStyle: CSSProperties = { aspectRatio: ratio, width: `min(100%, ${ratio * 360}px)` }
  const sourceDescription = `${draft.source.name}, ${draft.source.width} by ${draft.source.height} pixels. ${draft.framing.mode === 'fit' ? 'Entire source fitted' : 'Frame filled'}; horizontal position ${draft.framing.x} percent, vertical position ${draft.framing.y} percent.`

  return <section className="artwork-framing-review" aria-labelledby={`${id}-title`} aria-describedby={`${id}-scope`}>
    <header className="artwork-framing-review__header">
      <div><p className="artwork-framing-review__eyebrow">ARTWORK · LOCAL UI REVIEW</p><h2 id={`${id}-title`}>Frame the artwork</h2></div>
      <button type="button" onClick={close} aria-label="Close artwork framing review">×</button>
    </header>
    <p id={`${id}-scope`} className="artwork-framing-review__scope">Preview framing and identity thumbnails together. Apply keeps this review while it is open; closing it discards the demo. Original images and project assets stay unchanged.</p>
    {readOnly && <p className="artwork-framing-review__readonly">Read-only · framing and image replacement are unavailable. You can inspect the image and toggle guides.</p>}
    <div className="artwork-framing-review__layout">
      <div className="artwork-framing-review__preview-column">
        <figure className="artwork-framing-review__figure">
          <div className="artwork-framing-review__stage" aria-busy={loading}>
            <div className="artwork-framing-review__frame" style={frameStyle}>
              <img src={draft.source.url} alt={sourceDescription} style={imageStyle} draggable={false} />
              {guides && <div className="artwork-framing-review__guides" aria-hidden="true"><i /><i /><i /><i /></div>}
            </div>
          </div>
          <figcaption><strong>{draft.source.name}</strong><span>{draft.source.width} × {draft.source.height} px · {draft.source.local ? 'Browser-local replacement' : 'Raster reference in an SVG wrapper'}</span></figcaption>
        </figure>
        <label className="artwork-framing-review__guide-toggle"><input type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)} /> Show thirds and frame guides</label>
        <div className="artwork-framing-review__identities" aria-label="Matching identity previews">
          {['Project tree', 'Board strip', 'Owned portal', 'Inspector / Trash'].map(label => <figure key={label}>
            <div style={{ aspectRatio: ratio }}><img src={draft.source.url} alt="" style={imageStyle} draggable={false} /></div><figcaption>{label}</figcaption>
          </figure>)}
        </div>
        <p className="artwork-framing-review__hint">All four examples share these draft settings. They are local layout examples; production thumbnail synchronization is not verified here.</p>
      </div>
      <div className="artwork-framing-review__controls">
        <fieldset disabled={readOnly || loading}>
          <legend>Framing</legend>
          <div className="artwork-framing-review__modes">
            <label><input type="radio" name={`${id}-fit`} checked={draft.framing.mode === 'fit'} onChange={() => updateFraming({ mode: 'fit' })} /> Fit · whole image</label>
            <label><input type="radio" name={`${id}-fit`} checked={draft.framing.mode === 'fill'} onChange={() => updateFraming({ mode: 'fill' })} /> Fill · crop to frame</label>
          </div>
          <label className="artwork-framing-review__field" htmlFor={`${id}-aspect`}>Frame proportions<select id={`${id}-aspect`} value={draft.framing.aspect} onChange={event => updateFraming({ aspect: event.target.value as Aspect })}>{ASPECTS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          {(['x', 'y'] as const).map(axis => <label className="artwork-framing-review__field" key={axis} htmlFor={`${id}-${axis}`}><span>{axis === 'x' ? 'Horizontal focal position' : 'Vertical focal position'} <output htmlFor={`${id}-${axis}`}>{draft.framing[axis]}%</output></span><input id={`${id}-${axis}`} type="range" min="0" max="100" step="1" value={draft.framing[axis]} onChange={event => updateFraming({ [axis]: Number(event.target.value) })} /><small>{axis === 'x' ? 'Left ← → Right' : 'Top ← → Bottom'} · Arrow keys adjust by 1%</small></label>)}
          <p className="artwork-framing-review__hint">Fit preserves the whole image and may leave space. Fill crops overflow; focal position controls which part stays visible.</p>
          <button type="button" onClick={reset}>Reset framing</button>
        </fieldset>
        <div className="artwork-framing-review__source">
          <h3>Source image</h3>
          <p>Replace the preview with a local PNG, JPEG or WebP up to 12 MB. No upload, disk write or production import occurs.</p>
          <input ref={fileInput} id={`${id}-file`} className="artwork-framing-review__file" type="file" accept="image/png,image/jpeg,image/webp" disabled={readOnly || loading} onChange={replaceImage} aria-label="Choose a local replacement image" />
          <button type="button" disabled={readOnly || loading} onClick={() => fileInput.current?.click()}>Replace image…</button>
          {draft.source.local && <button type="button" disabled={readOnly || loading} onClick={() => { setDraft({ source: HOUSE_SOURCE, framing: { ...DEFAULT_FRAMING } }); setError(''); setStatus('Original house reference restored in the draft. Apply to keep it for this review.') }}>Use original house reference</button>}
        </div>
        {visible && <p className="artwork-framing-review__geometry">Visible source area: x {Math.round(visible.x)}, y {Math.round(visible.y)}, {Math.round(visible.width)} × {Math.round(visible.height)} px. This readout describes CSS framing, not a saved crop.</p>}
      </div>
    </div>
    {error && <p className="artwork-framing-review__error" role="alert">{error}</p>}
    <footer className="artwork-framing-review__footer">
      <p role="status" aria-live="polite">{loading ? 'Reading image locally…' : status}</p>
      <div><button type="button" onClick={cancel}>Cancel</button><button className="artwork-framing-review__apply" type="button" disabled={readOnly || loading || !dirty} onClick={apply}>Apply to review</button></div>
    </footer>
  </section>
}

export default ArtworkFramingReview
