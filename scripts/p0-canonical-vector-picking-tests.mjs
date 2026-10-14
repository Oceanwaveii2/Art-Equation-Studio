import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { geometryModuleUrl, vectorModuleUrl, p0GeometrySourceHashes, bindP0Geometry } from './p0-test-module-loader.mjs'

// Actual current model preparation, Boolean resolver and Paper geometry. This
// isolated source is not installed in D, and does not launch/render/open projects.
const source = await readFile(new URL('../src/board/canonicalVectorPicking.ts', import.meta.url), 'utf8')
const require = createRequire(new URL('../package.json', import.meta.url))
const paperUrl = pathToFileURL(require.resolve('paper')).href
const { default: paper } = await import(paperUrl)
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const code = ts.transpileModule(source, { fileName: 'canonicalVectorPicking.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const pickerModuleUrl = url(bindP0Geometry(code.replace(/from ['"]paper['"]/g, `from '${paperUrl}'`)))
const { createCanonicalVectorPicker } = await import(pickerModuleUrl)
const { prepareVelloVectorGeometry: prepare } = await import(geometryModuleUrl)
const { vectorLocalToBoard, vectorSegmentPoint } = await import(vectorModuleUrl)
const checks = []
const check = (name, value) => { assert(value, name); checks.push(name) }
const rectangle = (x, y, width, height) => ({ version: 1, closed: true,
  points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] })
const node = (extra = {}) => ({ id: 'shape', kind: 'shape', shapeType: 'path', title: 'Path', x: 0, y: 0,
  width: 200, height: 200, color: '#ff6633', strokeWidth: 0, vectorPath: rectangle(0, 0, 200, 200), ...extra })
const picker = createCanonicalVectorPicker()
const hit = (value, point, options = {}) => picker.hit(prepare(value), point, { strokeWidth: value.strokeWidth, ...options })

