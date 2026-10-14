import type { ImageTransform } from './project'

export type ImageFraming = Pick<ImageTransform, 'fit' | 'positionX' | 'positionY' | 'zoom'>
export type ImageDimensions = { width: number; height: number }
export type ImageDrawRect = ImageDimensions & { x: number; y: number; scaleX: number; scaleY: number }
export type ImageRect = ImageDimensions & { x: number; y: number }

const finite = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const validSize = (size: ImageDimensions) => Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0

/** Source-safe metadata, not destructive pixel cropping. Percent position follows
 * object-position: it aligns that percentage of the image with the frame. */
export function normalizeImageFraming(framing?: ImageFraming): Required<ImageFraming> {
  return {
    fit: framing?.fit === 'cover' || framing?.fit === 'fill' ? framing.fit : 'contain',
    positionX: clamp(finite(framing?.positionX, 50), 0, 100),
    positionY: clamp(finite(framing?.positionY, 50), 0, 100),
    zoom: clamp(finite(framing?.zoom, 1), 1, 4),
  }
}

/** Canonical source-pixel -> frame rectangle. Consumers clip to the original
 * frame and retain their existing rotation/flip around its center. Explicit
 * fill is the only mode that changes source aspect ratio. */
export function imageDrawRect(source: ImageDimensions, frame: ImageDimensions, framing?: ImageFraming): ImageDrawRect | undefined {
  if (!validSize(source) || !validSize(frame)) return undefined
  const metadata = normalizeImageFraming(framing)
  const fitX = frame.width / source.width, fitY = frame.height / source.height
  const uniform = metadata.fit === 'cover' ? Math.max(fitX, fitY) : Math.min(fitX, fitY)
  const scaleX = (metadata.fit === 'fill' ? fitX : uniform) * metadata.zoom
  const scaleY = (metadata.fit === 'fill' ? fitY : uniform) * metadata.zoom
  const width = source.width * scaleX, height = source.height * scaleY
  const x = (frame.width - width) * metadata.positionX / 100
  const y = (frame.height - height) * metadata.positionY / 100
  if (![x, y, width, height, scaleX, scaleY].every(Number.isFinite)) return undefined
  return { x, y, width, height, scaleX, scaleY }
}

/** Visible frame rectangle -> bounded source ROI. Separate X/Y scales retain
 * correctness for explicit fill. Empty letterbox-only views request no tiles. */
export function imageSourceCrop(source: ImageDimensions, fit: ImageDrawRect, crop: ImageRect): ImageRect | undefined {
  if (!validSize(source) || !validSize(crop) || ![crop.x, crop.y, fit.x, fit.y, fit.width, fit.height, fit.scaleX, fit.scaleY].every(Number.isFinite) || fit.scaleX <= 0 || fit.scaleY <= 0) return undefined
  const x0 = clamp((crop.x - fit.x) / fit.scaleX, 0, source.width)
  const y0 = clamp((crop.y - fit.y) / fit.scaleY, 0, source.height)
  const x1 = clamp((crop.x + crop.width - fit.x) / fit.scaleX, 0, source.width)
  const y1 = clamp((crop.y + crop.height - fit.y) / fit.scaleY, 0, source.height)
  if (x1 <= x0 || y1 <= y0) return undefined
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
