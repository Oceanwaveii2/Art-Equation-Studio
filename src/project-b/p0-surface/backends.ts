import type { CpuSession, FrameMetadata, GpuSession, VelloFrame } from './types'
import { frameImageReferences, createFrameReferenceCache, imageIdentity, imageUploads, validateImageReference } from '../../canvas-engine/decodedImageRegistry'
import type { DecodedImageReference } from '../../canvas-engine/paintDisplayList'
import { canvasResourceBudget, type CanvasResourceLease, type CanvasResourcePool } from '../../canvas-engine/resourceBudget'
import wasmUrl from './generated/p0_engine_wasm_bg.wasm?url'
import { ATLAS_PAGE_RESERVE, plannedAtlasPages } from './atlasPlan'
import { metricSpan, recordMetric } from '../../diagnostics/performance'
import { ImageResidency } from './imageResidency'
import { viewportWarmup } from './viewportWarmup'

let modulePromise: Promise<typeof import('./generated/p0_engine_wasm.js')> | undefined
let moduleMemory:WebAssembly.Memory|undefined,moduleMemoryHighWater=0
function mainWasmMemoryStats(){const bytes=moduleMemory?.buffer.byteLength??0;moduleMemoryHighWater=Math.max(moduleMemoryHighWater,bytes);return {bytes,highWaterBytes:moduleMemoryHighWater,scope:'main-realm-linear-memory; overlaps managed inner allocations; remains until realm teardown'}}
const imageBytes = (references:readonly DecodedImageReference[]) => references.reduce((bytes,r)=>bytes+r.width*r.height*4,0)
function reserve(owner:object,key:string,pool:CanvasResourcePool,bytes:number,lease?:CanvasResourceLease,backend:'GPU'|'CPU'='CPU') {
  if(lease) {if(lease.resize(bytes))return lease}
  else {const acquired=canvasResourceBudget.acquire({owner,key,pool,bytes,pinned:true});if(acquired)return acquired}
  throw new Error(`${backend}_RESOURCE_BUDGET_EXCEEDED: ${key} admission denied`)
}
export async function loadVelloEngine() {
  modulePromise ??= (async () => {
    const module = await import('./generated/p0_engine_wasm.js')
    try { moduleMemory=(await module.default({ module_or_path: wasmUrl })).memory;mainWasmMemoryStats() }
    catch (error) { throw new Error(`Vello WASM loading failed (${wasmUrl}): ${String(error)}`) }
    return module
  })().catch(error => { modulePromise = undefined; throw error })
  return modulePromise
}

/** Checked coarse allocation is required before presentation can take DOM paint
 * ownership. It does not establish pixel correctness or performance. */
export function requireGpuAllocationHealth(metadata: unknown): void {
  const unavailable = () => { throw new Error('GPU_RENDER_STATUS_UNAVAILABLE: missing or invalid checked allocation receipt') }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return unavailable()
  const value = metadata as Record<string, unknown>
  const flags = value.gpuAllocationFailureFlags
  const uint32 = (count: unknown): count is number => typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= 0xffff_ffff
  if (!uint32(flags) || value.gpuAllocationStatusBytes !== 32
    || (value.gpuAllocationStatus !== 'checked' && value.gpuAllocationStatus !== 'retained-checked')) return unavailable()
  if (flags !== 0) throw new Error(`GPU_RENDER_CAPACITY_EXCEEDED: coarse allocation failure flags ${flags}`)
  if (value.gpuAllocationCounts !== undefined) {
    const counts = value.gpuAllocationCounts
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)
      || Object.values(counts).some(count => !uint32(count))
      || !('failed' in counts) || counts.failed !== flags) return unavailable()
  }
}

/** Experimental Hybrid receipts validate WebGPU scopes and completed work;
 * they do not pretend to expose Classic's coarse allocation counters. */
