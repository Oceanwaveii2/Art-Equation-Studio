import assert from 'node:assert/strict'
import { imageDrawRect, imageSourceCrop, normalizeImageFraming } from '../src/model/imageFraming.ts'
import { planPyramid } from '../src/canvas-engine/imagePyramid.ts'

let comparisons = 0
const near = (actual, expected, label) => { comparisons++; assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10, `${label}: ${actual} != ${expected}`) }
const source = { width: 800, height: 400 }, frame = { width: 200, height: 200 }
const cases = [
  [{}, { x: 0, y: 50, width: 200, height: 100 }],
  [{ fit: 'cover' }, { x: -100, y: 0, width: 400, height: 200 }],
  [{ fit: 'fill' }, { x: 0, y: 0, width: 200, height: 200 }],
  [{ fit: 'cover', positionX: 0 }, { x: 0, y: 0, width: 400, height: 200 }],
  [{ fit: 'cover', positionX: 100 }, { x: -200, y: 0, width: 400, height: 200 }],
  [{ fit: 'cover', positionX: 25, zoom: 2 }, { x: -150, y: -100, width: 800, height: 400 }],
  [{ fit: 'contain', positionY: 100 }, { x: 0, y: 100, width: 200, height: 100 }],
  [{ fit: 'contain', zoom: 2 }, { x: -100, y: 0, width: 400, height: 200 }],
  [{ fit: 'fill', zoom: 2, positionX: 100, positionY: 0 }, { x: -200, y: 0, width: 400, height: 400 }],
]
for (const [metadata, expected] of cases) {
  const result = imageDrawRect(source, frame, metadata)
  for (const key of ['x', 'y', 'width', 'height']) near(result[key], expected[key], `${metadata.fit || 'default'} ${key}`)
  assert.deepEqual(imageDrawRect(source, frame, JSON.parse(JSON.stringify(metadata))), result)
}
assert.deepEqual(normalizeImageFraming({ fit: 'bad', positionX: NaN, positionY: Infinity, zoom: -2 }), { fit: 'contain', positionX: 50, positionY: 50, zoom: 1 })
assert.deepEqual(normalizeImageFraming({ fit: 'cover', positionX: -10, positionY: 110, zoom: 10 }), { fit: 'cover', positionX: 0, positionY: 100, zoom: 4 })
for (const invalid of [0, -1, NaN, Infinity]) {
  assert.equal(imageDrawRect({ width: invalid, height: 100 }, frame), undefined)
  assert.equal(imageDrawRect(source, { width: 100, height: invalid }), undefined)
}
assert.equal(imageDrawRect({ width: Number.MIN_VALUE, height: 1 }, { width: Number.MAX_VALUE, height: 1 }, { fit: 'fill' }), undefined)

// Algebraic properties across mixed aspect ratios, all positions and bounded
// zoom. The source and metadata objects must not be modified by framing.
for (const sw of [1, 97, 800, 8192]) for (const sh of [1, 111, 400, 4096]) {
  for (const fw of [70, 200, 937]) for (const fh of [55, 200, 641]) {
    for (const fit of ['contain', 'cover', 'fill']) for (const positionX of [0, 25, 50, 100]) for (const positionY of [0, 50, 100]) for (const zoom of [1, 2, 4]) {
      const input = Object.freeze({ width: sw, height: sh }), viewport = Object.freeze({ width: fw, height: fh }), metadata = Object.freeze({ fit, positionX, positionY, zoom })
      const rectangle = imageDrawRect(input, viewport, metadata)
      assert.ok(rectangle)
      near(rectangle.x, (fw - rectangle.width) * positionX / 100, 'position X')
      near(rectangle.y, (fh - rectangle.height) * positionY / 100, 'position Y')
      near(rectangle.width / sw, rectangle.scaleX, 'scale X')
      near(rectangle.height / sh, rectangle.scaleY, 'scale Y')
      if (fit !== 'fill') near(rectangle.width / rectangle.height, sw / sh, 'preserve source aspect')
      if (fit === 'contain' && zoom === 1) assert.ok(rectangle.width <= fw + 1e-9 && rectangle.height <= fh + 1e-9)
      if (fit === 'cover') assert.ok(rectangle.x <= 1e-9 && rectangle.y <= 1e-9 && rectangle.x + rectangle.width >= fw - 1e-9 && rectangle.y + rectangle.height >= fh - 1e-9)
      if (fit === 'fill' && zoom === 1) { near(rectangle.width, fw, 'fill width'); near(rectangle.height, fh, 'fill height') }
      const roi = imageSourceCrop(input, rectangle, { x: 0, y: 0, width: fw, height: fh })
      if (roi) { assert.ok(roi.x >= 0 && roi.y >= 0 && roi.x + roi.width <= sw + 1e-8 && roi.y + roi.height <= sh + 1e-8); assert.ok(roi.width > 0 && roi.height > 0) }
    }
  }
}
const contain = imageDrawRect(source, frame)
assert.equal(imageSourceCrop(source, contain, { x: 0, y: 0, width: 200, height: 40 }), undefined, 'letterbox-only view does not request tiles')
const cover = imageDrawRect(source, frame, { fit: 'cover', positionX: 100 })
assert.deepEqual(imageSourceCrop(source, cover, { x: 0, y: 0, width: 200, height: 200 }), { x: 400, y: 0, width: 400, height: 400 })
const fill = imageDrawRect(source, frame, { fit: 'fill' })
assert.deepEqual(imageSourceCrop(source, fill, { x: 50, y: 50, width: 100, height: 100 }), { x: 200, y: 100, width: 400, height: 200 }, 'fill ROI uses independent axes')

const pyramid = { schemaVersion: 1, width: 32768, height: 16384, tileSize: 512, overlap: 1, maxLevel: 15, posterRelativePath: 'projects/qa/assets/pyramids/qa/poster.png', tilesRelativePath: 'projects/qa/assets/pyramids/qa/tiles', manifestRelativePath: 'projects/qa/assets/pyramids/qa/manifest.json', sourceSha256: 'test', format: 'png' }
const largeFit = imageDrawRect(pyramid, { width: 400, height: 200 }, { fit: 'cover', zoom: 4, positionX: 100 })
const largeCrop = imageSourceCrop(pyramid, largeFit, { x: 0, y: 0, width: 400, height: 200 })
assert.ok(largeCrop.width < pyramid.width && largeCrop.height < pyramid.height)
const tiles = planPyramid(pyramid, largeCrop, Math.max(largeFit.scaleX, largeFit.scaleY) * 2)
assert.ok(tiles.length > 0 && tiles.length <= 49, 'framed ROI retains bounded tile planning')
console.log(`Part II source-safe image framing: PASS (${comparisons} numerical comparisons plus normalization, source ROI and tile-budget assertions)`)
