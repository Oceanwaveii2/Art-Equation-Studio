import { imageDrawRect, type ImageDimensions, type ImageFraming } from '../model/imageFraming'

/** Export samples follow the final output density, including cover/zoom. This
 * never changes the original, canvas rendering, or the SVG export source. */
export function rasterExportDimensions(source: ImageDimensions, frame: ImageDimensions, framing: ImageFraming | undefined, scale: number) {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid export scale')
  const fit = imageDrawRect(source, frame, framing)
  if (!fit) throw new Error('Invalid export image dimensions')
  const width = Math.max(1, Math.min(source.width, Math.ceil(fit.width * scale)))
  const height = Math.max(1, Math.min(source.height, Math.ceil(fit.height * scale)))
  if (width * height * 4 > 64 * 1024 * 1024) throw new Error('Export image exceeds the scratch pixel budget; export a smaller region')
  return { width, height }
}

export async function prepareRasterExportSource(source: string, frame: ImageDimensions, framing: ImageFraming | undefined, scale: number) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000)
  let original: ImageBitmap | undefined, resized: ImageBitmap | undefined, canvas: OffscreenCanvas | undefined
  try {
    const response = await fetch(source, { signal: abort.signal })
    if (!response.ok || !response.body) throw new Error('Could not read the export image source')
    const reader = response.body.getReader(), parts: BlobPart[] = []
    let bytes = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.byteLength
        if (bytes > 64 * 1024 * 1024) { await reader.cancel(); throw new Error('Export source exceeds the transfer budget') }
        parts.push(new Uint8Array(part.value))
      }
    } finally { reader.releaseLock() }
    original = await createImageBitmap(new Blob(parts, { type: response.headers.get('content-type') || 'application/octet-stream' }))
    const dimensions = { width: original.width, height: original.height }
    const output = rasterExportDimensions(dimensions, frame, framing, scale)
    resized = await createImageBitmap(original, { resizeWidth: output.width, resizeHeight: output.height, resizeQuality: 'high' })
    original.close(); original = undefined
    canvas = new OffscreenCanvas(output.width, output.height)
    const context = canvas.getContext('2d', { colorSpace: 'srgb' })
    if (!context) throw new Error('Export image preparation is unavailable')
    context.drawImage(resized, 0, 0)
    resized.close(); resized = undefined
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not embed prepared export pixels'))
      reader.onerror = () => reject(new Error('Could not read prepared export pixels'))
      reader.readAsDataURL(blob)
    })
    return { data, dimensions, output, bytes: blob.size }
  } finally {
    clearTimeout(timer); original?.close(); resized?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}
