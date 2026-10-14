import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { geometryModuleUrl, p0GeometrySourceHashes, bindP0Geometry } from './p0-test-module-loader.mjs'

const require = createRequire(new URL('../package.json', import.meta.url))
const { renderToStaticMarkup } = require('react-dom/server')
const files = ['App.tsx', 'board/artEquationCanvasAdapter.ts', 'board/diagramStructureCore.ts', 'canvasTheme.ts',
  'board/canonicalVectorPicking.ts', 'board/velloEligibility.ts', 'board/VelloBoardBackdrop.tsx', 'canvas-engine/spatialIndex.ts']
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')])))
const hashes = { ...p0GeometrySourceHashes, ...Object.fromEntries([...sources].map(([file, text]) => [file, createHash('sha256').update(text).digest('hex')])) }
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = (code, jsx = false) => ts.transpileModule(code, { fileName: jsx ? 'actual.tsx' : 'actual.ts', compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
const coreUrl = url(compile(sources.get('board/diagramStructureCore.ts'))), themeUrl = url(compile(sources.get('canvasTheme.ts')))
const { createArtEquationCanvasScene: project } = await import(url(compile(sources.get('board/artEquationCanvasAdapter.ts'))
  .replace(/from ['"]\.\/velloVectorGeometry['"]/g, `from '${geometryModuleUrl}'`)
  .replace(/from ['"]\.\/diagramStructureCore['"]/g, `from '${coreUrl}'`)
  .replace(/from ['"]\.\.\/canvasTheme['"]/g, `from '${themeUrl}'`)))
const { prepareVelloVectorGeometry: prepare } = await import(geometryModuleUrl)
const pickerUrl = url(bindP0Geometry(compile(sources.get('board/canonicalVectorPicking.ts'))
  .replace(/from ['"]paper['"]/g, `from '${pathToFileURL(require.resolve('paper')).href}'`)))
const { createCanonicalVectorPicker } = await import(pickerUrl)
const eligibilityUrl = url(compile(sources.get('board/velloEligibility.ts')))
const { eligibleVelloObjects: eligible } = await import(eligibilityUrl)
const { UniformGridSpatialIndex } = await import(url(compile(sources.get('canvas-engine/spatialIndex.ts'))))
const app = ts.createSourceFile('App.tsx', sources.get('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const find = (tree, predicate) => { let result; const visit = node => { if (result) return; if (predicate(node)) result = node; else ts.forEachChild(node, visit) }; visit(tree); assert(result, 'Actual source oracle not found'); return result.getText(tree) }
const named = (tree, name) => find(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === name)
const jsx = find(app, node => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr => attr.name?.text === 'className' && attr.initializer?.text === 'node-shape-ellipse'))
const { actualEllipse, drawnShapeNode } = await import(url(compile(`import {readableForeground} from '${themeUrl}';
export const actualEllipse=node=>(${jsx}); export ${named(app, 'drawnShapeNode')}`, true)
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${pathToFileURL(require.resolve('react/jsx-runtime')).href}'`)))
const { hitTestBoardNode } = await import(url(`import {createCanonicalVectorPicker} from '${pickerUrl}';import {isRectangleErasure} from '${new URL('../src/model/rectangleErasure.ts',import.meta.url).href}';${compile(`export ${named(app, 'hitTestBoardNode').replace(/^export\s+/, '')}`)}`))
const backdrop = ts.createSourceFile('backdrop.tsx', sources.get('board/VelloBoardBackdrop.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const { velloBoardSnapshot } = await import(url(`import {eligibleVelloObjects} from '${eligibilityUrl}';${compile(`${named(backdrop, 'commands')}\n${named(backdrop, 'velloBoardSnapshot')}`)}`))
const checks = [], check = (name, execute) => { execute(); checks.push(name) }
const ellipse = (extra = {}) => ({ id: 'ellipse', kind: 'shape', shapeType: 'ellipse', title: 'Ellipse', body: '',
  x: 20, y: 20, width: 80, height: 80, color: '#ff0000', strokeColor: '#0000ff', strokeWidth: 0, ...extra })
const scene = nodes => project({ id: 'disposable-ellipses', nodes, connectors: [], viewport: { x: 0, y: 0, scale: 1 }, gridVisible: false }, [], { background: '#00000000', grid: '#444444' })
const ready = node => { const g = prepare(node); assert.equal(g.status, 'ready'); return g }
const close = (a, b, error = 1e-8) => assert(Math.abs(a - b) <= error, `${a} differs from ${b}`)
const attributes = (node, hit = false) => {
  const tags = [...renderToStaticMarkup(actualEllipse(node)).matchAll(/<ellipse\b[^>]*>/g)].map(match => match[0])
  const tag = tags.find(tag => tag.includes('shape-hit-area') === hit); assert(tag)
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]))
}
const picker = createCanonicalVectorPicker()
try {
  check('actual JSX49 percent radii/default fill/stroke/zero paint and semantic widths match derivative', () => {
    for (const strokeWidth of [0, 2, 20, 64]) {
      const node = ellipse({ color: '', strokeColor: '', strokeWidth }), g = ready(node), base = attributes(node), hit = attributes(node, true)
      assert.equal(Number(base.rx), 49); assert.equal(Number(base.ry), 49)
      assert.equal(g.effectivePaint.fill, base.fill); assert.equal(g.effectivePaint.stroke, base.stroke)
      assert.equal(g.effectivePaint.strokeWidth, Number(base['stroke-width'])); assert.equal(g.hitOutsetCssPx * 2, Number(hit['stroke-width']))
      assert.equal(base['vector-effect'], 'non-scaling-stroke'); assert.equal(base['pointer-events'], 'none')
    }
  })
  check('prepared ellipse deeply freezes derivatives and preserves editable model', () => {
    const node = ellipse(), before = JSON.stringify(node), g = ready(node)
    for (const part of [g, g.commands, ...g.commands, g.bounds, g.effectivePaint, g.approximation]) assert(Object.isFrozen(part))
    assert.equal(JSON.stringify(node), before); assert.equal(node.vectorPath, undefined)
    assert.equal(g.commands[0][0], 'M'); assert.equal(g.commands.at(-1)[0], 'Z')
    assert.deepEqual(g.commands.at(-2).slice(-2), g.commands[0].slice(1))
  })
  check('curves match independent analytic radii throughout every segment and numerical envelope', () => {
    for (const extra of [{}, { width: 2048, height: 32 }, { width: 32, height: 2048, rotation: 27 },
      { width: 2, height: 2 }, { x: -4000, y: 1000, width: 1024, height: 2048, rotation: -141 }]) {
      const node = ellipse(extra), g = ready(node), theta = (node.rotation || 0) * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta)
      let previous = g.commands[0].slice(1)
      assert(g.commands.length <= 2050); assert(g.approximation.worldError <= 1 / 120 + .002001)
      for (const command of g.commands.slice(1, -1)) {
        assert.equal(command[0], 'C')
        const p = [previous, command.slice(1, 3), command.slice(3, 5), command.slice(5, 7)]
        for (let step = 0; step <= 24; step++) {
          const t = step / 24, u = 1 - t, weights = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3]
          const point = [0, 1].map(axis => p.reduce((v, q, i) => v + weights[i] * q[axis], 0))
          const dx = point[0] - node.x - node.width / 2, dy = point[1] - node.y - node.height / 2
          const norm = Math.hypot((c * dx + s * dy) / (node.width * .49), (-s * dx + c * dy) / (node.height * .49))
          assert(Math.abs(norm - 1) * Math.max(node.width, node.height) * .49 <= g.approximation.worldError + 1e-8)
          assert(point[0] >= g.bounds.x - 1e-8 && point[0] <= g.bounds.x + g.bounds.width + 1e-8)
          assert(point[1] >= g.bounds.y - 1e-8 && point[1] <= g.bounds.y + g.bounds.height + 1e-8)
        }
        previous = p[3]
      }
    }
  })
  check('invalid inputs fail closed; practical numeric limits retain DOM fallback', () => {
    for (const extra of [{ width: 0 }, { height: -1 }, { x: Infinity }, { rotation: NaN }, { opacity: 2 }, { strokeWidth: -1 }, { color: null }]) {
      assert.equal(prepare(ellipse(extra)).status, 'invalid'); assert(!hitTestBoardNode(ellipse(extra), { x: 60, y: 60 }))
    }
    for (const extra of [{ width: 4096 }, { width: 1 }, { x: 9000 }, { width: 1024, height: 2 }, { strokeWidth: 65 },
      { color: 'currentColor' }, { strokeColor: 'var(--stroke)' }, { vectorTransform: {} }, { vectorBoolean: {} }]) assert.equal(prepare(ellipse(extra)).status, 'unsupported')
  })
  check('App picker includes transparent interior and independent hit stroke at current zoom', () => {
    for (const strokeWidth of [0, 20, 64]) for (const zoom of [.18, 1, 3]) {
      const node = ellipse({ strokeWidth, color: 'transparent', opacity: 0 }), g = ready(node), radius = g.hitOutsetCssPx / zoom
      assert(picker.hitNode(node, { x: 60, y: 60 }, zoom, g))
      assert(hitTestBoardNode(node, { x: 60 + 39.2 + radius * .8, y: 60 }, zoom))
      assert(!hitTestBoardNode(node, { x: 60 + 39.2 + radius + .2, y: 60 }, zoom))
      // The wide semantic hit stroke legitimately reaches the frame corner.
      if (strokeWidth === 0) assert(!picker.hitNode(node, { x: 20, y: 20 }, 3, g))
    }
  })
  check('indexed semantic band survives outside thin paint and uses prepared world derivative', () => {
    const node = ellipse({ strokeWidth: 64 }), object = scene([node]).objects[0], index = new UniformGridSpatialIndex([object])
    const point = { x: 60 + 39.2 + 120, y: 60 }, margin = object.preparedVectorGeometry.hitOutsetCssPx
    const found = index.query({ x: point.x - margin, y: point.y - margin, width: margin * 2, height: margin * 2 })
    assert.equal(found[0], object); assert(picker.hitNode(node, point, 1, found[0].preparedVectorGeometry))
  })
  check('rotation and parenting retain one world transform and inherited hidden state', () => {
    const node = ellipse({ width: 160, height: 80, rotation: 90 }), g = ready(node)
    close(g.commands[0][1], 100); close(g.commands[0][2], 138.4)
    const parent = { id: 'parent', kind: 'group', title: 'Group', x: 4000, y: 4000, width: 100, height: 100 }
    const child = { ...node, groupId: parent.id }, snapshot = scene([parent, child])
    assert.deepEqual(ready(child).commands, g.commands); assert.equal(eligible(snapshot, [], 1, true).length, 0)
    assert(scene([{ ...parent, hidden: true }, child]).objects.find(o => o.id === child.id).hidden)
  })
  check('captions retain bounds and DOM ownership without deleting historical body', () => {
    for (const body of ['Caption', 'reverse', ' ']) {
      const node = ellipse({ body }), before = JSON.stringify(node), snapshot = scene([node]), object = snapshot.objects[0]
      assert(object.hasShapeCaption); assert.equal(object.preparedVectorGeometry.status, 'ready')
      assert.equal(eligible(snapshot, [], 1, true).length, 0); assert(object.bounds.x <= node.x)
      assert(renderToStaticMarkup(actualEllipse(node)).includes(body)); assert.equal(JSON.stringify(node), before)
    }
    const longCaption = ellipse({ body: 'Unwrapped caption '.repeat(200) })
    const distant = ellipse({ id: 'distant', x: 1000 })
    assert.equal(eligible(scene([longCaption, distant]), [], 1, true).length, 0,
      'An unmeasured overflow-visible caption cannot certify distant mixed-layer order')
  })
  check('actual new negative-slope shape creation limits reverse metadata to lines/arrows', () => {
    for (const kind of ['ellipse', 'rectangle', 'line', 'arrow']) {
      const node = drawnShapeNode('new', kind, { x: 0, y: 100 }, { x: 100, y: 0 })
      assert.equal(node.body, kind === 'line' || kind === 'arrow' ? 'reverse' : '')
    }
  })
  check('camera envelope and overlapping DOM content prevent unsupported complete ownership', () => {
    const node = ellipse(), snapshot = scene([node])
    for (const scale of [.18, 1, 3]) assert.equal(eligible(snapshot, [], scale, true).length, 1)
    for (const scale of [.1, 4]) assert.equal(eligible(snapshot, [], scale, true).length, 0)
    const card = { id: 'card', kind: 'note', title: 'Card', body: 'Text', x: 30, y: 30, width: 80, height: 80 }
    assert.equal(eligible(scene([node, card]), [], 1, true).length, 0)
  })
  check('actual serializer shares contour/effective paint/opacity with no second geometry transform', () => {
    const node = ellipse({ opacity: .4, strokeWidth: 10, rotation: 23 })
    for (const scale of [.18, 1, 3]) {
      const payload = JSON.parse(velloBoardSnapshot(scene([node]), [], scale, true).json).objects[0]
      assert.deepEqual(payload.transform, [1, 0, 0, 1, 0, 0]); assert.equal(payload.opacity, .4)
      assert.deepEqual(payload.payload.commands, ready(node).commands); close(payload.payload.strokeWidth * scale, 10)
    }
  })
} finally { picker.dispose() }

const engine = await import(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm.js', import.meta.url))
const wasm = await readFile(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm', import.meta.url))
await engine.default({ module_or_path: wasm })
const raster = (node, camera = 1, resolution = 1) => engine.render_cpu_snapshot(160 * resolution, 160 * resolution,
  velloBoardSnapshot(scene([node]), [], camera, true).json, camera * resolution, 0, 0)
const pixel = (image, x, y, width = 160) => [...image.slice((y * width + x) * 4, (y * width + x) * 4 + 4)]
check('genuineCPU paints49 percent ellipse fill and leaves outside corners empty', () => {
  const image = raster(ellipse()); assert.deepEqual(pixel(image, 60, 60), [255, 0, 0, 255]); assert.equal(pixel(image, 20, 20)[3], 0)
  assert.equal(pixel(image, 19, 60)[3], 0); assert.equal(pixel(image, 22, 60)[3], 255)
})
check('genuineCPU fill/stroke grouping applies opacity once to overlapping paint', () => {
  const image = raster(ellipse({ strokeWidth: 12, opacity: .5 }))
  assert(pixel(image, 60, 60)[3] >= 127 && pixel(image, 60, 60)[3] <= 128)
  assert(pixel(image, 97, 60)[3] >= 127 && pixel(image, 97, 60)[3] <= 128)
  assert.equal(pixel(image, 97, 60)[2], 255)
})
check('genuineCPU zero-width/transparency and actual fallback colors remain exact', () => {
  assert(raster(ellipse({ color: 'transparent', strokeWidth: 0 })).every(value => value === 0))
  assert(raster(ellipse({ opacity: 0, strokeWidth: 12 })).every(value => value === 0))
  assert.deepEqual(pixel(raster(ellipse({ color: '' })), 60, 60), [86, 116, 142, 255])
})
check('genuineCPU non-square rotation and camera/backing scales retain geometry', () => {
  const image = raster(ellipse({ width: 100, height: 40, rotation: 90 }))
  assert.equal(pixel(image, 70, 75)[3], 255); assert.equal(pixel(image, 100, 40)[3], 0)
  const hi = raster(ellipse(), 1, 2); assert.deepEqual(pixel(hi, 120, 120, 320), [255, 0, 0, 255])
  const scaled = raster(ellipse(), .5); assert.deepEqual(pixel(scaled, 30, 30), [255, 0, 0, 255])
})
const evidence = new URL('../../docs/engine-p0/2026-10-03/ellipse-integration/', import.meta.url)
await mkdir(evidence, { recursive: true })
const receipt = { checkedAt: new Date().toISOString(), passed: true, checks: checks.length, cases: checks, hashes,
  wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  limits: ['Analytic sampling independently checks the coefficient certificate but is not itself a proof.',
    'CPU pixels are genuine Vello CPU; actual SVG/GPU browser parity and native/runtime acceptance are separate.',
    'Bounded uncaptioned/unparented paint, scale .18 to3; source model remains editable; fullP0 open.'] }
await writeFile(new URL('ellipse-tests.json', evidence), JSON.stringify(receipt, null, 2))
console.log(JSON.stringify({ passed: true, checks: checks.length, wasmSha256: receipt.wasmSha256 }, null, 2))
