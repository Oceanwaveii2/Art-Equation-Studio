import { vectorModuleUrl as sharedVectorUrl, geometryModuleUrl as sharedGeometryUrl, booleanModuleUrl as sharedBooleanUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Actual presenter and hook, controlled DOM/effect scheduling, actual App JSX
// rendered by React SSR as the committed endpoint/style oracle. No browser,
// native application, production projects, persistence or paint mocks launch.
const require = createRequire(new URL('../package.json', import.meta.url))
const { renderToStaticMarkup } = require('react-dom/server')
const files = ['board/GesturePresenter.ts', 'model/vector.ts', 'board/connectors.ts', 'board/useGestureBoard.ts', 'App.tsx', 'canvasTheme.ts']
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')])))
const sourceHashes = Object.fromEntries([...sources].map(([file, source]) => [file, createHash('sha256').update(source).digest('hex')]))
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile = code => ts.transpileModule(code, { fileName: 'actual.tsx', compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText
const vectorUrl = sharedVectorUrl, connectorUrl = url(compile(sources.get('board/connectors.ts')))
const { GesturePresenter } = await import(url(compile(sources.get('board/GesturePresenter.ts'))
  .replace(/from ['"]\.\.\/canvasTheme['"]/g, `from '${url(compile(sources.get('canvasTheme.ts')))}'`)
  .replace(/from ['"]\.\.\/model\/vector['"]/g, `from '${vectorUrl}'`)
  .replace(/from ['"]\.\/connectors['"]/g, `from '${connectorUrl}'`)))
const hooksUrl = url('export const useRef=value=>globalThis.__p0LineHooks.useRef(value);export const useLayoutEffect=(f,d)=>globalThis.__p0LineHooks.effect(f,d);export const useCallback=f=>f;')
const { useGestureBoard } = await import(url(compile(sources.get('board/useGestureBoard.ts')).replace(/from ['"]react['"]/g, `from '${hooksUrl}'`)))
const appAst = ts.createSourceFile('App.tsx', sources.get('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const find = predicate => {
  let result
  const visit = node => { if (result) return; if (predicate(node)) result = node; else ts.forEachChild(node, visit) }
  visit(appAst); assert(result, 'Actual App JSX oracle is missing'); return result.getText(appAst)
}
const directSelection = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'directSelectionPath')
const frameNode = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'isFrameNode')
const lineBranch = find(node => ts.isArrowFunction(node) && !node.parameters.length && node.body.getText(appAst).includes('className="shape-arrow-base"'))
const articleStyleSource = find(node => ts.isObjectLiteralExpression(node) && node.getText(appAst).includes("'--shape-stroke'") && node.getText(appAst).includes('fisheyeScale(node)'))
const articleStyleAst = ts.createSourceFile('style.tsx', `const actual = (${articleStyleSource})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const articleStyleObject = articleStyleAst.statements[0].declarationList.declarations[0].initializer.expression
const ownedStyleNames = new Set(['left', 'top', 'width', 'height', 'opacity', 'transform', '--shape-stroke', '--shape-radius'])
const ownedStyleSource = articleStyleObject.properties.filter(property => ownedStyleNames.has(property.name.text)).map(property => property.getText(articleStyleAst)).join(',')
const jsxUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href
const { committedSvg, committedArticleStyle } = await import(url(compile(`${directSelection}\n${frameNode}\nconst fisheyeScale=()=>1;\nexport const committedArticleStyle=node=>({${ownedStyleSource}});\nexport const committedSvg = node => (${lineBranch})()`)
  .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${jsxUrl}'`)))

class Style {
  values = new Map()
  getPropertyValue(name) { return this.values.get(name) ?? '' }
  setProperty(name, value) { this.values.set(name, String(value)) }
  removeProperty(name) { this.values.delete(name) }
  get transform() { return this.getPropertyValue('transform') }
  get pointerEvents() { return this.getPropertyValue('pointer-events') }
  set pointerEvents(value) { this.setProperty('pointer-events', value) }
}
const attributeName = name => `data-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
let createdElements = 0
class Element {
  constructor(tagName) {
    createdElements++; this.tagName = tagName.toLowerCase(); this.attributes = new Map(); this.children = []; this.parentElement = null
    this.style = new Style(); this.textContent = ''; this.events = []
    this.dataset = new Proxy({}, { get: (_, name) => this.getAttribute(attributeName(name)) ?? undefined,
      set: (_, name, value) => { this.setAttribute(attributeName(name), value); return true } })
    this.classList = { contains: name => (this.getAttribute('class') ?? '').split(/\s+/).includes(name),
      toggle: (name, force) => {
        const entries = new Set((this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean))
        const enabled = force ?? !entries.has(name); if (enabled) entries.add(name); else entries.delete(name)
        this.setAttribute('class', [...entries].join(' ')); return enabled
      }, add: (...names) => names.forEach(name => this.classList.toggle(name, true)), remove: (...names) => names.forEach(name => this.classList.toggle(name, false)) }
  }
  get className() { return this.getAttribute('class') ?? '' }
  set className(value) { this.setAttribute('class', value) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  removeAttribute(name) { this.attributes.delete(name) }
  append(...children) { for (const child of children) { child.remove(); this.children.push(child); child.parentElement = this } }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children) }
  remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null } }
  dispatchEvent(event) { this.events.push(event.type); return true }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  querySelectorAll(selector) {
    const result = []
    const visit = node => { for (const child of node.children) { if (matches(child, selector, this)) result.push(child); visit(child) } }
    visit(this); return result
  }
}
function simpleMatch(element, selector, scope) {
  if (selector === ':scope') return element === scope
  const attributes = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)]
  if (attributes.some(([, key, value]) => value === undefined ? element.getAttribute(key) === null : element.getAttribute(key) !== value)) return false
  const plain = selector.replace(/\[[^\]]*\]/g, '')
  const tag = plain.match(/^[\w-]+/)?.[0]
  return (!tag || element.tagName === tag.toLowerCase()) && [...plain.matchAll(/\.([\w-]+)/g)].every(([, name]) => element.classList.contains(name))
}
function matches(element, selector, scope) {
  const direct = selector.split(/\s*>\s*/)
  if (direct.length > 1) {
    let current = element
    for (let index = direct.length - 1; index >= 0; index--) {
      if (!current || !matches(current, direct[index], scope)) return false
      current = current.parentElement
    }
    return true
  }
  const parts = selector.trim().split(/\s+/)
  if (!simpleMatch(element, parts.at(-1), scope)) return false
  let parent = element.parentElement
  for (let index = parts.length - 2; index >= 0; index--) {
    while (parent && !simpleMatch(parent, parts[index], scope)) parent = parent.parentElement
    if (!parent) return false
    parent = parent.parentElement
  }
  return true
}
function parseSvg(markup) {
  const root = new Element('parser-root'), stack = [root]
  for (const match of markup.matchAll(/<\/?[\w-]+\b[^>]*>/g)) {
    const token = match[0]
    if (token.startsWith('</')) { stack.pop(); continue }
    const element = new Element(token.match(/^<([\w-]+)/)[1])
    for (const [, key, value] of token.matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(key, value)
    stack.at(-1).append(element)
    if (!token.endsWith('/>')) stack.push(element)
  }
  return root.children[0]
}
const svgFor = node => parseSvg(renderToStaticMarkup(committedSvg(node)))
const lineNode = (extra = {}) => ({ id: 'line', kind: 'shape', shapeType: 'line', title: 'Line', body: '',
  x: 0, y: 0, width: 200, height: 80, strokeColor: '#f04422', strokeWidth: 20, opacity: 1, ...extra })
const board = nodes => ({ id: 'disposable-line-board', title: 'Disposable', viewport: { x: 10, y: 20, scale: 1 }, nodes, connectors: [] })
const committedStyles = value => Object.fromEntries(Object.entries(committedArticleStyle(value)).map(([name, entry]) => [name,
  ['left', 'top', 'width', 'height'].includes(name) ? `${entry}px` : String(entry)]))
// Model React's prop diff against its last committed props, not the current
// mutated DOM. Unchanged props are skipped and new equal-to-preview props are
// written to the same element. This is the mutation-before-layout-effect case.
function applyCommittedSvgProps(element, previous, next) {
  assert.equal(element.tagName, next.tagName); assert.equal(previous.children.length, next.children.length)
  for (const name of new Set([...previous.attributes.keys(), ...next.attributes.keys()])) {
    if (previous.getAttribute(name) === next.getAttribute(name)) continue
    const value = next.getAttribute(name); if (value === null) element.removeAttribute(name); else element.setAttribute(name, value)
  }
  next.children.forEach((child, index) => applyCommittedSvgProps(element.children[index], previous.children[index], child))
}
function fixture(node) {
  const root = new Element('div'), world = new Element('div'), article = new Element('article')
  world.className = 'board-world'; article.className = 'board-node node-shape'; article.dataset.nodeId = node.id
  root.append(world); world.append(article)
  let committed = node
  const commitDom = value => {
    for (const [name, text] of Object.entries(committedStyles(value))) article.style.setProperty(name, text)
    article.replaceChildren(svgFor(value))
    committed = value
  }
  const commitInPlace = value => {
    const previousStyles = committedStyles(committed), nextStyles = committedStyles(value)
    for (const [name, text] of Object.entries(nextStyles)) if (previousStyles[name] !== text) article.style.setProperty(name, text)
    applyCommittedSvgProps(article.querySelector('.node-vector-shape'), svgFor(committed), svgFor(value))
    committed = value
  }
  const commitChildReplacement = value => {
    const previousStyles = committedStyles(committed), nextStyles = committedStyles(value)
    for (const [name, text] of Object.entries(nextStyles)) if (previousStyles[name] !== text) article.style.setProperty(name, text)
    const child = new Element('div'); child.className = value.kind === 'shape' ? 'node-shape-label rectangle' : 'node-drag-handle'
    article.replaceChildren(child); committed = value
  }
  commitDom(node)
  return { root, world, article, commitDom, commitInPlace, commitChildReplacement, base: board([node]) }
}
const snapshotValue = element => ({ tag: element.tagName,
  attributes: [...element.attributes].map(([name, value]) => [name, name === 'class' ? value.trim().split(/\s+/).filter(Boolean).sort().join(' ') : value]).sort(([a], [b]) => a.localeCompare(b)),
  styles: [...element.style.values].sort(([a], [b]) => a.localeCompare(b)), children: element.children.map(snapshotValue) })
const snapshot = element => JSON.stringify(snapshotValue(element))
const checks = [], check = (name, execute) => { execute(); checks.push(name) }
const assertActualLine = (article, expected) => {
  const svg = article.querySelector('.node-vector-shape'), reference = svgFor(expected)
  assert.equal(svg.getAttribute('viewBox'), reference.getAttribute('viewBox'))
  assert.equal(svg.classList.contains('reverse'), reference.classList.contains('reverse'))
  for (const className of ['shape-hit-area', 'shape-arrow-base']) {
    const actual = svg.querySelector(`.${className}`), oracle = reference.querySelector(`.${className}`)
    assert(actual, `missing ${className}`)
    for (const attribute of ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'vector-effect']) assert.equal(actual.getAttribute(attribute), oracle.getAttribute(attribute), `${className}.${attribute}`)
  }
}
const assertCommittedStyles = (article, expected) => {
  for (const [name, value] of Object.entries(committedStyles(expected))) assert.equal(article.style.getPropertyValue(name), value, `article.style.${name}`)
}
const prior = Object.fromEntries(['CSS', 'CustomEvent', 'document', '__p0LineHooks'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
const install = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
install('CSS', { escape: value => value }); install('CustomEvent', class { constructor(type) { this.type = type } })
install('document', { createElement: name => new Element(name), createElementNS: (_, name) => new Element(name) })
const disposers = []
try {
  const node = lineNode({ vectorPath: { version: 1, closed: true, points: [
    { x: -20, y: 10, handleOut: { x: 900, y: -500 } }, { x: 1700, y: 600 }, { x: 210, y: 70, handleIn: { x: -300, y: 600 } },
  ] } })
  const f = fixture(node), before = snapshot(f.article), saved = JSON.stringify(f.base)
  const presenter = new GesturePresenter(() => f.root, () => {})
  const preview = { ...node, x: 40, y: 70, width: 320, height: 140, rotation: 31,
    vectorPath: { ...node.vectorPath, points: [{ x: 24, y: 30 }, { x: -900, y: 1700 }, { x: 280, y: 110 }] } }
  const stream = [], observedDom = []
  disposers.push(presenter.subscribeBoard(value => { stream.push(value); observedDom.push(snapshot(f.article)) }))
  check('non-square resized authored line preview matches actual committed JSX endpoints, viewBox and paint', () => { presenter.present(f.base, board([preview])); assertActualLine(f.article, preview) })
  check('live board stream observes repaired line DOM before publication', () => {
    assert.equal(stream.at(-1).nodes[0], preview); assert.equal(observedDom.at(-1), snapshot(f.article))
  })
  check('line endpoints ignore intermediate anchors and curve handles exactly like actual App', () => {
    const base = f.article.querySelector('.shape-arrow-base')
    assert.equal(base.getAttribute('x1'), String(24 / 320 * 100)); assert.equal(base.getAttribute('x2'), String(280 / 320 * 100))
  })
  check('repaint keeps the same normalized proxy and immutable preview', () => { presenter.repaint(); assertActualLine(f.article, preview); assert.equal(stream.at(-1).nodes[0], preview) })
  check('cancel restores every owned line attribute/style and releases stream', () => { presenter.clear(); assert.equal(snapshot(f.article), before); assert.equal(stream.at(-1), undefined) })
  check('preview/cancel preserve saved geometry and history records', () => assert.equal(JSON.stringify(f.base), saved))

  const reverse = { ...node, body: 'reverse' }
  check('reverse-only preview no longer skips geometry and matches actual App class', () => { presenter.present(f.base, board([reverse])); assertActualLine(f.article, reverse) })
  const svg = f.article.querySelector('.node-vector-shape')
  svg.classList.add('external-react-class')
  check('cancel restores only owned reverse token and preserves unrelated React classes', () => { presenter.clear(); assert(!svg.classList.contains('reverse')); assert(svg.classList.contains('external-react-class')) })
  svg.classList.remove('external-react-class')
  check('repeated reverse previews can return to baseline without stale class ownership', () => {
    presenter.present(f.base, board([reverse])); presenter.present(f.base, f.base); assertActualLine(f.article, node); presenter.clear(); assert.equal(snapshot(f.article), before)
  })
  const zero = { ...node, strokeWidth: 0, opacity: 0, strokeColor: 'transparent' }
  check('zero-width/opacity-only preview matches JSX without manufacturing a visible stroke', () => {
    presenter.present(f.base, board([zero])); assertActualLine(f.article, zero)
    assert.equal(f.article.style.getPropertyValue('--shape-stroke'), '0px'); assert.equal(f.article.style.getPropertyValue('opacity'), '0')
    assert.equal(f.article.querySelector('.shape-hit-area').getAttribute('stroke-width'), '16')
    presenter.clear(); assert.equal(snapshot(f.article), before)
  })
  check('missing authored path preserves App diagonal through resize/reversal', () => {
    const value = lineNode({ width: 350, height: 45, body: 'reverse', rotation: -25, strokeWidth: 0 })
    presenter.present(f.base, board([value])); assertActualLine(f.article, value); presenter.clear()
  })
  check('nonfinite authored endpoints do not write Infinity/NaN into a line proxy', () => {
    presenter.present(f.base, board([{ ...node, vectorPath: { ...node.vectorPath, points: [{ x: Infinity, y: 3 }, { x: 20, y: 30 }] } }]))
    const line = f.article.querySelector('.shape-arrow-base')
    assert(!/NaN|Infinity/.test([...line.attributes.values()].join(','))); presenter.clear()
  })
  check('external undo values and unowned classes survive old preview cleanup', () => {
    presenter.present(f.base, board([reverse]))
    const currentSvg = f.article.querySelector('.node-vector-shape'), currentBase = currentSvg.querySelector('.shape-arrow-base')
    currentSvg.setAttribute('viewBox', '0 0 77 33'); currentBase.setAttribute('x1', '12.75'); currentBase.setAttribute('stroke-width', '9')
    currentSvg.classList.remove('reverse'); currentSvg.classList.add('external-undo-class'); f.article.style.setProperty('left', '240px')
    presenter.clear()
    assert.equal(currentSvg.getAttribute('viewBox'), '0 0 77 33'); assert.equal(currentBase.getAttribute('x1'), '12.75')
    assert.equal(currentBase.getAttribute('stroke-width'), '9'); assert.equal(f.article.style.getPropertyValue('left'), '240px')
    assert(currentSvg.classList.contains('external-undo-class')); assert(!currentSvg.classList.contains('reverse'))
    f.commitDom(node)
  })
  check('same-ID proxy remount receives repaired preview and cleans up without stale node writes', () => {
    presenter.present(f.base, board([preview])); const removed = f.article.querySelector('svg')
    f.commitDom(node); presenter.repaint(); assertActualLine(f.article, preview); assert.notEqual(f.article.querySelector('svg'), removed)
    presenter.clear(); assertActualLine(f.article, node)
  })

  const draftRoot = new Element('div'), draftWorld = new Element('div'); draftWorld.className = 'board-world'; draftRoot.append(draftWorld)
  const empty = board([]), draftNode = { ...preview, id: 'draft-line', body: 'reverse', strokeWidth: 0, opacity: .4 }
  const draftPresenter = new GesturePresenter(() => draftRoot, () => {}), draftStream = []
  disposers.push(draftPresenter.subscribeBoard(value => draftStream.push(value)))
  check('new line draft has actual normalized base and independent transparent hit proxy', () => {
    draftPresenter.present(empty, board([draftNode])); const draft = draftWorld.querySelector('[data-node-id="draft-line"]')
    assertActualLine(draft, draftNode); assert.equal(draft.dataset.liveDraft, 'true')
    assert.equal(draft.style.getPropertyValue('--shape-stroke'), '0px'); assert.equal(draft.style.getPropertyValue('opacity'), '.4'.replace(/^\./, '0.'))
  })
  const draft = draftWorld.querySelector('[data-node-id="draft-line"]'), draftBase = draft.querySelector('.shape-arrow-base'), draftHit = draft.querySelector('.shape-hit-area')
  const allocations = createdElements
  check('draft preview burst reuses base/hit elements rather than retaining detached replacements', () => {
    for (let index = 0; index < 300; index++) draftPresenter.present(empty, board([{ ...draftNode, width: 320 + index, body: index % 2 ? '' : 'reverse' }]))
    assert.equal(draft.querySelector('.shape-arrow-base'), draftBase); assert.equal(draft.querySelector('.shape-hit-area'), draftHit)
    assert.equal(createdElements, allocations); assert.equal(draftWorld.children.length, 1)
  })
  check('draft clear removes transient proxies and publishes absent board', () => {
    draftPresenter.clear(); assert.equal(draftWorld.children.length, 0); assert.equal(draftStream.at(-1), undefined); assert.equal(JSON.stringify(empty.nodes), '[]')
  })

  const arrowNode = lineNode({ id: 'arrow', shapeType: 'arrow', arrowMotion: { enabled: true, speed: 'normal', direction: 'forward' },
    vectorPath: { version: 1, closed: false, points: [{ x: 10, y: 20 }, { x: 180, y: 70 }] } })
  const arrow = fixture(arrowNode), arrowBefore = snapshot(arrow.article), arrowPresenter = new GesturePresenter(() => arrow.root, () => {})
  const movedArrow = { ...arrowNode, width: 500, height: 120, body: 'reverse', strokeWidth: 0, strokeColor: '#3399cc' }
  const marker = arrow.article.querySelector('marker'), markerId = marker.getAttribute('id'), flow = arrow.article.querySelector('.shape-arrow-flow')
  check('shared arrow endpoint repair preserves marker identity/motion classes and actual flow width', () => {
    arrowPresenter.present(arrow.base, board([movedArrow])); assertActualLine(arrow.article, movedArrow)
    assert.equal(arrow.article.querySelector('marker'), marker); assert.equal(marker.getAttribute('id'), markerId)
    assert(arrow.article.querySelector('svg').classList.contains('animated-arrow')); assert.equal(flow.getAttribute('stroke-width'), '1')
    for (const coordinate of ['x1', 'y1', 'x2', 'y2']) assert.equal(flow.getAttribute(coordinate), arrow.article.querySelector('.shape-arrow-base').getAttribute(coordinate))
    assert.equal(marker.querySelector('path').getAttribute('fill'), '#3399cc')
    arrowPresenter.clear(); assert.equal(snapshot(arrow.article), arrowBefore)
  })
  check('draft arrow keeps its marker while using authored endpoints and zero stroke', () => {
    draftPresenter.present(empty, board([{ ...movedArrow, id: 'draft-arrow' }]))
    const transient = draftWorld.querySelector('[data-node-id="draft-arrow"]'); assertActualLine(transient, { ...movedArrow, id: 'draft-arrow' })
    assert.equal(transient.querySelector('.shape-arrow-base').getAttribute('marker-end'), 'url(#live-arrow-draft-arrow)')
    const transientMarker = transient.querySelector('marker'); draftPresenter.repaint(); assert.equal(transient.querySelector('marker'), transientMarker)
    const expected = svgFor({ ...movedArrow, id: 'draft-arrow' }), actualFlow = transient.querySelector('.shape-arrow-flow'), expectedFlow = expected.querySelector('.shape-arrow-flow')
    for (const attribute of ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-dasharray', 'vector-effect', 'pointer-events']) assert.equal(actualFlow.getAttribute(attribute), expectedFlow.getAttribute(attribute))
    for (const token of ['animated-arrow', 'motion-normal', 'direction-forward']) assert.equal(transient.querySelector('svg').classList.contains(token), expected.classList.contains(token))
    draftPresenter.clear(); assert.equal(draftWorld.children.length, 0)
  })
  check('draft arrow motion toggles reuse flow/marker and preserve actual speed/direction/reversal classes', () => {
    const value = { ...movedArrow, id: 'draft-motion' }; draftPresenter.present(empty, board([value]))
    const transient = draftWorld.querySelector('[data-node-id="draft-motion"]'), svg = transient.querySelector('svg')
    const flow = svg.querySelector('.shape-arrow-flow'), marker = svg.querySelector('marker')
    const variants = [[true, 'slow', 'reverse'], [true, 'fast', 'forward'], [false, 'normal', 'reverse'], [true, 'normal', 'forward']]
      .map(([enabled, speed, direction]) => { const next = { ...value, arrowMotion: { enabled, speed, direction } }; return { enabled, next, expected: svgFor(next) } })
    const beforeAllocations = createdElements
    for (const {enabled, next, expected} of variants) {
      draftPresenter.present(empty, board([next]))
      for (const token of ['animated-arrow', 'motion-slow', 'motion-normal', 'motion-fast', 'direction-forward', 'direction-reverse']) assert.equal(svg.classList.contains(token), expected.classList.contains(token))
      assert.equal(flow.getAttribute('visibility'), enabled ? 'visible' : 'hidden')
      assert.equal(svg.querySelector('.shape-arrow-flow'), flow); assert.equal(svg.querySelector('marker'), marker)
    }
    assert.equal(createdElements, beforeAllocations); draftPresenter.clear(); assert.equal(draftWorld.children.length, 0)
  })

  const slots = []; let index = 0; const effects = []
  install('__p0LineHooks', { useRef(value) { const slot = index++; if (!slots[slot]) slots[slot] = { current: value }; return slots[slot] },
    effect(callback, deps) {
      const slot = index++, previous = slots[slot]
      if (!previous || !deps || deps.some((value, i) => value !== previous.deps?.[i])) {
        const next = { deps, cleanup: previous?.cleanup }; slots[slot] = next
        effects.push(() => { next.cleanup?.(); next.cleanup = callback() })
      }
    } })
  const h = fixture(lineNode()), history = [], hookPresenter = new GesturePresenter(() => h.root, () => {})
  const commit = (value, base) => { history.push({ value, base }); h.commitInPlace(value.nodes[0]) }
  const render = persisted => { index = 0; const result = useGestureBoard(persisted, commit, hookPresenter); while (effects.length) effects.shift()(); return result }
  const initial = render(h.base), finalNode = { ...h.base.nodes[0], width: 350, body: 'reverse', strokeWidth: 0 }, final = board([finalNode])
  check('actual gesture hook previews line without entering history', () => { initial.beginPreview(); initial.change(final, null); assertActualLine(h.article, finalNode); assert.equal(history.length, 0) })
  check('actual hook cancel restores committed proxy without saving a command', () => { initial.endPreview(); assertActualLine(h.article, h.base.nodes[0]); assert.equal(history.length, 0) })
  check('actual hook final command commits once and leaves exact React-owned line proxy', () => {
    initial.beginPreview(); initial.change(final, null); initial.change(final, h.base)
    assert.equal(history.length, 1); assert.equal(history[0].value, final); assert.equal(history[0].base, h.base)
    render(final); assertActualLine(h.article, finalNode)
  })
  check('late precommit callbacks cannot resurrect previous line preview over committed model', () => {
    initial.change(h.base, null); assert.equal(history.length, 1); assertActualLine(h.article, finalNode)
  })
  let currentPersisted = final, currentHook = render(final)
  const retireExternal = (previewNode, externalNode) => {
    const retainedSvg = h.article.querySelector('.node-vector-shape'), beforeHistory = history.length
    const oldHook = currentHook
    currentHook.beginPreview(); currentHook.change(board([previewNode]), null)
    h.commitInPlace(externalNode)
    currentPersisted = board([externalNode]); currentHook = render(currentPersisted)
    assert.equal(h.article.querySelector('.node-vector-shape'), retainedSvg, 'external commit must retain SVG identity')
    assertActualLine(h.article, externalNode); assertCommittedStyles(h.article, externalNode)
    assert.equal(history.length, beforeHistory, 'external retirement must not save a gesture command')
    oldHook.change(board([previewNode]), null)
    assertActualLine(h.article, externalNode); assertCommittedStyles(h.article, externalNode)
  }
  const authoredPreview = value => ({ ...value, x: 35, y: 60, width: 470, height: 130, rotation: 27, body: value.body === 'reverse' ? '' : 'reverse',
    strokeWidth: 12, strokeColor: '#55aaee', opacity: .4, cornerRadius: 33,
    vectorPath: { version: 1, closed: false, points: [{ x: -25, y: 12 }, { x: 430, y: 110 }] } })
  check('same-SVG external reverse commit equal to preview survives new persisted layout setup', () => {
    const previous = currentPersisted.nodes[0], value = authoredPreview(previous)
    retireExternal(value, { ...previous, body: value.body, title: 'External equal reverse commit' })
  })
  check('same-SVG title-only external commit restores every unchanged preview prop React skipped', () => {
    const previous = currentPersisted.nodes[0]
    retireExternal(authoredPreview(previous), { ...previous, title: 'External unchanged geometry commit' })
  })
  check('same-SVG external authored endpoint, width and paint commit equal to preview is retained', () => {
    const value = authoredPreview(currentPersisted.nodes[0])
    retireExternal(value, { ...value, title: 'External equal geometry/style commit' })
  })
  check('same-SVG partial external commit preserves new widths while restoring unchanged paint/endpoints', () => {
    const previous = currentPersisted.nodes[0], value = { ...authoredPreview(previous), x: 110, width: 620, strokeWidth: 0, opacity: 0 }
    retireExternal(value, { ...previous, width: value.width, strokeWidth: value.strokeWidth, title: 'External partial prop commit' })
  })
  check('same-SVG external values differing from baseline and preview are not replaced during retirement', () => {
    const previous = currentPersisted.nodes[0]
    retireExternal(authoredPreview(previous), { ...previous, x: -40, y: 9, width: 260, height: 210, rotation: -15,
      body: 'reverse', strokeWidth: 6, strokeColor: '#221144', opacity: .8, title: 'External distinct prop commit',
      vectorPath: { version: 1, closed: false, points: [{ x: 4, y: 100 }, { x: 190, y: -20 }] } })
  })
  check('new committed model retirement leaves the replacement SVG intact', () => {
    const previous = currentPersisted.nodes[0], value = authoredPreview(previous), detachedSvg = h.article.querySelector('.node-vector-shape')
    currentHook.beginPreview(); currentHook.change(board([value]), null)
    const external = { ...previous, width: value.width, body: value.body, title: 'External replaced SVG commit' }
    h.commitDom(external); const newSvg = h.article.querySelector('.node-vector-shape'), committedSnapshot = snapshot(newSvg)
    currentPersisted = board([external]); currentHook = render(currentPersisted)
    assert.notEqual(newSvg, detachedSvg); assert.equal(detachedSvg.parentElement, null)
    assert.equal(snapshot(newSvg), committedSnapshot); assertActualLine(h.article, external); assertCommittedStyles(h.article, external)
  })
  check('regular same-SVG cancellation still restores baseline after external model retirement', () => {
    const previous = currentPersisted.nodes[0], retainedSvg = h.article.querySelector('.node-vector-shape')
    currentHook.beginPreview(); currentHook.change(board([authoredPreview(previous)]), null); currentHook.endPreview()
    assert.equal(h.article.querySelector('.node-vector-shape'), retainedSvg); assertActualLine(h.article, previous); assertCommittedStyles(h.article, previous)
  })
  check('separate unmount cleanup restores an active same-SVG preview without saving history', () => {
    const previous = currentPersisted.nodes[0], beforeHistory = history.length
    currentHook.beginPreview(); currentHook.change(board([authoredPreview(previous)]), null)
    for (const slot of slots) slot?.cleanup?.()
    assertActualLine(h.article, previous); assertCommittedStyles(h.article, previous); assert.equal(history.length, beforeHistory)
  })
  for (const [name, target] of [
    ['rectangle', { kind: 'shape', shapeType: 'rectangle', opacity: .4, strokeWidth: 0 }],
    ['note', { kind: 'note', shapeType: undefined, opacity: .4, strokeWidth: 0 }],
    ['column', { kind: 'column', shapeType: undefined, opacity: 1, strokeWidth: 20 }],
    ['explicit frame', { kind: 'group', shapeType: undefined, containerRole: 'frame', opacity: .4, strokeWidth: 0 }],
    ['title-derived frame', { kind: 'group', shapeType: undefined, title: 'External FRAME', opacity: .4, strokeWidth: 0 }],
  ]) check(`retained article line-to-${name} commit retires generic owned styles after child replacement`, () => {
    const cross = fixture(lineNode()), crossPresenter = new GesturePresenter(() => cross.root, () => {}), commands = []
    const renderCross = persisted => {
      index = 0; const hook = useGestureBoard(persisted, value => commands.push(value), crossPresenter)
      while (effects.length) effects.shift()(); return hook
    }
    const hook = renderCross(cross.base), retainedArticle = cross.article
    const previewNode = { ...authoredPreview(cross.base.nodes[0]), opacity: .4, strokeWidth: 0 }
    hook.beginPreview(); hook.change(board([previewNode]), null)
    const external = { ...cross.base.nodes[0], ...target }, externalBoard = board([external])
    cross.commitChildReplacement(external); const committedChild = cross.article.children[0]
    renderCross(externalBoard)
    assert.equal(cross.article, retainedArticle); assert.equal(cross.article.children[0], committedChild)
    assert.equal(cross.article.querySelector('svg'), null); assertCommittedStyles(cross.article, external)
    assert.equal(commands.length, 0); hook.change(board([previewNode]), null); assertCommittedStyles(cross.article, external)
  })
  for (const slot of slots) slot?.cleanup?.()
  check('original line data remains immutable after all committed/draft scenarios', () => assert.equal(JSON.stringify(f.base), saved))
  console.log(JSON.stringify({ passed: true, checks: checks.length, cases: checks, sourceHashes, limits: [
    'Actual GesturePresenter and useGestureBoard with controlled DOM/effect scheduling; committed geometry/style comes from actual App JSX rendered by React SSR.',
    'No browser/native launch, computed CSS, physical pointer acceptance, GPU/CPU pixels or production persistence is claimed.',
    'Arrow endpoints/marker/flow properties retained; complete animated-arrow engine support remains excluded.',
  ] }, null, 2))
} finally {
  for (const dispose of disposers) dispose()
  for (const [name, descriptor] of Object.entries(prior)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
}
