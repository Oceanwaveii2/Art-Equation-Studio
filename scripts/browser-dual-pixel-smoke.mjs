import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright-core'
import {execFileSync} from 'node:child_process'

const out='D:/0/ArtEquation-Tests/2026-10-11-browser-dual/pixels-'+Date.now()
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
const report={scope:'Actual rebuilt WASM in browser WebGPU; small supported mixed subset. Test-only screenshot/readback. No app workflow, WebView2 EXE, full-500 coverage, FPS or 4K claim.',fixtureSha256:sha(fixtureBytes),wasmSha256:sha(resources.get('/module.wasm').bytes),checks:[],errors:[]}
let browser
try{
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
 const page=await browser.newPage({viewport:{width:1920,height:900}})
 page.on('pageerror',error=>report.errors.push(error.message))
 await page.goto('http://127.0.0.1:'+server.address().port)
 await page.evaluate(async()=>{
  const module=await import('/module.js');await module.default({module_or_path:'/module.wasm'});const fixture=await fetch('/fixture').then(r=>r.json())
  const canvas=document.querySelector('canvas');canvas.width=fixture.width;canvas.height=fixture.height
  const renderer=new module.B4SurfaceRenderer();const adapter=JSON.parse(await renderer.initialize(canvas));const support=JSON.parse(await renderer.enable_hybrid())
  for(let i=0;i<fixture.resources.length;i++)renderer.register_image(JSON.stringify(fixture.resources[i].reference),new Uint8Array(await fetch('/pixels/'+i).then(r=>r.arrayBuffer())))
  window.probe={renderer,fixture,adapter,support,canvas}
  window.paint=async(policy,id,dx=0,dy=0,width=fixture.width,height=fixture.height,gradient=false)=>{
   const scene=structuredClone(fixture.snapshot);scene.sceneId=id;scene.environment.background='#102131ff'
   if(gradient)scene.operations.push({type:'gradient',id:'gradient-proof',commands:[['M',0,0],['L',80,0],['L',80,80],['L',0,80],['Z']],transform:[1,0,0,1,0,0],brushTransform:[1,0,0,1,0,0],fillRule:'nonzero',gradient:{kind:'linear',start:[0,0],end:[80,0],center:null,radius:null,stops:[{offset:0,color:'#ff0000ff'},{offset:1,color:'#0000ffff'}],interpolation:'srgb',alphaInterpolation:'premultiplied'}})
   renderer.set_render_policy(policy);const view=fixture.view,dpr=fixture.dpr
   const prepared=JSON.parse(await renderer.prepare_snapshot(width,height,JSON.stringify(scene),view.scale*dpr,view.x*dpr+dx,view.y*dpr+dy));const presented=JSON.parse(renderer.present_prepared())
   await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)
   return {prepared,presented}
  }
 })
 report.adapter=await page.evaluate(()=>probe.adapter);report.support=await page.evaluate(()=>probe.support)
 report.classic=await page.evaluate(()=>paint('classic','classic-proof'))
 await page.locator('canvas').screenshot({path:out+'/classic.png'})
 report.hybrid=await page.evaluate(()=>paint('dual-static','hybrid-proof'))
 assert.equal(report.hybrid.prepared.renderEngine,'hybrid-0.2')
 assert.equal(report.hybrid.presented.hybridValidationStatus,'checked')
 assert.equal(report.hybrid.presented.hybridReceipt.hybridImageUploadBytes,0)
 assert.equal(report.hybrid.presented.imageAtlasUploadBytes,report.classic.presented.imageAtlasUploadBytes)
 assert.equal(report.hybrid.presented.imageAtlasAllocatedPages,report.classic.presented.imageAtlasAllocatedPages)
 report.checks.push('Hybrid uses same browser canvas and existing uploaded image pages; actual WebGPU validation passed')
 await page.locator('canvas').screenshot({path:out+'/hybrid.png'})
 report.parity=JSON.parse(execFileSync('python',[path.resolve('scripts/compare-renderer-pixels.py'),out],{encoding:'utf8',windowsHide:true}))
 report.pixelHashes={classic:sha(await fs.readFile(out+'/classic.png')),hybrid:sha(await fs.readFile(out+'/hybrid.png'))}
 assert.ok(report.parity.meanError<2,'Gross pixel mismatch; not an exact-parity qualification')
 report.checks.push('Mixed image/text/path/clip GPU pixels compared; detailed difference retained')
 report.camera=await page.evaluate(()=>paint('classic','hybrid-proof',40,20))
 assert.equal(report.camera.prepared.renderEngine,'classic-0.10');assert.equal(report.camera.prepared.paintMode,'scene-reuse')
 assert.equal(report.camera.presented.imageAtlasUploadBytes,report.hybrid.presented.imageAtlasUploadBytes)
 report.checks.push('Classic camera return reuses scene and image uploads without recreating surface')
 report.resize=await page.evaluate(()=>paint('classic','hybrid-proof',40,20,1280,720))
 assert.equal(report.resize.presented.width,1280);assert.equal(report.resize.presented.height,720)
 report.fallback=await page.evaluate(()=>paint('dual-static','gradient-proof',0,0,1280,720,true))
 assert.equal(report.fallback.prepared.renderEngine,'classic-0.10');assert.match(report.fallback.prepared.hybridDeclined,/gradient/)
 report.checks.push('Resize works; unsupported gradient explicitly uses checked Classic')
 const framesBefore=await page.evaluate(()=>JSON.parse(probe.renderer.resource_stats()))
 await page.waitForTimeout(200)
 report.idle=await page.evaluate(()=>JSON.parse(probe.renderer.resource_stats()));report.idleBefore=framesBefore
 await page.evaluate(()=>{probe.renderer.dispose();probe.renderer.free()})
 assert.deepEqual(report.errors,[]);report.status='BROWSER_GPU_CORRECTNESS_PASS; APP_AND_PERFORMANCE_PENDING'
}catch(error){report.errors.push(String(error));report.status='FAILED_OR_INCOMPLETE';process.exitCode=1}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,status:report.status,checks:report.checks,errors:report.errors,parity:report.parity}))}
