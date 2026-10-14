import { eraseRectangleAppearance, isRectangleErasure, rectangleErasureState } from '../src/model/rectangleErasure.ts'
import { captureRectangleErasureCssClip } from '../src/board/rectangleErasurePaint.ts'
import { transformVectorPaint } from '../src/board/vectorPaint.ts'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { FrameScheduler } from '../src/canvas-engine/frameScheduler.ts'
import { StrokePreview } from '../src/board/StrokePreview.ts'
import { AppFrameClock } from '../src/canvas-engine/appFrameClock.ts'
import { createPencilPath, eraseVectorNode } from '../src/model/vectorDrawing.ts'
import { vectorEraserScope } from '../src/model/vectorEditing.ts'
import { vectorPathBounds, vectorLocalToBoard, synchronizeVectorStroke } from '../src/model/vector.ts'

// Actual production App freehand/camera/listener callbacks, real scheduler and
// real useGestureBoard guard. Only host event delivery/effect timing is controlled.
// These are canonical gesture checks, not a full mounted CanvasPane/native test.
const files = ['src/App.tsx', 'src/board/useGestureBoard.ts', 'src/board/scheduledPointerGesture.ts', 'src/canvas-engine/frameScheduler.ts',
  'src/model/vectorDrawing.ts', 'src/model/vectorEditing.ts', 'src/model/vector.ts', 'src/board/StrokePreview.ts']
