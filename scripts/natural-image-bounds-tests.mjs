import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { assetIntrinsicSize, fitNaturalImageBounds, planTightImageBounds } from '../src/model/naturalImageBounds.ts'
import { imageDrawRect } from '../src/model/imageFraming.ts'
import { probeImageDimensions, readImageDimensions } from '../src/board/imageDimensions.ts'

let cases = 0
let numericalChecks = 0
const near = (actual, expected, label) => {
  numericalChecks++
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-9, `${label}: ${actual} != ${expected}`)
}
const checked = (label, run) => { run(); cases++; console.log('PASS ' + label) }
const envelope = Object.freeze({ width: 280, height: 220 })

checked('new square, landscape, portrait and clipboard placements preserve natural aspect', () => {
  const placements = [
    [{ width: 1500, height: 1500 }, envelope, { width: 220, height: 220 }],
    [{ width: 2400, height: 1200 }, envelope, { width: 280, height: 140 }],
    [{ width: 1200, height: 2400 }, envelope, { width: 110, height: 220 }],
    [{ width: 32768, height: 16384 }, envelope, { width: 280, height: 140 }],
    [{ width: 1500, height: 1500 }, { width: 320, height: 240 }, { width: 240, height: 240 }],
  ]
  for (const [source, limit, expected] of placements) {
    const result = fitNaturalImageBounds(Object.freeze(source), Object.freeze(limit))
    near(result.width, expected.width, 'placement width')
    near(result.height, expected.height, 'placement height')
    near(result.width / result.height, source.width / source.height, 'natural ratio')
  }
})
checked('small and fractional-size images use one scale without upscaling or independent rounding', () => {
  assert.deepEqual(fitNaturalImageBounds({ width: 64, height: 32 }, envelope), { width: 64, height: 32 })
  const source = { width: 987, height: 641 }, fitted = fitNaturalImageBounds(source, envelope)
  near(fitted.width, 280, 'fractional width')
  near(fitted.height, 641 * 280 / 987, 'fractional height')
  near(fitted.width / source.width, fitted.height / source.height, 'one scale')
  assert.notEqual(fitted.height, Math.round(fitted.height))
})
checked('placement stays bounded across mixed ratios and envelopes', () => {
  for (const width of [1, 64, 987, 1500, 32768]) for (const height of [1, 32, 641, 1500, 16384]) {
    for (const limit of [envelope, { width: 320, height: 240 }, { width: 1, height: 1 }]) {
      const fitted = fitNaturalImageBounds({ width, height }, limit)
      assert.ok(fitted.width > 0 && fitted.height > 0)
      assert.ok(fitted.width <= limit.width + 1e-9 && fitted.height <= limit.height + 1e-9)
      assert.ok(fitted.width <= width + 1e-9 && fitted.height <= height + 1e-9)
      near(fitted.width / width, fitted.height / height, 'bounded uniform scale')
    }
  }
})
checked('invalid or underflowing sizes cannot create corrupt nodes', () => {
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(fitNaturalImageBounds({ width: invalid, height: 100 }, envelope), undefined)
    assert.equal(fitNaturalImageBounds({ width: 100, height: invalid }, envelope), undefined)
    assert.equal(fitNaturalImageBounds({ width: 100, height: 100 }, { width: invalid, height: 220 }), undefined)
  }
  assert.equal(fitNaturalImageBounds(undefined, envelope), undefined)
  assert.equal(fitNaturalImageBounds({ width: Number.MIN_VALUE, height: Number.MAX_VALUE }, { width: 1, height: 1 }), undefined)
})

