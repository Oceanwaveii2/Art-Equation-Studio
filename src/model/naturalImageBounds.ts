import { imageDrawRect, type ImageDimensions, type ImageFraming, type ImageRect } from './imageFraming.ts'
import { validPyramid, type ImagePyramid } from '../canvas-engine/imagePyramid.ts'

export type ImageBoundsMetadata = {
  imageDimensions?: ImageDimensions
  imagePyramid?: ImagePyramid
  generated?: { outputWidth: number; outputHeight: number }
}

const validSize = (size: ImageDimensions | undefined): size is ImageDimensions => Boolean(size
  && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0)
const validIntrinsicSize = (size: ImageDimensions | undefined): size is ImageDimensions => validSize(size)
  && Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height)

/** Prefer actual source dimensions. Do not infer original pixels from a
 * thumbnail's rounded dimensions or combine values from different providers. */
export function assetIntrinsicSize(asset: ImageBoundsMetadata | undefined): ImageDimensions | undefined {
  if (!asset) return undefined
  if (validIntrinsicSize(asset.imageDimensions)) return { ...asset.imageDimensions }
  if (validPyramid(asset.imagePyramid)) return { width: asset.imagePyramid.width, height: asset.imagePyramid.height }
  const generated = asset.generated && { width: asset.generated.outputWidth, height: asset.generated.outputHeight }
  return validIntrinsicSize(generated) ? generated : undefined
}

/** Natural aspect inside a placement envelope. One scale preserves the ratio;
 * fractional model dimensions avoid rounding either axis independently. */
export function fitNaturalImageBounds(source: ImageDimensions | undefined, envelope: ImageDimensions): ImageDimensions | undefined {
  if (!validSize(source) || !validSize(envelope)) return undefined
  const scale = Math.min(1, envelope.width / source.width, envelope.height / source.height)
  const bounds = { width: source.width * scale, height: source.height * scale }
  return validSize(bounds) ? bounds : undefined
}

export type TightImageBoundsNode = ImageRect & {
  kind: string
  imagePresentation?: 'card' | 'artwork'
  locked?: boolean
  rotation?: number
  imageTransform?: ImageFraming & { rotation?: number; flipX?: boolean; flipY?: boolean }
}
export type TightImageBoundsFailure = 'not-image' | 'card-presentation' | 'locked' | 'invalid-geometry'
  | 'invalid-framing' | 'cropped-framing' | 'inner-transform' | 'off-center-framing'
export type TightImageBoundsResult = { ok: true; bounds: ImageRect }
  | { ok: false; reason: TightImageBoundsFailure; detail: string }

const refuse = (reason: TightImageBoundsFailure, detail: string): TightImageBoundsResult => ({ ok: false, reason, detail })

/** An explicit artwork command, never a load-time migration. The outer node
 * may be rotated: a centered containment rectangle has exactly the same center
 * before and after tightening, so its world-space pixels stay in place.
 * Board/ancestor locks and undo ownership must also be checked by the caller. */
export function planTightImageBounds(node: TightImageBoundsNode, source: ImageDimensions | undefined): TightImageBoundsResult {
  if (node.kind !== 'image') return refuse('not-image', 'Select an image.')
  if (node.imagePresentation !== 'artwork') return refuse('card-presentation', 'Image cards keep their title and card bounds.')
  if (node.locked) return refuse('locked', 'Unlock the image before changing its bounds.')
  if (!validSize(source) || !validSize(node) || ![node.x, node.y, node.rotation ?? 0].every(Number.isFinite)) {
    return refuse('invalid-geometry', 'Image dimensions and placement must be finite and positive.')
  }
  const framing = node.imageTransform
  if (framing?.fit !== undefined && framing.fit !== 'contain') return refuse('cropped-framing', 'Keep the current crop or stretch; bounds fitting requires Contain.')
  if (framing?.zoom !== undefined && framing.zoom !== 1) return refuse('cropped-framing', 'Keep the current image zoom; bounds fitting requires an unzoomed image.')
  if ((framing?.rotation ?? 0) !== 0 || framing?.flipX || framing?.flipY) {
    return refuse('inner-transform', 'Keep the current pixel rotation or flip; reset it explicitly before fitting bounds.')
  }
  if ([framing?.positionX, framing?.positionY].some((position) => position !== undefined
    && (!Number.isFinite(position) || position < 0 || position > 100))) {
    return refuse('invalid-framing', 'Image position must be between zero and one hundred percent.')
  }
  const draw = imageDrawRect(source, node, framing)
  if (!draw) return refuse('invalid-geometry', 'The contained image rectangle is unavailable.')
  const tolerance = Math.max(1, node.width, node.height) * 1e-10
  if (Math.abs(draw.x + draw.width / 2 - node.width / 2) > tolerance
    || Math.abs(draw.y + draw.height / 2 - node.height / 2) > tolerance) {
    return refuse('off-center-framing', 'Keep the current offset and rotation center; center the image explicitly before fitting bounds.')
  }
  const bounds = { x: node.x + draw.x, y: node.y + draw.y, width: draw.width, height: draw.height }
  if (![bounds.x, bounds.y].every(Number.isFinite) || !validSize(bounds)) {
    return refuse('invalid-geometry', 'The fitted image would exceed finite board geometry.')
  }
  return { ok: true, bounds }
}