try {
  const curved = node({ vectorPath: { version: 1, closed: true, points: [
    { x: 0, y: 100, handleOut: { x: 50, y: -200 } },
    { x: 200, y: 100, handleIn: { x: -50, y: -200 } }, { x: 100, y: 200 },
  ] } })
  check('cubic interior outside the anchor polygon is selectable', hit(curved, { x: 100, y: 0 }))
  check('curved fill success is not a nearest-stroke false positive', !hit(curved, { x: 100, y: 0 }, { includeFill: false }))
  check('exact outside cubic boundary remains excluded', !hit(curved, { x: 100, y: -70 }))
  check('authored cubic extremum remains selectable', hit(curved, { x: 100, y: -50 }, { includeFill: false }))
  const concave = node({ vectorPath: { version: 1, closed: true, points: [
    { x: 0, y: 100, handleOut: { x: 50, y: 200 } },
    { x: 200, y: 100, handleIn: { x: -50, y: 200 } }, { x: 100, y: 200 },
  ] } })
  check('anchor polygon interior outside the actual cubic fill is excluded', !hit(concave, { x: 100, y: 130 }, { hitRadiusCssPx: 0 }))

  const outer = rectangle(0, 0, 200, 200), inner = rectangle(50, 50, 100, 100)
  const subtraction = node({ vectorBoolean: { operation: 'subtract', operands: [outer, inner] } })
  const subtractBefore = JSON.stringify(subtraction)
  check('actual resolver Boolean hole interior is not picked', !hit(subtraction, { x: 100, y: 100 }))
  check('remaining Boolean filled region is picked', hit(subtraction, { x: 25, y: 100 }))
  check('hole contour still offers its stroke proxy', hit(subtraction, { x: 54, y: 100 }, { includeFill: false }))
  check('Boolean source semantic operands remain exact', JSON.stringify(subtraction) === subtractBefore)
  const empty = node({ vectorBoolean: { operation: 'intersect', operands: [outer, rectangle(300, 0, 100, 100)] } })
  check('resolved empty Boolean never resurrects primary polygon picking', !hit(empty, { x: 100, y: 100 })
    && !hit(empty, { x: 0, y: 0 }))
  check('explicit empty contours remain authoritative', !hit(node({ vectorBoolean: {
    operation: 'subtract', operands: [outer, inner], resolvedPaths: [] } }), { x: 100, y: 100 }))

  const doubleWinding = { version: 1, closed: true, points: [...outer.points, ...outer.points] }
  check('nonzero double winding includes interior', hit(node({ vectorPath: doubleWinding, vectorFillRule: 'nonzero' }), { x: 100, y: 100 }))
  check('evenodd double winding excludes interior', !hit(node({ vectorPath: doubleWinding, vectorFillRule: 'evenodd' }), { x: 100, y: 100 }))
  const sameWinding = prepare(node({ vectorBoolean: { operation: 'subtract', operands: [outer, inner], resolvedPaths: [outer, inner] } }))
  check('compound nonzero respects supplied contour winding', picker.hit(sameWinding, { x: 100, y: 100 }))
  check('compound evenodd observes nested contour parity', !picker.hit(Object.freeze({ ...sameWinding, fillRule: 'evenodd' }), { x: 100, y: 100 }))
  check('closed transparent semantic SVG proxies retain their interior', picker.hitNode(node({ color: 'transparent', opacity: 0 }), { x: 100, y: 100 }))
  check('zero-opacity transparent Boolean proxies preserve their hole', !picker.hitNode({ ...subtraction, color: 'transparent', opacity: 0 }, { x: 100, y: 100 })
    && picker.hitNode({ ...subtraction, color: 'transparent', opacity: 0 }, { x: 25, y: 100 }))
  check('explicit fill policy can restrict picking to contours', !hit(node(), { x: 100, y: 100 }, { includeFill: false }))

  const reflection = node({ x: 10, y: 20, width: 100, height: 80, vectorPath: rectangle(0, 0, 100, 80),
    vectorTransform: { scaleX: -2, scaleY: .5, translateX: 7, translateY: -3 } })
  check('reflected nonuniform interior uses world geometry', hit(reflection, { x: 67, y: 57 }))
  check('reflected world stroke proxy does not scale with local axes', hit(reflection, { x: 173, y: 57 }, { includeFill: false })
    && !hit(reflection, { x: 177, y: 57 }, { includeFill: false }))
  const affine = node({ x: 10, y: 20, width: 100, height: 80, rotation: 27, vectorPath: rectangle(0, 0, 100, 80),
    vectorTransform: { scaleX: -1.5, scaleY: .4, skewX: 32, skewY: -11, translateX: 7, translateY: -3 } })
  const centre = vectorLocalToBoard(affine, { x: 50, y: 40 })
  check('model reflection/skew/rotation interior matches prepared pick geometry', hit(affine, centre))
  const transformedHole = { ...affine, width: 200, height: 200, vectorPath: outer,
    vectorBoolean: { operation: 'subtract', operands: [outer, inner] } }
  check('holes survive full authored affine and reflection', !hit(transformedHole, vectorLocalToBoard(transformedHole, { x: 100, y: 100 }))
    && hit(transformedHole, vectorLocalToBoard(transformedHole, { x: 20, y: 100 })))

  const open = node({ vectorPath: { version: 1, closed: false, points: [
    { x: 0, y: 0, handleOut: { x: 0, y: 200 } }, { x: 200, y: 0, handleIn: { x: 0, y: 200 } },
  ] } })
  check('open cubic does not acquire a fill interior', !hit(open, { x: 100, y: 60 }))
  check('zero-width authored strokes still have the real8CSSpx semantic proxy', hit(open, { x: 100, y: 157 }) && !hit(open, { x: 100, y: 159 }))
  check('world nearest distance honours zoom2 non-scaling radius', hit(open, { x: 100, y: 153 }, { zoomScale: 2 })
    && !hit(open, { x: 100, y: 155 }, { zoomScale: 2 }))
  check('world nearest distance honours zoom.25 non-scaling radius', hit(open, { x: 100, y: 181 }, { zoomScale: .25 })
    && !hit(open, { x: 100, y: 183 }, { zoomScale: .25 }))
  check('authored12CSSpx stroke uses its wider actual hit proxy', hit({ ...open, strokeWidth: 12 }, { x: 100, y: 173 })
    && !hit({ ...open, strokeWidth: 12 }, { x: 100, y: 175 }))
  const thinAffine = node({ width: 100, height: 100, vectorPath: { version: 1, closed: false, points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
    vectorTransform: { scaleX: 3, scaleY: .05 } })
  check('nonuniform local compression cannot shrink the CSS proxy', hit(thinAffine, { x: 50, y: 57 }) && !hit(thinAffine, { x: 50, y: 59 }))
  const rotatedOpen = { ...thinAffine, vectorTransform: undefined, rotation: 45 }
  const nearRotated = { x: 50 - 7 / Math.sqrt(2), y: 50 + 7 / Math.sqrt(2) }
  const farRotated = { x: 50 - 9 / Math.sqrt(2), y: 50 + 9 / Math.sqrt(2) }
  check('rotated nearest world distance is not a local-axis tolerance', hit(rotatedOpen, nearRotated) && !hit(rotatedOpen, farRotated))
  const rotatedCurve = { ...open, rotation: 31, vectorTransform: { scaleX: -1.2, scaleY: .7, skewX: 18 } }
  check('actual model-transformed cubic point is picked after flattening', hit(rotatedCurve,
    vectorLocalToBoard(rotatedCurve, vectorSegmentPoint(open.vectorPath, 0, .35)), { hitRadiusCssPx: .01 }))

  const preparedOpen = prepare(open)
  const newer = { ...open, vectorPath: { ...open.vectorPath, points: open.vectorPath.points.map(point => ({ ...point, y: point.y + 300 })) } }
  const newerPrepared = prepare(newer)
  check('immutable source revision changes cannot reuse stale pick geometry', picker.hit(preparedOpen, { x: 100, y: 150 })
    && !picker.hit(newerPrepared, { x: 100, y: 150 }) && picker.hit(newerPrepared, { x: 100, y: 450 }))
  check('earlier geometry remains valid after later scene identity', picker.hit(preparedOpen, { x: 100, y: 150 }))
  const mutable = { status: 'ready', commands: [['M', 0, 0], ['L', 200, 0]], bounds: { x: 0, y: 0, width: 200, height: 200 },
    fillRule: 'nonzero', hasFill: false, strokeOutsetCssPx: 1 }
  check('mutable hand-authored input is initially evaluated', picker.hit(mutable, { x: 100, y: 0 }))
  mutable.commands[1][2] = 200
  check('mutable input is never cached across an in-place edit', !picker.hit(mutable, { x: 100, y: 0 }) && picker.hit(mutable, { x: 100, y: 100 }))
  const partlyFrozen = Object.freeze({ ...mutable, commands: Object.freeze([['M', 0, 0], ['L', 200, 0]]) })
  check('shallow-frozen commands are still not treated as immutable derivatives', picker.hit(partlyFrozen, { x: 100, y: 0 }))
  partlyFrozen.commands[1][2] = 200
  check('mutable nested command cannot retain an obsolete cached curve', !picker.hit(partlyFrozen, { x: 100, y: 0 }))

  for (const [name, point, options] of [
    ['nonfinite point', { x: Infinity, y: 0 }, {}], ['zero zoom', { x: 0, y: 0 }, { zoomScale: 0 }],
    ['negative zoom', { x: 0, y: 0 }, { zoomScale: -1 }], ['invalid stroke', { x: 0, y: 0 }, { strokeWidth: -2 }],
    ['invalid radius', { x: 0, y: 0 }, { hitRadiusCssPx: NaN }],
  ]) check(`${name} fails closed`, !picker.hit(preparedOpen, point, options))
  check('hidden node wrapper refuses semantic picking', !picker.hitNode({ ...open, hidden: true }, { x: 100, y: 150 }))
  check('unsupported nonpath node wrapper does not guess from frame', !picker.hitNode({ ...open, shapeType: 'rectangle' }, { x: 100, y: 100 }))
  check('invalid prepared commands fail closed', !picker.hit({ ...preparedOpen, commands: [['M', NaN, 0], ['L', 100, 0]] }, { x: 0, y: 0 }))
  check('malformed prepared command grammar fails closed', !picker.hit({ ...preparedOpen, commands: [['L', 0, 0], ['Z']] }, { x: 0, y: 0 }))
  const caption = { ...node(), diagramShape: 'process', body: 'Caption' }
  check('caption metadata can preserve the same actual authored SVG semantic path', picker.hitNode(caption, { x: 100, y: 100 }, 1, prepare(caption)))
} finally { picker.dispose() }

// Observe public scope activation/project ownership to verify lifecycle/cache
// without guessing private Paper internals or exposing product diagnostic APIs.
const scopes = [], originalActivate = paper.PaperScope.prototype.activate
paper.PaperScope.prototype.activate = function () { scopes.push(this); return originalActivate.call(this) }
const owned = createCanonicalVectorPicker(), immutable = prepare(node())
try {
  const start = scopes.length
  check('factory initializes lazily on first valid hit', owned.hit(immutable, { x: 100, y: 100 }) && scopes.length > start)
  const privateScope = scopes.at(-1), activations = scopes.length
  check('reusing immutable geometry does not recompile paths', owned.hit(immutable, { x: 80, y: 80 }) && scopes.length === activations)
  check('detached geometry never accumulates active project layers', privateScope.projects.length === 1 && privateScope.project.layers.length === 0)
  if (privateScope.project.view) check('browser private view has automatic updates disabled', !privateScope.project.view.autoUpdate)
  owned.dispose(); owned.dispose()
  check('disposing owns and removes every private project/tool', privateScope.projects.length === 0 && privateScope.tools.length === 0)
  const disposedAt = scopes.length
  check('disposed picker permanently refuses hits without reinitialization', !owned.hit(immutable, { x: 100, y: 100 })
    && !owned.hitNode(node({ vectorBoolean: { operation: 'subtract', operands: [rectangle(0, 0, 200, 200), rectangle(30, 30, 140, 140)] } }), { x: 20, y: 20 })
    && scopes.length === disposedAt)
} finally { owned.dispose(); paper.PaperScope.prototype.activate = originalActivate }

const originalProject = paper.PaperScope.prototype.Project
paper.PaperScope.prototype.Project = function () { throw new Error('Injected private geometry view setup failure') }
const failedView = createCanonicalVectorPicker()
try {
  check('private view initialization failure returns false without escaping', !failedView.hit(immutable, { x: 100, y: 100 }))
  failedView.dispose()
  paper.PaperScope.prototype.Project = originalProject
  check('disposed setup-failed picker cannot recreate a scope after recovery', !failedView.hit(immutable, { x: 100, y: 100 }))
} finally { failedView.dispose(); paper.PaperScope.prototype.Project = originalProject }

const removalScopes = [], activateBeforeRemoval = paper.PaperScope.prototype.activate
paper.PaperScope.prototype.activate = function () { removalScopes.push(this); return activateBeforeRemoval.call(this) }
const removalFailure = createCanonicalVectorPicker()
try {
  removalFailure.hit(immutable, { x: 100, y: 100 })
  const ownedScope = removalScopes.at(-1)
  ownedScope.project.remove = () => { throw new Error('Injected project.remove failure') }
  removalFailure.dispose()
  check('project removal failure cannot prevent private scope cleanup', ownedScope.projects.length === 0
    && !removalFailure.hit(immutable, { x: 100, y: 100 }))
} finally { removalFailure.dispose(); paper.PaperScope.prototype.activate = activateBeforeRemoval }

// Run the actual exported compatibility function and actual CanvasPane lifecycle
// callback, rather than copying its integration into a test-only helper.
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appAst = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const exportedHit = appAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'hitTestBoardNode')
assert(exportedHit, 'actual App exported picking API exists')
const transpile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { hitTestBoardNode } = await import(url(`import { createCanonicalVectorPicker } from '${pickerModuleUrl}';import {isRectangleErasure} from '${new URL('../src/model/rectangleErasure.ts',import.meta.url).href}';\n${transpile(exportedHit.getText(appAst))}`))
const curvedApiNode = node({ vectorPath: { version: 1, closed: true, points: [
  { x: 0, y: 100, handleOut: { x: 50, y: -200 } }, { x: 200, y: 100, handleIn: { x: -50, y: -200 } }, { x: 100, y: 200 },
] } })
const apiHole = node({ vectorBoolean: { operation: 'subtract', operands: [rectangle(0, 0, 200, 200), rectangle(50, 50, 100, 100)] } })
check('actual exported API picks curved fill beyond anchor polygon', hitTestBoardNode(curvedApiNode, { x: 100, y: 0 }))
check('actual exported API excludes resolved Boolean hole', !hitTestBoardNode(apiHole, { x: 100, y: 100 })
  && hitTestBoardNode(apiHole, { x: 25, y: 100 }))