const texts = new Map(await Promise.all(files.map(async file => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])))
const sourceHashes = Object.fromEntries([...texts].map(([file, source]) => [file, createHash('sha256').update(source).digest('hex')]))
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const schedulerUrl = url(compile(texts.get('src/canvas-engine/frameScheduler.ts')))
const { scheduledPointerGesture, createInputMetrics } = await import(url(compile(texts.get('src/board/scheduledPointerGesture.ts'))
  .replace(/from ['"]\.\.\/canvas-engine\/frameScheduler['"]/g, `from '${schedulerUrl}'`)))
const hookUrl = url('export const useRef=v=>globalThis.__p0FreehandHooks.ref(v);export const useLayoutEffect=(f,d)=>globalThis.__p0FreehandHooks.effect(f,d);export const useCallback=f=>f;')
const { useGestureBoard } = await import(url(compile(texts.get('src/board/useGestureBoard.ts')).replace(/from ['"]react['"]/g, `from '${hookUrl}'`)))
const ast = ts.createSourceFile('App.tsx', texts.get('src/App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const named = name => {
  let found
  const visit = node => { if (found) return; if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; else ts.forEachChild(node, visit) }
  visit(ast); assert(found, `Actual App callback ${name} missing`); return found.getText(ast)
}
const functions = ['translateVectorPath', 'hasNonIdentityVectorTransform', 'fitEditableVectorPathNode', 'capturePointer', 'publishInputMetrics', 'listenGesture',
  'eventToWorld', 'displayedViewport', 'startFreehand'].map(named).join('\n')
const { makeCallbacks } = await import(url(compile(`export function makeCallbacks(context, helpers) {
  const {boardRef, presentedViewportRef, stageRef, stageBoundsRef, activeGestureCancelRef, frameScheduler, inputMetrics, viewOnly, interactionTool,
    eraserSize, selectedIds, theme, beginBoardPreview, endBoardPreview, onBoardChange, cancelActiveGesture,
    setDrawingNotice,strokePreview,freehandPathRef,setSelectedIds}=context;
  const {scheduledPointerGesture,createPencilPath,eraseVectorNode,vectorEraserScope,vectorPathBounds,transformVectorPaint,synchronizeVectorStroke,rectangleErasureState,eraseRectangleAppearance,isRectangleErasure,captureRectangleErasureCssClip}=helpers;
  ${functions}
  return {startFreehand,eventToWorld};
}`)))
class Host extends EventTarget {
  captured = new Set()
  setPointerCapture(id) { this.captured.add(id) }
  hasPointerCapture(id) { return this.captured.has(id) }
  releasePointerCapture(id) { this.captured.delete(id) }
}
const saved = Object.fromEntries(['window', 'document', '__p0FreehandHooks'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
const install = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
const event = (type, x, y, extra = {}) => {
  const result = new Event(type)
  Object.assign(result, { pointerId: 7, clientX: x, clientY: y, pressure: .5, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra })
  return result
}
const shape = extra => ({ id: 'line', kind: 'shape', shapeType: 'line', title: 'Line', body: '', x: 0, y: 0, width: 200, height: 100,
  strokeWidth: 3, color: '#ef9232', strokeColor: '#2198ff', ...extra })
const board = nodes => ({ id: 'disposable-freehand-board', title: 'Disposable', viewport: { x: 0, y: 0, scale: 1 }, nodes, connectors: [], gridVisible: false })
const checks = [], check = (name, run) => { run(); checks.push(name) }
const near = (a, b, epsilon = 1e-7) => assert(Math.abs(a - b) <= epsilon, `${a} differs from ${b}`)
function fixture({ nodes = [], selectedIds = [], camera = { x: 0, y: 0, scale: 1 }, tool = 'pencil', viewOnly = false, eraserSize = 24 } = {}) {
  const hostWindow = new Host(), hostDocument = new Host(), captureTarget = new Host()
  hostDocument.hidden = false; install('window', hostWindow); install('document', hostDocument)
  let nextFrame = 1, refCursor = 0, effectCursor = 0, persisted = board(nodes)
  const frames = new Map(), refs = [], effects = [], pending = [], commits = [], notices = [], drafts = [], selected = [], presenterLog = []
  const phasedClock = new AppFrameClock({ request: cb => { const id = nextFrame++; frames.set(id, cb); return id }, cancel: id => frames.delete(id) })
  const scheduler = new FrameScheduler({ request: cb => phasedClock.request(cb, 'input'), cancel: phasedClock.cancel })
  const presenter = { present: (...args) => presenterLog.push(['present', ...args]), clear: (...args) => presenterLog.push(['clear', ...args]), repaint: () => {} }
  const boardRef = { current: persisted }, presentedViewportRef = { current: camera }, activeGestureCancelRef = { current: null }
  const stageRef = { current: { dataset: {}, getBoundingClientRect: () => ({ left: 100, top: 200 }),
    querySelector: () => ({ style: { transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` } }) } }
  const hooks = { ref(value) { return refs[refCursor++] ??= { current: value } }, effect(f, deps) {
    const index = effectCursor++, previous = effects[index]
    if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((v, i) => v === previous.deps[i])) return
    pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: f() } })
  } }
  const commit = (next, base) => { commits.push({ next, base }); persisted = next; boardRef.current = next }
  const render = value => { install('__p0FreehandHooks', hooks); refCursor = 0; effectCursor = 0; const result = useGestureBoard(value, commit, presenter); while (pending.length) pending.shift()(); return result }
  const hook = render(persisted)
  const context = { boardRef, presentedViewportRef, stageRef, stageBoundsRef: {current:{left:100,top:200}}, activeGestureCancelRef, frameScheduler: scheduler, inputMetrics: createInputMetrics(),
    viewOnly, interactionTool: tool, eraserSize, selectedIds, theme: 'dark', beginBoardPreview: hook.beginPreview, endBoardPreview: hook.endPreview,
    onBoardChange: hook.change, cancelActiveGesture: () => activeGestureCancelRef.current?.(),
    freehandPathRef: {current:{setAttribute(){}}},
    strokePreview: new StrokePreview({request: cb => phasedClock.request(cb, 'present'),cancel:phasedClock.cancel}, value=>{drafts.push(value);if(drafts.length>16)drafts.shift()}),
    setDrawingNotice: value => notices.push(value), setSelectedIds: value => selected.push(value) }
  const callbacks = makeCallbacks(context, { scheduledPointerGesture, createPencilPath, eraseVectorNode, vectorEraserScope, vectorPathBounds, transformVectorPaint, synchronizeVectorStroke, rectangleErasureState, eraseRectangleAppearance, isRectangleErasure, captureRectangleErasureCssClip })
  const screen = point => ({ x: 100 + camera.x + point.x * camera.scale, y: 200 + camera.y + point.y * camera.scale })
  const down = point => { const p = screen(point); callbacks.startFreehand({ button: 0, pointerId: 7, clientX: p.x, clientY: p.y, currentTarget: captureTarget,
    preventDefault() {}, stopPropagation() {} }) }
  const move = (point, coalesced = []) => { const p = screen(point); const e = event('pointermove', p.x, p.y)
    if (coalesced.length) e.getCoalescedEvents = () => coalesced.map(point => { const p = screen(point); return event('pointermove', p.x, p.y) })
    hostWindow.dispatchEvent(e) }
  const up = (point, extra) => { const p = screen(point); hostWindow.dispatchEvent(event('pointerup', p.x, p.y, extra)) }
  const frame = () => { const list = [...frames.values()]; frames.clear(); for (const run of list) run(16) }
  const external = next => { persisted = next; boardRef.current = next; render(next) }
  const dispose = () => { activeGestureCancelRef.current?.(); scheduler.dispose(); for (const effect of effects) effect?.cleanup?.() }
  return { context, down, move, up, frame, external, dispose, commits, notices, drafts, selected, presenterLog, captureTarget, hostWindow, hostDocument,
    initial: persisted, get current() { return persisted } }
}
const fixtures = []
const own = options => { const f = fixture(options); fixtures.push(f); return f }
try {
  check('coalesced stroke samples queue one preview and cause no canonical commits', () => {
    const f=own();f.down({x:0,y:0});f.move({x:60,y:0},[{x:20,y:40},{x:40,y:-40}]);f.frame();f.frame()
    assert.equal(f.context.strokePreview.metrics.samples,4)
    assert.equal(f.context.strokePreview.metrics.frames,1)
    assert.equal(f.drafts.filter(Boolean).length,1)
    assert.equal(f.commits.length,0)
    f.up({x:80,y:20});f.frame();assert.equal(f.commits.length,1);assert.equal(f.drafts.at(-1),'')
  })
  check('Pencil retains every coalesced corner under one scheduled frame, with final pointer-up position', () => {
    const f = own(); f.down({ x: 0, y: 0 }); f.move({ x: 60, y: 0 }, [{ x: 20, y: 40 }, { x: 40, y: -40 }]); f.up({ x: 80, y: 20 })
    assert.equal(f.commits.length, 1); const path = f.current.nodes[0]
    assert(path.vectorPath.points.length >= 5, 'Intermediate stroke corners were lost to latest-only merging')
    const points = path.vectorPath.points.map(point => vectorLocalToBoard(path, point))
    assert(points.some(p => p.y > 35)); assert(points.some(p => p.y < -35)); near(points.at(-1).x, 80); near(points.at(-1).y, 20)
    assert.equal(f.context.inputMetrics.merged, 0); assert(f.context.inputMetrics.applied >= 4)
    assert.equal(f.captureTarget.captured.size, 0); assert.equal(f.drafts.at(-1).length, 0)
  })
  check('Pencil uses displayed camera for world coordinates and preserves it in canonical commit/history', () => {
    const camera = { x: 37, y: -24, scale: 2 }, f = own({ camera })
    f.down({ x: 10, y: 20 }); f.move({ x: 40, y: 80 }); f.up({ x: 90, y: 30 })
    assert.equal(f.commits.length, 1); assert.deepEqual(f.current.viewport, camera)
    assert.deepEqual(f.commits[0].base.viewport, camera)
    const node = f.current.nodes[0], first = vectorLocalToBoard(node, node.vectorPath.points[0]), last = vectorLocalToBoard(node, node.vectorPath.points.at(-1))
    near(first.x, 10); near(first.y, 20); near(last.x, 90); near(last.y, 30)
  })
  check('Pencil draft frames do not persist and one history baseline preserves unrelated nodes/connectors', () => {
    const image = { id: 'media', kind: 'image', title: 'Preserve', assetId: 'source-media', x: 400, y: 600, width: 100, height: 100 }, f = own({ nodes: [image] })
    const before = JSON.stringify(f.initial); f.down({ x: 0, y: 0 }); f.move({ x: 30, y: 30 }); f.frame()
    assert.equal(f.commits.length, 0); assert.equal(JSON.stringify(f.initial), before)
    f.up({ x: 60, y: 0 }); assert.equal(f.commits.length, 1); assert.deepEqual(f.commits[0].base, f.initial)
    assert.deepEqual(f.current.nodes[0], image); assert.equal(f.current.nodes.length, 2)
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(f.current))), JSON.stringify(f.current))
  })
  check('Eraser follows a coalesced curved sweep instead of the shortcut between dispatch positions', () => {
    const value = shape({ x: 25, y: 20, width: 20, height: 60, vectorPath: { version: 1, closed: false, points: [{ x: 0, y: 0 }, { x: 20, y: 60 }] } })
    const f = own({ nodes: [value], tool: 'erase', eraserSize: 12 }); f.down({ x: 0, y: 0 }); f.move({ x: 60, y: 0 }, [{ x: 30, y: 50 }]); f.up({ x: 80, y: 0 })
    assert.equal(f.commits.length, 1, 'The retained intermediate sweep must erase artwork near the curved turn')
    assert(f.current.nodes.every(node => node.shapeType === 'path')); assert.equal(f.commits[0].base.nodes[0].shapeType, 'line')
  })
  check('Eraser group scope honors inherited locks and keeps selected source media immutable', () => {
    const group = { id: 'group', kind: 'group', title: 'Locked', x: 0, y: 0, width: 200, height: 100, locked: true }, child = shape({ groupId: 'group' })
    const f = own({ nodes: [group, child], selectedIds: ['group'], tool: 'erase' }); f.down({ x: 90, y: 50 }); f.up({ x: 110, y: 50 })
    assert.equal(f.commits.length, 0); assert(f.notices.at(-1).includes('Locked'))
    const media = { id: 'media', kind: 'image', title: 'Source', assetId: 'source', x: 0, y: 0, width: 200, height: 100 }
    const g = own({ nodes: [media, shape()], selectedIds: ['media'], tool: 'erase' }); g.down({ x: 90, y: 50 }); g.up({ x: 110, y: 50 })
    assert.equal(g.commits.length, 0); assert(g.notices.at(-1).includes('source media is preserved'))
  })
  check('Eraser caption refusal survives real callback without a destructive history entry', () => {
    const value = shape({ shapeType: 'ellipse', body: 'Keep visible text' }), f = own({ nodes: [value], tool: 'erase' })
    f.down({ x: 90, y: 50 }); f.up({ x: 110, y: 50 })
    assert.equal(f.commits.length, 0); assert.equal(f.current.nodes[0], value); assert(f.notices.at(-1).includes('Captioned'))
  })
  check('foreign pointer-up cannot finish the drawing transaction', () => {
    const f = own(); f.down({ x: 0, y: 0 }); f.move({ x: 30, y: 30 }); f.up({ x: 50, y: 20 }, { pointerId: 99 })
    assert.equal(f.commits.length, 0); assert.equal(f.captureTarget.captured.size, 1)
    f.up({ x: 60, y: 0 }); assert.equal(f.commits.length, 1)
  })
  check('pointer cancel, blur, lost capture and hidden-document cancellation discard drafts without late replay', () => {
    for (const reason of ['pointercancel', 'blur', 'lostpointercapture', 'visibilitychange']) {
      const f = own(); f.down({ x: 0, y: 0 }); f.move({ x: 30, y: 30 })
      if (reason === 'lostpointercapture') f.captureTarget.dispatchEvent(event(reason, 0, 0))
      else if (reason === 'visibilitychange') { f.hostDocument.hidden = true; f.hostDocument.dispatchEvent(new Event(reason)) }
      else f.hostWindow.dispatchEvent(event(reason, 0, 0))
      f.frame(); f.up({ x: 70, y: 0 }); assert.equal(f.commits.length, 0); assert.equal(f.captureTarget.captured.size, 0)
      assert.equal(f.drafts.at(-1).length, 0); assert.equal(f.context.inputMetrics.cancelled, 1)
    }
  })
  check('external canonical commit and undo replacement survive late freehand pointer-up through the real hook guard', () => {
    const f = own(); f.down({ x: 0, y: 0 }); f.move({ x: 30, y: 30 }); const newer = { ...f.initial, title: 'Newer external state', nodes: [shape({ id: 'external' })] }
    f.external(newer); f.up({ x: 80, y: 0 }); assert.equal(f.commits.length, 0); assert.equal(f.current, newer)
  })
  check('read-only and non-primary pointer-down start no draft/listeners/canonical mutation', () => {
    const f = own({ viewOnly: true }); f.down({ x: 0, y: 0 }); f.move({ x: 30, y: 30 }); f.up({ x: 80, y: 0 })
    assert.equal(f.commits.length, 0); assert.equal(f.captureTarget.captured.size, 0); assert.equal(f.drafts.length, 0)
  })
  check('stroke input queue overload cancels before truncated geometry can be committed', () => {
    const f = own(); f.down({ x: 0, y: 0 }); for (let i = 1; i <= 70; i++) f.move({ x: i, y: i % 2 ? 20 : 0 })
    f.frame(); f.up({ x: 100, y: 10 }); assert.equal(f.commits.length, 0); assert.equal(f.context.inputMetrics.cancelled, 1)
    assert.equal(f.context.inputMetrics.dropped, 1); assert.equal(f.context.inputMetrics.maxPending, 64); assert.equal(f.captureTarget.captured.size, 0)
  })
  check('long freehand4096-sample limit cancels instead of replacing old corners with a false long segment', () => {
    const f = own(); f.down({ x: 0, y: 0 })
    for (let i = 1; i <= 4120; i++) { f.move({ x: i, y: i % 3 * 10 }); if (i % 32 === 0) f.frame() }
    f.frame(); f.up({ x: 4200, y: 10 })
    assert.equal(f.commits.length, 0); assert.equal(f.captureTarget.captured.size, 0); assert.equal(f.drafts.at(-1).length, 0)
    assert(f.notices.some(notice => notice.includes('limit'))); assert.equal(f.context.inputMetrics.dropped, 0)
  })
  check('absolute-position scheduler preserves latest-only merging and bounded overload as its default', () => {
    const f = own(), applied = [], metrics = createInputMetrics()
    scheduledPointerGesture({ initial: { clientX: 0, clientY: 0, pointerId: 7 }, captureTarget: f.captureTarget, scheduler: f.context.frameScheduler, metrics,
      move: sample => applied.push(sample.clientX), finish: () => {}, cancel: () => {}, changed: () => {} })
    for (let i = 1; i <= 100; i++) f.hostWindow.dispatchEvent(event('pointermove', i, 0))
    f.frame(); assert.deepEqual(applied, [100]); assert.equal(metrics.applied, 1); assert.equal(metrics.maxPending, 64); assert.equal(metrics.dropped, 36)
    f.hostWindow.dispatchEvent(event('pointerup', 100, 0)); assert.equal(metrics.cancelled, 0)
  })
} finally {
  for (const f of fixtures) f.dispose()
  for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]
}
const report = { schemaVersion: 1, passed: checks.length, checks, sourceHashes,
  limitations: ['Controlled host event/effect scheduling', 'No mounted CanvasPane or native app', 'JSON portable round trip is not filesystem save/reopen', 'Full Pen/anchor/segment/transform/containment and accessibility acceptance remain open'] }
const dir = new URL('../../docs/engine-p0/2026-10-03/artwork-coverage/', import.meta.url)
await mkdir(dir, { recursive: true }); await writeFile(new URL('FREEHAND_GESTURE_ACCEPTANCE.json', dir), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ passed: checks.length, sourceHashes }))
