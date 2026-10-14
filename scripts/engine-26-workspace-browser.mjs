import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {chromium} from 'playwright-core'
import {createServer} from 'vite'
const output='output/engine-2.6-correctness'
await fs.mkdir(output,{recursive:true})
const server=await createServer({cacheDir:'node_modules/.vite-engine-26-workspace',optimizeDeps:{entries:['scripts/fixtures/engine-26-worker.html'],include:['react','react-dom/client','@tauri-apps/api/core','paper']},server:{host:'127.0.0.1',port:5287,strictPort:true,watch:null}})
await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const page=await browser.newPage(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
const report={scope:'Real browser preview-demand and icon styles; no GPU, pan latency or 4K qualification',checks:[]}
try{
 await page.goto('http://127.0.0.1:5287/scripts/fixtures/engine-26-worker.html')
 await page.evaluate(async()=>{
  const {default:React}=await import('/node_modules/.vite-engine-26-workspace/deps/react.js'),{default:{createRoot}}=await import('/node_modules/.vite-engine-26-workspace/deps/react-dom_client.js')
  const {BoardPreview}=await import('/src/board/BoardPreview.tsx'),{diagnosticsSnapshot}=await import('/src/diagnostics/performance.ts')
  document.body.textContent='';const host=document.createElement('div');document.body.append(host)
  const root=createRoot(host),assets=[]
  let boards=Array.from({length:8},(_,index)=>({id:'preview-'+index,title:'Preview '+index,viewport:{x:0,y:0,scale:1},nodes:[{id:'shape-'+index,kind:'shape',x:0,y:0,width:100,height:60,shapeType:'rectangle',color:'#2394a3'}],connectors:[]})),epoch=0
  const render=()=>root.render(React.createElement('div',{id:'preview-scroller','data-epoch':epoch,style:{width:180,height:120,overflow:'auto'}},boards.map(board=>React.createElement('div',{key:board.id,style:{height:200}},React.createElement(BoardPreview,{board,assets,width:100,height:80})))))
  window.__previewReview={snapshot:()=>diagnosticsSnapshot().rows.filter(row=>row.kind==='board.preview-built'),pan:()=>{boards=boards.map(board=>({...board,viewport:{x:20,y:30,scale:2}}));epoch++;render()},changeHidden:()=>{boards=boards.map((board,index)=>index===0?{...board,nodes:board.nodes.map(node=>({...node,color:'#ed8844'}))}:board);epoch++;render()}}
  render()
 })
 await page.waitForFunction(()=>document.querySelector('[data-preview-board="preview-0"]')?.getAttribute('src'))
 const first=await page.evaluate(()=>window.__previewReview.snapshot())
 assert.deepEqual(first.map(row=>row.data.boardId),['preview-0'])
 report.checks.push({name:'Eight mounted thumbnails prepare only the visible board',rows:first})
 await page.evaluate(()=>window.__previewReview.pan())
 await page.waitForFunction(()=>document.querySelector('[data-epoch="1"]'))
 assert.equal((await page.evaluate(()=>window.__previewReview.snapshot())).length,1)
 report.checks.push({name:'Changing viewport on all eight boards does not rebuild previews',pass:true})
 await page.locator('#preview-scroller').evaluate(node=>node.scrollTop=600)
 await page.waitForFunction(()=>window.__previewReview.snapshot().some(row=>row.data.boardId==='preview-3'))
 assert.deepEqual((await page.evaluate(()=>window.__previewReview.snapshot())).map(row=>row.data.boardId),['preview-0','preview-3'])
 await page.evaluate(()=>window.__previewReview.changeHidden())
 await page.waitForFunction(()=>document.querySelector('[data-epoch="2"]'))
 assert.equal((await page.evaluate(()=>window.__previewReview.snapshot())).length,2)
 await page.locator('#preview-scroller').evaluate(node=>node.scrollTop=0)
 await page.waitForFunction(()=>window.__previewReview.snapshot().length===3)
 report.checks.push({name:'An offscreen edit prepares only when that board becomes visible again',rows:await page.evaluate(()=>window.__previewReview.snapshot())})
 // Exercise production icon component and its actual stylesheet selectors.
 await page.evaluate(async()=>{
  await import('/src/p1V2Shell.css');await import('/src/ui/Prototype25Shell.css')
  const {default:React}=await import('/node_modules/.vite-engine-26-workspace/deps/react.js'),{default:{createRoot}}=await import('/node_modules/.vite-engine-26-workspace/deps/react-dom_client.js'),{ThemeIcon}=await import('/src/ui/ThemeIcon.tsx')
  const host=document.createElement('div');host.className='studio-shell p1-v2-shell prototype25-integrated-shell';document.body.append(host)
  createRoot(host).render(React.createElement('div',{className:'workspace-theme-choices'},['navy','dark','light'].map(theme=>React.createElement('button',{key:theme,'data-review-theme':theme,className:'theme-choice theme-choice-'+theme+' active'},React.createElement(ThemeIcon,{theme})))))
 })
 await page.locator('[data-review-theme="light"]').waitFor()
 const colors=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('[data-review-theme]')].map(node=>[node.dataset.reviewTheme,{color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor,moonFill:node.querySelector('path')?.getAttribute('fill'),sunFill:node.querySelector('circle')?getComputedStyle(node.querySelector('circle')).fill:undefined}])))
 assert.equal(colors.navy.color,'rgb(118, 244, 222)');assert.equal(colors.navy.background,'rgb(9, 107, 145)');assert.equal(colors.dark.moonFill,'white');assert.equal(colors.light.background,'rgb(244, 191, 88)');assert.equal(colors.light.sunFill,'rgb(255, 215, 117)')
 report.checks.push({name:'Turquoise ocean selection, white crescent and golden active sun',colors})
 await page.screenshot({path:output+'/preview-and-theme.png'})
 assert.deepEqual(errors,[]);report.passed=true
}catch(error){report.passed=false;report.error=String(error);throw error}
finally{await fs.writeFile(output+'/workspace-browser.json',JSON.stringify({...report,errors},null,2));await browser.close();await server.close()}
console.log(JSON.stringify(report))

