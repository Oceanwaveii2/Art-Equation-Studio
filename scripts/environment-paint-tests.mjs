import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {chromium} from 'playwright-core'
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false}})
await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
try {
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0])
 const result=await page.evaluate(async()=>{
  const {withEnvironmentPaint,environmentPaint}=await import('/src/canvas-engine/environmentPaint.ts')
  const {loadVelloEngine}=await import('/src/project-b/p0-surface/backends.ts')
  const cpu=new (await loadVelloEngine()).B4CpuRenderer()
  const empty={schema:'art-equation.display-list',schemaVersion:2,sceneId:'grid',revision:'1',environment:{background:'#00000000',colorSpace:'srgb'},operations:[],resources:[]}
  const env={background:'#000000',grid:{visible:true,color:'#00ffff',opacity:1,spacing:16}}
  const sample=(view,x,y)=>{const list=withEnvironmentPaint(empty,env,view,{width:64,height:64});const pixels=cpu.render_snapshot(64,64,JSON.stringify(list),view.scale,view.x,view.y);return Array.from(pixels.slice((y*64+x)*4,(y*64+x)*4+4))}
  const line=sample({x:0,y:0,scale:1},16,7),gap=sample({x:0,y:0,scale:1},7,7),pan=sample({x:5,y:3,scale:1},21,10),zoom=sample({x:0,y:0,scale:2},32,7)
  const hidden=environmentPaint({...env,grid:{...env.grid,visible:false}},{x:0,y:0,scale:1},{width:64,height:64}).length
  const dense=environmentPaint({...env,grid:{...env.grid,spacing:.001}},{x:0,y:0,scale:.001},{width:64,height:64}).reduce((n,o)=>n+o.object.payload.commands.length,0)
  const fractional=[]
  for(const dpr of [1,1.5,2])for(const panX of [0,.2,.4,.6,.8]){
   const view={x:panX,y:.3,scale:1},size=64*dpr
   const list=withEnvironmentPaint(empty,env,view,{width:64,height:64},dpr)
   const pixels=cpu.render_snapshot(size,size,JSON.stringify(list),dpr,panX*dpr,.3*dpr)
   const y=Math.floor(7*dpr),row=[]
   for(let x=Math.floor(13*dpr);x<Math.ceil(20*dpr);x++)row.push(pixels[(y*size+x)*4+1])
   fractional.push({dpr,panX,peak:Math.max(...row),sum:row.reduce((a,b)=>a+b,0)})
  }
  const distant=[]
  for(const scale of [.01,.025,.05,.1,.2,.374,.375,.376,.5,.749,.75,.751,1]){
   const view={x:3.2,y:4.4,scale}
   const pixels=cpu.render_snapshot(64,64,JSON.stringify(withEnvironmentPaint(empty,env,view,{width:64,height:64})),scale,view.x,view.y)
   let lit=0,peak=0
   for(let i=1;i<pixels.length;i+=4){peak=Math.max(peak,pixels[i]);if(pixels[i]>40)lit++}
   distant.push({scale,lit,peak})
  }
  cpu.free();return {line,gap,pan,zoom,hidden,dense,fractional,distant}
 })
 for(const key of ['line','pan','zoom'])assert.ok(result[key][1]>40,key+' actual Vello grid pixels')
 assert.deepEqual(result.gap,[0,0,0,255]);assert.equal(result.hidden,0);assert.ok(result.dense<=132)
 for(const dpr of [1,1.5,2]){
  const rows=result.fractional.filter(row=>row.dpr===dpr)
  assert.ok(Math.max(...rows.map(row=>row.peak))-Math.min(...rows.map(row=>row.peak))<=1,'fractional pan preserves grid peak brightness at DPR '+dpr)
  assert.ok(Math.max(...rows.map(row=>row.sum))-Math.min(...rows.map(row=>row.sum))<=2,'fractional pan preserves grid coverage at DPR '+dpr)
 }
 for(const row of result.distant){assert.ok(row.lit>200,'grid stays visible at '+row.scale);assert.ok(row.lit<1000,'distant grid avoids dense aliasing at '+row.scale);assert.ok(row.peak>=199,'stable line brightness at '+row.scale)}
 console.log('Engine grid PASS: Vello CPU pixels, pan, zoom, hidden and bounded dense spacing',JSON.stringify(result))
}finally{await browser.close();await server.close()}