export function requireGpuRenderHealth(metadata:unknown,allowHybrid=false):void {
  const value=metadata as Record<string,unknown>|null
  if(value?.renderEngine!=='hybrid-0.2'){requireGpuAllocationHealth(metadata);return}
  const receipt=value.hybridReceipt as Record<string,unknown>|null
  if(!allowHybrid||value.gpuAllocationStatus!=='not-applicable-hybrid'||value.hybridValidationStatus!=='checked'
    ||value.prepareQueueCompleted!==true||!Number.isInteger(value.width)||!Number.isInteger(value.height)
    ||Number(value.width)<=0||Number(value.height)<=0||Number(value.width)>4096||Number(value.height)>4096
    ||value.cpuPixelReadbacks!==0||receipt?.backend!=='hybrid-0.2'||receipt.pixelReadbacks!==0
    ||receipt.hybridImageUploadBytes!==0||'gpuAllocationFailureFlags' in value||'gpuAllocationCounts' in value)
    throw new Error('GPU_RENDER_STATUS_UNAVAILABLE: invalid experimental Hybrid validation receipt')
}

/** No idle timer or second paint. Camera/resize and active gestures stay Classic. */
export function createDualRasterPolicy(){
  let previous:Pick<VelloFrame,'scale'|'panX'|'panY'|'width'|'height'>|undefined,lastMovement=-Infinity
  return {next(frame:VelloFrame,now:number,interacting=false):'classic'|'dual-static'{
    const moving=previous&&(previous.scale!==frame.scale||previous.panX!==frame.panX||previous.panY!==frame.panY||previous.width!==frame.width||previous.height!==frame.height)
    previous={scale:frame.scale,panX:frame.panX,panY:frame.panY,width:frame.width,height:frame.height}
    if(moving||interacting)lastMovement=now
    return moving||interacting||now-lastMovement<180?'classic':'dual-static'
  }}
}

function checkedGpuMetadata(json: string,allowHybrid=false): FrameMetadata {
  let metadata: unknown
  try { metadata = JSON.parse(json) }
  catch { throw new Error('GPU_RENDER_STATUS_UNAVAILABLE: invalid allocation metadata JSON') }
  requireGpuRenderHealth(metadata,allowHybrid)
  return metadata as FrameMetadata
}

/** Retain render derivatives only; canonical edits/history remain in the app. */
export function createRetainedTransport(renderer: {load_retained_scene(json:string,expected:number):number;patch_retained_scene(json:string,expected:number):number}) {
  let source='',revision=0,previous:Record<string,unknown>|undefined,keys:string[]=[]
  return { sync(snapshot:string,prepared?:import('../../canvas-engine/paintDisplayList').PreparedPaintDisplayList) {
    if(snapshot===source)return {revision,mode:'camera',bytes:0}
    const value=(prepared??JSON.parse(snapshot)) as unknown as Record<string,unknown>
    if(value?.schema==='art-equation.scene')return {revision:0,mode:'legacy',bytes:snapshot.length*2}
    if(!value || value.schema!=='art-equation.display-list' || !Array.isArray(value.operations))throw Error('RETAINED_DISPLAY_LIST_REQUIRED')
    const {revision:_ignored,operations,...metadata}=value
    const nextKeys=(operations as unknown[]).map(operation=>JSON.stringify(operation))
    let start=0;while(start<keys.length&&start<nextKeys.length&&keys[start]===nextKeys[start])start++
    let tail=0;while(tail<keys.length-start&&tail<nextKeys.length-start&&keys[keys.length-1-tail]===nextKeys[nextKeys.length-1-tail])tail++
    let mode='load',bytes=snapshot.length*2
    if(previous && previous.sceneId===metadata.sceneId) {
      const oldMetadata={...previous};delete oldMetadata.operations;delete oldMetadata.revision
      if(start===keys.length&&start===nextKeys.length&&JSON.stringify(oldMetadata)===JSON.stringify(metadata)){source=snapshot;return {revision,mode:'camera',bytes:0}}
      const patch=JSON.stringify({start,delete_count:keys.length-start-tail,insert:(operations as unknown[]).slice(start,nextKeys.length-tail),metadata})
      if(patch.length<snapshot.length){revision=renderer.patch_retained_scene(patch,revision);mode='patch';bytes=patch.length*2}
      else revision=renderer.load_retained_scene(snapshot,revision)
    } else revision=renderer.load_retained_scene(snapshot,revision)
    // Publish only after the engine has accepted the complete transaction.
    previous=value;keys=nextKeys;source=snapshot
    return {revision,mode,bytes}
  }}
}

export async function createGpuSession(canvas: HTMLCanvasElement): Promise<GpuSession> {
  const finish = viewportWarmup.begin()
  try { const session = await createWarmedGpuSession(canvas); finish(true); return session }
  catch (error) { finish(false); throw error }
}