const pyramid = Object.freeze({
  schemaVersion: 1, generator: 'test', sourceSha256: 'test',
  width: 4096, height: 2048, tileSize: 512, overlap: 1, maxLevel: 12,
  format: 'png', tilesRelativePath: 'projects/test/assets/pyramids/test/tiles',
  posterRelativePath: 'projects/test/assets/pyramids/test/poster.png',
  manifestRelativePath: 'projects/test/assets/pyramids/test/manifest.json',
  tileCount: 1, generatedBytes: 1, displayColorSpace: 'srgb',
})
checked('metadata uses source dimensions first, then qualified pyramid, then generated output', () => {
  const generated = Object.freeze({ outputWidth: 700, outputHeight: 350 })
  const asset = Object.freeze({ imageDimensions: Object.freeze({ width: 1500, height: 1500 }), imagePyramid: pyramid, generated })
  assert.deepEqual(assetIntrinsicSize(asset), { width: 1500, height: 1500 })
  assert.notEqual(assetIntrinsicSize(asset), asset.imageDimensions, 'return a value, not mutable metadata')
  assert.deepEqual(assetIntrinsicSize({ imagePyramid: pyramid, generated }), { width: 4096, height: 2048 })
  assert.deepEqual(assetIntrinsicSize({ generated }), { width: 700, height: 350 })
})
checked('invalid metadata never mixes providers or accepts a broken pyramid contract', () => {
  const generated = { outputWidth: 700, outputHeight: 350 }
  assert.deepEqual(assetIntrinsicSize({ imageDimensions: { width: 1500, height: NaN }, imagePyramid: pyramid, generated }), { width: 4096, height: 2048 })
  assert.deepEqual(assetIntrinsicSize({ imagePyramid: { ...pyramid, tileSize: 256 }, generated }), { width: 700, height: 350 })
  assert.equal(assetIntrinsicSize({ imageDimensions: { width: 1500, height: 0 }, generated: { outputWidth: 700, outputHeight: -1 } }), undefined)
  assert.equal(assetIntrinsicSize({ imageDimensions: { width: 10.5, height: 10 } }), undefined)
  assert.equal(assetIntrinsicSize(undefined), undefined)
})

const foxy = Object.freeze({
  kind: 'image', imagePresentation: 'artwork', x: 1046, y: 623, width: 392, height: 294,
  imageTransform: Object.freeze({ fit: 'contain' }),
})
checked('American Foxy Momma tight bounds keep the same 294x294 pixels at the same place', () => {
  const source = { width: 1500, height: 1500 }
  const result = planTightImageBounds(foxy, source)
  assert.ok(result.ok)
  assert.deepEqual(result.bounds, { x: 1095, y: 623, width: 294, height: 294 })
  const before = imageDrawRect(source, foxy, foxy.imageTransform)
  const after = imageDrawRect(source, result.bounds, foxy.imageTransform)
  near(foxy.x + before.x, result.bounds.x + after.x, 'paint X')
  near(foxy.y + before.y, result.bounds.y + after.y, 'paint Y')
  near(before.width, after.width, 'paint width')
  near(before.height, after.height, 'paint height')
  near(foxy.x + foxy.width / 2, result.bounds.x + result.bounds.width / 2, 'rotation center X')
  near(foxy.y + foxy.height / 2, result.bounds.y + result.bounds.height / 2, 'rotation center Y')
  assert.deepEqual(foxy.imageTransform, { fit: 'contain' })
})

function worldPixel(node, source, point) {
  const draw = imageDrawRect(source, node, node.imageTransform)
  const x = draw.x + point.x * draw.scaleX - node.width / 2
  const y = draw.y + point.y * draw.scaleY - node.height / 2
  const angle = (node.rotation || 0) * Math.PI / 180
  return {
    x: node.x + node.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    y: node.y + node.height / 2 + x * Math.sin(angle) + y * Math.cos(angle),
  }
}
checked('outer rotation preserves all source-corner world positions and the rotation center', () => {
  for (const source of [{ width: 1500, height: 1500 }, { width: 2400, height: 1200 }, { width: 1200, height: 2400 }]) {
    for (const rotation of [0, 31, 90, -45, 180, 270]) {
      const original = Object.freeze({ ...foxy, rotation })
      const result = planTightImageBounds(original, source)
      assert.ok(result.ok)
      const tightened = { ...original, ...result.bounds }
      for (const point of [{ x: 0, y: 0 }, { x: source.width, y: 0 }, { x: 0, y: source.height }, { x: source.width, y: source.height }, { x: source.width / 2, y: source.height / 2 }]) {
        const before = worldPixel(original, source, point), after = worldPixel(tightened, source, point)
        near(before.x, after.x, 'rotated world X')
        near(before.y, after.y, 'rotated world Y')
      }
      near(original.x + original.width / 2, tightened.x + tightened.width / 2, 'outer rotation center X')
      near(original.y + original.height / 2, tightened.y + tightened.height / 2, 'outer rotation center Y')
    }
  }
})
checked('already tight artwork is idempotent and input objects remain unchanged', () => {
  const node = Object.freeze({ ...foxy, x: 1095, width: 294 })
  const first = planTightImageBounds(node, { width: 1500, height: 1500 })
  assert.ok(first.ok)
  assert.deepEqual(first.bounds, { x: 1095, y: 623, width: 294, height: 294 })
  assert.deepEqual(planTightImageBounds({ ...node, ...first.bounds }, { width: 1500, height: 1500 }), first)
  assert.equal(foxy.width, 392)
})

