import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Execute actual CPU-session request/lifetime/validation logic. Inject only the
// worker transport and clock; this is not a mock rasterizer or GPU pixel proof.
const source = await readFile(new URL('./backends.ts', import.meta.url), 'utf8')
const sourceUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const budgetSource = await readFile(new URL('../../canvas-engine/resourceBudget.ts', import.meta.url), 'utf8')
const registrySource = await readFile(new URL('../../canvas-engine/decodedImageRegistry.ts', import.meta.url), 'utf8')
const budgetUrl = sourceUrl(compile(budgetSource))
const demandUrl = sourceUrl(compile(await readFile(new URL('../../canvas-engine/imageDemand.ts', import.meta.url), 'utf8')))
const atlasUrl = sourceUrl(compile(await readFile(new URL('./atlasPlan.ts', import.meta.url), 'utf8')))
const diagnosticsUrl = sourceUrl('export const metricSpan=()=>()=>{}; export const recordMetric=()=>{}; // controlled telemetry boundary')
const registryUrl = sourceUrl(compile(registrySource).replace(/from ['"]\.\/resourceBudget['"]/g, `from '${budgetUrl}'`).replace(/from ['"]\.\/imageDemand['"]/g, `from '${demandUrl}'`))
const residencyUrl = sourceUrl(compile(await readFile(new URL('./imageResidency.ts',import.meta.url),'utf8')).replace(/from ['"]\.\.\/\.\.\/canvas-engine\/decodedImageRegistry['"]/g, `from '${registryUrl}'`))
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import wasmUrl from [^\n]+$/m, 'const wasmUrl = "test://GPU-module-is-not-loaded";')
  .replace(/from ['"]\.\.\/\.\.\/canvas-engine\/decodedImageRegistry['"]/g, `from '${registryUrl}'`)
  .replace(/from ['"]\.\.\/\.\.\/canvas-engine\/resourceBudget['"]/g, `from '${budgetUrl}'`)
  .replace(/from ['"]\.\/atlasPlan['"]/g, `from '${atlasUrl}'`)
  .replace(/from ['"]\.\/imageResidency['"]/g, `from '${residencyUrl}'`)
  .replace(/from ['"]\.\/viewportWarmup['"]/g, `from '${sourceUrl(compile(await readFile(new URL('./viewportWarmup.ts',import.meta.url),'utf8')))}'`)
  .replace(/from ['"]\.\.\/\.\.\/diagnostics\/performance['"]/g, `from '${diagnosticsUrl}'`)
const backendUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const { createCpuSession, requireGpuAllocationHealth,requireGpuRenderHealth,createDualRasterPolicy,createRetainedTransport } = await import(backendUrl)
let checks = 0
const check = (name, condition) => { assert(condition, name); checks++; console.log('PASS ' + name) }
const policy=createDualRasterPolicy(),view={width:100,height:100,scale:1,panX:0,panY:0}
check('static first content is eligible for dual',policy.next(view,0)==='dual-static')
check('camera movement stays Classic',policy.next({...view,panX:10},10)==='classic')
check('post-movement edit avoids immediate backend thrash',policy.next({...view,panX:10},100)==='classic')
check('later content can use dual without a timer',policy.next({...view,panX:10},200)==='dual-static')
check('active drawing stays Classic',policy.next({...view,panX:10},300,true)==='classic')
check('resize stays Classic',policy.next({...view,width:120,panX:10},600)==='classic')
const hybridHealth={renderEngine:'hybrid-0.2',gpuAllocationStatus:'not-applicable-hybrid',hybridValidationStatus:'checked',prepareQueueCompleted:true,width:100,height:100,cpuPixelReadbacks:0,hybridReceipt:{backend:'hybrid-0.2',pixelReadbacks:0,hybridImageUploadBytes:0}}
assert.doesNotThrow(()=>requireGpuRenderHealth(hybridHealth,true));check('explicit experiment accepts its own Hybrid validation schema',true)
assert.throws(()=>requireGpuRenderHealth(hybridHealth),/GPU_RENDER_STATUS_UNAVAILABLE/)
assert.throws(()=>requireGpuAllocationHealth(hybridHealth),/GPU_RENDER_STATUS_UNAVAILABLE/)
for(const bad of [{...hybridHealth,hybridValidationStatus:'submitted'},{...hybridHealth,prepareQueueCompleted:false},{...hybridHealth,width:8192},{...hybridHealth,gpuAllocationCounts:{failed:0}},{...hybridHealth,hybridReceipt:{...hybridHealth.hybridReceipt,hybridImageUploadBytes:100}}])assert.throws(()=>requireGpuRenderHealth(bad,true),/GPU_RENDER_STATUS_UNAVAILABLE/)
check('unopted, incomplete, over-budget and counterfeit Hybrid receipts reject',true)
// Fabricated receipts test the acceptance boundary only; no GPU execution or
// product qualification is established by these synthetic positive cases.
const healthyAllocation = { gpuAllocationStatus: 'checked', gpuAllocationFailureFlags: 0, gpuAllocationStatusBytes: 32 }
for (const status of ['checked', 'retained-checked']) {
  requireGpuAllocationHealth({ ...healthyAllocation, gpuAllocationStatus: status, gpuAllocationCounts: { failed: 0, blend: 0, tile: 4294967295 } })
  check(`synthetic ${status} numeric allocation receipt is admitted`, true)
}
const badAllocation = [
  ['missing receipt', undefined], ['null receipt', null], ['array receipt', []],
  ['missing status', { ...healthyAllocation, gpuAllocationStatus: undefined }],
  ['unverified status', { ...healthyAllocation, gpuAllocationStatus: 'submitted' }],
  ['boolean flags', { ...healthyAllocation, gpuAllocationFailureFlags: false }],
  ['string flags', { ...healthyAllocation, gpuAllocationFailureFlags: '0' }],
  ['missing flags', { ...healthyAllocation, gpuAllocationFailureFlags: undefined }],
  ['negative flags', { ...healthyAllocation, gpuAllocationFailureFlags: -1 }],
  ['fractional flags', { ...healthyAllocation, gpuAllocationFailureFlags: .5 }],
  ['oversized flags', { ...healthyAllocation, gpuAllocationFailureFlags: 4294967296 }],
  ['wrong byte length', { ...healthyAllocation, gpuAllocationStatusBytes: 64 }],
  ['string byte length', { ...healthyAllocation, gpuAllocationStatusBytes: '32' }],
  ['null counts', { ...healthyAllocation, gpuAllocationCounts: null }],
  ['array counts', { ...healthyAllocation, gpuAllocationCounts: [] }],
  ['missing failed count', { ...healthyAllocation, gpuAllocationCounts: { blend: 0 } }],
  ['string count', { ...healthyAllocation, gpuAllocationCounts: { blend: '0' } }],
  ['negative count', { ...healthyAllocation, gpuAllocationCounts: { blend: -1 } }],
  ['contradictory count', { ...healthyAllocation, gpuAllocationCounts: { failed: 4 } }],
]
for (const [name, metadata] of badAllocation) {
  assert.throws(() => requireGpuAllocationHealth(metadata), /GPU_RENDER_STATUS_UNAVAILABLE/)
  check(`invalid ${name} refuses GPU paint ownership`, true)
}
for (const flags of [1, 4, 4294967295]) {
  assert.throws(() => requireGpuAllocationHealth({ ...healthyAllocation, gpuAllocationFailureFlags: flags }), /GPU_RENDER_CAPACITY_EXCEEDED/)
  check(`allocation failure flags ${flags} require recovery`, true)
}
const frame = (generation = 1, extra = {}) => ({ generation, snapshot: '{"schema":"test"}', width: 4, height: 3, scale: 1, panX: 2, panY: 7, ...extra })
const result = (id, width = 4, height = 3) => ({ id, pixels: new Uint8Array(width * height * 4), metadata: { width, height, backend: 'vello_cpu', cpuPixelReadbacks: 0 } })
const outcome = promise => promise.then(value => ({ value }), error => ({ error }))
function harness(extra = {}) {
  let timerSequence = 0, terminated = 0, factoryCalls = 0
  const timers = new Map(), delays = [], canceled = [], posted = [], transferLists = []
  const worker = {
    onmessage: null, onerror: null, onmessageerror: null,
    terminate() { terminated++; if (extra.terminateThrows) throw new Error('shutdown transport failed') },
    postMessage(message, transfers = []) { if (extra.postThrows) throw new Error('post transport failed'); transferLists.push(transfers); posted.push(extra.realTransfer ? structuredClone(message, { transfer: transfers }) : structuredClone(message)) },
  }
  const dependencies = {
    createWorker: () => { factoryCalls++; return worker },
    setTimeout(callback, delay) {
      if (extra.timerThrows) throw new Error('timer transport failed')
      const id = ++timerSequence; timers.set(id, callback); delays.push(delay); return id
    },
    clearTimeout(id) { timers.delete(id); canceled.push(id) },
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
  }
  // The fixture consumes any settled output before ending its own lifetime.
  const realSession = createCpuSession(dependencies), outputs = new Set()
  const session = { ...realSession, render(frame) { return realSession.render(frame).then(value => { outputs.add(value); return value }) }, dispose() { for (const output of outputs) output.release?.(); outputs.clear(); realSession.dispose() } }
  return {
    session, worker, timers, delays, canceled, posted, transferLists,
    reply(data) { worker.onmessage?.({ data }) },
    expire(id = timers.keys().next().value) { const callback = timers.get(id); timers.delete(id); callback?.() },
    get terminated() { return terminated }, get factoryCalls() { return factoryCalls },
  }
}
const freshDisposed = async h => { const receipt = await outcome(h.session.render(frame(99))); return /disposed/i.test(receipt.error?.message ?? '') }

{
  const h=harness(),first=outcome(h.session.render(frame()))
  const retained=(id,width,height,bytes)=>({...result(id,width,height),metadata:{...result(id,width,height).metadata,
    imageResources:{decoded:{references:[]},cpuSurfaceBytes:bytes}}})
  h.reply(retained(h.posted[0].id,4,3,48));const receipt=await first;receipt.value.release()
  check('settled CPU frame retains its admitted raster-buffer lease',h.session.reusableSurfaceBytes()===48)
  const smaller=outcome(h.session.render(frame(2,{width:2,height:2})))
  check('smaller frame admission includes retained capacity and in-flight output',h.session.reusableSurfaceBytes()===64)
  h.reply(retained(h.posted[1].id,2,2,48));(await smaller).value.release()
  check('smaller CPU frame cannot hide the retained larger raster buffer',h.session.reusableSurfaceBytes()===48)
  h.session.dispose();check('CPU worker disposal releases the retained surface lease',h.session.reusableSurfaceBytes()===0)
}
for(const bytes of [-4,0,16,49,96,'48',NaN]){
  const h=harness(),pending=outcome(h.session.render(frame()))
  const reply=result(h.posted[0].id);reply.metadata.imageResources={decoded:{references:[]},cpuSurfaceBytes:bytes};h.reply(reply)
  check(`invalid retained CPU capacity ${bytes} fails closed`,!!(await pending).error&&h.terminated===1)
  h.session.dispose()
}

{
  const h = harness(), pending = outcome(h.session.render(frame()))
  check('default request deadline includes worker/WASM startup', h.delays[0] === 30_000 && h.timers.size === 1)
  const reply = result(h.posted[0].id)
  h.reply(reply)
  const receipt = await pending
  check('valid exact RGBA frame resolves unchanged pixels and metadata', receipt.value?.pixels === reply.pixels && receipt.value?.metadata === reply.metadata)
  check('successful receipt clears deadline and retains live worker', h.timers.size === 0 && h.terminated === 0)
  const next = outcome(h.session.render(frame(2))); h.reply(result(h.posted[1].id))
  check('same CPU worker accepts next valid frame', Boolean((await next).value) && h.factoryCalls === 1)
  h.session.dispose()
  check('dispose after success terminates once without leaked timers', h.terminated === 1 && h.timers.size === 0)
}
{
  const h = harness(), a = outcome(h.session.render(frame())), b = outcome(h.session.render(frame(2)))
  h.expire()
  const receipts = await Promise.all([a, b])
  check('hung worker deadline rejects every pending request', receipts.every(item => /timed out after 30000ms/.test(item.error?.message ?? '')))
  check('deadline terminates worker, clears timers and rejects future calls', h.terminated === 1 && h.timers.size === 0 && await freshDisposed(h))
  h.session.dispose()
  check('timeout then disposal is idempotent', h.terminated === 1)
}
for (const kind of ['error', 'messageerror']) {
  const h = harness(), a = outcome(h.session.render(frame())), b = outcome(h.session.render(frame(2)))
  if (kind === 'error') h.worker.onerror({ message: 'WASM script fetch failed' })
  else h.worker.onmessageerror({})
  const receipts = await Promise.all([a, b])
  check(`worker ${kind} fails all work closed`, receipts.every(item => item.error instanceof Error) && h.terminated === 1 && h.timers.size === 0 && await freshDisposed(h))
  check(`worker ${kind} detaches terminal handlers`, h.worker.onmessage === null && h.worker.onerror === null && h.worker.onmessageerror === null)
}
{
  const h = harness(), pending = outcome(h.session.render(frame()))
  h.reply({ id: h.posted[0].id, error: 'unsupported scene content' })
  check('valid renderer error rejects request and clears its deadline', /unsupported scene/.test((await pending).error?.message ?? '') && h.timers.size === 0)
  const fresh = harness(), next = outcome(fresh.session.render(frame(2))); fresh.reply(result(fresh.posted[0].id))
  check('renderer error retires uncertain residency and a fresh worker accepts later valid scene', Boolean((await next).value) && h.terminated === 1 && await freshDisposed(h))
  h.session.dispose(); fresh.session.dispose()
}
const malformed = [
  ['null message', () => null], ['array message', () => []],
  ['missing id', () => ({ pixels: new Uint8Array(48), metadata: { width: 4, height: 3 } })],
  ['zero id', () => result(0)], ['fractional id', () => result(.5)], ['future id', () => result(999)], ['string id', () => result('1')],
  ['missing pixels', id => ({ id, metadata: { width: 4, height: 3 } })],
  ['missing metadata', id => ({ id, pixels: new Uint8Array(48) })],
  ['wrong byte length', id => ({ ...result(id), pixels: new Uint8Array(47) })],
  ['oversized pixels', id => ({ ...result(id), pixels: new Uint8Array(49) })],
  ['plain array pixels', id => ({ ...result(id), pixels: Array(48).fill(0) })],
  ['clamped pixels', id => ({ ...result(id), pixels: new Uint8ClampedArray(48) })],
  ['16-bit pixels', id => ({ ...result(id), pixels: new Uint16Array(24) })],
  ['buffer pixels', id => ({ ...result(id), pixels: new ArrayBuffer(48) })],
  ['offset pixel view', id => ({ ...result(id), pixels: new Uint8Array(new ArrayBuffer(49), 1, 48) })],
  ['oversized backing buffer', id => ({ ...result(id), pixels: new Uint8Array(new ArrayBuffer(96), 0, 48) })],
  ['wrong width', id => ({ ...result(id), metadata: { width: 3, height: 3 } })],
  ['wrong height', id => ({ ...result(id), metadata: { width: 4, height: 4 } })],
  ['string width', id => ({ ...result(id), metadata: { width: '4', height: 3 } })],
  ['nonfinite height', id => ({ ...result(id), metadata: { width: 4, height: NaN } })],
  ['metadata array', id => ({ ...result(id), metadata: [] })],
  ['nonstring error', id => ({ id, error: { message: 'failed' } })],
  ['empty error', id => ({ id, error: '' })],
  ['error plus pixels', id => ({ ...result(id), error: 'failed' })],
]
if (typeof SharedArrayBuffer === 'function') malformed.push(['shared pixel buffer', id => ({ ...result(id), pixels: new Uint8Array(new SharedArrayBuffer(48)) })])
for (const [name, build] of malformed) {
  const h = harness(), pending = outcome(h.session.render(frame()))
  h.reply(build(h.posted[0].id))
  const receipt = await pending
  check(`malformed ${name} cannot resolve or claim pixels`, receipt.error instanceof Error && !receipt.value && h.terminated === 1 && h.timers.size === 0 && await freshDisposed(h))
}
{
  const h = harness(), a = outcome(h.session.render(frame())), b = outcome(h.session.render(frame(2)))
  h.reply(result(h.posted[0].id))
  await a
  h.reply(result(h.posted[0].id))
  check('duplicate completed receipt cannot clear a different deadline', h.timers.size === 1 && h.terminated === 0)
  h.reply(result(h.posted[1].id))
  check('duplicate receipt cannot settle or replace current request', Boolean((await b).value) && h.timers.size === 0)
  h.session.dispose()
}
for (const failure of ['postThrows', 'timerThrows']) {
  const h = harness({ [failure]: true }), receipt = await outcome(h.session.render(frame()))
  check(`${failure} leaves no unbounded request`, receipt.error instanceof Error && h.terminated === 1 && h.timers.size === 0 && await freshDisposed(h))
}
{
  const h = harness({ terminateThrows: true }), pending = outcome(h.session.render(frame()))
  h.session.dispose()
  check('termination exception still rejects pending work and clears timer', (await pending).error instanceof Error && h.timers.size === 0 && await freshDisposed(h))
}
{
  const h = harness(), pending = outcome(h.session.render(frame()))
  const oldHandler = h.worker.onmessage
  h.session.dispose(); oldHandler({ data: result(h.posted[0].id) })
  check('late receipt after dispose cannot resolve pending pixels', (await pending).error instanceof Error && h.terminated === 1 && h.timers.size === 0)
}
{
  const h = harness(), a = outcome(h.session.render(frame())), b = outcome(h.session.render(frame(2)))
  const third = await outcome(h.session.render(frame(3)))
  check('public CPU session bounds queued snapshot requests', /request limit/.test(third.error?.message ?? '') && h.posted.length === 2 && h.timers.size === 2)
  h.reply(result(h.posted[0].id)); h.reply(result(h.posted[1].id)); await Promise.all([a, b])
  const next = outcome(h.session.render(frame(4))); h.reply(result(h.posted[2].id))
  check('queue pressure does not corrupt subsequent valid rendering', Boolean((await next).value) && h.terminated === 0)
  h.session.dispose()
}
const invalidFrames = [
  ['zero width', { width: 0 }], ['negative height', { height: -1 }], ['fractional width', { width: 4.5 }],
  ['oversized width', { width: 4097 }], ['oversized height', { height: 4097 }], ['nonfinite width', { width: Infinity }],
  ['zero scale', { scale: 0 }], ['nonfinite scale', { scale: NaN }], ['nonfinite pan', { panX: Infinity }],
  ['negative generation', { generation: -1 }], ['fractional generation', { generation: 1.2 }],
  ['unsafe generation', { generation: Number.MAX_SAFE_INTEGER + 1 }], ['nonstring snapshot', { snapshot: null }],
]
for (const [name, extra] of invalidFrames) {
  const h = harness(), receipt = await outcome(h.session.render(frame(1, extra)))
  check(`invalid input ${name} rejected before allocation/posting`, receipt.error instanceof Error && h.posted.length === 0 && h.timers.size === 0)
  h.session.dispose()
}
{
  const h = harness(), receipt = await outcome(h.session.render(frame(1, { snapshot: 'x'.repeat(16_777_217) })))
  check('oversized snapshot rejected before worker copy', receipt.error instanceof Error && h.posted.length === 0 && h.timers.size === 0)
  h.session.dispose()
}
for (const timeoutMs of [0, -1, .5, NaN, Infinity, 300_001]) {
  assert.throws(() => harness({ timeoutMs }), /Invalid Vello CPU worker deadline/)
  check(`invalid deadline ${String(timeoutMs)} cannot disable timeout`, true)
}
{
  const old = harness(), pending = outcome(old.session.render(frame()))
  old.expire(); await pending
  const fresh = harness(), next = outcome(fresh.session.render(frame(2))); fresh.reply(result(fresh.posted[0].id))
  check('fresh worker/session succeeds after timed-out WASM worker', Boolean((await next).value) && old.terminated === 1 && fresh.terminated === 0)
  fresh.session.dispose()
}
{
  const controllerSource = await readFile(new URL('./presenter.ts', import.meta.url), 'utf8')
  const controllerCode = ts.transpileModule(controllerSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from (['"])\.\/backends\1/, `from '${backendUrl}'`)
    .replace(/from ['"]\.\.\/\.\.\/canvas-engine\/resourceBudget['"]/g, `from '${budgetUrl}'`)
  const { createVelloPresenter } = await import(`data:text/javascript;base64,${Buffer.from(controllerCode).toString('base64')}`)
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData')
  const listeners = new Set(), sessions = [], accepted = [], errors = [], paints = []
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener(_type, callback) { listeners.add(callback) }, removeEventListener(_type, callback) { listeners.delete(callback) } } })
  Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class { constructor(pixels, width, height) { assert.equal(pixels.byteLength, width * height * 4); this.pixels = pixels } } })
  const host = {
    children: [],
    append(canvas) { this.children.push(canvas); canvas.parentElement = this },
    replaceChild(canvas, old) { this.children[this.children.indexOf(old)] = canvas; old.parentElement = null; canvas.parentElement = this },
  }
  const turn = () => new Promise(resolve => setImmediate(resolve))
  let controller
  try {
    controller = createVelloPresenter(host, { accepted: receipt => accepted.push(receipt), error: receipt => errors.push(receipt) }, {
      createGpu: async () => { throw new Error('WEBGPU_UNAVAILABLE: transport-only integration fixture') },
      createCpu: () => { const h = harness(); sessions.push(h); return h.session },
      createCanvas: () => ({ parentElement: null, getContext() { return { putImageData(image) { paints.push(image) } } }, remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null } }),
      hidden: () => false, watchHealth: () => () => {},
    })
    controller.invalidate(frame())
    await turn()
    check('actual presenter submits fallback through guarded CPU session', sessions.length === 1 && sessions[0].posted.length === 1)
    sessions[0].expire(); await turn()
    check('CPU timeout reaches actual presenter error without claiming pixels', errors.length === 1 && accepted.length === 0 && paints.length === 0)
    controller.invalidate(frame(2)); await turn()
    check('timeout frees presenter busy state for a fresh CPU session', sessions.length === 2 && sessions[1].posted.length === 1)
    sessions[1].reply(result(sessions[1].posted[0].id)); await turn()
    check('fresh validated frame can present and claim current generation', accepted.length === 1 && accepted[0].generation === 2 && accepted[0].backend === 'cpu' && paints.length === 1)
    controller.invalidate(frame(3)); await turn()
    controller.invalidate(frame(4))
    sessions[1].expire(); await turn()
    check('obsolete CPU timeout cannot overwrite current diagnostics', errors.length === 1)
    check('obsolete CPU timeout starts newest pending work on fresh worker', sessions.length === 3 && sessions[2].posted.length === 1 && sessions[2].posted[0].frame.generation === 4)
    sessions[2].reply(result(sessions[2].posted[0].id)); await turn()
    check('newest pending generation survives stale terminal worker failure', accepted.length === 2 && accepted.at(-1).generation === 4 && paints.length === 2)
    controller.dispose(); controller = undefined
    check('integrated cleanup removes listeners and worker lifetime', listeners.size === 0 && sessions[2].terminated === 1)
  } finally {
    controller?.dispose()
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document
    if (previousImageData) Object.defineProperty(globalThis, 'ImageData', previousImageData); else delete globalThis.ImageData
  }
}
check('GPU module loading retry remains in actual source', source.includes('modulePromise = undefined; throw error'))

const imageRef = (extra = {}) => ({ key: 'disposable-cyan', revision: 1, epoch: 37, width: 1, height: 1, ...extra })
const imageFrame = (reference, images, generation = 1) => frame(generation, { snapshot: JSON.stringify({ schema: 'art-equation.display-list', schemaVersion: 2, resources: [reference], operations: [] }), ...(images === undefined ? {} : { images }) })
const imageReceipt = (id, references) => ({ ...result(id), metadata: { ...result(id).metadata, imageResources: { decoded: { references } } } })
{
  const h = harness({ realTransfer: true }), reference = imageRef(), original = new Uint8Array([20, 10, 0, 128]), expected = original.slice()
  const pending = outcome(h.session.render(imageFrame(reference, [{ reference, pixels: original }])))
  check('CPU image upload transfers a private copy and keeps frontend source attached', original.byteLength === 4 && h.transferLists[0].length === 1 && h.transferLists[0][0].byteLength === 0 && h.posted[0].frame.images[0].pixels.byteLength === 4)
  original[0] = 99
  check('submitted worker copy cannot be changed by caller mutation after posting', h.posted[0].frame.images[0].pixels[0] === expected[0])
  h.reply(imageReceipt(h.posted[0].id, [reference])); check('validated image resource receipt completes CPU frame', Boolean((await pending).value))
  const next = outcome(h.session.render(imageFrame(reference, undefined, 2)))
  check('known same-session image residency avoids a second upload', h.posted[1].frame.images.length === 0 && h.transferLists[1].length === 0)
  h.reply(imageReceipt(h.posted[1].id, [reference])); await next
  const missing = await outcome(h.session.render(imageFrame(imageRef({ revision: 2 }), undefined, 3)))
  check('new image revision needs a fresh upload before any worker post', /RESOURCE_NOT_READY/.test(missing.error?.message ?? '') && h.posted.length === 2)
  h.session.dispose()
  const fresh = harness(), stale = await outcome(fresh.session.render(imageFrame(reference, undefined)))
  check('new worker session cannot reuse residency from retired worker', /RESOURCE_NOT_READY/.test(stale.error?.message ?? '') && fresh.posted.length === 0 && fresh.timers.size === 0); fresh.session.dispose()
}
for (const [name, resources] of [
  ['non-array references', 'malformed'], ['null reference', [null]],
  ['wrong epoch', [imageRef({ epoch: 38 })]], ['unexpected identity', [imageRef({ key: 'unexpected' })]],
  ['duplicate reference', [imageRef(), imageRef()]], ['missing retained image', []],
]) {
  const h = harness(), reference = imageRef(), pixels = new Uint8Array([0, 0, 0, 255])
  let settled
  void outcome(h.session.render(imageFrame(reference, [{ reference, pixels }]))).then(value => { settled = value })
  let thrown
  try { h.reply(imageReceipt(h.posted[0].id, resources)) } catch (error) { thrown = error }
  await new Promise(resolve => setImmediate(resolve))
  const valid = !thrown && settled?.error instanceof Error && h.terminated === 1 && h.timers.size === 0
  h.session.dispose()
  check(`malformed ${name} resource receipt fails closed without stranded promise`, valid)
}
console.log(JSON.stringify({ passed: true, checks, scope: 'actual CPU session guards with injected worker transport/timers; no native/GPU pixel execution' }))


const retainedCalls=[];let retainedRevision=0
const retainedTransport=createRetainedTransport({load_retained_scene(json,expected){assert.equal(expected,retainedRevision);retainedCalls.push(['load',json]);return ++retainedRevision},patch_retained_scene(json,expected){assert.equal(expected,retainedRevision);if(JSON.parse(json).insert.some(x=>x.bad))throw Error('rejected');retainedCalls.push(['patch',json]);return ++retainedRevision}})
const retainedScene={schema:'art-equation.display-list',schemaVersion:2,sceneId:'a',revision:'1',environment:{colorSpace:'srgb',background:'#000000ff'},resources:[],operations:Array.from({length:100},(_,i)=>({id:String(i),value:i}))}
const retainedJson=JSON.stringify(retainedScene)
check('retained first scene loads',retainedTransport.sync(retainedJson).mode==='load')
check('camera same scene sends no bytes',retainedTransport.sync(retainedJson).bytes===0)
check('generation-only difference reuses retained revision',retainedTransport.sync(JSON.stringify({...retainedScene,revision:'99'})).revision===1)
retainedScene.operations[50].value=999
check('single edit uses patch',retainedTransport.sync(JSON.stringify(retainedScene)).mode==='patch')
const patch=JSON.parse(retainedCalls.at(-1)[1]);check('ordered range patch preserves neighbors',patch.start===50&&patch.delete_count===1&&patch.insert.length===1)
const invalid=structuredClone(retainedScene);invalid.operations[50].bad=true
assert.throws(()=>retainedTransport.sync(JSON.stringify(invalid)))
check('rejected patch preserves prior scene revision',retainedTransport.sync(JSON.stringify(retainedScene)).revision===2)
check('legacy scene uses original guarded renderer',retainedTransport.sync(JSON.stringify({schema:'art-equation.scene'})).mode==='legacy')

const {createFrameReferenceCache}=await import(registryUrl)
const resourceCache=createFrameReferenceCache(),resourceJson=JSON.stringify({schema:'art-equation.display-list',resources:[]})
const parseOriginal=JSON.parse;let sceneParses=0
JSON.parse=(...args)=>{sceneParses++;return parseOriginal(...args)}
try{const a=resourceCache.read(resourceJson);assert.equal(resourceCache.read(resourceJson),a);assert.equal(sceneParses,1);resourceCache.clear();resourceCache.read(resourceJson);assert.equal(sceneParses,2)}finally{JSON.parse=parseOriginal}
check('unchanged camera references parse once and clear forces validation',sceneParses===2)

const directCalls=[];let directRevision=0
const direct=createRetainedTransport({load_retained_scene(){return ++directRevision},patch_retained_scene(patch){directCalls.push(patch);return ++directRevision}})
const firstDirect={...retainedScene,operations:retainedScene.operations.map(op=>({...op}))}
const nextDirect={...firstDirect,operations:firstDirect.operations.map((op,i)=>i===2?{...op,value:1234}:op)}
const firstDirectJson=JSON.stringify(firstDirect),nextDirectJson=JSON.stringify(nextDirect)
let directParses=0;JSON.parse=(...args)=>{directParses++;return parseOriginal(...args)}
try{direct.sync(firstDirectJson,firstDirect);assert.equal(direct.sync(nextDirectJson,nextDirect).mode,'patch');direct.sync(nextDirectJson,nextDirect);assert.equal(directParses,0)}finally{JSON.parse=parseOriginal}
check('prepared object records drive patches without full-scene JSON parsing',directParses===0&&directCalls.length===1)
