import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright-core'
import {createServer} from 'vite'
const out=path.resolve('output/playwright/image-board-streaming-'+Date.now());await fs.mkdir(out,{recursive:true})
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const report={scope:'Controlled production streaming/compiler/worker and actual Vello CPU pixels. Not native app or sustained 4K qualification.'}
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(server.resolvedUrls.local[0])
 report.result=await page.evaluate(async()=>{
  const {createEngineScenePaint}=await import('/src/project-b/p0-surface/engineScenePaint.ts')
  const {createRetainedTextShape}=await import('/src/project-b/p0-surface/retainedTextShape.ts')
  const {ModelTileStream}=await import('/src/project-b/p0-surface/modelTileStream.ts')
  const {DecodedImageRegistry}=await import('/src/canvas-engine/decodedImageRegistry.ts')
  const {CanvasResourceBudget,canvasResourceBudget}=await import('/src/canvas-engine/resourceBudget.ts')
  const {loadVelloEngine}=await import('/src/project-b/p0-surface/backends.ts')
  const {modelImageSourceIdentity,decodeModelImage}=await import('/src/project-b/p0-surface/modelImageDecode.ts')
  const checks=[],check=(name,value)=>{if(!value)throw Error(name);checks.push(name)}
  const cache=createRetainedTextShape();let shapes=0
  const host={shape:request=>{shapes++;const r=JSON.parse(request);return JSON.stringify({completePaint:true,width:10,height:20,operations:[{type:'vector',object:{id:r.id+':glyph:0',transform:r.transform,opacity:1,payload:{commands:[['M',0,0],['L',1,1]]}}}]})}}
  const base={id:'label-a',revision:'1',text:'same label',fontEpoch:'fonts-1',maxWidth:100,spans:[{fonts:[{key:'face',revision:'sha-a'}]}],transform:[1,0,0,1,10,20]}
  const a=cache.shape(host,base);a.operations[0].object.opacity=.2
  const b=cache.shape(host,{...base,id:'label-b',revision:'9',transform:[0,1,-1,0,50,60]})
  check('same text/font/layout shapes once across identities and placement',shapes===1&&b.operations[0].object.id==='label-b:glyph:0')
  check('cached outlines preserve rotation and isolate mutable opacity',JSON.stringify(b.operations[0].object.transform)==='[0,1,-1,0,50,60]'&&b.operations[0].object.opacity===1)
  cache.shape(host,{...base,maxWidth:101});cache.shape(host,{...base,spans:[{fonts:[{key:'face',revision:'sha-b'}]}]})
  check('font revision and wrapping width revoke shaped cache',shapes===3);cache.dispose()
  const frame={x:0,y:0,width:1024,height:512},pyramid={schemaVersion:1,generator:'controlled',sourceSha256:'stream-fixture',width:1024,height:512,tileSize:512,overlap:1,maxLevel:10,format:'png',tilesRelativePath:'projects/p/assets/pyramids/a/image_files',posterRelativePath:'projects/p/assets/pyramids/a/poster.png',manifestRelativePath:'projects/p/assets/pyramids/a/manifest.json',tileCount:1,generatedBytes:0,displayColorSpace:'srgb'}
  const object={id:'image',kind:'raster',revision:1,order:0,zIndex:0,bounds:frame,localBounds:frame,locked:false,hidden:false,appearance:{opacity:1,rotation:0},modelArtwork:{kind:'image',source:'source.png',sourceRevision:1,sourceDimensions:{width:1024,height:512},pyramid,tilesSource:location.origin+'/stream-fixture'}}
  check('shared exact source interns across board object IDs',modelImageSourceIdentity({...object,modelArtwork:{...object.modelArtwork,pyramid:undefined}})===modelImageSourceIdentity({...object,id:'copy',modelArtwork:{...object.modelArtwork,pyramid:undefined}}))
  const many=Array.from({length:140},(_,i)=>({...object,modelArtwork:{...object.modelArtwork,source:'data:image/png;base64,'+'x'.repeat(1000)+i}})),firstIdentity=modelImageSourceIdentity(many[0]);many.forEach(modelImageSourceIdentity)
  check('long source identity survives more than 128 visible sources',modelImageSourceIdentity(many[0])===firstIdentity)
  const huge='data:image/png;base64,'+'x'.repeat(4*1024*1024+1),hugeA={...object,modelArtwork:{...object.modelArtwork,source:huge}},hugeB={...object,modelArtwork:{...object.modelArtwork,source:huge+'y'}}
  check('oversized changed source never aliases the same object ID',modelImageSourceIdentity(hugeA)!==modelImageSourceIdentity(hugeB)&&modelImageSourceIdentity(hugeA)===modelImageSourceIdentity(hugeA))
  const scene={id:'stream-board',revision:1,objects:[object],connections:[],environment:{background:'#00000000',colorSpace:'srgb'}},view={x:0,y:0,scale:1}
  const vectors={ids:new Set(),json:JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,operations:[],resources:[]})}
  const originalFetch=window.fetch,requests=[];let unlockSharp;const sharpGate=new Promise(resolve=>{unlockSharp=resolve})
  const original=document.createElement('canvas');original.width=1024;original.height=512;const ox=original.getContext('2d');ox.fillStyle='#37d5b5';ox.fillRect(0,0,512,512);ox.fillStyle='#ffd269';ox.fillRect(512,0,512,512)
  window.fetch=async(input,options)=>{
   const url=String(input);if(!url.includes('/stream-fixture/'))return originalFetch(input,options)
   const match=/\/(\d+)\/(\d+)_(\d+)\.png/.exec(url);if(!match)throw Error('fixture URL')
   const [level,col,row]=match.slice(1).map(Number);requests.push({level,col,row})
   if(level===10)await Promise.race([sharpGate,new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))])
   const factor=2**(10-level),w=Math.ceil(1024/factor),h=Math.ceil(512/factor),left=col?1:0,top=row?1:0,coreW=Math.min(512,w-col*512),coreH=Math.min(512,h-row*512)
   const tile=document.createElement('canvas');tile.width=coreW+left+Number((col+1)*512<w);tile.height=coreH+top+Number((row+1)*512<h)
   tile.getContext('2d').drawImage(original,(col*512-left)*factor,(row*512-top)*factor,tile.width*factor,tile.height*factor,0,0,tile.width,tile.height)
   const blob=await new Promise(resolve=>tile.toBlob(resolve,'image/png'));return new Response(blob,{status:200,headers:{'content-type':'image/png'}})
  }
  const notifications=[],compiler=createEngineScenePaint(()=>undefined,ids=>notifications.push([...ids]))
  const capture=()=>compiler.capture(scene,view,vectors,0,()=>true,undefined,()=>true,{width:1024,height:512},1)
  try{
   const preview=await capture();check('complete preview returns before sharp tile IO resolves',preview.ids.size===1&&preview.imageDetail.image.state==='refining'&&preview.images.every(u=>u.reference.width<=256))
   check('visible sharp streaming uses at most two lanes',compiler.stats().stream.active<=2)
   preview.stage();preview.present();preview.release();unlockSharp()
   for(let i=0;i<200&&(compiler.stats().stream.active||compiler.stats().stream.queued);i++)await new Promise(resolve=>setTimeout(resolve,10))
   check('sharp completion requests an independent presentation',notifications.some(ids=>ids.includes('image')))
   const sharp=await capture();check('only required fully resident detail earns sharp state',sharp.imageDetail.image.state==='sharp'&&sharp.imageDetail.image.ready===2&&sharp.images.length===2)
   const engine=await loadVelloEngine(),cpu=new engine.B4CpuRenderer();for(const u of sharp.images)cpu.register_image(JSON.stringify(u.reference),u.pixels)
   const pixels=cpu.render_snapshot(1024,512,sharp.json,1,0,0),colour=(x,y)=>Array.from(pixels.slice((y*1024+x)*4,(y*1024+x)*4+4))
   check('sharp tiled pixels retain source colour on both sides of seam',JSON.stringify(colour(511,200))==='[55,213,181,255]'&&JSON.stringify(colour(512,200))==='[255,210,105,255]');cpu.free()
   sharp.stage();sharp.present();sharp.release();const before=requests.length
   const pan=await compiler.capture(scene,{...view,x:5},vectors,0,()=>true,undefined,()=>true,{width:1024,height:512},1);pan.stage();pan.present();pan.release()
   check('warm pan reuses decoded tiles without fetching again',requests.length===before)
   const empty=await compiler.capture({...scene,id:'other',objects:[]},view,vectors,0,()=>true,undefined,()=>true,{width:1024,height:512},1);empty.stage();empty.present();empty.release()
   check('inactive decoded warm resources stay bounded and evictable',compiler.stats().idleBytes<=8*1024*1024&&compiler.stats().stream.pinned===0)
   const returned=await capture();returned.stage();returned.present();returned.release();check('return to same source avoids repeat tile IO',requests.length===before)
  }finally{compiler.dispose();window.fetch=originalFetch;unlockSharp()}
  const versionRegistry=new DecodedImageRegistry(776),versions=[]
  for(const sourceRevision of [1,2])versions.push(await decodeModelImage({...object,modelArtwork:{kind:'image',source:original.toDataURL(),sourceRevision,sourceDimensions:{width:1024,height:512}}},versionRegistry,()=>true))
  check('different asset revisions of one source coexist without stale-reference rejection',versions[0].reference.key!==versions[1].reference.key&&versions.every(upload=>versionRegistry.resolve(upload.reference).pixels.length>0));versionRegistry.dispose()
  const registry=new DecodedImageRegistry(777),pending=[],cancelled=[]
  const streamer=new ModelTileStream(registry,(obj,tile,signal)=>new Promise((resolve,reject)=>{pending.push(tile.key);signal.addEventListener('abort',()=>{cancelled.push(tile.key);reject(Error('cancelled'))},{once:true})}),()=>{})
  const tiles=Array.from({length:3},(_,col)=>({key:'10/'+col+'_0.png',level:10,col,row:0,x:col*2,y:0,width:2,height:2,pixelWidth:2,pixelHeight:2,left:0,top:0,coreWidth:2,coreHeight:2}))
  const demandRegistry=new DecodedImageRegistry(781);let sharedAbort=false
  const demandStream=new ModelTileStream(demandRegistry,(_,tile,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{sharedAbort=true;reject(Error('cancelled'))},{once:true})),()=>{})
  const ownerIds=Array.from({length:10000},(_,i)=>'owner-'+i)
  demandStream.begin('shared-demand',new Set(ownerIds))
  for(const id of ownerIds)demandStream.update({...object,id},[tiles[0]],[],[])
  const sharedJob=demandStream.request({...object,id:ownerIds[0]},tiles[0],300).catch(String)
  const demandVisits=demandStream.stats().demandKeyVisits
  demandStream.update({...object,id:ownerIds[0]},[tiles[1]],[],[])
  check('one card update visits two tile keys with 10000 demand owners',demandStream.stats().demandKeyVisits-demandVisits===2&&demandStream.stats().wanted===2)
  check('shared tile IO survives removal of one owner',!sharedAbort)
  demandStream.begin('shared-demand',new Set([ownerIds[0]]));await sharedJob
  check('shared tile IO aborts only after its last owner leaves',sharedAbort&&demandStream.stats().wanted===1)
  demandStream.dispose();demandRegistry.dispose()
  streamer.begin('a',new Set(['image']));streamer.update(object,tiles,[],[])
  const one=streamer.request(object,tiles[0],300),duplicate=streamer.request(object,tiles[0],300);check('identical in-flight tile requests share one job',one===duplicate)
  const all=[one,streamer.request(object,tiles[1],300),streamer.request(object,tiles[2],300)].map(p=>p.catch(e=>String(e)))
  check('queue bounds active IO to two requests',pending.length===2&&streamer.stats().queued===1)
  streamer.begin('b',new Set());await Promise.all(all);await new Promise(resolve=>setTimeout(resolve,0))
  check('board switch aborts active IO and removes queued requests',cancelled.length===2&&streamer.stats().active===0&&streamer.stats().queued===0);streamer.dispose();registry.dispose()
  const raceRegistry=new DecodedImageRegistry(780);let raceLoads=0
  const raceStream=new ModelTileStream(raceRegistry,(_,tile,signal)=>{raceLoads++;if(raceLoads===1)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>setTimeout(()=>reject(Error('cancelled')),10),{once:true}));return Promise.resolve(raceRegistry.register(raceStream.reference(object,tile),new Uint8Array(16)))},()=>{})
  raceStream.begin('first',new Set(['image']));raceStream.update(object,[tiles[0]],[],[]);const obsolete=raceStream.request(object,tiles[0],1000).catch(String)
  raceStream.begin('away',new Set());raceStream.begin('first',new Set(['image']));raceStream.update(object,[tiles[0]],[],[]);await raceStream.request(object,tiles[0],1000);await obsolete
  check('immediate board return retries an aborting preview instead of inheriting cancellation',raceLoads===2&&!!raceStream.resolve(object,tiles[0]));raceStream.dispose();raceRegistry.dispose()
  const queueRegistry=new DecodedImageRegistry(779),releases=[],retryIds=[]
  const queueStream=new ModelTileStream(queueRegistry,(_,tile,signal)=>new Promise((resolve,reject)=>{releases.push(reject);signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})}),ids=>retryIds.push(...ids))
  const manyTiles=Array.from({length:65},(_,i)=>({...tiles[0],key:'10/'+i+'_0.png',col:i}));queueStream.begin('queue',new Set(['image']));queueStream.update(object,manyTiles,[],[])
  const queuePromises=manyTiles.map(tile=>queueStream.request(object,tile,300).catch(String));await queuePromises[64]
  check('queue admission limit is exposed as a detail error',queueStream.error(object,[manyTiles[64]])==='MODEL_TILE_QUEUE_LIMIT'&&queueStream.stats().queued===62)
  releases[0](Error('controlled completion'));await new Promise(resolve=>setTimeout(resolve,0))
  check('freed streaming slot clears admission error and requests retry',!queueStream.error(object,[manyTiles[64]])&&retryIds.includes('image'))
  queueStream.begin('done',new Set());await Promise.all(queuePromises);queueStream.dispose();queueRegistry.dispose()
  const budget=new CanvasResourceBudget({total:64,pools:{retained:64,'tile-surface':64,'tile-atlas':64}}),warm=new DecodedImageRegistry(778,budget,64)
  const ref={key:'warm',revision:1,epoch:778,width:2,height:2};warm.register(ref,new Uint8Array(16));warm.retirePresentation();check('warm image occupies an unpinned accounted lease',warm.stats().idleBytes===32)
  const pressure=budget.acquire({owner:{},key:'foreground',pool:'retained',bytes:48,pinned:true});check('foreground pressure evicts warm cache without stale bytes',!!pressure&&warm.stats().bytes===0);pressure.release();warm.dispose()
  return {checks,requests,notifications,budget:canvasResourceBudget.snapshot()}
 })
 assert.deepEqual(errors,[]);report.pass=true
}catch(error){report.pass=false;report.error=String(error);throw error}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();await server.close();console.log(JSON.stringify({pass:report.pass,checks:report.result?.checks.length,out,error:report.error}))}
