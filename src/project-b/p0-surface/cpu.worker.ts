/// <reference lib="webworker" />
import type { VelloFrame } from './types'
import { frameImageReferences, imageIdentity, imageUploads } from '../../canvas-engine/decodedImageRegistry'
import type { DecodedImageReference } from '../../canvas-engine/paintDisplayList'
import wasmUrl from './generated/p0_engine_wasm_bg.wasm?url'

let modulePromise: Promise<typeof import('./generated/p0_engine_wasm.js')> | undefined
let work = Promise.resolve()
let renderer: InstanceType<typeof import('./generated/p0_engine_wasm.js').B4CpuRenderer> | undefined
let memory:WebAssembly.Memory|undefined,highWaterBytes=0
self.onmessage = (event: MessageEvent<{ id: number; frame: VelloFrame }>) => {
  const { id, frame } = event.data
  work = work.then(async () => {
    try {
      modulePromise ??= (async () => {
        const module = await import('./generated/p0_engine_wasm.js')
        try { memory=(await module.default({ module_or_path: wasmUrl })).memory }
        catch (error) { throw new Error(`Vello CPU WASM loading failed (${wasmUrl}): ${String(error)}`) }
        return module
      })().catch(error => { modulePromise = undefined; throw error })
      const module = await modulePromise
      renderer ??= new module.B4CpuRenderer()
      const references = frameImageReferences(frame.snapshot), uploads = imageUploads(references,frame.images)
      const retained = JSON.parse(renderer.retain_images(JSON.stringify(references))) as {decoded:{references:DecodedImageReference[]}}
      const known = new Set(retained.decoded.references.map(imageIdentity))
      for (const reference of references) if (!known.has(imageIdentity(reference))) {
        const upload = uploads.get(imageIdentity(reference))
        if (!upload) throw new Error(`RESOURCE_NOT_READY: worker image upload unavailable ${reference.key}`)
        renderer.register_image(JSON.stringify(reference),upload.pixels)
      }
      const started = performance.now()
      const pixels = renderer.render_snapshot(frame.width, frame.height, frame.snapshot, frame.scale, frame.panX, frame.panY)
      const bytes=memory?.buffer.byteLength??0;highWaterBytes=Math.max(highWaterBytes,bytes)
      self.postMessage({ id, pixels, metadata: { width: frame.width, height: frame.height, backend: 'vello_cpu', cpuRenderer: 'vello_cpu 0.2.0', elapsedMs: performance.now() - started, cpuPixelReadbacks: 0, imageResources:JSON.parse(renderer.resource_stats()),wasmMemory:{bytes,highWaterBytes,scope:'worker-realm-linear-memory; overlaps managed inner allocations; worker termination releases realm'} } }, [pixels.buffer])
    } catch (error) { self.postMessage({ id, error: String(error) }) }
  }).catch(error => { self.postMessage({ id, error: String(error) }) })
}
