import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import ts from 'typescript'
import {chromium} from 'playwright-core'

// Production scope classifier with actual browser MutationRecords, detached
// nodes, CSS declaration parsing and ancestor ownership. No app/GPU timing.
const file='src/board/paintInvalidation.ts',source=await readFile(file,'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true})
let checks
try{
 const page=await browser.newPage()
 await page.setContent('<style>[data-node-id="sibling"]{color:rgb(0,0,0);font-weight:400}[data-node-id="a"]:hover [data-node-id="sibling"]{color:rgb(255,0,0)}[data-node-id="a"]:focus-within [data-node-id="sibling"]{font-weight:700}.connector-layer{position:absolute;left:300px;top:8px;width:100px;height:30px;overflow:visible}</style><main class="canvas-stage"><div class="vello-board"></div><div class="board-world"><svg class="connector-layer"><g id="connector-label"><path id="connector-path" d="M0 5L90 5" fill="none" stroke="blue" stroke-width="2" /></g></svg><svg id="unknown-svg"><path id="unknown-path" d="M0 0L10 10" stroke="blue" /></svg><div class="board-object-layer"><article class="board-node" data-node-id="a"><div><svg class="connector-layer"><path id="card-path" d="M0 0L10 10" stroke="blue" /></svg><img id="image"><article class="board-node" data-node-id="nested"><span id="nested-text" tabindex="0">Nested</span></article><article class="board-node" data-node-id="sibling">Sibling</article></div></article><article class="board-node" data-node-id="b"><span>B</span></article></div></div></main>')
 await page.evaluate(async code=>{window.__paintInvalidation=await import('data:text/javascript;base64,'+btoa(code))},compiled)
 const familyChecks=[]
 await page.locator('#nested-text').hover()
 familyChecks.push({name:'hover on nested child changes sibling paint through containing article',actual:await page.evaluate(()=>({ids:[...window.__paintInvalidation.cardPaintIds(document.querySelector('#nested-text'))].sort(),color:getComputedStyle(document.querySelector('[data-node-id="sibling"]')).color})),expected:{ids:['a','nested','sibling'],color:'rgb(255, 0, 0)'}})
 await page.locator('#nested-text').focus()
 familyChecks.push({name:'focus on nested child changes sibling paint through containing article',actual:await page.evaluate(()=>({ids:[...window.__paintInvalidation.cardPaintIds(document.querySelector('#nested-text'))].sort(),weight:getComputedStyle(document.querySelector('[data-node-id="sibling"]')).fontWeight})),expected:{ids:['a','nested','sibling'],weight:'700'}})
 checks=await page.evaluate(async code=>{
  const {cardPaintIds,paintMutationScope}=await import('data:text/javascript;base64,'+btoa(code))
  const stage=document.querySelector('main'),surface=document.querySelector('.vello-board'),world=document.querySelector('.board-world'),layer=document.querySelector('.board-object-layer'),a=document.querySelector('[data-node-id="a"]'),b=document.querySelector('[data-node-id="b"]')
  const observer=new MutationObserver(()=>{});observer.observe(stage,{subtree:true,attributes:true,attributeOldValue:true,childList:true,characterData:true})
  const checks=[]
  function mutation(name,write,global,ids){write();const scope=paintMutationScope(observer.takeRecords(),stage,surface);checks.push({name,actual:{global:scope.global,ids:[...scope.ids].sort(),changed:scope.changed},expected:{global,ids:ids.sort(),changed:global||ids.length>0}})}
  const chrome=document.createElement('div');chrome.className='canvas-interaction-overlay';chrome.dataset.canvasPaintChrome='interaction';chrome.innerHTML='<button>Move</button>';world.append(chrome);observer.takeRecords()
  mutation('owned transform handle geometry does not recapture sibling cards',()=>chrome.firstElementChild.style.left='25px',false,[])
  mutation('overlay root style remains conservatively invalidating',()=>chrome.style.color='red',true,[])
  mutation('semantic article inserted in chrome loses the exemption',()=>{const article=document.createElement('article');article.className='board-node';article.dataset.nodeId='injected';chrome.firstElementChild.append(article)},true,['injected'])
  chrome.remove();observer.takeRecords()
  mutation('actual canonical-card marker never dirties semantic paint',()=>a.setAttribute('data-vello-card-canonical-read','true'),false,[])
  mutation('world camera transform preserves retained card paint',()=>world.style.transform='translate(20px, 30px) scale(1.5)',false,[])
  mutation('world inherited typography globally invalidates',()=>world.style.fontFamily='Georgia',true,[])
  mutation('camera transform after typography preserves its existing scope',()=>world.style.transform='translate(40px, 60px) scale(1.5)',false,[])
  mutation('camera and inherited style in one mutation batch remain global',()=>{world.style.transform='translate(60px, 90px) scale(1.5)';world.style.color='red'},true,[])
  mutation('stage grayscale class globally invalidates',()=>stage.classList.add('grayscale-preview'),true,[])
  mutation('single image load source dirties its containing DOM family',()=>document.querySelector('#image').setAttribute('src','data:image/png;base64,AA=='),false,['a','nested','sibling'])
  mutation('nested descendant text dirties its family',()=>document.querySelector('#nested-text').firstChild.textContent='Changed',false,['a','nested','sibling'])
  mutation('parent article class dirties descendants too',()=>a.classList.add('selected'),false,['a','nested','sibling'])
  mutation('unknown inherited layer style remains global',()=>layer.style.opacity='.8',true,[])
  mutation('removed direct member preserves detached object identity',()=>b.remove(),false,['b'])
  mutation('removed nested member dirties containing family',()=>document.querySelector('[data-node-id="nested"]').remove(),false,['a','nested','sibling'])
  mutation('renderer ownership markers never invalidate canonical paint',()=>{a.setAttribute('data-vello-card-paint','complete');a.setAttribute('data-vello-paint','true');a.setAttribute('data-vello-canonical-read','true')},false,[])
  mutation('surface publication does not invalidate cards',()=>{surface.append(document.createElement('canvas'));surface.style.visibility='visible'},false,[])
  mutation('unclassified wrapper insertion is a conservative global change',()=>layer.append(document.createElement('div')),true,[])
  const connector=document.querySelector('#connector-path'),connectorLabel=document.querySelector('#connector-label')
  const articleAppearance=()=>({html:a.outerHTML,color:getComputedStyle(a).color,font:getComputedStyle(a).font,bounds:a.getBoundingClientRect().toJSON()})
  const beforeConnector=articleAppearance()
  mutation('external connector thickness changes only DOM-owned SVG paint',()=>connector.setAttribute('stroke-width','9'),false,[])
  checks.push({name:'connector width commits while unrelated article paint remains exact',actual:{width:getComputedStyle(connector).strokeWidth,article:articleAppearance()},expected:{width:'9px',article:beforeConnector}})
  mutation('external connector path and color edits do not invalidate cards',()=>{connector.setAttribute('d','M0 10L90 20');connector.setAttribute('stroke','green')},false,[])
  mutation('external connector label transform is isolated from article geometry',()=>connectorLabel.setAttribute('transform','translate(5 10)'),false,[])
  mutation('connector class changes remain conservative global invalidation',()=>connectorLabel.classList.add('selected'),true,[])
  mutation('connector inline style changes remain conservative global invalidation',()=>connector.style.color='purple',true,[])
  mutation('connector-like SVG within an article dirties its family',()=>document.querySelector('#card-path').setAttribute('stroke-width','8'),false,['a','sibling'])
  mutation('unclassified external SVG paint remains globally invalidating',()=>document.querySelector('#unknown-path').setAttribute('stroke-width','7'),true,[])
  mutation('connector change cannot suppress a card mutation in the same batch',()=>{connector.setAttribute('stroke-width','10');document.querySelector('#card-path').setAttribute('stroke-width','9')},false,['a','sibling'])
  const markerless=document.createElement('article');markerless.className='board-node';markerless.innerHTML='<svg><path id="markerless-card-path" d="M0 0L10 10" /></svg>';layer.append(markerless);observer.takeRecords()
  mutation('article missing identity cannot silently reuse paint',()=>document.querySelector('#markerless-card-path').setAttribute('stroke-width','4'),true,[])
  markerless.remove();observer.takeRecords()
  const foreign=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');foreign.innerHTML='<article class="board-node"><svg><path id="foreign-card-path" d="M0 0L10 10" /></svg></article>';document.querySelector('svg.connector-layer').append(foreign);observer.takeRecords()
  mutation('unidentified semantic article inside connector SVG never receives connector exemption',()=>document.querySelector('#foreign-card-path').setAttribute('stroke-width','4'),true,[])
  foreign.remove();observer.takeRecords()
  checks.push({name:'focus/hover descendant resolves containing family without project mutation',actual:[...cardPaintIds(document.querySelector('#image'))].sort(),expected:['a','sibling']})
  observer.disconnect();return checks
 },compiled)
 checks.unshift(...familyChecks)
}finally{await browser.close()}
const output=resolve('output/playwright','paint-invalidation-'+Date.now());await mkdir(output,{recursive:true})
const report={schema:'art-equation.paint-invalidation-regression',sourceHash:createHash('sha256').update(source).digest('hex'),scope:'ACTUAL_DOM_SCOPE_REGRESSION_ONLY',checks:checks.map(check=>({...check,passed:JSON.stringify(check.actual)===JSON.stringify(check.expected)}))}
await writeFile(resolve(output,'review.json'),JSON.stringify(report,null,2)+'\n')
for(const check of report.checks)assert.deepEqual(check.actual,check.expected,check.name)
console.log('Paint invalidation: PASS ('+checks.length+' actual DOM checks; no app pixels or performance qualification)')
console.log(output)