checked('card chrome, locked objects and non-images require explicit separate actions', () => {
  assert.equal(planTightImageBounds({ ...foxy, imagePresentation: undefined }, { width: 1500, height: 1500 }).reason, 'card-presentation')
  assert.equal(planTightImageBounds({ ...foxy, imagePresentation: 'card' }, { width: 1500, height: 1500 }).reason, 'card-presentation')
  assert.equal(planTightImageBounds({ ...foxy, locked: true }, { width: 1500, height: 1500 }).reason, 'locked')
  assert.equal(planTightImageBounds({ ...foxy, kind: 'video' }, { width: 1500, height: 1500 }).reason, 'not-image')
})
checked('crop, stretch, zoom, internal rotation and flip choices are protected', () => {
  for (const framing of [{ fit: 'cover' }, { fit: 'fill' }, { zoom: 2 }, { zoom: NaN }]) {
    assert.equal(planTightImageBounds({ ...foxy, imageTransform: framing }, { width: 1500, height: 1500 }).reason, 'cropped-framing')
  }
  for (const framing of [{ rotation: 90 }, { rotation: 180 }, { rotation: 270 }, { flipX: true }, { flipY: true }]) {
    assert.equal(planTightImageBounds({ ...foxy, imageTransform: framing }, { width: 1500, height: 1500 }).reason, 'inner-transform')
  }
})
checked('off-center or invalid framing never moves the original rotation center', () => {
  for (const positionX of [0, 25, 100]) {
    assert.equal(planTightImageBounds({ ...foxy, imageTransform: { positionX } }, { width: 1500, height: 1500 }).reason, 'off-center-framing')
  }
  for (const positionX of [-1, 101, NaN, Infinity]) {
    assert.equal(planTightImageBounds({ ...foxy, imageTransform: { positionX } }, { width: 1500, height: 1500 }).reason, 'invalid-framing')
  }
  // Position on a non-letterboxed axis has no geometric effect.
  assert.equal(planTightImageBounds({ ...foxy, imageTransform: { positionX: 0 } }, { width: 2400, height: 1200 }).ok, true)
})
checked('bad source, coordinates and rotation refuse the explicit repair without mutation', () => {
  assert.equal(planTightImageBounds(foxy, undefined).reason, 'invalid-geometry')
  for (const property of ['x', 'y', 'width', 'height', 'rotation']) {
    assert.equal(planTightImageBounds({ ...foxy, [property]: NaN }, { width: 1500, height: 1500 }).reason, 'invalid-geometry')
  }
})