check('actual exported API retains transparent zero-opacity closed semantic hit', hitTestBoardNode(node({ color: 'transparent', opacity: 0 }), { x: 100, y: 100 }))
check('actual exported API refuses hidden/empty paths', !hitTestBoardNode({ ...curvedApiNode, hidden: true }, { x: 100, y: 0 })
  && !hitTestBoardNode(node({ vectorBoolean: { ...apiHole.vectorBoolean, resolvedPaths: [] } }), { x: 0, y: 0 }))
const ellipse = { ...node(), shapeType: 'ellipse' }
check('actual exported API preserves existing nonpath ellipse behavior', hitTestBoardNode(ellipse, { x: 100, y: 100 })
  && !hitTestBoardNode(ellipse, { x: 0, y: 0 }))

const lifecycleCallbacks = []
const visit = statement => {
  if (ts.isCallExpression(statement) && ts.isIdentifier(statement.expression) && statement.expression.text === 'useLayoutEffect'
    && statement.arguments[0] && ts.isArrowFunction(statement.arguments[0])
    && statement.arguments[0].getText(appAst).includes('canonicalVectorPickerRef')
    && statement.arguments[0].getText(appAst).includes('createCanonicalVectorPicker')) lifecycleCallbacks.push(statement.arguments[0])
  ts.forEachChild(statement, visit)
}
visit(appAst)
assert.equal(lifecycleCallbacks.length, 1, 'one actual CanvasPane picker lifecycle owner')
const lifecycle = await import(url(`import { createCanonicalVectorPicker } from '${pickerModuleUrl}';\n${transpile(`export const canonicalVectorPickerRef = { current: null }; export const setup = ${lifecycleCallbacks[0].getText(appAst)};`)}`))
const cleanupFirst = lifecycle.setup(), firstPicker = lifecycle.canonicalVectorPickerRef.current
check('actual CanvasPane effect creates usable picker', firstPicker.hit(immutable, { x: 100, y: 100 }))
cleanupFirst()
check('actual CanvasPane cleanup clears ref and permanently disposes picker', lifecycle.canonicalVectorPickerRef.current === null
  && !firstPicker.hit(immutable, { x: 100, y: 100 }))
