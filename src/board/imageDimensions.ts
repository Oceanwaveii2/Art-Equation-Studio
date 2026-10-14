import { assetIntrinsicSize } from '../model/naturalImageBounds.ts'
import type { ImageDimensions } from '../model/imageFraming.ts'
import type { ProjectAsset } from '../model/project'

const dimensionCache = new Map<string, Promise<ImageDimensions>>()
const MAX_DIMENSION_CACHE_ENTRIES = 192
const DIMENSION_TIMEOUT_MS = 12_000
const MAX_PROBE_ORIGINAL_BYTES = 32 * 1024 * 1024

/** Shared placement/preview probe. Each source has one pending or successful
 * dimension promise; failed requests can retry. Settled probes release handlers,
 * their timer and their image source rather than retaining a decoder element. */
export function probeImageDimensions(source: string): Promise<ImageDimensions> {
  if (!source.trim()) return Promise.reject(new Error('Image source is unavailable'))
  const cached = dimensionCache.get(source)
  if (cached) return cached
  const pending = new Promise<ImageDimensions>((resolve, reject) => {
    const image = new Image()
    let settled = false
    const finish = (dimensions?: ImageDimensions, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      image.removeAttribute('src')
      if (dimensions) resolve(dimensions)
      else reject(error || new Error('Image dimensions are unavailable'))
    }
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight }
      if (Number.isSafeInteger(dimensions.width) && Number.isSafeInteger(dimensions.height) && dimensions.width > 0 && dimensions.height > 0) finish(dimensions)
      else finish(undefined, new Error('Image dimensions are invalid'))
    }
    image.onerror = () => finish(undefined, new Error('Image dimensions are unavailable'))
    const timeout = setTimeout(() => finish(undefined, new Error('Image dimensions timed out after 12 seconds')), DIMENSION_TIMEOUT_MS)
    try { image.src = source } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error(String(error)))
    }
  })
  dimensionCache.set(source, pending)
  if (dimensionCache.size > MAX_DIMENSION_CACHE_ENTRIES) dimensionCache.delete(dimensionCache.keys().next().value!)
  void pending.catch(() => {
    // An evicted older request must not remove a newer request for this source.
    if (dimensionCache.get(source) === pending) dimensionCache.delete(source)
  })
  return pending
}

/** Original dimensions only. Proxy rounding must never become saved image
 * geometry. Missing metadata on huge/tiled assets refuses a whole-image probe;
 * the caller can request native header metadata or prepare its pyramid. */
export async function readImageDimensions(asset: ProjectAsset | undefined, originalSource?: string): Promise<ImageDimensions | undefined> {
  const metadata = assetIntrinsicSize(asset)
  if (metadata) return metadata
  if (asset?.requiresTiledPreview || (asset?.byteLength ?? 0) > MAX_PROBE_ORIGINAL_BYTES) return undefined
  if (!originalSource) return undefined
  return probeImageDimensions(originalSource)
}