const columnModules = new Map()
async function columnModuleUrl(file) {
  file = resolve(file)
  if (columnModules.has(file)) return columnModules.get(file)
  let code = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const match of [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)]) {
    const name = match[1]
    const target = name.startsWith('.')
      ? await columnModuleUrl(resolve(dirname(file), /\.tsx?$/.test(name) ? name : name + '.ts'))
      : import.meta.resolve(name)
    code = code.replaceAll("'" + name + "'", JSON.stringify(target)).replaceAll('"' + name + '"', JSON.stringify(target))
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  columnModules.set(file, url)
  return url
}
const columns = await import(await columnModuleUrl(fileURLToPath(new URL('../src/board/columns.ts', import.meta.url))))
const columnBoard = (children, extra = {}) => ({
  id: 'natural-artwork-column-test', title: 'Disposable image bounds test', viewport: { x: 0, y: 0, scale: 1 },
  connectors: [], nodes: [
    { id: 'column', kind: 'column', title: 'Images', x: 400, y: 30, width: 260, height: 300, ...extra },
    ...children,
  ],
})
const columnImage = (id, width, height, extra = {}) => ({
  id, kind: 'image', imagePresentation: 'artwork', title: id, x: 10, y: 10, width, height,
  parentColumnId: 'column', columnOrder: 0, ...extra,
})
const reflow = (board) => {
  const result = columns.layoutBoardColumnsResult(board, ['column'])
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.value
}
const columnNode = (board, id) => board.nodes.find((node) => node.id === id)
checked('column reflow retains wide and fractional artwork ratios without card gutters', () => {
  for (const source of [{ width: 2000, height: 100 }, { width: 987, height: 641 }]) {
    const fitted = fitNaturalImageBounds(source, envelope)
    const before = columnBoard([columnImage('image', fitted.width, fitted.height)], { columnImageSizing: 'responsive' })
    const snapshot = JSON.stringify(before), after = reflow(before), image = columnNode(after, 'image')
    near(image.width, 240, 'column inner width')
    near(image.height, source.height * 240 / source.width, 'natural column height')
    near(image.width / image.height, source.width / source.height, 'natural column ratio')
    const draw = imageDrawRect(source, image)
    near(draw.x, 0, 'no horizontal image gutter'); near(draw.y, 0, 'no vertical image gutter')
    assert.equal(JSON.stringify(before), snapshot, 'source board remains unchanged')
    assert.deepEqual(reflow(after), after, 'column reflow is idempotent')
  }
})
checked('drop into a column retains free-size ratio across later column width changes', () => {
  const fitted = fitNaturalImageBounds({ width: 2000, height: 100 }, envelope)
  const before = columnBoard([columnImage('free', fitted.width, fitted.height, { parentColumnId: undefined, columnOrder: undefined })], { columnImageSizing: 'responsive' })
  const result = columns.insertNodesIntoColumnResult(before, ['free'], { columnId: 'column', index: 0 })
  assert.equal(result.ok, true, JSON.stringify(result))
  const inserted = columnNode(result.value, 'free')
  assert.equal(inserted.parentColumnId, 'column')
  near(inserted.freeWidth, fitted.width, 'free width retained'); near(inserted.freeHeight, fitted.height, 'free height retained')
  near(inserted.height, 12, 'wide drop has no 78px card minimum')
  const wider = { ...result.value, nodes: result.value.nodes.map((node) => node.id === 'column' ? { ...node, width: 500 } : node) }
  const resized = columnNode(reflow(wider), 'free')
  near(resized.width, 480, 'wider column inner width'); near(resized.height, 24, 'wider artwork proportional height')
})
checked('preserve-size columns retain small artwork without upscaling', () => {
  const image = columnNode(reflow(columnBoard([columnImage('small', 64, 32)], { columnPreserveCardSizes: true })), 'small')
  assert.equal(image.width, 64); assert.equal(image.height, 32)
})
checked('legacy cards and documents retain framing while subboards use compact rows', () => {
  for (const imagePresentation of [undefined, 'card']) {
    const card = columnNode(reflow(columnBoard([columnImage('card', 280, 14, { imagePresentation })])), 'card')
    assert.equal(card.width, 240); assert.equal(card.height, 78)
  }
  const document = columnNode(reflow(columnBoard([columnImage('document', 280, 14, { kind: 'document' })])), 'document')
  assert.equal(document.height, 70)
  const tile = columnNode(reflow(columnBoard([columnImage('tile', 280, 14, {
    kind: 'board-link', boardLinkRole: 'child', boardPortal: { boardId: 'child-board' },
  })])), 'tile')
  assert.equal(tile.width, 240); assert.equal(tile.height, 72)
  const framing = { fit: 'cover', zoom: 2, positionX: 0 }
  const manuallyFramed = columnNode(reflow(columnBoard([columnImage('manual-artwork', 200, 100, { imageTransform: framing })])), 'manual-artwork')
  near(manuallyFramed.width / manuallyFramed.height, 2, 'retain deliberate saved frame ratio')
  assert.deepEqual(manuallyFramed.imageTransform, framing, 'crop choices stay unchanged')
})
checked('underflowing artwork reflow is refused atomically instead of storing zero-height geometry', () => {
  const before = columnBoard([columnImage('underflow', Number.MAX_VALUE, Number.MIN_VALUE)], { columnImageSizing: 'responsive' })
  const snapshot = JSON.stringify(before), result = columns.layoutBoardColumnsResult(before, ['column'])
  assert.equal(result.ok, false)
  assert.equal(result.issues[0].code, 'invalid-layout')
  assert.equal(JSON.stringify(before), snapshot)
})