const cleanupSecond = lifecycle.setup(), secondPicker = lifecycle.canonicalVectorPickerRef.current
check('StrictMode second setup creates fresh live picker', secondPicker !== firstPicker && secondPicker.hit(immutable, { x: 100, y: 100 }))
cleanupFirst()
check('obsolete cleanup cannot erase newer picker ref', lifecycle.canonicalVectorPickerRef.current === secondPicker
  && secondPicker.hit(immutable, { x: 100, y: 100 }))
cleanupSecond()
check('actual second cleanup releases its current picker', lifecycle.canonicalVectorPickerRef.current === null
  && !secondPicker.hit(immutable, { x: 100, y: 100 }))

const finishCallbacks = []
const visitFinish = statement => {
  if (ts.isVariableDeclaration(statement) && ts.isIdentifier(statement.name) && statement.name.text === 'finish'
    && statement.initializer && ts.isArrowFunction(statement.initializer)
    && statement.initializer.getText(appAst).includes('canonicalVectorPickerRef')
    && statement.initializer.getText(appAst).includes('const hitCandidates = spatialIndex.query(')) finishCallbacks.push(statement.initializer)
  ts.forEachChild(statement, visitFinish)
}
visitFinish(appAst)
assert.equal(finishCallbacks.length, 1, 'one actual CanvasPane click-fallback finish callback')
const finishModule = await import(url(transpile(`import {isRectangleErasure} from '${new URL('../src/model/rectangleErasure.ts',import.meta.url).href}';export function createFinish(context: any) {
  const { stageBounds, cleanup, cancelled, startClient, marqueeAnchors, presentedViewport, presentedViewportRef,
    eventToWorld, vectorQueryOutsetCssPx, spatialIndex, nodeById, nodePaintOrder, canonicalVectorPickerRef,
    hitTestBoardNode, selectionHandledOnPointerDownRef, marqueeClickSuppressRef, window, setSelectedIds,
    additive, initialSelection, selectedNode, vectorSelectionByMarquee, initialAnchorIndexes, initialSegmentIndexes,
    setSelectedVectorAnchorIndexes, setSelectedVectorPoint, setSelectedVectorSegmentIndexes, selectedByMarquee } = context;
  let end;
  return ${finishCallbacks[0].getText(appAst)};
}`)))
const callbackLine = node({ vectorPath: { version: 1, closed: false, points: [{ x: 0, y: 50 }, { x: 200, y: 50 }] } })
function runActualFinish({ currentScale = 1, capturedScale = 1, point = { x: 100, y: 50 },
  candidates = [{ id: callbackLine.id, hidden: false }], nodes = [callbackLine] } = {}) {
  const queries = [], calls = [], result = [], currentRef = { current: { scale: capturedScale } }
  const worldGeometry = new Map(nodes.map(n => [n.id, prepare(n)])), localPicker = createCanonicalVectorPicker()
  const pointer = { clientX: point.x * currentScale, clientY: point.y * currentScale }
  const context = {
    stageBounds: { left: 0, top: 0 }, cleanup: () => undefined, cancelled: false, startClient: { x: pointer.clientX, y: pointer.clientY },
    marqueeAnchors: false, presentedViewport: { scale: capturedScale }, presentedViewportRef: currentRef,
    eventToWorld: (x, y) => ({ x: x / currentRef.current.scale, y: y / currentRef.current.scale }),
    vectorQueryOutsetCssPx: 360,
    spatialIndex: { query: bounds => { queries.push(bounds); return candidates },
      get: id => ({ preparedVectorGeometry: worldGeometry.get(id) }) },
    nodeById: new Map(nodes.map(n => [n.id, n])), nodePaintOrder: new Map(nodes.map((n, i) => [n.id, i])),
    canonicalVectorPickerRef: { current: { hitNode: (n, p, scale, geometry) => {
      calls.push({ id: n.id, point: p, scale, geometry }); return localPicker.hitNode(n, p, scale, geometry)
    } } }, hitTestBoardNode,
    selectionHandledOnPointerDownRef: { current: false }, marqueeClickSuppressRef: { current: false },
    window: { setTimeout: () => 1 }, setSelectedIds: value => result.push(value), additive: false, initialSelection: [],
    selectedNode: undefined, vectorSelectionByMarquee: () => ({ anchors: [], segments: [] }), initialAnchorIndexes: [], initialSegmentIndexes: [],
    setSelectedVectorAnchorIndexes: () => undefined, setSelectedVectorPoint: () => undefined,
    setSelectedVectorSegmentIndexes: () => undefined, selectedByMarquee: () => [],
  }
  const finish = finishModule.createFinish(context)
  // Change the presented camera after the callback was captured, as an active
  // native pan/zoom does while the gesture remains alive.
  currentRef.current = { scale: currentScale }
  try { finish(pointer); return { queries, calls, result, worldGeometry } } finally { localPicker.dispose() }
}
const highZoomFinish = runActualFinish({ capturedScale: .25, currentScale: 2, point: { x: 100, y: 55 } })
check('actual pointerup query follows current presented zoom after captured-camera change', highZoomFinish.queries[0].width === 360
  && highZoomFinish.queries[0].x === -80)
