import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'
import { chromium } from 'playwright-core'

const hashes = {}
const compile = async path => {
  const source = await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8')
  hashes[path] = createHash('sha256').update(source).digest('hex')
  return ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
}
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const vectorUrl = url(await compile('model/vector.ts')), connectorUrl = url(await compile('board/connectors.ts'))
const coreUrl = url(await compile('board/diagramStructureCore.ts'))
const columnsUrl = url((await compile('board/columns.ts')).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../model/vector'", `from '${vectorUrl}'`))
const presenterUrl = url((await compile('board/GesturePresenter.ts')).replace("from '../model/vector'", `from '${vectorUrl}'`).replace("from './connectors'", `from '${connectorUrl}'`))
const reactUrl = url('export const useCallback=()=>{},useLayoutEffect=()=>{},useRef=()=>{};')
const overlayUrl = url((await compile('board/OverlayPresenter.ts')).replace("from 'react'", `from '${reactUrl}'`).replace("from './columns'", `from '${columnsUrl}'`).replace("from './connectors'", `from '${connectorUrl}'`).replace("from './GesturePresenter'", `from '${presenterUrl}'`))
const generatedAt = new Date().toISOString(), output = resolve('output/partii-transform-presentation', generatedAt.replace(/[:.]/g, '-'))
await mkdir(output, { recursive: true })
const report = { generatedAt, passed: false, checks: [], sourceHashes: hashes, limitations: ['Real isolated DOM presenter only; integrated App handle pointer occlusion, native gestures/device pixels/disk acceptance belong to root fixtures.'] }
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  await page.setContent('<style>body{margin:0}.board-world{position:relative;width:1000px;height:800px}.board-node,.node-transform-box,[data-column-controls]{position:absolute;transform-origin:center center}.node-transform-box{z-index:10;pointer-events:none}.node-transform-box button{pointer-events:auto}.node-vector-shape{width:100%;height:100%}</style><main id="fixture"><div class="board-world"></div></main>')
  report.checks = await page.evaluate(async ({ presenterUrl, overlayUrl, vectorUrl }) => {
    const { GesturePresenter } = await import(presenterUrl), { OverlayPresenter } = await import(overlayUrl)
    const { vectorPathData, resizeVectorNodeFrame } = await import(vectorUrl)
    const checks = [], verify = (name, condition) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw new Error(name) }
    const primary = { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 160 }, { x: 0, y: 160 }] }
    const boundary = { version: 1, closed: true, points: [{ x: 20, y: 20 }, { x: 160, y: 20 }, { x: 160, y: 100 }, { x: 20, y: 100 }] }
    const node = { id: 'selected:path', title: 'Disposable Boolean', kind: 'shape', shapeType: 'path', x: 100, y: 100, width: 200, height: 160, rotation: 30, vectorPath: primary, vectorBoolean: { operation: 'intersect', operands: [primary, boundary], resolvedPaths: [boundary] } }
    const board = { id: 'presenter-fixture', title: 'Disposable', nodes: [node], connectors: [], viewport: { x: 0, y: 0, scale: 1 } }, original = JSON.stringify(board)
    const root = document.querySelector('#fixture'), world = root.querySelector('.board-world')
    const item = document.createElement('article'); item.className = 'board-node'; item.dataset.nodeId = node.id
    item.style.cssText = 'left:100px;top:100px;width:200px;height:160px;transform:rotate(30deg) scale(1.2)'
    item.style.setProperty('--shape-radius', '14px')
    item.innerHTML = `<svg class="node-vector-shape" viewBox="0 0 200 160"><g transform=""><path class="shape-hit-area" d="${vectorPathData(boundary)}"/><path data-vector-result-paint="resolved" d="${vectorPathData(boundary)}"/></g></svg>`
    world.append(item)
    const controls = document.createElement('div'); controls.className = 'node-transform-box'; controls.dataset.transformControls = node.id
    controls.style.cssText = item.style.cssText; controls.style.zIndex = '10'; controls.style.pointerEvents = 'none'
    const button = document.createElement('button'); button.textContent = 'Rotate'; controls.append(button); world.append(controls)
    const column = document.createElement('div'); column.dataset.columnControls = node.id; column.style.cssText = 'left:109px;top:109px;width:182px;transform:rotate(30deg) scale(1.2)'; world.append(column)
    const resultPath = item.querySelector('[data-vector-result-paint]'), hit = item.querySelector('.shape-hit-area')
    const snapshot = () => JSON.stringify({ item: item.style.cssText, controls: controls.style.cssText, column: column.style.cssText, path: resultPath.getAttribute('d'), hit: hit.getAttribute('d'), viewBox: item.querySelector('svg').getAttribute('viewBox') })
    const baseline = snapshot(), ensureCalls = [], presenter = new GesturePresenter(() => root, ids => ensureCalls.push(ids))
    let events = 0; root.addEventListener('canvas-gesture-presented', () => events++)
    const overlay = new OverlayPresenter(() => root); overlay.context = { board, selectedIds: [node.id], penPoints: [], columnDragIds: [], scale: 2 }
    overlay.set('rotationReadout', 75); overlay.set('cornerRadiusReadout', 18)
    verify('rotation readout belongs to independent world controls with live value', controls.querySelector('.rotation-readout')?.textContent === '75°' && !item.querySelector('.rotation-readout'))
    verify('corner readout belongs to independent controls and exposes polite status', controls.querySelector('.corner-radius-readout')?.textContent === '18px' && controls.querySelector('.corner-radius-readout')?.getAttribute('aria-live') === 'polite')
    verify('readout preserves inverse camera sizing', controls.querySelector('.rotation-readout')?.style.fontSize === '5px')
    overlay.clear(); verify('overlay clearing removes only its readouts', controls.children.length === 1 && controls.contains(button))
    const movedNode = { ...node, x: 180, y: 140, rotation: 75 }, moved = { ...board, nodes: [movedNode] }
    presenter.present(board, moved)
    verify('sibling selection overlay follows translated geometry', controls.style.left === '180px' && controls.style.top === '140px')
    verify('overlay rotates with artwork and preserves fisheye scale', controls.style.transform === 'rotate(75deg) scale(1.2)' && controls.style.transform === item.style.transform)
    const sameRect = () => { const a = controls.getBoundingClientRect(), b = item.getBoundingClientRect(); return ['x','y','width','height'].every(key => Math.abs(a[key] - b[key]) < .000001) }
    verify('overlay and artwork transformed DOM bounds coincide', sameRect())
    verify('selection overlay does not change artwork layer or pointer ownership', controls.style.zIndex === '10' && controls.style.pointerEvents === 'none')
    verify('existing column control projection remains aligned', column.style.left === '189px' && column.style.top === '149px' && column.style.width === '182px')
    const resizedNode = resizeVectorNodeFrame(movedNode, { x: 180, y: 140, width: 360, height: 220 }), resized = { ...board, nodes: [resizedNode] }
    presenter.present(board, resized)
    verify('resize updates independent overlay width and height', controls.style.width === '360px' && controls.style.height === '220px' && sameRect())
    verify('Boolean resize paints exact stored result boundary during preview', resultPath.getAttribute('d') === resizedNode.vectorBoolean.resolvedPaths.map(vectorPathData).join(' '))
    verify('Boolean hit proxy follows the visible result boundary', hit.getAttribute('d') === resultPath.getAttribute('d'))
    verify('preview SVG frame matches resized artwork', item.querySelector('svg').getAttribute('viewBox') === '0 0 360 220')
    presenter.present(board, board)
    verify('returning to transaction baseline restores geometry before clear', snapshot() === baseline)
    presenter.clear(); verify('cancel restores all owned geometry and path attributes exactly', snapshot() === baseline)
    verify('presenter does not mutate original source operands', JSON.stringify(board) === original)
    const derivedOnly = { ...node, vectorBoolean: { ...node.vectorBoolean, resolvedPaths: [{ ...boundary, points: boundary.points.map(point => ({ ...point, x: point.x + 10 })) }] } }
    presenter.present(board, { ...board, nodes: [derivedOnly] })
    verify('derived-only contour changes update paint with unchanged primary identity', derivedOnly.vectorPath === node.vectorPath && resultPath.getAttribute('d') === derivedOnly.vectorBoolean.resolvedPaths.map(vectorPathData).join(' '))
    presenter.clear(); verify('derived-only cancellation restores exact prior geometry', snapshot() === baseline)
    presenter.present(board, resized)
    controls.style.left = '999px'; resultPath.setAttribute('d', 'M 1 2 L 3 4')
    presenter.clear()
    verify('new committed overlay values survive stale preview rollback', controls.style.left === '999px')
    verify('new committed path values survive stale preview rollback', resultPath.getAttribute('d') === 'M 1 2 L 3 4')
    verify('uncommitted counterpart properties still roll back', item.style.left === '100px' && controls.style.width === '200px' && hit.getAttribute('d') === vectorPathData(boundary))
    verify('preview lifecycle publishes frames and completion without extra source mounts', events >= 6 && root.dataset.gesturePreview === 'false' && ensureCalls.every(ids => ids.length === 0))
    return checks
  }, { presenterUrl, overlayUrl, vectorUrl })
  const afterHashes = Object.fromEntries(await Promise.all(Object.keys(hashes).map(async path => [path, createHash('sha256').update(await readFile(new URL(`../src/${path}`, import.meta.url))).digest('hex')])))
  assert.deepEqual(afterHashes, hashes)
  report.passed = report.checks.every(check => check.passed)
} catch (error) { report.error = error.stack; process.exitCode = 1 } finally { await browser?.close() }
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, error: report.error?.split('\n')[0], output }))
