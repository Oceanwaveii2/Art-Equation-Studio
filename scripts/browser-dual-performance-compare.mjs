import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright-core'
import {execFileSync} from 'node:child_process'

const out='D:/0/ArtEquation-Tests/2026-10-11-browser-dual/comparison-'+Date.now()
const fixturePath='D:/0/ArtEquation-Tests/2026-10-11-mixed-baseline/hybrid-0.2-pilot/subset/input.json'
const fixtureBytes=await fs.readFile(fixturePath),fixture=JSON.parse(fixtureBytes)
const sha=b=>createHash('sha256').update(b).digest('hex')
const assets=await Promise.all(fixture.resources.map(async resource=>{
 const bytes=await fs.readFile(resource.path);assert.equal(sha(bytes),resource.sha256);return bytes
}))
const moduleRoot=path.resolve('engine/vello-surface/generated')
const resources=new Map([['/module.js',{bytes:await fs.readFile(moduleRoot+'/p0_engine_wasm.js'),type:'text/javascript'}],['/module.wasm',{bytes:await fs.readFile(moduleRoot+'/p0_engine_wasm_bg.wasm'),type:'application/wasm'}],['/fixture',{bytes:Buffer.from(JSON.stringify({...fixture,resources:fixture.resources.map(r=>({reference:r.reference}))})),type:'application/json'}]])
assets.forEach((bytes,i)=>resources.set('/pixels/'+i,{bytes,type:'application/octet-stream'}))
const server=http.createServer((request,response)=>{
 const resource=resources.get(request.url);if(resource){response.writeHead(200,{'Content-Type':resource.type});response.end(resource.bytes)}
 else if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<title>Browser dual renderer correctness</title><style>body{margin:0;background:#102131}canvas{display:block}</style><canvas id="surface"></canvas>')}
 else {response.writeHead(404);response.end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await fs.mkdir(out,{recursive:true})

const gpu=()=>{try{return execFileSync('nvidia-smi',['--query-gpu=name,utilization.gpu,memory.used,memory.total','--format=csv,noheader'],{encoding:'utf8',windowsHide:true}).trim()}catch{return 'unavailable'}}
const report={scope:'Warmed alternating small mixed scene, browser WebGPU. Prepare awaits GPU queue completion; presentation is submission, not physical scanout. No 4K or EXE qualification.',fixtureSha256:sha(fixtureBytes),wasmSha256:sha(resources.get('/module.wasm').bytes),gpuBefore:gpu(),samples:[],errors:[]}
let browser
try{
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1920,height:900}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port)
 const result=await page.evaluate(async()=>{
  const module=await import('/module.js');await module.default({module_or_path:'/module.wasm'})
  const fixture=await fetch('/fixture').then(r=>r.json()),canvas=document.querySelector('canvas');canvas.width=fixture.width;canvas.height=fixture.height
  const renderer=new module.B4SurfaceRenderer(),adapter=JSON.parse(await renderer.initialize(canvas)),support=JSON.parse(await renderer.enable_hybrid())
  for(let i=0;i<fixture.resources.length;i++)renderer.register_image(JSON.stringify(fixture.resources[i].reference),new Uint8Array(await fetch('/pixels/'+i).then(r=>r.arrayBuffer())))
  let seq=0;const samples=[]
  async function draw(policy,kind,round,sample,warm=false){
   const scene=structuredClone(fixture.snapshot);scene.sceneId=kind==='static'?'redraw-'+seq++:'camera-body';scene.environment.background='#102131ff'
   const json=JSON.stringify(scene),view=fixture.view,dpr=fixture.dpr
   const shift=kind==='pan'?sample*2:0,scale=kind==='zoom'?1+(sample%10)*.005:1
   renderer.set_render_policy(policy)
   const start=performance.now();const prepared=JSON.parse(await renderer.prepare_snapshot(fixture.width,fixture.height,json,view.scale*dpr*scale,view.x*dpr+shift,view.y*dpr+shift));const presented=JSON.parse(renderer.present_prepared());const elapsedMs=performance.now()-start
   if(!warm)samples.push({policy,kind,round,sample,elapsedMs,engine:prepared.renderEngine,paintMode:prepared.paintMode,timings:prepared.probeTimingsMs,atlasUploadBytes:presented.imageAtlasUploadBytes})
   await new Promise(requestAnimationFrame)
  }
  for(let i=0;i<8;i++){await draw('classic','static',-1,i,true);await draw('dual-static','static',-1,i,true)}
  for(let round=0;round<3;round++){
   for(let i=0;i<20;i++)for(const policy of (i+round)%2?['dual-static','classic']:['classic','dual-static'])await draw(policy,'static',round,i)
   await draw('classic','pan',round,0,true)
   for(const kind of ['pan','zoom'])for(let i=0;i<20;i++)for(const policy of (i+round)%2?['dual-static','classic']:['classic','dual-static'])await draw(policy,kind,round,i)
  }
  const stats=JSON.parse(renderer.resource_stats());renderer.dispose();renderer.free();return {adapter,support,samples,stats,width:fixture.width,height:fixture.height,operations:fixture.snapshot.operations.length}
 })
 Object.assign(report,result)
 const quantile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.ceil((a.length-1)*q)]}
 report.summary=[]
 for(const kind of ['static','pan','zoom'])for(const policy of ['classic','dual-static']){
  const s=report.samples.filter(x=>x.kind===kind&&x.policy===policy),ms=s.map(x=>x.elapsedMs)
  report.summary.push({kind,policy,count:s.length,medianMs:quantile(ms,.5),p95Ms:quantile(ms,.95),engines:[...new Set(s.map(x=>x.engine))],rounds:[0,1,2].map(round=>({round,medianMs:quantile(s.filter(x=>x.round===round).map(x=>x.elapsedMs),.5)}))})
 }
 assert.deepEqual(report.errors,[]);assert.ok(report.summary.find(s=>s.kind==='static'&&s.policy==='dual-static').engines.includes('hybrid-0.2'))
 report.status='SMALL_SCENE_COMPARISON_COMPLETE; SHARED_MACHINE; NOT_HEAVY_BOARD_ACCEPTANCE'
}catch(error){report.errors.push(String(error));report.status='FAILED_OR_INCOMPLETE';process.exitCode=1}
finally{report.gpuAfter=gpu();await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,status:report.status,gpuBefore:report.gpuBefore,gpuAfter:report.gpuAfter,summary:report.summary,errors:report.errors},null,2))}
