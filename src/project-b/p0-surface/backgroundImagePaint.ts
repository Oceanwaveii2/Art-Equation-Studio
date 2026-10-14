import type { CanvasRect } from '../../canvas-engine/contracts'
import { DecodedImageRegistry, imageIdentity, MAX_DECODED_IMAGE_BYTES, MAX_DECODED_IMAGE_EDGE, validateImageReference } from '../../canvas-engine/decodedImageRegistry'
import { imageDemand } from '../../canvas-engine/imageDemand'
import type { DecodedImageUpload, PaintMatrix, PaintOperation } from '../../canvas-engine/paintDisplayList'
import { canvasResourceBudget, type CanvasResourceBudget } from '../../canvas-engine/resourceBudget'
import { resolveMeasuredBackgroundGeometry, type MeasuredBackgroundLayer } from '../../board/measuredBackgroundPaint'

type ScaleImage = Readonly<{ width: number; height: number; transform: PaintMatrix; acceptedWidth: number; acceptedHeight: number }>
export type BackgroundImagePaint = Readonly<{
  operations: readonly PaintOperation[]; uploads: readonly DecodedImageUpload[]
  visualBounds: CanvasRect; scaleImages: readonly ScaleImage[]
}>
export type BackgroundImagePaintOptions = Readonly<{
  id: string; key: string; revision: number; layer: MeasuredBackgroundLayer
  borderBoxTransform: PaintMatrix
  /** Camera scale multiplied by devicePixelRatio, not CSS-only zoom. */
  physicalScale: number; budget?: CanvasResourceBudget
}>

const validMatrix = (matrix: PaintMatrix) => matrix.length === 6 && matrix.every(Number.isFinite)
  && Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) >= 1e-12
function rectangleBounds(rect: CanvasRect, matrix: PaintMatrix): CanvasRect {
  const [a, b, c, d, e, f] = matrix
  const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
  const xs = points.map(([x, y]) => a * x + c * y + e), ys = points.map(([x, y]) => b * x + d * y + f)
  const x = Math.min(...xs), y = Math.min(...ys)
  const bounds = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  if (!Object.values(bounds).every(Number.isFinite)) throw new Error('IMAGE_INVALID: background bounds overflow')
  return bounds
}
function union(a: CanvasRect, b: CanvasRect): CanvasRect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** Converts a loaded, off-DOM static CSS image into existing image operations.
 * Source loading, static-format qualification and rounded layer clipping belong
 * to the caller. No image/canvas is appended to the measured card. Each decode
 * obeys the same physical pixel demand and immutable registry as other media. */
