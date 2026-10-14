import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright-core'
import {createServer} from 'vite'
const out=path.resolve('output/playwright/heavy-board-residency-'+Date.now());await fs.mkdir(out,{recursive:true})
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const report={scope:'Actual scene compiler, worker decode, registry and CPU pixels; 24 large originals. Controlled correctness/resource test, not app FPS or native/4K acceptance.',checks:[]}
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(server.resolvedUrls.local[0])
 report.result=await page.evaluate(async()=>{
  const {createEngineScenePaint}=await import('/src/project-b/p0-surface/engineScenePaint.ts')
  const {DecodedImageRegistry}=await import('/src/canvas-engine/decodedImageRegistry.ts')
  const {CanvasResourceBudget,canvasResourceBudget}=await import('/src/canvas-engine/resourceBudget.ts')
  const {decodeModelImage}=await import('/src/project-b/p0-surface/modelImageDecode.ts')
  const {modelImageWorkerSnapshot}=await import('/src/board/preparationWorkers.ts')
  const {loadVelloEngine}=await import('/src/project-b/p0-surface/backends.ts')
  const checks=[],check=(name,value)=>{if(!value)throw Error(name);checks.push(name)}
  const c=document.createElement('canvas');c.width=2048;c.height=1024;const x=c.getContext('2d')
  const objects=[]
  for(let i=0;i<24;i++){
   x.fillStyle=i%2?'#ffd269':'#37d5b5';x.fillRect(0,0,c.width,c.height)
   const frame={x:(i%6)*165,y:Math.floor(i/6)*85,width:160,height:80}
   objects.push({id:'image-'+i,kind:'raster',revision:1,order:i,zIndex:i,bounds:frame,localBounds:frame,locked:false,hidden:false,appearance:{opacity:1,rotation:0},modelArtwork:{kind:'image',source:c.toDataURL(),sourceRevision:1,sourceDimensions:{width:2048,height:1024}}})
  }
  const scene={id:'heavy',revision:1,objects,connections:[],environment:{background:'#00000000',colorSpace:'srgb'}}
  const vectors={ids:new Set(),json:JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,operations:[],resources:[]})}
  const compiler=createEngineScenePaint(),view={x:0,y:0,scale:1},capture=s=>compiler.capture(s,view,vectors,0,()=>true,undefined,()=>true,{width:1024,height:600},1)
  let paint=await capture(scene)
  if(Object.keys(paint.blockers).length)throw Error(JSON.stringify(paint.blockers))
  check('24 original images accepted without missing contributions',paint.ids.size===24&&Object.keys(paint.blockers).length===0)
  check('bounded decode lanes expose no leftover jobs',modelImageWorkerSnapshot().workers<=2&&modelImageWorkerSnapshot().queued===0&&modelImageWorkerSnapshot().workingBytes===0)
  check('density bucket preserves physical pixel demand',paint.images.every(i=>i.reference.width===256&&i.reference.height===128))
  paint.present();const firstStats=compiler.stats(),completed=modelImageWorkerSnapshot().completed
  check('resident bytes bounded despite 384 MiB full-source decoded demand',firstStats.bytes<8*1024*1024)
  const pan=await compiler.capture(scene,{...view,x:30,y:17},vectors,0,()=>true,undefined,()=>true,{width:1024,height:600},1)
  check('pan reuses exact paint and performs no image jobs',pan.json===paint.json&&modelImageWorkerSnapshot().completed===completed)
  pan.release();paint.release()
  const moved={...scene,revision:2,objects:objects.map((o,i)=>i?o:{...o,revision:2,bounds:{...o.bounds,x:o.bounds.x+7},localBounds:{...o.localBounds,x:o.localBounds.x+7}})}
  paint=await capture(moved)
  check('one moved image translates without image decode',modelImageWorkerSnapshot().completed===completed&&JSON.parse(paint.json).operations.find(o=>o.type==='image'&&o.id==='image-0').transform[4]===7)
  paint.present();paint.release()
  // Old pixels remain held until outstanding snapshot transport retires.
  const zoom=await compiler.capture({...scene,objects:[objects[0]]},{...view,scale:8},vectors,0,()=>true,undefined,()=>true,{width:1024,height:600},1)
  check('zoom requests full sharp source pixels',zoom.images[0].reference.width===2048&&zoom.images[0].reference.height===1024)
  zoom.present()
  const engine=await loadVelloEngine(),cpu=new engine.B4CpuRenderer()
  for(const u of zoom.images)cpu.register_image(JSON.stringify(u.reference),u.pixels)
  const pixels=cpu.render_snapshot(160,80,zoom.json,1,0,0)
  check('worker pixels retain original opaque colour',pixels[3]===255&&Math.abs(pixels[0]-55)<=1&&Math.abs(pixels[1]-213)<=1&&Math.abs(pixels[2]-181)<=1)
  cpu.free();zoom.release()
  const empty={...scene,id:'empty-board',objects:[]}
  paint=await capture(empty);paint.present();paint.release()
  check('inactive-board decoded pixels and cards released',compiler.stats().bytes===0&&compiler.stats().retainedCards===0)
  for(let i=0;i<6;i++){paint=await capture({...scene,id:'switch-'+i,objects:objects.slice(i,i+1)});check('board switch '+i+' complete',paint.ids.size===1);paint.present();paint.release()}
  const budget=new CanvasResourceBudget({total:100,pools:{retained:100,'tile-surface':100,'tile-atlas':100}}),registry=new DecodedImageRegistry(999,budget)
  let fetches=0;const originalFetch=window.fetch;window.fetch=(...args)=>{fetches++;return originalFetch(...args)}
  try{
   for(let i=0;i<2;i++)await decodeModelImage(objects[0],registry,()=>true,view,1).then(()=>{throw Error('Expected admission failure')},e=>check('visible capacity error '+i,String(e).includes('RESOURCE_BUDGET_EXCEEDED')))
   check('rejected admission never fetches/redecodes',fetches===0)
  }finally{window.fetch=originalFetch;registry.dispose()}
  const last=compiler.stats();compiler.dispose();c.width=0;c.height=0
  return {checks,firstStats,last,worker:modelImageWorkerSnapshot(),budget:canvasResourceBudget.snapshot()}
 })
 assert.deepEqual(errors,[]);report.checks=report.result.checks;report.pass=true
}catch(error){report.pass=false;report.error=String(error);throw error}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();await server.close();console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,out,error:report.error}))}
