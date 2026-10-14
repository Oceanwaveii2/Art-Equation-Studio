import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright-core'
const out=path.resolve('output/playwright/controller-canvas-smoke');await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'})
const report={scope:'Basic disposable browser pan, move, undo/redo, and active-board lifecycle check. Not an EXE, sustained benchmark, GPU pixel or 4K qualification.',checks:[],errors:[],samples:[]}
page.on('pageerror',error=>report.errors.push(error.message))
const check=(name,detail)=>{report.checks.push({name,pass:true,detail});console.log('PASS',name)}
try{
 await page.goto((process.env.AE_UI_URL||'http://127.0.0.1:5311')+'/?catalog=demo')
 await page.getByRole('button',{name:'Add a document or board',exact:true}).click()
 await page.getByRole('button',{name:'▧ New board',exact:true}).click()
 await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Canvas',exact:true}).click()
 const closeUtility=page.getByRole('button',{name:'Hide Color and Layers',exact:true});if(await closeUtility.isVisible())await closeUtility.click()
 await page.evaluate(()=>{
  localStorage.setItem('art-equation-board-clipboard',JSON.stringify({nodes:[0,1,2].map(i=>({id:'smoke-'+i,kind:'shape',shapeType:'rectangle',title:'Smoke '+i,x:160+i*200,y:200,width:130,height:120,color:'#6688aa'})),connectors:[]}))
  window.dispatchEvent(new ClipboardEvent('paste'))
 })
 await page.waitForFunction(()=>document.querySelectorAll('.board-node').length===3)
 await page.locator('summary[aria-label="Navigation and view tools"]').click()
 await page.getByLabel('Fit selection',{exact:true}).click()
 await page.waitForTimeout(250)
 const stage=page.locator('.canvas-stage')
 for (const operation of ['pan','zoom']) {
 const pan=await page.evaluate(async zoom=>{
  const stage=document.querySelector('.canvas-stage'),box=stage.getBoundingClientRect(),before={commits:Number(stage.dataset.reactCommits),frames:Number(stage.dataset.cameraFrames||0),camera:stage.dataset.liveCamera}
  const intervals=[];let previous
  for(let i=0;i<16;i++){
   await new Promise(resolve=>requestAnimationFrame(now=>{if(previous)intervals.push(now-previous);previous=now;resolve()}))
   stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,shiftKey:!zoom,deltaX:2,deltaY:2,clientX:box.x+box.width/2,clientY:box.y+box.height/2}))
  }
  await new Promise(resolve=>requestAnimationFrame(resolve))
  return{before,commits:Number(stage.dataset.reactCommits)-before.commits,frames:Number(stage.dataset.cameraFrames||0)-before.frames,camera:stage.dataset.liveCamera,intervals}
 },operation==='zoom')
 assert.equal(pan.commits,0);assert.ok(pan.frames>0);assert.notEqual(pan.camera,pan.before.camera)
 report.samples.push({operation,...pan});check('camera '+operation+' presents without React canvas commits',pan)
 await page.waitForTimeout(250)
 }
 await page.keyboard.press('Escape');await page.keyboard.press('v')
 const node=page.locator('.board-node').first(),target=await node.evaluate(el=>{const box=el.getBoundingClientRect();return{id:el.dataset.nodeId,x:box.x+20,y:box.y+20,left:parseFloat(el.style.left),top:parseFloat(el.style.top)}})
 await node.evaluate((el,t)=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:801,pointerType:'pen',button:0,buttons:1,altKey:true,clientX:t.x,clientY:t.y})),target)
 // Crossing the activation threshold publishes the column-drop setup once.
 await page.evaluate(t=>window.dispatchEvent(new PointerEvent('pointermove',{pointerId:801,buttons:1,altKey:true,clientX:t.x+8,clientY:t.y+4})),target)
 await page.waitForTimeout(100)
 const move=await page.evaluate(async t=>{
  const stage=document.querySelector('.canvas-stage'),commits=Number(stage.dataset.reactCommits),frames=Number(stage.dataset.gestureFrames||0)
  for(let i=1;i<=16;i++){window.dispatchEvent(new PointerEvent('pointermove',{pointerId:801,buttons:1,altKey:true,clientX:t.x+8+i*2,clientY:t.y+4+i}));await new Promise(resolve=>requestAnimationFrame(resolve))}
  await new Promise(resolve=>requestAnimationFrame(resolve))
  return{commits:Number(stage.dataset.reactCommits)-commits,frames:Number(stage.dataset.gestureFrames||0)-frames,left:parseFloat(document.querySelector('[data-node-id="'+t.id+'"]').style.left)}
 },target)
 assert.equal(move.commits,0);assert.ok(move.frames>0);assert.notEqual(move.left,target.left)
 report.samples.push({operation:'move',...move});check('object preview moves without React canvas commits',move)
 await page.evaluate(t=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:801,altKey:true,clientX:t.x+40,clientY:t.y+20})),target)
 await page.waitForTimeout(120)
 assert.equal(await stage.getAttribute('data-gesture-preview'),'false')
 const position=()=>node.evaluate(el=>parseFloat(el.style.left))
 assert.equal(await position(),move.left)
 await page.getByLabel('Undo board change',{exact:true}).click();assert.equal(await position(),target.left)
 await page.getByLabel('Redo board change',{exact:true}).click();assert.equal(await position(),move.left)
 check('final move commits once; undo and redo restore exact geometry')
 const oldHost=await page.locator('.vello-board').elementHandle()
 const oldScene=await oldHost.getAttribute('data-scene')
 await page.locator('.navigator button.tree-row').filter({hasText:'Master reference board'}).click()
 await page.waitForFunction(scene=>document.querySelector('.vello-board')?.dataset.scene!==scene,oldScene)
 assert.equal(await page.locator('.canvas-stage').count(),1);assert.equal(await page.locator('.vello-board').count(),1)
 assert.equal(await page.locator('.vello-board').evaluate((el,previous)=>el===previous,oldHost),true)
 // Give any request already in flight time to settle before checking disposal.
 await page.waitForTimeout(250)
 const oldGeneration=await oldHost.getAttribute('data-generation')
 await page.waitForTimeout(180)
 assert.equal(await oldHost.getAttribute('data-generation'),oldGeneration)
 check('board switch reuses one canvas host; only the new scene is mounted and idle generations settle',{oldScene,oldGeneration})
 report.telemetry=await stage.evaluate(el=>({camera:el.dataset.liveCamera,input:el.dataset.inputMetrics,performance:el.dataset.canvasPerformance,indexed:el.dataset.spatialIndexSize,candidates:el.dataset.spatialVisibleCandidates,renderer:el.dataset.canvasRenderer}))
 await page.screenshot({path:path.join(out,'active-board.png')})
 assert.deepEqual(report.errors,[])
}catch(error){report.failure=String(error);throw error}
finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close()}
