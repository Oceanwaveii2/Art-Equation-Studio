import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Execute the actual controller. Only real backend loading is replaced; its
// generation, lifetime, pending-work and DOM publication code remain intact.
const source = await readFile(new URL('./presenter.ts', import.meta.url), 'utf8')
const stubUrl = `data:text/javascript;base64,${Buffer.from('export const createGpuSession=()=>{throw new Error("Inject GPU factory")}; export const createCpuSession=()=>{throw new Error("Inject CPU factory")};').toString('base64')}`
const budgetSource = await readFile(new URL('../../canvas-engine/resourceBudget.ts', import.meta.url), 'utf8')
const budgetCode = ts.transpileModule(budgetSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const budgetUrl = `data:text/javascript;base64,${Buffer.from(budgetCode).toString('base64')}`
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from (['"])\.\/backends\1/, `from '${stubUrl}'`)
  .replace(/from ['"]\.\.\/\.\.\/canvas-engine\/resourceBudget['"]/g, `from '${budgetUrl}'`)
const { createVelloPresenter } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const turn = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const frame = generation => ({ generation, snapshot: JSON.stringify({ revision: generation }), width: 4, height: 3, scale: 1, panX: generation * 2, panY: 7 })

function harness() {
  const listeners = new Map()
  const document = {
    addEventListener(name, callback) { let values = listeners.get(name); if (!values) listeners.set(name, values = new Set()); values.add(callback) },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback) },
  }
  globalThis.document = document
  globalThis.ImageData = class {
    constructor(data, width, height) { assert.equal(data.length, width * height * 4); this.data = data; this.width = width; this.height = height }
  }
  const events = [], accepted = [], errors = [], states = [], gpus = [], cpus = [], canvases = []
  const setupPlans = [], preparePlans = [], cpuPlans = [], healthPlans = []
  const healthWatchers = { created: 0, stopped: 0, active: 0, maxActive: 0, callbacks: [] }
  let hidden = false
  const host = {
    children: [], replacements: 0, maxAttached: 0,
    append(canvas) { canvas.remove(); this.children.push(canvas); canvas.parentElement = this; this.maxAttached = Math.max(this.maxAttached, this.children.length) },
    replaceChild(canvas, old) { const index = this.children.indexOf(old); assert.notEqual(index, -1); assert.equal(canvas.parentElement, null); this.children[index] = canvas; old.parentElement = null; canvas.parentElement = this; this.replacements++; this.maxAttached = Math.max(this.maxAttached, this.children.length) },
  }
  function createCanvas() {
    const canvas = {
      id: canvases.length + 1, width: 300, height: 150, parentElement: null, pixels: null, paint: null, paints: 0,
      remove() { if (this.parentElement) { const parent = this.parentElement; parent.children.splice(parent.children.indexOf(this), 1); this.parentElement = null } },
      getContext(kind) { assert.equal(kind, '2d'); return { putImageData(image) { canvas.pixels = image.data.slice(); canvas.paint = { backend: 'cpu', generation: image.data[0] }; canvas.paints++; events.push(`cpu-paint:${image.data[0]}`) } } },
    }
    canvases.push(canvas)
    return canvas
  }
  function gpuSession(canvas) {
    let borrowing = false, prepared, closed = false, destroyed = false
    const session = {
      canvas, preparations: [], presentations: [], discards: 0, disposals: 0, healthChecks: 0,
      async prepare(input) {
        assert(!closed, 'cannot prepare a freed GPU renderer'); assert(!borrowing, 'GPU prepares must serialize')
        borrowing = true; this.preparations.push(input.generation)
        const plan = preparePlans.shift()
        try {
          if (destroyed) throw new Error('DEVICE_LOST: controlled device destruction')
          if (plan instanceof Error) throw plan
          if (plan) await plan.promise
          prepared = input
          return { width: input.width, height: input.height, generation: input.generation }
        } finally { borrowing = false }
      },
      present() {
        assert(!borrowing, 'present cannot overlap a wasm mutable borrow'); assert(!closed); assert(prepared)
        this.presentations.push(prepared.generation); canvas.paint = { backend: 'gpu', generation: prepared.generation }
        events.push(`gpu-present:${prepared.generation}`)
        const metadata = { width: prepared.width, height: prepared.height, generation: prepared.generation }
        prepared = undefined
        return metadata
      },
      discard() { assert(!borrowing, 'discard cannot overlap a wasm mutable borrow'); assert(!closed); prepared = undefined; this.discards++ },
      dispose() { assert(!borrowing, 'dispose/free must wait for the async wasm mutable borrow'); assert(!closed, 'GPU session freed twice'); closed = true; this.disposals++ },
      destroyForTest() { assert(!borrowing); destroyed = true },
      checkHealth() {
        assert(!borrowing, 'health check cannot overlap a wasm mutable borrow'); assert(!closed, 'cannot inspect freed GPU resources')
        this.healthChecks++
        if (destroyed) throw new Error('DEVICE_LOST: controlled idle device destruction')
        const failure = healthPlans.shift()
        if (failure) throw failure
      },
      get borrowing() { return borrowing },
    }
    gpus.push(session)
    return session
  }
  function createCpu() {
    let closed = false
    const active = new Set()
    const session = {
      renders: [], disposals: 0,
      async render(input) {
        assert(!closed, 'cannot render in a disposed CPU worker'); this.renders.push(input.generation)
        const stop = deferred(), plan = cpuPlans.shift(); active.add(stop)
        try {
          if (plan instanceof Error) throw plan
          await Promise.race([plan?.promise ?? Promise.resolve(), stop.promise])
          return { pixels: new Uint8Array(input.width * input.height * 4).fill(input.generation), metadata: { width: input.width, height: input.height, backend: 'vello_cpu' } }
        } finally { active.delete(stop) }
      },
      dispose() { if (closed) return; closed = true; this.disposals++; for (const stop of active) stop.reject(new Error('CPU worker disposed')) },
    }
    cpus.push(session)
    return session
  }
  const presenter = createVelloPresenter(host, {
    accepted(result) { accepted.push(result); events.push(`accepted:${result.backend}:${result.generation}`) },
    error(result) { errors.push(result) },
    state(result) { states.push(result) },
  }, {
    createCanvas, createCpu, hidden: () => hidden,
    watchHealth(check) {
      healthWatchers.created++; healthWatchers.active++
      healthWatchers.maxActive = Math.max(healthWatchers.maxActive, healthWatchers.active)
      healthWatchers.callbacks.push(check)
      return () => { healthWatchers.stopped++; healthWatchers.active-- }
    },
    async createGpu(canvas) {
      const plan = setupPlans.shift()
      if (plan instanceof Error) throw plan
      const session = gpuSession(canvas)
      if (plan) await plan.promise
      return session
    },
  })
  return {
    presenter, host, accepted, errors, states, events, gpus, cpus, canvases, setupPlans, preparePlans, cpuPlans, healthPlans, healthWatchers,
    tickHealth() { for (const callback of healthWatchers.callbacks) callback() },
    setHidden(value) { hidden = value; for (const callback of listeners.get('visibilitychange') ?? []) callback() },
    async close() { presenter.dispose(); await turn(); assert.equal(host.children.length, 0); assert.equal(listeners.get('visibilitychange')?.size ?? 0, 0); assert.equal(healthWatchers.active, 0); assert.equal(healthWatchers.stopped, healthWatchers.created) },
  }
}

const passed = []
async function check(name, test) { await test(); passed.push(name); process.stdout.write(`PASS ${name}\n`) }

await check('generation invalidation before the next render prevents physical GPU presentation', async () => {
  const h = harness(), first = deferred()
  h.preparePlans.push(first); h.presenter.invalidate(frame(1)); await turn()
  assert.deepEqual(h.gpus[0].preparations, [1])
  h.presenter.invalidateGeneration(2)
  first.resolve(); await turn()
  assert.deepEqual(h.gpus[0].presentations, []); assert.equal(h.accepted.length, 0); assert.equal(h.host.children.length, 0)
  h.presenter.invalidate(frame(2)); await turn()
  assert.deepEqual(h.gpus[0].presentations, [2]); assert.deepEqual(h.accepted.map(value => value.generation), [2])
  const present = h.events.indexOf('gpu-present:2')
  assert.equal(h.events[present + 1], 'accepted:gpu:2', 'ownership callback follows present without another asynchronous operation')
  await h.close()
})

await check('busy rendering retains only the newest pending scene and camera', async () => {
  const h = harness(), first = deferred(), latest = deferred()
  h.preparePlans.push(first, latest); h.presenter.invalidate(frame(1)); await turn()
  h.presenter.invalidate(frame(2)); h.presenter.invalidate(frame(3)); first.resolve(); await turn()
  assert.deepEqual(h.gpus[0].preparations, [1, 3]); assert.deepEqual(h.gpus[0].presentations, [])
  latest.resolve(); await turn()
  assert.deepEqual(h.gpus[0].presentations, [3]); assert.deepEqual(h.accepted.map(value => value.frame.panX), [6])
  assert.equal(h.host.maxAttached, 1)
  await h.close()
})

await check('disposal removes the canvas immediately but waits for the wasm borrow before freeing GPU', async () => {
  const h = harness()
  h.presenter.invalidate(frame(1)); await turn(); assert.equal(h.host.children.length, 1)
  const pending = deferred(); h.preparePlans.push(pending); h.presenter.invalidate(frame(2)); await turn()
  assert.equal(h.gpus[0].borrowing, true)
  h.presenter.dispose()
  assert.equal(h.host.children.length, 0); assert.equal(h.gpus[0].disposals, 0)
  pending.resolve(); await turn()
  assert.equal(h.gpus[0].disposals, 1); assert.deepEqual(h.gpus[0].presentations, [1]); assert.deepEqual(h.accepted.map(value => value.generation), [1])
  await h.close()
})

await check('initialization resolving after unmount cannot attach a canvas and is freed', async () => {
  const h = harness(), initialization = deferred()
  h.setupPlans.push(initialization); h.presenter.invalidate(frame(1)); await turn()
  h.presenter.dispose(); assert.equal(h.gpus[0].disposals, 0)
  initialization.resolve(); await turn()
  assert.equal(h.gpus[0].disposals, 1); assert.equal(h.gpus[0].preparations.length, 0); assert.equal(h.accepted.length, 0); assert.equal(h.host.children.length, 0)
  await h.close()
})

await check('obsolete GPU resource failure renders the newest state through the actual CPU session', async () => {
  const h = harness(), first = deferred()
  h.preparePlans.push(first); h.presenter.invalidate(frame(1)); await turn()
  h.presenter.invalidate(frame(2)); first.reject(new Error('GPU_OUT_OF_MEMORY')); await turn()
  assert.equal(h.cpus.length, 1); assert.deepEqual(h.cpus[0].renders, [2]); assert.equal(h.gpus[0].disposals, 1)
  assert.deepEqual(h.gpus[0].presentations, []); assert.deepEqual(h.accepted.map(value => [value.backend, value.generation]), [['cpu', 2]])
  assert.deepEqual(h.host.children[0].paint, { backend: 'cpu', generation: 2 }); assert.equal(h.errors.length, 0)
  await h.close()
})

for (const failure of ['GPU_RENDER_CAPACITY_EXCEEDED', 'GPU_RENDER_STATUS_UNAVAILABLE']) {
  await check(`${failure} prevents GPU publication and recovers the newest generation`, async () => {
    const h = harness(), first = deferred()
    h.preparePlans.push(first); h.presenter.invalidate(frame(1)); await turn()
    h.presenter.invalidate(frame(2)); h.presenter.invalidate(frame(3))
    first.reject(new Error(failure)); await turn()
    assert.deepEqual(h.gpus[0].presentations, [])
    assert.equal(h.gpus[0].disposals, 1)
    assert.deepEqual(h.cpus[0].renders, [3])
    assert.deepEqual(h.accepted.map(value => [value.backend, value.generation]), [['cpu', 3]])
    assert.deepEqual(h.host.children[0].paint, { backend: 'cpu', generation: 3 })
    assert.equal(h.errors.length, 0)
    assert(h.states.some(value => value.state === 'fallback' && value.reason.includes(failure)))
    await h.close()
  })
}

await check('obsolete scene input errors neither switch backend nor overwrite current diagnostics', async () => {
  const h = harness(), first = deferred()
  h.preparePlans.push(first); h.presenter.invalidate(frame(1)); await turn()
  h.presenter.invalidate(frame(2)); first.reject(new Error('SCENE_UNSUPPORTED: unsupported path input')); await turn()
  assert.equal(h.cpus.length, 0); assert.equal(h.errors.length, 0)
  assert.deepEqual(h.gpus[0].presentations, [2]); assert.deepEqual(h.accepted.map(value => value.generation), [2])
  await h.close()
})

await check('failed GPU recovery keeps CPU pixels attached until a successful CPU replacement', async () => {
  const h = harness()
  h.setupPlans.push(new Error('WebGPU setup unavailable'))
  h.presenter.invalidate(frame(1)); await turn()
  const original = h.host.children[0]; assert.equal(original.paint.backend, 'cpu')
  const retry = deferred(); h.cpuPlans.push(retry); h.setupPlans.push(new Error('GPU recovery setup failed'))
  h.presenter.recoverGpu(); await turn()
  assert.equal(h.host.children[0], original); assert.equal(original.paint.generation, 1); assert.equal(h.accepted.length, 1)
  retry.resolve(); await turn()
  assert.equal(h.host.children[0], original); assert.equal(h.accepted.at(-1).backend, 'cpu'); assert.equal(h.host.maxAttached, 1)
  h.presenter.invalidate(frame(2)); await turn()
  assert.deepEqual(h.host.children[0].paint, { backend: 'cpu', generation: 2 })
  await h.close()
})

await check('pause prevents an in-flight commit and resume renders only the newest state', async () => {
  const h = harness(), first = deferred()
  h.preparePlans.push(first); h.presenter.invalidate(frame(1)); await turn()
  h.presenter.setPaused(true); first.resolve(); await turn()
  assert.equal(h.accepted.length, 0); assert.deepEqual(h.gpus[0].presentations, [])
  h.presenter.invalidate(frame(2)); await turn(); assert.deepEqual(h.gpus[0].preparations, [1])
  h.presenter.setPaused(false); await turn()
  assert.deepEqual(h.gpus[0].preparations, [1, 2]); assert.deepEqual(h.gpus[0].presentations, [2])
  await h.close()
})

await check('document visibility prevents publication and resumes the latest frame', async () => {
  const h = harness(), first = deferred()
  h.preparePlans.push(first); h.presenter.invalidate(frame(1)); await turn()
  h.setHidden(true); first.resolve(); await turn(); assert.equal(h.accepted.length, 0)
  h.presenter.invalidate(frame(2)); await turn(); assert.deepEqual(h.gpus[0].preparations, [1])
  h.setHidden(false); await turn(); assert.deepEqual(h.gpus[0].presentations, [2])
  await h.close()
})

await check('GPU recovery epoch rejects CPU work from the previous backend lifetime', async () => {
  const h = harness()
  h.setupPlans.push(new Error('Initial WebGPU setup unavailable')); h.presenter.invalidate(frame(1)); await turn()
  const displayedCpu = h.host.children[0], oldCpu = deferred(), recoveryGpu = deferred()
  h.cpuPlans.push(oldCpu); h.presenter.invalidate(frame(2)); await turn()
  h.preparePlans.push(recoveryGpu); h.presenter.recoverGpu(); oldCpu.resolve(); await turn()
  assert.deepEqual(h.accepted.map(value => [value.backend, value.generation]), [['cpu', 1]])
  assert.equal(displayedCpu.paints, 1, 'obsolete CPU receipt must not write into the displayed canvas')
  assert.equal(h.host.children[0], displayedCpu); assert.deepEqual(h.gpus[0].preparations, [2])
  recoveryGpu.resolve(); await turn()
  assert.deepEqual(h.accepted.map(value => [value.backend, value.generation]), [['cpu', 1], ['gpu', 2]])
  assert.equal(h.host.children.length, 1); assert.equal(h.host.replacements, 1)
  await h.close()
})

await check('normal frames retain one canvas and backend candidates replace it only after acceptance', async () => {
  const h = harness()
  h.presenter.invalidate(frame(1)); await turn(); const firstCanvas = h.host.children[0]
  h.presenter.invalidate(frame(2)); await turn()
  assert.equal(h.host.children[0], firstCanvas); assert.equal(h.host.replacements, 0)
  const cpuPending = deferred(); h.cpuPlans.push(cpuPending); h.presenter.injectFaultForTest('memory'); await turn()
  assert.equal(h.host.children[0], firstCanvas); assert.equal(h.host.children.length, 1); assert.equal(h.gpus[0].disposals, 0)
  cpuPending.resolve(); await turn(); const cpuCanvas = h.host.children[0]
  assert.notEqual(cpuCanvas, firstCanvas); assert.equal(h.host.replacements, 1); assert.equal(h.gpus[0].disposals, 1)
  const gpuPending = deferred(); h.preparePlans.push(gpuPending); h.presenter.recoverGpu(); await turn()
  assert.equal(h.host.children[0], cpuCanvas); assert.equal(h.host.children.length, 1)
  gpuPending.resolve(); await turn()
  assert.notEqual(h.host.children[0], cpuCanvas); assert.equal(h.host.replacements, 2); assert.equal(h.host.maxAttached, 1)
  await h.close()
})

await check('paused GPU device failure selects CPU without publishing until resume', async () => {
  const h = harness()
  h.presenter.invalidate(frame(1)); await turn()
  const pending = deferred(); h.preparePlans.push(pending); h.presenter.invalidate(frame(2)); await turn()
  h.presenter.setPaused(true); pending.reject(new Error('DEVICE_LOST')); await turn()
  assert.equal(h.cpus.length, 1); assert.deepEqual(h.cpus[0].renders, [])
  assert.deepEqual(h.accepted.map(value => [value.backend, value.generation]), [['gpu', 1]])
  h.presenter.setPaused(false); await turn()
  assert.deepEqual(h.accepted.map(value => [value.backend, value.generation]), [['gpu', 1], ['cpu', 2]])
  await h.close()
})

await check('failed CPU session is disposed and a later valid request creates a fresh worker', async () => {
  const h = harness()
  h.setupPlans.push(new Error('WebGPU unavailable')); h.cpuPlans.push(new Error('CPU worker failed: controlled crash'))
  h.presenter.invalidate(frame(1)); await turn()
  assert.equal(h.errors.length, 1); assert.equal(h.cpus[0].disposals, 1); assert.equal(h.accepted.length, 0)
  h.presenter.invalidate(frame(2)); await turn()
  assert.equal(h.cpus.length, 2); assert.deepEqual(h.cpus[1].renders, [2])
  assert.deepEqual(h.accepted.map(value => [value.backend, value.generation]), [['cpu', 2]])
  await h.close()
})

await check('idle GPU health loss renders the unchanged current frame in CPU without new input', async () => {
  const h = harness()
  h.presenter.invalidate(frame(7)); await turn()
  h.healthPlans.push(new Error('DEVICE_LOST: spontaneous idle failure'))
  h.tickHealth(); await turn()
  assert.equal(h.gpus[0].healthChecks, 1)
  assert.deepEqual(h.cpus[0].renders, [7])
  assert.deepEqual(h.accepted.map(value => [value.backend, value.generation, value.frame.panX]), [['gpu', 7, 14], ['cpu', 7, 14]])
  assert.equal(h.host.maxAttached, 1); assert.equal(h.healthWatchers.created, 1)
  // CPU frames and recovery cannot accumulate polling observers or inspect a
  // retired GPU. The same presenter lifetime still has one active watcher.
  h.tickHealth(); assert.equal(h.gpus[0].healthChecks, 1)
  h.presenter.recoverGpu(); await turn(); h.presenter.invalidate(frame(8)); await turn()
  assert.equal(h.healthWatchers.active, 1); assert.equal(h.healthWatchers.maxActive, 1); assert.equal(h.healthWatchers.created, 1)
  h.tickHealth(); assert.equal(h.gpus[1].healthChecks, 1)
  await h.close()
  const cpuCount = h.cpus.length, acceptedCount = h.accepted.length
  h.tickHealth(); await turn()
  assert.equal(h.cpus.length, cpuCount); assert.equal(h.accepted.length, acceptedCount); assert.equal(h.gpus[1].healthChecks, 1)
})

await check('queued health callbacks skip an active mutable borrow and cannot recover after disposal', async () => {
  const h = harness(), pending = deferred()
  h.preparePlans.push(pending); h.presenter.invalidate(frame(1)); await turn()
  assert.equal(h.gpus[0].borrowing, true)
  h.healthPlans.push(new Error('GPU_OUT_OF_MEMORY')); h.tickHealth()
  assert.equal(h.gpus[0].healthChecks, 0); assert.equal(h.cpus.length, 0)
  h.presenter.dispose(); assert.equal(h.healthWatchers.stopped, 1); assert.equal(h.healthWatchers.active, 0)
  h.tickHealth(); assert.equal(h.gpus[0].healthChecks, 0); assert.equal(h.cpus.length, 0)
  pending.resolve(); await turn(); h.tickHealth(); await turn()
  assert.equal(h.gpus[0].disposals, 1); assert.equal(h.gpus[0].healthChecks, 0); assert.equal(h.cpus.length, 0); assert.equal(h.accepted.length, 0)
  await h.close()
})

await check('paused health reads wait until the resumed frame has completed its mutable preparation', async () => {
  const h = harness()
  h.presenter.invalidate(frame(1)); await turn()
  h.presenter.setPaused(true); h.healthPlans.push(new Error('DEVICE_LOST'))
  h.tickHealth(); assert.equal(h.gpus[0].healthChecks, 0); assert.equal(h.cpus.length, 0)
  h.presenter.setPaused(false); h.tickHealth()
  assert.equal(h.gpus[0].healthChecks, 0, 'resume has queued preparation and must still suppress health reads')
  await turn(); h.tickHealth(); await turn()
  assert.equal(h.gpus[0].healthChecks, 1); assert.deepEqual(h.cpus[0].renders, [1])
  assert.equal(h.accepted.at(-1).backend, 'cpu'); assert.equal(h.accepted.at(-1).generation, 1)
  await h.close()
})

process.stdout.write(JSON.stringify({ passed: passed.length, tests: passed, scope: 'Actual presenter controller with controlled backend/DOM dependencies; no browser pixels or native EXE acceptance' }, null, 2) + '\n')
