export type ProjectBPreflightReport = {
  measuredAt: string
  userAgent: string
  webView2Runtime?: string
  webGpu: {
    available: boolean
    adapterAvailable: boolean
    requestAdapterMs?: number
    info?: Record<string, unknown>
    error?: string
  }
  wasmWorker: Record<string, unknown>
  gpuRenderer?: Record<string, unknown>
}

declare global {
  interface Window {
    __projectBPreflight?: Promise<ProjectBPreflightReport>
  }
}

async function probeWebGpu(): Promise<ProjectBPreflightReport['webGpu']> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (!gpu) return { available: false, adapterAvailable: false }
  const startedAt = performance.now()
  try {
    const adapter = await gpu.requestAdapter() as {
      info?: { vendor?: string; architecture?: string; device?: string; description?: string }
    } | null
    const adapterInfo = adapter?.info
    return {
      available: true,
      adapterAvailable: Boolean(adapter),
      requestAdapterMs: performance.now() - startedAt,
      info: adapterInfo ? {
        vendor: adapterInfo.vendor || '',
        architecture: adapterInfo.architecture || '',
        device: adapterInfo.device || '',
        description: adapterInfo.description || '',
      } : undefined,
    }
  } catch (error) {
    return { available: true, adapterAvailable: false, requestAdapterMs: performance.now() - startedAt, error: String(error) }
  }
}

function probeWasmWorker(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./preflightWorker.ts', import.meta.url), { type: 'module' })
    const timeout = window.setTimeout(() => {
      worker.terminate()
      resolve({ ok: false, error: 'worker timed out after 15 seconds' })
    }, 15_000)
    worker.onmessage = ({ data }) => {
      window.clearTimeout(timeout)
      worker.terminate()
      resolve(data as Record<string, unknown>)
    }
    worker.onerror = (event) => {
      window.clearTimeout(timeout)
      worker.terminate()
      resolve({ ok: false, error: event.message })
    }
    worker.postMessage('run')
  })
}

function probeGpuRendererWorker(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./b3Worker.ts', import.meta.url), { type: 'module' })
    const runs: Array<Record<string, unknown>> = []
    const timeout = window.setTimeout(() => {
      worker.terminate()
      resolve({ ok: false, error: 'persistent GPU renderer timed out after 45 seconds', runs })
    }, 45_000)
    worker.onmessage = ({ data }: MessageEvent<Record<string, unknown> & { preview?: Uint8Array }>) => {
      const { preview: _preview, cases, ...compact } = data
      runs.push({ ...compact, cases })
      if (data.ok === false || runs.length === 2) {
        window.clearTimeout(timeout)
        worker.terminate()
        resolve({ ok: data.ok !== false, runs })
      } else {
        worker.postMessage({ type: 'run' })
      }
    }
    worker.onerror = (event) => {
      window.clearTimeout(timeout)
      worker.terminate()
      resolve({ ok: false, error: event.message, runs })
    }
    worker.postMessage({ type: 'run' })
  })
}

export function startProjectBPreflight() {
  const queryEnabled = new URLSearchParams(window.location.search).get('project-b-preflight') === '1'
  const run = async (webview2Runtime?: string) => {
    const [webGpu, wasmWorker, gpuRenderer] = await Promise.all([
      probeWebGpu(),
      probeWasmWorker(),
      probeGpuRendererWorker(),
    ])
    const report = { measuredAt: new Date().toISOString(), userAgent: navigator.userAgent, webView2Runtime: webview2Runtime, webGpu, wasmWorker, gpuRenderer }
    console.info('[Project B pre-flight]', report)
    void invoke('record_project_b_preflight', { report }).catch(() => undefined)
    return report
  }
  if (queryEnabled) {
    window.__projectBPreflight = run()
    return
  }
  void invoke<{ enabled: boolean; webview2Runtime?: string }>('project_b_preflight_context')
    .then(({ enabled, webview2Runtime }) => {
      if (enabled) window.__projectBPreflight = run(webview2Runtime)
    })
    .catch(() => undefined)
}
import { invoke } from '@tauri-apps/api/core'
