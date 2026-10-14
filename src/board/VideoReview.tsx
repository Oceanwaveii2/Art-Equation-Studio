import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VideoAnnotation } from '../model/project'
import './VideoReview.css'

type VideoReviewProps = {
  source: string
  title: string
  annotations: VideoAnnotation[]
  frameRate: 24 | 25 | 30 | 60
  onChange: (update: { videoAnnotations: VideoAnnotation[]; videoFrameRate: 24 | 25 | 30 | 60 }) => void
}

function timestamp(seconds: number, frameRate: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const whole = Math.floor(safeSeconds)
  const frames = Math.min(frameRate - 1, Math.floor((safeSeconds - whole) * frameRate))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

function PlaybackIcon({ kind }: { kind: 'play' | 'pause' | 'previous' | 'next' | 'loop' }) {
  const paths = {
    play: 'M6 4l10 6-10 6z',
    pause: 'M5 4h3v12H5zM12 4h3v12h-3z',
    previous: 'M4 4h2v12H4zM15 4 7 10l8 6z',
    next: 'M14 4h2v12h-2zM5 4l8 6-8 6z',
    loop: 'M5 7h8v3l4-4-4-4v3H3v6h2V7zm10 6H7v-3l-4 4 4 4v-3h10v-6h-2v4z',
  }
  return <svg className="video-playback-icon" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d={paths[kind]} /></svg>
}

export function VideoReview({ source, title, annotations, frameRate, onChange }: VideoReviewProps) {
  const reviewRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const dialogId = useId()
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(.8)
  const [muted, setMuted] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftColor, setDraftColor] = useState('#e3b56f')
  const [annotationQuery, setAnnotationQuery] = useState('')
  const [compact, setCompact] = useState(true)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [loop, setLoop] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const audibleVolume = muted ? 0 : volume
  const positionPercent = Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(100, time / duration * 100)) : 0
  const visibleAnnotations = annotations.filter((annotation) => !annotationQuery.trim() || annotation.text.toLowerCase().includes(annotationQuery.trim().toLowerCase()))

  useLayoutEffect(() => {
    const review = reviewRef.current
    if (!review) return
    const measure = () => setCompact(review.clientWidth < 250 || review.clientHeight < (annotations.length ? 277 : 162))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(review)
    return () => observer.disconnect()
  }, [annotations.length])

  useEffect(() => {
    if (!controlsOpen) return
    const previous = returnFocusRef.current
    dialogRef.current?.querySelector<HTMLButtonElement>('[aria-label="Close video controls"]')?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setControlsOpen(false)
    }
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('keydown', escape, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [controlsOpen])

  const openControls = (button: HTMLButtonElement) => {
    returnFocusRef.current = button
    setControlsOpen(true)
  }

  const seek = (next: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(next)) return
    video.currentTime = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, next))
    // Reflect a user seek immediately. Waiting for the asynchronous timeupdate
    // leaves a controlled slider at its old value and can lose the next key.
    setTime(video.currentTime)
  }
  const step = (direction: -1 | 1) => seek((videoRef.current?.currentTime ?? time) + direction / frameRate)
  const togglePlaying = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }
  const setVideoVolume = (next: number) => {
    const safe = Math.max(0, Math.min(1, next))
    const video = videoRef.current
    if (video) { video.volume = safe; video.muted = safe === 0 }
    setVolume(safe)
    setMuted(safe === 0)
  }
  const toggleMuted = () => {
    const video = videoRef.current
    if (!video) return
    const next = !video.muted
    video.muted = next
    setMuted(next)
    if (!next && video.volume === 0) setVideoVolume(.8)
  }
  const toggleLoop = () => {
    const next = !loop
    setLoop(next)
    if (videoRef.current) {
      videoRef.current.loop = next
    }
  }
  const changePlaybackRate = (nextRate: number) => {
    setPlaybackRate(nextRate)
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate
    }
  }
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (event.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (event.key === ' ' || event.key === 'k' || event.key === 'K') {
      event.preventDefault()
      togglePlaying()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      step(1)
    } else if (event.key === 'm' || event.key === 'M') {
      event.preventDefault()
      toggleMuted()
    } else if (event.key === 'l' || event.key === 'L') {
      event.preventDefault()
      toggleLoop()
    }
  }
  const addAnnotation = () => {
    const text = draft.trim()
    if (!text) return
    onChange({ videoFrameRate: frameRate, videoAnnotations: [...annotations, { id: crypto.randomUUID(), time, text, color: draftColor }].sort((a, b) => a.time - b.time) })
    setDraft('')
  }
  const deleteAnnotation = (id: string) => onChange({ videoFrameRate: frameRate, videoAnnotations: annotations.filter((annotation) => annotation.id !== id) })
  const exportAnnotations = () => {
    const payload = annotations.map((annotation) => ({ timecode: timestamp(annotation.time, frameRate), seconds: Number(annotation.time.toFixed(3)), text: annotation.text, color: annotation.color || '#e3b56f' }))
    const blob = new Blob([JSON.stringify({ video: title, frameRate, annotations: payload }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'video'}-annotations.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const muteIcon = <svg className="video-mute-icon" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M3 7h3l4-3v12l-4-3H3z" /><path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d={muted || volume === 0 ? 'M13 7l4 6m0-6-4 6' : 'M13 7c2 1 2 5 0 6m2-9c4 3 4 9 0 12'} /></svg>
  const seekControl = <div className="video-range-control video-position-control">
    <span className="video-range-track" aria-hidden="true"><span className="video-range-progress" style={{ width: `${positionPercent}%`, display: positionPercent > 0 ? undefined : 'none' }} /><span className="video-range-thumb" style={{ left: `${positionPercent}%` }} /></span>
    <input className="video-scrubber video-control-hit" type="range" min="0" max={Math.max(duration, 0.01)} step="0.001" value={Math.min(time, duration || 0)} aria-label="Video position" onChange={(event) => seek(Number(event.target.value))} />
  </div>
  const fullControls = <div className="video-review-controls">
      <div className="video-control-row">
      <button type="button" title="Play or pause" aria-label="Play or pause" onClick={togglePlaying}><PlaybackIcon kind={playing ? 'pause' : 'play'} /></button>
      <button type="button" title={`Previous frame at ${frameRate} fps`} aria-label="Previous frame" onClick={() => step(-1)}><PlaybackIcon kind="previous" /></button>
      <button type="button" title={`Next frame at ${frameRate} fps`} aria-label="Next frame" onClick={() => step(1)}><PlaybackIcon kind="next" /></button>
      <button type="button" className={loop ? 'video-control-active' : undefined} title={loop ? 'Disable loop playback' : 'Enable loop playback'} aria-label={loop ? 'Disable loop playback' : 'Enable loop playback'} onClick={toggleLoop}><PlaybackIcon kind="loop" /></button>
      <button type="button" title={muted || volume === 0 ? 'Unmute' : 'Mute'} aria-label={muted || volume === 0 ? 'Unmute video' : 'Mute video'} onClick={toggleMuted}>
        {muteIcon}
      </button>
      <div className="video-range-control video-volume-control">
        <span className="video-range-track" aria-hidden="true"><span className="video-range-progress" style={{ width: `${audibleVolume * 100}%`, display: audibleVolume > 0 ? undefined : 'none' }} /><span className="video-range-thumb" style={{ left: `${audibleVolume * 100}%` }} /></span>
        <input className="video-volume video-control-hit" type="range" min="0" max="1" step="0.01" value={audibleVolume} aria-label="Video volume" title={`Volume ${Math.round(audibleVolume * 100)}%`} onChange={(event) => setVideoVolume(Number(event.target.value))} />
      </div>
      <output title="Timecode in minutes, seconds, frames">{timestamp(time, frameRate)}</output>
      <div className="video-playback-rate-control">
        <span className="video-playback-rate-paint" aria-hidden="true">{playbackRate}x</span>
        <select className="video-control-hit" value={playbackRate} aria-label="Playback speed" title="Playback speed" onChange={(event) => changePlaybackRate(Number(event.target.value))}>
          <option value="0.25">0.25x</option>
          <option value="0.5">0.5x</option>
          <option value="1">1.0x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2.0x</option>
        </select>
      </div>
      <div className="video-frame-rate-control">
        <span className="video-frame-rate-paint" aria-hidden="true">{frameRate} fps</span>
        <select className="video-control-hit" value={frameRate} aria-label="Frame rate" title="Frame rate used for frame stepping and timecode" onChange={(event) => onChange({ videoAnnotations: annotations, videoFrameRate: Number(event.target.value) as VideoReviewProps['frameRate'] })}><option value="24">24 fps</option><option value="25">25 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select>
      </div>
      </div>
      {seekControl}
    </div>
  const markerTrack = <div className="video-marker-track" role="group" aria-label="Video annotations">{annotations.map((annotation) => <button type="button" key={annotation.id} title={`${timestamp(annotation.time, frameRate)} — ${annotation.text}`} aria-label={`Go to ${timestamp(annotation.time, frameRate)}: ${annotation.text}`} style={{ left: `${duration ? annotation.time / duration * 100 : 0}%`, background: annotation.color || '#e3b56f' }} onClick={() => seek(annotation.time)} />)}</div>
  const annotationControls = <>
    <div className="video-annotation-entry">
      <div className="video-color-control"><span className="video-color-paint" aria-hidden="true" style={{ background: draftColor }} /><input className="annotation-color video-control-hit" type="color" value={draftColor} aria-label="Annotation marker color" title="Marker color" onChange={(event) => setDraftColor(event.target.value)} /></div>
      <div className="video-text-control"><span className={`video-text-paint${draft ? '' : ' video-text-placeholder'}`} aria-hidden="true">{draft || 'Note at current frame'}</span><input className="video-control-hit video-control-editor" type="text" value={draft} placeholder="Note at current frame" aria-label="Annotation note" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addAnnotation() }} /></div>
      <button type="button" title="Add timestamped annotation" onClick={addAnnotation} disabled={!draft.trim()}><span className="video-action-label">Note</span></button>{annotations.length > 0 && <button type="button" title="Export annotations as JSON" aria-label="Export video annotations" onClick={exportAnnotations}><span className="video-action-label">Export</span></button>}
    </div>
    {annotations.length > 0 && <><div className="video-annotation-search"><div className="video-text-control"><span className={`video-text-paint${annotationQuery ? '' : ' video-text-placeholder'}`} aria-hidden="true">{annotationQuery || 'Search notes'}</span><input className="video-control-hit video-control-editor" type="search" value={annotationQuery} placeholder="Search notes" aria-label="Search video annotations" onChange={(event) => setAnnotationQuery(event.target.value)} /></div><span className="video-annotation-count">{visibleAnnotations.length}/{annotations.length}</span></div><div className="video-annotation-list">{visibleAnnotations.map((annotation) => <div key={annotation.id}><button type="button" onClick={() => seek(annotation.time)}><time style={{ color: annotation.color || '#e5b774' }}>{timestamp(annotation.time, frameRate)}</time><span>{annotation.text}</span></button><button type="button" aria-label={`Delete annotation ${annotation.text}`} title="Delete annotation" onClick={() => deleteAnnotation(annotation.id)}>×</button></div>)}{!visibleAnnotations.length && <p>No matching notes.</p>}</div></>}
  </>
  const portalHost = controlsOpen ? reviewRef.current?.closest('.studio-shell') ?? document.body : null
  return <div ref={reviewRef} tabIndex={0} className={`video-review${compact ? ' video-review-compact' : ''}`} onPointerDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
    <video ref={videoRef} src={source} preload="metadata" loop={loop} aria-label={title} onClick={togglePlaying} onLoadedMetadata={(event) => { event.currentTarget.volume = volume; event.currentTarget.playbackRate = playbackRate; event.currentTarget.loop = loop; setDuration(event.currentTarget.duration) }} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { if (!loop) setPlaying(false) }} />
    {compact ? <div className="video-compact-controls">
      <div className="video-compact-control-row">
        <button type="button" title="Play or pause" aria-label="Play or pause" onClick={togglePlaying}><PlaybackIcon kind={playing ? 'pause' : 'play'} /></button>
        <button type="button" className={loop ? 'video-control-active' : undefined} title={loop ? 'Disable loop' : 'Loop'} aria-label={loop ? 'Disable loop playback' : 'Loop playback'} onClick={toggleLoop}><PlaybackIcon kind="loop" /></button>
        <button type="button" title={muted || volume === 0 ? 'Unmute' : 'Mute'} aria-label={muted || volume === 0 ? 'Unmute video' : 'Mute video'} onClick={toggleMuted}>{muteIcon}</button>
        <output title="Timecode in minutes, seconds, frames">{timestamp(time, frameRate)}</output>
        <button className="video-controls-trigger" type="button" aria-label="Video controls" aria-haspopup="dialog" aria-expanded={controlsOpen} aria-controls={controlsOpen ? dialogId : undefined} title={`Video controls: ${annotations.length} ${annotations.length === 1 ? 'note' : 'notes'}`} onClick={(event) => openControls(event.currentTarget)}><span className="video-action-label">Controls{annotations.length ? ` ${annotations.length}` : ''}</span></button>
      </div>
      {seekControl}
    </div> : <>{fullControls}{markerTrack}{annotationControls}</>}
    {portalHost && createPortal(<div ref={dialogRef} id={dialogId} className="video-controls-dialog" role="dialog" aria-modal="false" aria-labelledby={`${dialogId}-title`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <header><h2 id={`${dialogId}-title`}>Video controls: {title}</h2><button type="button" aria-label="Close video controls" onClick={() => setControlsOpen(false)}>Close</button></header>
      <p className="video-controls-summary">{annotations.length} {annotations.length === 1 ? 'note' : 'notes'} · Step through frames, adjust sound and add notes.</p>
      {fullControls}{markerTrack}{annotationControls}
    </div>, portalHost)}
  </div>
}
