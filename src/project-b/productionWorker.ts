/// <reference lib="webworker" />

type Renderer = {
  initialize: () => Promise<string>
  render_snapshot_pixels: (width: number, height: number, snapshot: string, scale: number, panX: number, panY: number) => Promise<Uint8Array>
}

let rendererPromise: Promise<Renderer> | undefined

function renderer() {
  if (!rendererPromise) rendererPromise = (async () => {
    const wasm = await import('./generated/project_b_wasm.js')
    await wasm.default()
    const next = new wasm.B3Renderer() as Renderer
    await next.initialize()
    return next
  })()
  return rendererPromise
}

let work = Promise.resolve()
let latestId = 0
self.onmessage = (event: MessageEvent<{ id: number; width: number; height: number; snapshot: string; scale: number; panX: number; panY: number }>) => {
  latestId = event.data.id
  work = work.then(async () => {
    const request = event.data
    if (request.id < latestId) {
      self.postMessage({ id: request.id, ok: false, error: 'superseded' })
      return
    }
    try {
      const active = await renderer()
      if (request.id < latestId) {
        self.postMessage({ id: request.id, ok: false, error: 'superseded' })
        return
      }
      const pixels = await active.render_snapshot_pixels(request.width, request.height, request.snapshot, request.scale, request.panX, request.panY)
      if (request.id < latestId) {
        self.postMessage({ id: request.id, ok: false, error: 'superseded' })
        return
      }
      self.postMessage({ id: request.id, ok: true, width: request.width, height: request.height, pixels }, [pixels.buffer])
    } catch (error) {
      rendererPromise = undefined
      self.postMessage({ id: request.id, ok: false, error: String(error) })
    }
  })
}
