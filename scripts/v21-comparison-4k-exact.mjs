import {chromium} from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
const out=path.resolve('../output/playwright/4k-exact')
await fs.mkdir(out,{recursive:true})
const corpusRoot=path.resolve('../fixtures/workspace')
const corpus=JSON.parse(await fs.readFile(path.join(corpusRoot,'projects/p1-v2-studies/project.json'),'utf8'))
const helper='D:/0/AE2Target-20261007/release/examples/audit-font-resolver.exe'
const fontCache=new Map()
async function font(command,args){
 const key=JSON.stringify({command,...args})
 if(!fontCache.has(key))fontCache.set(key,new Promise((resolve,reject)=>{
  const proc=execFile(helper,[],{maxBuffer:64*1024*1024},(error,stdout,stderr)=>error?reject(new Error(stderr)):resolve(JSON.parse(stdout)));proc.stdin.end(key)
 }))
 return fontCache.get(key)
}
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:0
const selectedCases=process.env.AUDIT_FULL==='1'?corpus.boards.filter(b=>!b.parentBoardId):[corpus.boards.find(b=>b.id==='ultra-graph-test-1')||corpus.boards[0],corpus.boards.find(b=>b.title.toLowerCase().includes('miami'))].filter(Boolean)
const cases=selectedCases.filter(b=>b.id==='ultra-graph-test-1')
const versions=[{id:'previous',url:'http://127.0.0.1:5191'},{id:'engine-prototype',url:'http://127.0.0.1:5192/?canvas-renderer=vello'},{id:'integration-2.0',url:'http://127.0.0.1:5190'}]
if(process.env.AUDIT_INSTRUMENTED==='1')versions.push({id:'diagnostics-2.1',url:'http://127.0.0.1:5194'})
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-precise-memory-info']})
const report={at:new Date().toISOString(),method:'Production browser builds; identical project/media, native font resolver, in-memory workspace adapter. Not native EXE timing. One cold run per case; no trace during timing. Three repeats required before release gates.',browser:await browser.version(),physicalDisplay:{width:3840,height:2160},note:'Exact 4K canvas requested by compensating shell area; backing dimensions recorded and must be verified. Frame gaps are not input-to-commit or physical scan-out.',results:[]}
try{
for(const version of versions)for(const board of cases){
 const context=await browser.newContext({viewport:{width:2394,height:version.id==='integration-2.0'?1438:1414},deviceScaleFactor:2,reducedMotion:'reduce'})
 const page=await context.newPage(),errors=[],calls=[]
 const project=structuredClone(corpus),memory=new Map()
 const settings={schemaVersion:5,theme:'navy',glassStrength:0,viewMode:'canvas',splitRatio:54,activeProjectId:project.id,projectNavigation:{[project.id]:{activeBoardId:board.id,activeDocumentId:project.documents[0]?.id||'',activeNavigatorItem:'board:'+board.id,viewMode:'canvas'}}}
 memory.set('settings.json',settings);memory.set('projects/'+project.id+'/project.json',project)
 await page.exposeFunction('__auditInvoke',async(command,args={})=>{
  const start=performance.now()
  try{
   if(command.startsWith('resolve_system_font'))return await font(command,args)
   if(command==='workspace_info')return{root:'audit',workspaceId:'audit',readOnly:false,lockOwned:true}
   if(command==='list_projects')return[{id:project.id,title:project.title,updatedAt:project.updatedAt,boardCount:project.boards.length,assetCount:project.assets.length}]
   if(command==='load_json')return structuredClone(memory.get(args.relativePath)||null)
   if(command==='save_json'){memory.set(args.relativePath,structuredClone(args.value));return{relativePath:args.relativePath,bytesWritten:JSON.stringify(args.value).length}}
   if(command==='audit_assets')return project.assets.map(a=>({id:a.id,status:a.status}))
   if(command==='list_project_trash'||command==='list_trashed_projects'||command==='list_recovery_entries')return[]
   if(command==='mini_bridge_launch')return null
   if(command==='project_b_preflight_context')return{enabled:false}
   if(command==='plugin:event|listen')return 1
   if(command==='plugin:window|scale_factor')return 1
   if(command==='ensure_managed_board_folders'||command==='record_performance_batch'||command==='record_frontend_diagnostic'||command==='plugin:event|unlisten')return null
   throw new Error('Audit adapter unsupported: '+command)
  }finally{calls.push({command,ms:performance.now()-start})}
 })
 await context.route('**/__audit_assets/**',async route=>{
  const relative=decodeURIComponent(route.request().url().split('/__audit_assets/')[1]).replace(/^audit[\\/]/,'')
  const file=path.resolve(corpusRoot,relative)
  if(!file.startsWith(corpusRoot+path.sep))return route.abort()
  try{await route.fulfill({path:file})}catch{await route.fulfill({status:404,body:''})}
 })
 await page.addInitScript(()=>{
  let callback=0
  window.__TAURI_INTERNALS__={invoke:(command,args)=>window.__auditInvoke(command,args),convertFileSrc:p=>location.origin+'/__audit_assets/'+encodeURIComponent(p.replace(/^audit[\\/]/,'')),transformCallback:()=>++callback,unregisterCallback:()=>{},metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}}}
  window.__auditTasks=[];window.__auditFrames=[]
  try{new PerformanceObserver(list=>window.__auditTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true})}catch{}
 })
 page.on('pageerror',e=>errors.push(e.message))
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 console.log('Starting',version.id,board.id)
 const start=performance.now()
 await page.goto(version.url,{waitUntil:'domcontentloaded',timeout:60000})
 await page.locator('.canvas-stage').first().waitFor({timeout:60000})
 await page.waitForTimeout(1500)
 const canvasButton=page.getByRole('button',{name:'Canvas',exact:true}); if(await canvasButton.isVisible())await canvasButton.click();
 await page.locator('.canvas-stage').first().waitFor({state:'visible',timeout:60000});
 await page.waitForTimeout(1000)
 const readyMs=performance.now()-start
 const stage=page.locator('.canvas-stage').first(),box=await stage.boundingBox()
 const session=await context.newCDPSession(page);await session.send('Performance.enable')
 const metrics=async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
 const before=await metrics()
 await page.evaluate(()=>{let last=performance.now();window.__auditStop=false;const frame=now=>{window.__auditFrames.push(now-last);last=now;if(!window.__auditStop)requestAnimationFrame(frame)};requestAnimationFrame(frame)})
 const generationBefore=await page.locator('.vello-board').evaluateAll(es=>es.map(e=>Number(e.dataset.generation||0)))
 for(let i=0;i<8;i++){await page.mouse.move(box.x+box.width*(.2+(i%6)*.1),box.y+box.height*(.25+(i%3)*.15));await page.waitForTimeout(15)}
 const generationHover=await page.locator('.vello-board').evaluateAll(es=>es.map(e=>Number(e.dataset.generation||0)))
 for(let i=0;i<8;i++){await page.mouse.wheel(i%2?48:-42,i%3?14:-10);if(i%10===0){await page.keyboard.down('Control');await page.mouse.wheel(0,-30);await page.keyboard.up('Control')}await page.waitForTimeout(15)}
 await page.waitForTimeout(800);const after=await metrics()
 const observed=await page.evaluate(()=>{
  window.__auditStop=true
  const stage=document.querySelector('.canvas-stage'),gpu=document.querySelector('.vello-board')
  return{frames:window.__auditFrames,tasks:window.__auditTasks,stage:stage?{...stage.dataset}:null,gpu:gpu?{...gpu.dataset}:null,canvases:Array.from(document.querySelectorAll('canvas')).map(c=>({width:c.width,height:c.height,cssWidth:c.getBoundingClientRect().width,cssHeight:c.getBoundingClientRect().height})),dom:document.getElementsByTagName('*').length,memory:performance.memory?.usedJSHeapSize,diagnostics:window.__AE_DIAGNOSTICS__?.snapshot()}
 })
 await page.screenshot({path:path.join(out,version.id+'-'+board.id+'.png')})
 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze().catch(e=>({error:e.message,violations:[]}))
 const layout=await page.evaluate(()=>Array.from(document.querySelectorAll('.app-bar button,.canvas-tool-rail button,.pane-toolbar button,.project-inspector')).map(e=>{const r=e.getBoundingClientRect();return{label:e.getAttribute('aria-label')||e.textContent?.slice(0,70),x:r.x,y:r.y,width:r.width,height:r.height,offscreen:r.right>innerWidth+1||r.bottom>innerHeight+1||r.x<0}}))
 const result={version:version.id,board:board.id,nodes:board.nodes.length,readyMs,frames:{p50:percentile(observed.frames,.5),p95:percentile(observed.frames,.95),max:Math.max(...observed.frames),over50:observed.frames.filter(x=>x>50).length},hoverInvalidations:generationHover.map((n,i)=>n-(generationBefore[i]||0)),costs:Object.fromEntries(['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(k=>[k,(after[k]||0)-(before[k]||0)])),observed,calls:calls.map(c=>({...c,ms:Math.round(c.ms)})),errors,violations:a11y.violations?.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),layout}
 report.results.push(result)
 console.log(version.id,board.title,JSON.stringify({ready:Math.round(readyMs),p95:result.frames.p95,max:result.frames.max,hover:result.hoverInvalidations,backend:observed.gpu?.renderer,painted:observed.gpu?.paintedObjects,violations:result.violations?.length,errors:errors.length}))
 await fs.writeFile(path.join(out,'comparison.json'),JSON.stringify(report,null,2));await context.close()
}
const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage()
await page.goto('http://127.0.0.1:5193');await page.waitForTimeout(1500)
await page.screenshot({path:path.join(out,'ui-prototype.png')})
const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
report.uiPrototype={scope:'Shell reference only; different workload and no integrated engine. FPS not compared to graph workload.',violations:a11y.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),dom:await page.locator('*').count()}
await fs.writeFile(path.join(out,'comparison.json'),JSON.stringify(report,null,2))
}finally{await browser.close()}

