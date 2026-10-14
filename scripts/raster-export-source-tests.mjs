import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } }); await server.listen()
const port = server.httpServer.address().port
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/raster-export-check', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>Export pixel check</body>' }))
  await page.goto(`http://127.0.0.1:${port}/raster-export-check`)
  const result = await page.evaluate(async () => {
    const { rasterExportDimensions, prepareRasterExportSource } = await import('/src/board/rasterExportSource.ts')
    const source = { width: 4096, height: 2048 }, frame = { width: 200, height: 200 }
    const dimensions = [rasterExportDimensions(source, frame, { fit: 'contain' }, 2), rasterExportDimensions(source, frame, { fit: 'cover' }, 2), rasterExportDimensions(source, frame, { fit: 'cover', zoom: 4 }, 2), rasterExportDimensions(source, frame, { fit: 'fill' }, 2), rasterExportDimensions(source, frame, undefined, 100)]
    const canvas = new OffscreenCanvas(64, 32), c = canvas.getContext('2d')
    c.fillStyle = '#37d5b5'; c.fillRect(0, 0, 32, 32); c.fillStyle = '#ffd269'; c.fillRect(32, 0, 32, 32)
    const blob = await canvas.convertToBlob(), url = URL.createObjectURL(blob)
    const original = Array.from(new Uint8Array(await blob.arrayBuffer()))
    let prepared
    try { prepared = await prepareRasterExportSource(url, { width: 64, height: 32 }, undefined, 1) } finally { URL.revokeObjectURL(url) }
    const bitmap = await createImageBitmap(await (await fetch(prepared.data)).blob())
    c.clearRect(0, 0, 64, 32); c.drawImage(bitmap, 0, 0); bitmap.close()
    const pixels = c.getImageData(0, 0, 64, 32).data, sample = x => Array.from(pixels.slice((16 * 64 + x) * 4, (16 * 64 + x) * 4 + 4))
    const refusal = []
    for (const scale of [0, -1, NaN]) { try { rasterExportDimensions(source, frame, undefined, scale) } catch { refusal.push(scale) } }
    return { dimensions, prepared: { dimensions: prepared.dimensions, output: prepared.output }, samples: [sample(10), sample(50)], immutable: JSON.stringify(original) === JSON.stringify(Array.from(new Uint8Array(await blob.arrayBuffer()))), refused: refusal.length }
  })
  assert.deepEqual(result.dimensions, [{ width: 400, height: 200 }, { width: 800, height: 400 }, { width: 3200, height: 1600 }, { width: 400, height: 400 }, { width: 4096, height: 2048 }])
  assert.deepEqual(result.prepared, { dimensions: { width: 64, height: 32 }, output: { width: 64, height: 32 } })
  assert.deepEqual(result.samples, [[55, 213, 181, 255], [255, 210, 105, 255]])
  assert.ok(result.immutable); assert.equal(result.refused, 3)
  console.log('Raster export source PASS: output density, cover/zoom/fill, source cap, exact native-size color samples and unchanged source bytes')
} finally { await browser.close(); await server.close() }