async function createWarmedGpuSession(canvas: HTMLCanvasElement): Promise<GpuSession> {
  const module = await loadVelloEngine()
  const renderer = new module.B4SurfaceRenderer()
  const owner={}
  let frameLease:CanvasResourceLease|undefined,imageLease:CanvasResourceLease|undefined,allocatedPages=0
  let adapter:Record<string,unknown>={status:'not-reported'}
  let preparedHealth: FrameMetadata | undefined
  const isEnvironment = Boolean(canvas.dataset.environment === 'true' || canvas.classList.contains('vello-environment-canvas') || canvas.closest('.vello-environment'))
  const dualEnabled=import.meta.env?.VITE_VELLO_DUAL==='1'&&!isEnvironment
  const dualPolicy=createDualRasterPolicy()
  const residency = new ImageResidency()
  const retainedTransport=createRetainedTransport(renderer)
  const referenceCache=createFrameReferenceCache()
  let residentFrame:{references:readonly DecodedImageReference[];images:VelloFrame['images']}|undefined
  try {frameLease=reserve(owner,'vello-gpu-frame','tile-surface',canvas.width*canvas.height*8,undefined,'GPU')}
  catch(error){renderer.free();throw error}
  try {
    const initialized=await renderer.initialize(canvas)
    if(typeof initialized==='string')adapter=JSON.parse(initialized) as Record<string,unknown>
    recordMetric('gpu.adapter',Object.fromEntries(Object.entries(adapter).filter((entry):entry is [string,string|number|boolean]=>['string','number','boolean'].includes(typeof entry[1]))))
    if (!isEnvironment) {
      const warm = JSON.parse(await renderer.warm_classic())
      recordMetric('gpu.launch-warm', warm)
      // The warm-up atlas page remains allocated even after its test image is released.
      const warmResources = JSON.parse(renderer.resource_stats())
      allocatedPages = warmResources.imageAtlasAllocatedPages ?? 0
      imageLease = reserve(owner,'vello-gpu-images','tile-atlas',warmResources.bytes + allocatedPages * ATLAS_PAGE_RESERVE,undefined,'GPU')
    } else {
      allocatedPages = 0
    }
    frameLease.resize(canvas.width * canvas.height * 8)
    if(dualEnabled){const support=JSON.parse(await renderer.enable_hybrid());recordMetric('gpu.hybrid.initialize',support)}
  }
  catch (error) { try {renderer.dispose()} finally {try {renderer.free()} finally {frameLease.release();imageLease?.release()}} throw error }
  function reconcileImages() {
    const stats=JSON.parse(renderer.resource_stats()) as {bytes:number;imageAtlasAllocatedPages:number}
    allocatedPages=Math.max(allocatedPages,stats.imageAtlasAllocatedPages ?? 0)
    if((allocatedPages > 0 || stats.bytes > 0 || imageLease) && imageLease && !imageLease.resize(stats.bytes+allocatedPages*ATLAS_PAGE_RESERVE)) throw new Error('GPU_RESOURCE_BUDGET_EXCEEDED: allocated atlas accounting denied')
  }
  return {
    canvas,
    async prepare(frame) {
      const finishPrepare=metricSpan('gpu.prepare',{generation:frame.generation,width:frame.width,height:frame.height})
      try {
      preparedHealth = undefined
      renderer.discard_prepared()
      try {
        const references=referenceCache.read(frame.snapshot,frame.displayList)
        const old=residentFrame
        const sameImages=old&&(old.images===frame.images||(old.images?.length??0)===(frame.images?.length??0)&&(frame.images??[]).every((upload,i)=>upload===old.images?.[i]))
        const reuseResources=Boolean(sameImages&&old&&references.length===old.references.length&&references.every((r,i)=>{const before=old.references[i];return r.key===before.key&&r.revision===before.revision&&r.epoch===before.epoch&&r.width===before.width&&r.height===before.height}))
        if(!reuseResources){
      const finishReferences=metricSpan('gpu.frontend.references',{generation:frame.generation})
      finishReferences()
      const finishUploads=metricSpan('gpu.frontend.upload-validation',{generation:frame.generation,references:references.length})
      let uploads:ReturnType<typeof imageUploads>
      try {uploads=imageUploads(references,frame.images)} finally {finishUploads()}
      const finishResidency=metricSpan('gpu.frontend.residency',{generation:frame.generation,references:references.length})
      let retained:{references:DecodedImageReference[]},known:Set<string>
      try {
        const wanted=residency.request(references)
        retained=JSON.parse(renderer.retain_images(JSON.stringify(wanted))) as {references:DecodedImageReference[]}
        residency.checked(retained.references,references)
        known=new Set(retained.references.map(imageIdentity))
      } finally {finishResidency()}
        for(const reference of references)if(!known.has(imageIdentity(reference))&&!uploads.has(imageIdentity(reference)))throw new Error(`RESOURCE_NOT_READY: missing image upload ${reference.key}`)
        let combined=new Map(retained.references.map(r=>[imageIdentity(r),r]));for(const r of references)combined.set(imageIdentity(r),r)
        // Raw WASM registry + owned page + Vello replica + temporary upload.
        // This is application accounting; driver/internal scratch is separate.
        const pagesToReserve = Math.max(allocatedPages, plannedAtlasPages(references))
        const totalImageBytes = imageBytes([...combined.values()])
        if (pagesToReserve > 0 || totalImageBytes > 0) {
          const admitImages=()=>reserve(owner,'vello-gpu-images','tile-atlas',totalImageBytes+pagesToReserve*ATLAS_PAGE_RESERVE,imageLease,'GPU')
          try {imageLease=admitImages()} catch(error) {
            // Optional inactive-board reuse cannot displace the active frame.
            // Drop it before retrying the unchanged active resource admission.
            if(!retained.references.some(r=>!references.some(active=>imageIdentity(active)===imageIdentity(r))))throw error
            retained=JSON.parse(renderer.retain_images(JSON.stringify(references)))
            residency.checked(retained.references,references);known=new Set(retained.references.map(imageIdentity))
            combined=new Map(references.map(r=>[imageIdentity(r),r]))
            imageLease=admitImages();recordMetric('gpu.residency-evict',{reason:'active-admission',active:references.length})
          }
        } else if (imageLease) {
          imageLease.resize(0)
        }
        const finishUpload=metricSpan('gpu.image-register',{references:references.length,missing:references.filter(reference=>!known.has(imageIdentity(reference))).length})
        try { for (const reference of references) if (!known.has(imageIdentity(reference))) {
          const upload = uploads.get(imageIdentity(reference))
          if (!upload) throw new Error(`RESOURCE_NOT_READY: missing image upload ${reference.key}`)
          renderer.register_image(JSON.stringify(reference),upload.pixels)
        } } finally {finishUpload()}
        residency.checked([...combined.values()],references)
        recordMetric('gpu.residency',{active:references.length,retained:combined.size,reused:references.filter(r=>known.has(imageIdentity(r))).length,bytes:imageBytes([...combined.values()])})

          residentFrame={references,images:frame.images}
        } else recordMetric('gpu.resources-reused',{generation:frame.generation})
        frameLease=reserve(owner,'vello-gpu-frame','tile-surface',Math.max(frameLease?.bytes ?? 0,frame.width*frame.height*8),frameLease,'GPU')
        const finishSnapshot=metricSpan('gpu.snapshot',{generation:frame.generation})
        let metadata:FrameMetadata
        try {
          if(dualEnabled){const policy=dualPolicy.next(frame,performance.now(),canvas.closest<HTMLElement>('.canvas-stage')?.dataset.gesturePreview==='true');renderer.set_render_policy(policy);recordMetric('gpu.rasterPolicy',{generation:frame.generation,policy})}
          const update=retainedTransport.sync(frame.snapshot,frame.displayList)
          recordMetric('gpu.retained-command',{generation:frame.generation,revision:update.revision,mode:update.mode,bytes:update.bytes})
          metadata=checkedGpuMetadata(update.mode==='legacy'?await renderer.prepare_snapshot(frame.width,frame.height,frame.snapshot,frame.scale,frame.panX,frame.panY):await renderer.prepare_retained_frame(frame.width,frame.height,update.revision,frame.scale,frame.panX,frame.panY),dualEnabled)
        }
        finally {finishSnapshot()}
        // Preserve internal phase timings even when a newer generation discards
        // this prepared frame. Elapsed GPU wait can include main-thread delay.
        const phases=metadata.probeTimingsMs
        if(phases && typeof phases==='object')for(const [phase,value] of Object.entries(phases)){
          if(typeof value==='number' && Number.isFinite(value))recordMetric(`gpu.phase.${phase}`,{generation:frame.generation,ms:value})
        }
        reconcileImages()
        preparedHealth = metadata
        return {...metadata,adapter,wasmMemory:mainWasmMemoryStats(),accountedImageBytes:imageLease?.bytes ?? 0,accountedFrameBytes:frameLease.bytes,accountingScope:'logical application-copies-and-atlas-reserve; physical heap and driver reported separately'}
      }
      catch(error) {
        residentFrame=undefined;
        renderer.discard_prepared()
        reconcileImages()
        throw error
      }
      } finally {finishPrepare()}
    },
    present() {
      requireGpuRenderHealth(preparedHealth,dualEnabled)
      preparedHealth = undefined
      const finishPresent=metricSpan('gpu.present')
      let metadata:FrameMetadata
      try {metadata=checkedGpuMetadata(renderer.present_prepared(),dualEnabled)}
      finally {finishPresent()}
      reconcileImages()
      frameLease?.resize(Number(metadata.width)*Number(metadata.height)*8)
      return {...metadata,adapter,wasmMemory:mainWasmMemoryStats()}
    },
    discard() { preparedHealth = undefined;renderer.discard_prepared();reconcileImages() },
    dispose() { residentFrame=undefined;referenceCache.clear();residency.clear();try {renderer.dispose()} finally {try {renderer.free()} finally {frameLease?.release();imageLease?.release()}} },
    destroyForTest() { renderer.destroy_device_for_recovery_test() },
    checkHealth() { renderer.check_health() },
  }
}

