import { DecodedImageRegistry, MAX_DECODED_IMAGE_BYTES, MAX_DECODED_IMAGE_EDGE, imageIdentity, validateImageReference } from '../../canvas-engine/decodedImageRegistry'
import { imageDemand } from '../../canvas-engine/imageDemand'
import { canvasResourceBudget, type CanvasResourceBudget } from '../../canvas-engine/resourceBudget'
import type { CanvasRect } from '../../canvas-engine/contracts'
import type { DecodedImageUpload, PaintMatrix, PaintOperation } from '../../canvas-engine/paintDisplayList'

export type LiveVideoFrameSnapshot = Readonly<{
  watcherId: number; revision: number; source: string; sourceAttribute: string
  sourceSignature: string; currentTime: number; mediaTime: number
  width: number; height: number; presentedFrames: number | null
}>
export type LiveVideoInvalidation = 'frame' | 'loadeddata' | 'loadedmetadata' | 'seeked' | 'seeking' | 'play' | 'pause' | 'ended' | 'resize' | 'timeupdate' | 'source' | 'unavailable' | 'disconnected'
export type LiveVideoFrameWatcher = Readonly<{
  snapshot(): LiveVideoFrameSnapshot | null
  isCurrent(frame: LiveVideoFrameSnapshot): boolean
  dispose(): void
}>
let nextWatcherId = 0
const sourceSignature = (video: HTMLVideoElement) => JSON.stringify([
  video.getAttribute('src') ?? '', video.src,
  [...video.querySelectorAll('source')].map(source => [source.getAttribute('src') ?? '', source.getAttribute('type') ?? '']),
])
const readable = (video: HTMLVideoElement) => video.isConnected && video.srcObject === null && !video.error && !video.seeking
  && video.readyState >= 2 && Number.isFinite(video.currentTime) && video.currentTime >= 0
  && [video.videoWidth, video.videoHeight].every(value => Number.isSafeInteger(value) && value > 0)

/** Observe decoded frames, never drive playback or copy the media document.
 * A paused player has no recurring callback. Source changes/seek revoke the
 * previous marker until current decoded data is available. Removed elements
 * dispose their listeners and queued callbacks even when playback is paused. */
