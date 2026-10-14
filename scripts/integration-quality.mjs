import {chromium} from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'
import {screenEvidence,sha256} from './quality-evidence.mjs'
import {summarizePerformanceDiagnostic} from './performance-diagnostic-summary.mjs'
import {collectBenchmarkIsolation,benchmarkIsolationFailures} from './benchmark-isolation.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {pathToFileURL} from 'node:url'

// Rehash the frozen inputs after timing, including the manifest itself. A
// changed or missing file rejects the diagnostic; it never erases its samples.
export async function verifyDiagnosticManifest(snapshot){
 const failures=[],files=snapshot?.manifest?.files
 if(snapshot?.manifest?.schema!==1||!Array.isArray(files)||!files.length||!snapshot?.file||!/^[a-f0-9]{64}$/i.test(snapshot?.sha256||''))return {checkedAt:new Date().toISOString(),filesChecked:0,unchanged:false,failures:['Diagnostic provenance manifest missing or malformed']}
 try{if(sha256(await fs.readFile(snapshot.file))!==snapshot.sha256)failures.push('Diagnostic provenance manifest changed after preflight')}
 catch{failures.push('Diagnostic provenance manifest unavailable after preflight')}
 for(const file of files){
  if(!file?.path||!path.isAbsolute(file.absolutePath||'')||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/i.test(file.sha256||'')){
   failures.push(`Malformed tracked diagnostic artifact: ${file?.path||'unnamed'}`);continue
  }
  try{
   const bytes=await fs.readFile(file.absolutePath)
   if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)failures.push(`Changed diagnostic artifact: ${file.path}`)
  }catch{failures.push(`Diagnostic artifact unavailable: ${file.path}`)}
 }
 return {checkedAt:new Date().toISOString(),filesChecked:files.length,unchanged:failures.length===0,failures}
}

export function applyDiagnosticProvenance(screen,verification,runnerErrors=[]){
 const failures=[...screen.failures,...runnerErrors.map(error=>'Diagnostic runner failed: '+error)]
 if(!verification||verification.unchanged!==true)failures.push(...(verification?.failures?.length?verification.failures:['Diagnostic provenance verification missing']))
 return {...screen,decision:failures.length?'REJECT':screen.decision,failures,provenance:verification}
}

