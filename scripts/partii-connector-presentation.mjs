import { geometryModuleUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Disposable DOM fixture only: no app server, Tauri persistence, clipboard,
// live project, native renderer process, or Cavalry connection is used.
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }
const appRoot = resolve(option('--app-root') || resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const sourceRoot = resolve(option('--source-root') || appRoot)
const require = createRequire(resolve(appRoot, 'package.json'))
const ts = require('typescript')
const { chromium } = require('playwright-core')
const artifacts = resolve(option('--artifacts-root') || resolve(appRoot, 'output/playwright/partii-connector-presentation'))
await mkdir(artifacts, { recursive: true })
const code = async (relative, overridden = false) => ts.transpileModule(await readFile(resolve(overridden ? sourceRoot : appRoot, relative), 'utf8'), { fileName: relative, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
const moduleUrl = (value) => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`
const vectorUrl = moduleUrl(await code('src/model/vector.ts'))
const connectorUrl = moduleUrl(await code('src/board/connectors.ts'))
const themeUrl = moduleUrl(await code('src/canvasTheme.ts'))
const coreUrl = moduleUrl(await code('src/board/diagramStructureCore.ts'))
const paperUrl = pathToFileURL(resolve(appRoot, 'node_modules/paper/dist/paper-full.js')).href
const booleanUrl = moduleUrl((await code('src/model/vectorBooleanGeometry.ts')).replace("from 'paper'", `from '${paperUrl}'`))
const adapterUrl = moduleUrl((await code('src/board/artEquationCanvasAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`))
const svgUrl = moduleUrl((await code('src/board/vectorSvg.ts')).replace("from '../model/vector'", `from '${vectorUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`))
const nativeUrl = moduleUrl((await code('src/board/nativeSceneAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './connectors'", `from '${connectorUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanUrl}'`).replace("from './vectorSvg'", `from '${svgUrl}'`))
const eligibilityUrl = moduleUrl(await code('src/board/velloEligibility.ts'))
const presenterUrl = moduleUrl((await code('src/board/GesturePresenter.ts', true)).replace("from '../model/vector'", `from '${vectorUrl}'`).replace("from './connectors'", `from '${connectorUrl}'`))
const unusedReactUrl = moduleUrl('export const useEffect=()=>{},useLayoutEffect=()=>{},useRef=()=>{},useCallback=()=>{};')
const columnsUrl = moduleUrl((await code('src/board/columns.ts')).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../model/vector'", `from '${vectorUrl}'`))
const overlayUrl = moduleUrl((await code('src/board/OverlayPresenter.ts', true)).replace("from 'react'", `from '${unusedReactUrl}'`).replace("from './columns'", `from '${columnsUrl}'`).replace("from './connectors'", `from '${connectorUrl}'`).replace("from './GesturePresenter'", `from '${presenterUrl}'`))
const unusedRendererUrl = moduleUrl('export function createVelloPresenter(){ throw new Error("No live renderer allowed by this fixture"); }')
const backdropUrl = moduleUrl((await code('src/board/VelloBoardBackdrop.tsx', true)).replace(/import\s+['"]\.\/VelloBoardBackdrop\.css['"];?\s*/g, '').replace("from 'react'", `from '${unusedReactUrl}'`).replace("from '../project-b/p0-surface/presenter'", `from '${unusedRendererUrl}'`).replace("from './velloEligibility'", `from '${eligibilityUrl}'`))
const { createArtEquationCanvasScene } = await import(adapterUrl)
const { toNativeScene } = await import(nativeUrl)
const { eligibleVelloObjects } = await import(eligibilityUrl)
const { velloBoardSnapshot } = await import(backdropUrl)

const report = { passed: false, generatedAt: new Date().toISOString(), checks: [], limitations: ['Isolated actual DOM presenter and pure runtime serializer only; full App controls/native GPU pixels/physical Windows DPI remain parent gates.'], screenshots: [] }
const check = (name, passes, detail) => { report.checks.push({ name, passed: Boolean(passes), detail }); assert(passes, name); console.log(`PASS ${name}`) }
const node = (id, x, y, extra = {}) => ({ id, title: id, kind: 'image', x, y, width: 120, height: 90, ...extra })
const nodes = Array.from({ length: 24 }, (_, index) => node(`image-${index}`, 60 + index % 6 * 180, 60 + Math.floor(index / 6) * 140, { rotation: index === 2 ? 30 : 0 }))
const connectors = Array.from({ length: 30 }, (_, index) => ({ id: `edge-${index}`, sourceId: nodes[index % 24].id, targetId: nodes[(index + 7) % 24].id, sourcePort: 'right', targetPort: 'left', style: index % 3 === 0 ? 'elbow' : index % 3 === 1 ? 'curve' : 'straight', color: '#60a5fa', width: 3, dashed: false, animated: false, startArrow: false, endArrow: true, label: `Relation ${index}`, ...(index % 3 === 0 ? { bendPoints: [{ x: 260 + index * 2, y: 210 }, { x: 480, y: 290 + index }] } : {}), labelPosition: { t: .3, offsetX: 12, offsetY: -18 } }))
const board = { id: 'isolated-presentation', title: 'Disposable connected image fixture', nodes, connectors, viewport: { x: 0, y: 0, scale: .25 } }
const path = { version: 1, closed: true, points: [{ x: 0, y: 100 }, { x: 80, y: 0 }, { x: 160, y: 100 }] }
const lockedBoard = { ...board, nodes: [node('locked-a', 0, 0, { kind: 'shape', shapeType: 'path', vectorPath: path, locked: true }), node('locked-b', 400, 0, { kind: 'shape', shapeType: 'path', vectorPath: path, locked: true })], connectors: [{ ...connectors[0], id: 'locked-link', sourceId: 'locked-a', targetId: 'locked-b' }] }
const scene = createArtEquationCanvasScene(lockedBoard, [], { background: '#101010', grid: '#444444' })
const encoded = velloBoardSnapshot(scene, [])
const snapshot = JSON.parse(encoded.json)
check('eligible locked simple paths retain GPU paint while all runtime connections are DOM-owned', encoded.ids.size === 2 && snapshot.objects.length === 2 && snapshot.connections.length === 0 && scene.connections.length === 1, { encodedIds: [...encoded.ids], sourceConnections: scene.connections.length, runtimeConnections: snapshot.connections.length })
check('selection still immediately excludes selected locked geometry from GPU paint', eligibleVelloObjects(scene, ['locked-a']).every(item => item.id !== 'locked-a'))
const complexScene = { ...scene, objects: [...scene.objects, { ...scene.objects[0], id: 'boolean', vectorBoolean: { operation: 'subtract', operands: [path, path] } }, { ...scene.objects[0], id: 'transformed', vectorTransform: { skewY: 12 } }] }
check('Boolean and inner-transformed paths remain canonical DOM fallbacks', eligibleVelloObjects(complexScene, []).every(item => !['boolean', 'transformed'].includes(item.id)))
const native = toNativeScene({ id: 'fixture', boards: [lockedBoard] }, lockedBoard, 'dark', 'test')
check('native/export serializer retains canonical connector routes and label metadata', native.connections.length === 1 && native.connections[0].labelPosition.t === .3 && native.connections[0].bendPoints.length === 2 && native.connections[0].resolvedGeometry.commands.length > 1)

const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 650 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await page.setContent('<style>body{margin:0;background:#141820;color:#ddd;font:14px sans-serif}.board-world{position:relative;transform-origin:0 0}.board-node{position:absolute;background:#263746;border:1px solid #7b8794}.connector-layer{position:absolute;left:0;top:0;overflow:visible}.connector-label rect{fill:#182330;stroke:#8899aa}.connector-label text{fill:white}.connector-endpoint{fill:#eee;stroke:#60a5fa}.connector-bend{fill:#ffe080;stroke:#96771e}</style><h2>Isolated 24-image / 30-edge connector presentation</h2><div id="fixture"><div class="board-world"></div></div>')
  const results = await page.evaluate(async ({ presenterUrl, connectorUrl, overlayUrl, fixture }) => {
    const { GesturePresenter } = await import(presenterUrl)
    const { OverlayPresenter } = await import(overlayUrl)
    const { connectorGeometry, connectorLabelPoint } = await import(connectorUrl)
    const root = document.querySelector('#fixture'), world = root.querySelector('.board-world')
    const scale = fixture.viewport.scale
    world.style.transform = `scale(${scale})`
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('connector-layer'); svg.setAttribute('width', '1600'); svg.setAttribute('height', '800')
    const defs = document.createElementNS(svg.namespaceURI, 'defs'); svg.append(defs)
    const element = (name, attributes = {}) => { const result = document.createElementNS(svg.namespaceURI, name); Object.entries(attributes).forEach(([key, value]) => result.setAttribute(key, String(value))); return result }
    const groups = new Map()
    const checks = []
    const close = (actual, expected) => Math.abs(Number(actual) - expected) < .000001
    const verify = (name, condition) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw new Error(name) }
    fixture.nodes.forEach(node => { const item = document.createElement('article'); item.className = 'board-node'; item.dataset.nodeId = node.id; item.style.cssText = `left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;transform:rotate(${node.rotation || 0}deg) scale(1)`; world.append(item) })
    fixture.connectors.forEach(connector => {
      const geometry = connectorGeometry(connector, fixture.nodes), labelPoint = connectorLabelPoint(connector, geometry)
      const marker = element('marker', { id: `arrow-${connector.id}`, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto-start-reverse' }); marker.append(element('path', { d: 'M 0 0 L 8 4 L 0 8 z', fill: connector.color })); defs.append(marker)
      const group = element('g', { 'data-connector-id': connector.id, 'data-connector-scale': scale })
      group.append(element('path', { class: 'connector-hit', d: geometry.path, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(14 / scale, connector.width + 12 / scale) }))
      group.append(element('path', { class: 'connector-path', d: geometry.path, fill: 'none', stroke: connector.color, 'stroke-width': connector.width, 'marker-end': `url(#arrow-${connector.id})` }))
      const label = element('g', { class: 'connector-label', transform: `translate(${labelPoint.x} ${labelPoint.y})` }); label.append(element('rect', { x: -50, y: -12, width: 100, height: 24, rx: 7 })); const text = element('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }); text.textContent = connector.label; label.append(text); group.append(label)
      // Reverse element order intentionally: endpoint identity is semantic,
      // not inferred from the order of children in a React fragment.
      group.append(element('circle', { class: 'connector-endpoint', 'data-endpoint': 'target', cx: geometry.target.x, cy: geometry.target.y, r: 7 / scale }))
      group.append(element('circle', { class: 'connector-endpoint', 'data-endpoint': 'source', cx: geometry.source.x, cy: geometry.source.y, r: 7 / scale }))
      connector.bendPoints?.forEach((point, index) => group.append(element('circle', { class: 'connector-bend', 'data-bend-index': index, cx: point.x, cy: point.y, r: 7 / scale })))
      groups.set(connector.id, group); svg.append(group)
    })
    world.prepend(svg)
    let mountedCalls = 0, events = 0, pointerEvents = 0
    root.addEventListener('canvas-gesture-presented', () => { events++ })
    const presenter = new GesturePresenter(() => root, ids => { if (ids.length) mountedCalls++ })
    const group = groups.get('edge-0'), path = group.querySelector('.connector-path'), label = group.querySelector('.connector-label')
    path.addEventListener('pointerdown', () => { pointerEvents++ })
    const oldSvg = svg.outerHTML, oldText = label.querySelector('text')
    const edited = { ...fixture.connectors[0], sourcePoint: { x: 95, y: 85 }, targetPoint: { x: 615, y: 395 }, sourceId: undefined, targetId: undefined, sourcePortMode: 'fixed', targetPortMode: 'fixed', bendPoints: [{ x: 255, y: 125 }, { x: 495, y: 295 }], labelPosition: { t: .8, offsetX: -7, offsetY: 23 }, label: 'Changed <label> & cue', color: '#ef4444', width: 6, linePattern: 'dot', startArrow: true, endArrow: false }
    const next = { ...fixture, connectors: [edited, ...fixture.connectors.slice(1)] }
    presenter.present(fixture, next)
    const geometry = connectorGeometry(edited, next.nodes), point = connectorLabelPoint(edited, geometry)
    verify('connector-only free endpoint and manual route changes update real DOM path without node edits', path.getAttribute('d') === geometry.path && mountedCalls === 0)
    verify('movable route-relative label point and safe plain text update without replacing label nodes', label.getAttribute('transform') === `translate(${point.x} ${point.y})` && label.querySelector('text') === oldText && oldText.textContent === edited.label)
    verify('line/arrow color and non-color dot relationship cues preview', path.getAttribute('stroke') === '#ef4444' && path.getAttribute('stroke-width') === '6' && path.getAttribute('stroke-dasharray') === '1 6' && path.getAttribute('stroke-linecap') === 'round' && path.getAttribute('marker-start') === 'url(#arrow-edge-0)' && path.getAttribute('marker-end') === 'none' && defs.querySelector('#arrow-edge-0 path').getAttribute('fill') === '#ef4444')
    for (const side of ['source', 'target']) { const circle = group.querySelector(`[data-endpoint="${side}"]`), expected = geometry[side]; verify(`semantic ${side} endpoint updates despite reversed child order`, close(circle.getAttribute('cx'), expected.x) && close(circle.getAttribute('cy'), expected.y) && close(circle.getAttribute('r'), 7 / scale)) }
    verify('each explicit bend handle follows its indexed manual waypoint', [...group.querySelectorAll('.connector-bend')].every(circle => { const bend = edited.bendPoints[Number(circle.dataset.bendIndex)]; return close(circle.getAttribute('cx'), bend.x) && close(circle.getAttribute('cy'), bend.y) && close(circle.getAttribute('r'), 7 / scale) }))
    verify('endpoint and bend targets remain 14 screen CSS pixels at overview zoom', Math.abs(group.querySelector('.connector-endpoint').getBoundingClientRect().width - 14) < .001 && Math.abs(group.querySelector('.connector-bend').getBoundingClientRect().width - 14) < .001)
    path.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    verify('existing pointer listeners survive imperative preview', pointerEvents === 1 && groups.get('edge-0').querySelector('.connector-path') === path)
    presenter.clear()
    verify('cancel restores all owned connector geometry/text/paint attributes exactly', svg.outerHTML === oldSvg)
    presenter.present(fixture, next)
    presenter.present(fixture, fixture)
    const originalGeometry = connectorGeometry(fixture.connectors[0], fixture.nodes), originalLabel = connectorLabelPoint(fixture.connectors[0], originalGeometry)
    verify('dragging connector properties exactly back to baseline does not retain prior preview', path.getAttribute('d') === originalGeometry.path && label.getAttribute('transform') === `translate(${originalLabel.x} ${originalLabel.y})` && oldText.textContent === fixture.connectors[0].label)
    presenter.clear()
    const moved = { ...fixture, nodes: fixture.nodes.map((node, index) => index === 0 ? { ...node, x: node.x + 160, width: node.width + 50, rotation: 25 } : node) }
    presenter.present(fixture, moved)
    const movedGeometry = connectorGeometry(fixture.connectors[0], moved.nodes), movedLabel = connectorLabelPoint(fixture.connectors[0], movedGeometry)
    verify('node move/resize/rotation keeps route-relative label metadata rather than resetting to midpoint', path.getAttribute('d') === movedGeometry.path && label.getAttribute('transform') === `translate(${movedLabel.x} ${movedLabel.y})`)
    presenter.present(fixture, fixture)
    verify('node drag return-to-origin resets its style and attached connector presentation', root.querySelector('[data-node-id="image-0"]').style.left === fixture.nodes[0].x + 'px' && path.getAttribute('d') === originalGeometry.path)
    presenter.clear()
    const straight = { ...fixture, connectors: [{ ...edited, style: 'straight' }, ...fixture.connectors.slice(1)] }
    presenter.present(fixture, straight)
    verify('manual bend handles hide when their route stops being elbow', [...group.querySelectorAll('.connector-bend')].every(circle => circle.getAttribute('visibility') === 'hidden'))
    presenter.clear()
    presenter.present(fixture, next)
    path.setAttribute('stroke', '#abcdef'); oldText.textContent = 'New committed label'
    presenter.clear()
    verify('clear does not restore a baseline over a newer committed React value', path.getAttribute('stroke') === '#abcdef' && oldText.textContent === 'New committed label')
    const overlay = new OverlayPresenter(() => root)
    const previewPoint = { x: 720, y: 370 }
    overlay.context = { board: fixture, penPoints: [], selectedIds: [], columnDragIds: [], scale }
    overlay.set('connectorPreview', { id: 'edge-0', end: 'target', point: previewPoint })
    const previewGeometry = connectorGeometry(fixture.connectors[0], fixture.nodes, undefined, previewPoint)
    const previewLabel = connectorLabelPoint(fixture.connectors[0], previewGeometry)
    verify('overlay endpoint preview retains custom route-relative label placement', label.getAttribute('transform') === `translate(${previewLabel.x} ${previewLabel.y})` && path.getAttribute('d') === previewGeometry.path)
    for (const zoom of [.1, .5, 2]) {
      world.style.transform = `translate(55px, 35px) scale(${zoom})`
      overlay.context = { ...overlay.context, scale: zoom }
      overlay.repaint()
      const endpoint = group.querySelector('[data-endpoint="target"]'), source = group.querySelector('[data-endpoint="source"]')
      verify(`camera pan/zoom ${zoom} preserves semantic endpoints and label route metadata`, close(endpoint.getAttribute('cx'), previewPoint.x) && close(endpoint.getAttribute('cy'), previewPoint.y) && close(source.getAttribute('cx'), previewGeometry.source.x) && label.getAttribute('transform') === `translate(${previewLabel.x} ${previewLabel.y})`)
      verify(`camera zoom ${zoom} keeps endpoint and indexed bend handles14screenpx`, Math.abs(endpoint.getBoundingClientRect().width - 14) < .001 && [...group.querySelectorAll('.connector-bend')].every(circle => { const bend = fixture.connectors[0].bendPoints[Number(circle.dataset.bendIndex)]; return close(circle.getAttribute('cx'), bend.x) && close(circle.getAttribute('cy'), bend.y) && Math.abs(circle.getBoundingClientRect().width - 14) < .001 }))
    }
    overlay.set('connectorPreview', null)
    verify('overlay endpoint cancel restores canonical route and custom label instead of midpoint', path.getAttribute('d') === originalGeometry.path && label.getAttribute('transform') === `translate(${originalLabel.x} ${originalLabel.y})`)
    overlay.clear()
    world.style.transform = `scale(${scale})`
    verify('24-image/30-edge fixture survives without removed object/connection records', root.querySelectorAll('[data-node-id]').length === 24 && root.querySelectorAll('[data-connector-id]').length === 30 && fixture.nodes.length === 24 && fixture.connectors.length === 30)
    verify('preview frames notify overlay synchronization without persisted scene mutation', events >= 10 && root.dataset.gesturePreview === 'false' && fixture.connectors[0].label === 'Relation 0')
    return { checks, frames: presenter.frames, events, fixtureCounts: { nodes: fixture.nodes.length, connectors: fixture.connectors.length } }
  }, { presenterUrl, connectorUrl, overlayUrl, fixture: board })
  for (const result of results.checks) check(result.name, result.passed)
  report.fixture = results.fixtureCounts
  report.frames = results.frames
  await page.screenshot({ path: resolve(artifacts, 'connector-presentation-overview.png'), fullPage: true })
  report.screenshots.push('connector-presentation-overview.png')
  report.passed = true
  console.log(`\n${report.checks.length} isolated serializer/actual-DOM checks passed.`)
} finally {
  await browser.close()
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2))
}