check('actual pointerup canonical stroke tolerance uses the same current camera as world conversion', highZoomFinish.calls[0].scale === 2
  && highZoomFinish.calls[0].point.y === 55 && highZoomFinish.result.at(-1).length === 0)
check('actual pointerup consumes the indexed immutable derivative', highZoomFinish.calls[0].geometry === highZoomFinish.worldGeometry.get(callbackLine.id))
const lowZoomFinish = runActualFinish({ capturedScale: 2, currentScale: .25, point: { x: 100, y: 70 } })
check('actual pointerup query expands with current low zoom instead of stale captured zoom', lowZoomFinish.queries[0].width === 2880)
check('actual pointerup low-zoom CSS hit proxy remains selectable', lowZoomFinish.calls[0].scale === .25
  && lowZoomFinish.result.at(-1).join() === callbackLine.id)
const visibleLine = { ...callbackLine, id: 'visible-child' }, hiddenChild = { ...callbackLine, id: 'hidden-ancestor-child', hidden: false }
const hiddenFinish = runActualFinish({ nodes: [visibleLine, hiddenChild], candidates: [
  { id: visibleLine.id, hidden: false }, { id: hiddenChild.id, hidden: true }], point: { x: 100, y: 50 } })
check('actual pointerup suppresses inherited-hidden candidates before raw-model picking', hiddenFinish.calls.map(call => call.id).join() === visibleLine.id
  && hiddenFinish.result.at(-1).join() === visibleLine.id)
