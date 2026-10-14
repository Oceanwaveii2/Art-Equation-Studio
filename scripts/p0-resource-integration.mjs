import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'

// Actual main-thread backend/controller and actual budget. Worker/WASM/canvas
// lifetimes are controlled boundaries; no renderer pixels or native launch.
const paths = ['src/project-b/p0-surface/backends.ts', 'src/project-b/p0-surface/presenter.ts', 'src/canvas-engine/resourceBudget.ts', 'src/canvas-engine/decodedImageRegistry.ts']
const sources = await Promise.all(paths.map(path => readFile(path, 'utf8')))
const hashes = Object.fromEntries(paths.map((path, i) => [path, createHash('sha256').update(sources[i]).digest('hex')]))
const output = resolve(process.argv[2] || '../docs/engine-p0/2026-10-03/resource-acceptance/resource-integration-baseline')
await mkdir(output, { recursive: false })
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const budgetCode = compile(sources[2]), { CanvasResourceBudget } = await import(url(budgetCode))
const demandUrl=url(compile(await readFile('src/canvas-engine/imageDemand.ts','utf8')))
const atlasUrl=url(compile(await readFile('src/project-b/p0-surface/atlasPlan.ts','utf8')))
const diagnosticsUrl=url('export const metricSpan=()=>()=>{};export const recordMetric=()=>{}; // controlled telemetry boundary')
// Synthetic healthy allocation receipts exercise the real frontend boundary;
// they are controlled validator fixtures and never GPU/product qualification.
const healthyAllocation = { gpuAllocationStatus: 'checked', gpuAllocationFailureFlags: 0, gpuAllocationStatusBytes: 32 }
let sequence = 0
async function harness({ surface = 10_000, atlas = 10_000, retained = 10_000, total = 30_000, rendererOptions = {} } = {}) {
  const id = ++sequence, budget = new CanvasResourceBudget({ total, pools: { 'tile-surface': surface, 'tile-atlas': atlas, retained } })
  globalThis.__p0IntegrationBudget = budget
  const budgetUrl = url(`export const canvasResourceBudget=globalThis.__p0IntegrationBudget; // ${id}`)
  const registryUrl = url(compile(sources[3]).replace(/from ['"]\.\/imageDemand['"]/g,`from '${demandUrl}'`).replace(/from ['"]\.\/resourceBudget['"]/g, `from '${budgetUrl}'`))
  const renderers = []
  globalThis.__p0IntegrationRenderer = () => {
    const state = { initialized: 0, disposed: 0, freed: 0, prepared: 0, presented: 0, registered: 0, discarded: 0, references: [] }; renderers.push(state)
    return {
      async initialize() { state.initialized++; if (rendererOptions.initializeThrows) throw new Error('GPU initialization failure') },
      retain_images(json) { const required = JSON.parse(json); state.references = state.references.filter(r => required.some(n => n.key === r.key && n.revision === r.revision && n.epoch === r.epoch)); return JSON.stringify({ references: state.references }) },
      register_image(json) { state.registered++; state.references.push(JSON.parse(json)) },
      async prepare_snapshot(width, height) { state.prepared++; if (rendererOptions.prepareThrows) throw new Error('Rejected scene'); return rendererOptions.prepareJson ?? JSON.stringify({ width, height, ...(rendererOptions.prepareMetadata ?? healthyAllocation) }) },
      present_prepared() { state.presented++;return JSON.stringify({ width: 4, height: 3, ...healthyAllocation }) },
      discard_prepared() { state.discarded++ },
      resource_stats() { return JSON.stringify({ bytes: state.references.reduce((bytes, r) => bytes + r.width * r.height * 4, 0) }) },
      dispose() { state.disposed++; if (rendererOptions.disposeThrows) throw new Error('Disposal failed') },
      free() { state.freed++; if (rendererOptions.freeThrows) throw new Error('Free failed') },
      check_health() {}, destroy_device_for_recovery_test() {},
    }
  }
  const wasm = url(`const memory=new WebAssembly.Memory({initial:1,maximum:4});export default async()=>({memory});export class B4SurfaceRenderer{constructor(){return globalThis.__p0IntegrationRenderer()}} // ${id}`)
  const backend = url(compile(sources[0]).replace(/^import wasmUrl from [^\n]+$/m, 'const wasmUrl="test://controlled-wasm-boundary";')
    .replace(/from ['"]\.\.\/\.\.\/canvas-engine\/resourceBudget['"]/g, `from '${budgetUrl}'`)
    .replace(/from ['"]\.\.\/\.\.\/canvas-engine\/decodedImageRegistry['"]/g, `from '${registryUrl}'`)
    .replace(/from ['"]\.\/atlasPlan['"]/g, `from '${atlasUrl}'`)
    .replace(/from ['"]\.\.\/\.\.\/diagnostics\/performance['"]/g, `from '${diagnosticsUrl}'`)
    .replace(/import\(['"]\.\/generated\/p0_engine_wasm\.js['"]\)/g, `import('${wasm}')`))
  const { createCpuSession, createGpuSession } = await import(backend)
  const { createVelloPresenter } = await import(url(compile(sources[1]).replace(/from ['"]\.\/backends['"]/g, `from '${backend}'`).replace(/from ['"]\.\.\/\.\.\/canvas-engine\/resourceBudget['"]/g, `from '${budgetUrl}'`)))
  const timers = new Map(), posted = []; let terminated = 0
  const worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage(message) { posted.push(message) }, terminate() { terminated++ } }
  let nextTimer = 0
  const cpu = createCpuSession({ createWorker: () => worker, setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id }, clearTimeout(id) { timers.delete(id) } })
  const reply = (index, referenceList = undefined) => { const request = posted[index]; worker.onmessage?.({ data: { id: request.id, pixels: new Uint8Array(request.frame.width * request.frame.height * 4), metadata: { width: request.frame.width, height: request.frame.height, ...(referenceList ? { imageResources: { decoded: { references: referenceList } } } : {}) } } }) }
  return { budget, cpu, createGpuSession, createVelloPresenter, worker, posted, timers, renderers, reply, get terminated() { return terminated } }
}
const frame = (extra = {}) => ({ generation: 1, width: 4, height: 3, scale: 1, panX: 2, panY: 7, snapshot: '{"schema":"test"}', ...extra })
const reference = (key = 'a', width = 4, height = 4) => ({ key, width, height, revision: 1, epoch: 37 })
const imageFrame = (references, includeUploads = true, extra = {}) => frame({ snapshot: JSON.stringify({ schema: 'art-equation.display-list', schemaVersion: 2, resources: references, operations: [] }), ...(includeUploads ? { images: references.map(reference => ({ reference, pixels: new Uint8Array(reference.width * reference.height * 4) })) } : {}), ...extra })
const outcome = promise => promise.then(value => ({ value }), error => ({ error }))
const report = { schema: 'art-equation.resource-integration-acceptance', generatedAt: new Date().toISOString(), sourceHashes: hashes, tests: [], limitations: ['Actual production budget/backend/presenter with controlled workers, native WASM boundary and canvas. No physical GPU/CPU pixels, driver scratch, native runtime or full App production acceptance.'] }
async function test(name, run) { try { const details = await run(); report.tests.push({ name, passed: true, details }); console.log('PASS ' + name) } catch (error) { report.tests.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message) } }
await test('missing CPU image upload is refused before changing persistent reservations', async () => {
  const h = await harness(), before = h.budget.snapshot(); try { const receipt = await outcome(h.cpu.render(imageFrame([reference()], false))); assert(receipt.error); assert.equal(h.posted.length, 0); assert.equal(h.budget.snapshot().bytes, before.bytes); assert.equal(h.budget.snapshot().allocations, before.allocations) } finally { h.cpu.dispose() }
})
await test('CPU surface denial rolls back previously acquired image reservation', async () => {
  const h = await harness({ surface: 100 }), before = h.budget.snapshot(); try { const receipt = await outcome(h.cpu.render(imageFrame([reference()]))); assert(/BUDGET_EXCEEDED/.test(receipt.error?.message)); assert.equal(h.posted.length, 0); assert.equal(h.budget.snapshot().bytes, before.bytes) } finally { h.cpu.dispose() }
})
await test('concurrent disjoint CPU image requests reserve both outstanding resource sets', async () => {
  const h = await harness(), a = reference('a', 8, 8), b = reference('b', 1, 1); try { const first = outcome(h.cpu.render(imageFrame([a]))), second = outcome(h.cpu.render(imageFrame([b]))); assert.equal(h.posted.length, 2); assert(h.budget.snapshot().pools['tile-atlas'].bytes >= (8 * 8 + 1) * 4 * 2); h.reply(0, [a]); h.reply(1, [b]); const one = await first, two = await second; assert(one.value && two.value); one.value.release?.(); two.value.release?.() } finally { h.cpu.dispose() }
})
await test('invalid CPU dimensions cannot reserve bytes or post work', async () => {
  const h = await harness(); try { const receipt = await outcome(h.cpu.render(frame({ width: -1 }))); assert(receipt.error); assert.equal(h.budget.snapshot().bytes, 0); assert.equal(h.posted.length, 0) } finally { h.cpu.dispose() }
})
await test('worker crash releases reservations and outstanding transfer lifetime', async () => {
  const h = await harness(); const pending = outcome(h.cpu.render(imageFrame([reference()]))); assert(h.budget.snapshot().bytes > 0); h.worker.onerror({ message: 'controlled crash' }); assert((await pending).error); assert.equal(h.budget.snapshot().bytes, 0); assert.equal(h.budget.snapshot().allocations, 0); assert.equal(h.timers.size, 0)
})
await test('GPU surface admission occurs before GPU initialization', async () => {
  const h = await harness({ surface: 50 }); try { await assert.rejects(h.createGpuSession({ width: 4, height: 3 }), /BUDGET_EXCEEDED/); assert.equal(h.renderers[0].initialized, 0); assert.equal(h.renderers[0].freed, 1); assert.equal(h.budget.snapshot().bytes, 0) } finally { h.cpu.dispose() }
})
await test('failed GPU initialization releases admitted frame lifetime', async () => {
  const h = await harness({ rendererOptions: { initializeThrows: true } }); try { await assert.rejects(h.createGpuSession({ width: 4, height: 3 }), /initialization/); assert.equal(h.budget.snapshot().bytes, 0); assert.equal(h.renderers[0].disposed, 1); assert.equal(h.renderers[0].freed, 1) } finally { h.cpu.dispose() }
})
await test('GPU disposal failure cannot strand shared reservations', async () => {
  const h = await harness({ rendererOptions: { disposeThrows: true } }); let gpu; try { gpu = await h.createGpuSession({ width: 4, height: 3 }); try { gpu.dispose() } catch {} assert.equal(h.budget.snapshot().bytes, 0); assert.equal(h.renderers[0].freed, 1) } finally { h.cpu.dispose() }
})
await test('GPU missing upload cannot leave an unused atlas reserve', async () => {
  const h = await harness({ atlas: 60_000_000, total: 60_100_000 }); let gpu; try { gpu = await h.createGpuSession({ width: 4, height: 3 }); const before = h.budget.snapshot().bytes; await assert.rejects(gpu.prepare(imageFrame([reference()], false)), /RESOURCE_NOT_READY/); assert.equal(h.renderers[0].registered, 0); assert.equal(h.budget.snapshot().bytes, before) } finally { gpu?.dispose(); h.cpu.dispose() }
})

const turn = () => new Promise(resolve => setImmediate(resolve))
async function until(test) { for (let i = 0; i < 40; i++) { if (test()) return; await turn() } throw new Error('Controller did not reach expected isolated state') }
function presenterFixture(h, useActualGpu = false) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), originalImage = Object.getOwnPropertyDescriptor(globalThis, 'ImageData')
  const accepted = [], errors = [], states = [], preparing = [], settled = [], canvases = [], listeners = new Set()
  globalThis.document = { addEventListener(_type, callback) { listeners.add(callback) }, removeEventListener(_type, callback) { listeners.delete(callback) } }
  globalThis.ImageData = class { constructor(data, width, height) { assert.equal(data.byteLength, width * height * 4); this.data = data; this.width = width; this.height = height } }
  const host = { children: [], append(canvas) { canvas.parentElement = this; this.children.push(canvas) }, replaceChild(canvas, old) { const index = this.children.indexOf(old); assert(index >= 0); this.children[index] = canvas; old.parentElement = null; canvas.parentElement = this } }
  const controller = h.createVelloPresenter(host, { accepted: result => accepted.push(result), error: result => errors.push(result), state: result => states.push(result), preparing: generation => preparing.push(generation), settled: generation => settled.push(generation) }, {
    createGpu: useActualGpu ? h.createGpuSession : async () => { throw new Error('WEBGPU_UNAVAILABLE: controlled boundary') }, createCpu: () => h.cpu,
    createCanvas: () => { const canvas = { width: 300, height: 150, parentElement: null, paints: 0, getContext() { return { putImageData() { canvas.paints++ } } }, remove() { if (this.parentElement) { const index = this.parentElement.children.indexOf(this); if (index >= 0) this.parentElement.children.splice(index, 1); this.parentElement = null } } }; canvases.push(canvas); return canvas },
    hidden: () => false, watchHealth: () => () => {},
  })
  return { controller, accepted, errors, states, preparing, settled, host, canvases, close() { controller.dispose(); if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document; if (originalImage) Object.defineProperty(globalThis, 'ImageData', originalImage); else delete globalThis.ImageData } }
}
for (const [name, options, expected] of [
  ['failed coarse allocation', { prepareMetadata: { ...healthyAllocation, gpuAllocationFailureFlags: 4 } }, 'GPU_RENDER_CAPACITY_EXCEEDED'],
  ['missing allocation receipt', { prepareMetadata: {} }, 'GPU_RENDER_STATUS_UNAVAILABLE'],
  ['malformed allocation JSON', { prepareJson: '{broken' }, 'GPU_RENDER_STATUS_UNAVAILABLE'],
]) {
  await test(`${name} cannot publish GPU ownership and reaches actual CPU fallback`, async () => {
    const h = await harness({ rendererOptions: options }), ui = presenterFixture(h, true)
    try {
      ui.controller.invalidate(frame()); await until(() => h.posted.length === 1)
      assert.equal(h.renderers[0].presented, 0)
      assert.equal(ui.accepted.length, 0)
      assert.equal(ui.host.children.length, 0)
      assert(h.renderers[0].discarded >= 2)
      assert.equal(h.renderers[0].disposed, 1)
      h.reply(0); await until(() => ui.accepted.length === 1)
      assert.equal(ui.accepted[0].backend, 'cpu')
      assert(ui.states.some(value => value.state === 'fallback' && value.reason?.includes(expected)))
      assert.equal(ui.errors.length, 0)
    } finally { ui.close() }
    assert.equal(h.budget.snapshot().bytes, 0)
  })
}
await test('GPU setup fallback holds generation until CPU transport settles', async () => {
  const h = await harness(), ui = presenterFixture(h); try {
    ui.controller.invalidate(frame()); await until(() => h.posted.length === 1)
    assert.deepEqual(ui.preparing, [1, 1], 'both GPU attempt and CPU fallback report active preparation')
    assert.deepEqual(ui.settled, [], 'GPU rejection must not retire the queued/running CPU owner')
    h.reply(0); await until(() => ui.accepted.length === 1); await turn()
    assert.deepEqual(ui.settled, [1]); assert.equal(ui.accepted[0].backend, 'cpu')
  } finally { ui.close() }
})
await test('superseded CPU fallback retains preparation until stale output is consumed', async () => {
  const h = await harness(), ui = presenterFixture(h); try {
    ui.controller.invalidate(frame()); await until(() => h.posted.length === 1)
    ui.controller.invalidateGeneration(2)
    assert.deepEqual(ui.settled, [], 'invalidation cannot release an active CPU image/snapshot owner')
    h.reply(0); await until(() => ui.settled.length === 1)
    assert.deepEqual(ui.settled, [1]); assert.equal(ui.accepted.length, 0)
  } finally { ui.close() }
})
await test('removing same-generation recovery queue cannot retire active fallback transport', async () => {
  const h = await harness({surface:1000}), ui = presenterFixture(h, true); try {
    ui.controller.invalidate(frame()); await until(() => ui.accepted.length === 1); await turn()
    assert.deepEqual(ui.settled, [1])
    ui.controller.injectFaultForTest('memory'); await until(() => h.posted.length === 1)
    assert.equal(ui.preparing.length, 3, 'accepted-frame fault retry and CPU fallback are tracked again')
    assert.deepEqual(ui.settled, [1])
    ui.controller.recoverGpu(); ui.controller.invalidateGeneration(2)
    assert.deepEqual(ui.settled, [1], 'discarding queued recovery must preserve the active CPU owner')
    h.reply(0); await until(() => ui.settled.length === 2)
    assert.deepEqual(ui.settled, [1, 1]); assert.equal(ui.accepted.length, 1)
    assert.equal(ui.accepted[0].backend, 'gpu', 'obsolete fallback never changes accepted pixels')
  } finally { ui.close() }
})
await test('settled CPU output stays charged after worker retirement until caller consumes it', async () => {
  const h = await harness(); const pending = h.cpu.render(frame()); h.reply(0); const output = await pending; h.cpu.dispose(); assert.equal(h.budget.snapshot().bytes, 4 * 3 * 4); output.release?.(); output.release?.(); assert.equal(h.budget.snapshot().bytes, 0); assert.equal(h.budget.snapshot().allocations, 0)
})
await test('CPU renderer error retires all pending work and releases private copies', async () => {
  const h = await harness(), a = outcome(h.cpu.render(imageFrame([reference('a')]))), b = outcome(h.cpu.render(imageFrame([reference('b')]))); h.worker.onmessage({ data: { id: h.posted[0].id, error: 'RESOURCE_NOT_READY: partial registration' } }); assert((await a).error && (await b).error); assert.equal(h.terminated, 1); assert.equal(h.budget.snapshot().bytes, 0); assert.equal(h.timers.size, 0)
})
await test('GPU budget fallback scales backing camera and preserves original CSS capture', async () => {
  const h = await harness({ surface: 200 }), ui = presenterFixture(h, true), original = frame(); try {
    ui.controller.invalidate(original); await until(() => ui.accepted.length === 1); assert.equal(ui.accepted[0].backend, 'gpu'); assert.equal(h.budget.snapshot().bytes, 96)
    ui.controller.injectFaultForTest('memory'); await until(() => h.posted.length === 1); assert.equal(ui.host.children.length, 1); assert.equal(ui.accepted.length, 1)
    const render = h.posted[0].frame, factor = render.scale / original.scale; assert(factor < 1 && factor >= .25); assert.equal(render.panX, original.panX * factor); assert.equal(render.panY, original.panY * factor); assert.equal(render.width, Math.floor(original.width * factor)); assert.equal(render.height, Math.floor(original.height * factor))
    h.reply(0); await until(() => ui.accepted.length === 2); assert.equal(ui.accepted[1].backend, 'cpu'); assert.equal(ui.accepted[1].frame, original); assert.equal(ui.accepted[1].metadata.requestedWidth, original.width); assert.equal(ui.host.children.length, 1); assert(h.budget.snapshot().bytes <= 200)
  } finally { ui.close() } assert.equal(h.budget.snapshot().bytes, 0)
})
await test('stale CPU output and unused bitmap reservations retire without publication', async () => {
  const h = await harness(), ui = presenterFixture(h); try { ui.controller.invalidate(frame()); await until(() => h.posted.length === 1); ui.controller.invalidateGeneration(2); h.reply(0); await turn(); await turn(); assert.equal(ui.accepted.length, 0); assert.equal(h.budget.snapshot().bytes, 0); assert.equal(ui.host.children.length, 0) } finally { ui.close() }
})
await test('worker failure keeps the last visible CPU bitmap charged independently', async () => {
  const h = await harness(), ui = presenterFixture(h); try { ui.controller.invalidate(frame()); await until(() => h.posted.length === 1); h.reply(0); await until(() => ui.accepted.length === 1); assert.equal(h.budget.snapshot().bytes, 48); h.worker.onerror({ message: 'controlled idle worker crash' }); ui.controller.invalidate(frame({ generation: 2 })); await until(() => ui.errors.length === 1); assert.equal(ui.accepted.length, 1); assert.equal(ui.host.children.length, 1); assert.equal(h.budget.snapshot().bytes, 48) } finally { ui.close() } assert.equal(h.budget.snapshot().bytes, 0)
})
await test('old visible CPU bitmap pressure admits a smaller replacement that fits simultaneously', async () => {
  const h = await harness({ surface: 1024 }), ui = presenterFixture(h); let pressure; try { ui.controller.invalidate(frame({ width: 8, height: 8 })); await until(() => h.posted.length === 1); h.reply(0); await until(() => ui.accepted.length === 1); assert.equal(h.budget.snapshot().bytes, 256); pressure = h.budget.acquire({ owner: {}, key: 'independent-pinned-surface', pool: 'tile-surface', bytes: 700, pinned: true }); assert(pressure); ui.controller.invalidate(frame({ generation: 2, width: 8, height: 8 })); await until(() => h.posted.length > 1 || ui.errors.length > 0); assert.equal(ui.errors.length, 0, '2x2 CPU replacement fits alongside retained8x8 bitmap and700bytes pressure'); assert(h.posted[1].frame.width >= 2 && h.posted[1].frame.width <= 2); h.reply(1); await until(() => ui.accepted.length === 2); assert.equal(ui.accepted[1].generation, 2) } finally { pressure?.release(); ui.close() } assert.equal(h.budget.snapshot().bytes, 0)
})

await test('two pending CPU sizes reserve the largest worker and each independent output', async () => {
  const h = await harness({ surface: 2000 }), a = outcome(h.cpu.render(frame({ width: 8, height: 8 }))), b = outcome(h.cpu.render(frame({ generation: 2, width: 2, height: 2 }))); try { assert.equal(h.posted.length, 2); assert(h.budget.snapshot().pools['tile-surface'].bytes >= 64 * 8 + (64 + 4) * 4); h.reply(0); h.reply(1); const one = await a, two = await b; assert(one.value && two.value); one.value.release?.(); two.value.release?.(); assert.equal(h.budget.snapshot().bytes, 0) } finally { h.cpu.dispose() }
})
await test('insufficient CPU fallback preserves the valid GPU frame and its charge', async () => {
  const h = await harness({ surface: 100 }), ui = presenterFixture(h, true); try { ui.controller.invalidate(frame()); await until(() => ui.accepted.length === 1); const canvas = ui.accepted[0].canvas; ui.controller.injectFaultForTest('memory'); await until(() => ui.errors.length === 1); assert.equal(h.posted.length, 0); assert.equal(ui.accepted.length, 1); assert.equal(ui.host.children[0], canvas); assert.equal(h.budget.snapshot().bytes, 96); assert(/BUDGET_EXCEEDED/.test(ui.errors[0].error)) } finally { ui.close() } assert.equal(h.budget.snapshot().bytes, 0)
})
await test('GPU recovery publishes atomically and retires the independent CPU bitmap', async () => {
  const h = await harness({ surface: 1000 }), ui = presenterFixture(h, true); try { ui.controller.invalidate(frame()); await until(() => ui.accepted.length === 1); ui.controller.injectFaultForTest('memory'); await until(() => h.posted.length === 1); h.reply(0); await until(() => ui.accepted.length === 2); assert.equal(ui.accepted[1].backend, 'cpu'); assert.equal(h.budget.snapshot().bytes, 48); ui.controller.recoverGpu(); await until(() => ui.accepted.length === 3); assert.equal(ui.accepted[2].backend, 'gpu'); assert.equal(ui.host.children.length, 1); assert.equal(h.budget.snapshot().bytes, 96); assert.equal(ui.accepted[1].canvas.width, 0); assert.equal(ui.accepted[1].canvas.height, 0) } finally { ui.close() } assert.equal(h.budget.snapshot().bytes, 0); assert.equal(h.budget.snapshot().allocations, 0)
})
report.passed = report.tests.every(test => test.passed)
await writeFile(resolve(output, 'RESOURCE_INTEGRATION_ACCEPTANCE.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ passed: report.passed, checks: report.tests.length, failed: report.tests.filter(test => !test.passed).length, output }))
if (!report.passed) process.exitCode = 1
