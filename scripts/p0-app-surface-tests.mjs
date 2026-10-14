import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'

// Tests run actual serializer, eligibility and React component callbacks.
// GPU/CPU pixels and real browser presentation are a separate engine harness;
// this script does not launch a browser or interact with production app data.
const paths = ['src/board/VelloBoardBackdrop.tsx', 'src/board/velloEligibility.ts', 'src/board/VelloBoardBackdrop.css', 'src/board/RetainedBoardContent.css', 'src/canvas-engine/liveCamera.ts', 'src/canvas-engine/liveScene.ts', 'src/canvas-engine/paintDisplayList.ts', 'src/board/useMeasuredCardPaint.ts', 'src/board/measuredCardPaint.ts']
const sources = await Promise.all(paths.map(path => readFile(path, 'utf8')))
const hashes = Object.fromEntries(paths.map((path, i) => [path, createHash('sha256').update(sources[i]).digest('hex')]))
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = path => ts.transpileModule(sources[paths.indexOf(path)], { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
const hooksUrl = url('export const useRef=(v)=>globalThis.__p0Hooks.useRef(v);export const useEffect=(f,d)=>globalThis.__p0Hooks.effect("effect",f,d);export const useLayoutEffect=(f,d)=>globalThis.__p0Hooks.effect("layout",f,d);')
const jsxUrl = url('export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment=Symbol("fragment");')
const presenterUrl = url('export const createVelloPresenter=(host,callbacks)=>globalThis.__p0PresenterFactory(host,callbacks);')
const eligibilityUrl = url(compile('src/board/velloEligibility.ts'))
const paintListUrl = url(compile('src/canvas-engine/paintDisplayList.ts'))
// These controller tests use controlled DOM/layout, not browser CSS. The real
// observer and layout have separate current-CSS browser and analytical checks.
const cardObserverUrl = url('export const observeMeasuredCardPaint=(...args)=>globalThis.__p0CardObserverFactory(...args);')
const svgEffectsUrl = url('export const qualifiedSvgFlow = () => false;')
const componentUrl = url(compile('src/board/VelloBoardBackdrop.tsx')
  .replace(/import\s+['"]\.\/VelloBoardBackdrop\.css['"];?\s*/g, '')
  .replace(/from ['"]react['"]/g, `from '${hooksUrl}'`)
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${jsxUrl}'`)
  .replace(/from ['"]\.\.\/project-b\/p0-surface\/presenter['"]/g, `from '${presenterUrl}'`)
  .replace(/from ['"]\.\.\/project-b\/p0-surface\/svgEffects['"]/g, `from '${svgEffectsUrl}'`)
  .replace(/from ['"]\.\/velloEligibility['"]/g, `from '${eligibilityUrl}'`)
  .replace(/from ['"]\.\.\/canvas-engine\/paintDisplayList['"]/g, `from '${paintListUrl}'`)
  .replace(/from ['"]\.\/useMeasuredCardPaint['"]/g, `from '${cardObserverUrl}'`))
const { VelloBoardBackdrop, velloBoardSnapshot, velloRenderResolution, mountedPaintScene } = await import(componentUrl)
const { eligibleVelloObjects } = await import(eligibilityUrl)
const { LiveCamera } = await import(url(compile('src/canvas-engine/liveCamera.ts')))
const { LiveCanvasScene } = await import(url(compile('src/canvas-engine/liveScene.ts')))
const timestamp = new Date().toISOString(), output = resolve(process.argv[2] ?? resolve('output/p0-app-surface', timestamp.replace(/[:.]/g, '-')))
await mkdir(output, { recursive: true })
const report = {
  generatedAt: timestamp, passed: false, sourceHashes: hashes, checks: [], measurements: {},
  limitations: ['Actual-source component callback tests use controlled hooks, dimensions and presenter receipts. They do not prove physical GPU presentation or CSS layout.', 'Real Vello GPU/CPU pixel parity, device loss, memory policy and runtime recovery are verified by the separate P0 engine/app browser harness.', 'This guarded path adapter does not complete full-scene P0, P1 UI, native integration, or final EXE acceptance.'],
}
const check = (name, value, detail) => { report.checks.push({ name, passed: Boolean(value), ...(detail === undefined ? {} : { detail }) }); assert(value, `${name}: ${JSON.stringify(detail)}`) }
const baseAppearance = { fill: '#dd4422', stroke: '#2277bb', strokeWidth: 2, opacity: .7, rotation: 0 }
const vector = (id, x = 0, extra = {}) => ({
  id, revision: 1, order: 0, zIndex: 0, kind: 'vector', bounds: { x, y: 0, width: 40, height: 40 },
  localBounds: { x, y: 0, width: 40, height: 40 }, hidden: false, locked: true,
  appearance: { ...baseAppearance }, vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }] }, ...extra,
})
const scene = (objects, extra = {}) => ({ id: 'fixture', revision: 1, objects, connections: [], environment: { background: '#192129', grid: { visible: true, color: '#334455', opacity: .2, spacing: 32 } }, ...extra })
const decode = (s, ids = [], scale = 1) => JSON.parse(velloBoardSnapshot(s, ids, scale).json)
const ids = (s, selected = [], scale = 1) => eligibleVelloObjects(s, selected, scale).map(object => object.id)
const submittedObjects = frame => JSON.parse(frame.snapshot).operations.filter(operation => operation.type === 'vector').map(operation => operation.object)

function eventTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback) },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback) },
    emit(type) { for (const callback of [...(listeners.get(type) ?? [])]) callback() },
    count(type) { return listeners.get(type)?.size ?? 0 },
  }
}
function componentHarness(initialProps) {
  const slots = [], layout = [], effects = []
  let index = 0, rafId = 0
  const raf = new Map(), invalidations = [], submissions = [], presenterResults = [], queries = []
  const elements = new Map([['one', { dataset: { nodeId: 'one' } }], ['two', { dataset: { nodeId: 'two' } }]])
  const stage = { ...eventTarget(), querySelectorAll() { return [...elements.values()] } }
  const host = { dataset: {}, style: {}, parentElement: stage, clientWidth: 900, clientHeight: 500 }
  const notice = { hidden: true }
  const canvas = { style: {}, className: 'gpu-board-canvas vello-board-canvas', parentElement: host }
  const fakeWindow = { ...eventTarget(), devicePixelRatio: 1.5, matchMedia() { const query = eventTarget(); queries.push(query); return query } }
  const fakeDocument = { ...eventTarget(), hidden: false }
  let observer, membershipObserver, disposed = false, callbacks, recoveryRequests = 0, noticeButton, cardLayout
  const globals = ['window', 'document', 'CSS', 'Element', 'ResizeObserver', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', '__p0Hooks', '__p0PresenterFactory', '__p0CardObserverFactory']
  const previous = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const presenter = {
    invalidateGeneration(generation) { invalidations.push(generation) },
    invalidate(frame) { submissions.push(frame) },
    dispose() { disposed = true },
    recoverGpu() { recoveryRequests++ }, setPaused() {}, injectFaultForTest() {},
  }
  install('window', fakeWindow); install('document', fakeDocument); install('CSS', { escape: value => value })
  install('Element', class { constructor(nodeId) { this.dataset = { nodeId } } closest(selector) { return selector === 'article.board-node' ? this : null } matches(selector) { return selector === 'article.board-node' } querySelector() { return null } })
  install('requestAnimationFrame', callback => { const id = ++rafId; raf.set(id, callback); return id })
  install('cancelAnimationFrame', id => raf.delete(id))
  install('ResizeObserver', class {
    constructor(callback) { observer = this; this.callback = callback; this.connected = false }
    observe() { this.connected = true } disconnect() { this.connected = false }
  })
  install('MutationObserver', class {
    constructor(callback) { membershipObserver = this; this.callback = callback; this.connected = false }
    observe(target, options) { this.connected = true; this.target = target; this.options = options }
    disconnect() { this.connected = false }
  })
  install('__p0PresenterFactory', (_host, value) => { callbacks = value; return presenter })
  install('__p0CardObserverFactory', (target, current, publish) => {
    cardLayout = { target, current, publish, invalidations: 0, disposed: false, invalidate() { this.invalidations++ }, dispose() { this.disposed = true } }
    return cardLayout
  })
  install('__p0Hooks', {
    useRef(value) { const slot = index++; if (!slots[slot]) slots[slot] = { current: value }; return slots[slot] },
    effect(kind, callback, deps) {
      const slot = index++, prior = slots[slot]
      if (!prior || !deps || deps.some((value, i) => !Object.is(value, prior.deps?.[i]))) {
        const value = { deps, cleanup: prior?.cleanup }; slots[slot] = value
        ;(kind === 'layout' ? layout : effects).push(() => { value.cleanup?.(); value.cleanup = callback() })
      }
    },
  })
  const render = props => {
    index = 0
    const result = VelloBoardBackdrop({ ...props, onPresenter: value => presenterResults.push(value) })
    const children = result.props.children
    children[0].props.ref.current = host
    children[1].props.ref.current = notice
    noticeButton = children[1].props.children[1]
    while (layout.length) layout.shift()()
    while (effects.length) effects.shift()()
  }
  const flushRaf = () => { for (const [id, callback] of [...raf]) { raf.delete(id); callback() } }
  const accept = (frame = submissions.at(-1), backend = 'gpu') => {
    callbacks.accepted({ generation: frame.generation, backend, canvas, metadata: { width: frame.width, height: frame.height, surfaceConfigurations: 1, targetAllocations: 1, cpuPixelReadbacks: backend === 'gpu' ? 0 : 1 }, frame })
    callbacks.state({ backend, state: backend === 'gpu' ? 'ready' : 'fallback', ...(backend === 'cpu' ? { reason: 'Vello CPU active' } : {}) })
  }
  const error = (generation, error = 'receipt failure') => callbacks.error({ generation, backend: 'gpu', error })
  const cleanup = () => { for (const slot of slots) slot?.cleanup?.() }
  const restore = () => { for (const key of globals) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key] } }
  render(initialProps)
  return { host, notice, canvas, elements, stage, render, flushRaf, accept, error, cleanup, restore, fakeWindow, fakeDocument, queries, submissions, invalidations, presenterResults, retry() { noticeButton.props.onClick() }, get recoveryRequests() { return recoveryRequests }, get observer() { return observer }, get membershipObserver() { return membershipObserver }, get cardLayout() { return cardLayout }, get disposed() { return disposed }, get callbacks() { return callbacks }, get rafCount() { return raf.size } }
}

let harness
try {
  const authored = scene([vector('one', 0, { bounds: { x: -10, y: -20, width: 60, height: 70 }, localBounds: { x: 0, y: 0, width: 40, height: 40 }, appearance: { opacity: .5, rotation: 0, strokeWidth: 0 }, vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0, handleIn: { x: -4, y: 1 } }, { x: 40, y: 40, handleOut: { x: 3, y: -2 } }] } })])
  const before = JSON.stringify(authored), snapshot = decode(authored), path = snapshot.objects[0]
  check('local zero origin survives broad-phase negative bounds', path.transform[4] === 0 && path.transform[5] === 0, path.transform)
  check('missing fill is transparent like SVG', path.payload.fill === '#00000000')
  check('explicit zero-width stroke survives projection', path.payload.strokeWidth === 0)
  check('closing Bezier controls precede closePath', JSON.stringify(path.payload.commands.at(-2)) === JSON.stringify(['C', 43, 38, -4, 1, 0, 0]) && path.payload.commands.at(-1)[0] === 'Z', path.payload.commands)
  check('object opacity remains renderer metadata', path.opacity === .5)
  check('environment remains transparent and connections DOM-owned', snapshot.environment.background === '#00000000' && snapshot.connections.length === 0)
  for (const scale of [.5, 1, 2]) {
    const input = scene([vector('one')]), encoded = decode(input, [], scale).objects[0]
    check(`non-scaling stroke cancels CSS camera at ${scale}`, encoded.payload.strokeWidth * scale === 2)
    check(`canonical width unchanged at ${scale}`, input.objects[0].appearance.strokeWidth === 2)
  }
  const styled = scene([vector('one', 0, { appearance: { ...baseAppearance, vectorFillRule: 'evenodd', vectorStrokeJoin: 'round', vectorStrokeCap: 'square' } })])
  const payload = decode(styled).objects[0].payload
  check('canonical fill rule, cap and join survive adapter', payload.vectorFillRule === 'evenodd' && payload.vectorStrokeJoin === 'round' && payload.vectorStrokeCap === 'square')
  const open = scene([vector('one', 0, { vectorPath: { ...vector('one').vectorPath, closed: false } })])
  check('open path cannot acquire fill', decode(open).objects[0].payload.fill === '#00000000')
  check('serializer leaves authored objects unchanged', JSON.stringify(authored) === before)
  const mountedSource = scene([
    vector('paint-first', 0, { order: 0 }),
    { ...vector('unmounted-unsupported', 0, { order: 1 }), kind: 'note', vectorPath: undefined },
    vector('forced-selection', 8000, { order: 2 }),
    vector('paint-last', 80, { order: 3 }),
  ])
  const mountedIds = ['paint-last', 'forced-selection', 'paint-first', 'unknown-proxy']
  const mountedStage = { querySelectorAll(selector) { assert.equal(selector, '.board-world>.board-object-layer>article.board-node[data-node-id]'); return mountedIds.map(nodeId => ({ dataset: { nodeId } })) } }
  const mounted = mountedPaintScene(mountedSource, mountedStage)
  check('mounted membership preserves canonical order rather than DOM enumeration', mounted.objects.map(object => object.id).join() === 'paint-first,forced-selection,paint-last')
  check('forced mounted selection outside ordinary viewport retains canonical paint membership', mounted.objects.some(object => object.id === 'forced-selection'))
  check('unmounted overlapping unsupported card neither paints nor blocks visible vectors', decode(mounted).objects.map(object => object.id).join() === 'paint-first,forced-selection,paint-last')
  check('unknown mounted proxy cannot invent canonical artwork', !mounted.objects.some(object => object.id === 'unknown-proxy'))
  check('mounted derivative keeps scene revision, environment and connection identity', mounted.revision === mountedSource.revision && mounted.environment === mountedSource.environment && mounted.connections === mountedSource.connections)
  check('empty actual stage produces zero engine objects', decode(mountedPaintScene(mountedSource, { querySelectorAll() { return [] } })).objects.length === 0)
  check('controller-only fixture without a DOM query retains compatibility source', mountedPaintScene(mountedSource, {}) === mountedSource)
  check('membership filtering preserves canonical source and all authored objects', mountedSource.objects.length === 4 && mountedSource.objects[1].id === 'unmounted-unsupported')
  check('selected locked path remains DOM-owned', ids(scene([vector('one')]), ['one']).length === 0)
  check('unlocked path uses the same paint backend as locked path', ids(scene([vector('one', 0, { locked: false })])).join() === 'one')
  check('overlapping unlocked and locked paths retain one engine batch', ids(scene([vector('one'), vector('two', 20, { locked: false })])).length === 2)
  const variants = [
    ['owned', { parentId: 'frame' }], ['Boolean', { vectorBoolean: { operation: 'subtract', operands: [] } }],
    ['transformed', { vectorTransform: { skewX: 5 } }], ['rotated', { appearance: { ...baseAppearance, rotation: 15 } }],
    ['basic vector without path', { vectorPath: undefined }],
  ]
  for (const [name, extra] of variants) {
    const a = vector('one'), b = vector('two', 20, extra)
    for (const objects of [[a, b], [b, a]]) check(`DOM ${name} vector blocks overlapping batch in either layer order`, ids(scene(objects)).length === 0)
  }
  const card = vector('card', 15, { kind: 'raster', vectorPath: undefined })
  check('raster overlaps are excluded', ids(scene([vector('one'), card])).length === 0)
  check('hidden overlap does not block paint', JSON.stringify(ids(scene([vector('one'), { ...card, hidden: true }]))) === JSON.stringify(['one']))
  check('selected vector blocks other overlapping vector', ids(scene([vector('one'), vector('two', 20)]), ['two']).length === 0)
  const chain = scene([vector('one', 0), vector('two', 35), vector('three', 70), vector('four', 200)])
  check('fallback propagates across overlapping candidate chain', JSON.stringify(ids(chain, ['three'])) === JSON.stringify(['four']))
  check('nonoverlapping unlocked paths both remain eligible', JSON.stringify(ids(scene([vector('one'), vector('two', 300, { locked: false })]))) === JSON.stringify(['one', 'two']))
  check('invalid visible bounds fail closed', ids(scene([vector('one'), vector('bad', 300, { bounds: { x: NaN, y: 0, width: 10, height: 10 } })])).length === 0)
  check('invalid camera scale cannot serialize a batch', ids(scene([vector('one')]), [], 0).length === 0)
  check('large finite coordinates cannot stall spatial-cell iteration', ids(scene([vector('large', 1e100)])).length === 1)
  const many = scene(Array.from({ length: 20_000 }, (_, index) => vector(`p-${index}`, index * 100)))
  const start = performance.now(), count = eligibleVelloObjects(many, []).length
  report.measurements.independent20kEligibilityMs = performance.now() - start
  check('independent 20k paths survive eligibility', count === 20_000, report.measurements)
  for (const [width, height, dpr] of [[1000, 800, 1.5], [9000, 5000, 2], [500, 6000, 3], [6000, 6000, .75]]) {
    const ratio = velloRenderResolution(width, height, dpr), pixels = Math.floor(width * ratio) * Math.floor(height * ratio)
    check(`resolution respects device edges/pixel cap ${width}x${height}@${dpr}`, ratio > 0 && Math.floor(width * ratio) <= 4096 && Math.floor(height * ratio) <= 4096 && pixels <= 16_777_216)
  }
  check('oversized viewport is permitted below one', velloRenderResolution(9000, 5000, 2) < 1)
  check('zero extent is not a fake one-pixel render', velloRenderResolution(0, 600, 2) === 0)
  check('valid fractional DPR is retained', velloRenderResolution(100, 100, .75) === .75)
  check('backdrop loads scoped ownership CSS', sources[0].includes("import './VelloBoardBackdrop.css'"))
  check('scoped CSS imports retained marker suppression', /@import\s+['"]\.\/RetainedBoardContent\.css['"]/.test(sources[2]))
  check('hidden defense is scoped to own canvas', sources[2].includes('.vello-board > .vello-board-canvas[hidden]'))
  check('transparent backdrop has no per-frame Canvas2D environment composite', !sources[0].includes('compositeEnvironment') && !sources[0].includes("getContext('2d')"))
  check('component delegates one display surface to presenter', !sources[0].includes('document.createElement') && !sources[0].includes('stagingCanvas'))

  const initialScene = scene([vector('one'), vector('two', 200)]), camera = new LiveCamera({ x: 0, y: 0, scale: 1 })
  const props = { scene: initialScene, viewport: { x: 0, y: 0, scale: 1 }, selectedIds: [], camera }
  harness = componentHarness(props)
  check('generation invalidates immediately before initial rAF', harness.invalidations.length === 1 && harness.submissions.length === 0 && harness.rafCount === 1)
  harness.flushRaf()
  const first = harness.submissions.at(-1)
  check('actual production submission uses ordered V2 paint list', JSON.parse(first.snapshot).schema === 'art-equation.display-list' && JSON.parse(first.snapshot).schemaVersion === 2 && submittedObjects(first).length === 2)
  check('card observation attaches to stage without deciding paint ownership', harness.cardLayout.target === harness.stage && harness.cardLayout.invalidations >= 1 && harness.cardLayout.current().scene === initialScene)
  check('initial backing dimensions include DPR', first.width === 1350 && first.height === 750 && first.scale === 1.5)
  harness.accept(first)
  check('accepted frame owns DOM paint markers', harness.elements.get('one').dataset.velloPaint === 'true' && harness.host.dataset.paintOwnership === 'vello')
  check('membership observer watches child mounts without attribute feedback', harness.membershipObserver.target === harness.stage && harness.membershipObserver.options.childList === true && harness.membershipObserver.options.subtree === true && (!harness.membershipObserver.options.attributes || !harness.membershipObserver.options.attributeFilter?.includes('data-vello-paint')))
  const replacedOne = harness.elements.get('one'), replacementOne = { dataset: { nodeId: 'one' } }
  harness.elements.set('one', replacementOne)
  harness.membershipObserver.callback([])
  check('newly mounted semantic proxy inherits GPU ownership before another frame', replacementOne.dataset.velloPaint === 'true' && !replacedOne.dataset.velloPaint && harness.submissions.length === 1)
  harness.elements.set('unknown', { dataset: { nodeId: 'unknown' } }); harness.membershipObserver.callback([])
  check('mounted unsupported object cannot inherit engine ownership', !harness.elements.get('unknown').dataset.velloPaint)
  check('accepted canvas retains captured CSS size', harness.canvas.style.width === '900px' && harness.canvas.style.height === '500px')
  camera.present({ x: 20, y: 30, scale: 2 })
  check('live camera invalidates before next submission', harness.invalidations.at(-1) > first.generation && harness.submissions.length === 1)
  check('camera preserves visible completed frame and markers', harness.canvas.style.visibility === 'visible' && harness.elements.get('one').dataset.velloPaint === 'true')
  check('camera delta reprojects accepted pixels immediately', harness.canvas.style.transform === 'translate(20px, 30px) scale(2)', harness.canvas.style.transform)
  harness.accept(first)
  check('obsolete accepted receipt cannot reset camera transform', harness.canvas.style.transform === 'translate(20px, 30px) scale(2)' && harness.host.dataset.acceptedGeneration === String(first.generation))
  camera.present({ x: 25, y: 35, scale: 2 })
  check('camera rAF work coalesces to latest request', harness.rafCount === 1)
  harness.flushRaf()
  const second = harness.submissions.at(-1)
  check('submission uses live camera rather than stale React viewport', second.panX === 37.5 && second.panY === 52.5 && second.scale === 3)
  check('DPR does not enter non-scaling-stroke derivative', submittedObjects(second)[0].payload.strokeWidth === 1)
  harness.accept(second)
  check('current accepted frame resets camera delta', harness.canvas.style.transform === '' && harness.host.dataset.acceptedScale === '2')
  harness.render({ ...props, selectedIds: ['one'] })
  check('selection immediately hides old content and releases all batch markers', harness.canvas.style.visibility === 'hidden' && [...harness.elements.values()].every(element => !element.dataset.velloPaint))
  harness.membershipObserver.callback([])
  check('membership reconciliation cannot reacquire retired batch ownership', [...harness.elements.values()].every(element => !element.dataset.velloPaint))
  const afterSelection = harness.host.dataset.generation
  harness.error(second.generation, 'old request error')
  check('stale error cannot overwrite newer loading state', harness.host.dataset.renderState === 'loading' && !harness.host.dataset.renderError)
  harness.flushRaf()
  const third = harness.submissions.at(-1)
  check('selected object omitted from submitted batch', !submittedObjects(third).some(object => object.id === 'one'))
  harness.accept(third, 'cpu')
  check('CPU frame is visible and truthfully identified', harness.canvas.style.visibility === 'visible' && harness.host.dataset.renderer === 'vello-cpu' && harness.host.dataset.acceptedBackend === 'cpu')
  check('CPU fallback state retains current paint ownership', harness.elements.get('two').dataset.velloPaint === 'true' && harness.host.dataset.paintOwnership === 'vello' && harness.host.dataset.renderState === 'fallback')
  const replacedTwo = harness.elements.get('two'), replacementTwo = { dataset: { nodeId: 'two' } }
  harness.elements.set('two', replacementTwo)
  harness.render({ ...props, selectedIds: ['one'] })
  check('same-props React commit reconciles new CPU-owned proxy', replacementTwo.dataset.velloPaint === 'true' && !replacedTwo.dataset.velloPaint)
  check('selection generation capture remains current', harness.host.dataset.acceptedGeneration === afterSelection)
  const updated = scene([vector('one', 80), vector('two', 200)], { revision: 2 })
  harness.render({ ...props, scene: updated, selectedIds: ['one'] })
  check('content revision hides obsolete paint before rendering', harness.canvas.style.visibility === 'hidden' && !harness.elements.get('two').dataset.velloPaint)
  harness.flushRaf(); harness.accept()
  check('fresh revision restores ownership', harness.host.dataset.acceptedRevision === '2' && harness.canvas.style.visibility === 'visible')
  harness.host.clientWidth = 1200
  harness.observer.callback()
  check('resize retains completed CSS width until accepted', harness.canvas.style.width === '900px' && harness.canvas.style.visibility === 'visible')
  harness.flushRaf(); harness.accept()
  check('accepted resize adopts new CSS dimensions', harness.canvas.style.width === '1200px')
  const current = harness.submissions.at(-1)
  harness.error(current.generation)
  check('current renderer failure preserves engine paint and reports error', harness.canvas.style.visibility === 'visible' && harness.host.dataset.paintOwnership === 'vello' && harness.host.dataset.renderState === 'error')
  check('current renderer failure exposes user recovery notice outside hidden surface', harness.notice.hidden === false)
  harness.retry()
  check('recovery control requests the actual presenter recovery', harness.recoveryRequests === 1)
  check('retry also queues a fresh frame when GPU recovery is already active', harness.invalidations.at(-1) > current.generation && harness.rafCount === 1)
  harness.fakeWindow.devicePixelRatio = 2
  harness.queries.at(-1).emit('change')
  harness.flushRaf(); harness.accept()
  check('DPR watcher submits new backing dimensions', harness.submissions.at(-1).width === 2400 && harness.submissions.at(-1).height === 1000)
  check('only accepted recovery hides the user error notice', harness.notice.hidden === true)
  const countBeforeZero = harness.submissions.length
  harness.host.clientHeight = 0; harness.observer.callback(); harness.flushRaf()
  check('zero-size host submits no work', harness.submissions.length === countBeforeZero && harness.host.dataset.renderState === 'paused')
  harness.host.clientHeight = 500
  harness.fakeDocument.hidden = true; harness.fakeDocument.emit('visibilitychange'); harness.flushRaf()
  check('hidden document submits no work', harness.submissions.length === countBeforeZero)
  camera.present({ x: 50, y: 60, scale: 1 })
  harness.fakeDocument.hidden = false; harness.fakeDocument.emit('visibilitychange'); harness.flushRaf(); harness.accept()
  check('visibility resume submits latest canonical camera', harness.submissions.at(-1).panX === 100 && harness.submissions.at(-1).scale === 2)
  const mounts = harness.presenterResults.length
  harness.render({ ...props, scene: updated, selectedIds: ['one'] })
  check('changing instrumentation callback does not recreate presenter', harness.presenterResults.length === mounts)
  const latest = harness.submissions.at(-1)
  harness.cleanup()
  check('cleanup disposes presenter, observer and ownership', harness.disposed && !harness.observer.connected && [...harness.elements.values()].every(element => !element.dataset.velloPaint))
  check('cleanup disconnects dynamic membership observation', !harness.membershipObserver.connected)
  check('cleanup disposes independent card observation', harness.cardLayout.disposed)
  check('cleanup removes DPR, resize and visibility listeners', harness.queries.every(query => query.count('change') === 0) && harness.fakeWindow.count('resize') === 0 && harness.fakeDocument.count('visibilitychange') === 0)
  check('cleanup sends null instrumentation receipt', harness.presenterResults.at(-1) === null)
  harness.accept(latest)
  harness.membershipObserver.callback([])
  check('late accepted frame after cleanup cannot reacquire paint', [...harness.elements.values()].every(element => !element.dataset.velloPaint))
  harness.restore(); harness = undefined
  harness = componentHarness(props); harness.flushRaf(); harness.accept()
  const oldProxy = harness.elements.get('one'), newProxy = new globalThis.Element('one')
  harness.elements.set('one', newProxy)
  const beforeMembershipGeneration = harness.host.dataset.generation
  harness.membershipObserver.callback([{ target: harness.stage, addedNodes: [newProxy], removedNodes: [oldProxy] }])
  check('actual card child-list mutation invalidates before new paint can cross old engine layer', Number(harness.host.dataset.generation) > Number(beforeMembershipGeneration) && harness.canvas.style.visibility === 'hidden' && !newProxy.dataset.velloPaint)
  harness.flushRaf(); harness.accept()
  check('changed membership receives ownership only from its new completed frame', newProxy.dataset.velloPaint === 'true' && harness.host.dataset.acceptedGeneration === harness.host.dataset.generation)
  const cardContentGeneration = harness.host.dataset.generation
  harness.membershipObserver.callback([{ target: newProxy, addedNodes: [], removedNodes: [] }])
  check('content mutation inside a mounted card invalidates measured paint', Number(harness.host.dataset.generation) > Number(cardContentGeneration) && !newProxy.dataset.velloPaint)
  harness.cleanup(); harness.restore(); harness = undefined
  const liveInitial = scene([vector('one', 0, { locked: false }), vector('two', 200, { locked: false })])
  const liveSource = new LiveCanvasScene(liveInitial)
  const liveProps = { scene: liveInitial, sceneSource: liveSource, viewport: { x: 0, y: 0, scale: 1 }, selectedIds: [] }
  harness = componentHarness(liveProps)
  harness.flushRaf(); harness.accept()
  const firstLiveFrame = harness.submissions.at(-1)
  harness.render({ ...liveProps, selectedIds: ['one'] })
  check('selection with a bridged scene preserves surface and ownership before rendering', harness.canvas.style.visibility === 'visible' && harness.elements.get('one').dataset.velloPaint === 'true')
  harness.flushRaf(); harness.accept()
  check('selected unlocked paths stay engine owned after acceptance', harness.elements.get('one').dataset.velloPaint === 'true' && submittedObjects(harness.submissions.at(-1)).length === 2)
  const preview = scene([vector('one', 60, { locked: false }), vector('two', 200, { locked: false })], { revision: 3 })
  liveSource.present(preview)
  check('live preview invalidates without React and keeps the previous engine frame', harness.rafCount === 1 && harness.canvas.style.visibility === 'visible' && harness.elements.get('one').dataset.velloPaint === 'true')
  harness.flushRaf()
  const previewFrame = harness.submissions.at(-1)
  check('live preview serializes its actual geometry', submittedObjects(previewFrame)[0].transform[4] === 60)
  harness.accept(firstLiveFrame)
  check('obsolete committed receipt cannot overwrite live preview generation', harness.host.dataset.acceptedRevision !== '3')
  harness.accept(previewFrame)
  check('current preview is accepted with its own revision', harness.host.dataset.acceptedRevision === '3')
  liveSource.present(liveInitial); harness.flushRaf(); harness.accept()
  check('cancelled preview restores canonical geometry', submittedObjects(harness.submissions.at(-1))[0].transform[4] === 0)
  const liveCount = harness.submissions.length
  harness.cleanup(); liveSource.present(preview); harness.flushRaf()
  check('unmounted renderer unsubscribes from live geometry', harness.submissions.length === liveCount && !harness.elements.get('one').dataset.velloPaint)
  harness.restore(); harness = undefined
  const after = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
  check('tested source stayed unchanged throughout run', JSON.stringify(after) === JSON.stringify(hashes))
  report.passed = true
} catch (error) {
  report.error = error.stack ?? String(error)
  throw error
} finally {
  harness?.cleanup(); harness?.restore()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.passed, assertions: report.checks.length, output, ...(report.error ? { error: report.error } : {}) }, null, 2))
}

