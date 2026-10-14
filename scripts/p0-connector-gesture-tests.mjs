import { vectorModuleUrl as sharedVectorUrl, geometryModuleUrl as sharedGeometryUrl, booleanModuleUrl as sharedBooleanUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import * as helpers from '../src/board/connectors.ts'

// Exact production ConnectorLayer SSR oracle against actual GesturePresenter.
// Controlled DOM verifies attributes and retirement; no pixels/native paint claim.
const files = ['src/App.tsx', 'src/board/GesturePresenter.ts', 'src/board/connectors.ts', 'src/model/vector.ts', 'src/canvasTheme.ts', 'scripts/p0-line-gesture-tests.mjs']
const texts = new Map(await Promise.all(files.map(async file => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])))
const hashes = Object.fromEntries([...texts].map(([file, source]) => [file, createHash('sha256').update(source).digest('hex')]))
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = text => ts.transpileModule(text, { fileName: 'actual.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
const appAst = ts.createSourceFile('App.tsx', texts.get('src/App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let connectorLayer
const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'ConnectorLayer') connectorLayer = node.getText(appAst); else ts.forEachChild(node, visit) }
visit(appAst); assert(connectorLayer)
const require = createRequire(new URL('../package.json', import.meta.url))
const { renderToStaticMarkup } = require('react-dom/server')
const { renderConnectorLayer } = await import(url(compile(`export function renderConnectorLayer(board, selectedId, helpers) {
  const {connectorGeometry,connectorLabelPoint,connectorDashArray,connectorLinePattern}=helpers;
  const useMemo=f=>f(), useRef=()=>({current:null}),useLayoutEffect=()=>{};
  const visibleDiagramNodeIds=nodes=>({ok:true,value:nodes.map(node=>node.id)});
  ${connectorLayer}
  return ConnectorLayer({board,selectedId,readOnly:false,preview:null,draft:null});
}`).replace(/from ['"]react\/jsx-runtime['"]/g, `from '${pathToFileURL(require.resolve('react/jsx-runtime')).href}'`)))
const lineFixture = texts.get('scripts/p0-line-gesture-tests.mjs')
const hostSource = lineFixture.slice(lineFixture.indexOf('class Style'), lineFixture.indexOf('const svgFor'))
const { Element, parseSvg } = await import(url(`${hostSource}\nexport{Element,parseSvg};`))
const vectorUrl = sharedVectorUrl, connectorUrl = url(compile(texts.get('src/board/connectors.ts'))), themeUrl = url(compile(texts.get('src/canvasTheme.ts')))
const { GesturePresenter } = await import(url(compile(texts.get('src/board/GesturePresenter.ts'))
  .replace(/from ['"]\.\.\/model\/vector['"]/g, `from '${vectorUrl}'`)
  .replace(/from ['"]\.\/connectors['"]/g, `from '${connectorUrl}'`)
  .replace(/from ['"]\.\.\/canvasTheme['"]/g, `from '${themeUrl}'`)))
const serialize = element => JSON.stringify({ attrs: [...element.attributes].sort(([a], [b]) => a.localeCompare(b)), text: element.textContent,
  styles: [...element.style.values].sort(([a], [b]) => a.localeCompare(b)), children: element.children.map(serialize) })
const old = Object.fromEntries(['CSS', 'CustomEvent'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: value => value } })
Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: class { constructor(type) { this.type = type } } })
const connector = extra => ({ id: 'edge', sourcePoint: { x: 0, y: 0 }, targetPoint: { x: 200, y: 100 }, sourcePort: 'right', targetPort: 'left',
  style: 'elbow', color: '#1d7aff', width: 0, dashed: false, startArrow: true, endArrow: true, animated: true,
  label: 'Original caption', bendPoints: [{ x: 70, y: 20 }], ...extra })
const scene = (value, scale) => ({ id: 'disposable-connector-preview', nodes: [], connectors: [value], viewport: { x: 0, y: 0, scale } })
const ssr = (value, scale) => { const layer = parseSvg(renderToStaticMarkup(renderConnectorLayer(scene(value, scale), value.id, helpers))); layer.querySelector('.connector-label text').textContent = value.label; return layer }
const checks = [], check = (name, f) => { f(); checks.push(name) }
const disposers = []
try {
  check('preview path/flow/hit/endpoints/bends match actual JSX across CSS minimum widths and camera clamps', () => {
    for (const scale of [.05, .18, .5, 1, 2, 16]) for (const width of [0, .25, 3, 100]) {
      const baseEdge = connector(), nextEdge = connector({ width, color: '#ed5827', linePattern: 'dot', sourcePoint: { x: 30, y: 40 }, targetPoint: { x: 310, y: 130 },
        bendPoints: [{ x: 100, y: 40 }], label: 'Changed caption with width', labelPosition: { t: .25, offsetX: 7, offsetY: -3 } })
      const root = new Element('div'), world = new Element('div'); world.className = 'board-world'; root.append(world)
      const layer = ssr(baseEdge, scale), expected = ssr(nextEdge, scale); world.append(layer)
      const before = serialize(layer), base = scene(baseEdge, scale), next = scene(nextEdge, scale), presenter = new GesturePresenter(() => root, () => {})
      disposers.push(() => presenter.clear()); presenter.present(base, next)
      for (const name of ['connector-path', 'connector-hit', 'connector-flow']) {
        const got = layer.querySelector(`.${name}`), wanted = expected.querySelector(`.${name}`)
        for (const attr of ['d', 'stroke-width']) assert.equal(got.getAttribute(attr), wanted.getAttribute(attr), `${name}.${attr},scale${scale},width${width}`)
      }
      const gotBase = layer.querySelector('.connector-path'), expectedBase = expected.querySelector('.connector-path')
      for (const attr of ['stroke', 'stroke-dasharray', 'stroke-linecap', 'marker-start', 'marker-end']) assert.equal(gotBase.getAttribute(attr), expectedBase.getAttribute(attr), attr)
      for (const name of ['connector-endpoint', 'connector-bend']) layer.querySelectorAll(`.${name}`).forEach((element, index) => {
        const wanted = expected.querySelectorAll(`.${name}`)[index]
        for (const attr of ['cx', 'cy', 'r']) assert.equal(element.getAttribute(attr), wanted.getAttribute(attr), `${name}.${attr},scale${scale}`)
      })
      assert.equal(layer.querySelector('marker > path').getAttribute('fill'), expected.querySelector('marker > path').getAttribute('fill'))
      const gotLabel = layer.querySelector('.connector-label'), expectedLabel = expected.querySelector('.connector-label')
      assert.equal(gotLabel.getAttribute('transform'), expectedLabel.getAttribute('transform'))
      for (const attr of ['x', 'width']) assert.equal(gotLabel.querySelector('rect').getAttribute(attr), expectedLabel.querySelector('rect').getAttribute(attr))
      assert.equal(gotLabel.querySelector('text').textContent, nextEdge.label)
      presenter.clear(); assert.equal(serialize(layer), before, 'Cancellation must restore all owned connector paint/proxy attributes')
      assert.equal(base.connectors[0], baseEdge)
    }
  })
  check('connector-only route/label updates publish live board after actual DOM paint and retire without history mutation', () => {
    const baseEdge = connector(), nextEdge = connector({ targetPoint: { x: 500, y: 30 }, label: 'Updated', linePattern: 'dash-dot' }), base = scene(baseEdge, 1)
    const root = new Element('div'), world = new Element('div'); world.className = 'board-world'; root.append(world); const layer = ssr(baseEdge, 1); world.append(layer)
    const presenter = new GesturePresenter(() => root, () => {}), observed = []
    const unsubscribe = presenter.subscribeBoard(value => observed.push({ value, path: layer.querySelector('.connector-path').getAttribute('d') }))
    const before = JSON.stringify(base); presenter.present(base, scene(nextEdge, 1))
    assert.equal(observed.at(-1).value.connectors[0], nextEdge); assert.equal(observed.at(-1).path, helpers.connectorGeometry(nextEdge, []).path)
    presenter.clear(); unsubscribe(); assert.equal(observed.at(-1).value, undefined); assert.equal(JSON.stringify(base), before)
  })
} finally {
  disposers.forEach(f => f())
  for (const [name, descriptor] of Object.entries(old)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]
}
const report = { schemaVersion: 1, passed: checks.length, matrixCases: 24, checks, sourceHashes: hashes,
  limits: ['Actual JSX/control attributes, no computed CSS/pixels', 'Free endpoints/no hierarchy visibility claim', 'No mounted CanvasPane/native input', 'No added GPU connector ownership; markers/dashes/glow/labels/dynamic lifecycle remain complete paint work'] }
const dir = new URL('../../docs/engine-p0/2026-10-03/artwork-coverage/', import.meta.url)
await mkdir(dir, { recursive: true }); await writeFile(new URL('CONNECTOR_GESTURE_ACCEPTANCE.json', dir), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ passed: checks.length, matrixCases: 24, sourceHashes: hashes }))