const setImageSizing = (board, sizing) => {
  const result = columns.setColumnImageSizingResult(board, 'column', sizing)
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.value
}
checked('saved columns without a sizing field retain exact legacy floor and preserve-size behavior', () => {
  for (const columnPreserveCardSizes of [undefined, true]) {
    const before = columnBoard([columnImage('wide', 280, 14)], { columnPreserveCardSizes })
    const snapshot = JSON.stringify(before), after = reflow(before), image = columnNode(after, 'wide')
    assert.equal(image.width, 240)
    assert.equal(image.height, columnPreserveCardSizes ? 12 : 78)
    assert.equal(Object.hasOwn(columnNode(after, 'column'), 'columnImageSizing'), false)
    assert.equal(Object.hasOwn(image, 'freeWidth'), false)
    assert.equal(Object.hasOwn(image, 'freeHeight'), false)
    assert.equal(JSON.stringify(before), snapshot, 'layout does not migrate the source snapshot')
  }
  const corruptMode = columnBoard([columnImage('wide', 280, 14)], { columnImageSizing: 'unknown-future-mode' })
  assert.equal(columnNode(reflow(corruptMode), 'wide').height, 78, 'unrecognized fields cannot opt into responsive sizing')
})
checked('explicit modes override preserve-card widths only for eligible artwork', () => {
  for (const sizing of ['responsive', 'minimum-height']) {
    const before = columnBoard([
      columnImage('wide', 280, 14),
      columnImage('small', 64, 32, { columnOrder: 1 }),
    ], { columnPreserveCardSizes: true })
    const after = setImageSizing(before, sizing)
    const wide = columnNode(after, 'wide'), small = columnNode(after, 'small')
    assert.equal(wide.width, 240); assert.equal(small.width, 240)
    assert.equal(wide.height, sizing === 'responsive' ? 12 : 78)
    assert.equal(small.height, 120)
    assert.equal(columnNode(after, 'column').columnPreserveCardSizes, true, 'retain the saved rules for other cards')
  }
})
checked('mode toggles retain a paired free-size basis and reflow width without accumulating floor distortion', () => {
  const before = columnBoard([columnImage('wide', 280, 14)], { columnPreserveCardSizes: true })
  const snapshot = JSON.stringify(before)
  let current = before
  for (const sizing of ['minimum-height', 'responsive', 'minimum-height', 'responsive']) {
    current = setImageSizing(current, sizing)
    const image = columnNode(current, 'wide')
    assert.equal(image.freeWidth, 280); assert.equal(image.freeHeight, 14)
    assert.equal(image.height, sizing === 'responsive' ? 12 : 78)
    assert.equal(columnNode(current, 'column').columnImageSizing, sizing)
  }
  assert.equal(setImageSizing(current, 'responsive'), current, 'a repeated choice on settled geometry is a true no-op')
  const wider = { ...current, nodes: current.nodes.map((node) => node.id === 'column' ? { ...node, width: 500 } : node) }
  const widened = reflow(wider), image = columnNode(widened, 'wide')
  assert.equal(image.width, 480); assert.equal(image.height, 24)
  assert.equal(image.freeWidth, 280); assert.equal(image.freeHeight, 14)
  near(image.width / image.height, 20, 'retained source ratio after width reshape')
  const restoredMinimum = setImageSizing(widened, 'minimum-height')
  assert.equal(columnNode(restoredMinimum, 'wide').height, 78)
  assert.equal(columnNode(setImageSizing(restoredMinimum, 'responsive'), 'wide').height, 24)
  assert.equal(JSON.stringify(before), snapshot, 'one command returns a new document and preserves the Undo snapshot')
})
checked('image sizing and its source frame round-trip through ordinary portable JSON', () => {
  for (const sizing of ['responsive', 'minimum-height']) {
    const after = setImageSizing(columnBoard([columnImage('wide', 280, 14)]), sizing)
    const restored = JSON.parse(JSON.stringify(after))
    assert.deepEqual(restored, after)
    assert.equal(reflow(restored), restored, 'reloading settled geometry does not create a document change')
    assert.equal(columnNode(restored, 'column').columnImageSizing, sizing)
    assert.equal(columnNode(restored, 'wide').freeWidth, 280)
    assert.equal(columnNode(restored, 'wide').freeHeight, 14)
  }
  const partial = columnBoard([columnImage('partial', 200, 100, { freeWidth: 280 })])
  const repairedPair = columnNode(setImageSizing(partial, 'responsive'), 'partial')
  assert.equal(repairedPair.freeWidth, 200); assert.equal(repairedPair.freeHeight, 100, 'never pair a previous width with a newer floored height')
})
checked('both modes preserve explicit image crops, transforms, cards, documents and square covers', () => {
  const transforms = [{ fit: 'cover' }, { fit: 'fill' }, { zoom: 2 }, { rotation: 90 }, { flipX: true }, { flipY: true }, { positionX: 0 }, { positionY: 75 }]
  for (const sizing of ['responsive', 'minimum-height']) {
    for (const imageTransform of transforms) {
      const before = columnBoard([columnImage('manual', 280, 14, { imageTransform })])
      const after = setImageSizing(before, sizing), image = columnNode(after, 'manual')
      assert.equal(image.width, 240); assert.equal(image.height, 78)
      assert.deepEqual(image.imageTransform, imageTransform)
      assert.equal(Object.hasOwn(image, 'freeWidth'), false, 'do not recast deliberate crops as natural artwork')
    }
    for (const imagePresentation of [undefined, 'card']) {
      const card = columnNode(setImageSizing(columnBoard([columnImage('card', 280, 14, { imagePresentation })]), sizing), 'card')
      assert.equal(card.width, 240); assert.equal(card.height, 78)
      assert.equal(Object.hasOwn(card, 'freeWidth'), false)
    }
    const document = columnNode(setImageSizing(columnBoard([columnImage('document', 280, 14, { kind: 'document' })]), sizing), 'document')
    assert.equal(document.height, 70)
    const tile = columnNode(setImageSizing(columnBoard([columnImage('tile', 280, 14, {
      kind: 'board-link', boardLinkRole: 'child', boardPortal: { boardId: 'child-board' },
    })]), sizing), 'tile')
    assert.equal(tile.width, 240); assert.equal(tile.height, 72)
  }
})
const nodeColumns = await import(await columnModuleUrl(fileURLToPath(new URL('../src/board/nodeColumnCommands.ts', import.meta.url))))
checked('fixed Node Columns reflow only on explicit choice and retain typed graph endpoints and socket identities', () => {
  const before = columnBoard([
    columnImage('source', 280, 14),
    columnImage('target', 280, 140, { columnOrder: 1, nodeGraphRole: 'reference' }),
  ], { columnMode: 'node', columnFixedLayout: true, columnPreserveCardSizes: true, nodeGraphRole: 'general' })
  const source = nodeColumns.nodeGraphPorts(before, columnNode(before, 'source')).find((port) => port.side === 'right' && port.direction !== 'target')
  const target = nodeColumns.nodeGraphPorts(before, columnNode(before, 'target')).find((port) => port.side === 'left' && port.direction !== 'source')
  assert.ok(source && target)
  const connected = nodeColumns.connectNodeGraphPortsResult(before, {
    id: 'typed-edge', sourceId: 'source', sourceSocket: source.key, targetId: 'target', targetSocket: target.key,
  })
  assert.equal(connected.ok, true, JSON.stringify(connected))
  const saved = connected.value, snapshot = JSON.stringify(saved)
  const automatic = columns.layoutBoardColumnsResult(saved)
  assert.equal(automatic.ok, true); assert.equal(automatic.value, saved, 'ordinary normalization retains the exact fixed layout')
  for (const sizing of ['responsive', 'minimum-height']) {
    const after = setImageSizing(saved, sizing), column = columnNode(after, 'column')
    assert.equal(column.columnMode, 'node'); assert.equal(column.columnFixedLayout, true)
    assert.equal(column.nodeGraphRole, 'general'); assert.equal(column.columnPreserveCardSizes, true)
    assert.equal(columnNode(after, 'source').height, sizing === 'responsive' ? 12 : 78)
    assert.deepEqual(after.connectors, saved.connectors, 'typed edge identity and socket payload remain unchanged')
    for (const id of ['column', 'source', 'target']) {
      assert.deepEqual(nodeColumns.nodeGraphPorts(after, columnNode(after, id)), nodeColumns.nodeGraphPorts(saved, columnNode(saved, id)), 'socket semantics survive reflow')
    }
    assert.equal(columns.layoutBoardColumnsResult(after).value, after, 'fixed policy still applies after the explicit action')
  }
  assert.equal(JSON.stringify(saved), snapshot)
})
checked('read-only, locked ancestors or descendants, hidden rows and noncolumns refuse the whole command', () => {
  const plain = columnBoard([columnImage('image', 280, 14)])
  const parent = { id: 'parent', kind: 'group', title: 'Parent', x: 0, y: 0, width: 800, height: 800, locked: true }
  const nestedGroup = { id: 'nested', kind: 'group', title: 'Nested', x: 10, y: 10, width: 200, height: 100, parentColumnId: 'column', columnOrder: 1 }
  const scenarios = [
    [plain, 'column', 'responsive', true, 'read-only'],
    [plain, 'image', 'responsive', false, 'wrong-owner-kind'],
    [plain, 'missing', 'responsive', false, 'missing-owner'],
    [plain, 'column', 'invalid', false, 'invalid-image-sizing'],
    [columnBoard([columnImage('image', 280, 14)], { locked: true }), 'column', 'responsive', false, 'uneditable-owner'],
    [columnBoard([columnImage('image', 280, 14)], { hidden: true }), 'column', 'responsive', false, 'uneditable-owner'],
    [columnBoard([columnImage('image', 280, 14)], { collapsed: true }), 'column', 'responsive', false, 'uneditable-owner'],
    [columnBoard([columnImage('image', 280, 14, { locked: true })]), 'column', 'responsive', false, 'uneditable-owner'],
    [columnBoard([columnImage('image', 280, 14, { hidden: true })]), 'column', 'responsive', false, 'uneditable-owner'],
    [columnBoard([columnImage('image', 280, 14), parent], { groupId: 'parent' }), 'column', 'responsive', false, 'uneditable-owner'],
    [columnBoard([nestedGroup, columnImage('nested-image', 200, 10, { parentColumnId: undefined, groupId: 'nested', locked: true })]), 'column', 'responsive', false, 'uneditable-owner'],
  ]
  for (const [board, id, mode, readOnly, code] of scenarios) {
    const snapshot = JSON.stringify(board), result = columns.setColumnImageSizingResult(board, id, mode, readOnly)
    assert.equal(result.ok, false); assert.equal(result.issues[0].code, code)
    assert.equal(JSON.stringify(board), snapshot, 'no flag, free-size metadata or geometry is partially committed')
  }
  const underflow = columnBoard([columnImage('image', Number.MAX_VALUE, Number.MIN_VALUE)])
  const snapshot = JSON.stringify(underflow), result = columns.setColumnImageSizingResult(underflow, 'column', 'responsive')
  assert.equal(result.ok, false); assert.equal(result.issues[0].code, 'invalid-layout')
  assert.equal(JSON.stringify(underflow), snapshot, 'failed sizing calculations preserve the original document')
})

const originalImageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image')
const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout
const images = [], timers = new Map()
let timerId = 0
class FakeImage {
  naturalWidth = 0
  naturalHeight = 0
  onload = null
  onerror = null
  source = ''
  clearedSources = 0
  constructor() { images.push(this) }
  set src(value) { this.source = value }
  get src() { return this.source }
  removeAttribute(name) { assert.equal(name, 'src'); this.source = ''; this.clearedSources++ }
  load(width, height) { this.naturalWidth = width; this.naturalHeight = height; this.onload?.() }
  fail() { this.onerror?.() }
}
const checkedAsync = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }
globalThis.Image = FakeImage
globalThis.setTimeout = (callback, milliseconds) => { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id }
globalThis.clearTimeout = (id) => timers.delete(id)
try {
  await checkedAsync('placement and preview share pending and resolved probes with decoder cleanup', async () => {
    const count = images.length
    const first = probeImageDimensions('test:shared-dimensions')
    assert.equal(probeImageDimensions('test:shared-dimensions'), first)
    assert.equal(images.length, count + 1)
    const image = images.at(-1)
    image.load(1500, 1500)
    assert.deepEqual(await first, { width: 1500, height: 1500 })
    assert.equal(probeImageDimensions('test:shared-dimensions'), first)
    assert.equal(images.length, count + 1, 'resolved cache avoids another decoder')
    assert.equal(image.onload, null)
    assert.equal(image.onerror, null)
    assert.equal(image.src, '')
    assert.equal(image.clearedSources, 1)
    assert.equal(timers.size, 0)
  })
  await checkedAsync('failed and invalid-dimension probes release resources and allow retry', async () => {
    const failed = probeImageDimensions('test:failed-dimensions'), failedImage = images.at(-1)
    failedImage.fail()
    await assert.rejects(failed, /unavailable/)
    assert.equal(failedImage.onload, null); assert.equal(failedImage.onerror, null); assert.equal(failedImage.src, '')
    const retry = probeImageDimensions('test:failed-dimensions')
    assert.notEqual(retry, failed)
    images.at(-1).load(1200, 2400)
    assert.deepEqual(await retry, { width: 1200, height: 2400 })
    const invalid = probeImageDimensions('test:invalid-dimensions')
    images.at(-1).load(0, 10)
    await assert.rejects(invalid, /invalid/)
    const valid = probeImageDimensions('test:invalid-dimensions')
    images.at(-1).load(10, 10)
    assert.deepEqual(await valid, { width: 10, height: 10 })
    assert.equal(timers.size, 0)
  })
  await checkedAsync('12-second timeout cancels the source, ignores late events and allows retry', async () => {
    const pending = probeImageDimensions('test:timeout-dimensions'), image = images.at(-1), lateLoad = image.onload
    const timer = [...timers.values()][0]
    assert.equal(timer.milliseconds, 12_000)
    timer.callback()
    await assert.rejects(pending, /timed out after 12 seconds/)
    assert.equal(image.src, ''); assert.equal(image.onload, null); assert.equal(image.onerror, null)
    image.naturalWidth = 999; image.naturalHeight = 999; lateLoad()
    const retry = probeImageDimensions('test:timeout-dimensions')
    images.at(-1).load(280, 140)
    assert.deepEqual(await retry, { width: 280, height: 140 })
    assert.equal(timers.size, 0)
  })
  await checkedAsync('metadata and oversized/tiled guards avoid original decoding and thumbnail guesses', async () => {
    const count = images.length
    assert.deepEqual(await readImageDimensions({ imageDimensions: { width: 1500, height: 1500 }, byteLength: 64 * 1024 * 1024, requiresTiledPreview: true }, 'test:must-not-decode-metadata'), { width: 1500, height: 1500 })
    assert.deepEqual(await readImageDimensions({ imagePyramid: pyramid, requiresTiledPreview: true }, 'test:must-not-decode-pyramid'), { width: 4096, height: 2048 })
    assert.deepEqual(await readImageDimensions({ generated: { outputWidth: 900, outputHeight: 600 }, byteLength: 64 * 1024 * 1024 }, 'test:must-not-decode-generated'), { width: 900, height: 600 })
    assert.equal(await readImageDimensions({ requiresTiledPreview: true, thumbnailRelativePath: 'test:thumbnail' }, 'test:must-not-decode-tiled'), undefined)
    assert.equal(await readImageDimensions({ byteLength: 32 * 1024 * 1024 + 1, thumbnailRelativePath: 'test:thumbnail' }, 'test:must-not-decode-large'), undefined)
    assert.equal(await readImageDimensions(undefined), undefined)
    assert.equal(images.length, count)
    const atLimit = readImageDimensions({ byteLength: 32 * 1024 * 1024 }, 'test:at-byte-limit')
    images.at(-1).load(100, 50)
    assert.deepEqual(await atLimit, { width: 100, height: 50 })
    assert.equal(timers.size, 0)
  })
  await checkedAsync('empty source rejects without creating an image or timer', async () => {
    const count = images.length
    await assert.rejects(probeImageDimensions('   '), /source is unavailable/)
    assert.equal(images.length, count)
    assert.equal(timers.size, 0)
  })
  await checkedAsync('192-entry eviction and late failure cannot remove a newer source request', async () => {
    const old = probeImageDimensions('test:evicted-subject'), oldImage = images.at(-1)
    const fillers = [], fillerImages = []
    for (let index = 0; index < 192; index++) {
      fillers.push(probeImageDimensions('test:cache-filler-' + index))
      fillerImages.push(images.at(-1))
    }
    const replacement = probeImageDimensions('test:evicted-subject'), replacementImage = images.at(-1)
    assert.notEqual(old, replacement, 'the oldest promise is evicted at bounded capacity')
    oldImage.fail()
    await assert.rejects(old, /unavailable/)
    assert.equal(probeImageDimensions('test:evicted-subject'), replacement, 'old rejection retains the newer cache entry')
    replacementImage.load(400, 200)
    assert.deepEqual(await replacement, { width: 400, height: 200 })
    fillerImages.forEach((image) => image.load(10, 10))
    await Promise.all(fillers)
    assert.equal(timers.size, 0)
  })
} finally {
  // Leave no pending fake requests or replaced globals, even after a failure.
  images.forEach((image) => image.onerror?.())
  timers.clear()
  if (originalImageDescriptor) Object.defineProperty(globalThis, 'Image', originalImageDescriptor)
  else delete globalThis.Image
  globalThis.setTimeout = originalSetTimeout
  globalThis.clearTimeout = originalClearTimeout
}

console.log(`Natural image bounds: PASS (${cases} focused cases; ${numericalChecks} numerical checks). No browser/native acceptance claim.`)

