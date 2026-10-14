import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
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
const vectorUrl = url(compile(sources.get('model/vector.ts'))), connectorUrl = url(compile(sources.get('board/connectors.ts')))
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
const ellipseBranch = find(node => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr => attr.name?.text === 'className' && attr.initializer?.text === 'node-shape-ellipse'))
const articleStyleSource = find(node => ts.isObjectLiteralExpression(node) && node.getText(appAst).includes("'--shape-stroke'") && node.getText(appAst).includes('fisheyeScale(node)'))
const articleStyleAst = ts.createSourceFile('style.tsx', `const actual = (${articleStyleSource})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const articleStyleObject = articleStyleAst.statements[0].declarationList.declarations[0].initializer.expression
const ownedStyleNames = new Set(['left', 'top', 'width', 'height', 'opacity', 'transform', '--shape-stroke', '--shape-radius'])
const ownedStyleSource = articleStyleObject.properties.filter(property => ownedStyleNames.has(property.name.text)).map(property => property.getText(articleStyleAst)).join(',')
const jsxUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href
const { committedSvg, committedArticleStyle } = await import(url(compile(`import {readableForeground} from '${url(compile(sources.get('canvasTheme.ts')))}';\n${frameNode}\nconst fisheyeScale=()=>1;\nexport const committedArticleStyle=node=>({${ownedStyleSource}});\nexport const committedSvg = node => (${ellipseBranch})`)
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
  const negations = [...selector.matchAll(/:not\(([^)]+)\)/g)];
  if (negations.some(([,part]) => simpleMatch(element, part, scope))) return false;
  selector = selector.replace(/:not\([^)]+\)/g, '');
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
  for (const match of markup.matchAll(/<\/?[\w-]+\b[^>]*>|[^<]+/g)) {
    const token = match[0]
    if (!token.startsWith('<')) { stack.at(-1).textContent += token.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#x27;', "'"); continue }
    if (token.startsWith('</')) { stack.pop(); continue }
    const element = new Element(token.match(/^<([\w-]+)/)[1])
    for (const [, key, value] of token.matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(key, value)
    stack.at(-1).append(element)
    if (!token.endsWith('/>')) stack.push(element)
  }
  return root.children[0]
}
const svgFor = node => parseSvg(renderToStaticMarkup(committedSvg(node)))
const lineNode = (extra = {}) => ({ id: 'line', kind: 'shape', shapeType: 'ellipse', title: 'Line', body: '',
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
  if (previous.textContent !== next.textContent) element.textContent = next.textContent;
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
    applyCommittedSvgProps(article.querySelector('.node-shape-ellipse'), svgFor(committed), svgFor(value))
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
const assertActualEllipse = (article, expected) => {
  const svg = article.querySelector('.node-shape-ellipse'), reference = svgFor(expected); assert(svg);
  assert.equal(svg.getAttribute('viewBox'), reference.getAttribute('viewBox'));
  for (const selector of ['.shape-hit-area', 'ellipse:not(.shape-hit-area)', 'text']) {
    const actual=svg.querySelector(selector), oracle=reference.querySelector(selector); assert(actual && oracle);
    for (const attribute of ['cx','cy','rx','ry','fill','stroke','stroke-width','vector-effect','pointer-events'])
      assert.equal(actual.getAttribute(attribute),oracle.getAttribute(attribute),selector+'.'+attribute);
    assert.equal(actual.textContent,oracle.textContent);
  }
};
const assertCommittedStyles = (article, expected) => {
  for (const [name, value] of Object.entries(committedStyles(expected))) assert.equal(article.style.getPropertyValue(name), value, `article.style.${name}`)
}
const prior = Object.fromEntries(['CSS', 'CustomEvent', 'document', '__p0LineHooks'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
const install = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
install('CSS', { escape: value => value }); install('CustomEvent', class { constructor(type) { this.type = type } })
install('document', { createElement: name => new Element(name), createElementNS: (_, name) => new Element(name) })
const disposers = []
try {
 const node=lineNode({color:'#dd4444', textColor:'#112233', body:'Original <caption> & text'}), f=fixture(node), saved=JSON.stringify(f.base), before=snapshot(f.article);
 const presenter=new GesturePresenter(()=>f.root,()=>{}), streams=[];
 disposers.push(presenter.subscribeBoard(value=>streams.push({value,dom:snapshot(f.article)})));
 const preview={...node,x:30,y:45,width:280,height:120,rotation:35,color:'#00aaff',strokeColor:'#ddcc11',strokeWidth:0,opacity:.4,body:'New & <caption>',textColor:'#abcdef'};
 check('actual ellipse preview matches committed SVG radii, paint, zero stroke and caption',()=>{presenter.present(f.base,board([preview]));assertActualEllipse(f.article,preview);assertCommittedStyles(f.article,preview)});
 check('live scene publication follows DOM projection',()=>{assert.equal(streams.at(-1).value.nodes[0],preview);assert.equal(streams.at(-1).dom,snapshot(f.article))});
 check('cancel restores owned properties and source remains immutable',()=>{presenter.clear();assert.equal(snapshot(f.article),before);assert.equal(JSON.stringify(f.base),saved);assert.equal(streams.at(-1).value,undefined)});
 for(const extra of [{color:'transparent'},{textColor:'#ffffff'},{body:' '},{strokeWidth:0},{opacity:0},{strokeColor:''},{color:'',textColor:''}]) check('style-only ellipse preview '+JSON.stringify(extra),()=>{const v={...node,...extra};presenter.present(f.base,board([v]));assertActualEllipse(f.article,v);presenter.clear();assert.equal(snapshot(f.article),before)});
 check('unrelated external DOM changes survive cancellation',()=>{presenter.present(f.base,board([preview]));const shape=f.article.querySelector('ellipse:not(.shape-hit-area)');shape.setAttribute('stroke','#123456');f.article.style.setProperty('left','444px');presenter.clear();assert.equal(shape.getAttribute('stroke'),'#123456');assert.equal(f.article.style.getPropertyValue('left'),'444px');f.commitDom(node)});
 check('replacement proxy receives the latest preview without retaining old child writes',()=>{presenter.present(f.base,board([preview]));const old=f.article.querySelector('svg');f.commitDom(node);presenter.repaint();assertActualEllipse(f.article,preview);assert.notEqual(f.article.querySelector('svg'),old);presenter.clear();assertActualEllipse(f.article,node)});
 const draftRoot=new Element('div'), world=new Element('div');world.className='board-world';draftRoot.append(world);
 const empty=board([]), dp=new GesturePresenter(()=>draftRoot,()=>{}), draftNode={...preview,id:'draft-ellipse'};
 check('new ellipse draft matches actual SVG and keeps zero width',()=>{dp.present(empty,board([draftNode]));assertActualEllipse(world.children[0],draftNode);assert.equal(world.children[0].style.getPropertyValue('--shape-stroke'),'0px')});
 const draft=world.children[0],children=[...draft.querySelector('svg').children], allocations=createdElements;
 check('300 ellipse draft frames retain child identity and allocate no replacement children',()=>{for(let i=0;i<300;i++)dp.present(empty,board([{...draftNode,width:280+i,body:'Frame '+i}]));assert.deepEqual(draft.querySelector('svg').children,children);assert.equal(createdElements,allocations);assert.equal(world.children.length,1)});
 check('draft cleanup removes only transient paint and keeps saved board empty',()=>{dp.clear();assert.equal(world.children.length,0);assert.equal(empty.nodes.length,0)});
 const slots=[],effects=[];let index=0;
 install('__p0LineHooks',{useRef(value){const slot=index++;if(!slots[slot])slots[slot]={current:value};return slots[slot]},effect(callback,deps){const slot=index++,prev=slots[slot];if(!prev||!deps||deps.some((v,i)=>v!==prev.deps?.[i])){const next={deps,cleanup:prev?.cleanup};slots[slot]=next;effects.push(()=>{next.cleanup?.();next.cleanup=callback()})}}});
 const h=fixture(node), hp=new GesturePresenter(()=>h.root,()=>{}), history=[];
 const commit=(value,base)=>{history.push({value,base});h.commitInPlace(value.nodes[0])};
 const render=persisted=>{index=0;const hook=useGestureBoard(persisted,commit,hp);while(effects.length)effects.shift()();return hook};
 let persisted=h.base,hook=render(persisted);
 check('gesture preview has no history; final command commits once',()=>{hook.beginPreview();hook.change(board([preview]),null);assert.equal(history.length,0);hook.change(board([preview]),persisted);assert.equal(history.length,1);persisted=board([preview]);hook=render(persisted);assertActualEllipse(h.article,preview)});
 for(const mode of ['equal','title-only','partial','distinct']) check('same-SVG external '+mode+' commit retires old preview and late callbacks',()=>{
   const previous=persisted.nodes[0],v={...previous,width:420,color:'#4488aa',body:'External preview',opacity:0,strokeWidth:0,textColor:'#ffaaee'};
   const next=mode==='equal'?{...v,title:'external'}:mode==='title-only'?{...previous,title:'external'}:mode==='partial'?{...previous,body:v.body,color:v.color,title:'external'}:{...previous,color:'#ffff00',body:'Different',opacity:.7,title:'external'};
   const oldHook=hook,svg=h.article.querySelector('svg'),count=history.length;hook.beginPreview();hook.change(board([v]),null);h.commitInPlace(next);persisted=board([next]);hook=render(persisted);
   assert.equal(h.article.querySelector('svg'),svg);assertActualEllipse(h.article,next);assertCommittedStyles(h.article,next);assert.equal(history.length,count);oldHook.change(board([v]),null);assertActualEllipse(h.article,next);
 });
 check('cancellation after external retirement restores current committed state',()=>{const n=persisted.nodes[0];hook.beginPreview();hook.change(board([{...n,color:'transparent',body:''}]),null);hook.endPreview();assertActualEllipse(h.article,n)});
 check('unmount restores owned preview without adding history',()=>{const n=persisted.nodes[0],count=history.length;hook.beginPreview();hook.change(board([{...n,opacity:.2,body:'Unmount'}]),null);for(const slot of slots)slot?.cleanup?.();assertActualEllipse(h.article,n);assert.equal(history.length,count)});
 const receipt={passed:true,checks:checks.length,cases:checks,sourceHashes,limits:['Actual presenter/hook and actual App JSX with controlled DOM/effect scheduling. Browser computed CSS and real CPU/GPU acceptance are separate.']};
 await mkdir(new URL('../../docs/engine-p0/2026-10-03/ellipse-integration/',import.meta.url),{recursive:true});
 await writeFile(new URL('../../docs/engine-p0/2026-10-03/ellipse-integration/ellipse-gesture-tests.json',import.meta.url),JSON.stringify(receipt,null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
} finally {for(const dispose of disposers)dispose();for(const [name,descriptor]of Object.entries(prior)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}}