const rawHiddenFinish = runActualFinish({ nodes: [visibleLine, { ...hiddenChild, hidden: true }], candidates: [
  { id: visibleLine.id, hidden: false }, { id: hiddenChild.id, hidden: false }] })
check('actual pointerup preserves raw-hidden filtering too', rawHiddenFinish.calls.map(call => call.id).join() === visibleLine.id
  && rawHiddenFinish.result.at(-1).join() === visibleLine.id)

const marqueeCallbacks = []
const visitMarquee = statement => {
  if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'selectedByMarquee') marqueeCallbacks.push(statement)
  ts.forEachChild(statement, visitMarquee)
}
visitMarquee(appAst)
assert.equal(marqueeCallbacks.length, 1, 'one actual CanvasPane marquee selector')
const marqueeModule = await import(url(transpile(`export function createMarquee(context: any) {
  const { eventToWorld, vectorQueryOutsetCssPx, presentedViewportRef, spatialIndex, stageRef, CSS } = context;
  ${marqueeCallbacks[0].getText(appAst)}
  return selectedByMarquee;
}`)))
const clientRect = (left, top, right, bottom) => ({ left, top, right, bottom })
const renderedElement = ({ path, caption, frame = caption ?? path }) => ({
  getBoundingClientRect: () => frame,
  querySelector: selector => selector === '.diagram-caption-svg' ? caption && { getBoundingClientRect: () => caption }
    : selector === '.node-vector-shape > g' ? path && { getBoundingClientRect: () => path } : null,
})
const marqueeFixture = ({ objects, elements, scale = 1 }) => {
  const queries = [], lookedUp = []
  const select = marqueeModule.createMarquee({
    eventToWorld: (x, y) => ({ x: x / scale, y: y / scale }), vectorQueryOutsetCssPx: 360,
    presentedViewportRef: { current: { scale } }, spatialIndex: { query: bounds => { queries.push(bounds); return objects } },
    stageRef: { current: { querySelector: selector => {
      const id = selector.match(/data-node-id="([^"]+)"/)?.[1]; lookedUp.push(id); return elements.get(id)
    } } }, CSS: { escape: value => value },
  })
  return { select, queries, lookedUp }
}
const captionCandidate = { id: 'caption-union', hidden: false, preparedVectorGeometry: prepare(node()) }
const captionMarquee = marqueeFixture({ objects: [captionCandidate], elements: new Map([[captionCandidate.id, renderedElement({
  path: clientRect(0, 0, 100, 100), caption: clientRect(1000, 1000, 1100, 1100) })]]) })