type CpuTimer = ReturnType<typeof setTimeout>
type CpuSessionDependencies = {
  createWorker(): Worker
  setTimeout(callback: () => void, delay: number): CpuTimer
  clearTimeout(timer: CpuTimer): void
  timeoutMs: number
}
type CpuResult = { pixels: Uint8Array<ArrayBuffer>; metadata: FrameMetadata; release():void }
type CpuRequest = {
  width: number
  height: number
  expectedImages: readonly DecodedImageReference[]
  transferLease?:CanvasResourceLease
  outputLease?:CanvasResourceLease
  timer?: CpuTimer
  resolve(result: CpuResult): void
  reject(error: Error): void
}
const MAX_CPU_EDGE = 4096, MAX_CPU_PIXELS = 16_777_216
const MAX_CPU_REQUESTS = 2, DEFAULT_CPU_TIMEOUT_MS = 30_000

function validateCpuFrame(frame: VelloFrame) {
  if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height)
    || frame.width <= 0 || frame.height <= 0 || frame.width > MAX_CPU_EDGE || frame.height > MAX_CPU_EDGE
    || frame.width * frame.height > MAX_CPU_PIXELS) throw new Error('Invalid Vello CPU frame dimensions')
  if (!Number.isSafeInteger(frame.generation) || frame.generation < 0
    || ![frame.scale, frame.panX, frame.panY].every(Number.isFinite) || frame.scale <= 0) throw new Error('Invalid Vello CPU frame camera/generation')
  if (typeof frame.snapshot !== 'string' || frame.snapshot.length > 16_777_216) throw new Error('Invalid Vello CPU snapshot string')
}

