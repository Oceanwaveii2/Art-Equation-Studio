import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright-core'
import {createServer} from 'vite'
// Isolated experiment using the already pinned sparse-strip Vello CPU path.
// New upstream vello_gpu is deliberately not substituted into production.
const out=path.resolve('output/playwright/sparse-strip-reuse-'+Date.now());await fs.mkdir(out,{recursive:true})
const native=await new Promise((resolve,reject)=>{const child=execFile('D:/0/AE2Target-20261007/release/examples/audit-font-resolver.exe',[],{windowsHide:true,timeout:20000,maxBuffer:64*1024*1024},(error,stdout)=>error?reject(error):resolve(JSON.parse(stdout)));child.stdin.end(JSON.stringify({command:'resolve_system_font',request:{family:'Segoe UI',weight:400,italic:false}}))})
assert.equal(createHash('sha256').update(Buffer.from(native.bytesBase64,'base64')).digest('hex'),native.contentHash)
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const report={scope:'Isolated pinned Vello CPU sparse-strip rendering with actual native font bytes. Outlined-shape reuse comparison, not new upstream GPU integration or native/4K performance qualification.',font:{family:native.resolvedFamily,hash:native.contentHash,faceIndex:native.faceIndex}}
try{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0])
 report.result=await page.evaluate(async font=>{
  const {loadVelloEngine}=await import('/src/project-b/p0-surface/backends.ts')
  const {createRetainedTextShape}=await import('/src/project-b/p0-surface/retainedTextShape.ts')
  const engine=await loadVelloEngine(),host=new engine.TextEngine('reuse-experiment'),bytes=Uint8Array.from(atob(font.bytesBase64),c=>c.charCodeAt(0))
  host.register_font('face',font.contentHash,font.faceIndex,bytes)
  const requests=Array.from({length:24},(_,index)=>({schema:'art-equation.shaped-text',schemaVersion:1,layoutAuthority:'model',id:'label-'+index,revision:'1',fontEpoch:'reuse-experiment',text:'Shared graph label',maxWidth:180,wrapMode:'nowrap',overflowWrap:'normal',alignment:'left',baseDirection:'ltr',maxCommands:16384,transform:[1,0,0,1,10+(index%4)*190,10+Math.floor(index/4)*50],spans:[{start:0,end:18,fonts:[{key:'face',revision:font.contentHash}],fontSize:14,fontWeight:400,fontStyle:'normal',lineHeight:1.2,letterSpacing:0,color:'#ffffffff'}]}))
  const cache=createRetainedTextShape();let calls=0;const counted={shape:request=>{calls++;return host.shape(request)}}
  const start=performance.now(),uncached=requests.flatMap(request=>JSON.parse(counted.shape(JSON.stringify(request))).operations),uncachedShapeMs=performance.now()-start,uncachedCalls=calls
  calls=0;const cachedStart=performance.now(),cached=requests.flatMap(request=>cache.shape(counted,request).operations),cachedShapeMs=performance.now()-cachedStart,cachedCalls=calls
  const render=operations=>{const cpu=new engine.B4CpuRenderer(),before=performance.now();const pixels=cpu.render_snapshot(800,320,JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,sceneId:'reuse-experiment',revision:'1',environment:{background:'#00000000',colorSpace:'srgb'},operations,resources:[]}),1,0,0);const ms=performance.now()-before;cpu.free();return {pixels,ms}}
  const a=render(uncached),b=render(cached)
  if(a.pixels.length!==b.pixels.length||a.pixels.some((value,index)=>value!==b.pixels[index]))throw Error('REUSE_PIXEL_MISMATCH')
  if(uncachedCalls!==24||cachedCalls!==1)throw Error('REUSE_CALL_COUNT')
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a.pixels))).map(value=>value.toString(16).padStart(2,'0')).join('')
  const stats=cache.stats();cache.dispose();host.free()
  return {labels:24,uncachedCalls,cachedCalls,uncachedShapeMs,cachedShapeMs,uncachedRasterMs:a.ms,cachedRasterMs:b.ms,pixelParity:true,pixelSha256:hash,cache:stats,limits:'One controlled run; cold/warm asymmetry and CPU raster measurements are not GPU or app pacing evidence.'}
 },native)
 report.pass=true
}catch(error){report.pass=false;report.error=String(error);throw error}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();await server.close();console.log(JSON.stringify({pass:report.pass,out,result:report.result,error:report.error}))}
