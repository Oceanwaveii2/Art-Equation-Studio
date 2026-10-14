import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const sourcePaths = ['../src/model/vector.ts', '../src/model/vectorComposition.ts', '../src/model/project.ts']
const hashes = {}
const compile = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  hashes[path] = createHash('sha256').update(source).digest('hex')
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
}
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const vectorUrl = url(await compile(sourcePaths[0]))
const { reverseVectorPath, resizeVectorNodeFrame, vectorPathData, vectorPathBounds } = await import(vectorUrl)
const { composeVectorPaths } = await import(url((await compile(sourcePaths[1])).replace("from './vector'", `from '${vectorUrl}'`)))
await compile(sourcePaths[2])
const paperUrl = pathToFileURL(createRequire(import.meta.url).resolve('paper')).href
const resolverPath = '../src/model/vectorBooleanGeometry.ts'
sourcePaths.push(resolverPath)
const { resolveVectorBooleanGeometry } = await import(url((await compile(resolverPath)).replace("from 'paper'", `from '${paperUrl}'`)))
let checks = 0
const near = (actual, expected, label, epsilon = 1e-8) => { assert(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} != ${expected}`); checks++ }
const pointNear = (actual, expected, label) => { near(actual.x, expected.x, `${label} x`); near(actual.y, expected.y, `${label} y`) }
const check = (condition, label) => { assert(condition, label); checks++ }
// Independent sequential interpretation of the SVG transform list. This does
// not call the production affine matrix or its point-mapping helpers.
const world = (node, point) => {
  const transform = node.vectorTransform || {}, cx = node.width / 2, cy = node.height / 2
  const scaled = { x: (point.x - cx) * (transform.scaleX ?? 1), y: (point.y - cy) * (transform.scaleY ?? 1) }
  const skewY = { x: scaled.x, y: scaled.y + scaled.x * Math.tan((transform.skewY ?? 0) * Math.PI / 180) }
  const skewX = { x: skewY.x + skewY.y * Math.tan((transform.skewX ?? 0) * Math.PI / 180), y: skewY.y }
  const offset = { x: skewX.x + (transform.translateX ?? 0), y: skewX.y + (transform.translateY ?? 0) }
  const theta = (node.rotation ?? 0) * Math.PI / 180
  return { x: node.x + cx + Math.cos(theta) * offset.x - Math.sin(theta) * offset.y, y: node.y + cy + Math.sin(theta) * offset.x + Math.cos(theta) * offset.y }
}
const cubic = (path, index, t) => {
  const from = path.points[index], to = path.points[(index + 1) % path.points.length], u = 1 - t
  const axis = (key) => u ** 3 * from[key] + 3 * u ** 2 * t * (from[key] + (from.handleOut?.[key] ?? 0)) + 3 * u * t ** 2 * (to[key] + (to.handleIn?.[key] ?? 0)) + t ** 3 * to[key]
  return { x: axis('x'), y: axis('y') }
}
const boardPoint = (node, point) => ({ x: node.x + point.x, y: node.y + point.y })
const curved = { version: 1, closed: true, points: [{ x: -15, y: 20, handleOut: { x: 30, y: -90 }, handleMode: 'corner' }, { x: 130, y: 30, handleIn: { x: -40, y: -85 }, handleOut: { x: 20, y: 65 }, handleMode: 'smooth' }, { x: 60, y: 100, handleIn: { x: 35, y: 10 } }] }
const node = (id, extra = {}) => ({ id, title: id, kind: 'shape', shapeType: 'path', x: 180, y: 150, width: 160, height: 120, vectorPath: curved, ...extra })
const transforms = [undefined, { scaleX: -1, scaleY: .65, skewX: 18, skewY: -11, translateX: 16, translateY: -9 }, { scaleX: .75, scaleY: -1.3, skewX: -17, skewY: 9, translateX: -20, translateY: 14 }]
const operations = ['union', 'subtract', 'intersect', 'exclude']
let fixtures = 0
for (const rotation of [0, 30, 90]) for (const vectorTransform of transforms) for (const operation of operations) {
  const operands = [node('a', { rotation, vectorTransform, groupId: 'same', color: '#12abcd', strokeColor: '#789012', strokeWidth: 7, opacity: .4, vectorFillRule: 'evenodd', vectorStrokeJoin: 'round', vectorStrokeCap: 'square' }), node('b', { x: 350, y: 230, rotation: -rotation, vectorTransform: transforms[(transforms.indexOf(vectorTransform) + 1) % transforms.length], groupId: 'same', vectorFillRule: 'nonzero' })]
  const snapshot = JSON.stringify(operands), result = composeVectorPaths(operands, operation, 'composed')
  check(result.ok, `${operation} composition succeeds`)
  const composed = result.node
  assert.deepEqual(result.sourceIds, ['a', 'b']); checks++
  assert.deepEqual(composed.vectorBoolean.fillRules, ['evenodd', 'nonzero']); checks++
  check(composed.rotation === 0 && composed.vectorTransform === undefined, 'result clears both affine layers')
  for (const [index, original] of operands.entries()) {
    const path = composed.vectorBoolean.operands[index]
    for (let p = 0; p < original.vectorPath.points.length; p++) {
      const before = original.vectorPath.points[p], after = path.points[p]
      pointNear(boardPoint(composed, after), world(original, before), 'anchor world image')
      assert.equal(after.handleMode, before.handleMode); checks++
      for (const key of ['handleIn', 'handleOut']) if (before[key]) pointNear(boardPoint(composed, { x: after.x + after[key].x, y: after.y + after[key].y }), world(original, { x: before.x + before[key].x, y: before.y + before[key].y }), 'control world image')
      for (let step = 0; step <= 40; step++) {
        const actual = boardPoint(composed, cubic(path, p, step / 40)), expected = world(original, cubic(original.vectorPath, p, step / 40))
        pointNear(actual, expected, 'complete cubic world image')
        if (operation !== 'subtract' || index === 0) check(actual.x >= composed.x - 1e-8 && actual.x <= composed.x + composed.width + 1e-8 && actual.y >= composed.y - 1e-8 && actual.y <= composed.y + composed.height + 1e-8, 'dense visible contour stays inside exact frame')
      }
    }
  }
  for (const key of ['color', 'strokeColor', 'strokeWidth', 'opacity', 'vectorStrokeJoin', 'vectorStrokeCap', 'groupId']) { assert.equal(composed[key], operands[0][key]); checks++ }
  assert.equal(JSON.stringify(operands), snapshot, 'composition cannot mutate saved operands'); checks++
  assert.deepEqual(JSON.parse(JSON.stringify(composed.vectorBoolean)), composed.vectorBoolean, 'portable Boolean geometry'); checks++
  fixtures++
}
// Exact cubic extremum lies beyond every anchor; an anchor-only frame misses it.
const arch = { version: 1, closed: true, points: [{ x: 0, y: 0, handleOut: { x: 0, y: -100 } }, { x: 100, y: 0, handleIn: { x: 0, y: -100 } }, { x: 50, y: 50 }] }
const distant = node('distant', { x: 5000, y: 6000 })
const subtraction = composeVectorPaths([node('arch', { vectorPath: arch }), distant], 'subtract', 'arch-cut')
check(subtraction.ok, 'subtract distant cutter succeeds')
near(subtraction.node.x, 180, 'subtract visible left'); near(subtraction.node.y, 75, 'cubic exact top'); near(subtraction.node.width, 100, 'subtract width excludes cutter'); near(subtraction.node.height, 125, 'subtract height excludes cutter')
check(subtraction.node.vectorBoolean.operands[1].points[0].x > 4000, 'distant cutter retained in same local frame')
assert.deepEqual([subtraction.node.strokeWidth, subtraction.node.opacity, subtraction.node.vectorFillRule, subtraction.node.vectorStrokeJoin, subtraction.node.vectorStrokeCap], [2, 1, 'nonzero', 'miter', 'butt']); checks++
check(subtraction.node.color === undefined && subtraction.node.strokeColor === undefined, 'optional colors preserve absence rather than invent paint')

// Actual UI fixture: the first path rotates into the second path's world tip.
const openA = { version: 1, closed: false, points: [{ x: 0, y: 0, handleOut: { x: 40, y: 0 } }, { x: 160, y: 0, handleIn: { x: -20, y: 0 } }] }
const openB = { version: 1, closed: false, points: [{ x: 0, y: 0, handleOut: { x: 20, y: 16 } }, { x: 100, y: 80, handleIn: { x: -20, y: -16 } }] }
const a = node('open-a', { x: 180, y: 200, width: 160, height: 12, rotation: 90, vectorPath: openA })
const b = node('open-b', { x: 266, y: 286, width: 100, height: 80, vectorPath: openB })
for (const [first, second] of [[openA, openB], [openA, reverseVectorPath(openB)], [reverseVectorPath(openA), openB], [reverseVectorPath(openA), reverseVectorPath(openB)]]) {
  const source = [{ ...a, vectorPath: first }, { ...b, vectorPath: second }], snapshot = JSON.stringify(source)
  const result = composeVectorPaths(source, 'join')
  check(result.ok && result.node.vectorPath.points.length === 3 && !result.node.vectorBoolean, 'coincident transformed join merges exactly one anchor')
  for (const [index, expected] of [{ x: 266, y: 126 }, { x: 266, y: 286 }, { x: 366, y: 366 }].entries()) pointNear(boardPoint(result.node, result.node.vectorPath.points[index]), expected, 'transformed joined anchor')
  for (let step = 0; step <= 40; step++) {
    pointNear(boardPoint(result.node, cubic(result.node.vectorPath, 0, step / 40)), world(a, cubic(openA, 0, step / 40)), 'joined rotated cubic')
    pointNear(boardPoint(result.node, cubic(result.node.vectorPath, 1, step / 40)), world(b, cubic(openB, 0, step / 40)), 'joined second cubic')
  }
  assert.equal(JSON.stringify(source), snapshot); checks++
  fixtures++
}
const bridge = composeVectorPaths([a, { ...b, x: 1266 }], 'join')
check(bridge.ok && bridge.node.vectorPath.points.length === 4, 'distant endpoint join retains bridge')
const failures = [
  [[], 'union'], [[node('a')], 'union'], [[node('a'), node('a')], 'union'],
  [[node('a', { groupId: 'one' }), node('b', { groupId: 'two' })], 'union'],
  [[node('a', { parentColumnId: 'one' }), node('b', { parentColumnId: 'two' })], 'union'],
  [[node('a'), node('b', { locked: true })], 'union'], [[node('a'), node('b', { kind: 'image' })], 'union'],
  [[node('a'), node('b', { vectorBoolean: { operation: 'subtract', operands: [curved, curved] } })], 'union'],
  [[node('a'), node('b', { vectorTransform: { scaleX: 0 } })], 'union'],
  [[node('a'), node('b', { rotation: NaN })], 'union'], [[node('a'), node('b', { width: 0 })], 'union'],
  [[node('a'), node('b', { vectorPath: { ...curved, points: [{ x: Infinity, y: 0 }, ...curved.points.slice(1)] } })], 'union'],
  [[a, b], 'union'], [[node('a'), node('b')], 'join'], [[node('a'), node('b')], 'invalid'],
]
for (const [sources, operation] of failures) {
  const snapshot = JSON.stringify(sources), result = composeVectorPaths(sources, operation)
  check(!result.ok && typeof result.reason === 'string' && result.reason.length > 0, 'invalid source gives actionable refusal')
  assert.equal(JSON.stringify(sources), snapshot); checks++
}
check(!composeVectorPaths([a, b], 'join', 'joined', { joinTolerance: -1 }).ok, 'invalid join distance refused')
// A retained resolved boundary must be resized with its operands. Compare its
// world cubic samples independently, then compare fill pixels with a fresh
// Boolean resolution of the resized operands (including flip/skew/rotation).
const resizePixels = []
for (const operation of operations) for (const rotation of [0, 30, 90]) for (const vectorTransform of transforms) {
  const result = composeVectorPaths([node('resize-a'), node('resize-b', { x: 260, y: 200, vectorPath: { ...curved, points: curved.points.map((point) => ({ ...point, x: point.x + 10 })) } })], operation, 'resized')
  check(result.ok, 'resize fixture composition')
  const resolvedPaths = resolveVectorBooleanGeometry(operation, result.node.vectorBoolean.operands, result.node.vectorBoolean.fillRules)
  check(Array.isArray(resolvedPaths), 'fixture resolves actual Boolean boundary')
  const original = { ...result.node, rotation, vectorTransform, vectorBoolean: { ...result.node.vectorBoolean, resolvedPaths } }, snapshot = JSON.stringify(original)
  const frame = { x: 40, y: 50, width: original.width * 1.8, height: original.height * .65 }, resized = resizeVectorNodeFrame(original, frame)
  check(resized.vectorTransform === undefined && resized.rotation === rotation, 'Boolean resize bakes inner affine but retains rotation')
  check(resized.vectorBoolean.resolvedPaths !== resolvedPaths && resized.vectorBoolean.resolvedPaths.length === resolvedPaths.length, 'Boolean resize replaces derived contour coordinates')
  const expectedLocal = (point) => {
    const baked = world({ ...original, x: 0, y: 0, rotation: 0 }, point)
    return { x: baked.x * frame.width / original.width, y: baked.y * frame.height / original.height }
  }
  for (let contour = 0; contour < resolvedPaths.length; contour++) for (let segment = 0; segment < resolvedPaths[contour].points.length; segment++) for (let step = 0; step <= 20; step++) {
    const expected = world({ ...resized, vectorTransform: undefined }, expectedLocal(cubic(resolvedPaths[contour], segment, step / 20)))
    const actual = world(resized, cubic(resized.vectorBoolean.resolvedPaths[contour], segment, step / 20))
    pointNear(actual, expected, 'resized resolved world curve aligns with operands')
  }
  const fresh = resolveVectorBooleanGeometry(operation, resized.vectorBoolean.operands, resized.vectorBoolean.fillRules)
  check(Array.isArray(fresh), 'resized operands independently resolve')
  const allBounds = [...fresh, ...resized.vectorBoolean.resolvedPaths].map(vectorPathBounds)
  const left = Math.min(...allBounds.map((bound) => bound.left)), top = Math.min(...allBounds.map((bound) => bound.top)), right = Math.max(...allBounds.map((bound) => bound.right)), bottom = Math.max(...allBounds.map((bound) => bound.bottom))
  resizePixels.push({ name: `${operation}/${rotation}/${transforms.indexOf(vectorTransform)}`, cached: resized.vectorBoolean.resolvedPaths.map(vectorPathData).join(' '), fresh: fresh.map(vectorPathData).join(' '), left, top, width: right - left, height: bottom - top })
  assert.equal(JSON.stringify(original), snapshot, 'resize cannot mutate saved Boolean or operand records'); checks++
  assert.deepEqual(JSON.parse(JSON.stringify(resized.vectorBoolean)), resized.vectorBoolean); checks++
}
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
let pixelResults
try {
  const page = await browser.newPage()
  pixelResults = await page.evaluate((cases) => cases.map((fixture) => {
    const raster = (data) => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512
      const context = canvas.getContext('2d'), scale = 492 / Math.max(fixture.width, fixture.height, 1)
      context.translate(10, 10); context.scale(scale, scale); context.translate(-fixture.left, -fixture.top)
      context.fillStyle = '#ffffff'; context.fill(new Path2D(data), 'nonzero')
      return context.getImageData(0, 0, 512, 512).data
    }
    const cached = raster(fixture.cached), fresh = raster(fixture.fresh)
    let maxAlphaDifference = 0, totalAlphaDifference = 0, changedPixels = 0
    for (let p = 3; p < cached.length; p += 4) { const difference = Math.abs(cached[p] - fresh[p]); maxAlphaDifference = Math.max(maxAlphaDifference, difference); totalAlphaDifference += difference; if (difference) changedPixels++ }
    return { name: fixture.name, maxAlphaDifference, totalAlphaDifference, changedPixels }
  }), resizePixels)
} finally { await browser.close() }
// Re-resolving a transformed cubic can shift raster antialias by up to 12/255 on a boundary pixel; total tolerance is below two opaque pixels in a 512x512 image.
for (const result of pixelResults) check(result.maxAlphaDifference <= 12 && result.totalAlphaDifference <= 512, `retained resolved resize matches fresh Boolean pixels: ${JSON.stringify(result)}`)
const changed = []
for (const path of sourcePaths) if (hashes[path] !== createHash('sha256').update(await readFile(new URL(path, import.meta.url), 'utf8')).digest('hex')) changed.push(path)
assert.deepEqual(changed, [], 'source must remain stable throughout deterministic composition check')
const report = { generatedAt: new Date().toISOString(), ok: true, checks, transformedBooleanFixtures: 36, transformedJoinFixtures: 4, refusalFixtures: failures.length + 1, transformedBooleanResizePixelFixtures: pixelResults, sourceHashes: hashes, limits: 'Pure editable geometry, source metadata and independent browser Path2D Boolean resize pixels; does not certify actual UI integration or native disk/pixels.' }
const output = new URL('../output/playwright/vector-composition-2026-09-30/', import.meta.url)
await mkdir(output, { recursive: true }); await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))


