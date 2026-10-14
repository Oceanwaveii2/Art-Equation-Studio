import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const paperUrl = pathToFileURL(resolve('node_modules/paper/dist/paper-full.js')).href
const booleanCode = await source('../src/model/vectorBooleanGeometry.ts')
const booleanUrl = dataUrl(booleanCode.replace("from 'paper'", `from '${paperUrl}'`))
const vectorUrl = dataUrl(await source('../src/model/vector.ts'))
const connectorUrl = dataUrl(await source('../src/board/connectors.ts'))
const arrangementUrl = dataUrl((await source('../src/board/arrangement.ts')).replace("from '../model/vector'", `from '${vectorUrl}'`))
const svgUrl = dataUrl((await source('../src/board/vectorSvg.ts')).replace("from '../model/vector'", `from '${vectorUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`))
const minimapUrl = dataUrl((await source('../src/board/minimapGeometry.ts'))
  .replace("from './arrangement'", `from '${arrangementUrl}'`)
  .replace("from './connectors'", `from '${connectorUrl}'`)
  .replace("from './vectorSvg'", `from '${svgUrl}'`))
const themeUrl = dataUrl(await source('../src/canvasTheme.ts'))
const coreUrl = dataUrl(await source('../src/board/diagramStructureCore.ts'))
const nativeUrl = dataUrl((await source('../src/board/nativeSceneAdapter.ts'))
  .replace("from '../canvasTheme'", `from '${themeUrl}'`)
  .replace("from './connectors'", `from '${connectorUrl}'`)
  .replace("from './diagramStructureCore'", `from '${coreUrl}'`)
  .replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`)
  .replace("from './vectorSvg'", `from '${svgUrl}'`))
const { portPoint, nearestPort, connectorGeometry, connectorSvgMarkup } = await import(connectorUrl)
const { alignBoardNodes, boardNodeVisualBounds, distributeBoardNodes, packBoardNodes } = await import(arrangementUrl)
const { vectorNodeSvgMarkup } = await import(svgUrl)
const { mapToMinimap, minimapBounds, minimapSceneSvg } = await import(minimapUrl)
const { toNativeScene } = await import(nativeUrl)

const node = (id, x, y, width, height, over = {}) => ({ id, kind: 'image', title: id, x, y, width, height, ...over })
const edge = (over = {}) => ({ id: 'red-edge', sourceId: 'a', targetId: 'b', sourcePort: 'right', targetPort: 'left', style: 'curve', color: '#ff0000', width: 3, dashed: true, startArrow: true, endArrow: true, animated: false, label: 'approved <&> "safe"', ...over })
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)

// Attached ports and Bézier departure normals rotate with the object.
const rotated = node('a', 100, 50, 80, 40, { rotation: 90 })
const right = portPoint(rotated, 'right')
close(right.x, 140); close(right.y, 110)
assert.equal(nearestPort(rotated, { x: 140, y: 115 }), 'right')
const geometry = connectorGeometry(edge(), [rotated, node('b', 400, 80, 60, 50)])
assert(geometry.path.startsWith('M 140 110 C 140 '), 'rotated curve departs along the rotated side normal')
const markup = connectorSvgMarkup(edge(), [rotated, node('b', 400, 80, 60, 50)])
assert.match(markup, /marker-start="url\(#arrow-/)
assert.match(markup, /marker-end="url\(#arrow-/)
assert.match(markup, /orient="auto-start-reverse"/)
assert.match(markup, /fill="#ff0000"/)
assert.match(markup, /approved &lt;&amp;&gt; &quot;safe&quot;/)
assert(!markup.includes('<&>'))
assert.notEqual(markup.match(/id="([^"]+)"/)[1], connectorSvgMarkup(edge({ id: 'red edge' }), [rotated, node('b', 400, 80, 60, 50)]).match(/id="([^"]+)"/)[1], 'marker IDs remain distinct after punctuation changes')
assert.equal(connectorSvgMarkup(edge({ sourceId: 'missing', sourcePoint: undefined }), []), '', 'unresolvable connector is omitted')

// The exact same eligibility set determines targets and mutations.
const eligible = [node('one', 10, 20, 30, 50), node('two', 200, 80, 60, 20)]
const protectedNodes = [node('locked', -1000, -1000, 100, 100, { locked: true }), node('column-child', -200, -100, 10, 10, { parentColumnId: 'column' }), node('group-child', 30, 30, 10, 10, { groupId: 'group' }), node('column', 0, 0, 100, 500, { kind: 'column' }), node('group', 0, 0, 100, 500, { kind: 'group' })]
const initial = [...eligible, ...protectedNodes]
const aligned = alignBoardNodes(initial, initial.map((entry) => entry.id), 'left')
assert.equal(aligned[0].x, 10); assert.equal(aligned[1].x, 10)
protectedNodes.forEach((entry, index) => assert.equal(aligned[eligible.length + index], entry, 'locked/container/membership objects stay unchanged'))
const diagonal = node('diagonal', 100, 100, 100, 50, { rotation: 45 })
const visualAligned = alignBoardNodes([eligible[0], diagonal], ['one', 'diagonal'], 'left')
close(boardNodeVisualBounds(visualAligned[0]).left, boardNodeVisualBounds(visualAligned[1]).left)

// Equal gaps are clear edge distances, independent from object dimensions.
const varied = [node('wide', 0, 0, 100, 50), node('narrow', 140, 0, 30, 50), node('medium', 300, 0, 80, 50)]
const gaps = distributeBoardNodes(varied, varied.map((entry) => entry.id), 'horizontal', 'gaps')
close(gaps[1].x - gaps[0].x - gaps[0].width, gaps[2].x - gaps[1].x - gaps[1].width)
const explicitGaps = distributeBoardNodes(varied, varied.map((entry) => entry.id), 'horizontal', 'gaps', 18)
close(explicitGaps[1].x - explicitGaps[0].x - explicitGaps[0].width, 18)
const centers = distributeBoardNodes(varied, varied.map((entry) => entry.id), 'horizontal', 'centers')
const center = (entry) => entry.x + entry.width / 2
close(center(centers[1]) - center(centers[0]), center(centers[2]) - center(centers[1]))

// Fifty different aspect ratios pack into two rows without fixed max-width cells.
const collage = Array.from({ length: 50 }, (_, index) => node(`image-${index}`, index * 3, index * 4, 40 + index % 7 * 17, 60 + index % 5 * 23, { assetId: `source-${index}`, imageTransform: { crop: { x: .1, y: .1, width: .8, height: .8 } } }))
const packed = packBoardNodes(collage, collage.map((entry) => entry.id), { rows: 2, gap: 12 })
for (let index = 0; index < packed.length; index++) {
  assert.equal(packed[index].width, collage[index].width); assert.equal(packed[index].height, collage[index].height)
  assert.equal(packed[index].assetId, collage[index].assetId); assert.equal(packed[index].imageTransform, collage[index].imageTransform)
  if (index % 25) close(packed[index].x - packed[index - 1].x - packed[index - 1].width, 12)
}
assert.equal(new Set(packed.map((entry) => entry.y)).size, 2)
assert(packed[25].y >= Math.max(...packed.slice(0, 25).map((entry) => entry.y + entry.height)) + 12)

// The house roof is a triangle, not its hit rectangle, and ellipses stay ellipses.
const roof = node('roof', 100, 40, 200, 100, { kind: 'shape', shapeType: 'path', color: '#b96a21', opacity: 1, vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 200, y: 100 }] } })
const roundWindow = node('window', 175, 100, 50, 50, { kind: 'shape', shapeType: 'ellipse', color: '#123456', rotation: 30 })
const houseNodes = [roof, roundWindow]
const scene = {
  id: 'house', revision: 1, objects: houseNodes.map((entry, order) => ({ id: entry.id, order, revision: 1, kind: 'vector', bounds: { x: entry.x, y: entry.y, width: entry.width, height: entry.height }, localBounds: { x: entry.x, y: entry.y, width: entry.width, height: entry.height }, zIndex: order, locked: false, hidden: false, appearance: { fill: entry.color, opacity: 1, rotation: entry.rotation || 0 }, ...(entry.vectorPath ? { vectorPath: entry.vectorPath } : {}) })), connections: [], environment: { background: '#101010', grid: { visible: false, color: '#333333', opacity: 1, spacing: 40 } },
}
const mini = minimapSceneSvg(scene, houseNodes, minimapBounds(scene.objects, 1000, 800, houseNodes), 200, 120)
assert.match(mini, /M 0 100 L 100 0 L 200 100 Z/)
assert.match(mini, /<ellipse /)
assert.match(mini, /rotate\(30 200 125\)/)
assert(!mini.includes('fill-opacity=".28"'), '100% path must not inherit old preview tint')
assert.match(vectorNodeSvgMarkup({ ...roof, opacity: .5 }), /opacity="0.5"/)
assert.match(vectorNodeSvgMarkup({ ...roof, vectorPath: { ...roof.vectorPath, closed: false } }), /fill="none"/)
const nativeBoard = { id: 'house', title: 'House', nodes: [{ ...roof, opacity: .6 }, { ...roof, id: 'open', vectorPath: { ...roof.vectorPath, closed: false } }], connectors: [], viewport: { x: 0, y: 0, scale: 1 } }
const native = toNativeScene({ id: 'test', boards: [nativeBoard] }, nativeBoard, 'dark', 'test-1')
assert.equal(native.objects[0].payload.fillOpacity, 1, 'native adapter closed path has no hidden .28 alpha')
assert.equal(native.objects[0].opacity, .6, 'chosen opacity applied once at native object level')
assert.equal(native.objects[1].payload.fillOpacity, 0, 'open path has no automatic fill')
const nativeStudio = await readFile(new URL('../../Direct%20X%2012%20version/rust/src/studio.rs', import.meta.url), 'utf8')
assert(!nativeStudio.includes('{0.28}'), 'standalone native scene loader must not reintroduce path preview tint')
const nativeCompositor = await readFile(new URL('../../Direct%20X%2012%20version/rust/src/compositor.rs', import.meta.url), 'utf8')
const booleanPaint = nativeCompositor.slice(nativeCompositor.indexOf('let mut layers = 0;'), nativeCompositor.indexOf('self.vectors += 1;'))
assert(booleanPaint.indexOf('.stroke(&stroke') < booleanPaint.indexOf('self.scene.pop_layer();'), 'native subtract/intersect clipping survives through source stroke')
const erased = vectorNodeSvgMarkup({ ...roof, vectorBoolean: { operation: 'subtract', operands: [roof.vectorPath, { version: 1, closed: true, points: [{ x: 90, y: 0 }, { x: 110, y: 0 }, { x: 110, y: 100 }, { x: 90, y: 100 }] }] } })
assert(erased.includes('fill="#b96a21"') && erased.includes('stroke="#a8b1bd"'), 'SVG subtract encloses fill and outline')
const hiddenBounds = minimapBounds([...scene.objects, { ...scene.objects[0], id: 'hidden', hidden: true, bounds: { x: -10000, y: -10000, width: 1, height: 1 } }], 1000, 800, houseNodes)
assert(hiddenBounds.minX > -10000)
console.log('Part II canvas foundation: connector SVG/rotation, safe visual arrangement, 50-image packing and canonical minimap: PASS')

if (process.argv.includes('--render')) {
  const { chromium } = await import('playwright-core')
  const { mkdir } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 240 }, deviceScaleFactor: 2 })
    await page.setContent('<style>body{margin:0;background:#101010}canvas{width:400px;height:240px;image-rendering:auto}</style><canvas width="200" height="120"></canvas>')
    const bounds = minimapBounds(scene.objects, 1000, 800, houseNodes)
    const map = mapToMinimap(bounds, 200, 120)
    const pixels = await page.evaluate(async ({ svg, outside, inside }) => {
      const image = new Image()
      const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject })
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await loaded
      const context = document.querySelector('canvas').getContext('2d')
      context.drawImage(image, 0, 0)
      const pixel = (point) => [...context.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data]
      return { outside: pixel(outside), inside: pixel(inside) }
    }, { svg: mini, outside: { x: map.x(115), y: map.y(55) }, inside: { x: map.x(200), y: map.y(65) } })
    assert.deepEqual(pixels.outside, [16, 16, 16, 255], 'roof hit envelope must not fill the empty corner')
    assert.deepEqual(pixels.inside, [185, 106, 33, 255], '100% canonical roof fill renders fully opaque')
    const artifacts = resolve('output/playwright/partii-canvas-2026-09-29')
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: resolve(artifacts, 'canonical-house-minimap.png') })
    console.log('Rendered SVG at 200% pixel density: canonical triangle silhouette and 100% opacity: PASS', pixels)
    const rectangle = { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }] }
    const eraser = { version: 1, closed: true, points: [{ x: 40, y: -10 }, { x: 60, y: -10 }, { x: 60, y: 90 }, { x: 40, y: 90 }] }
    const erasedNode = node('erased', 20, 20, 100, 80, { kind: 'shape', shapeType: 'path', color: '#ff0000', strokeColor: '#00ff00', strokeWidth: 8, vectorPath: rectangle, vectorBoolean: { operation: 'subtract', operands: [rectangle, eraser] } })
    const eraserSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="100%" height="100%" fill="#101010"/>${vectorNodeSvgMarkup(erasedNode)}</svg>`
    const cutPixels = await page.evaluate(async (svg) => {
      const image = new Image()
      const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject })
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await loaded
      const context = document.querySelector('canvas').getContext('2d')
      context.clearRect(0, 0, 200, 120); context.drawImage(image, 0, 0)
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data]
      return { gap: pixel(70, 20), outline: pixel(30, 20), outerOutline: pixel(30, 17), fill: pixel(30, 40) }
    }, eraserSvg)
    assert.deepEqual(cutPixels.gap, [16, 16, 16, 255], 'erased region removes original outline as well as fill')
    assert.deepEqual(cutPixels.outline, [0, 255, 0, 255], 'unaffected source outline remains')
    assert.deepEqual(cutPixels.outerOutline, [0, 255, 0, 255], 'subtract mask does not clip half of exterior stroke')
    assert.deepEqual(cutPixels.fill, [255, 0, 0, 255])
    await page.screenshot({ path: resolve(artifacts, 'erased-fill-and-outline.png') })
    console.log('Rendered vector Eraser: cut removes fill/stroke and preserves exterior source outline: PASS', cutPixels)
  } finally { await browser.close() }
}