check('actual enclosing marquee requires both translated path and caption viewport', captionMarquee.select({ x: -1, y: -1 }, { x: 101, y: 101 }).length === 0
  && captionMarquee.select({ x: -1, y: -1 }, { x: 1101, y: 1101 }).join() === captionCandidate.id)
check('actual crossing marquee intersects translated path independently of distant caption frame', captionMarquee.select({ x: 120, y: 120 }, { x: 80, y: 80 }).join() === captionCandidate.id)
check('actual crossing marquee also intersects the independent caption viewport', captionMarquee.select({ x: 1120, y: 1120 }, { x: 1080, y: 1080 }).join() === captionCandidate.id)
const emptyGeometry = prepare(node({ vectorBoolean: { operation: 'subtract',
  operands: [rectangle(0, 0, 200, 200), rectangle(0, 0, 200, 200)], resolvedPaths: [] } }))
const emptyCaptionCandidate = { id: 'empty-caption-marquee', hidden: false, preparedVectorGeometry: emptyGeometry }
const pureEmptyCandidate = { ...emptyCaptionCandidate, id: 'pure-empty-marquee' }
const emptyMarquee = marqueeFixture({ objects: [emptyCaptionCandidate, pureEmptyCandidate], elements: new Map([
  [emptyCaptionCandidate.id, renderedElement({ path: clientRect(-5000, -5000, 5000, 5000), caption: clientRect(200, 200, 300, 300) })],
  [pureEmptyCandidate.id, renderedElement({ path: clientRect(-5000, -5000, 5000, 5000) })],
]) })
check('actual empty Boolean caption remains selectable through its visible viewport', emptyMarquee.select({ x: 190, y: 190 }, { x: 310, y: 310 }).join() === emptyCaptionCandidate.id)
check('actual empty Boolean path cannot resurrect a phantom SVG group marquee hit', emptyMarquee.select({ x: 110, y: 110 }, { x: 90, y: 90 }).length === 0)
const inheritedHiddenCandidate = { ...captionCandidate, id: 'hidden-ancestor-marquee', hidden: true }
const hiddenMarquee = marqueeFixture({ objects: [inheritedHiddenCandidate, captionCandidate], elements: new Map([
  [inheritedHiddenCandidate.id, renderedElement({ path: clientRect(0, 0, 100, 100) })],
  [captionCandidate.id, renderedElement({ path: clientRect(0, 0, 100, 100) })],
]) })
check('actual marquee suppresses inherited-hidden artwork before DOM exact phase', hiddenMarquee.select({ x: -1, y: -1 }, { x: 101, y: 101 }).join() === captionCandidate.id
  && !hiddenMarquee.lookedUp.includes(inheritedHiddenCandidate.id))
const zoomMarquee = marqueeFixture({ objects: [], elements: new Map(), scale: 2 })
zoomMarquee.select({ x: 20, y: 40 }, { x: 60, y: 80 })
check('actual marquee broad phase uses the same presented zoom for world conversion and padding', zoomMarquee.queries[0].x === -170
  && zoomMarquee.queries[0].y === -160 && zoomMarquee.queries[0].width === 380 && zoomMarquee.queries[0].height === 380)

console.log(JSON.stringify({ passed: true, checks: checks.length,
  sourceHashes: { ...p0GeometrySourceHashes, canonicalVectorPicking: createHash('sha256').update(source).digest('hex'),
    App: createHash('sha256').update(appSource).digest('hex') },
  limits: ['Exact model-prepared cubic/Boolean winding and nearest-world-curve semantic proximity; no display-pixel alpha picking.',
    'Default stroke proximity is a round tube; exact SVG cap/miter pixel coverage is not claimed.',
    'One lazy private Paper1px view per host in a browser, autoUpdate disabled/paused, no draw/readback; detached weak-cache geometry and full scope/project disposal.',
    'Actual production utility and extracted App integration; native picking and physical pointer acceptance remain parent verification.'] }, null, 2))
