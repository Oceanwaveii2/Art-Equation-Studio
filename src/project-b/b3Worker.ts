/// <reference lib="webworker" />

type B3Renderer = {
  initialize: () => Promise<string>
  render: (width: number, height: number, pathCount: number) => Promise<void>
  render_workload: (
    width: number,
    height: number,
    pathCount: number,
    scale: number,
    panX: number,
    panY: number,
    editIndex: number,
    editDelta: number,
  ) => Promise<void>
  render_replay: (width: number, height: number) => Promise<string>
  render_real_board: (width: number, height: number) => Promise<string>
  render_overlap_fixture: (width: number, height: number) => Promise<string>
  render_real_board_pixels: (width: number, height: number) => Promise<Uint8Array>
  destroy_device_for_recovery_test: () => void
  free: () => void
}

type WasmModule = {
  default: (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module) => Promise<unknown>
  B3Renderer: new () => B3Renderer
}

const sampleCount = 7
let renderer: B3Renderer | undefined
let adapter: Record<string, string> | undefined
let initializationCount = 0
let workerRunCount = 0
let wasmStartupMs = 0
let gpuInitializeMs = 0

async function ensureRenderer() {
  if (renderer) return { reused: true }
  const workerStartedAt = performance.now()
  const module = await import('./generated/project_b_wasm.js') as WasmModule
  await module.default()
  wasmStartupMs = performance.now() - workerStartedAt
  renderer = new module.B3Renderer()
  const initializeStartedAt = performance.now()
  adapter = JSON.parse(await renderer.initialize()) as Record<string, string>
  gpuInitializeMs = performance.now() - initializeStartedAt
  initializationCount += 1
  return { reused: false }
}

function percentile(samples: number[], fraction: number) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

self.onmessage = async (event: MessageEvent<{ type?: string }>) => {
  try {
    if (event.data?.type === 'recover') {
      await ensureRenderer()
      const oldRenderer = renderer
      if (!oldRenderer) throw new Error('Recovery test could not initialize renderer')
      await oldRenderer.render_real_board(1024, 768)
      oldRenderer.destroy_device_for_recovery_test()
      oldRenderer.free()
      renderer = undefined
      const recoveryStartedAt = performance.now()
      await ensureRenderer()
      const recoveredRenderer = renderer as B3Renderer | undefined
      if (!recoveredRenderer) throw new Error('Recovery test could not recreate renderer')
      const report = JSON.parse(await recoveredRenderer.render_real_board(1024, 768)) as Record<string, unknown>
      self.postMessage({
        ok: true,
        recovery: {
          recovered: true,
          elapsedMs: performance.now() - recoveryStartedAt,
          initializationCount,
          report,
        },
      })
      return
    }
    const lifecycle = await ensureRenderer()
    const activeRenderer = renderer
    if (!activeRenderer) throw new Error('Persistent WebGPU renderer failed to initialize')
    workerRunCount += 1
    const cases = []
    const workloads = [
      { name: 'beziers-1k', width: 1024, height: 768, pathCount: 1_000, scale: 1, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'beziers-5k', width: 1024, height: 768, pathCount: 5_000, scale: 1, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'beziers-20k', width: 1024, height: 768, pathCount: 20_000, scale: 1, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'zoom-20k', width: 1024, height: 768, pathCount: 20_000, scale: 1.75, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'pan-20k', width: 1024, height: 768, pathCount: 20_000, scale: 1, panX: 180, panY: -120, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'resize-20k', width: 1440, height: 900, pathCount: 20_000, scale: 1, panX: 0, panY: 0, editIndex: 0xffffffff, editDelta: 0 },
      { name: 'edit-preview-5k', width: 1024, height: 768, pathCount: 5_000, scale: 1, panX: 0, panY: 0, editIndex: 2_499, editDelta: 6 },
    ]
    for (const workload of workloads) {
      const firstStartedAt = performance.now()
      await activeRenderer.render_workload(
        workload.width, workload.height, workload.pathCount, workload.scale,
        workload.panX, workload.panY, workload.editIndex, workload.editDelta,
      )
      const firstRenderMs = performance.now() - firstStartedAt
      const samples = []
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const startedAt = performance.now()
        await activeRenderer.render_workload(
          workload.width, workload.height, workload.pathCount, workload.scale,
          workload.panX, workload.panY, workload.editIndex,
          workload.name === 'edit-preview-5k' ? workload.editDelta + sample : workload.editDelta,
        )
        samples.push(performance.now() - startedAt)
      }
      cases.push({
        ...workload,
        samples: sampleCount,
        firstRenderMs,
        minMs: Math.min(...samples),
        p50Ms: percentile(samples, 0.5),
        p95Ms: percentile(samples, 0.95),
        maxMs: Math.max(...samples),
      })
    }
    const sceneFixtures = []
    for (const fixture of [
      { name: 'frozen-replay-v1', render: () => activeRenderer.render_replay(1600, 1000) },
      { name: 'real-board-sacrificial', render: () => activeRenderer.render_real_board(1024, 768) },
      { name: 'mixed-z-overlap', render: () => activeRenderer.render_overlap_fixture(640, 480) },
    ]) {
      const startedAt = performance.now()
      const report = JSON.parse(await fixture.render()) as Record<string, unknown>
      sceneFixtures.push({ name: fixture.name, elapsedMs: performance.now() - startedAt, ...report })
    }
    const previewWidth = 1024
    const previewHeight = 768
    const presentationStartedAt = performance.now()
    const preview = await activeRenderer.render_real_board_pixels(previewWidth, previewHeight)
    const presentationMs = performance.now() - presentationStartedAt
    const rowBytes = previewWidth * 4
    const paddedRowBytes = Math.ceil(rowBytes / 256) * 256
    const rgbaBytes = rowBytes * previewHeight
    const viewSwitches = []
    for (const mode of ['canvas', 'document', 'split', 'canvas']) {
      const startedAt = performance.now()
      if (mode !== 'document') {
        await activeRenderer.render(1024, 768, 5_000)
      }
      viewSwitches.push({ mode, elapsedMs: performance.now() - startedAt })
    }
    self.postMessage({
      ok: true,
      wasmStartupMs,
      gpuInitializeMs,
      adapter,
      cases,
      sceneFixtures,
      presentation: { width: previewWidth, height: previewHeight, elapsedMs: presentationMs },
      memory: {
        targetTextureBytes: rgbaBytes,
        readbackBufferBytes: paddedRowBytes * previewHeight,
        transferredPreviewBytes: preview.byteLength,
        measuredTransientFloorBytes: rgbaBytes + paddedRowBytes * previewHeight + preview.byteLength,
        scope: 'Known presentation allocations only; excludes driver, pipeline cache and WASM heap.',
      },
      preview,
      lifecycle: {
        reusedExistingRenderer: lifecycle.reused,
        initializationCount,
        workerRunCount,
        viewSwitches,
      },
    }, [preview.buffer])
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) })
  }
}
