import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { geometryModuleUrl, p0GeometrySourceHashes, bindP0Geometry } from './p0-test-module-loader.mjs'

// Exercise actual production derivatives, App callbacks/JSX and the pinned
// genuine Vello CPU. No projects, native application launch or GPU readbacks.
const require = createRequire(new URL('../package.json', import.meta.url))
const { renderToStaticMarkup } = require('react-dom/server')
const paths = ['src/App.tsx', 'src/board/artEquationCanvasAdapter.ts', 'src/board/diagramStructureCore.ts',
  'src/canvasTheme.ts', 'src/board/canonicalVectorPicking.ts', 'src/board/velloEligibility.ts',
  'src/board/VelloBoardBackdrop.tsx', 'src/canvas-engine/spatialIndex.ts']
const sources = new Map(await Promise.all(paths.map(async path => [path, await readFile(new URL(`../${path}`, import.meta.url), 'utf8')])))
const sourceHashes = { ...p0GeometrySourceHashes, ...Object.fromEntries([...sources].map(([file, source]) =>
  [file, createHash('sha256').update(source).digest('hex')])) }
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = (source, jsx = false) => ts.transpileModule(source, { fileName: jsx ? 'actual.tsx' : 'actual.ts', compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
const coreUrl = url(compile(sources.get('src/board/diagramStructureCore.ts')))
const themeUrl = url(compile(sources.get('src/canvasTheme.ts')))
const { createArtEquationCanvasScene: project } = await import(url(compile(sources.get('src/board/artEquationCanvasAdapter.ts'))
  .replace(/from ['"]\.\/velloVectorGeometry['"]/g, `from '${geometryModuleUrl}'`)
  .replace(/from ['"]\.\/diagramStructureCore['"]/g, `from '${coreUrl}'`)
  .replace(/from ['"]\.\.\/canvasTheme['"]/g, `from '${themeUrl}'`)))
const { prepareVelloVectorGeometry: prepare } = await import(geometryModuleUrl)
const pickerUrl = url(bindP0Geometry(compile(sources.get('src/board/canonicalVectorPicking.ts'))
  .replace(/from ['"]paper['"]/g, `from '${pathToFileURL(require.resolve('paper')).href}'`)))
const { createCanonicalVectorPicker } = await import(pickerUrl)
const eligibilityUrl = url(compile(sources.get('src/board/velloEligibility.ts')))
const { eligibleVelloObjects: eligible } = await import(eligibilityUrl)
const { UniformGridSpatialIndex } = await import(url(compile(sources.get('src/canvas-engine/spatialIndex.ts'))))
const ast = ts.createSourceFile('App.tsx', sources.get('src/App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const find = (tree, predicate) => {
  let result
  const visit = node => { if (result) return; if (predicate(node)) result = node; else ts.forEachChild(node, visit) }
  visit(tree); assert(result, 'Actual App oracle source not found'); return result.getText(tree)
}
const named = (tree, name) => find(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === name)
const directSelection = named(ast, 'directSelectionPath')
const actualLine = find(ast, node => ts.isArrowFunction(node) && !node.parameters.length && node.body.getText(ast).includes('className="shape-arrow-base"'))
const { renderActualLine } = await import(url(compile(`${directSelection}\nexport const renderActualLine = (node) => (${actualLine})()`, true)
  .replace(/from ["']react\/jsx-runtime["']/g, `from '${pathToFileURL(require.resolve('react/jsx-runtime')).href}'`)))
const { hitTestBoardNode } = await import(url(`import { createCanonicalVectorPicker } from '${pickerUrl}';import {isRectangleErasure} from '${new URL('../src/model/rectangleErasure.ts',import.meta.url).href}';\n${compile(named(ast, 'hitTestBoardNode'))}`))
const backdropAst = ts.createSourceFile('backdrop.tsx', sources.get('src/board/VelloBoardBackdrop.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const { velloBoardSnapshot } = await import(url(`import { eligibleVelloObjects } from '${eligibilityUrl}';\n${compile(`${named(backdropAst, 'commands')}\n${named(backdropAst, 'velloBoardSnapshot')}`)}`))
const checks = [], check = (name, execute) => { execute(); checks.push(name) }
const line = (extra = {}) => ({ id: 'line', kind: 'shape', shapeType: 'line', title: 'Line', body: '',
  x: 0, y: 0, width: 100, height: 80, strokeColor: '#ff0000', strokeWidth: 20, ...extra })
const anchors = (...points) => ({ version: 1, closed: false, points })
const horizontal = line({ vectorPath: anchors({ x: 20, y: 40 }, { x: 80, y: 40 }) })
const scene = nodes => project({ id: 'disposable-production-lines', nodes, connectors: [], gridVisible: false }, [], { background: '#00000000', grid: '#444444' })
const object = value => scene([value]).objects[0]
const ready = value => { const result = prepare(value); assert.equal(result.status, 'ready'); return result }
const close = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`)
const attrs = (value, cls) => {
  const tag = renderToStaticMarkup(renderActualLine(value)).match(new RegExp(`<line\\b[^>]*class="${cls}"[^>]*>`))?.[0]
  assert(tag); return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]))
}
const picker = createCanonicalVectorPicker()
try {
  check('actual App first/last anchors match prepared world commands, with ignored intermediate handles', () => {
    const value = line({ width: 300, height: 80, vectorPath: { version: 1, closed: true, points: [
      { x: -10, y: 70, handleOut: { x: 300, y: -200 } }, { x: 800, y: 900 }, { x: 290, y: 10, handleIn: { x: -90, y: 500 } }] } })
    const a = attrs(value, 'shape-arrow-base'), geometry = ready(value)
    assert.equal(geometry.commands.length, 2)
    ;[[Number(a.x1) * value.width / 100, Number(a.y1) * value.height / 100],
      [Number(a.x2) * value.width / 100, Number(a.y2) * value.height / 100]].forEach((point, i) => point.forEach((v, j) => close(geometry.commands[i][j + 1], v)))
  })
  check('missing-path diagonal reaches canonical exported App picking', () => {
    const value = line({ x: 10, y: 20, width: 300, height: 50 })
    assert.deepEqual(ready(value).commands, [['M', 10, 20], ['L', 310, 70]])
    assert(hitTestBoardNode(value, { x: 160, y: 45 })); assert(!hitTestBoardNode(value, { x: 160, y: 120 }))
  })
  check('effective paint and wider semantic stroke agree with actual JSX without editing styles', () => {
    for (const width of [0, 2, 5, 20, 200]) {
      const value = line({ strokeWidth: width, strokeColor: '', vectorStrokeCap: 'round', vectorStrokeJoin: 'bevel' })
      const before = JSON.stringify(value), actual = attrs(value, 'shape-arrow-base'), hit = attrs(value, 'shape-hit-area'), prepared = ready(value), projected = object(value)
      assert.equal(prepared.effectivePaint.stroke, actual.stroke); assert.equal(projected.appearance.strokeWidth, Number(actual['stroke-width']))
      assert.equal(prepared.hitOutsetCssPx * 2, Number(hit['stroke-width'])); assert.equal(projected.appearance.vectorStrokeCap, 'butt')
      assert.equal(projected.appearance.vectorStrokeJoin, 'miter'); assert.equal(actual['marker-end'], undefined)
      assert.equal(actual['vector-effect'], 'non-scaling-stroke'); assert.equal(JSON.stringify(value), before)
    }
  })
  check('rotation and CSS reversal compose once at the saved frame center', () => {
    const value = line({ x: 10, y: 20, body: 'reverse', rotation: 90, vectorPath: anchors({ x: 10, y: 20 }, { x: 90, y: 50 }) })
    assert(renderToStaticMarkup(renderActualLine(value)).includes('node-vector-shape reverse'))
    ;[[40, 20], [70, 100]].forEach((point, i) => point.forEach((v, j) => close(ready(value).commands[i][j + 1], v)))
  })
  check('complete prepared line derivative is deeply immutable', () => {
    const geometry = ready(horizontal)
    for (const part of [geometry, geometry.commands, ...geometry.commands, geometry.bounds, geometry.effectivePaint]) assert(Object.isFrozen(part))
  })
  check('invalid frames, paint and endpoints fail closed with bounded coordinates', () => {
    for (const extra of [{ width: 0 }, { height: -1 }, { x: NaN }, { x: 1e10 }, { rotation: Infinity },
      { strokeWidth: -1 }, { strokeWidth: Infinity }, { strokeWidth: 1e9 }, { opacity: 2 }, { opacity: NaN }, { strokeColor: null },
      { vectorPath: anchors() }, { vectorPath: anchors({ x: 0, y: 0 }, { x: NaN, y: 2 }) }]) assert.equal(prepare(line(extra)).status, 'invalid')
  })
  check('invalid line inputs never fall through exported picking to a saved rectangle', () => {
    for (const extra of [{ vectorPath: anchors({ x: 0, y: 0 }, { x: Infinity, y: 2 }) },
      { strokeWidth: -1 }, { opacity: NaN }]) assert(!hitTestBoardNode(line(extra), { x: 50, y: 40 }))
  })
  check('arrows and unresolved paint/semantic metadata stay outside this engine slice', () => {
    for (const extra of [{ shapeType: 'arrow', arrowMotion: { enabled: false } }, { vectorTransform: {} },
      { vectorBoolean: {} }, { diagramShape: 'process' }, { strokeColor: 'var(--stroke)' }, { strokeColor: 'currentColor' },
      { strokeColor: 'url(#gradient)' }]) assert.equal(prepare(line(extra)).status, 'unsupported')
  })
  check('unsupported but DOM-renderable lines retain the previous semantic frame fallback', () => {
    for (const extra of [{ strokeColor: 'currentColor' }, { vectorTransform: {} }, { vectorBoolean: {} }]) {
      const value = { ...horizontal, ...extra }
      assert(hitTestBoardNode(value, { x: 50, y: 40 })); assert(!hitTestBoardNode(value, { x: 1000, y: 1000 }))
      assert.equal(eligible(scene([value, { ...horizontal, id: 'other', x: 1000 }]), [], 1, true).length, 0)
    }
  })
  check('parented geometry remains board-space while parent paint stays DOM-owned', () => {
    const parent = { id: 'group', kind: 'group', title: 'Group', x: 8000, y: 8000, width: 200, height: 200 }
    const child = { ...horizontal, groupId: parent.id }
    assert.deepEqual(ready(child).commands, ready(horizontal).commands)
    const snapshot = scene([parent, child]), indexed = snapshot.objects.find(o => o.id === child.id)
    assert.equal(indexed.parentId, parent.id); assert.equal(eligible(snapshot, [], 1, true).length, 0)
    assert(hitTestBoardNode(child, { x: 40, y: 40 }))
    assert(scene([{ ...parent, hidden: true }, child]).objects.find(o => o.id === child.id).hidden)
  })
  check('actual serializer applies effective width/cap/fill/opacity and identity transform', () => {
    const value = { ...horizontal, rotation: 90, opacity: .5, vectorStrokeCap: 'square', color: '#ff00ff' }
    for (const scale of [.25, 1, 4]) {
      const parsed = JSON.parse(velloBoardSnapshot(scene([value]), [], scale, true).json).objects[0]
      assert.deepEqual(parsed.transform, [1, 0, 0, 1, 0, 0]); assert.equal(parsed.opacity, .5)
      assert.equal(parsed.payload.strokeWidth * scale, 13); assert.equal(parsed.payload.vectorStrokeCap, 'butt')
      assert.equal(parsed.payload.vectorStrokeJoin, 'miter'); assert.equal(parsed.payload.fill, '#00000000')
      assert.deepEqual(parsed.payload.commands, ready(value).commands)
    }
  })
  check('horizontal and vertical centerlines inflate into eligible paint envelopes', () => {
    for (const value of [horizontal, line({ vectorPath: anchors({ x: 40, y: 0 }, { x: 40, y: 80 }) })]) assert.equal(eligible(scene([value]), [], 1, true).length, 1)
  })
  check('actual mixed paint exclusion propagates and respects distant cards', () => {
    const card = { id: 'card', kind: 'text', title: 'Card', x: 30, y: 30, width: 40, height: 40 }
    const chain = { ...horizontal, id: 'chain', x: 65 }
    assert.equal(eligible(scene([horizontal, card, chain]), [], 1, true).length, 0)
    assert.deepEqual(eligible(scene([horizontal, { ...card, x: 1000, y: 1000 }]), [], 1, true).map(o => o.id), ['line'])
  })
  check('selection without live scene is conservative; locks never suppress paint', () => {
    const value = { ...horizontal, locked: true }, snapshot = scene([value])
    assert.equal(eligible(snapshot, [value.id], 1, false).length, 0); assert.equal(eligible(snapshot, [value.id], 1, true).length, 1)
  })
  check('semantic line body is wide and butt-capped at several current zooms', () => {
    for (const zoom of [.5, 1, 4]) {
      assert(picker.hitNode(horizontal, { x: 50, y: 40 + 39 / zoom }, zoom)); assert(!picker.hitNode(horizontal, { x: 50, y: 40 + 41 / zoom }, zoom))
      assert(!picker.hitNode(horizontal, { x: 19, y: 40 }, zoom)); assert(!picker.hitNode(horizontal, { x: 81, y: 40 }, zoom))
    }
  })
  check('zero visible width/color/opacity retain noncoincident semantic area', () => {
    const value = { ...horizontal, strokeWidth: 0, opacity: 0, strokeColor: 'transparent' }
    assert(hitTestBoardNode(value, { x: 50, y: 47 })); assert(!hitTestBoardNode(value, { x: 50, y: 49 }))
    assert(!hitTestBoardNode({ ...value, hidden: true }, { x: 50, y: 40 }))
  })
  check('coincident butt line has no semantic dot', () => {
    assert(!picker.hitNode(line({ vectorPath: anchors({ x: 20, y: 40 }, { x: 20, y: 40 }) }), { x: 20, y: 40 }))
  })
  check('malformed ready line commands fail closed without throwing', () => {
    const base = ready(horizontal)
    for (const commands of [[], [['M', 20, 40]], [['M', 20], ['L', 80, 40]], [['L', 20, 40], ['M', 80, 40]],
      [['M', NaN, 40], ['L', 80, 40]], [['M', 20, 40, 99], ['L', 80, 40]]]) assert(!picker.hit({ ...base, commands }, { x: 50, y: 40 }))
  })

  // Actual App query memo, pointerup and marquee callbacks: no copied reducer.
  const memo = find(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'vectorQueryOutsetCssPx')
  const { marginFor } = await import(url(compile(`export function marginFor(canvasScene) { const useMemo = fn => fn(); const ${memo}; return vectorQueryOutsetCssPx; }`)))
  const wide = line({ strokeWidth: 200, x: 1000, y: 1000, vectorPath: anchors({ x: -1000, y: -1000 }, { x: -900, y: -1000 }) })
  const wideScene = scene([wide]), index = new UniformGridSpatialIndex(wideScene.objects), margin = marginFor(wideScene)
  check('actual query memo includes wider semantic bounds rather than paint outset', () => {
    assert.equal(margin, 400); assert.equal(ready(wide).strokeOutsetCssPx, 66)
    assert.equal(index.query({ x: 50 - 66, y: 300 - 66, width: 132, height: 132 }).length, 0)
    assert.equal(index.query({ x: 50 - margin, y: 300 - margin, width: margin * 2, height: margin * 2 })[0].id, wide.id)
  })
  check('out-of-frame world endpoints drive index and same-ID immutable preview forks', () => {
    assert.deepEqual(object(wide).bounds, { x: 0, y: 0, width: 100, height: 0 })
    const changed = { ...wide, vectorPath: anchors({ x: -500, y: -1000 }, { x: -400, y: -1000 }) }
    const next = index.fork(scene([changed]).objects)
    assert.equal(next.query({ x: 0, y: 0, width: 100, height: 0 }).length, 0)
    assert.equal(index.query({ x: 0, y: 0, width: 100, height: 0 })[0].id, wide.id)
  })
  const finish = find(ast, node => ts.isArrowFunction(node) && node.body.getText(ast).includes('const hitCandidates = spatialIndex.query('))
  const { runFinish } = await import(url(compile(`import {isRectangleErasure} from '${new URL('../src/model/rectangleErasure.ts',import.meta.url).href}';export function runFinish(context) {
    const { stageBounds, cleanup, cancelled, startClient, marqueeAnchors, presentedViewportRef, eventToWorld,
      vectorQueryOutsetCssPx, spatialIndex, nodeById, nodePaintOrder, canonicalVectorPickerRef, hitTestBoardNode,
      selectionHandledOnPointerDownRef, marqueeClickSuppressRef, window, setSelectedIds, additive, initialSelection,
      selectedNode, vectorSelectionByMarquee, initialAnchorIndexes, initialSegmentIndexes, setSelectedVectorAnchorIndexes,
      setSelectedVectorPoint, setSelectedVectorSegmentIndexes, selectedByMarquee } = context;
    let end; return ${finish}; }`)))
  check('actual App pointerup selects ordinary lines beyond paint bounds at the current camera', () => {
    const picked = [], current = { current: { scale: 2 } }, pointer = { clientX: 100, clientY: 600 }
    runFinish({ stageBounds: { left: 0, top: 0 }, cleanup() {}, cancelled: false, startClient: { x: 100, y: 600 }, marqueeAnchors: false,
      presentedViewportRef: current, eventToWorld: (x, y) => ({ x: x / current.current.scale, y: y / current.current.scale }),
      vectorQueryOutsetCssPx: margin, spatialIndex: index, nodeById: new Map([[wide.id, wide]]), nodePaintOrder: new Map([[wide.id, 0]]),
      canonicalVectorPickerRef: { current: picker }, hitTestBoardNode, selectionHandledOnPointerDownRef: {}, marqueeClickSuppressRef: {},
      window: { setTimeout() {} }, setSelectedIds: value => picked.push(value), additive: false, initialSelection: [],
      selectedByMarquee: () => [], selectedNode: undefined }) (pointer)
    assert.deepEqual(picked.at(-1), []) // 300 world units is outside the 200-world-unit proxy at scale2.
    current.current.scale = 1; pointer.clientX = 50; pointer.clientY = 300
    runFinish({ stageBounds: { left: 0, top: 0 }, cleanup() {}, cancelled: false, startClient: { x: 50, y: 300 }, marqueeAnchors: false,
      presentedViewportRef: current, eventToWorld: (x, y) => ({ x, y }), vectorQueryOutsetCssPx: margin, spatialIndex: index,
      nodeById: new Map([[wide.id, wide]]), nodePaintOrder: new Map([[wide.id, 0]]), canonicalVectorPickerRef: { current: picker }, hitTestBoardNode,
      selectionHandledOnPointerDownRef: {}, marqueeClickSuppressRef: {}, window: { setTimeout() {} }, setSelectedIds: value => picked.push(value),
      additive: false, initialSelection: [], selectedByMarquee: () => [], selectedNode: undefined }) (pointer)
    assert.deepEqual(picked.at(-1), [wide.id])
  })
  const marqueeSource = named(ast, 'selectedByMarquee')
  const { marqueeFor } = await import(url(compile(`export function marqueeFor(context) {
    const { eventToWorld, vectorQueryOutsetCssPx, presentedViewportRef, spatialIndex, stageRef, CSS } = context;
    ${marqueeSource}; return selectedByMarquee; }`)))
  const lineElement = { getBoundingClientRect: () => ({ left: 1000, top: 1000, right: 1100, bottom: 1080 }),
    querySelector: selector => selector === '.node-vector-shape > .shape-arrow-base' ? { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 0 }) } : null }
  const select = marqueeFor({ eventToWorld: (x, y) => ({ x, y }), vectorQueryOutsetCssPx: margin, presentedViewportRef: { current: { scale: 1 } },
    spatialIndex: index, stageRef: { current: { querySelector: () => lineElement } }, CSS: { escape: value => value } })
  check('actual marquee uses direct-line geometry rather than distant saved rectangle', () => {
    assert.deepEqual(select({ x: -1, y: -1 }, { x: 101, y: 1 }), [wide.id])
    assert.deepEqual(select({ x: 990, y: 990 }, { x: 1110, y: 1090 }), [])
  })
  check('coincident and inherited-hidden lines never create marquee phantom hits', () => {
    const coincident = object(line({ vectorPath: anchors({ x: 20, y: 40 }, { x: 20, y: 40 }) }))
    const hidden = { ...object(horizontal), id: 'hidden-child', hidden: true }
    const choose = marqueeFor({ eventToWorld: (x, y) => ({ x, y }), vectorQueryOutsetCssPx: margin,
      presentedViewportRef: { current: { scale: 1 } }, spatialIndex: { query: () => [coincident, hidden] },
      stageRef: { current: { querySelector: () => lineElement } }, CSS: { escape: value => value } })
    assert.deepEqual(choose({ x: -2000, y: -2000 }, { x: 2000, y: 2000 }), [])
  })
  check('coincident captioned line retains independent DOM text marquee and no engine ownership', () => {
    const value = line({ diagramShape: 'process', body: 'Caption', vectorPath: { version: 1, closed: true,
      points: [{ x: 20, y: 40 }, { x: 80, y: 40 }, { x: 20, y: 40 }] } })
    const snapshot = scene([value]), candidate = snapshot.objects[0]
    assert(candidate.hasDiagramCaption); assert.equal(candidate.preparedVectorGeometry.status, 'ready')
    assert.equal(eligible(snapshot, [], 1, true).length, 0)
    const captionRect = { left: 200, top: 200, right: 300, bottom: 280 }
    const choose = marqueeFor({ eventToWorld: (x, y) => ({ x, y }), vectorQueryOutsetCssPx: margin,
      presentedViewportRef: { current: { scale: 1 } }, spatialIndex: { query: () => [candidate] },
      stageRef: { current: { querySelector: () => ({ ...lineElement, querySelector: selector => selector === '.diagram-caption-svg'
        ? { getBoundingClientRect: () => captionRect } : lineElement.querySelector(selector) }) } }, CSS: { escape: value => value } })
    assert.deepEqual(choose({ x: 190, y: 190 }, { x: 310, y: 290 }), [value.id])
  })
} finally { picker.dispose() }

const wasmModule = await import(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm.js', import.meta.url))
const wasmBytes = await readFile(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm', import.meta.url))
await wasmModule.default({ module_or_path: wasmBytes })
const raster = (value, camera = 1, resolution = 1) => wasmModule.render_cpu_snapshot(128 * resolution, 128 * resolution,
  velloBoardSnapshot(scene([value]), [], camera, true).json, camera * resolution, 0, 0)
const pixel = (bytes, x, y, width = 128) => [...bytes.slice((y * width + x) * 4, (y * width + x) * 4 + 4)]
check('genuine Vello CPU matches effective 13px red body and butt endpoints', () => {
  const image = raster(horizontal)
  assert.deepEqual(pixel(image, 40, 40), [255, 0, 0, 255]); assert.equal(pixel(image, 40, 30)[3], 0)
  assert.equal(pixel(image, 40, 35)[3], 255); assert.equal(pixel(image, 40, 32)[3], 0)
  assert(pixel(image, 40, 33)[3] >= 127 && pixel(image, 40, 33)[3] <= 128)
  assert.equal(pixel(image, 19, 40)[3], 0); assert.equal(pixel(image, 80, 40)[3], 0)
})
check('genuine Vello CPU applies object opacity once with straight RGBA', () => {
  const rgba = pixel(raster({ ...horizontal, opacity: .5 }), 40, 40)
  assert.equal(rgba[0], 255); assert(rgba[3] >= 127 && rgba[3] <= 128)
})
check('genuine Vello CPU resolves actual line fallback color', () => assert.deepEqual(pixel(raster({ ...horizontal, strokeColor: '' }), 40, 40), [185, 212, 231, 255]))
check('genuine Vello CPU keeps zero/coincident/transparent/zero-opacity lines unpainted', () => {
  for (const value of [{ ...horizontal, strokeWidth: 0 }, { ...horizontal, vectorPath: anchors({ x: 40, y: 40 }, { x: 40, y: 40 }) },
    { ...horizontal, strokeColor: 'transparent' }, { ...horizontal, opacity: 0 }]) assert(raster(value).every(value => value === 0))
})
check('genuine Vello CPU shares rotation/reversal endpoint preparation', () => {
  const rotated = raster({ ...horizontal, rotation: 90 })
  assert.deepEqual(pixel(rotated, 50, 40), [255, 0, 0, 255]); assert.equal(pixel(rotated, 65, 40)[3], 0)
  const reversed = raster({ ...horizontal, body: 'reverse', vectorPath: anchors({ x: 20, y: 20 }, { x: 80, y: 20 }) })
  assert.equal(pixel(reversed, 40, 20)[3], 0); assert.equal(pixel(reversed, 40, 60)[3], 255)
})
check('genuine Vello CPU cancels camera scaling while retaining backing resolution', () => {
  const image = raster(horizontal, 2), hi = raster(horizontal, 1, 2)
  assert.equal(pixel(image, 80, 80)[3], 255); assert.equal(pixel(image, 80, 72)[3], 0)
  assert.equal(pixel(hi, 80, 68, 256)[3], 255); assert.equal(pixel(hi, 80, 66, 256)[3], 0)
})
const receipt = { checkedAt: new Date().toISOString(), passed: true, checks: checks.length, cases: checks, sourceHashes,
  wasmSha256: createHash('sha256').update(wasmBytes).digest('hex'), wasmBytes: wasmBytes.length,
  scope: 'Actual production line geometry/paint/eligibility/picking/App callbacks/JSX and genuine Vello CPU pixels',
  limits: ['Browser live preview/proxy/cancel/undo/device recovery are separate acceptance receipts.',
    'Parented lines remain DOM-owned; arrows/ellipses/rectangles/captions remain unsupported.',
    'Native packaged runtime and full P0 acceptance remain open.'] }
await writeFile(new URL('../../docs/engine-p0/2026-10-03/scene-coverage/production-plain-line-tests.json', import.meta.url), `${JSON.stringify(receipt, null, 2)}\n`)
console.log(JSON.stringify({ passed: true, checks: checks.length, wasmSha256: receipt.wasmSha256 }, null, 2))
