/// <reference lib="webworker" />

type WasmModule = {
  default: (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module) => Promise<unknown>
  render_b1_fixture: (width: number, height: number, pathCount: number) => Uint8Array
  render_b1_workload: (
    width: number,
    height: number,
    pathCount: number,
    scale: number,
    panX: number,
    panY: number,
    editIndex: number,
    editDelta: number,
  ) => Uint8Array
}

type Workload = {
  name: string
  width: number
  height: number
  pathCount: number
  scale: number
  panX: number
  panY: number
  editIndex: number
  editDelta: number
}

const sampleCount = 7

function percentile(samples: number[], fraction: number) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function summary(samples: number[]) {
  return {
    minMs: Math.min(...samples),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: Math.max(...samples),
  }
}

function measurePresentation(pixels: Uint8Array, width: number, height: number) {
  const imageCanvas = new OffscreenCanvas(width, height)
  const imageContext = imageCanvas.getContext('2d')
  if (!imageContext) throw new Error('OffscreenCanvas 2D context is unavailable')
  const imageStartedAt = performance.now()
  imageContext.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
  const putImageDataMs = performance.now() - imageStartedAt

  const textureCanvas = new OffscreenCanvas(width, height)
  const gl = textureCanvas.getContext('webgl2')
  if (!gl) throw new Error('OffscreenCanvas WebGL2 context is unavailable')
  const texture = gl.createTexture()
  if (!texture) throw new Error('Unable to allocate benchmark texture')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  const textureStartedAt = performance.now()
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.finish()
  const textureUploadMs = performance.now() - textureStartedAt
  gl.deleteTexture(texture)
  return { putImageDataMs, textureUploadMs }
}

self.onmessage = async () => {
  const coldStartedAt = performance.now()
  try {
    const module = await import('./generated/project_b_wasm.js') as WasmModule
    await module.default()
    const wasmStartupMs = performance.now() - coldStartedAt
    const workloads: Workload[] = [
      { name: 'beziers-1k', width: 1024, height: 768, pathCount: 1_000, scale: 1, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'beziers-5k', width: 1024, height: 768, pathCount: 5_000, scale: 1, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'beziers-20k', width: 1024, height: 768, pathCount: 20_000, scale: 1, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'zoom-20k', width: 1024, height: 768, pathCount: 20_000, scale: 1.75, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'pan-20k', width: 1024, height: 768, pathCount: 20_000, scale: 1, panX: 180, panY: -120, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'resize-20k', width: 1440, height: 900, pathCount: 20_000, scale: 1, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'edit-preview-5k', width: 1024, height: 768, pathCount: 5_000, scale: 1, panX: 0, panY: 0, editIndex: 2_499, editDelta: 6 },
    ]
    const cases = []
    let preview: Uint8Array | undefined
    for (const workload of workloads) {
      const firstStartedAt = performance.now()
      module.render_b1_workload(
        workload.width, workload.height, workload.pathCount, workload.scale,
        workload.panX, workload.panY, workload.editIndex, workload.editDelta,
      )
      const firstRenderMs = performance.now() - firstStartedAt
      const renderSamples = []
      const putImageDataSamples = []
      const textureUploadSamples = []
      let pixels: Uint8Array<ArrayBufferLike> = new Uint8Array()
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const renderStartedAt = performance.now()
        pixels = module.render_b1_workload(
          workload.width, workload.height, workload.pathCount, workload.scale,
          workload.panX, workload.panY, workload.editIndex,
          workload.name === 'edit-preview-5k' ? workload.editDelta + sample : workload.editDelta,
        )
        renderSamples.push(performance.now() - renderStartedAt)
        const presentation = measurePresentation(pixels, workload.width, workload.height)
        putImageDataSamples.push(presentation.putImageDataMs)
        textureUploadSamples.push(presentation.textureUploadMs)
      }
      cases.push({
        ...workload,
        samples: sampleCount,
        firstRenderMs,
        render: summary(renderSamples),
        putImageData: summary(putImageDataSamples),
        textureUpload: summary(textureUploadSamples),
        rgbaBufferMiB: pixels.byteLength / (1024 * 1024),
      })
      if (workload.name === 'beziers-5k') preview = new Uint8Array(pixels)
    }
    self.postMessage({ ok: true, wasmStartupMs, width: 1024, height: 768, cases, preview }, preview ? [preview.buffer] : [])
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) })
  }
}