export function watchLiveVideoFrames(video: HTMLVideoElement, options: {
  onInvalidate(reason: LiveVideoInvalidation, frameRevision: number): void
}): LiveVideoFrameWatcher {
  const watcherId = ++nextWatcherId
  let disposed = false, revision = 1, pending: number | undefined, callbackVersion = 0
  let signature = sourceSignature(video), waitingForLoad = false
  let decoded = video.paused && readable(video), mediaTime = video.currentTime, presentedFrames: number | null = null
  const listeners: [string, EventListener][] = []
  const canObserveFrames = typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function'
  const cancel = () => {
    callbackVersion++
    if (pending !== undefined) { video.cancelVideoFrameCallback(pending); pending = undefined }
  }
  const notify = (reason: LiveVideoInvalidation) => {
    if (!Number.isSafeInteger(++revision)) throw new Error('VIDEO_FRAME_REVISION_EXHAUSTED')
    options.onInvalidate(reason, revision)
  }
  const dispose = () => {
    if (disposed) return
    disposed = true; cancel()
    for (const [type, listener] of listeners) video.removeEventListener(type, listener)
    listeners.length = 0; sourceObserver?.disconnect(); removalObserver?.disconnect()
  }
  const connected = () => {
    if (disposed) return false
    if (video.isConnected) return true
    dispose(); notify('disconnected'); return false
  }
  const sourceChanged = () => {
    if (!connected()) return
    const current = sourceSignature(video)
    if (current === signature) return
    signature = current; waitingForLoad = true; decoded = false; presentedFrames = null; cancel(); notify('source')
  }
  const arm = () => {
    if (!connected() || pending !== undefined || !canObserveFrames || video.paused || video.ended || video.seeking || waitingForLoad) return
    const version = callbackVersion
    pending = video.requestVideoFrameCallback((_now, metadata) => {
      if (disposed || version !== callbackVersion) return
      pending = undefined
      if (!connected()) return
      sourceChanged()
      if (version !== callbackVersion || waitingForLoad || video.seeking) return
      const valid = readable(video) && Number.isFinite(metadata.mediaTime) && metadata.mediaTime >= 0
        && Number.isSafeInteger(metadata.presentedFrames) && metadata.presentedFrames >= 0
      decoded = valid; mediaTime = valid ? metadata.mediaTime : video.currentTime
      presentedFrames = valid ? metadata.presentedFrames : null
      try { notify(valid ? 'frame' : 'unavailable') } finally { arm() }
    })
  }
  const add = (type: string, listener: () => void) => {
    const callback: EventListener = () => { if (connected()) listener() }
    listeners.push([type, callback]); video.addEventListener(type, callback)
  }
  const accept = (reason: 'loadeddata' | 'seeked' | 'pause' | 'ended' | 'resize' | 'timeupdate') => {
    signature = sourceSignature(video)
    if (reason === 'loadeddata') waitingForLoad = false
    decoded = !waitingForLoad && readable(video); mediaTime = video.currentTime; presentedFrames = null
    try { notify(reason) } finally { arm() }
  }
  add('loadeddata', () => accept('loadeddata'))
  add('seeked', () => accept('seeked'))
  add('resize', () => accept('resize'))
  add('loadedmetadata', () => { sourceChanged(); decoded = false; notify('loadedmetadata'); arm() })
  add('seeking', () => { decoded = false; presentedFrames = null; cancel(); notify('seeking') })
  add('play', () => { sourceChanged(); decoded = false; notify('play'); arm() })
  add('pause', () => { cancel(); accept('pause') })
  add('ended', () => { cancel(); accept('ended') })
  add('timeupdate', () => { if (video.paused && !video.seeking) accept('timeupdate') })
  for (const type of ['emptied', 'error', 'abort']) add(type, () => { decoded = false; waitingForLoad = true; presentedFrames = null; cancel(); notify('unavailable') })
  const Observer = video.ownerDocument.defaultView?.MutationObserver
  const sourceObserver = Observer ? new Observer(() => sourceChanged()) : undefined
  sourceObserver?.observe(video, { attributes: true, attributeFilter: ['src', 'type'], childList: true, subtree: true })
  const removalObserver = Observer ? new Observer(() => { connected() }) : undefined
  removalObserver?.observe(video.ownerDocument.documentElement, { childList: true, subtree: true })
  const snapshot = (): LiveVideoFrameSnapshot | null => {
    if (!connected()) return null
    sourceChanged()
    const source = video.currentSrc || video.src
    if (!decoded || waitingForLoad || !readable(video) || !source || !video.paused && !canObserveFrames) return null
    return Object.freeze({ watcherId, revision, source, sourceAttribute: video.getAttribute('src') ?? '', sourceSignature: signature,
      currentTime: video.currentTime, mediaTime, width: video.videoWidth, height: video.videoHeight, presentedFrames })
  }
  const isCurrent = (frame: LiveVideoFrameSnapshot) => {
    const current = snapshot()
    return current !== null && frame.watcherId === current.watcherId && frame.revision === current.revision
      && frame.source === current.source && frame.sourceSignature === current.sourceSignature
      && frame.sourceAttribute === current.sourceAttribute && frame.width === current.width && frame.height === current.height
      && frame.presentedFrames === current.presentedFrames && frame.mediaTime === current.mediaTime
      && (!video.paused || frame.currentTime === current.currentTime)
  }
  arm()
  return { snapshot, isCurrent, dispose }
}

