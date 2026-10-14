import assert from 'node:assert/strict'
import { IncrementalPenPath, VectorGeometryCache, vectorLodBand } from '../src/canvas-engine/vectorGeometryCache.ts'
import { scaleVectorPath, vectorPathBounds } from '../src/model/vector.ts'

const path = {
  closed: false,
  points: [
    { x: 0, y: 0, handleOut: { x: 40, y: -60 } },
    { x: 120, y: 80, handleIn: { x: -35, y: 45 }, handleOut: { x: 30, y: 30 } },
    { x: 240, y: 10, handleIn: { x: -40, y: -35 } },
  ],
}

const cache = new VectorGeometryCache(2_000)
const exact = cache.get(path, 1)
assert.equal(exact.band, 'exact')
assert.match(exact.canonicalData, /^M 0 0 C /)
assert.equal(exact.renderData, exact.canonicalData)
assert.equal(exact.segmentData.length, 2)
assert.equal(exact.segmentHitData.length, 2)
assert.match(exact.hitData, / L /, 'hit proxy is cached flattened geometry')

const far = cache.get(path, .18)
assert.equal(far.band, 'far')
assert.notEqual(far.renderData, exact.canonicalData)
assert.match(far.renderData, /^M 0 0 L /)
assert.equal(cache.get(path, .2), far, 'stable zoom bands reuse geometry')
assert.equal(cache.snapshot().hits, 1)

const changed = { ...path, points: path.points.map((point, index) => index === 1 ? { ...point, y: 84 } : point) }
const changedGeometry = cache.get(changed, .18)
assert.notEqual(changedGeometry.renderData, far.renderData, 'a changed canonical snapshot gets a new revision entry')
assert.equal(exact.canonicalData.includes('120 80'), true, 'cached geometry cannot mutate canonical points')
for (let index = 0; index < 12; index++) cache.get({ ...path, points: path.points.map((point) => ({ ...point, x: point.x + index })) }, .18)
assert(cache.snapshot().bytes <= cache.snapshot().limit || cache.snapshot().entries === 1)
assert(cache.snapshot().evictions > 0, 'bounded cache evicts least-recent entries')

assert.equal(vectorLodBand(.999), 'near')
assert.equal(vectorLodBand(.5), 'near')
assert.equal(vectorLodBand(.499), 'medium')
assert.equal(vectorLodBand(.249), 'far')

const resized = scaleVectorPath(path, 2, .5)
assert.deepEqual(resized.points[0].handleOut, { x: 80, y: -30 }, 'resize must scale outgoing Bézier controls with the path')
assert.deepEqual(resized.points[1].handleIn, { x: -70, y: 22.5 }, 'resize must scale incoming Bézier controls with the path')
assert.deepEqual(resized.points[2], { x: 480, y: 5, handleIn: { x: -80, y: -17.5 } }, 'resize must scale anchors and preserve control topology')
const bounds = vectorPathBounds(path)
assert(bounds.top < 0 && bounds.right === 240, 'path bounds include curved Bézier extrema rather than only the original node rectangle')

const pen = new IncrementalPenPath()
const first = [path.points[0]]
const second = [...first, path.points[1]]
const third = [...second, path.points[2]]
assert.equal(pen.sync(first), 'M 0 0')
assert.match(pen.sync(second), / C /)
assert.match(pen.sync(third), / 240 10$/)
assert.deepEqual(pen.snapshot(), { appends: 3, rebuilds: 0, points: 3 })
const edited = [...third.slice(0, 2), { ...third[2], x: 245 }]
assert.match(pen.sync(edited), /245 10$/)
assert.equal(pen.snapshot().rebuilds, 1, 'non-append edits rebuild exactly once')

console.log('P7/P8 vector cache, hit proxy, LOD bands and incremental Pen preview: PASS', cache.snapshot())
