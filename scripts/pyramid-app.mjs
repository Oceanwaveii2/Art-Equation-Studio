import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { createProject, managedAsset } from '../src/model/project.ts'

const manifest=JSON.parse(await readFile('tmp/pyramid-fixtures/giant.json','utf8'))
const project=createProject();project.id='test-project';project.title='P10 P11 verification'
const asset=managedAsset({id:'giant-asset',relativePath:'projects/test-project/assets/originals/giant.png',originalName:'giant.png',extension:'png',byteLength:1,deduplicated:false,thumbnailRelativePath:manifest.posterRelativePath,requiresTiledPreview:true})
project.assets=[asset];project.boards=[{...project.boards[0],id:'tiles-board',title:'Tiles board',viewport:{x:0,y:0,scale:1},nodes:[{id:'giant-card',kind:'image',assetId:asset.id,title:'Giant image',x:30,y:30,width:40001,height:1062}],connectors:[]}, {...project.boards[1],id:'empty-board',title:'Empty board',nodes:[],connectors:[]}]
const server=await createServer({cacheDir:'node_modules/.vite-pyramid-app',optimizeDeps:{entries:['index.html']},server:{watch:null,host:'127.0.0.1',port:5177,strictPort:true}});await server.listen()
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const page=await browser.newPage({viewport:{width:1600,height:1000}});const errors=[],requests=[]
page.on('pageerror',e=>errors.push(e.message));await page.route('**/originals/giant.png',r=>{requests.push(r.request().url());return r.abort()})
await page.addInitScript(({project,manifest})=>{
 const state=JSON.parse(localStorage.getItem('pyramid-test-project')||'null')||project
 const job={id:'native-fixture-job',projectId:project.id,assetId:'giant-asset',phase:'queued',elapsedMs:0};let polls=0
 window.__pyramidCalls=[];window.__pyramidSaved=state
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},convertFileSrc:path=>'/tmp/pyramid-fixtures/'+path.replaceAll('\\','/').replace(/^C:\/fixture\//,''),invoke:async(command,args={})=>{
  window.__pyramidCalls.push({command,args})
  if(command==='workspace_info')return{root:'C:/fixture',workspaceId:'fixture',readOnly:false,lockOwned:true}
  if(command==='list_projects')return[{id:project.id,title:project.title,updatedAt:project.updatedAt,boardCount:2,assetCount:1}]
  if(command==='load_json')return args.relativePath==='settings.json'?{schemaVersion:3,viewMode:'canvas',splitRatio:50,activeProjectId:project.id,projectNavigation:{[project.id]:{activeBoardId:'tiles-board',activeDocumentId:project.documents[0].id,activeNavigatorItem:'board:tiles-board',viewMode:'canvas'}}}:state
  if(command==='save_json'){if(args.relativePath.endsWith('/project.json')){window.__pyramidSaved=args.value;localStorage.setItem('pyramid-test-project',JSON.stringify(args.value))}return{}}
  if(command==='audit_assets')return[{id:'giant-asset',status:'available'}]
  if(command==='start_image_pyramid'){polls=0;job.phase='queued';return{...job}}
  if(command==='image_pyramid_status'){if(job.phase==='cancelled')return{...job};polls++;return polls>=3?{...job,phase:'complete',pyramid:manifest}:{...job,phase:'tiling'}}
  if(command==='cancel_image_pyramid'){job.phase='cancelled';return null}
  if(command.startsWith('plugin:'))return 0
  return[]
 }}
},{project,manifest})
try {
 await page.goto('http://127.0.0.1:5177/',{waitUntil:'domcontentloaded',timeout:60000})
 await page.getByText('Right-click → Prepare tiled image for full detail').waitFor({timeout:60000})
 assert.equal(requests.length,0,'import preview must not decode a giant original')
 await page.locator('[data-node-id="giant-card"], .board-node').first().click({button:'right',position:{x:100,y:120}})
 await page.getByRole('menuitem',{name:'Prepare tiled image…',exact:true}).click()
 await page.getByLabel('Tiled image preparation').waitFor()
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await page.getByRole('button',{name:'Dismiss',exact:true}).click()
 await page.locator('.board-node').first().click({button:'right',position:{x:100,y:120}})
 await page.getByRole('menuitem',{name:'Prepare tiled image…',exact:true}).click()
 await page.waitForFunction(()=>window.__pyramidSaved.assets[0].imagePyramid?.width===40001)
 await page.waitForFunction(()=>document.querySelector('.tile-surface')?.dataset.pending==='0')
 await page.getByRole('button',{name:'Dismiss',exact:true}).click()
 await page.locator('.canvas-stage').dispatchEvent('wheel',{deltaX:1,deltaY:0,bubbles:true,cancelable:true,shiftKey:true})
 await page.waitForTimeout(300)
 const livePan=await page.evaluate(async()=>{
  const stage=document.querySelector('.canvas-stage'),commits=Number(stage.dataset.reactCommits),left=parseFloat(document.querySelector('.tile-surface').style.left)
  for(let i=0;i<24;i++){stage.dispatchEvent(new WheelEvent('wheel',{deltaX:30,deltaY:0,bubbles:true,cancelable:true,shiftKey:true}));await new Promise(resolve=>requestAnimationFrame(resolve))}
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
  return {commits:Number(stage.dataset.reactCommits)-commits,before:left,after:parseFloat(document.querySelector('.tile-surface').style.left)}
 })
 assert.equal(livePan.commits,0,'tile demand follows live camera without board reconciliation')
 assert(livePan.after>livePan.before+500,'tile crop must follow the live pan')
 await page.locator('.canvas-stage').dispatchEvent('wheel',{deltaX:-721,deltaY:0,bubbles:true,cancelable:true,shiftKey:true})
 await page.waitForTimeout(300)
 await mkdir('output/playwright/pyramid',{recursive:true});await page.screenshot({path:'output/playwright/pyramid/app-tiled-canvas.png'})
 assert.equal(requests.length,0)
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('.tile-surface')?.dataset.uploads>0)
 assert.equal(requests.length,0,'save/reopen must retain tiles without original decode')
 await page.locator('.board-node').first().dblclick({position:{x:100,y:120}})
 await page.getByRole('dialog',{name:'Full-size media preview'}).waitFor()
 assert.equal(await page.locator('.asset-preview-stage .tiled-image-preview').count(),1)
 await page.locator('.asset-preview-stage').click({position:{x:200,y:200}})
 await page.waitForFunction(()=>document.querySelector('.asset-preview-stage .tile-surface')?.dataset.uploads>0)
 await page.getByRole('dialog',{name:'Full-size media preview'}).getByRole('button',{name:'Close',exact:true}).click()
 await page.locator('.tree-row.child').filter({hasText:'Empty board'}).click()
 await page.waitForFunction(()=>!document.querySelector('.tile-surface'))
 await page.locator('.tree-row.child').filter({hasText:'Tiles board'}).click()
 await page.waitForFunction(()=>Number(document.querySelector('.tile-surface')?.dataset.uploads)>0)
 assert.equal(requests.length,0)
 const calls=await page.evaluate(()=>window.__pyramidCalls.map(c=>c.command))
 assert.deepEqual(errors,[])
 const report={result:'PASS',checks:['oversized import preview','prepare context-menu / native command boundary','job progress / cancellation / retry','attach metadata / autosave','live camera tile crop without React board commits','save and reopen','fullscreen tiled preview','board switching releases/reacquires tile surfaces','no giant original browser request'],livePan,nativeFixtures:true,ipc:'mocked; native preparation separately exercised by Cargo tests',calls}
 await writeFile('output/playwright/pyramid/app-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(error){console.error(error,errors);await page.screenshot({path:'output/playwright/pyramid/app-failure.png'});throw error}finally{await browser.close();await server.close()}