export type LiveVideoCaptureOptions = Readonly<{
  /** A new decoded frame needs a new immutable resource revision, even when
   * the surrounding document revision and video source are unchanged. */
  id: string; key: string; revision: number; epoch?: number; frame: LiveVideoFrameSnapshot
  contentTransform: PaintMatrix; contentSize: Readonly<{ width: number; height: number }>; physicalScale: number
  isCurrentFrame(frame: LiveVideoFrameSnapshot): boolean
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'
  /** Normalized computed object-position. CSS pixel positions need conversion
   * by the caller using the free space before this provider can be qualified. */
  objectPosition?: readonly [number, number]; opacity?: number; budget?: CanvasResourceBudget
}>
type FrameBinding = { revision: number; watcherId: number; frameRevision: number; source: string; sourceSignature: string }
const frameBindings = new WeakMap<DecodedImageRegistry, Map<string, FrameBinding>>()

/** Retire a removed provider's frame markers and its demand-derived mips.
 * Decoded uploads and their visible/transport leases remain registry-owned. */
export function retireLiveVideoPaintBindings(registry: DecodedImageRegistry, key: string): void {
  const bindings = frameBindings.get(registry)
  if (!bindings) return
  const mipPrefix = `${key}:mip:`
  for (const identity of bindings.keys()) if (identity === key || identity.startsWith(mipPrefix)) bindings.delete(identity)
}

/** Current decoded video pixels use the existing revisioned RGBA registry.
 * This bounded sRGB readback is a coverage provider, not a zero-copy promise.
 * The image has its actual contain/cover geometry and explicit content clip;
 * the enclosing complete card still owns its background, controls and order. */
