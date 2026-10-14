import './harness.css'

type BenchmarkResult = {
  ok: boolean
  error?: string
  wasmStartupMs?: number
  width?: number
  height?: number
  cases?: Array<Record<string, unknown>>
  preview?: Uint8Array
}

const runButton = document.querySelector<HTMLButtonElement>('#run')!
const runGpuButton = document.querySelector<HTMLButtonElement>('#run-gpu')!
const recoverGpuButton = document.querySelector<HTMLButtonElement>('#recover-gpu')!
const status = document.querySelector<HTMLElement>('#status')!
const results = document.querySelector<HTMLElement>('#results')!
const canvas = document.querySelector<HTMLCanvasElement>('#preview')!
const gpuWorker = new Worker(new URL('./b3Worker.ts', import.meta.url), { type: 'module' })

gpuWorker.onmessage = (event: MessageEvent<BenchmarkResult & {
  gpuInitializeMs?: number
  adapter?: Record<string, string>
  lifecycle?: Record<string, unknown>
  sceneFixtures?: Array<Record<string, unknown>>
  presentation?: Record<string, unknown>
  memory?: Record<string, unknown>
  recovery?: Record<string, unknown>
}>) => {
  const report = event.data
  results.textContent = JSON.stringify({
    status: report.ok ? 'WORKING' : 'FAILED',
    renderer: 'Vello Classic 0.10.0 / wgpu 29 / persistent WebGPU worker',
    wasmStartupMs: report.wasmStartupMs,
    gpuInitializeMs: report.gpuInitializeMs,
    adapter: report.adapter,
    lifecycle: report.lifecycle,
    sceneFixtures: report.sceneFixtures,
    presentation: report.presentation,
    memory: report.memory,
    recovery: report.recovery,
    cases: report.cases,
    error: report.error,
  }, null, 2)
  status.textContent = report.ok
    ? 'WebGPU benchmark complete. Run it again to verify the same renderer is reused.'
    : `WebGPU benchmark failed: ${report.error ?? 'unknown error'}`
  runGpuButton.disabled = false
  recoverGpuButton.disabled = false
  runButton.disabled = false
  if (report.ok && report.preview && report.presentation) {
    const width = Number(report.presentation.width)
    const height = Number(report.presentation.height)
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.putImageData(
      new ImageData(new Uint8ClampedArray(report.preview), width, height),
      0,
      0,
    )
  }
}

window.addEventListener('pagehide', () => gpuWorker.terminate(), { once: true })

runGpuButton.addEventListener('click', () => {
  runGpuButton.disabled = true
  recoverGpuButton.disabled = true
  runButton.disabled = true
  status.textContent = 'Compiling Vello WebGPU pipelines and running GPU vector workloads…'
  gpuWorker.postMessage({ type: 'run' })
})

recoverGpuButton.addEventListener('click', () => {
  runGpuButton.disabled = true
  recoverGpuButton.disabled = true
  runButton.disabled = true
  status.textContent = 'Destroying the harness device and verifying clean GPU recovery…'
  gpuWorker.postMessage({ type: 'recover' })
})

runButton.addEventListener('click', () => {
  runButton.disabled = true
  runGpuButton.disabled = true
  recoverGpuButton.disabled = true
  status.textContent = 'Running repeated Bézier, zoom, pan, resize, and edit-preview workloads in a worker…'
  const worker = new Worker(new URL('./b1Worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<BenchmarkResult>) => {
    const report = event.data
    results.textContent = JSON.stringify({
      status: report.ok ? 'WORKING' : 'FAILED',
      renderer: 'vello_cpu 0.2.0 / WASM worker',
      wasmStartupMs: report.wasmStartupMs,
      cases: report.cases,
      error: report.error,
    }, null, 2)
    if (report.ok && report.preview && report.width && report.height) {
      const context = canvas.getContext('2d')!
      context.putImageData(
        new ImageData(new Uint8ClampedArray(report.preview), report.width, report.height),
        0,
        0,
      )
      status.textContent = 'Benchmark complete. Preview shows the 5,000-path case.'
    } else {
      status.textContent = `Benchmark failed: ${report.error ?? 'unknown error'}`
    }
    runButton.disabled = false
    runGpuButton.disabled = false
    recoverGpuButton.disabled = false
    worker.terminate()
  }
  worker.postMessage({ type: 'run' })
})
