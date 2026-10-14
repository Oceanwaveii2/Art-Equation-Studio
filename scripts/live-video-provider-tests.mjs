import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const sourcePaths = ['src/canvas-engine/imageDemand.ts', 'src/canvas-engine/resourceBudget.ts', 'src/canvas-engine/decodedImageRegistry.ts', 'src/project-b/p0-surface/liveVideoPaint.ts']
const sources = await Promise.all(sourcePaths.map(path => readFile(path, 'utf8')))
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = source => {
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true })
  assert.equal((result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).length, 0)
  return result.outputText
}
const demandUrl = url(compile(sources[0])), budgetUrl = url(compile(sources[1]))
const registryUrl = url(compile(sources[2]).replace(/from ['"]\.\/imageDemand['"]/g, `from '${demandUrl}'`).replace(/from ['"]\.\/resourceBudget['"]/g, `from '${budgetUrl}'`))
const liveUrl = url(compile(sources[3]).replace(/from ['"]\.\.\/\.\.\/canvas-engine\/decodedImageRegistry['"]/g, `from '${registryUrl}'`).replace(/from ['"]\.\.\/\.\.\/canvas-engine\/imageDemand['"]/g, `from '${demandUrl}'`).replace(/from ['"]\.\.\/\.\.\/canvas-engine\/resourceBudget['"]/g, `from '${budgetUrl}'`))
const { DecodedImageRegistry } = await import(registryUrl)
const { CanvasResourceBudget } = await import(budgetUrl)
const { watchLiveVideoFrames, captureLiveVideoPaint, retireLiveVideoPaintBindings } = await import(liveUrl)
const wasm = await import(pathToFileURL(resolve('src/project-b/p0-surface/generated/p0_engine_wasm.js')))
wasm.initSync({ module: await readFile('src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm') })

class FakeObserver {
  static instances = []
  constructor(callback) { this.callback = callback; this.active = false; FakeObserver.instances.push(this) }
  observe(target, options) { this.target = target; this.options = options; this.active = true }
  disconnect() { this.active = false }
  static fire(target) { for (const observer of [...FakeObserver.instances]) if (observer.active && observer.target === target) observer.callback([]) }
}
class FakeDocument {
  documentElement = {}
  defaultView = { MutationObserver: FakeObserver, getComputedStyle: () => ({ filter: 'none', mixBlendMode: 'normal' }) }
  canvases = []
  draws = 0
  onDraw
  onRead
  createElement(tag) {
    assert.equal(tag, 'canvas')
    const document = this, canvas = { width: 0, height: 0 }, context = {
      drawImage(video, x, y, width, height) { document.draws++; document.lastDraw = { video, x, y, width, height }; document.onDraw?.() },
      getImageData(_x, _y, width, height, settings) {
        assert.equal(settings.colorSpace, 'srgb'); document.onRead?.()
        const data = new Uint8ClampedArray(width * height * 4)
        for (let i = 0; i < data.length; i += 4) data.set(document.lastDraw.video.pixel, i)
        return { data }
      },
    }
    canvas.getContext = (kind, settings) => { assert.equal(kind, '2d'); assert.equal(settings.colorSpace, 'srgb'); assert.equal(settings.willReadFrequently, true); return context }
    this.canvases.push(canvas); return canvas
  }
}
class FakeVideo extends EventTarget {
  ownerDocument = new FakeDocument()
  isConnected = true
  srcObject = null
  error = null
  seeking = false
  paused = true
  ended = false
  readyState = 2
  videoWidth = 2
  videoHeight = 1
  currentTime = 0
  currentSrc = 'file:///a.mp4'
  src = 'file:///a.mp4'
  srcAttribute = 'file:///a.mp4'
  sources = []
  volume = .8
  muted = false
  pixel = [200, 100, 50, 128]
  pending = new Map()
  cancelled = []
  listeners = new Map()
  requests = 0
  methodsCalled = []
  getAttribute(name) { return name === 'src' ? this.srcAttribute : null }
  querySelectorAll(tag) { assert.equal(tag, 'source'); return this.sources }
  addEventListener(type, callback) { super.addEventListener(type, callback); this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1) }
  removeEventListener(type, callback) { super.removeEventListener(type, callback); this.listeners.set(type, this.listeners.get(type) - 1) }
  requestVideoFrameCallback(callback) { const id = ++this.requests; this.pending.set(id, callback); return id }
  cancelVideoFrameCallback(id) { const callback = this.pending.get(id); if (callback) this.cancelled.push(callback); this.pending.delete(id) }
  emit(type) { this.dispatchEvent(new Event(type)) }
  frame(mediaTime = this.currentTime, presentedFrames = this.requests) { const [id, callback] = this.pending.entries().next().value; this.pending.delete(id); callback(1, { mediaTime, presentedFrames }) }
  play() { this.methodsCalled.push('play') }
  pause() { this.methodsCalled.push('pause') }
  load() { this.methodsCalled.push('load') }
}
const budget = (bytes = 4096) => new CanvasResourceBudget({ total: bytes, pools: { retained: bytes, 'tile-surface': bytes, 'tile-atlas': bytes } })
const checks = []
const check = (name, body) => { body(); checks.push({ name, pass: true }) }
const watch = video => { const invalidations = [], watcher = watchLiveVideoFrames(video, { onInvalidate: (...event) => invalidations.push(event) }); return { watcher, invalidations } }
const capture = (video, watcher, registry, extra = {}) => captureLiveVideoPaint(video, registry, {
  id: 'video-content', key: 'video-a', revision: 1, frame: watcher.snapshot(), contentTransform: [1, 0, 0, 1, 3, 2],
  contentSize: { width: 4, height: 4 }, physicalScale: 1, isCurrentFrame: frame => watcher.isCurrent(frame), ...extra,
})
const clean = (video, watcher) => { watcher.dispose(); assert.equal(video.pending.size, 0); assert.equal([...video.listeners.values()].reduce((a, b) => a + b, 0), 0) }

check('paused player has a readable decoded marker and no recurring frame loop', () => {
  const video = new FakeVideo(), { watcher } = watch(video), frame = watcher.snapshot()
  assert(frame); assert(watcher.isCurrent(frame)); assert.equal(video.requests, 0)
  assert.equal(video.volume, .8); assert.equal(video.muted, false); assert.deepEqual(video.methodsCalled, [])
  clean(video, watcher)
})
check('playing updates follow decoded RVFC markers, keep one callback and stop on pause', () => {
  const video = new FakeVideo(), { watcher, invalidations } = watch(video), old = watcher.snapshot()
  video.paused = false; video.emit('play'); assert.equal(video.pending.size, 1); assert.equal(watcher.snapshot(), null)
  video.currentTime = .1; video.frame(.08, 1); const current = watcher.snapshot()
  assert(current); assert.equal(current.mediaTime, .08); assert.equal(current.presentedFrames, 1); assert.equal(watcher.isCurrent(old), false); assert.equal(video.pending.size, 1)
  // currentTime advances between decoded frames; the RVFC marker still owns
  // the last presented pixels. A later decoded callback revokes that marker.
  video.currentTime = .11; assert(watcher.isCurrent(current)); video.frame(.12, 2); assert.equal(watcher.isCurrent(current), false)
  video.paused = true; video.emit('pause'); assert.equal(video.pending.size, 0); assert(watcher.snapshot()); assert(invalidations.some(([reason]) => reason === 'frame'))
  assert.deepEqual(video.methodsCalled, []); clean(video, watcher)
})
check('seek refuses the old frame until seeked supplies decoded current data', () => {
  const video = new FakeVideo(), { watcher } = watch(video), old = watcher.snapshot()
  video.seeking = true; video.currentTime = 2; video.emit('seeking'); assert.equal(watcher.snapshot(), null); assert.equal(watcher.isCurrent(old), false)
  video.seeking = false; video.emit('seeked'); const next = watcher.snapshot(); assert(next); assert.equal(next.currentTime, 2); assert.equal(video.pending.size, 0)
  clean(video, watcher)
})
check('src assignment and source-child mutations cannot retain the old decoded source', () => {
  const video = new FakeVideo(), { watcher } = watch(video), old = watcher.snapshot()
  video.src = video.srcAttribute = 'file:///b.mp4'
  // Snapshot detects the changed source synchronously, before the observer.
  assert.equal(watcher.snapshot(), null); assert.equal(watcher.isCurrent(old), false)
  FakeObserver.fire(video); video.emit('loadedmetadata'); assert.equal(watcher.snapshot(), null)
  video.currentSrc = video.src; video.emit('loadeddata'); assert.equal(watcher.snapshot().source, 'file:///b.mp4')
  video.sources.push({ getAttribute: name => name === 'src' ? 'file:///c.mp4' : 'video/mp4' }); FakeObserver.fire(video); assert.equal(watcher.snapshot(), null)
  clean(video, watcher)
})
check('errors/empty data revoke frame ownership and do not spin while paused', () => {
  const video = new FakeVideo(), { watcher } = watch(video)
  video.emit('emptied'); assert.equal(watcher.snapshot(), null); assert.equal(video.pending.size, 0)
  video.readyState = 1; video.emit('loadeddata'); assert.equal(watcher.snapshot(), null)
  video.readyState = 2; video.emit('loadeddata'); assert(watcher.snapshot())
  video.error = { code: 3 }; video.emit('error'); assert.equal(watcher.snapshot(), null); assert.equal(video.pending.size, 0)
  clean(video, watcher)
})
check('disconnection and disposal remove every listener and ignore cancelled late callbacks', () => {
  const video = new FakeVideo(), { watcher, invalidations } = watch(video)
  video.paused = false; video.emit('play'); const callback = [...video.pending.values()][0]
  video.isConnected = false; FakeObserver.fire(video.ownerDocument.documentElement)
  assert.equal(watcher.snapshot(), null); assert.equal(video.pending.size, 0); assert.equal([...video.listeners.values()].reduce((a, b) => a + b, 0), 0)
  const count = invalidations.length; callback(1, { mediaTime: 3, presentedFrames: 100 }); video.emit('loadeddata'); watcher.dispose()
  assert.equal(invalidations.length, count); assert.equal(invalidations.at(-1)[0], 'disconnected')
})
check('a playing platform without decoded-frame callbacks cannot claim a live derivative', () => {
  const video = new FakeVideo(); video.requestVideoFrameCallback = undefined; video.cancelVideoFrameCallback = undefined
  const { watcher } = watch(video); assert(watcher.snapshot()); video.paused = false; video.emit('play'); assert.equal(watcher.snapshot(), null)
  clean(video, watcher)
})
check('capture uses contain letterboxing, explicit clip, actual sRGB bytes and canonical premultiplication', () => {
  const video = new FakeVideo(), { watcher } = watch(video), ledger = budget(), registry = new DecodedImageRegistry(7, ledger)
  const result = capture(video, watcher, registry, { budget: ledger })
  assert.deepEqual(result.operations.map(operation => operation.type), ['pushClip', 'image', 'pop'])
  assert.deepEqual(result.operations[1].transform, [2, 0, 0, 2, 3, 3]); assert.deepEqual(result.visualBounds, { x: 3, y: 2, width: 4, height: 4 })
  assert.deepEqual([...result.upload.pixels], [100, 50, 25, 128, 100, 50, 25, 128]); assert.equal(video.ownerDocument.draws, 1)
  assert(video.ownerDocument.canvases.every(canvas => canvas.width === 0 && canvas.height === 0)); assert.equal(ledger.snapshot().pools['tile-surface'].bytes, 0)
  const second = capture(video, watcher, registry, { budget: ledger }); assert.equal(second.upload, result.upload); assert.equal(video.ownerDocument.draws, 1)
  result.upload.pixels[0] = 0; assert.throws(() => capture(video, watcher, registry, { budget: ledger }), /RESOURCE_REVISION_CONFLICT/)
  registry.dispose(); assert.equal(ledger.snapshot().bytes, 0); clean(video, watcher)
})
check('a new decoded frame cannot reuse the immutable resource revision of an older frame', () => {
  const video = new FakeVideo(), { watcher } = watch(video), registry = new DecodedImageRegistry(8, budget())
  capture(video, watcher, registry); video.currentTime = 1; video.emit('timeupdate')
  assert.throws(() => capture(video, watcher, registry), /RESOURCE_REVISION_CONFLICT/)
  const next = capture(video, watcher, registry, { revision: 2 }); assert.equal(next.upload.reference.revision, 2)
  registry.stage([next.upload.reference]); registry.present(); assert.equal(registry.stats().count, 1)
  registry.dispose(); clean(video, watcher)
})
check('physical demand decodes a bounded mip without changing contain geometry', () => {
  const video = new FakeVideo(); video.videoWidth = 8192; video.videoHeight = 4096
  const { watcher } = watch(video), registry = new DecodedImageRegistry(9, budget(16384))
  const result = capture(video, watcher, registry, { physicalScale: 2 })
  assert.deepEqual([result.upload.reference.width, result.upload.reference.height], [8, 4]); assert.deepEqual(result.operations[1].transform, [.5, 0, 0, .5, 3, 3])
  assert.throws(() => capture(video, watcher, registry, { revision: 2, physicalScale: 8192 }), /RESOURCE_BUDGET_EXCEEDED/)
  registry.dispose(); clean(video, watcher)
})
check('retirement clears exact and mip markers without changing uploads, pins, budget or similarly prefixed active bindings', () => {
  const video = new FakeVideo(); video.videoWidth = 8; video.videoHeight = 4
  const { watcher } = watch(video), ledger = budget(), registry = new DecodedImageRegistry(14, ledger), key = 'retiring-video'
  const retired = [
    capture(video, watcher, registry, { key, physicalScale: 2, budget: ledger }),
    capture(video, watcher, registry, { key, budget: ledger }),
    capture(video, watcher, registry, { key, physicalScale: .5, budget: ledger }),
  ]
  assert.deepEqual(retired.map(result => result.upload.reference.key), [key, `${key}:mip:4x2`, `${key}:mip:2x1`])
  const survivors = [
    capture(video, watcher, registry, { key: `${key}:mip-sibling`, physicalScale: 2, budget: ledger }),
    capture(video, watcher, registry, { key: 'active-video', physicalScale: 2, budget: ledger }),
  ]
  const uploads = [...retired, ...survivors].map(result => result.upload), references = uploads.map(upload => upload.reference)
  registry.stage(references); registry.present()
  const held = registry.retain([references[0], references.at(-1)])
  registry.stage([references[1], references.at(-1)])
  video.currentTime = 1; video.emit('timeupdate')
  for (const extra of [{ key, physicalScale: 2 }, { key }, { key, physicalScale: .5 }])
    assert.throws(() => capture(video, watcher, registry, extra), /RESOURCE_REVISION_CONFLICT/)
  const before = { stats: registry.stats(), budget: ledger.snapshot(), pixels: uploads.map(upload => [...upload.pixels]), draws: video.ownerDocument.draws }
  assert.deepEqual([before.stats.visiblePins, before.stats.pendingPins, before.stats.transportPins], [5, 2, 2])
  retireLiveVideoPaintBindings(registry, key)
  retireLiveVideoPaintBindings(registry, key) // Idempotent, including absent keys/registries.
  retireLiveVideoPaintBindings(registry, 'missing-video')
  retireLiveVideoPaintBindings(new DecodedImageRegistry(15, ledger), key)
  assert.deepEqual({ stats: registry.stats(), budget: ledger.snapshot(), pixels: uploads.map(upload => [...upload.pixels]), draws: video.ownerDocument.draws }, before)
  for (const upload of uploads) assert.equal(registry.resolve(upload.reference), upload)
  for (const [index, extra] of [{ key, physicalScale: 2 }, { key }, { key, physicalScale: .5 }].entries())
    assert.equal(capture(video, watcher, registry, extra).upload, retired[index].upload)
  for (const survivor of survivors)
    assert.throws(() => capture(video, watcher, registry, { key: survivor.upload.reference.key, physicalScale: 2 }), /RESOURCE_REVISION_CONFLICT/)
  assert.deepEqual(registry.stats(), before.stats); assert.deepEqual(ledger.snapshot(), before.budget)
  assert.equal(video.ownerDocument.draws, before.draws)
  held.release(); registry.dispose(); assert.equal(ledger.snapshot().bytes, 0); clean(video, watcher)
})
check('more than 1024 retired provider identities and mip variants do not exhaust admission with only three live uploads', () => {
  const video = new FakeVideo(); video.videoWidth = 8; video.videoHeight = 4
  const { watcher } = watch(video), ledger = budget(), registry = new DecodedImageRegistry(16, ledger)
  const anchor = capture(video, watcher, registry, { key: 'active-anchor', physicalScale: 2, budget: ledger })
  registry.stage([anchor.upload.reference]); registry.present()
  for (let index = 0; index < 1100; index++) {
    const key = `retired-video-${index}`
    const exact = capture(video, watcher, registry, { key, physicalScale: 2, budget: ledger })
    const mip = capture(video, watcher, registry, { key, budget: ledger })
    assert.equal(exact.upload.reference.key, key); assert.equal(mip.upload.reference.key, `${key}:mip:4x2`)
    assert.equal(registry.stats().count, 3)
    const before = { stats: registry.stats(), budget: ledger.snapshot() }
    retireLiveVideoPaintBindings(registry, key)
    assert.deepEqual({ stats: registry.stats(), budget: ledger.snapshot() }, before)
    registry.discard(); assert.equal(registry.stats().count, 1)
    assert.equal(registry.resolve(anchor.upload.reference), anchor.upload)
  }
  const next = capture(video, watcher, registry, { key: 'new-video-after-retirement', physicalScale: 2, budget: ledger })
  assert.equal(next.upload.reference.key, 'new-video-after-retirement'); assert.equal(registry.stats().count, 2)
  video.currentTime = 1; video.emit('timeupdate')
  assert.throws(() => capture(video, watcher, registry, { key: 'active-anchor', physicalScale: 2 }), /RESOURCE_REVISION_CONFLICT/)
  registry.dispose(); assert.equal(ledger.snapshot().bytes, 0); clean(video, watcher)
})
check('denied readback and stale source during capture leave no resource or temporary allocation', () => {
  const video = new FakeVideo(), { watcher } = watch(video), small = budget(8), registry = new DecodedImageRegistry(10, small)
  assert.throws(() => capture(video, watcher, registry, { budget: small }), /RESOURCE_BUDGET_EXCEEDED/); assert.equal(small.snapshot().bytes, 0)
  const ledger = budget(), second = new DecodedImageRegistry(11, ledger)
  video.ownerDocument.onDraw = () => { video.currentSrc = 'file:///changed.mp4' }
  assert.throws(() => capture(video, watcher, second, { budget: ledger }), /VIDEO_FRAME_NOT_CURRENT/)
  assert.equal(second.stats().count, 0); assert.equal(ledger.snapshot().bytes, 0); assert(video.ownerDocument.canvases.every(canvas => canvas.width === 0 && canvas.height === 0))
  registry.dispose(); second.dispose(); clean(video, watcher)
})
check('invalid epoch, dimensions, effects and stale marker reject before ownership', () => {
  const video = new FakeVideo(), { watcher } = watch(video), registry = new DecodedImageRegistry(12, budget()), frame = watcher.snapshot()
  assert.throws(() => capture(video, watcher, registry, { epoch: 11 }), /VIDEO_RESOURCE_INVALID/)
  assert.throws(() => capture(video, watcher, registry, { revision: 0 }), /VIDEO_RESOURCE_INVALID/)
  assert.throws(() => capture(video, watcher, registry, { contentTransform: [0, 0, 0, 0, 0, 0] }), /VIDEO_PAINT_INVALID/)
  video.ownerDocument.defaultView.getComputedStyle = () => ({ filter: 'blur(1px)', mixBlendMode: 'normal' }); assert.throws(() => capture(video, watcher, registry), /VIDEO_PAINT_UNSUPPORTED/)
  video.ownerDocument.defaultView.getComputedStyle = () => ({ filter: 'none', mixBlendMode: 'normal' })
  video.videoWidth = 4; assert.throws(() => capture(video, watcher, registry, { frame }), /VIDEO_FRAME_NOT_CURRENT/)
  registry.dispose(); clean(video, watcher)
})
check('genuine WASM CPU renderer paints actual provider image operations and preserves contain/cover clipping', () => {
  const video = new FakeVideo(), { watcher } = watch(video), registry = new DecodedImageRegistry(13, budget()), renderer = new wasm.B4CpuRenderer()
  const render = result => {
    renderer.register_image(JSON.stringify(result.upload.reference), result.upload.pixels)
    const displayList = { schema: 'art-equation.display-list', schemaVersion: 2, sceneId: 'live-provider', revision: '1', environment: { background: '#00000000', colorSpace: 'srgb' }, resources: [result.upload.reference], operations: result.operations }
    return renderer.render_snapshot(12, 10, JSON.stringify(displayList), 1, 0, 0)
  }
  const alpha = (pixels, x, y) => pixels[(y * 12 + x) * 4 + 3]
  try {
    const contained = render(capture(video, watcher, registry)); assert.equal(alpha(contained, 4, 2), 0); assert.equal(alpha(contained, 4, 3), 128); assert.equal(alpha(contained, 4, 5), 0)
    const covered = render(capture(video, watcher, registry, { objectFit: 'cover', revision: 2 })); assert.equal(alpha(covered, 3, 2), 128); assert.equal(alpha(covered, 7, 2), 0)
  } finally { renderer.dispose(); renderer.free(); registry.dispose(); clean(video, watcher) }
})

const output = resolve('../output/live-video-provider-tests')
await mkdir(output, { recursive: true })
const report = { status: 'CONTROLLED_LIVE_VIDEO_PROVIDER_TEST_PASS', scope: 'Lifecycle mocks, actual registry/budget and genuine WASM CPU paint. Not real MP4 playback, browser/GPU pixel parity, timing or native acceptance.', checks,
  sourceHashes: sourcePaths.map((path, index) => ({ path, sha256: createHash('sha256').update(sources[index]).digest('hex') })), nativeQualified: false }
await writeFile(resolve(output, 'review.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ status: report.status, passed: checks.length, output: resolve(output, 'review.json'), nativeQualified: false }))
