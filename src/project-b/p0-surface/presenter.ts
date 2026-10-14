import { createCpuSession, createGpuSession } from './backends'
import type { CpuSession, GpuSession, PresenterCallbacks, PresenterDependencies, VelloBackend, VelloFrame } from './types'
import { canvasResourceBudget, type CanvasResourceLease } from '../../canvas-engine/resourceBudget'
export type { PresenterCallbacks, VelloFrame } from './types'

/** Main-thread commit is deliberate: generation approval, GPU presentation and
 * DOM paint ownership happen synchronously in one JavaScript turn. Rendering
 * prepares a texture asynchronously; it never changes the visible surface.
 * CPU rasterization stays in its worker. This guarded path is not full-scene P0. */
export function createVelloPresenter(host: HTMLElement, callbacks: PresenterCallbacks, injected?: Partial<PresenterDependencies>) {
  const dependencies: PresenterDependencies = {
    createCanvas: () => {
      const canvas = document.createElement('canvas')
      const isEnv = host.classList.contains('vello-environment') || Boolean(host.closest('.vello-environment'))
      canvas.className = `gpu-board-canvas vello-board-canvas${isEnv ? ' vello-environment-canvas' : ''}`
      if (isEnv) canvas.dataset.environment = 'true'
      return canvas
    },
    createGpu: createGpuSession,
    createCpu: createCpuSession,
    hidden: () => document.hidden,
    watchHealth: check => { const timer = setInterval(check, 500); return () => clearInterval(timer) },
    ...injected,
  }
  let generation = 0, epoch = 0, latest: VelloFrame | undefined, pending: VelloFrame | undefined
  let active: VelloFrame | undefined
  const unsettled = new Set<number>()
  let busy = false, disposed = false, paused = false, backend: VelloBackend = 'gpu'
  let gpu: GpuSession | undefined, cpu: CpuSession | undefined, cpuCanvas: HTMLCanvasElement | undefined
  let displayed: HTMLCanvasElement | undefined
  let cpuBitmapLease:CanvasResourceLease|undefined
  const bitmapOwner={}
  const ensureCpuCanvas=()=>{if(!cpuCanvas){cpuCanvas=dependencies.createCanvas();cpuCanvas.width=0;cpuCanvas.height=0}return cpuCanvas}
  const releaseCpuBitmap=()=>{if(cpuCanvas){cpuCanvas.width=0;cpuCanvas.height=0}cpuBitmapLease?.release();cpuBitmapLease=undefined}
  let retired: GpuSession[] = []
  let fault: 'memory' | 'device' | 'setup' | undefined
  let fallbackReason: string | undefined
  const isPaused = () => paused || dependencies.hidden()
  const settleUnused = (request: number) => {
    if (active?.generation === request || pending?.generation === request || !unsettled.has(request)) return
    unsettled.delete(request)
    callbacks.settled?.(request)
  }
  const current = (frame: VelloFrame, requestEpoch: number) => !disposed && !isPaused() && frame.generation === generation && requestEpoch === epoch
  const state = (value: 'loading' | 'ready' | 'fallback' | 'paused' | 'error', reason?: string) => {
    if (!disposed) callbacks.state?.({ backend, state: value, ...(reason ? { reason } : {}) })
  }
  const disposeSession = (session: {dispose():void}|undefined) => {
    try { session?.dispose() } catch { /* Cleanup must release the remaining independent owners. */ }
  }
  const disposeRetired = () => {
    retired = retired.filter(session => { if (session.canvas === displayed) return true; disposeSession(session); return false })
  }
  const retireGpu = () => {
    if (gpu) { retired.push(gpu); gpu = undefined; disposeRetired() }
  }
  const publish = (canvas: HTMLCanvasElement) => {
    if (canvas !== displayed) {
      if (displayed?.parentElement === host) host.replaceChild(canvas, displayed)
      else host.append(canvas)
      displayed = canvas
    }
    disposeRetired()
    if(canvas!==cpuCanvas)releaseCpuBitmap()
  }
  const enqueueCurrent = () => { if (latest?.generation === generation) pending = latest }
  const useCpu = (reason: string) => {
    retireGpu()
    backend = 'cpu'; epoch++; fallbackReason = reason
    cpu ??= dependencies.createCpu()
    ensureCpuCanvas()
    state('fallback', reason)
    enqueueCurrent()
  }
  const cleanup = () => {
    // Never run while a wasm-bindgen &mut self async borrow is outstanding.
    disposeSession(gpu); gpu = undefined
    for (const session of retired) disposeSession(session)
    retired = []
    disposeSession(cpu); cpu = undefined
    displayed?.remove(); displayed = undefined
    releaseCpuBitmap()
  }
  const resourceFailure = (error: string) => /GPU_OUT_OF_MEMORY|GPU_RESOURCE_BUDGET_EXCEEDED|GPU_IMAGE_ATLAS_FULL|GPU_RENDER_CAPACITY_EXCEEDED|GPU_RENDER_STATUS_UNAVAILABLE|DEVICE_LOST|RENDERER_NOT_INITIALIZED|WEBGPU_UNAVAILABLE|WebGPU device|GPU_INTERNAL|SURFACE_RECOVERY_FAILED|SURFACE_VALIDATION|GPU_VALIDATION|RuntimeError:.*(?:unreachable|memory|out of bounds)/i.test(error)

  const run = async (frame: VelloFrame) => {
    const requestedBackend = backend, requestEpoch = epoch
    if (requestedBackend === 'gpu') {
      let initializing = false
      try {
        if (!gpu) {
          initializing = true
          if (fault === 'setup') { fault = undefined; throw new Error('Injected WebGPU setup failure') }
          const canvas = dependencies.createCanvas()
          canvas.width = frame.width; canvas.height = frame.height
          gpu = await dependencies.createGpu(canvas)
          initializing = false
          if (!current(frame, requestEpoch)) return
        }
        if (fault === 'memory') { fault = undefined; throw new Error('GPU_OUT_OF_MEMORY: injected policy check; no physical VRAM exhaustion') }
        if (fault === 'device') { fault = undefined; gpu.destroyForTest?.() }
        state('loading')
        await gpu.prepare(frame)
        if (!current(frame, requestEpoch)) { gpu.discard(); if (!disposed && isPaused()) enqueueCurrent(); return }
        // No await/event boundary between the approval and DOM ownership callback.
        const metadata = gpu.present()
        publish(gpu.canvas)
        fallbackReason = undefined
        callbacks.accepted({ generation: frame.generation, backend: 'gpu', canvas: gpu.canvas, metadata, frame })
        state('ready')
      } catch (error) {
        const message = String(error)
        if (disposed) return
        // Device/resource loss is session-global even when this frame is obsolete.
        if (initializing || resourceFailure(message)) {
          try { useCpu(message) }
          catch (cpuError) { callbacks.error({ generation, backend: 'cpu', error: String(cpuError) }); state('error', String(cpuError)) }
        } else if (frame.generation === generation && requestEpoch === epoch) { callbacks.error({ generation: frame.generation, backend: 'gpu', error: message }); state('error', message) }
      }
    } else {
      let result:Awaited<ReturnType<CpuSession['render']>>|undefined
      try {
        cpu ??= dependencies.createCpu()
        const canvas=ensureCpuCanvas()
        // Keep the last GPU surface while preparing CPU fallback. Reduce only
        // backing resolution when the shared pool cannot hold both surfaces.
        // Authored geometry and the captured CSS camera stay unchanged.
        const budget=canvasResourceBudget.snapshot(),pool=budget.pools['tile-surface']
        const oldBitmap=cpuBitmapLease?.bytes ?? 0
        const reusableWorker=cpu.reusableSurfaceBytes?.() ?? 0
        const free=Math.max(0,Math.min(pool.limit-pool.bytes,budget.limit-budget.bytes))
        // Peak publication retains the old visible bitmap while worker pixels
        // and the transferred output coexist: 12*N + max(oldBitmap,4*N).
        // Reuse worker storage, but do not count the visible bitmap as freed.
        const capacity=free+reusableWorker+oldBitmap
        const maximumPixels=capacity>=4*oldBitmap?capacity/16:(capacity-oldBitmap)/12
        const factor=Math.min(1,Math.sqrt(maximumPixels/(frame.width*frame.height)))
        if(!Number.isFinite(factor)||factor<0.25)throw new Error('CPU_RESOURCE_BUDGET_EXCEEDED: insufficient surface capacity for bounded fallback')
        const renderFrame=factor===1?frame:{...frame,width:Math.max(1,Math.floor(frame.width*factor)),height:Math.max(1,Math.floor(frame.height*factor)),scale:frame.scale*factor,panX:frame.panX*factor,panY:frame.panY*factor}
        // Reserve the browser bitmap independently of worker lifetime. A later
        // worker failure can retain the last visible canvas and its accounting.
        const bitmapBytes=renderFrame.width*renderFrame.height*4
        if(cpuBitmapLease){if(!cpuBitmapLease.resize(Math.max(cpuBitmapLease.bytes,bitmapBytes)))throw new Error('CPU_RESOURCE_BUDGET_EXCEEDED: browser bitmap resize denied')}
        else {cpuBitmapLease=canvasResourceBudget.acquire({owner:bitmapOwner,key:'vello-cpu-visible-bitmap',pool:'tile-surface',bytes:bitmapBytes,pinned:true});if(!cpuBitmapLease)throw new Error('CPU_RESOURCE_BUDGET_EXCEEDED: browser bitmap admission denied')}
        result = await cpu.render(renderFrame)
        if (!current(frame, requestEpoch)) { if (!disposed && isPaused()) enqueueCurrent(); return }
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Vello CPU presentation needs a Canvas2D context')
        if (canvas.width !== renderFrame.width) canvas.width = renderFrame.width
        if (canvas.height !== renderFrame.height) canvas.height = renderFrame.height
        context.putImageData(new ImageData(new Uint8ClampedArray(result.pixels.buffer, result.pixels.byteOffset, result.pixels.byteLength), renderFrame.width, renderFrame.height), 0, 0)
        publish(canvas)
        callbacks.accepted({ generation: frame.generation, backend: 'cpu', canvas, metadata: {...result.metadata,backingResolutionFactor:factor,requestedWidth:frame.width,requestedHeight:frame.height}, frame })
        state('fallback', fallbackReason || 'Vello CPU active')
      } catch (error) {
        // A timed-out/crashed CPU worker stays terminal even if its frame was
        // superseded. Retire it before newest pending work starts in finally.
        disposeSession(cpu); cpu = undefined
        if (!disposed && frame.generation === generation && requestEpoch === epoch) {
          callbacks.error({ generation: frame.generation, backend: 'cpu', error: String(error) }); state('error', String(error))
        }
      } finally {
        result?.release?.()
        const actualBitmapBytes=(cpuCanvas?.width ?? 0)*(cpuCanvas?.height ?? 0)*4
        if(actualBitmapBytes)cpuBitmapLease?.resize(actualBitmapBytes)
        else {cpuBitmapLease?.release();cpuBitmapLease=undefined}
      }
    }
  }
  const kick = () => {
    if (busy || disposed || isPaused() || !pending) return
    const frame = pending; pending = undefined
    if (frame.generation !== generation) return
    busy = true; active = frame; unsettled.add(frame.generation)
    callbacks.preparing?.(frame.generation)
    void run(frame).finally(() => {
      busy = false; active = undefined
      settleUnused(frame.generation)
      if (disposed) cleanup()
      else { disposeRetired(); kick() }
    })
  }
  const visibility = () => { if (isPaused()) state('paused'); else { enqueueCurrent(); kick() } }
  const stopHealth = dependencies.watchHealth(() => {
    // A health read cannot overlap an outstanding mutable WASM borrow.
    // Idle device loss must recover without waiting for a pointer event.
    if (disposed || busy || isPaused() || backend !== 'gpu' || !gpu) return
    try { gpu.checkHealth?.() }
    catch (error) {
      const message = String(error)
      if (!resourceFailure(message)) return
      try { useCpu(message); kick() }
      catch (cpuError) { callbacks.error({ generation, backend: 'cpu', error: String(cpuError) }); state('error', String(cpuError)) }
    }
  })
  document.addEventListener('visibilitychange', visibility)
  return {
    /** Prepare the same retained session used by run(), without publishing pixels. */
    async warm() {
      if (disposed || busy || gpu || backend !== 'gpu') return
      busy = true
      state('loading')
      try {
        const canvas = dependencies.createCanvas()
        canvas.width = 64; canvas.height = 64
        gpu = await dependencies.createGpu(canvas)
      } catch (error) {
        if (!disposed) {
          try { useCpu(String(error)) }
          catch (cpuError) { state('error', String(cpuError)) }
        }
      } finally {
        busy = false
        if (disposed) cleanup()
        else kick()
      }
    },
    invalidateGeneration(next: number) {
      if (disposed || next < generation) return
      generation = next
      if(latest?.generation!==generation)latest=undefined
      if (pending?.generation !== generation) {const old=pending;pending = undefined;if(old)settleUnused(old.generation)}
    },
    invalidate(frame: VelloFrame) {
      if (disposed || frame.generation < generation) return
      const old=pending
      generation = frame.generation; latest = frame; pending = frame
      unsettled.add(frame.generation)
      if(old&&old!==frame)settleUnused(old.generation)
      if (isPaused()) state('paused')
      else kick()
    },
    recoverGpu() {
      if (disposed || backend === 'gpu') return
      // Switching is queued behind any current CPU request. Capture its backend
      // in run() so its receipt cannot masquerade as a GPU frame.
      backend = 'gpu'; epoch++; state('loading'); enqueueCurrent(); kick()
    },
    setPaused(value: boolean) { paused = value; visibility() },
    dispose() {
      if (disposed) return
      disposed = true; generation++;const old=pending;pending = undefined;if(old)settleUnused(old.generation)
      document.removeEventListener('visibilitychange', visibility)
      stopHealth()
      // Stop CPU work immediately; GPU mutable-borrow cleanup awaits settlement.
      disposeSession(cpu); cpu = undefined
      displayed?.remove(); displayed = undefined
      releaseCpuBitmap()
      if (!busy) cleanup()
    },
    /** Explicit harness-only hooks. No production caller installs UI for these. */
    injectFaultForTest(value: 'memory' | 'device' | 'setup') {
      fault = value; enqueueCurrent(); kick()
    },
    destroyIdleDeviceForTest() {
      if (!disposed && !busy && backend === 'gpu') gpu?.destroyForTest?.()
    },
  }
}
