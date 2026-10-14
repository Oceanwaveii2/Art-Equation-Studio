import { vectorModuleUrl as sharedVectorUrl, geometryModuleUrl as sharedGeometryUrl, booleanModuleUrl as sharedBooleanUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import ts from 'typescript'

// Actual streams, presenter, gesture hook and adapter; only host DOM/React
// scheduling are controlled. This does not launch an app or write project data.
const files = ['src/board/GesturePresenter.ts', 'src/canvas-engine/liveScene.ts', 'src/board/useGestureBoard.ts',
  'src/model/vector.ts', 'src/board/connectors.ts', 'src/board/artEquationCanvasAdapter.ts',
  'src/board/velloVectorGeometry.ts', 'src/model/vectorBooleanGeometry.ts', 'src/board/diagramStructureCore.ts', 'src/canvasTheme.ts']
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(resolve(file), 'utf8')])))
const hashes = Object.fromEntries([...sources].map(([file, text]) => [file, createHash('sha256').update(text).digest('hex')]))
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = file => ts.transpileModule(sources.get(file), { fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const require = createRequire(resolve('package.json'))
const vectorUrl = sharedVectorUrl, connectorUrl = url(compile('src/board/connectors.ts'))
const presenterUrl = url(compile('src/board/GesturePresenter.ts').replace(/from ['"]\.\.\/canvasTheme['"]/g, `from '${url(compile('src/canvasTheme.ts'))}'`).replace(/from ['"]\.\.\/model\/vector['"]/g, `from '${vectorUrl}'`)
  .replace(/from ['"]\.\/connectors['"]/g, `from '${connectorUrl}'`))
const booleanUrl = sharedBooleanUrl
const geometryUrl = sharedGeometryUrl
const coreUrl = url(compile('src/board/diagramStructureCore.ts')), themeUrl = url(compile('src/canvasTheme.ts'))
const adapterUrl = url(compile('src/board/artEquationCanvasAdapter.ts').replace(/from ['"]\.\/velloVectorGeometry['"]/g, `from '${geometryUrl}'`)
  .replace(/from ['"]\.\/diagramStructureCore['"]/g, `from '${coreUrl}'`).replace(/from ['"]\.\.\/canvasTheme['"]/g, `from '${themeUrl}'`))
const hooksUrl = url('export const useRef=value=>globalThis.__p0LiveHooks.useRef(value);export const useLayoutEffect=(f,d)=>globalThis.__p0LiveHooks.effect(f,d);export const useCallback=f=>f;')
const hookUrl = url(compile('src/board/useGestureBoard.ts').replace(/from ['"]react['"]/g, `from '${hooksUrl}'`))
const { GesturePresenter } = await import(presenterUrl), { LiveCanvasScene } = await import(url(compile('src/canvas-engine/liveScene.ts')))
const { useGestureBoard } = await import(hookUrl), { createArtEquationCanvasScene: project } = await import(adapterUrl)
const checks = [], check = (name, value) => { checks.push({ name, passed: Boolean(value) }); assert(value, name) }
class Style {
  values = new Map()
  getPropertyValue(name) { return this.values.get(name) ?? '' }
  setProperty(name, value) { this.values.set(name, value) }
  removeProperty(name) { this.values.delete(name) }
  get transform() { return this.getPropertyValue('transform') }
}
function element(attributes = {}) {
  const values = new Map(Object.entries(attributes)), selectors = new Map(), lists = new Map()
  return { style: new Style(), dataset: {}, values, selectors, lists,
    classList: { contains() { return false } }, textContent: '',
    getAttribute: name => values.get(name) ?? null, setAttribute: (name, value) => values.set(name, String(value)), removeAttribute: name => values.delete(name),
    querySelector: selector => selectors.get(selector) ?? null, querySelectorAll: selector => lists.get(selector) ?? [],
    dispatchEvent() {}, append() {}, remove() {} }
}
const paint = element({ d: 'M 0 0 L 100 0 L 100 100 Z' }), hit = element({ d: paint.getAttribute('d') })
const group = element({ transform: '' }), svg = element({ viewBox: '0 0 100 100' }), nodeElement = element(), world = element(), root = element()
svg.selectors.set(':scope > g', group); svg.lists.set(':scope > g > path', [hit, paint])
nodeElement.selectors.set('.node-vector-shape', svg)
root.selectors.set('.board-world', world); root.selectors.set('[data-node-id="path"]', nodeElement)
nodeElement.style.setProperty('left', '0px'); nodeElement.style.setProperty('top', '0px'); nodeElement.style.setProperty('width', '100px'); nodeElement.style.setProperty('height', '100px')
nodeElement.style.setProperty('transform', 'rotate(0deg) scale(1)'); nodeElement.style.setProperty('--shape-radius', '14px')
const domGeometry = () => JSON.stringify({ style: [...nodeElement.style.values], svg: [...svg.values], group: [...group.values], paint: [...paint.values], hit: [...hit.values] })
const node = { id: 'path', kind: 'shape', shapeType: 'path', x: 0, y: 0, width: 100, height: 100, title: 'Path',
  vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] } }
const base = { id: 'board', title: 'Board', viewport: { x: 0, y: 0, scale: 1 }, nodes: [node], connectors: [] }
const moved = { ...base, nodes: [{ ...node, x: 25, y: 30, vectorPath: { ...node.vectorPath,
  points: [{ x: 0, y: 4 }, ...node.vectorPath.points.slice(1)] } }] }
const canonicalBefore = JSON.stringify(base), geometryBefore = domGeometry(), ensureCalls = []
const globals = ['CSS', 'CustomEvent', '__p0LiveHooks']
const previous = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
install('CSS', { escape: value => value }); install('CustomEvent', class { constructor(type) { this.type = type } })
let currentRoot = root
const presenter = new GesturePresenter(() => currentRoot, ids => ensureCalls.push(ids))
const colors = { background: '#111111', grid: '#555555' }, committedScene = project(base, [], colors)
const live = new LiveCanvasScene(committedScene), deliveries = [], sceneDeliveries = []
const stopScene = live.subscribe(value => sceneDeliveries.push(value))
const stopBoard = presenter.subscribeBoard(board => {
  deliveries.push({ board, left: nodeElement.style.getPropertyValue('left'), paint: paint.getAttribute('d') })
  live.present(board ? project(board, [], colors) : committedScene)
})
try {
  check('new subscriptions eagerly receive absence of a gesture preview', deliveries.length === 1 && deliveries[0].board === undefined)
  check('same scene identity is ignored without incrementing revision', live.revision === 0 && !live.present(committedScene))
  presenter.present(base, moved)
  check('board stream observes geometry only after DOM presentation', deliveries.at(-1).board === moved
    && deliveries.at(-1).left === '25px' && deliveries.at(-1).paint.startsWith('M 0 4'))
  check('actual adapter gives the engine live world-space path geometry', live.current.objects[0].preparedVectorGeometry.commands[0].join() === 'M,25,34')
  check('scene stream delivers the current immutable projection', sceneDeliveries.at(-1) === live.current && live.revision === 1)
  const late = [], stopLate = presenter.subscribeBoard(board => late.push(board))
  check('late board subscriber immediately receives the current preview', late.length === 1 && late[0] === moved)
  presenter.repaint()
  check('repaint retains the same preview model identity', deliveries.at(-1).board === moved && late.at(-1) === moved)
  presenter.clear()
  check('cancel publishes absence only after restoring DOM geometry', deliveries.at(-1).board === undefined && domGeometry() === geometryBefore)
  check('cancel restores the canonical engine scene', live.current === committedScene && live.current.objects[0].preparedVectorGeometry.commands[0].join() === 'M,0,0')
  check('preview and repaint leave persisted records untouched', JSON.stringify(base) === canonicalBefore)
  stopLate(); const lateCount = late.length
  presenter.present(base, moved); presenter.clear()
  check('unsubscribed board listeners receive no future frames', late.length === lateCount)

  presenter.present(base, moved)
  nodeElement.style.setProperty('left', '240px'); paint.setAttribute('d', 'external committed path')
  presenter.clear()
  check('external committed DOM values survive clearing old preview properties', nodeElement.style.getPropertyValue('left') === '240px' && paint.getAttribute('d') === 'external committed path')
  check('external commit releases the preview scene to its host', deliveries.at(-1).board === undefined && live.current === committedScene)
  nodeElement.style.setProperty('left', '0px'); paint.setAttribute('d', 'M 0 0 L 100 0 L 100 100 Z')

  currentRoot = null
  const absentBefore = deliveries.length
  presenter.present(base, moved)
  check('preview scene survives a temporarily unmounted DOM root', deliveries.at(-1).board === moved && live.current.objects[0].preparedVectorGeometry.commands[0][1] === 25)
  presenter.clear()
  check('clearing without a root still publishes absent preview', deliveries.length === absentBefore + 2 && deliveries.at(-1).board === undefined)
  presenter.present(base, moved); currentRoot = root; presenter.repaint()
  check('repaint can restore a retained preview after remount', deliveries.at(-1).left === '25px' && deliveries.at(-1).board === moved)
  presenter.clear()
  const revision = live.revision, sameRevisionNewIdentity = { ...committedScene }
  check('new scene identity is delivered even with the same document revision', live.present(sameRevisionNewIdentity) && live.revision === revision + 1 && sceneDeliveries.at(-1) === sameRevisionNewIdentity)
  stopScene(); const sceneCount = sceneDeliveries.length
  live.present({ ...sameRevisionNewIdentity })
  check('scene subscription cleanup releases listeners', sceneDeliveries.length === sceneCount)

  // Exercise actual useGestureBoard lifecycle to certify history is only
  // reached by committed commands and stale gesture callbacks are rejected.
  const slots = []; let index = 0; const effects = []
  install('__p0LiveHooks', {
    useRef(value) { const slot = index++; if (!slots[slot]) slots[slot] = { current: value }; return slots[slot] },
    effect(callback, deps) {
      const slot = index++, prior = slots[slot]
      if (!prior || !deps || deps.some((value, i) => value !== prior.deps?.[i])) {
        const next = { deps, cleanup: prior?.cleanup }; slots[slot] = next
        effects.push(() => { next.cleanup?.(); next.cleanup = callback() })
      }
    },
  })
  const commits = [], commit = (board, history) => commits.push({ board, history })
  const render = persisted => { index = 0; const result = useGestureBoard(persisted, commit, presenter); while (effects.length) effects.shift()(); return result }
  const initial = render(base)
  initial.beginPreview(); initial.change(moved, null); presenter.repaint()
  check('gesture previews and repaint never enter persistence/history', commits.length === 0 && deliveries.at(-1).board === moved)
  initial.endPreview()
  check('ending a cancelled gesture removes live preview without committing', commits.length === 0 && deliveries.at(-1).board === undefined)
  initial.beginPreview(); initial.change(moved, null)
  const external = { ...base, title: 'External commit', nodes: [{ ...node, x: 240 }] }, externalHandlers = render(external)
  check('a new persisted board clears the old gesture subscription', deliveries.at(-1).board === undefined)
  const countBeforeStale = deliveries.length
  initial.change(moved, null)
  check('stale callback cannot republish over an external board', deliveries.length === countBeforeStale && commits.length === 0)
  const final = { ...external, title: 'Final command' }
  externalHandlers.change(final, external)
  check('only a final command invokes persistence/history once', commits.length === 1 && commits[0].board === final && commits[0].history === external)
  for (const slot of slots) slot?.cleanup?.()
  stopBoard(); const boardCount = deliveries.length
  presenter.present(base, moved); presenter.clear()
  check('host unmount/unsubscribe leaves no board observer delivery', deliveries.length === boardCount)
  check('all presentation paths preserve canonical model records', JSON.stringify(base) === canonicalBefore)
  console.log(JSON.stringify({ passed: true, checks: checks.length, sourceHashes: hashes, limitations: [
    'Controlled host DOM and React effect scheduling; this verifies actual source stream behavior, geometry and commit boundaries.',
    'GPU/CPU physical presentation, full scene ownership and native UI acceptance remain separate checks.',
  ] }, null, 2))
} finally {
  stopBoard(); stopScene()
  for (const key of globals) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key] }
}