async function runIntegrationQuality(){
const out=path.resolve(process.env.AUDIT_OUT||'../output/playwright/quality-'+Date.now())
const repeats=Number(process.env.AUDIT_RUNS||3)
if(!Number.isInteger(repeats)||repeats<1||repeats>10)throw new Error('Invalid repeat count')
await fs.mkdir(out,{recursive:true})
// Manifest generation and its first rehash happen before launching the browser,
// outside every measured window. Omitting --exe keeps native qualification open.
const manifestFile=path.join(out,'candidate-manifest.json')
await new Promise((resolve,reject)=>execFile(process.execPath,['scripts/quality-manifest.mjs','--output',manifestFile],{maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(new Error('Diagnostic manifest preflight failed: '+(stderr||stdout||error.message))):resolve()))
const helper='D:/0/AE2Target-20261007/release/examples/audit-font-resolver.exe'
const manifest=JSON.parse(await fs.readFile(manifestFile)),helperBytes=await fs.readFile(helper)
manifest.files.push({path:'diagnostic-runtime/native-font-resolver.exe',absolutePath:path.resolve(helper),bytes:helperBytes.length,sha256:sha256(helperBytes)})
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2))
await fs.writeFile(manifestFile,manifestBytes)
const snapshot={file:manifestFile,sha256:sha256(manifestBytes),manifest}
const preflightVerification=await verifyDiagnosticManifest(snapshot)
if(!preflightVerification.unchanged)throw new Error(preflightVerification.failures.join('\n'))
const corpusRoot=path.resolve('../fixtures/workspace')
const corpus=JSON.parse(await fs.readFile(path.join(corpusRoot,'projects/p1-v2-studies/project.json'),'utf8'))
const fontCache=new Map()
async function font(command,args){
 const key=JSON.stringify({command,...args})
 if(!fontCache.has(key))fontCache.set(key,new Promise((resolve,reject)=>{
  const proc=execFile(helper,[],{maxBuffer:64*1024*1024},(error,stdout,stderr)=>error?reject(new Error(stderr)):resolve(JSON.parse(stdout)));proc.stdin.end(key)
 }))
 return fontCache.get(key)
}
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:0
const boardIds=(process.env.AUDIT_BOARDS||'ultra-graph-test-1,test-2-nodes').split(',')
const cases=corpus.boards.filter(b=>boardIds.includes(b.id))
if(cases.length!==boardIds.length)throw new Error('Missing requested board fixture')
const versions=[{id:'candidate',url:process.env.AUDIT_TARGET_URL||'http://127.0.0.1:5194'}]
let browser=null
const processIsolation={preflight:await collectBenchmarkIsolation({phase:'preflight'}),postflight:null,validSnapshotPair:false}
const report={at:new Date().toISOString(),method:`Production browser builds; identical project/media, native font resolver, in-memory workspace adapter. Not native EXE timing. ${repeats} independent browser contexts per board; each begins with a cold page, while the shared browser process and font resolver cache remain warm. No trace during timing. Read-only process inventories occur before browser launch and after browser close, outside timing; they detect known audit/Playwright activity at those instants, not transient or unrelated GPU work. Three repeats and native evidence required before release gates.`,runsPerCase:repeats,browser:null,processIsolation,provenance:{schema:1,kind:'candidate-provenance-not-acceptance',manifest:'candidate-manifest.json',manifestSha256:snapshot.sha256,qualification:manifest.qualification,scope:'Frozen local source, production bundle, tools, fixtures and references. This receipt does not independently prove an arbitrary target URL serves that local bundle, or certify native EXE performance.',preflightVerification},runnerErrors:[],results:[]}
if(process.env.AUDIT_EXACT_4K==='1')report.requiredPhysicalCanvas=[3840,2160]
try{
const isolationFailures=benchmarkIsolationFailures(processIsolation.preflight,{requireInventory:process.env.AUDIT_EXACT_4K==='1'})
if(isolationFailures.length)throw new Error('Process isolation preflight: '+isolationFailures.join('; '))
browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-precise-memory-info']})
report.browser=await browser.version()
for(const version of versions)for(const board of cases)for(let run=1;run<=repeats;run++){
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:process.env.AUDIT_EXACT_4K==='1'?2:1,reducedMotion:'no-preference'})
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
 if(process.env.AUDIT_EXACT_4K==='1'){
  for(let attempt=0;attempt<3;attempt++){
   const size=await page.locator('.vello-board').first().evaluate(el=>({width:el.clientWidth,height:el.clientHeight})),viewport=page.viewportSize()
   if(size.width===1920&&size.height===1080)break
   await page.setViewportSize({width:viewport.width+1920-size.width,height:viewport.height+1080-size.height})
   await page.waitForTimeout(500)
  }
 }
 try{
  await page.waitForFunction(exact=>{
   const host=document.querySelector('.vello-board')
   if(!host||host.dataset.pending!=='false'||host.dataset.generation!==host.dataset.acceptedGeneration)return false
   return !exact||[...document.querySelectorAll('canvas')].some(c=>c.width===3840&&c.height===2160)
  },process.env.AUDIT_EXACT_4K==='1',{timeout:10000})
 }catch{errors.push('Readiness failure: latest canvas generation/exact physical backing did not settle within 10 seconds')}
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
  return{canvases:Array.from(document.querySelectorAll('canvas')).map(c=>({width:c.width,height:c.height})),frames:window.__auditFrames,tasks:window.__auditTasks,stage:stage?{...stage.dataset}:null,gpu:gpu?{...gpu.dataset}:null,dom:document.getElementsByTagName('*').length,memory:performance.memory?.usedJSHeapSize,diagnostics:window.__AE_DIAGNOSTICS__?.snapshot()}
 })
 // Optional DOM receipt is collected after the timing window has stopped.
 // It never modifies content or canonical ownership to make capture pass.
 const layoutReceipt=process.env.AUDIT_LAYOUT_RECEIPTS==='1'?await page.evaluate(()=>[...document.querySelectorAll('article.board-node')].filter(article=>article.dataset.nodeId?.includes(':caption')||article.dataset.nodeId==='node-1').flatMap(article=>[article,...article.querySelectorAll('*')].slice(0,64).map(element=>{
   const style=getComputedStyle(element),rect=element.getBoundingClientRect()
   return {node:article.dataset.nodeId,tag:element.tagName,class:element.getAttribute('class'),computed:{width:style.width,height:style.height,display:style.display,boxSizing:style.boxSizing,padding:style.padding,border:style.borderWidth,outline:style.outline,outlineOffset:style.outlineOffset,overflow:style.overflow,transform:style.transform},rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},clientRects:element.getClientRects().length,text:element.textContent?.slice(0,80)}
 }))):undefined
 await page.screenshot({path:path.join(out,version.id+'-'+board.id+'-run-'+run+'.png')})
 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze().catch(e=>({error:e.message,violations:[]}))
 const layout=await page.evaluate(()=>Array.from(document.querySelectorAll('.app-bar button,.canvas-tool-rail button,.pane-toolbar button,.project-inspector')).map(e=>{const r=e.getBoundingClientRect();return{label:e.getAttribute('aria-label')||e.textContent?.slice(0,70),x:r.x,y:r.y,width:r.width,height:r.height,offscreen:r.right>innerWidth+1||r.bottom>innerHeight+1||r.x<0}}))
 const result={version:version.id,board:board.id,run,manifestSha256:snapshot.sha256,nodes:board.nodes.length,readyMs,frames:{p50:percentile(observed.frames,.5),p95:percentile(observed.frames,.95),max:Math.max(...observed.frames),over50:observed.frames.filter(x=>x>50).length},hoverInvalidations:generationHover.map((n,i)=>n-(generationBefore[i]||0)),costs:Object.fromEntries(['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(k=>[k,(after[k]||0)-(before[k]||0)])),observed,layoutReceipt,calls:calls.map(c=>({...c,ms:Math.round(c.ms)})),errors,violations:a11y.violations?.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),layout}
 report.results.push(result)
 console.log(version.id,board.title,JSON.stringify({ready:Math.round(readyMs),p95:result.frames.p95,max:result.frames.max,hover:result.hoverInvalidations,backend:observed.gpu?.renderer,painted:observed.gpu?.paintedObjects,violations:result.violations?.length,errors:errors.length}))
 await fs.writeFile(path.join(out,'comparison.json'),JSON.stringify(report,null,2));
 await fs.writeFile(path.join(out,'performance-analysis.json'),JSON.stringify(summarizePerformanceDiagnostic(report),null,2));await context.close()
}
}catch(error){
 report.runnerErrors.push(error.message||String(error))
}finally{
 try{if(browser)await browser.close()}catch(error){report.runnerErrors.push('Browser close: '+(error.message||String(error)))}
 processIsolation.postflight=await collectBenchmarkIsolation({phase:'postflight'})
 processIsolation.validSnapshotPair=[processIsolation.preflight,processIsolation.postflight].every(receipt=>receipt.available&&receipt.status==='CLEAR_SNAPSHOT'&&receipt.blockers.length===0)
 report.runnerErrors.push(...benchmarkIsolationFailures(processIsolation.postflight,{requireInventory:process.env.AUDIT_EXACT_4K==='1'}).map(failure=>'Process isolation postflight: '+failure))
 report.provenance.verification=await verifyDiagnosticManifest(snapshot)
 // Retain rejection on a later standalone quality:screen, whose existing
 // validator also reads per-run errors. Keep all original rendering errors.
 const diagnosticFailures=[...report.runnerErrors.map(error=>'Diagnostic runner failed: '+error),...(report.provenance.verification.unchanged?[]:report.provenance.verification.failures)]
 for(const result of report.results)result.errors.push(...diagnosticFailures)
 await fs.writeFile(path.join(out,'comparison.json'),JSON.stringify(report,null,2))
 await fs.writeFile(path.join(out,'performance-analysis.json'),JSON.stringify(summarizePerformanceDiagnostic(report),null,2))
}
const screen=applyDiagnosticProvenance(screenEvidence(report,'candidate'),report.provenance.verification,report.runnerErrors)
screen.processIsolation=processIsolation
await fs.writeFile(path.join(out,'quality-screen.json'),JSON.stringify(screen,null,2))
console.log(JSON.stringify({decision:screen.decision,failures:screen.failures,output:out}))
if(screen.decision==='REJECT')process.exitCode=1
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await runIntegrationQuality()

