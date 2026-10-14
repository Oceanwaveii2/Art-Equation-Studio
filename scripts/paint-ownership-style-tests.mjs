import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {chromium} from 'playwright-core'

// Real browser cascade and semantic hit tests using production stylesheets.
// GPU pixels, native rendering, and frame times require separate app evidence.
const files=['src/App.css','src/p1V2Shell.css','src/board/RetainedBoardContent.css','src/board/VelloBoardBackdrop.css','src/board/completeMeasuredCardPaint.css']
const sources=Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(file,'utf8')])))
const stripImports=css=>css.replace(/^\s*@import[^;]+;/gm,'')
const owned=sources[files[4]]
const legacyOwned=owned.replace(/,\s*\.canvas-stage\[data-canvas-renderer="vello"\] \.board-world \.board-node\[data-vello-card-paint="complete"\]/,'')
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true})
const checks=[]
const add=(name,actual,expected)=>checks.push({name,actual,expected,passed:JSON.stringify(actual)===JSON.stringify(expected)})
try {
 for(const theme of ['navy','dark','light'])for(const order of ['app-last','ownership-last']) {
  const page=await browser.newPage({viewport:{width:1280,height:900}})
  await page.setContent(`<main class="studio-shell approved-layout-port workspace-${theme}"><section class="canvas-stage" data-canvas-renderer="vello"><div class="board-world"><article class="board-node node-column node-graph-column has-body-color" data-node-id="saved-column" style="--node-body:rgb(19,32,44);--node-accent:rgb(40,80,120);position:absolute;left:40px;top:40px;width:320px;height:400px"><header class="column-header"><button id="semantic-control" aria-label="Column action">Action</button><span>Saved title</span></header><button class="column-resize-handle" aria-label="Resize column"></button></article></div></section></main>`)
  const baseStyles=[files[2],files[3]]
  const styleOrder=order==='app-last'?[...baseStyles,files[4],files[0],files[1]]:[files[0],files[1],...baseStyles,files[4]]
  for(const file of styleOrder)await page.addStyleTag({content:stripImports(sources[file])})
  // Fixture geometry alone; no appearance declaration overrides production CSS.
  await page.addStyleTag({content:'.studio-shell{display:block!important;height:900px!important}.canvas-stage{position:relative!important;width:1280px!important;height:900px!important}.board-world{position:relative!important;transform:none!important}#semantic-control{width:90px;height:34px}.column-resize-handle{right:0;bottom:0;width:32px;height:32px}'})
  await page.evaluate(()=>document.querySelector('#semantic-control').addEventListener('click',()=>{window.__semanticClicks=(window.__semanticClicks||0)+1}))
  const snapshot=()=>page.evaluate(()=>{const node=document.querySelector('article'),style=getComputedStyle(node),header=node.querySelector('header'),control=node.querySelector('button'),resize=node.querySelector('.column-resize-handle');return{background:style.backgroundColor,backgroundImage:style.backgroundImage,border:style.borderTopColor,shadow:style.boxShadow,headerOpacity:getComputedStyle(header).opacity,resizeOpacity:getComputedStyle(resize).opacity,bounds:node.getBoundingClientRect().toJSON(),controlBounds:control.getBoundingClientRect().toJSON(),title:header.textContent,id:node.dataset.nodeId,outline:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor}})
  const before=await snapshot(),label=`${theme}/${order}`
  add(`${label}: unowned column keeps authored body color`,before.background,'rgb(19, 32, 44)')
  await page.locator('article').evaluate(node=>node.dataset.velloCardPaint='complete')
  const accepted=await snapshot()
  add(`${label}: accepted body cannot occlude engine artwork`,accepted.background,'rgba(0, 0, 0, 0)')
  add(`${label}: accepted body has no image, border, or shadow`,[accepted.backgroundImage,accepted.border,accepted.shadow],['none','rgba(0, 0, 0, 0)','none'])
  add(`${label}: ownership suppresses duplicate header paint`,accepted.headerOpacity,'0')
  add(`${label}: resize control remains visible`,accepted.resizeOpacity,'1')
  add(`${label}: ownership retains layout and saved identity`,[accepted.bounds,accepted.controlBounds,accepted.title,accepted.id],[before.bounds,before.controlBounds,before.title,before.id])
  await page.getByRole('button',{name:'Column action',exact:true}).click()
  add(`${label}: hidden paint retains actual semantic click`,await page.evaluate(()=>window.__semanticClicks),1)
  await page.locator('article').evaluate(node=>node.classList.add('selected'))
  const selected=await snapshot()
  add(`${label}: selection outline remains visible`,[selected.outline,selected.outlineWidth,selected.outlineColor],['solid','2px','rgb(143, 176, 200)'])
  await page.locator('article').evaluate(node=>{node.classList.remove('selected');delete node.dataset.velloCardPaint;node.dataset.velloCardCanonicalRead='true'})
  const canonical=await snapshot()
  add(`${label}: canonical capture restores authored body and child paint`,[canonical.background,canonical.headerOpacity,canonical.bounds,canonical.title,canonical.id],[before.background,before.headerOpacity,before.bounds,before.title,before.id])
  await page.close()
 }
 // Sensitivity control reproduces the old bug with the old ownership selector.
 const page=await browser.newPage()
 await page.setContent('<main class="studio-shell"><section class="canvas-stage" data-canvas-renderer="vello"><div class="board-world"><article class="board-node node-column has-body-color" data-vello-card-paint="complete" style="--node-body:rgb(19,32,44)">Original occlusion</article></div></section></main>')
 await page.addStyleTag({content:stripImports(sources[files[0]])})
 await page.addStyleTag({content:legacyOwned})
 add('sensitivity: old selector reproduces opaque authored overlay',await page.locator('article').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(19, 32, 44)')
 await page.close()
} finally {await browser.close()}
const output=resolve('../output/playwright','paint-ownership-style-'+Date.now())
await mkdir(output,{recursive:true})
const report={schema:'art-equation.paint-ownership-css-regression',scope:'ACTUAL_DOM_CASCADE_AND_HITS_ONLY',browserClosed:true,sourceHashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(sources[file]).digest('hex')])),checks}
await writeFile(resolve(output,'review.json'),JSON.stringify(report,null,2)+'\n')
for(const check of checks)assert.deepEqual(check.actual,check.expected,check.name)
console.log(`Paint ownership styles: PASS (${checks.length} actual browser checks; no GPU/native pixels or performance qualification)`)
console.log(output)
