import { useEffect, useRef, useState, type CSSProperties } from 'react'
import './projectIdentity.css'

type Phase = 'ready' | 'loading' | 'playing' | 'paused' | 'away' | 'finished' | 'error'
type Clip = 'retreat' | 'pass'
export type ProjectIdentityProps = { reduceMotion?: boolean; active?: boolean; onStatus?: (message: string) => void }
const media = (name: string) => `${import.meta.env.BASE_URL}aquarium-header/${name}`

/** Decorative aquarium only. Project title and commands remain owned by App. */
export function ProjectIdentity({ reduceMotion = false, active = true, onStatus }: ProjectIdentityProps = {}) {
  const video = useRef<HTMLVideoElement>(null)
  const waterVideo = useRef<HTMLVideoElement>(null)
  const request = useRef(0)
  const waterRequest = useRef(0)
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  const [clip, setClip] = useState<Clip>('retreat')
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>('ready')
  const [systemReduced, setSystemReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [motionPaused, setMotionPaused] = useState(false)
  const [hasVideoFrame, setHasVideoFrame] = useState(false)
  const [waterPlaying, setWaterPlaying] = useState(false)
  const reduced = reduceMotion || systemReduced
  const suspended = !active || !visible
  const still = reduced || motionPaused || suspended
  const announce = (message: string) => statusRef.current?.(message)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setSystemReduced(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  useEffect(() => {
    const current = waterVideo.current, token = ++waterRequest.current
    if (!current) return
    if (still) { current.pause(); setWaterPlaying(false); return }
    current.muted = true
    void current.play().then(() => { if (waterRequest.current === token) setWaterPlaying(true) }).catch(() => { if (waterRequest.current === token) setWaterPlaying(false) })
    return () => { waterRequest.current++; current.pause() }
  }, [still])
  useEffect(() => {
    if (still && (phase === 'playing' || phase === 'loading')) { request.current++; video.current?.pause(); setPhase('paused') }
    if (reduced) setHasVideoFrame(false)
  }, [still, reduced, phase])
  useEffect(() => {
    if (phase !== 'loading' || still) return
    const current = video.current, token = ++request.current
    if (!current) return
    current.muted = true
    void current.play().then(() => {
      if (request.current === token) { setHasVideoFrame(true); setPhase('playing') }
    }).catch(() => {
      if (request.current === token) { setHasVideoFrame(false); setPhase('error'); announce('Aquarium playback unavailable. A still image is shown.') }
    })
    return () => { request.current++ }
  }, [clip, phase, still, attempt])
  useEffect(() => () => { request.current++; waterRequest.current++; video.current?.pause(); waterVideo.current?.pause() }, [])

  const reset = () => {
    request.current++; video.current?.pause(); setHasVideoFrame(false); setAttempt(value => value + 1); setClip('retreat'); setPhase('ready')
    announce('Fish returned to the foreground')
  }
  const begin = (next: Clip) => {
    if (reduced || suspended || motionPaused) return
    request.current++; video.current?.pause(); setHasVideoFrame(false); setClip(next); setAttempt(value => value + 1); setPhase('loading')
    announce(next === 'retreat' ? 'Fish swimming into the distance' : 'Fish swimming across the tank')
  }
  const toggleMotion = () => {
    if (reduced || suspended) return
    request.current++
    if (motionPaused) { setMotionPaused(false); if (phase === 'paused') setPhase('loading') }
    else { setMotionPaused(true); video.current?.pause(); if (phase === 'playing' || phase === 'loading') setPhase('paused') }
  }
  const fishAction = () => {
    if (suspended) return
    if (reduced) { setHasVideoFrame(false); setClip('retreat'); setPhase(phase === 'away' ? 'ready' : 'away'); announce(phase === 'away' ? 'Fish returned to the foreground' : 'Fish in the distance · still image'); return }
    if (motionPaused) { setMotionPaused(false); if (phase === 'paused') setPhase('loading'); else if (phase === 'away' || phase === 'finished') reset(); else { request.current++; setAttempt(value => value + 1); setClip('retreat'); setHasVideoFrame(false); setPhase('loading') } return }
    if (phase === 'away' || phase === 'finished') { reset(); return }
    if (phase === 'playing' || phase === 'loading') { toggleMotion(); return }
    if (phase === 'paused') { setMotionPaused(false); setPhase('loading'); return }
    begin('retreat')
  }
  const actionLabel = reduced ? (phase === 'away' ? 'Show fish in foreground' : 'Show fish in distance') : phase === 'away' || phase === 'finished' ? 'Bring fish back' : phase === 'playing' || phase === 'loading' ? 'Pause fish motion' : phase === 'paused' ? 'Resume fish motion' : 'Send fish swimming away'
  const status = reduced ? 'Still images' : suspended ? 'Motion suspended' : phase === 'loading' ? 'Loading…' : phase === 'playing' ? (clip === 'retreat' ? 'Swimming away' : 'Swimming pass') : phase === 'paused' ? 'Paused' : phase === 'away' ? 'In the distance' : phase === 'finished' ? 'Pass finished' : phase === 'error' ? 'Playback unavailable' : 'Click the fish'
  const showVideo = hasVideoFrame && !reduced && ['playing', 'loading', 'paused', 'away', 'finished'].includes(phase)
  const poster = media(phase === 'away' ? 'away-poster.jpg' : 'near-poster.jpg')
  return <>
    <div className="project-identity aquarium-scene" data-aquarium-state={phase} data-motion={reduced ? 'reduced' : suspended ? 'suspended' : motionPaused ? 'paused' : 'active'}>
      <img className="aquarium-poster" src={poster} alt="" draggable={false} aria-hidden="true" />
      <video ref={video} key={`${clip}-${attempt}`} src={media(clip === 'retreat' ? 'fish-retreat.mp4' : 'fish-swimming-pass.mp4')} poster={poster} preload="none" playsInline muted disablePictureInPicture aria-hidden="true" className={showVideo ? 'aquarium-video visible' : 'aquarium-video'} onEnded={event => {
        if (still || event.currentTarget !== video.current || !event.currentTarget.ended || !['loading', 'playing'].includes(phase)) return
        setPhase(clip === 'retreat' ? 'away' : 'finished'); announce(clip === 'retreat' ? 'Fish in the distance. Bring it back when ready.' : 'Swimming pass finished. Bring the fish back when ready.')
      }} onError={event => {
        if (still || event.currentTarget !== video.current || !event.currentTarget.error || !['loading', 'playing', 'paused'].includes(phase)) return
        request.current++; setHasVideoFrame(false); setPhase('error'); announce('Aquarium playback unavailable. A still image is shown.')
      }} />
      <button type="button" className="aquarium-fish-action" aria-label={actionLabel} title={actionLabel} onClick={fishAction} />
      <span className="identity-wordmark" aria-hidden="true">Art Equation</span>
      <div className="aquarium-controls">
        <span className="aquarium-status" role="status" aria-live="polite" aria-atomic="true">{status}</span>
        <button type="button" aria-label={phase === 'error' ? 'Retry aquarium playback' : 'Play swimming pass'} title={phase === 'error' ? 'Retry aquarium playback' : 'Play swimming pass'} disabled={still} onClick={() => begin(phase === 'error' ? clip : 'pass')}>{phase === 'error' ? 'Retry' : '▷'}</button>
        <button type="button" aria-label={motionPaused ? 'Resume aquarium motion' : 'Pause aquarium motion'} aria-pressed={motionPaused || reduced} disabled={reduced || suspended} title={reduced ? 'Reduced motion uses still images' : motionPaused ? 'Resume aquarium motion' : 'Pause aquarium motion'} onClick={toggleMotion}>{motionPaused || reduced ? '▷' : 'Ⅱ'}</button>
        {phase !== 'ready' && <button type="button" aria-label="Reset aquarium" title="Reset aquarium" onClick={reset}>↺</button>}
      </div>
    </div>
    <div className="aquarium-water-band" style={{ '--aquarium-water': `url("${media('water-texture.png')}")` } as CSSProperties} aria-hidden="true">
      <div className="aquarium-water-poster" />
      <video ref={waterVideo} src={media('water-loop.mp4')} preload="none" playsInline muted loop disablePictureInPicture aria-hidden="true" className={waterPlaying ? 'aquarium-water-video visible' : 'aquarium-water-video'} onError={event => {
        if (event.currentTarget !== waterVideo.current || !event.currentTarget.error) return
        waterRequest.current++; setWaterPlaying(false)
      }} />
    </div>
  </>
}
