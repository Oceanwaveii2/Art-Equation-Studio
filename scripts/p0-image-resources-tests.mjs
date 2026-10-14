import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const paths=['src/canvas-engine/decodedImageRegistry.ts','src/canvas-engine/resourceBudget.ts','src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm','src/board/velloEligibility.ts','src/project-b/p0-surface/mixedPaint.ts']
const sources=await Promise.all(paths.map(path=>readFile(path)))
const url=text=>`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile=source=>ts.transpileModule(source.toString(),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const demandUrl=url(compile(await readFile('src/canvas-engine/imageDemand.ts')))
const registrySource=compile(sources[0]).replace(/from ['"]\.\/imageDemand['"]/g,`from '${demandUrl}'`)
const budgetUrl=url(compile(sources[1]))
const {CanvasResourceBudget}=await import(budgetUrl)
const {DecodedImageRegistry,frameImageReferences,imageUploads}=await import(url(registrySource.replace(/from ['"]\.\/resourceBudget['"]/g,`from '${budgetUrl}'`)))
const eligibilityUrl=url(compile(sources[3]))
const {assembleCompletePaintList}=await import(url(compile(sources[4]).replace(/from ['"]\.\.\/\.\.\/board\/velloEligibility['"]/g,`from '${eligibilityUrl}'`).replace(/from ['"]\.\.\/\.\.\/canvas-engine\/decodedImageRegistry['"]/g,`from '${url(registrySource.replace(/from ['"]\.\/resourceBudget['"]/g,`from '${budgetUrl}'`))}'`)))
const wasm=await import(pathToFileURL(resolve('src/project-b/p0-surface/generated/p0_engine_wasm.js')))
const initialized=wasm.initSync({module:sources[2]})
const checks=[]
const check=(name,body)=>{body();checks.push({name,passed:true})}
const ref=(revision=1,extra={})=>({key:'pixels',revision,epoch:19,width:2,height:1,...extra})
const list=(resources,operations=[])=>JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,sceneId:'image-acceptance',revision:'1',environment:{background:'#00000000',colorSpace:'srgb'},resources,operations})
const image=(resource,extra={})=>({type:'image',id:'content',resource,sourceRect:{x:0,y:0,width:resource.width,height:resource.height},transform:[1,0,0,1,0,0],opacity:1,sampling:'nearest',...extra})
const pixel=(pixels,width,x,y)=>[...pixels.slice((y*width+x)*4,(y*width+x+1)*4)]
const stats=renderer=>{const receipt=JSON.parse(renderer.resource_stats());return {...receipt.decoded,cpuImageBytes:receipt.cpuPixmapBytes}}
const budget=bytes=>new CanvasResourceBudget({total:bytes,pools:{retained:bytes,'tile-surface':bytes,'tile-atlas':bytes}})

