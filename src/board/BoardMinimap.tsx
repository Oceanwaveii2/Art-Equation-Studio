import { useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasSceneSnapshot, CanvasViewport } from '../canvas-engine/contracts'
import type { BoardNode } from '../model/project'
import { mapToMinimap, minimapBounds, minimapSceneSvg, type MinimapImage } from './minimapGeometry'
import { appUpdateClock } from '../canvas-engine/appFrameClock'

type BoardMinimapProps = {
  camera?: import('../canvas-engine/liveCamera').LiveCamera
  scene: CanvasSceneSnapshot
  nodes?: readonly BoardNode[]
  viewport: CanvasViewport
  stageWidth: number
  stageHeight: number
  onViewportChange: (viewport: CanvasViewport) => void
  assetSources?: ReadonlyMap<string, string>
}

export function BoardMinimap({ scene, nodes, viewport, camera, stageWidth, stageHeight, onViewportChange, assetSources }: BoardMinimapProps) {
  const contentRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLCanvasElement>(null)
  const objects = scene.objects
  const bounds = useMemo(() => minimapBounds(objects, stageWidth, stageHeight, nodes), [objects, nodes, stageHeight, stageWidth])
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1)
  const thumbnails = useRef(new Map<string, MinimapImage | null>())
  // Small overview rasters only; never cache viewport-sized board frames.
  // Exact scene keys let undo reuse the already accepted pixels. Both the
  // entry count and aggregate SVG key size are bounded for large boards.
  const overviewRasters = useRef(new Map<string, ImageData>())

  useEffect(() => {
    let media: MediaQueryList | undefined
    const refresh = () => {
      media?.removeEventListener('change', refresh)
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      media.addEventListener('change', refresh, { once: true })
      setPixelRatio(window.devicePixelRatio || 1)
    }
    window.addEventListener('resize', refresh)
    refresh()
    return () => { window.removeEventListener('resize', refresh); media?.removeEventListener('change', refresh) }
  }, [])

  // Scene content is retained in its own layer. Camera motion only redraws the
  // small viewport rectangle below, so a 20k-object board is not replayed for
  // every pan or zoom frame.
  useEffect(() => {
    const canvas = contentRef.current
    if (!canvas) return
    const surface = prepareCanvas(canvas, pixelRatio)
    if (!surface) return
    const { context, width, height } = surface
    let cancelled = false, paintFrame: number | undefined
    let paintGeneration = 0
    const images = new Map<string, MinimapImage>()
    const byId = new Map(nodes?.map(node => [node.id, node]))
    const loading = new Map<HTMLImageElement, () => void>()
    const draw = () => {
      const generation = ++paintGeneration
      const svg = minimapSceneSvg(scene, nodes, bounds, width, height, images)
      const imageCount = images.size
      const accepted = overviewRasters.current.get(svg)
      const publish = () => {
        canvas.dataset.imageThumbnails = String(imageCount)
        canvas.dataset.sceneRevision = String(scene.revision)
      }
      if (accepted && accepted.width === canvas.width && accepted.height === canvas.height) {
        context.putImageData(accepted, 0, 0); publish(); return
      }
      const image = new Image()
      image.onload = () => {
        if (cancelled || generation !== paintGeneration) return
        context.clearRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height)
        if (svg.length <= 250_000 && canvas.width && canvas.height) try {
          overviewRasters.current.delete(svg)
          overviewRasters.current.set(svg, context.getImageData(0, 0, canvas.width, canvas.height))
          while (overviewRasters.current.size > 4) overviewRasters.current.delete(overviewRasters.current.keys().next().value!)
        } catch { /* A non-readable vector/media source cannot block the overview. */ }
        publish()
      }
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    }
    const scheduleDraw = () => {
      if (paintFrame === undefined) paintFrame = appUpdateClock.request(() => { paintFrame = undefined; if (!cancelled) draw() })
    }
    const pending = new Map<string, {ids: string[]; key: string; source: string}>()
    for (const object of scene.objects.filter(object => !object.hidden)) {
      const node = byId.get(object.id), artwork = object.modelArtwork
      const poster = node?.assetId ? assetSources?.get(node.assetId + ':overview') : undefined
      const source = poster || (artwork?.kind === 'image' ? artwork.source : node?.kind === 'image' && node.body?.startsWith('data:image/') ? node.body : undefined)
      if (!source) continue
      // Inline pixels are immutable content. Repeated cards share one decode
      // even when their object revisions differ; managed files retain a revision.
      const key = source.startsWith('data:') ? source : `${object.asset?.revision || (artwork?.kind === 'image' ? artwork.sourceRevision : 0)}:${source}`
      const cached = thumbnails.current.get(key)
      if (cached) images.set(object.id, cached)
      if (!thumbnails.current.has(key)) {
        const job = pending.get(key)
        if (job) job.ids.push(object.id)
        else pending.set(key, {ids:[object.id], key, source})
      }
    }
    const jobs = [...pending.values()]
    draw()
    // Prefer managed posters. At most two source decodes run concurrently;
    // retain only bounded, small thumbnails, never full-size media or videos.
    let next = 0
    const worker = async () => {
      while (!cancelled && next < jobs.length) {
        const job = jobs[next++], image = new Image(); image.crossOrigin = 'anonymous'
        const decoded = await new Promise<boolean>(resolve => {
          loading.set(image, () => resolve(false))
          image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = job.source
        })
        loading.delete(image)
        if (cancelled) return
        let thumbnail: MinimapImage | null = null
        if (decoded) try {
          const ratio = Math.min(1,192 / Math.max(image.naturalWidth,image.naturalHeight)), small = document.createElement('canvas')
          small.width = Math.max(1,Math.round(image.naturalWidth*ratio)); small.height = Math.max(1,Math.round(image.naturalHeight*ratio))
          small.getContext('2d')!.drawImage(image,0,0,small.width,small.height)
          thumbnail = {source:small.toDataURL('image/png'),width:image.naturalWidth,height:image.naturalHeight}
        } catch { /* Unreadable media retains its accurate object footprint. */ }
        thumbnails.current.set(job.key,thumbnail)
        while(thumbnails.current.size>128)thumbnails.current.delete(thumbnails.current.keys().next().value!)
        if(thumbnail)for(const id of job.ids)images.set(id,thumbnail)
        scheduleDraw()
      }
    }
    void worker(); void worker()
    return () => {
      cancelled = true; if (paintFrame !== undefined) appUpdateClock.cancel(paintFrame)
      for (const [image, cancel] of loading) { image.onload = null; image.onerror = null; image.src = ''; cancel() }
      loading.clear()
    }
  }, [bounds, pixelRatio, scene, nodes, assetSources])

  useEffect(() => {
    const canvas = viewportRef.current
    if (!canvas) return
    const draw = (viewport: CanvasViewport) => {
    const surface = prepareCanvas(canvas, pixelRatio)
    if (!surface) return
    const { context, width, height } = surface
    context.clearRect(0, 0, width, height)
    const map = mapToMinimap(bounds, width, height)
    const viewportLeft = -viewport.x / viewport.scale
    const viewportTop = -viewport.y / viewport.scale
    context.strokeStyle = '#e3b574'
    context.lineWidth = 1.5
    context.strokeRect(map.x(viewportLeft), map.y(viewportTop), stageWidth / viewport.scale * map.scale, stageHeight / viewport.scale * map.scale)
    }
    draw(camera?.current || viewport)
    return camera?.subscribe(draw)
  }, [bounds, pixelRatio, stageHeight, stageWidth, viewport, camera])

  const isDraggingRef = useRef(false)

  function navigate(event: React.PointerEvent<HTMLButtonElement>) {
    const current = camera?.current || viewport
    const rect = contentRef.current!.getBoundingClientRect()
    const map = mapToMinimap(bounds, rect.width, rect.height)
    const worldX = (event.clientX - rect.left - map.offsetX) / map.scale + bounds.minX
    const worldY = (event.clientY - rect.top - map.offsetY) / map.scale + bounds.minY
    onViewportChange({ ...current, x: stageWidth / 2 - worldX * current.scale, y: stageHeight / 2 - worldY * current.scale })
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    isDraggingRef.current = true
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {}
    navigate(event)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!isDraggingRef.current) return
    navigate(event)
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {}
  }

  return (
    <button
      className="board-minimap"
      type="button"
      aria-label="Board minimap. Click or drag to navigate."
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
      onKeyDown={event => {
        const delta = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key]
        if(!delta)return
        event.preventDefault();event.stopPropagation()
        const current=camera?.current||viewport,step=event.shiftKey?.5:.1
        onViewportChange({...current,x:current.x-delta[0]*stageWidth*step,y:current.y-delta[1]*stageHeight*step})
      }}
    >
      <canvas ref={contentRef} />
      <canvas className="board-minimap-viewport" ref={viewportRef} />
    </button>
  )
}

function prepareCanvas(canvas: HTMLCanvasElement, pixelRatio: number) {
  const ratio = Math.min(2, Math.max(1, pixelRatio))
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const targetWidth = Math.round(width * ratio)
  const targetHeight = Math.round(height * ratio)
  if (canvas.width !== targetWidth) canvas.width = targetWidth
  if (canvas.height !== targetHeight) canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) return undefined
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  return { context, width, height }
}
