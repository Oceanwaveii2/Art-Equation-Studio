import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const measured = url(compile(await readFile('src/board/measuredCardPaint.ts', 'utf8')))
const source = await readFile('src/board/measuredBackgroundPaint.ts', 'utf8')
const awaitFixture = (await readFile('../fixtures/workspace/projects/p1-v2-studies/project.json', 'utf8')).replace(/^\uFEFF/, '')
const backgroundModule = url(compile(source).replace(/from ['"]\.\/measuredCardPaint(?:\.ts)?['"]/g, "from '" + measured + "'"))
const { parseMeasuredBackground, resolveMeasuredBackgroundGeometry, measuredBackgroundGradientOperation } = await import(backgroundModule)
const budgetModule = url(compile(await readFile('src/canvas-engine/resourceBudget.ts', 'utf8')))
const demandModule = url(compile(await readFile('src/canvas-engine/imageDemand.ts', 'utf8')))
const registryModule = url(compile(await readFile('src/canvas-engine/decodedImageRegistry.ts', 'utf8')).replace(/from ['"]\.\/imageDemand['"]/g, "from '" + demandModule + "'").replace(/from ['"]\.\/resourceBudget['"]/g, "from '" + budgetModule + "'"))
const imageModule = url(compile(await readFile('src/project-b/p0-surface/backgroundImagePaint.ts', 'utf8')).replace(/from ['"]\.\.\/\.\.\/canvas-engine\/decodedImageRegistry['"]/g, "from '" + registryModule + "'").replace(/from ['"]\.\.\/\.\.\/canvas-engine\/imageDemand['"]/g, "from '" + demandModule + "'").replace(/from ['"]\.\.\/\.\.\/canvas-engine\/resourceBudget['"]/g, "from '" + budgetModule + "'").replace(/from ['"]\.\.\/\.\.\/board\/measuredBackgroundPaint['"]/g, "from '" + backgroundModule + "'"))
const { DecodedImageRegistry } = await import(registryModule)
const { CanvasResourceBudget } = await import(budgetModule)
const { captureBackgroundImagePaint } = await import(imageModule)
const checks = []
const check = (name, run) => { run(); checks.push({ name, pass: true }) }
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
const defaults = { backgroundImage: 'none', backgroundOrigin: 'padding-box', backgroundClip: 'border-box', backgroundSize: 'auto', backgroundPosition: '0% 0%', backgroundRepeat: 'no-repeat', backgroundAttachment: 'scroll', backgroundBlendMode: 'normal', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' }
const layers = (patch, size = { width: 200, height: 100 }, borders = [0, 0, 0, 0]) => parseMeasuredBackground({ ...defaults, ...patch }, size, borders)
const identity = [1, 0, 0, 1, 0, 0]
const gradient = layer => { const geometry = resolveMeasuredBackgroundGeometry(layer); return measuredBackgroundGradientOperation(layer, geometry.tiles[0], 'proof-gradient', identity) }

check('Test3 fixture is three frames and nine images; source records stay intact', () => {
  const project = JSON.parse(awaitFixture)
  const board = project.boards.find(board => board.id === 'test-3-nodes')
  assert.equal(board.nodes.filter(node => node.kind === 'image').length, 9)
  const frames = board.nodes.filter(node => node.kind === 'group' && node.containerRole === 'frame')
  assert.deepEqual(frames.map(node => node.id), ['left', 'middle', 'right'])
})

check('None layers contribute no background paint', () => assert.deepEqual(layers({ backgroundImage: 'none, none' }), []))
check('Computed cover URL and overlay remain two ordered layers with inert identities', () => {
  const parsed = layers({ backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0), rgba(16, 17, 22, 0.867)), url("http://127.0.0.1:5194/assets/cover.png?x=1,2")', backgroundSize: 'cover', backgroundPosition: '50% 50%' })
  assert.deepEqual(parsed.map(layer => [layer.index, layer.kind]), [[0, 'gradient'], [1, 'image']])
  assert.equal(parsed[1].source, 'http://127.0.0.1:5194/assets/cover.png?x=1,2')
  assert.equal(parsed[0].sizing.mode, 'cover')
  assert.equal(parsed[1].sizing.mode, 'cover')
  assert.deepEqual(parsed.toReversed().map(layer => layer.kind), ['image', 'gradient'])
})
check('CSS list cycling applies original layer indexes including none', () => {
  const parsed = layers({ backgroundImage: 'none, url("a.png"), url("b.png")', backgroundSize: 'cover, contain', backgroundPosition: 'left top, right bottom' })
  assert.deepEqual(parsed.map(layer => [layer.index, layer.sizing.mode]), [[1, 'contain'], [2, 'cover']])
  assert.equal(parsed[0].position[0].value, 100)
  assert.equal(parsed[1].position[0].value, 0)
})
check('Wide cover is uniformly enlarged and centered with negative crop offsets', () => {
  const [layer] = layers({ backgroundImage: 'url("wide.png")', backgroundSize: 'cover', backgroundPosition: 'center' })
  const geometry = resolveMeasuredBackgroundGeometry(layer, { width: 400, height: 100 })
  assert.deepEqual(geometry.tile, { x: -100, y: 0, width: 400, height: 100 })
  assert.equal(geometry.tiles.length, 1)
})
check('Tall contain preserves aspect ratio and centers letterboxing', () => {
  const [layer] = layers({ backgroundImage: 'url("tall.png")', backgroundSize: 'contain', backgroundPosition: '50% 50%' })
  assert.deepEqual(resolveMeasuredBackgroundGeometry(layer, { width: 100, height: 400 }).tile, { x: 87.5, y: 0, width: 25, height: 100 })
})
check('Explicit one-axis auto dimensions preserve decoded source aspect ratio', () => {
  const [layer] = layers({ backgroundImage: 'url("a.png")', backgroundSize: '50% auto', backgroundPosition: '10px 5px' })
  assert.deepEqual(resolveMeasuredBackgroundGeometry(layer, { width: 400, height: 100 }).tile, { x: 10, y: 5, width: 100, height: 25 })
})
check('Origin, clipping and content padding remain independently specified', () => {
  const [layer] = layers({ backgroundImage: 'url("a.png")', backgroundOrigin: 'padding-box', backgroundClip: 'content-box', backgroundSize: 'cover', paddingTop: '7px', paddingRight: '8px', paddingBottom: '9px', paddingLeft: '10px' }, { width: 200, height: 100 }, [1, 2, 3, 4])
  assert.deepEqual(layer.origin, { x: 4, y: 1, width: 194, height: 96 })
  assert.deepEqual(layer.clip, { x: 14, y: 8, width: 176, height: 80 })
})
check('Repeat-x paints only intersecting horizontal tiles', () => {
  const [layer] = layers({ backgroundImage: 'url("a.png")', backgroundSize: '50px 20px', backgroundRepeat: 'repeat-x', backgroundPosition: '10px 5px' })
  const geometry = resolveMeasuredBackgroundGeometry(layer, { width: 50, height: 20 })
  assert.equal(geometry.tiles.length, 5)
  assert.deepEqual(geometry.tiles.map(tile => tile.x), [-40, 10, 60, 110, 160])
  assert(geometry.tiles.every(tile => tile.y === 5))
})
check('Gradient auto/cover sizing uses its positioning box rather than fake intrinsic ratio', () => {
  const [layer] = layers({ backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0), rgb(0, 0, 0))', backgroundSize: 'cover', backgroundPosition: '50% 50%' }, { width: 621, height: 993 }, [1, 1, 1, 1])
  const geometry = resolveMeasuredBackgroundGeometry(layer), operation = measuredBackgroundGradientOperation(layer, geometry.tile, 'overlay', identity)
  assert.deepEqual(geometry.tile, { x: 1, y: 1, width: 619, height: 991 })
  assert.equal(operation.gradient.kind, 'linear')
  near(operation.gradient.start[0], 310.5); near(operation.gradient.start[1], 1)
  near(operation.gradient.end[0], 310.5); near(operation.gradient.end[1], 992)
  assert.deepEqual(operation.gradient.stops.map(stop => stop.color), ['#00000000', '#000000ff'])
})
check('Hard stops, implicit stops and out-of-range linear stops are normalized without changing line location', () => {
  const operation = gradient(layers({ backgroundImage: 'linear-gradient(90deg, rgb(255, 0, 0) -25%, rgb(0, 255, 0) 40% 60%, rgb(0, 0, 255) 125%)' })[0])
  operation.gradient.stops.forEach((stop, index) => near(stop.offset, [0, 0.65 / 1.5, 0.85 / 1.5, 1][index]))
  near(operation.gradient.start[0], -50); near(operation.gradient.end[0], 250)
})
check('Elliptical radial brush stays relative while its shape supplies world placement once', () => {
  const [layer] = layers({ backgroundImage: 'radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 1), rgba(0, 0, 0, 0))' })
  const geometry = resolveMeasuredBackgroundGeometry(layer), operation = measuredBackgroundGradientOperation(layer, geometry.tile, 'radial', [2, 0, 0, 3, 7, 11])
  assert.equal(operation.gradient.kind, 'radial')
  assert.equal(operation.gradient.radius, 1)
  near(operation.brushTransform[0], 100 * Math.SQRT2); near(operation.brushTransform[3], 50 * Math.SQRT2)
  near(operation.brushTransform[4], 100); near(operation.brushTransform[5], 50)
  assert.deepEqual(operation.transform, [2, 0, 0, 3, 7, 11])
})
check('Off-center circle farthest-corner uses corner distance, not AABB diagonal', () => {
  const operation = gradient(layers({ backgroundImage: 'radial-gradient(circle at 50% -20%, rgb(0, 0, 0), rgba(0, 0, 0, 0) 52%)' })[0])
  near(operation.brushTransform[0], Math.hypot(100, 120)); near(operation.brushTransform[3], Math.hypot(100, 120))
  near(operation.brushTransform[4], 100); near(operation.brushTransform[5], -20)
})
check('Explicit elliptical radii and default-shape at-only header remain supported', () => {
  const operation = gradient(layers({ backgroundImage: 'radial-gradient(ellipse 40px 20px at center, rgb(0, 0, 0), rgb(255, 255, 255))' })[0])
  near(operation.brushTransform[0], 40); near(operation.brushTransform[3], 20)
  assert.equal(gradient(layers({ backgroundImage: 'radial-gradient(at center, rgb(0, 0, 0), rgb(255, 255, 255))' })[0]).gradient.kind, 'radial')
})
check('Quoted CSS URL escapes are decoded without interpreting their content', () => {
  const [layer] = layers({ backgroundImage: 'url("assets/quoted\\22 name.png")' })
  assert.equal(layer.source, 'assets/quoted"name.png')
})
check('Unqualified sizes/positions/effects/refusals are explicit and bounded', () => {
  for (const patch of [{ backgroundAttachment: 'fixed' }, { backgroundAttachment: 'local' }, { backgroundRepeat: 'round' }, { backgroundRepeat: 'space' }, { backgroundBlendMode: 'multiply' }, { backgroundClip: 'text' }, { backgroundPosition: 'calc(100% - 5px) 0%' }, { backgroundImage: 'conic-gradient(rgb(0,0,0),rgb(255,255,255))' }, { backgroundImage: 'url("broken.png"' }]) assert.throws(() => layers({ backgroundImage: 'url("a.png")', ...patch }), /CARD_BACKGROUND_UNSUPPORTED/)
  const [image] = layers({ backgroundImage: 'url("a.png")' })
  assert.throws(() => resolveMeasuredBackgroundGeometry(image), /decoded image dimensions/)
  assert.throws(() => resolveMeasuredBackgroundGeometry(layers({ backgroundImage: 'url("a.png")', backgroundSize: '1px 1px', backgroundRepeat: 'repeat' })[0], { width: 1, height: 1 }), /tile limit/)
  assert.throws(() => gradient(layers({ backgroundImage: 'radial-gradient(circle, rgb(0,0,0) -10%, rgb(255,255,255))' })[0]), /gradient stop range/)
  assert.throws(() => layers({ backgroundImage: 'url("a.png")' }, { width: Infinity, height: 10 }), /box metrics/)
})
// These are provider contract tests using an instrumented off-DOM canvas.
// Native/browser pixel parity is a separate integration gate.
const fixtures = []
function imageFixture({ width = 400, height = 100, size = { width: 200, height: 100 }, patch = {}, limits, failure, mutate } = {}) {
  const stats = { canvases: [], draws: 0, contexts: [], readbacks: [] }
  const image = { isConnected: false, complete: true, currentSrc: '', src: 'http://proof.local/cover.png', naturalWidth: width, naturalHeight: height }
  image.ownerDocument = {
    baseURI: 'http://proof.local/app/',
    createElement(tag) {
      assert.equal(tag, 'canvas')
      if (failure === 'create') throw new Error('CANVAS_CREATE_FAILED')
      const canvas = { width: 0, height: 0, getContext(kind, options) {
        stats.contexts.push({ kind, options })
        if (failure === 'context') return null
        return {
          drawImage(received, x, y, decodedWidth, decodedHeight) {
            assert.equal(received, image); assert.equal(x, 0); assert.equal(y, 0)
            assert.equal(decodedWidth, canvas.width); assert.equal(decodedHeight, canvas.height)
            stats.draws++
            if (failure === 'security') throw new DOMException('tainted', 'SecurityError')
            if (mutate) mutate(image)
          },
          getImageData(x, y, decodedWidth, decodedHeight, options) {
            stats.readbacks.push(options)
            const data = new Uint8ClampedArray(decodedWidth * decodedHeight * 4)
            for (let index = 0; index < data.length; index += 4) data.set([64, 128, 255, 128], index)
            return { data }
          },
        }
      } }
      stats.canvases.push(canvas); return canvas
    },
  }
  const budget = new CanvasResourceBudget(limits)
  const registry = new DecodedImageRegistry(9, budget)
  const [layer] = layers({ backgroundImage: 'url("http://proof.local/cover.png")', backgroundSize: 'cover', backgroundPosition: 'center', ...patch }, size)
  const options = { id: 'proof-background', key: 'proof-background', revision: 1, layer, borderBoxTransform: identity, physicalScale: 1, budget }
  const fixture = { image, stats, budget, registry, options, capture: overrides => captureBackgroundImagePaint(image, registry, { ...options, ...overrides }) }
  fixtures.push(fixture); return fixture
}
check('Off-DOM cover capture binds CSS source, preserves crop geometry and premultiplies immutable upload bytes', () => {
  const fixture = imageFixture(), result = fixture.capture()
  assert.equal(result.operations.length, 1); assert.equal(result.uploads.length, 1)
  assert.deepEqual(result.operations[0].transform, [1, 0, 0, 1, -100, 0])
  assert.deepEqual(result.visualBounds, { x: 0, y: 0, width: 200, height: 100 })
  assert.deepEqual([...result.uploads[0].pixels.slice(0, 4)], [32, 64, 128, 128])
  assert.equal(fixture.image.isConnected, false)
  assert.deepEqual(fixture.stats.contexts, [{ kind: '2d', options: { colorSpace: 'srgb', willReadFrequently: true } }])
  assert.deepEqual(fixture.stats.readbacks, [{ colorSpace: 'srgb' }])
  assert(fixture.stats.canvases.every(canvas => canvas.width === 0 && canvas.height === 0))
  assert.equal(fixture.budget.snapshot().pools['tile-surface'].bytes, 0)
})
check('Repeated background tiles share one bounded decode and unique upload while retaining tile scale policies', () => {
  const fixture = imageFixture({ width: 50, height: 20, patch: { backgroundSize: '50px 20px', backgroundRepeat: 'repeat-x', backgroundPosition: '10px 5px' } })
  const result = fixture.capture()
  assert.equal(result.operations.length, 5); assert.equal(result.scaleImages.length, 5)
  assert.equal(result.uploads.length, 1); assert.equal(fixture.stats.draws, 1)
  assert.equal(new Set(result.operations.map(operation => operation.id)).size, 5)
  assert.deepEqual(result.visualBounds, { x: 0, y: 5, width: 200, height: 20 })
})
check('Retained mip demand includes DPR and returns natural-pixel scale admission transforms', () => {
  const fixture = imageFixture({ width: 512, height: 256, size: { width: 128, height: 64 } })
  for (const [physicalScale, width, height] of [[1, 128, 64], [2, 256, 128], [4, 512, 256]]) {
    const result = fixture.capture({ physicalScale })
    assert.equal(result.uploads[0].reference.width, width); assert.equal(result.uploads[0].reference.height, height)
    assert.deepEqual(result.scaleImages[0], { width: 512, height: 256, transform: [0.25, 0, 0, 0.25, 0, 0], acceptedWidth: width, acceptedHeight: height })
    near(result.operations[0].transform[0] * width, 128)
  }
})
check('World rotation and shear preserve the source basis and conservative clipped world bounds', () => {
  const fixture = imageFixture({ width: 100, height: 50, size: { width: 100, height: 50 } }), transform = [0, 2, -3, 1, 7, 11]
  const result = fixture.capture({ borderBoxTransform: transform })
  assert.deepEqual(result.operations[0].transform, transform)
  assert.deepEqual(result.scaleImages[0].transform, transform)
  assert.deepEqual(result.visualBounds, { x: -143, y: 11, width: 150, height: 250 })
})
check('Cached background resources avoid readback and refuse mutation of exposed upload bytes', () => {
  const fixture = imageFixture(), first = fixture.capture(), second = fixture.capture()
  assert.equal(fixture.stats.draws, 1); assert.equal(first.uploads[0], second.uploads[0])
  first.uploads[0].pixels[0] ^= 1
  assert.throws(() => fixture.capture(), /RESOURCE_REVISION_CONFLICT/)
  assert.equal(fixture.stats.draws, 1)
})
check('Off-clip no-repeat backgrounds allocate no texture or canvas', () => {
  const fixture = imageFixture({ patch: { backgroundPosition: '1000px 1000px' } }), result = fixture.capture()
  assert.equal(result.operations.length, 0); assert.equal(result.uploads.length, 0); assert.equal(result.scaleImages.length, 0)
  assert.equal(result.visualBounds.width, 0); assert.equal(result.visualBounds.height, 0)
  assert.equal(fixture.stats.draws, 0); assert.equal(fixture.budget.snapshot().bytes, 0)
})
check('Wrong, missing, unloaded, connected or dimensionless source identities cannot qualify', () => {
  for (const change of [image => { image.src = 'http://proof.local/wrong.png' }, image => { image.src = '' }, image => { image.complete = false }, image => { image.isConnected = true }, image => { image.naturalWidth = 0 }]) {
    const fixture = imageFixture(); change(fixture.image)
    assert.throws(() => fixture.capture(), /RESOURCE_(?:NOT_READY|STALE_DECODE)/)
    assert.equal(fixture.stats.draws, 0); assert.equal(fixture.budget.snapshot().bytes, 0)
  }
  const fixture = imageFixture()
  assert.throws(() => fixture.capture({ physicalScale: 0 }), /IMAGE_INVALID/)
  assert.throws(() => fixture.capture({ borderBoxTransform: [1, 0, 0, 0, 0, 0] }), /IMAGE_INVALID/)
})
check('Changed source, dimensions, completeness or DOM attachment during readback withhold all uploads and release temporary surfaces', () => {
  for (const mutate of [image => { image.src = 'http://proof.local/new.png' }, image => { image.naturalHeight++ }, image => { image.complete = false }, image => { image.isConnected = true }]) {
    const fixture = imageFixture({ mutate })
    assert.throws(() => fixture.capture(), /RESOURCE_STALE_DECODE/)
    assert.equal(fixture.registry.stats().count, 0)
    assert.equal(fixture.budget.snapshot().bytes, 0)
    assert(fixture.stats.canvases.every(canvas => canvas.width === 0 && canvas.height === 0))
  }
})
check('Canvas allocation, context and cross-origin readback failures release their entire temporary lease', () => {
  for (const failure of ['create', 'context', 'security']) {
    const fixture = imageFixture({ failure })
    assert.throws(() => fixture.capture(), failure === 'create' ? /CANVAS_CREATE_FAILED/ : /RESOURCE_UNREADABLE/)
    assert.equal(fixture.budget.snapshot().bytes, 0)
    assert(fixture.stats.canvases.every(canvas => canvas.width === 0 && canvas.height === 0))
  }
})
check('Surface/retained budget denial never leaks a temporary canvas or partially registered image', () => {
  for (const pools of [{ 'tile-atlas': 1e6, 'tile-surface': 1, retained: 1e6 }, { 'tile-atlas': 1e6, 'tile-surface': 1e6, retained: 1 }]) {
    const fixture = imageFixture({ limits: { total: 2e6, pools } })
    assert.throws(() => fixture.capture(), /RESOURCE_BUDGET_EXCEEDED/)
    assert.equal(fixture.registry.stats().count, 0); assert.equal(fixture.budget.snapshot().bytes, 0)
    assert(fixture.stats.canvases.every(canvas => canvas.width === 0 && canvas.height === 0))
  }
})
check('Oversized physical demand refuses qualification while a sufficient bounded mip is allowed', () => {
  const fixture = imageFixture({ width: 8192, height: 64, size: { width: 8192, height: 64 } })
  assert.throws(() => fixture.capture(), /RESOURCE_BUDGET_EXCEEDED/)
  assert.equal(fixture.stats.draws, 0)
  const result = fixture.capture({ physicalScale: 0.125 })
  assert.equal(result.uploads[0].reference.width, 1024)
  assert.equal(result.uploads[0].reference.height, 8)
})
for (const fixture of fixtures) { fixture.registry.dispose(); assert.equal(fixture.budget.snapshot().bytes, 0) }
const wasm = await import(pathToFileURL(resolve('src/project-b/p0-surface/generated/p0_engine_wasm.js')))
wasm.initSync({ module: await readFile('src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm') })
const renderGradient = operation => wasm.render_cpu_snapshot(256, 192, JSON.stringify({ schema: 'art-equation.display-list', schemaVersion: 2, sceneId: 'disposable-transformed-background-gradient', revision: '1', environment: { background: '#00000000', colorSpace: 'srgb' }, resources: [], operations: [operation] }), 1, 0, 0)
const pixel = (bytes, x, y) => [...bytes.slice((y * 256 + x) * 4, (y * 256 + x + 1) * 4)]
const transforms = [[1, 0, 0, 1, 40, 20], [1.2, .6, -.25, 1.1, 60, 50]]
check('Genuine WASM translated/rotated/sheared linear pixels preserve local color positions and detect the former double world transform', () => {
  const [layer] = layers({ backgroundImage: 'linear-gradient(90deg, rgb(255,0,0), rgb(0,0,255))' }, { width: 100, height: 100 })
  const geometry = resolveMeasuredBackgroundGeometry(layer)
  for (const [index, transform] of transforms.entries()) {
    const operation = measuredBackgroundGradientOperation(layer, geometry.tile, 'transformed-linear', transform), bytes = renderGradient(operation)
    assert.deepEqual(operation.brushTransform, identity)
    // Independent local-space line oracle: placement is on the shape only.
    const oracle = renderGradient({ ...operation, brushTransform: identity, gradient: { ...operation.gradient, start: [0, 50], end: [100, 50] } })
    assert.deepEqual(bytes, oracle)
    assert.deepEqual(pixel(bytes, index ? 107 : 90, index ? 135 : 70), index ? [128, 0, 127, 255] : [127, 0, 128, 255])
    assert.notDeepEqual(bytes, renderGradient({ ...operation, brushTransform: transform }))
  }
})
check('Genuine WASM translated/rotated/sheared elliptical radial pixels keep the local ellipse and detect the former double world transform', () => {
  const [layer] = layers({ backgroundImage: 'radial-gradient(ellipse 40px 20px at center, rgb(255,0,0), rgb(0,0,255))' }, { width: 100, height: 100 })
  const geometry = resolveMeasuredBackgroundGeometry(layer), ellipse = [40, 0, 0, 20, 50, 50]
  for (const [index, transform] of transforms.entries()) {
    const operation = measuredBackgroundGradientOperation(layer, geometry.tile, 'transformed-radial', transform), bytes = renderGradient(operation)
    assert.deepEqual(operation.brushTransform, ellipse)
    const oracle = renderGradient({ ...operation, brushTransform: ellipse, gradient: { ...operation.gradient, center: [0, 0], radius: 1 } })
    assert.deepEqual(bytes, oracle)
    assert.deepEqual(pixel(bytes, index ? 107 : 90, index ? 135 : 70), index ? [250, 0, 5, 255] : [248, 0, 7, 255])
    const [a,b,c,d,e,f] = transform, double = [a * 40, b * 40, c * 20, d * 20, a * 50 + c * 50 + e, b * 50 + d * 50 + f]
    assert.notDeepEqual(bytes, renderGradient({ ...operation, brushTransform: double }))
  }
})
console.log(JSON.stringify({ status: 'PASS', scope: 'MEASURED_BACKGROUND_GEOMETRY, BOUNDED_IMAGE_CONTRACTS_AND_GENUINE_WASM_CPU_TRANSFORMED_GRADIENT_PIXELS; browser/GPU/native EXE pixels and workflows remain unqualified', checks: checks.length, cases: checks }, null, 2))
