/// <reference lib="webworker" />

type WasmModule = {
  default: (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module) => Promise<unknown>
  project_b_preflight: () => string
}

self.onmessage = async () => {
  const startedAt = performance.now()
  try {
    const module = await import('./generated/project_b_wasm.js') as WasmModule
    await module.default()
    const result = JSON.parse(module.project_b_preflight())
    self.postMessage({ ok: true, elapsedMs: performance.now() - startedAt, result })
  } catch (error) {
    self.postMessage({ ok: false, elapsedMs: performance.now() - startedAt, error: String(error) })
  }
}
