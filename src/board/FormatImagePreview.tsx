import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeTiff } from './preparationWorkers'
import { watchPixelRatio } from './watchPixelRatio'
import { recordMetric } from '../diagnostics/performance'
import { imageDrawRect, normalizeImageFraming, type ImageFraming } from '../model/imageFraming'
import { probeImageDimensions } from './imageDimensions'
import './FormatImagePreview.css'

type RasterDimensions = { width: number; height: number }
export type RasterPreviewMetadata = RasterDimensions & { decodedBytes: number; requiredWidth: number; requiredHeight: number; detailRatio: number; sourceLimited: boolean; renderSource: 'proxy' | 'original' | 'decoded'; detailState: 'refining' | 'ready' | 'limited' | 'error' }
type Props = { source: string; previewSource?: string; extension: string; alt: string; viewportScale?: number; devicePixelRatio?: number; showStatus?: boolean; style?: React.CSSProperties; onMetadata?: (metadata: RasterPreviewMetadata) => void; proxyOnly?: boolean; framing?: ImageFraming }

/** Selects a proxy or full-resolution source from actual physical-pixel demand. TIFF is decoded losslessly. */
export function FormatImagePreview({ source, previewSource, extension, alt, viewportScale = 1, devicePixelRatio, showStatus = false, style, onMetadata, proxyOnly = false, framing }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [decodedSource, setDecodedSource] = useState<string>()
  const [liveDpr, setLiveDpr] = useState(devicePixelRatio ?? window.devicePixelRatio ?? 1)
  useEffect(() => watchPixelRatio(() => setLiveDpr(devicePixelRatio ?? window.devicePixelRatio ?? 1)), [devicePixelRatio])
  const [liveScale, setLiveScale] = useState(viewportScale)
  useEffect(() => {
    const stage = rootRef.current?.closest<HTMLElement>('.canvas-stage')
    let previous = 0
    const update = () => {
      const scale = stage?.dataset.liveCamera ? JSON.parse(stage.dataset.liveCamera).scale as number : viewportScale
      const bucket = 2 ** Math.ceil(Math.log2(Math.max(.0001, scale)))
      if (bucket !== previous) { previous = bucket; setLiveScale(bucket) }
    }
    update(); stage?.addEventListener('canvas-camera-presented', update)
    return () => stage?.removeEventListener('canvas-camera-presented', update)
  }, [viewportScale])
  const [container, setContainer] = useState<RasterDimensions>({ width: 0, height: 0 })
  const [originalSize, setOriginalSize] = useState<RasterDimensions>()
  const [previewSize, setPreviewSize] = useState<RasterDimensions>()
  const [decoded, setDecoded] = useState<string>()
  const [error, setError] = useState<string>()
  const [forceOriginal, setForceOriginal] = useState(false)
  const normalizedExtension = extension.toLowerCase()
  const isTiff = normalizedExtension === 'tif' || normalizedExtension === 'tiff'

  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const update = () => setContainer({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update); observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setError(undefined); setForceOriginal(false); setOriginalSize(undefined); setPreviewSize(undefined)
    if (isTiff || proxyOnly) return
    let cancelled = false
    void probeImageDimensions(source).then((size) => !cancelled && setOriginalSize(size)).catch((reason) => !cancelled && setError(String(reason)))
    if (previewSource && previewSource !== source) void probeImageDimensions(previewSource).then((size) => !cancelled && setPreviewSize(size)).catch(() => !cancelled && setPreviewSize(undefined))
    else setPreviewSize(undefined)
    return () => { cancelled = true }
  }, [isTiff, previewSource, source, proxyOnly])

  useEffect(() => {
    if (!isTiff || proxyOnly) { setDecoded(undefined); return }
    let cancelled = false; let objectUrl: string | undefined
    const controller = new AbortController()
    setDecoded(undefined)
    const started = performance.now()
    void decodeTiff(source, controller.signal, showStatus).then(({ blob, width, height, cacheHit, cacheStored }) => {
      if (!cancelled) { recordMetric('image.tiff-preparation', { ms: performance.now() - started, width, height, cacheHit, cacheStored }); setOriginalSize({ width, height }); objectUrl = URL.createObjectURL(blob); setDecoded(objectUrl) }
    }).catch((reason) => !cancelled && setError(String(reason)))
    return () => { cancelled = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [isTiff, source, proxyOnly])

  const detail = useMemo(() => {
    if (!originalSize) return undefined
    const displayed = imageDrawRect(originalSize, container, framing)
    if (!displayed) return undefined
    const demandScale = Math.max(.01, liveScale) * Math.max(1, liveDpr)
    const requiredWidth = displayed.width * demandScale; const requiredHeight = displayed.height * demandScale
    const detailRatio = Math.min(originalSize.width / Math.max(1, requiredWidth), originalSize.height / Math.max(1, requiredHeight))
    return { requiredWidth, requiredHeight, detailRatio, sourceLimited: detailRatio < .98 }
  }, [container, liveDpr, originalSize, liveScale, framing?.fit, framing?.positionX, framing?.positionY, framing?.zoom])
  const previewCanMeetDemand = Boolean(previewSize && detail && previewSize.width >= detail.requiredWidth && previewSize.height >= detail.requiredHeight)
  const renderSource = isTiff ? 'decoded' : previewSource && previewSource !== source && previewCanMeetDemand && !forceOriginal ? 'proxy' : 'original'
  const activeSource = renderSource === 'decoded' ? decoded : renderSource === 'proxy' ? previewSource : source
  useEffect(() => {
    let cancelled = false
    setDecodedSource(undefined)
    const image = imageRef.current
    const ready = async () => {
      try { await image?.decode(); if (!cancelled && image && image.complete && image.naturalWidth > 0) setDecodedSource(activeSource) }
      catch { /* onError handles fallback; a dimensions probe cannot certify display readiness */ }
    }
    if (image?.complete) void ready()
    image?.addEventListener('load', ready)
    return () => { cancelled = true; image?.removeEventListener('load', ready) }
  }, [activeSource])
  const detailState = error ? 'error' : !activeSource || decodedSource !== activeSource || !detail ? 'refining' : detail.sourceLimited ? 'limited' : 'ready'
  const metadata = normalizeImageFraming(framing)
  const imageDimensions = originalSize || previewSize
  const draw = imageDimensions && imageDrawRect(imageDimensions, container, metadata)
  const imageStyle: React.CSSProperties = draw ? {
    ...style, position: 'absolute', left: draw.x, top: draw.y, width: draw.width, height: draw.height, objectFit: 'fill',
    // Image transforms are centered on the frame, not a repositioned crop.
    transformOrigin: `${container.width / 2 - draw.x}px ${container.height / 2 - draw.y}px`,
  } : { ...style, objectFit: metadata.fit, objectPosition: `${metadata.positionX}% ${metadata.positionY}%` }
  const loadedDimensions = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget, dimensions = { width: image.naturalWidth, height: image.naturalHeight }
    // A recovered source must retire the earlier decode-error overlay.
    if (dimensions.width > 0 && dimensions.height > 0) setError(undefined)
    if (proxyOnly || renderSource === 'proxy') setPreviewSize(dimensions)
    else setOriginalSize(dimensions)
  }

  useEffect(() => {
    if (detail && originalSize) onMetadata?.({ ...originalSize, decodedBytes: originalSize.width * originalSize.height * 4, ...detail, renderSource, detailState })
  }, [detail, onMetadata, originalSize, renderSource, detailState])

  if (proxyOnly) return <div ref={rootRef} className="format-image-preview" data-image-extension={normalizedExtension} data-image-fit={metadata.fit}><img crossOrigin="anonymous" src={previewSource} alt={alt} draggable={false} style={imageStyle} onLoad={loadedDimensions} /><div className="raster-detail-badge">Right-click → Prepare tiled image for full detail</div></div>
  if (isTiff && !decoded) return <div ref={rootRef} className="format-image-status">{error ? <><strong>TIFF preview unavailable</strong><span>{error}</span></> : 'Decoding full-resolution TIFF…'}</div>
  return <div ref={rootRef} className="format-image-preview" data-image-extension={normalizedExtension} data-image-fit={metadata.fit} data-image-detail={detailState} data-image-original-width={originalSize?.width} data-image-original-height={originalSize?.height}>
    {activeSource && <img ref={imageRef} crossOrigin="anonymous" src={activeSource} alt={alt} draggable={false} decoding="async" style={imageStyle} onLoad={loadedDimensions} onError={() => renderSource === 'proxy' ? setForceOriginal(true) : setError(`${extension.toUpperCase()} is not supported by this desktop renderer`)} />}
    {error && <div className="raster-detail-badge error">{error}</div>}
    {!error && detail && originalSize && (showStatus || detail.sourceLimited) && <div className={`raster-detail-badge ${detail.sourceLimited ? 'limited' : ''}`} title={`Needs ${Math.ceil(detail.requiredWidth)} × ${Math.ceil(detail.requiredHeight)} physical pixels at this zoom`}><strong>{detailState === 'refining' ? 'REFINING' : detail.sourceLimited ? 'SOURCE LIMIT' : renderSource === 'proxy' ? 'PROXY OK' : 'FULL DETAIL'}</strong><span>{originalSize.width} × {originalSize.height}</span></div>}
  </div>
}
