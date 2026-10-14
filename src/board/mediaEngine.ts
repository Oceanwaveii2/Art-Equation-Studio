/**
 * Art Equation Canvas Engine - Media Fidelity Engine
 *
 * Implements strict separation of MediaAsset from MediaPlacement:
 * - Natural width/height, orientation, originalUri, and proxies preserved.
 * - Uniform scaling: contain | cover | crop | native.
 * - Strict prohibition of independent X/Y scaling (zero distortion).
 * - Video asset metadata: duration, poster frame, filmstrip keyframes, and time-range annotations.
 */

export type MediaFitMode = 'contain' | 'cover' | 'crop' | 'native'

export interface VideoMetadata {
  durationSec: number
  codec?: string
  width: number
  height: number
  fps?: number
  posterKey?: string
  filmstripKey?: string
  keyframeTimestamps?: number[]
}

export interface MediaAsset {
  assetId: string
  originalUri: string
  intrinsicWidth: number
  intrinsicHeight: number
  orientation?: number
  colorProfile?: string
  checksum?: string
  proxyUris?: {
    thumb?: string
    medium?: string
    high?: string
  }
  video?: VideoMetadata
}

export interface NormalizedRect {
  x: number // 0.0 - 1.0
  y: number // 0.0 - 1.0
  width: number // 0.0 - 1.0
  height: number // 0.0 - 1.0
}

export interface MediaPlacement {
  cardId: string
  assetId: string
  frameRect: {
    x: number
    y: number
    width: number
    height: number
  }
  fitMode: MediaFitMode
  cropRectNormalized?: NormalizedRect
  rotation?: number // in degrees
}

export interface ComputedMediaFit {
  // Destination position and size on canvas
  destX: number
  destY: number
  destWidth: number
  destHeight: number
  // Source crop rectangle inside the original asset
  srcX: number
  srcY: number
  srcWidth: number
  srcHeight: number
  // Transform scale factors (uniform!)
  scale: number
  uniformScaleX: number
  uniformScaleY: number
}

/**
 * Calculates uniform, aspect-ratio-preserving media placement.
 * Ensures zero image distortion under all standard fit modes.
 */
export function calculateMediaFit(
  asset: { intrinsicWidth: number; intrinsicHeight: number },
  placement: {
    frameRect: { x: number; y: number; width: number; height: number }
    fitMode: MediaFitMode
    cropRectNormalized?: NormalizedRect
  }
): ComputedMediaFit {
  const { intrinsicWidth: iw, intrinsicHeight: ih } = asset
  const { frameRect, fitMode, cropRectNormalized } = placement
  const { x: fx, y: fy, width: fw, height: fh } = frameRect

  if (iw <= 0 || ih <= 0 || fw <= 0 || fh <= 0) {
    return {
      destX: fx,
      destY: fy,
      destWidth: fw,
      destHeight: fh,
      srcX: 0,
      srcY: 0,
      srcWidth: Math.max(1, iw),
      srcHeight: Math.max(1, ih),
      scale: 1,
      uniformScaleX: 1,
      uniformScaleY: 1
    }
  }

  // Calculate effective source area if a normalized crop rectangle is provided
  let sx = 0
  let sy = 0
  let sw = iw
  let sh = ih

  if (cropRectNormalized) {
    const cx = Math.max(0, Math.min(1, cropRectNormalized.x))
    const cy = Math.max(0, Math.min(1, cropRectNormalized.y))
    const cw = Math.max(0.01, Math.min(1 - cx, cropRectNormalized.width))
    const ch = Math.max(0.01, Math.min(1 - cy, cropRectNormalized.height))
    sx = cx * iw
    sy = cy * ih
    sw = cw * iw
    sh = ch * ih
  }

  const assetAspect = sw / sh
  const frameAspect = fw / fh

  let destX = fx
  let destY = fy
  let destWidth = fw
  let destHeight = fh
  let scale = 1

  switch (fitMode) {
    case 'contain': {
      // Scale uniformly until either width or height touches the frame boundary
      if (assetAspect > frameAspect) {
        // Limited by frame width
        scale = fw / sw
        destWidth = fw
        destHeight = sh * scale
        destX = fx
        destY = fy + (fh - destHeight) / 2 // Center vertically
      } else {
        // Limited by frame height
        scale = fh / sh
        destHeight = fh
        destWidth = sw * scale
        destX = fx + (fw - destWidth) / 2 // Center horizontally
        destY = fy
      }
      break
    }

    case 'cover': {
      // Scale uniformly until the entire frame is filled, clipping excess
      if (assetAspect > frameAspect) {
        // Fill frame height, clip horizontal sides
        scale = fh / sh
        const visibleSrcWidth = fw / scale
        sx += (sw - visibleSrcWidth) / 2
        sw = visibleSrcWidth
        destWidth = fw
        destHeight = fh
      } else {
        // Fill frame width, clip vertical top/bottom
        scale = fw / sw
        const visibleSrcHeight = fh / scale
        sy += (sh - visibleSrcHeight) / 2
        sh = visibleSrcHeight
        destWidth = fw
        destHeight = fh
      }
      break
    }

    case 'native': {
      // 1:1 pixel mapping, centered
      scale = 1
      destWidth = sw
      destHeight = sh
      destX = fx + (fw - destWidth) / 2
      destY = fy + (fh - destHeight) / 2
      break
    }

    case 'crop':
    default: {
      // Uses cropRectNormalized directly, fitted to the frame bounds with aspect preservation
      scale = Math.min(fw / sw, fh / sh)
      destWidth = sw * scale
      destHeight = sh * scale
      destX = fx + (fw - destWidth) / 2
      destY = fy + (fh - destHeight) / 2
      break
    }
  }

  return {
    destX,
    destY,
    destWidth,
    destHeight,
    srcX: sx,
    srcY: sy,
    srcWidth: sw,
    srcHeight: sh,
    scale,
    uniformScaleX: scale,
    uniformScaleY: scale
  }
}

/**
 * Creates Display List v2 operations for rendering an image asset with uniform fit mode.
 */
export function createMediaRenderOp(
  opId: string,
  resourceRef: { key: string; width: number; height: number; revision: number; epoch: number },
  computedFit: ComputedMediaFit,
  opacity: number = 1.0
): any {
  // Transform places image at destX, destY scaled uniformly by computedFit.scale
  // Note: if covered or cropped, sourceRect selects the visible region of the texture
  const sx = computedFit.scale
  const sy = computedFit.scale
  const tx = computedFit.destX - sx * computedFit.srcX
  const ty = computedFit.destY - sy * computedFit.srcY

  return {
    type: 'image',
    id: opId,
    resource: {
      key: resourceRef.key,
      revision: resourceRef.revision || 1,
      epoch: resourceRef.epoch || 1,
      width: resourceRef.width,
      height: resourceRef.height
    },
    sourceRect: {
      x: computedFit.srcX,
      y: computedFit.srcY,
      width: computedFit.srcWidth,
      height: computedFit.srcHeight
    },
    transform: [sx, 0, 0, sy, tx, ty],
    opacity,
    sampling: 'bilinear'
  }
}