/** The deadline covers worker startup, WASM fetching/compilation and rendering.
 * A terminated session rejects all work; the presenter may create a fresh one
 * on its next valid request. No GPU pixels are read back through this path. */
export function createCpuSession(injected?: Partial<CpuSessionDependencies>): CpuSession {
  const dependencies: CpuSessionDependencies = {
    createWorker: () => new Worker(new URL('./cpu.worker.ts', import.meta.url), { type: 'module' }),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: timer => globalThis.clearTimeout(timer),
    timeoutMs: DEFAULT_CPU_TIMEOUT_MS,
    ...injected,
  }
  if (!Number.isInteger(dependencies.timeoutMs) || dependencies.timeoutMs <= 0 || dependencies.timeoutMs > 300_000) throw new Error('Invalid Vello CPU worker deadline')
  const worker = dependencies.createWorker()
  let sequence = 0, disposed = false
  let knownImages = new Set<string>()
  let residentImages:readonly DecodedImageReference[]=[], frameLease:CanvasResourceLease|undefined,imageLease:CanvasResourceLease|undefined
  let residentSurfaceBytes = 0
  const owner={}
  const reconcileLeases=()=>{
    const combined=new Map(residentImages.map(r=>[imageIdentity(r),r]));for(const request of requests.values())for(const r of request.expectedImages)combined.set(imageIdentity(r),r)
    imageLease?.resize(imageBytes([...combined.values()])*2)
    const maximum=Math.max(0,...[...requests.values()].map(r=>r.width*r.height))
    frameLease?.resize(Math.max(residentSurfaceBytes,maximum*4)+maximum*4)
  }
  const requests = new Map<number, CpuRequest>()
  const clearDeadline = (request: CpuRequest) => { if (request.timer !== undefined) dependencies.clearTimeout(request.timer);request.transferLease?.release() }
  const rejectAll = (reason: string) => {
    for (const request of requests.values()) { clearDeadline(request); request.outputLease?.release();request.reject(new Error(reason)) }
    requests.clear()
  }
  const failWorker = (reason: string) => {
    if (disposed) return
    disposed = true
    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null
    try { worker.terminate() } catch { /* Reject pending work even if worker shutdown fails. */ }
    rejectAll(reason)
    frameLease?.release();imageLease?.release();frameLease=undefined;imageLease=undefined;residentSurfaceBytes=0
  }
  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (disposed) return
    const reply = event.data
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) { failWorker('Vello CPU worker returned a malformed frame message'); return }
    const value = reply as { id?: unknown; pixels?: unknown; metadata?: unknown; error?: unknown }
    if (!Number.isSafeInteger(value.id) || (value.id as number) <= 0 || (value.id as number) > sequence) {
      failWorker('Vello CPU worker returned an invalid request identifier'); return
    }
    const id = value.id as number, request = requests.get(id)
    if (!request) return // A duplicate receipt cannot settle or paint another request.
    if (value.error !== undefined) {
      if (typeof value.error !== 'string' || !value.error || value.pixels !== undefined || value.metadata !== undefined) {
        failWorker('Vello CPU worker returned a malformed error reply'); return
      }
      // A failed resource registration/render may have partially changed worker
      // residency. Retire the worker rather than trust stale admission receipts.
      failWorker(value.error.slice(0,8000))
      return
    }
    const pixels = value.pixels, metadata = value.metadata
    const expectedBytes = request.width * request.height * 4
    if (!(pixels instanceof Uint8Array) || !(pixels.buffer instanceof ArrayBuffer)
      || pixels.byteLength !== expectedBytes || pixels.byteOffset !== 0 || pixels.buffer.byteLength !== expectedBytes
      || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || (metadata as FrameMetadata).width !== request.width || (metadata as FrameMetadata).height !== request.height) {
      failWorker('Vello CPU worker returned invalid RGBA pixels or frame dimensions'); return
    }
    const resourceStats = (metadata as FrameMetadata).imageResources as {decoded?:{references?:unknown[]};cpuSurfaceBytes?:unknown} | undefined
    let receiptImages: Set<string> | undefined
    let receiptSurfaceBytes = request.width*request.height*4
    try {
      if (resourceStats?.cpuSurfaceBytes !== undefined) {
        const bytes=resourceStats.cpuSurfaceBytes
        if (typeof bytes!=='number' || !Number.isSafeInteger(bytes) || bytes < receiptSurfaceBytes || bytes%4!==0 ||
          bytes > Math.max(residentSurfaceBytes,receiptSurfaceBytes)) throw new Error('CPU surface capacity')
        receiptSurfaceBytes=bytes
      }
      if (resourceStats !== undefined || request.expectedImages.length) {
        const references = resourceStats?.decoded?.references
        if (!Array.isArray(references) || references.length > 1024) throw new Error('image references')
        receiptImages = new Set(references.map(value => imageIdentity(validateImageReference(value))))
        if (receiptImages.size !== references.length || receiptImages.size !== request.expectedImages.length
          || request.expectedImages.some(reference => !receiptImages!.has(imageIdentity(reference)))) throw new Error('image residency')
      }
    } catch { failWorker('Vello CPU worker returned invalid image resource receipt'); return }
    residentSurfaceBytes=Math.max(residentSurfaceBytes,receiptSurfaceBytes)
    requests.delete(id); clearDeadline(request)
    if (receiptImages) {knownImages = receiptImages;residentImages=request.expectedImages}
    reconcileLeases()
    // The caller owns these pixels until synchronous presentation/discard.
    // Worker retirement cannot release a settled output still being consumed.
    request.resolve({ pixels: pixels as Uint8Array<ArrayBuffer>, metadata: metadata as FrameMetadata,release:()=>request.outputLease?.release() })
  }
  worker.onerror = event => failWorker(`Vello CPU worker failed: ${String(event.message).slice(0, 8000)}`)
  worker.onmessageerror = () => failWorker('Vello CPU worker message decoding failed')
  return {
    render(frame: VelloFrame) {
      if (disposed) return Promise.reject(new Error('Vello CPU worker is disposed'))
      try { validateCpuFrame(frame) }
      catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))) }
      // The controller normally allows one running request. Bound this public
      // session too, so another caller cannot enqueue unbounded snapshot copies.
      if (requests.size >= MAX_CPU_REQUESTS) return Promise.reject(new Error('Vello CPU worker request limit reached'))
      let submitted: VelloFrame, transfers: ArrayBuffer[], transferLease:CanvasResourceLease|undefined, outputLease:CanvasResourceLease|undefined
      const oldImageLease=imageLease,oldFrameLease=frameLease,oldImageBytes=imageLease?.bytes ?? 0,oldFrameBytes=frameLease?.bytes ?? 0
      try {
        const references = frameImageReferences(frame.snapshot), uploads = imageUploads(references,frame.images)
        const missing=references.filter(r=>!knownImages.has(imageIdentity(r)))
        for(const reference of missing)if(!uploads.has(imageIdentity(reference)))throw new Error(`RESOURCE_NOT_READY: missing CPU image upload ${reference.key}`)
        const combined=new Map(residentImages.map(r=>[imageIdentity(r),r]));for(const request of requests.values())for(const r of request.expectedImages)combined.set(imageIdentity(r),r);for(const r of references)combined.set(imageIdentity(r),r)
        // Raw decoded WASM bytes + persistent CPU pixmaps, before copying.
        imageLease=reserve(owner,'vello-cpu-images','tile-atlas',imageBytes([...combined.values()])*2,imageLease)
        // Worker pixmap + its RGBA output; queued requests render serially.
        const maximum=Math.max(frame.width*frame.height,...[...requests.values()].map(r=>r.width*r.height))
        frameLease=reserve(owner,'vello-cpu-frame','tile-surface',Math.max(residentSurfaceBytes,maximum*4)+maximum*4,frameLease)
        outputLease=reserve(owner,'vello-cpu-output','tile-surface',frame.width*frame.height*4)
        if(missing.length)transferLease=reserve(owner,'vello-cpu-upload','retained',imageBytes(missing))
        const images = missing.map(reference => {
          const upload = uploads.get(imageIdentity(reference))
          if (!upload) throw new Error(`RESOURCE_NOT_READY: missing CPU image upload ${reference.key}`)
          return {reference,pixels:new Uint8Array(upload.pixels)}
        })
        submitted = {...frame,images}; transfers=images.map(image=>image.pixels.buffer)
      } catch(error) {
        transferLease?.release();outputLease?.release()
        if(oldImageLease)oldImageLease.resize(oldImageBytes);else{imageLease?.release();imageLease=undefined}
        if(oldFrameLease)oldFrameLease.resize(oldFrameBytes);else{frameLease?.release();frameLease=undefined}
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const request: CpuRequest = { width: frame.width, height: frame.height, expectedImages:frameImageReferences(frame.snapshot), transferLease, outputLease, resolve, reject }
        requests.set(id, request)
        try {
          request.timer = dependencies.setTimeout(() => failWorker(`Vello CPU worker request ${id} timed out after ${dependencies.timeoutMs}ms`), dependencies.timeoutMs)
          worker.postMessage({ id, frame:submitted }, transfers)
        } catch (error) {
          // A posting/timer failure must not leave a promise without a deadline.
          failWorker(`Vello CPU worker could not submit frame: ${String(error).slice(0, 8000)}`)
        }
      })
    },
    dispose() { failWorker('Vello CPU worker disposed') },
    reusableSurfaceBytes() {return frameLease?.bytes ?? 0},
  }
}
