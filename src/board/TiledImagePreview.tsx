import { requestAppFrame, cancelAppFrame } from '../canvas-engine/appFrameClock'
import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { planPyramid, planDirectionalPrefetch, validPyramid, requiredPyramidLevel, pyramidDetailState, type ImagePyramid, type TileRect } from '../canvas-engine/imagePyramid'
import { maximumTransformScale } from '../canvas-engine/imageDemand'
import { watchPixelRatio } from './watchPixelRatio'
import { acquireTileContext, releaseTileContext, WebGLTileSurface } from './WebGLTileSurface'
import { imageDrawRect, imageSourceCrop, type ImageFraming } from '../model/imageFraming'
import './TiledImagePreview.css'

type Props = { pyramid: ImagePyramid; posterUrl: string; tilesUrl: string; alt: string; viewportScale: number; rotation?: number; flipX?: boolean; flipY?: boolean; style?: CSSProperties; viewKey?: string; nativeSize?: boolean; framing?: ImageFraming }

/** DOM keeps interaction semantics; this controller streams only the visible
 * part of the prepared image and never requests the source file. */
export function TiledImagePreview(props: Props) {
  const rootRef = useRef<HTMLDivElement>(null), propsRef = useRef(props), wakeRef = useRef<() => void>(() => {})
  propsRef.current = props
  useLayoutEffect(() => { wakeRef.current() })
  useLayoutEffect(() => {
    const root = rootRef.current!, poster = root.querySelector('img')!, label = root.querySelector<HTMLElement>('.tile-message')!
    const stage = root.closest<HTMLElement>('.canvas-stage, .asset-preview-stage') || root.parentElement!
    let canvas: HTMLCanvasElement | null = null, surface: WebGLTileSurface | null = null, raf = 0, stopped = false, blocked = false, requiredLevel = 0
    let previousCrop: TileRect | undefined
    const owner = {}
    const release = () => {
      surface?.dispose(); surface = null; canvas?.remove(); canvas = null
      poster.style.visibility = ''; releaseTileContext(owner, wake)
      root.dataset.tileState = 'poster'
      root.dataset.imageDetail = 'preview'
    }
    const draw = () => {
      raf = 0
      if (stopped) return
      const p = propsRef.current
      if (!validPyramid(p.pyramid)) return
      const w = root.clientWidth, h = root.clientHeight, bounds = root.getBoundingClientRect()
      const stageClip = stage.getBoundingClientRect(), frameClip = root.parentElement!.getBoundingClientRect()
      // Rotation acts on source pixels inside an unrotated frame clip. Its
      // inverse may expose pixels outside the inner frame's [0,w] x [0,h].
      const clip = { left: Math.max(stageClip.left, frameClip.left), top: Math.max(stageClip.top, frameClip.top), right: Math.min(stageClip.right, frameClip.right), bottom: Math.min(stageClip.bottom, frameClip.bottom) }
      const fit = imageDrawRect(p.pyramid, { width: w, height: h }, p.framing)
      if (!fit) { release(); return }
      Object.assign(poster.style, { position: 'absolute', left: `${fit.x}px`, top: `${fit.y}px`, width: `${fit.width}px`, height: `${fit.height}px`, objectFit: 'fill' })
      root.dataset.imageFit = p.framing?.fit || 'contain'
      root.dataset.imageDrawRect = JSON.stringify(fit)
      if (!poster.complete || !poster.naturalWidth) return
      // Read the live host transform, including node gestures and image flips.
      // Camera props are committed snapshots, not the per-frame authority.
      let matrix = new DOMMatrix()
      for (let element: HTMLElement | null = root; element && element !== stage; element = element.parentElement) {
        const transform = getComputedStyle(element).transform
        if (transform !== 'none') matrix = new DOMMatrix(transform).multiply(matrix)
      }
      const scale = Math.max(.00001, maximumTransformScale([matrix.a, matrix.b, matrix.c, matrix.d])), determinant = matrix.a * matrix.d - matrix.b * matrix.c
      if (Math.abs(determinant) < 1e-12) { release(); return }
      const points = [[clip.left, clip.top], [clip.right, clip.top], [clip.left, clip.bottom], [clip.right, clip.bottom]].map(([x, y]) => {
        const dx = x - (bounds.left + bounds.width / 2), dy = y - (bounds.top + bounds.height / 2)
        return { x: (matrix.d * dx - matrix.c * dy) / determinant + w / 2, y: (-matrix.b * dx + matrix.a * dy) / determinant + h / 2 }
      })
      const x = Math.max(fit.x, Math.min(...points.map(p => p.x))), y = Math.max(fit.y, Math.min(...points.map(p => p.y)))
      const crop = { x, y, width: Math.min(fit.x + fit.width, Math.max(...points.map(p => p.x))) - x, height: Math.min(fit.y + fit.height, Math.max(...points.map(p => p.y))) - y }
      const density = scale * (window.devicePixelRatio || 1)
      const sourceCrop = imageSourceCrop(p.pyramid, fit, crop)
      if (!sourceCrop) { release(); label.hidden = true; return }
      if (poster.naturalWidth >= fit.width * density && poster.naturalHeight >= fit.height * density) { release(); root.dataset.imageDetail = 'ready'; label.hidden = true; return }
      requiredLevel = requiredPyramidLevel(p.pyramid, Math.max(fit.scaleX, fit.scaleY) * density)
      if (blocked) return
      if (!acquireTileContext(owner, wake)) { root.dataset.tileState = 'budget-preview'; label.textContent = 'Preview · zoom out of another tiled image to free detail memory'; label.hidden = false; return }
      if (!surface) {
        canvas = document.createElement('canvas'); canvas.className = 'tile-surface'; canvas.setAttribute('aria-hidden', 'true'); root.append(canvas)
        try {
          surface = new WebGLTileSurface(canvas, p.tilesUrl, poster, error => {
            if (error) { label.textContent = error.includes('context lost') ? 'Graphics restarted · click Retry tiles' : 'Some detail is unavailable · click Retry tiles'; label.hidden = false }
            if (error?.includes('context lost')) { blocked = true; queueMicrotask(release); return }
            if (canvas && Number(canvas.dataset.wanted) > 0) {
              poster.style.visibility = 'hidden'
              const d = canvas.dataset
              const state = pyramidDetailState(Number(d.wanted), Number(d.visibleReady), Number(d.failed), Number(d.level), requiredLevel, Number(d.actualDensity), Number(d.requiredDensity))
              root.dataset.tileState = state; root.dataset.imageDetail = state
              if (!error) { label.hidden = state === 'ready'; label.textContent = state === 'budget-limited' ? 'Detail preview · display memory limit' : 'Refining visible detail…' }
            }
          })
        } catch { blocked = true; canvas?.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext(); release(); label.textContent = 'Detail renderer unavailable · click Retry tiles'; label.hidden = false; return }
      }
      const tiles = planPyramid(p.pyramid, sourceCrop, Math.max(fit.scaleX, fit.scaleY) * density)
      const prefetch = planDirectionalPrefetch(p.pyramid, tiles, sourceCrop, previousCrop)
      previousCrop = sourceCrop
      surface.update({ tiles, prefetch, crop, fit, sourceWidth: p.pyramid.width, sourceHeight: p.pyramid.height, density })
    }
    const wake = () => { if (!stopped && !raf) raf = requestAppFrame(draw) }
    const stopDpr = watchPixelRatio(wake)
    const retry = () => { blocked = false; label.hidden = true; if (!poster.naturalWidth) poster.src = propsRef.current.posterUrl; surface?.retry(); wake() }
    const posterFailed = () => { label.textContent = 'Preview unavailable · Retry tiles, or right-click the image and choose Verify / repair tiled image'; label.hidden = false }
    wakeRef.current = wake
    const resize = new ResizeObserver(wake); resize.observe(root); resize.observe(stage)
    const world = root.closest('.board-world')
    const movement = new MutationObserver(wake)
    if (world) movement.observe(world, { attributes: true, attributeFilter: ['style'] })
    poster.addEventListener('load', wake); poster.addEventListener('error', posterFailed); root.querySelector('button')!.addEventListener('click', retry)
    window.addEventListener('resize', wake); stage.addEventListener('scroll', wake); stage.addEventListener('canvas-camera-presented', wake); stage.addEventListener('canvas-gesture-presented', wake); wake()
    return () => { stopped = true; stopDpr(); cancelAppFrame(raf); resize.disconnect(); movement.disconnect(); poster.removeEventListener('load', wake); poster.removeEventListener('error', posterFailed); root.querySelector('button')!.removeEventListener('click', retry); window.removeEventListener('resize', wake); stage.removeEventListener('scroll', wake); stage.removeEventListener('canvas-camera-presented', wake); stage.removeEventListener('canvas-gesture-presented', wake); release(); wakeRef.current = () => {} }
  }, [props.pyramid, props.posterUrl, props.tilesUrl])
  return <div className="tiled-image-frame" style={props.nativeSize ? { width: props.pyramid.width, height: props.pyramid.height, flexShrink: 0 } : undefined}><div className="tiled-image-preview" ref={rootRef} data-tile-state="poster" style={props.style}>
    <img crossOrigin="anonymous" className="tile-poster" src={props.posterUrl} alt={props.alt} draggable={false} />
    <span className="tile-message" hidden />
    <button type="button" className="tile-retry" title="Retry missing tiles or restart graphics" onClick={event => event.stopPropagation()}>Retry tiles</button>
  </div></div>
}