export function captureBackgroundImagePaint(image: HTMLImageElement, registry: DecodedImageRegistry, options: BackgroundImagePaintOptions): BackgroundImagePaint {
  const source = image.currentSrc || image.src, width = image.naturalWidth, height = image.naturalHeight
  if (!options.id || options.layer.kind !== 'image' || !validMatrix(options.borderBoxTransform)
    || !Number.isFinite(options.physicalScale) || options.physicalScale <= 0) throw new Error('IMAGE_INVALID: background image options')
  if (image.isConnected || !image.complete || !source || ![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('RESOURCE_NOT_READY: loaded off-DOM background image required')
  // Bind the already loaded pixels to the actual parsed CSS URL, including
  // relative URLs; this helper never initiates a fetch or changes the source.
  let expected: string
  try { expected = new URL(options.layer.source, image.ownerDocument.baseURI).href }
  catch { throw new Error('IMAGE_INVALID: background source identity') }
  if (source !== expected) throw new Error('RESOURCE_STALE_DECODE: background image does not match CSS source')
  const fresh = () => !image.isConnected && image.complete && (image.currentSrc || image.src) === source
    && image.naturalWidth === width && image.naturalHeight === height
  const assertFresh = () => { if (!fresh()) throw new Error('RESOURCE_STALE_DECODE: background source changed during capture') }
  const geometry = resolveMeasuredBackgroundGeometry(options.layer, { width, height })
  const operations: PaintOperation[] = [], uploads = new Map<string, DecodedImageUpload>(), scaleImages: ScaleImage[] = []
  let visualBounds: CanvasRect | undefined
  for (const [index, tile] of geometry.tiles.entries()) {
    assertFresh()
    const [a, b, c, d, e, f] = options.borderBoxTransform
    const sourceTransform: PaintMatrix = [a * tile.width / width, b * tile.width / width, c * tile.height / height, d * tile.height / height, e + a * tile.x + c * tile.y, f + b * tile.x + d * tile.y]
    if (!validMatrix(sourceTransform)) throw new Error('IMAGE_INVALID: background source transform')
    const demand = imageDemand(width, height, sourceTransform, options.physicalScale)
    const decodedWidth = demand.width, decodedHeight = demand.height
    if (decodedWidth > MAX_DECODED_IMAGE_EDGE || decodedHeight > MAX_DECODED_IMAGE_EDGE || decodedWidth * decodedHeight * 8 > MAX_DECODED_IMAGE_BYTES) throw new Error('RESOURCE_BUDGET_EXCEEDED: background needs a bounded accepted proxy or tile')
    const reference = validateImageReference({ key: demand.divisor === 1 ? options.key : `${options.key}:mip:${decodedWidth}x${decodedHeight}`, revision: options.revision, epoch: registry.epoch, width: decodedWidth, height: decodedHeight })
    let upload: DecodedImageUpload
    try { upload = registry.resolve(reference) }
    catch (error) {
      if (!String(error).includes('RESOURCE_NOT_READY')) throw error
      // The canvas bitmap and RGBA readback coexist until registry admission.
      const lease = (options.budget ?? canvasResourceBudget).acquire({ owner: registry, key: `decode:${imageIdentity(reference)}`, pool: 'tile-surface', bytes: decodedWidth * decodedHeight * 8, pinned: true })
      if (!lease) throw new Error('RESOURCE_BUDGET_EXCEEDED: background readback admission denied')
      let canvas: HTMLCanvasElement | undefined
      try {
        canvas = image.ownerDocument.createElement('canvas')
        canvas.width = decodedWidth; canvas.height = decodedHeight
        const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
        if (!context) throw new Error('RESOURCE_UNREADABLE: background decoding context unavailable')
        assertFresh()
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
        context.drawImage(image, 0, 0, decodedWidth, decodedHeight)
        const pixels = context.getImageData(0, 0, decodedWidth, decodedHeight, { colorSpace: 'srgb' })
        assertFresh()
        upload = registry.register(reference, pixels.data)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'SecurityError') throw new Error('RESOURCE_UNREADABLE: background pixels cannot be read')
        throw error
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0 }
        lease.release()
      }
    }
    assertFresh()
    uploads.set(imageIdentity(upload.reference), upload)
    const transform: PaintMatrix = [sourceTransform[0] * width / decodedWidth, sourceTransform[1] * width / decodedWidth, sourceTransform[2] * height / decodedHeight, sourceTransform[3] * height / decodedHeight, sourceTransform[4], sourceTransform[5]]
    operations.push({ type: 'image', id: `${options.id}:tile-${index}`, resource: upload.reference, sourceRect: { x: 0, y: 0, width: decodedWidth, height: decodedHeight }, transform, opacity: 1, sampling: 'bilinear' })
    scaleImages.push({ width, height, transform: sourceTransform, acceptedWidth: decodedWidth, acceptedHeight: decodedHeight })
    const x = Math.max(tile.x, geometry.clip.x), y = Math.max(tile.y, geometry.clip.y)
    const clipped = { x, y, width: Math.min(tile.x + tile.width, geometry.clip.x + geometry.clip.width) - x, height: Math.min(tile.y + tile.height, geometry.clip.y + geometry.clip.height) - y }
    const bounds = rectangleBounds(clipped, options.borderBoxTransform)
    visualBounds = visualBounds ? union(visualBounds, bounds) : bounds
  }
  assertFresh()
  // An entirely off-clip no-repeat image contributes no pixels or resources.
  const empty = rectangleBounds({ ...geometry.clip, width: 0, height: 0 }, options.borderBoxTransform)
  return { operations, uploads: [...uploads.values()], visualBounds: visualBounds ?? empty, scaleImages }
}