check('immutable canonical premultiplication refuses exposed transport mutation',()=>{
 const b=budget(1024),r=new DecodedImageRegistry(19,b),source=new Uint8Array([200,100,50,128,255,0,0,0])
 const upload=r.register(ref(),source);source.fill(0)
 assert.deepEqual([...upload.pixels],[100,50,25,128,0,0,0,0]);assert.equal(b.snapshot().bytes,16)
 upload.pixels[0]=7;assert.throws(()=>r.resolve(ref()),/REVISION_CONFLICT/)
 assert.throws(()=>imageUploads([ref()],[upload]),/REVISION_CONFLICT/);r.dispose();assert.equal(b.snapshot().bytes,0)
})
check('failed image admission is transactional and can recover after unrelated release',()=>{
 const b=budget(16),pin=b.acquire({owner:{},key:'external',pool:'retained',bytes:8,pinned:true}),r=new DecodedImageRegistry(19,b)
 assert.throws(()=>r.register(ref(),new Uint8Array(8)),/BUDGET_EXCEEDED/);assert.equal(r.stats().count,0);assert.equal(b.snapshot().bytes,8)
 pin.release();r.register(ref(),new Uint8Array(8));assert.equal(b.snapshot().bytes,16);r.dispose();assert.equal(b.snapshot().bytes,0)
})
check('pending failures preserve visible revision; accepted replacement retires its pixels',()=>{
 const b=budget(128),r=new DecodedImageRegistry(19,b),p=new Uint8Array(8)
 r.register(ref(),p);r.stage([ref()]);r.present();r.register(ref(2),p);r.stage([ref(2)]);r.discard()
 assert.equal(r.resolve(ref()).pixels.length,8);assert.throws(()=>r.resolve(ref(2)),/NOT_READY/)
 r.register(ref(3),p);r.stage([ref(3)]);r.present();assert.throws(()=>r.resolve(ref()),/NOT_READY/);assert.throws(()=>r.register(ref(2),p),/STALE_REVISION/)
 assert.equal(b.snapshot().bytes,16);r.stage([]);r.present();assert.equal(b.snapshot().bytes,0);r.dispose()
})
check('reference/upload schema refuses mixed epochs, aliases, dimensions and duplicate declarations',()=>{
 for(const references of [[ref(),ref()],[ref(),ref(2,{epoch:20})],[ref(1,{width:4097})],[{...ref(),unknown:true}]]) assert.throws(()=>frameImageReferences(list(references)),/RESOURCE_/)
 assert.throws(()=>imageUploads([ref()],[{reference:ref(),pixels:new Uint8Array(7)}]),/RESOURCE_INVALID/)
 assert.throws(()=>imageUploads([ref()],[{reference:ref(2),pixels:new Uint8Array(8)}]),/RESOURCE_INVALID/)
})
check('superseded transport pins retain their bytes until the asynchronous consumer settles',()=>{
 const b=budget(64),r=new DecodedImageRegistry(19,b),p=new Uint8Array(8)
 r.register(ref(),p);const hold=r.retain([ref()]);r.stage([ref()]);r.present()
 r.register(ref(2),p);r.stage([ref(2)]);r.present();assert.equal(b.snapshot().bytes,32)
 assert.equal(r.resolve(ref()).pixels.length,8);hold.release();assert.equal(b.snapshot().bytes,16)
 assert.throws(()=>r.resolve(ref()),/NOT_READY/);hold.release();r.dispose();assert.equal(b.snapshot().bytes,0)
})
check('real WASM CPU image pixels preserve crop, opacity, translation and source immutability',()=>{
 const r=new wasm.B4CpuRenderer(),p=new Uint8Array([255,0,0,255,0,128,0,128])
 try {r.register_image(JSON.stringify(ref()),p);p.fill(0)
  const output=r.render_snapshot(8,4,list([ref()],[image(ref(),{sourceRect:{x:1,y:0,width:1,height:1},transform:[2,0,0,2,2,1],opacity:.5})]),1,0,0)
  assert.deepEqual(pixel(output,8,4,1),[0,255,0,64]);assert.deepEqual(pixel(output,8,3,1),[0,0,0,0]);assert.equal(stats(r).bytes,8);assert.equal(stats(r).cpuImageBytes,8)
 } finally {r.dispose();assert.equal(stats(r).bytes,0);r.free()}
})
check('real WASM CPU rejects missing resource before output and replaces versions atomically',()=>{
 const r=new wasm.B4CpuRenderer()
 try {r.register_image(JSON.stringify(ref()),new Uint8Array([255,0,0,255,255,0,0,255]));r.render_snapshot(2,1,list([ref()],[image(ref())]),1,0,0)
  assert.throws(()=>r.render_snapshot(2,1,list([ref(2)],[image(ref(2))]),1,0,0),/RESOURCE_NOT_READY/);assert.equal(stats(r).visiblePins,1)
  r.register_image(JSON.stringify(ref(2)),new Uint8Array([0,0,255,255,0,0,255,255]));const output=r.render_snapshot(2,1,list([ref(2)],[image(ref(2))]),1,0,0)
  assert.deepEqual(pixel(output,2,0,0),[0,0,255,255]);assert.equal(stats(r).count,1);assert.equal(stats(r).cpuImageBytes,8)
 } finally {r.dispose();r.free()}
})
check('real WASM shared ordered image clip and isolated opacity change actual pixels',()=>{
 const r=new wasm.B4CpuRenderer(),commands=[['M',0,0],['L',1,0],['L',1,1],['L',0,1],['Z']],scope={scopeId:'clip',commands,transform:[1,0,0,1,0,0],fillRule:'nonzero',isolation:'isolated'}
 try {r.register_image(JSON.stringify(ref()),new Uint8Array([255,0,0,255,0,0,255,255]));const output=r.render_snapshot(2,1,list([ref()],[{type:'pushComposite',...scope,opacity:.5,blendMode:'normal'},image(ref()),{type:'pop',scopeId:'clip'}]),1,0,0)
  assert.deepEqual(pixel(output,2,0,0),[255,0,0,128]);assert.deepEqual(pixel(output,2,1,0),[0,0,0,0])
 } finally {r.dispose();r.free()}
})
check('real WASM gradient interpolates premultiplied sRGB and blur preserves soft exterior',()=>{
 const r=new wasm.B4CpuRenderer(),commands=[['M',0,0],['L',16,0],['L',16,16],['L',0,16],['Z']]
 try {const output=r.render_snapshot(32,24,list([],[{type:'blurredRoundedRect',id:'shadow',rect:{x:8,y:4,width:16,height:16},radius:2,stdDeviation:2,color:'#000000ff',transform:[1,0,0,1,0,0]},{type:'gradient',id:'surface',commands,transform:[1,0,0,1,8,4],brushTransform:[1,0,0,1,0,0],fillRule:'nonzero',gradient:{kind:'linear',start:[0,0],end:[16,0],stops:[{offset:0,color:'#ff0000ff'},{offset:1,color:'#0000ff00'}],interpolation:'srgb',alphaInterpolation:'premultiplied'}}]),1,0,0)
  const left=pixel(output,32,9,12),right=pixel(output,32,22,12),soft=pixel(output,32,6,12)
  assert(left[0]>right[0]);assert.equal(left[2],0);assert(soft[3]>0&&soft[3]<255)
 } finally {r.dispose();r.free()}
})
const sceneObject=(id,order,x,extra={})=>({id,order,kind:'text',revision:1,bounds:{x,y:0,width:10,height:10},appearance:{rotation:0,opacity:1},...extra})
const scene=objects=>({id:'ordered-complete',revision:1,objects,connections:[],environment:{background:'#00000000',grid:{visible:false}}})
const contribution=(object,ownership='card',operations=[],uploads=[])=>({id:object.id,ownership,bounds:object.bounds,operations,uploads})
check('complete cards and vectors keep canonical order and balanced nested scopes',()=>{
 const a=sceneObject('a',3,0),b=sceneObject('b',1,0),c=sceneObject('c',3,0),scope={type:'pushClip',scopeId:'a-clip',commands:[['M',0,0],['L',1,0],['L',1,1],['Z']],transform:[1,0,0,1,0,0],fillRule:'nonzero',isolation:'isolated'}
 const draw=(id,fill)=>({type:'vector',object:{id,kind:'vector',order:0,transform:[1,0,0,1,0,0],payload:{commands:[['M',0,0],['L',1,0],['L',1,1],['L',0,1],['Z']],fill,strokeWidth:0}}}),red=draw('b','#ff0000'),blue=draw('c','#0000ff')
 const result=assembleCompletePaintList(scene([a,b,c]),[contribution(c,'card',[blue]),contribution(a,'card',[scope,{type:'pop',scopeId:'a-clip'}]),contribution(b,'vector',[red])],1)
 assert.deepEqual(result.displayList.operations,[red,scope,{type:'pop',scopeId:'a-clip'},blue]);assert.deepEqual([...result.cardIds],['a','c']);assert.equal(result.ids.size,3)
 const renderer=new wasm.B4CpuRenderer()
 try{assert.deepEqual(pixel(renderer.render_snapshot(1,1,JSON.stringify(result.displayList),1,0,0),1,0,0),[0,0,255,255])}finally{renderer.dispose();renderer.free()}
})
check('uncompiled DOM paint excludes the complete overlapping connected batch',()=>{
 const blocker=sceneObject('dom',0,0),a=sceneObject('a',1,100),b=sceneObject('b',2,108),c=sceneObject('c',3,1000)
 const result=assembleCompletePaintList(scene([blocker,a,b,c]),[a,b,c].map(o=>contribution(o)),1)
 assert.deepEqual([...result.ids],['c']);assert.deepEqual(result.displayList.resources,[])
})
check('complete ownership fails closed for invalid camera, bounds, duplicate or hidden identities',()=>{
 const a=sceneObject('a',1,0),input=scene([a]),paint=contribution(a)
 for(const scale of [0,-1,NaN,Infinity])assert.equal(assembleCompletePaintList(input,[paint],scale).ids.size,0)
 for(const bounds of [{x:0,y:0,width:-1,height:1},{x:NaN,y:0,width:1,height:1}])assert.equal(assembleCompletePaintList(input,[{...paint,bounds}],1).ids.size,0)
 assert.throws(()=>assembleCompletePaintList(input,[paint,paint],1),/identity/)
 assert.throws(()=>assembleCompletePaintList(scene([{...a,hidden:true}]),[paint],1),/identity/)
 assert.throws(()=>assembleCompletePaintList(scene([a,{...a,hidden:true}]),[paint],1),/canonical identity/)
 for(const order of [NaN,Infinity])assert.throws(()=>assembleCompletePaintList(scene([{...a,order}]),[paint],1),/canonical identity\/order/)
})
check('ordered complete image contributions declare exact deduplicated immutable resources',()=>{
 const a=sceneObject('a',1,0),b=sceneObject('b',2,1000),upload={reference:ref(),pixels:new Uint8Array(8)},paint=image(ref())
 const result=assembleCompletePaintList(scene([a,b]),[contribution(a,'card',[paint],[upload]),contribution(b,'card',[paint],[upload])],1)
 assert.deepEqual(result.displayList.resources,[ref()]);assert.deepEqual(result.images,[upload])
 assert.throws(()=>assembleCompletePaintList(scene([a]),[contribution(a,'card',[paint],[])],1),/NOT_READY/)
 assert.throws(()=>assembleCompletePaintList(scene([a,b]),[contribution(a,'card',[paint],[upload]),contribution(b,'card',[paint],[{...upload,pixels:new Uint8Array(8)}])],1),/REVISION_CONFLICT/)
})
check('the generated WASM realm has an enforced 256 MiB linear-memory ceiling',()=>{
 const memory=initialized.memory,pages=268435456/65536,current=memory.buffer.byteLength/65536
 assert(current<pages);memory.grow(pages-current);assert.equal(memory.buffer.byteLength,268435456)
 assert.throws(()=>memory.grow(1),RangeError)
})
const output=resolve(process.argv[2]??'output/p0-image-resources');await mkdir(output,{recursive:true})
await writeFile(resolve(output,'IMAGE_RESOURCE_ACCEPTANCE.json'),JSON.stringify({generatedAt:new Date().toISOString(),passed:true,checks,sourceHashes:Object.fromEntries(paths.map((p,i)=>[p,createHash('sha256').update(sources[i]).digest('hex')])),limitations:['Actual generated WASM CPU pixels and frontend authority. GPU physical presentation, mounted providers and native WebView2 are separate acceptance gates.']},null,2)+'\n')
console.log(`Image/resource acceptance: ${checks.length}/${checks.length} groups passed`)