export function captureLiveVideoPaint(video: HTMLVideoElement, registry: DecodedImageRegistry, options: LiveVideoCaptureOptions): {
  operations: readonly PaintOperation[]; upload: DecodedImageUpload; source: string; frameRevision: number; visualBounds: CanvasRect
} {
  const frame = options.frame, { width: contentWidth, height: contentHeight } = options.contentSize
  const matrix = options.contentTransform, position = options.objectPosition ?? [.5, .5], opacity = options.opacity ?? 1
  if (!options.id || !options.key || !Number.isSafeInteger(options.revision) || options.revision <= 0
    || !Number.isSafeInteger(frame.revision) || frame.revision <= 0 || options.epoch !== undefined && options.epoch !== registry.epoch)
    throw new Error('VIDEO_RESOURCE_INVALID: identity, epoch or revision')
  if (matrix.length !== 6 || ![...matrix, contentWidth, contentHeight, options.physicalScale, ...position, opacity].every(Number.isFinite)
    || Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12 || contentWidth <= 0 || contentHeight <= 0 || options.physicalScale <= 0
    || position.length !== 2 || opacity < 0 || opacity > 1) throw new Error('VIDEO_PAINT_INVALID: geometry')
  const current = () => readable(video) && (video.currentSrc || video.src) === frame.source && video.videoWidth === frame.width
    && video.videoHeight === frame.height && sourceSignature(video) === frame.sourceSignature && options.isCurrentFrame(frame)
  if (!current()) throw new Error('VIDEO_FRAME_NOT_CURRENT: decoded marker unavailable or stale')
  const style = video.ownerDocument.defaultView?.getComputedStyle(video)
  if (!style || style.filter !== 'none' || style.mixBlendMode !== 'normal') throw new Error('VIDEO_PAINT_UNSUPPORTED: effects require ordered operations')
  let scaleX = contentWidth / frame.width, scaleY = contentHeight / frame.height
  const fit = options.objectFit ?? 'contain'
  if (fit !== 'fill') {
    const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : fit === 'contain' ? Math.min(scaleX, scaleY)
      : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, scaleX, scaleY) : NaN
    if (!Number.isFinite(scale)) throw new Error('VIDEO_PAINT_UNSUPPORTED: object fit')
    scaleX = scaleY = scale
  }
  const left = (contentWidth - frame.width * scaleX) * position[0], top = (contentHeight - frame.height * scaleY) * position[1]
  const [a, b, c, d, e, f] = matrix
  const imageMatrix: PaintMatrix = [a * scaleX, b * scaleX, c * scaleY, d * scaleY, e + a * left + c * top, f + b * left + d * top]
  const demand = imageDemand(frame.width, frame.height, imageMatrix, options.physicalScale), { width, height } = demand
  if (width > MAX_DECODED_IMAGE_EDGE || height > MAX_DECODED_IMAGE_EDGE || width * height * 8 > MAX_DECODED_IMAGE_BYTES)
    throw new Error('RESOURCE_BUDGET_EXCEEDED: video frame requires a qualified bounded derivative')
  const reference = validateImageReference({ key: demand.divisor === 1 ? options.key : `${options.key}:mip:${width}x${height}`,
    revision: options.revision, epoch: registry.epoch, width, height })
  // Resource versions identify decoded frames, not a guessed equality of
  // their pixels. Reusing a scene revision for a later frame is a hard error.
  const bindings = frameBindings.get(registry) ?? new Map<string, FrameBinding>(), binding = bindings.get(reference.key)
  if (binding && (reference.revision < binding.revision || reference.revision === binding.revision && (
    binding.watcherId !== frame.watcherId || binding.frameRevision !== frame.revision || binding.source !== frame.source || binding.sourceSignature !== frame.sourceSignature)))
    throw new Error('RESOURCE_REVISION_CONFLICT: video revision does not identify the current decoded frame')
  if (!binding && bindings.size >= 1024) throw new Error('RESOURCE_BUDGET_EXCEEDED: video identity limit')
  let upload: DecodedImageUpload
  try { upload = registry.resolve(reference) } catch (error) {
    if (!String(error).includes('RESOURCE_NOT_READY')) throw error
    const lease = (options.budget ?? canvasResourceBudget).acquire({ owner: registry, key: `video-decode:${imageIdentity(reference)}`,
      pool: 'tile-surface', bytes: width * height * 8, pinned: true })
    if (!lease) throw new Error('RESOURCE_BUDGET_EXCEEDED: video readback denied')
    const canvas = video.ownerDocument.createElement('canvas')
    try {
      canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
      if (!context) throw new Error('RESOURCE_UNREADABLE: video decoding context unavailable')
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
      context.drawImage(video, 0, 0, width, height)
      const pixels = context.getImageData(0, 0, width, height, { colorSpace: 'srgb' })
      if (!current()) throw new Error('VIDEO_FRAME_NOT_CURRENT: provider changed during pixel capture')
      upload = registry.register(reference, pixels.data)
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'SecurityError')
        throw new Error('RESOURCE_UNREADABLE: video pixels cannot be read')
      throw error
    } finally { canvas.width = 0; canvas.height = 0; lease.release() }
  }
  if (!current()) throw new Error('VIDEO_FRAME_NOT_CURRENT: provider changed after pixel capture')
  bindings.set(reference.key, { revision: reference.revision, watcherId: frame.watcherId, frameRevision: frame.revision, source: frame.source, sourceSignature: frame.sourceSignature })
  frameBindings.set(registry, bindings)
  const scopeId = `${options.id}:video-content`, commands = [['M', 0, 0], ['L', contentWidth, 0], ['L', contentWidth, contentHeight], ['L', 0, contentHeight], ['Z']] as const
  const transform: PaintMatrix = [imageMatrix[0] * frame.width / width, imageMatrix[1] * frame.width / width,
    imageMatrix[2] * frame.height / height, imageMatrix[3] * frame.height / height, imageMatrix[4], imageMatrix[5]]
  const points = [[0, 0], [contentWidth, 0], [contentWidth, contentHeight], [0, contentHeight]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  return { operations: [{ type: 'pushClip', scopeId, commands, transform: matrix, fillRule: 'nonzero', isolation: 'isolated' },
    { type: 'image', id: options.id, resource: reference, sourceRect: { x: 0, y: 0, width, height }, transform, opacity, sampling: 'bilinear' }, { type: 'pop', scopeId }],
    upload, source: frame.source, frameRevision: frame.revision,
    visualBounds: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } }
}
