import * as UTIF from 'utif'
import { derivedCacheKey, readDerivedPreview, writeDerivedPreview, removeDerivedPreview } from './derivedDiskCache'

// The original remains on disk. Larger sources use the existing native pyramid
// pipeline instead of exceeding this worker's 128 MiB working admission.
const MAX_FILE = 16 * 1024 * 1024, MAX_PIXELS = 8 * 1024 * 1024
self.onmessage = async event => {
  const { id, payload } = event.data
  try {
    const response = await fetch(payload.source)
    if (!response.ok || !response.body) throw new Error('TIFF file is unavailable')
    if (Number(response.headers.get('content-length')) > MAX_FILE) throw new Error('Large TIFF: use Prepare tiled image for full detail')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let length = 0
    for (;;) {
      const next = await reader.read(); if (next.done) break
      length += next.value.length
      if (length > MAX_FILE) { await reader.cancel(); throw new Error('Large TIFF: use Prepare tiled image for full detail') }
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    chunks.length = 0
    const key = await derivedCacheKey(bytes.buffer)
    const cached = await readDerivedPreview(key)
    if (cached) {
      try {
        const bitmap = await createImageBitmap(cached.blob)
        const valid = bitmap.width === cached.width && bitmap.height === cached.height; bitmap.close()
        if (valid) { self.postMessage({ id, result: { blob: cached.blob, width: cached.width, height: cached.height, cacheHit: true, cacheStored: true } }); return }
      } catch { /* Corrupt derivative: discard and decode the immutable source */ }
      await removeDerivedPreview(key)
    }
    const image = UTIF.decode(bytes.buffer)[0]
    const width = Number(image?.t256?.[0]), height = Number(image?.t257?.[0])
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error('Large or invalid TIFF: use Prepare tiled image for full detail')
    UTIF.decodeImage(bytes.buffer, image)
    if (image.width !== width || image.height !== height) throw new Error('TIFF dimensions changed while decoding')
    const rgba = UTIF.toRGBA8(image), canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d'); if (!context) throw new Error('Worker image canvas is unavailable')
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const cacheStored = await writeDerivedPreview(key, blob, width, height)
    self.postMessage({ id, result: { blob, width, height, cacheHit: false, cacheStored } })
  } catch (reason) { self.postMessage({ id, error: String(reason) }) }
}
