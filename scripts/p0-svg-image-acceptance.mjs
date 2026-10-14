import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64')
const {markerVertices,markerPlacement}=await import(url(compile(await readFile('src/project-b/p0-surface/svgMarkers.ts','utf8'))))
const checks=[]
async function check(name,body){await body();checks.push(name)}
const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`)
await check('curved markers use endpoint tangent, never chord or dash boundaries',()=>{
 const vertices=markerVertices([['M',0,0],['C',0,10,10,10,10,0]])
 assert.equal(vertices.length,2);near(vertices[0].angle,Math.PI/2);near(vertices[1].angle,-Math.PI/2)
})
await check('degenerate cubic controls and zero-length segments retain direction',()=>{
 const vertices=markerVertices([['M',0,0],['L',0,0],['C',0,0,10,10,10,10]])
 near(vertices[0].angle,Math.PI/4);near(vertices.at(-1).angle,Math.PI/4)
})
await check('midpoint bisector crosses angle wrap by the shorter rotation',()=>{
 const vertices=markerVertices([['M',1,-.01],['L',0,0],['L',-1,-.01]])
 near(Math.abs(vertices[1].angle),Math.PI)
})
await check('closed and multiple subpaths keep independent marker endpoints',()=>{
 const vertices=markerVertices([['M',0,0],['L',10,0],['L',10,10],['Z'],['M',20,20],['L',30,20]])
 assert.deepEqual(vertices.map(v=>v.kind),['start','mid','mid','end','start','end'])
 assert.deepEqual(vertices[3].point,[0,0]);assert.deepEqual(vertices[4].point,[20,20])
})
await check('auto-start-reverse aligns reference point and reverses only start',()=>{
 for(const kind of ['start','end']){
  const m=markerPlacement({kind,point:[100,30],angle:0},2,[7,4],true)
  near(m[0]*7+m[2]*4+m[4],100);near(m[1]*7+m[3]*4+m[5],30)
  near(m[0],kind==='start'?-2:2)
 }
 assert.throws(()=>markerPlacement({kind:'end',point:[0,0],angle:0},0,[0,0]))
})

// Provider integration checks use a deterministic DOM/decode seam. Actual
// decoded pixels and CPU rendering are checked separately by the native suite.
const observers=[]
class ElementStub{localName='img';closest(){return {dataset:{imageExtension:'png'}}}}
class ImageStub extends ElementStub{
 currentSrc='https://fixture/image.png';src=this.currentSrc;naturalWidth=100;naturalHeight=50
}
const previous={Element:globalThis.Element,MutationObserver:globalThis.MutationObserver}
globalThis.Element=ElementStub
globalThis.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this)}observe(){}disconnect(){this.disconnected=true}}
const listeners=new Map(),style={objectFit:'cover',objectPosition:'50% 50%',borderLeftWidth:'0px',borderTopWidth:'0px',paddingLeft:'0px',paddingTop:'0px'}
const document={defaultView:{HTMLImageElement:ImageStub,getComputedStyle:()=>style}}
const stage={ownerDocument:document,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)}
const image=new ImageStub();image.ownerDocument=document
const mock=url('export const createSvgEffectProvider=()=>({retireExcept(){},dispose(){}});export const invoke=()=>{};export const createNativeTextFontResolver=()=>({dispose(){}});export const createTextPaintSession=()=>{};export const loadVelloEngine=()=>{};export const captureSvgPaint=()=>{};export const captureLoadedImagePaint=(image,registry,options)=>({operation:{type:"image",resource:{revision:options.revision},transform:options.transform},upload:{},source:image.currentSrc});')
let providerCode=compile(await readFile('src/project-b/p0-surface/cardProviders.ts','utf8'))
providerCode=providerCode.replace(/from ['"][^'"]+['"]/g,`from '${mock}'`)
try{
 const {createMeasuredCardProviders}=await import(url(providerCode))
 const owner=createMeasuredCardProviders({epoch:1},stage),capture=owner.forCapture()
 const options={id:'image',contentSize:{width:100,height:100},borderBoxTransform:[-1,0,0,1,110,20],canonicalRead:fn=>fn(),sourceFingerprint:'test'}
 let first
 await check('cover framing respects reflection and centers cropped overflow once',async()=>{
  first=await capture.providers.image(image,options)
  assert.deepEqual(first.operations[1].transform,[-2,0,0,2,160,20]);assert.equal(first.operations[0].type,'pushClip');assert.equal(first.operations[2].type,'pop')
 })
 await check('same URI request and same-size successful reload receive new revisions',async()=>{
  observers[0].callback([{target:image}])
  const requested=await capture.providers.image(image,options)
  assert(requested.operations[1].resource.revision>first.operations[1].resource.revision)
  listeners.get('load')({target:image})
  const loaded=await capture.providers.image(image,options)
  assert(loaded.operations[1].resource.revision>requested.operations[1].resource.revision)
 })
 await check('replacement element cannot reuse old decoded identity',async()=>{
  const current=await capture.providers.image(image,options),replacement=new ImageStub();replacement.ownerDocument=document
  const replaced=await capture.providers.image(replacement,options)
  assert(replaced.operations[1].resource.revision>current.operations[1].resource.revision)
 })
 await check('provider disposal disconnects source observer and load listener',()=>{
  capture.release();owner.dispose();assert(observers[0].disconnected);assert(!listeners.has('load'))
 })
}finally{Object.assign(globalThis,previous)}
const native=await import(pathToFileURL(resolve('src/project-b/p0-surface/generated/p0_engine_wasm.js')))
native.initSync({module:await readFile('src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm')})
const reference={key:'orientation',revision:1,epoch:913,width:2,height:2}
const rgba=new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255])
const render=(transform,scope=[])=>{
 const renderer=new native.B4CpuRenderer()
 try{
  renderer.register_image(JSON.stringify(reference),rgba)
  const operation={type:'image',id:'orientation',resource:reference,sourceRect:{x:0,y:0,width:2,height:2},transform,opacity:1,sampling:'nearest'}
  const operations=scope.length?[scope[0],operation,scope[1]]:[operation]
  return renderer.render_snapshot(16,16,JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,sceneId:'orientation',revision:'1',environment:{background:'#00000000',colorSpace:'srgb'},resources:[reference],operations}),1,0,0)
 }finally{renderer.dispose();renderer.free()}
}
const pixel=(bytes,x,y)=>Array.from(bytes.slice((y*16+x)*4,(y*16+x+1)*4))
await check('genuine Vello CPU horizontal flip preserves independent color quadrants',()=>{
 const pixels=render([-4,0,0,4,12,4]);assert.deepEqual(pixel(pixels,5,5),[0,255,0,255]);assert.deepEqual(pixel(pixels,9,5),[255,0,0,255]);assert.deepEqual(pixel(pixels,5,9),[255,255,0,255])
})
await check('genuine Vello CPU vertical flip preserves independent color quadrants',()=>{
 const pixels=render([4,0,0,-4,4,12]);assert.deepEqual(pixel(pixels,5,5),[0,0,255,255]);assert.deepEqual(pixel(pixels,9,9),[0,255,0,255])
})
await check('genuine Vello CPU rotation applies the image matrix once',()=>{
 const pixels=render([0,4,-4,0,12,4]);assert.deepEqual(pixel(pixels,5,5),[0,0,255,255]);assert.deepEqual(pixel(pixels,9,5),[255,0,0,255]);assert.deepEqual(pixel(pixels,9,9),[0,255,0,255])
})
await check('genuine Vello CPU clipping remains in frame space after rotation',()=>{
 const pixels=render([0,4,-4,0,12,4],[{type:'pushClip',scopeId:'frame',commands:[['M',4,4],['L',8,4],['L',8,12],['L',4,12],['Z']],transform:[1,0,0,1,0,0],fillRule:'nonzero',isolation:'isolated'},{type:'pop',scopeId:'frame'}])
 assert.deepEqual(pixel(pixels,5,5),[0,0,255,255]);assert.deepEqual(pixel(pixels,9,5),[0,0,0,0]);assert.deepEqual(pixel(pixels,5,9),[255,255,0,255])
})
const effectBudget=url(compile(await readFile('src/canvas-engine/resourceBudget.ts','utf8'))),effectRegistry=url(compile(await readFile('src/canvas-engine/decodedImageRegistry.ts','utf8')).replace("'./resourceBudget'",JSON.stringify(effectBudget)))
const effectMeasured=url(compile(await readFile('src/board/measuredCardPaint.ts','utf8')))
const effectModule=await import(url(compile(await readFile('src/project-b/p0-surface/svgEffects.ts','utf8')).replace("'../../board/measuredCardPaint'",JSON.stringify(effectMeasured)).replace("'../../canvas-engine/decodedImageRegistry'",JSON.stringify(effectRegistry)).replace("'../../canvas-engine/resourceBudget'",JSON.stringify(effectBudget))))
await check('bounded computed SVG shadows parse ordered color and pixel offsets',()=>{
 assert.deepEqual(effectModule.parseSvgDropShadows('drop-shadow(rgb(0, 0, 0) 0px 2px 3px) drop-shadow(rgba(88, 200, 193, 0.6) 0px 0px 2px)').map(({x,y,sigma})=>[x,y,sigma]),[[0,2,3],[0,0,2]])
 for(const source of ['blur(2px)','drop-shadow(red 0px 2px)','drop-shadow(rgb(0,0,0) 0px 0px -1px)','drop-shadow(rgb(0,0,0) 1% 2px)'])assert.throws(()=>effectModule.parseSvgDropShadows(source))
})
await check('separable shadow kernel preserves alpha mass and symmetry without mutating source',()=>{
 const source=new Float32Array(31*31);source[15*31+15]=1
 const blurred=effectModule.gaussianShadowAlpha(source,31,31,2)
 assert(Math.abs(blurred.reduce((a,b)=>a+b,0)-1)<1e-6);near(blurred[15*31+13],blurred[15*31+17]);assert.equal(source[15*31+15],1)
 assert(blurred[15*31+15]>blurred[15*31+13]);assert.notEqual(effectModule.gaussianShadowAlpha(source,31,31,0),source)
 assert.throws(()=>effectModule.gaussianShadowAlpha(source,31,30,2))
})
const {DecodedImageRegistry:EffectRegistry}=await import(effectRegistry),effectImages=new EffectRegistry(981),effectOwner=effectModule.createSvgEffectProvider(effectImages,async()=>native)
const effectRequest={id:'shadow-check',filter:'drop-shadow(rgb(0,0,0) 0px 2px 3px)',bounds:{x:0,y:0,width:16,height:16},transform:[1,0,0,1,0,0],cameraScale:1,operations:[{type:'vector',object:{id:'solid',kind:'vector',transform:[1,0,0,1,0,0],payload:{commands:[['M',0,0],['L',16,0],['L',16,16],['L',0,16],['Z']],fill:'#ffffffff',strokeWidth:0}}}]}
await check('real CPU-derived shadow cache retains original vectors and exact immutable resource',async()=>{
 const first=await effectOwner.prepare(effectRequest);effectImages.stage(first.uploads.map(upload=>upload.reference));effectImages.present()
 const repeated=await effectOwner.prepare(effectRequest)
 assert.equal(first.operations.length,2);assert.equal(repeated.operations.length,2);assert.equal(repeated.operations[1].type,'vector');assert.equal(first.uploads[0],repeated.uploads[0]);assert.equal(effectImages.stats().count,1)
})
await check('changed shadow creates a fresh revision while exhaustion leaves registry unchanged',async()=>{
 const before=effectImages.stats(),updated=await effectOwner.prepare({...effectRequest,filter:'drop-shadow(rgb(0,0,0) 0px 2px 4px)'})
 assert(updated.uploads[0].reference.revision>1)
 const count=effectImages.stats().count;await assert.rejects(effectOwner.prepare({...effectRequest,bounds:{x:0,y:0,width:5000,height:5000}}),/SVG_FILTER_BUDGET/);assert.equal(effectImages.stats().count,count);assert(count>=before.count)
})
await check('effect disposal releases registry resources and rejects later preparation',async()=>{
 effectOwner.dispose();effectImages.dispose();assert.equal(effectImages.stats().bytes,0);await assert.rejects(effectOwner.prepare(effectRequest),/DISPOSED/)
})
const output=resolve(process.argv[2]??'output/p0-svg-image');await mkdir(output,{recursive:true})
await writeFile(resolve(output,'SVG_IMAGE_FOUNDATION_ACCEPTANCE.json'),JSON.stringify({generatedAt:new Date().toISOString(),checks,passed:true,limitations:['Marker placement foundation is not wired into ownership until DOM/GPU/CPU pixel proof.','Provider lifecycle tests use a mocked decode seam; native decoded resource tests are separate.','Shadows, live flow and connector ownership remain DOM-owned.']},null,2)+'\n')
console.log(`SVG/image foundation: ${checks.length}/${checks.length} passed`)
if(process.env.P0_MARKER_PIXELS==='1'||process.env.P0_SHADOW_PIXELS==='1'){
 const {chromium}=await import('playwright-core'),sharp=(await import('sharp')).default
 const shadowTest=process.env.P0_SHADOW_PIXELS==='1'
 const measured=url(compile(await readFile('src/board/measuredCardPaint.ts','utf8'))),markers=url(compile(await readFile('src/project-b/p0-surface/svgMarkers.ts','utf8')))
 const resourceBudget=url(compile(await readFile('src/canvas-engine/resourceBudget.ts','utf8'))),imageRegistry=url(compile(await readFile('src/canvas-engine/decodedImageRegistry.ts','utf8')).replace("'./resourceBudget'",JSON.stringify(resourceBudget)))
 const effects=url(compile(await readFile('src/project-b/p0-surface/svgEffects.ts','utf8')).replace("'../../board/measuredCardPaint'",JSON.stringify(measured)).replace("'../../canvas-engine/decodedImageRegistry'",JSON.stringify(imageRegistry)).replace("'../../canvas-engine/resourceBudget'",JSON.stringify(resourceBudget)))
 const geometry=url('export const prepareVelloVectorGeometry=()=>{throw new Error("Ellipses outside marker pixel fixture")};')
 const svg=url(compile(await readFile('src/project-b/p0-surface/svgPaint.ts','utf8')).replace("'../../board/measuredCardPaint'",JSON.stringify(measured)).replace("'../../board/velloVectorGeometry'",JSON.stringify(geometry)).replace("'./svgMarkers'",JSON.stringify(markers)).replace("'./svgEffects'",JSON.stringify(effects)))
 const engine=url(await readFile('src/project-b/p0-surface/generated/p0_engine_wasm.js','utf8')),wasm=(await readFile('src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm')).toString('base64')
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),records=[]
 try{
  for(const dpr of [1,1.5,2]){
   const context=await browser.newContext({viewport:{width:400,height:300},deviceScaleFactor:dpr}),page=await context.newPage()
   await page.goto(process.env.P0_SVG_URL??'http://127.0.0.1:4193/',{waitUntil:'domcontentloaded'})
   await page.setContent('<style>html,body{margin:0;background:white}svg{position:absolute;left:0;top:0;transform-origin:0 0}</style>')
   await page.evaluate(async({svg,engine,wasm,dpr,effects,imageRegistry})=>{
    window.capture=(await import(svg)).captureSvgPaint;window.engine=await import(engine);await window.engine.default({module_or_path:Uint8Array.from(atob(wasm),c=>c.charCodeAt(0))})
    window.gpuCanvas=document.createElement('canvas');window.gpuCanvas.width=400*dpr;window.gpuCanvas.height=300*dpr
    window.gpuRenderer=new window.engine.B4SurfaceRenderer();await window.gpuRenderer.initialize(window.gpuCanvas)
    window.shadowRegistry=new (await import(imageRegistry)).DecodedImageRegistry(771);window.shadowProvider=(await import(effects)).createSvgEffectProvider(window.shadowRegistry,async()=>window.engine)
   },{svg,engine,wasm,dpr,effects,imageRegistry})
   for(const camera of [.5,1,2])for(const reverse of [false,true]){
    await page.evaluate(({camera,reverse})=>{
     document.querySelector('svg')?.remove()
     document.body.insertAdjacentHTML('beforeend',`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100" viewBox="0 0 100 100" preserveAspectRatio="none" style="transform:scale(${camera})"><defs><marker id="tip" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#205080"/></marker></defs><g transform="rotate(11 50 50)"><path d="M15 30 C15 70 75 70 85 30" fill="none" stroke="#205080" stroke-width="2" vector-effect="non-scaling-stroke" marker-${reverse?'start':'end'}="url(#tip)" stroke-dasharray="3 5"/></g></svg>`)
    },{camera,reverse})
    if(shadowTest)await page.locator('svg g path').evaluate((element,reverse)=>element.style.filter=reverse?'drop-shadow(0 0 2px #58c8c199) drop-shadow(0 2px 3px #0009)':'drop-shadow(0 2px 3px #0009)',reverse)
    const dom=await sharp(await page.screenshot()).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    const result=await page.evaluate(async({dpr,camera,shadowTest})=>{
     const root=document.querySelector('svg')
     const ctm=root.getScreenCTM(),m=[ctm.a/camera,ctm.b/camera,ctm.c/camera,ctm.d/camera,ctm.e/camera,ctm.f/camera]
     const painted=await window.capture(root,{id:'arrow',revision:1,sourceFingerprint:'fixture',canonicalRead:fn=>fn(),userSpaceTransform:m,borderBoxTransform:[1,0,0,1,0,0],contentSize:{width:180,height:100},cameraScale:camera,rootOpacityOwned:true},()=>{throw new Error('Unexpected text')},shadowTest?request=>window.shadowProvider.prepare(request):undefined)
     if(!painted.completePaint)throw new Error(painted.blockers.join(','))
     const uploads=painted.uploads??[],resources=uploads.map(upload=>upload.reference),scene=JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,sceneId:'arrow',revision:'1',environment:{background:'#ffffffff',colorSpace:'srgb'},resources,operations:painted.operations}),width=400*dpr,height=300*dpr
     let cpu
     const cpuRenderer=new window.engine.B4CpuRenderer()
     try{for(const upload of uploads){cpuRenderer.register_image(JSON.stringify(upload.reference),upload.pixels);window.gpuRenderer.register_image(JSON.stringify(upload.reference),upload.pixels)}cpu=cpuRenderer.render_snapshot(width,height,scene,camera*dpr,0,0)}finally{cpuRenderer.dispose();cpuRenderer.free()}
     const canvas=window.gpuCanvas,renderer=window.gpuRenderer
      await renderer.prepare_snapshot(width,height,scene,camera*dpr,0,0);renderer.present_prepared()
      const read=document.createElement('canvas');read.width=width;read.height=height;const ctx=read.getContext('2d');ctx.drawImage(canvas,0,0)
      window.shadowRegistry.stage(resources);window.shadowRegistry.present()
      return {cpu:Array.from(cpu),gpu:Array.from(ctx.getImageData(0,0,width,height).data),operations:painted.operations.length}
    },{dpr,camera,shadowTest})
    const compare=bytes=>{
     let difference=0,mass=0,paintMass=0
     const ink=data=>Float64Array.from({length:data.length/4},(_,i)=>(765-data[i*4]-data[i*4+1]-data[i*4+2])/765),a=ink(dom.data),b=ink(bytes),width=dom.info.width,height=dom.info.height
     for(let i=0;i<bytes.length;i+=4)for(let c=0;c<3;c++){difference+=Math.abs(dom.data[i+c]-bytes[i+c]);mass+=255-dom.data[i+c];paintMass+=255-bytes[i+c]}
     const miss=(source,target)=>{
      let total=0,missing=0
      for(let i=0;i<source.length;i++)if(source[i]>.05){total++;const x=i%width,y=Math.floor(i/width);let found=false
       for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++)if(target[yy*width+xx]>.05)found=true
       if(!found)missing++
      }
      return missing/Math.max(total,1)
     }
     return {l1:difference/Math.max(mass,1),massRatio:paintMass/Math.max(mass,1),missForward:miss(a,b),missBackward:miss(b,a)}
    }
    const record={dpr,camera,reverse,operations:result.operations,cpu:compare(result.cpu),gpu:compare(result.gpu)};records.push(record)
    const name=`marker-${dpr}-${camera}-${reverse}`
    await sharp(dom.data,{raw:dom.info}).png().toFile(resolve(output,name+'-dom.png'))
    await sharp(Uint8Array.from(result.cpu),{raw:{width:dom.info.width,height:dom.info.height,channels:4}}).png().toFile(resolve(output,name+'-cpu.png'))
    record.passed=[record.cpu,record.gpu].every(backend=>backend.massRatio>.8&&backend.massRatio<1.2&&backend.missForward<.02&&backend.missBackward<.02)
    console.log(JSON.stringify(record))
   }
   await page.evaluate(()=>{window.shadowProvider.dispose();window.shadowRegistry.dispose();window.gpuRenderer.dispose();window.gpuRenderer.free()});await context.close()
  }
 }finally{await browser.close();await writeFile(resolve(output,'MARKER_PIXEL_ACCEPTANCE.json'),JSON.stringify({generatedAt:new Date().toISOString(),passed:records.length===18&&records.every(record=>record.passed),records,limitations:['Bounded app triangular marker only; cubic, anisotropy, rotation, reverse-start, dashes and camera/DPR combinations. Ellipse geometry excluded.','Flow lifecycle, general shadows and full mounted connector ownership are separate gates.']},null,2)+'\n')}
 assert.equal(records.length,18);assert(records.every(record=>record.passed),'Marker DOM/backend geometry or coverage discrepancy')
}
if(process.env.P0_IMAGE_PIXELS==='1'){
 const {chromium}=await import('playwright-core'),sharp=(await import('sharp')).default
 const budget=url(compile(await readFile('src/canvas-engine/resourceBudget.ts','utf8')))
 const registry=url(compile(await readFile('src/canvas-engine/decodedImageRegistry.ts','utf8')).replace("'./resourceBudget'",JSON.stringify(budget)))
 const unused=url('export const createSvgEffectProvider=()=>({retireExcept(){},dispose(){}});export const invoke=()=>{throw new Error("No native IPC in image fixture")};export const createNativeTextFontResolver=()=>({dispose(){}});export const createTextPaintSession=()=>{throw new Error("Unexpected text")};export const loadVelloEngine=()=>{throw new Error("Unexpected text")};export const captureSvgPaint=()=>{throw new Error("Unexpected SVG")};')
 const provider=url(compile(await readFile('src/project-b/p0-surface/cardProviders.ts','utf8')).replace(/from ['"]([^'"]+)['"]/g,(_,path)=>`from '${path.includes('decodedImageRegistry')?registry:unused}'`))
 const engine=url(await readFile('src/project-b/p0-surface/generated/p0_engine_wasm.js','utf8')),wasm=(await readFile('src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm')).toString('base64')
 const imagePixels=revision=>Uint8Array.from({length:16*8*4},(_,index)=>{
  const p=Math.floor(index/4),x=p%16,y=Math.floor(p/16),channel=index%4
  return channel===3?(x<8?255:160):channel===0?(revision===1?x*16:255-x*16):channel===1?y*32:revision===1?80:220
 })
 const pngs=await Promise.all([1,2].map(revision=>sharp(imagePixels(revision),{raw:{width:16,height:8,channels:4}}).png().toBuffer()))
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),records=[]
 try{
  for(const dpr of [1,1.5,2]){
   const context=await browser.newContext({viewport:{width:400,height:300},deviceScaleFactor:dpr}),page=await context.newPage();let contentRevision=1
   await page.route('**/p0-image-oracle.png*',route=>route.fulfill({status:200,contentType:'image/png',headers:{'cache-control':'no-store'},body:pngs[contentRevision-1]}))
   await page.goto(process.env.P0_SVG_URL??'http://127.0.0.1:4193/',{waitUntil:'domcontentloaded'})
   await page.setContent('<style>html,body{margin:0;background:white}img{position:absolute;left:0;top:0;width:100px;height:80px;object-fit:cover;object-position:50% 50%;transform-origin:0 0}</style><article class="board-node" data-image-extension="png"><img src="/p0-image-oracle.png"></article>')
   await page.locator('img').evaluate(image=>image.decode())
   await page.evaluate(async({provider,registry,engine,wasm,dpr})=>{
    window.engine=await import(engine);await window.engine.default({module_or_path:Uint8Array.from(atob(wasm),c=>c.charCodeAt(0))})
    window.imageRegistry=new (await import(registry)).DecodedImageRegistry(941);window.imageProvider=(await import(provider)).createMeasuredCardProviders(window.imageRegistry,document.body)
    window.cpuRenderer=new window.engine.B4CpuRenderer();window.gpuRenderer=new window.engine.B4SurfaceRenderer();window.gpuCanvas=document.createElement('canvas');window.gpuCanvas.width=400*dpr;window.gpuCanvas.height=300*dpr;await window.gpuRenderer.initialize(window.gpuCanvas)
   },{provider,registry,engine,wasm,dpr})
   const cases=[{name:'cover',matrix:[1,0,0,1,70,40]},{name:'flip-x',matrix:[-1,0,0,1,210,40]},{name:'flip-y',matrix:[1,0,0,-1,70,170]},{name:'rotate',matrix:[.956,.292,-.292,.956,130,40]},{name:'rotate-flip',matrix:[-.956,-.292,-.292,.956,240,70]}]
   for(const scenario of cases){
    await page.locator('img').evaluate((image,matrix)=>image.style.transform='matrix('+matrix.join(',')+')',scenario.matrix)
    const dom=await sharp(await page.screenshot()).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    const result=await page.evaluate(async({dpr,matrix})=>{
     const capture=window.imageProvider.forCapture(),image=document.querySelector('img'),options={id:'image',revision:1,sourceFingerprint:'fixture',contentSize:{width:100,height:80},borderBoxTransform:matrix,canonicalRead:fn=>fn()}
     try{
      const paint=await capture.providers.image(image,options),resources=paint.uploads.map(upload=>upload.reference)
      for(const upload of paint.uploads){window.cpuRenderer.register_image(JSON.stringify(upload.reference),upload.pixels);window.gpuRenderer.register_image(JSON.stringify(upload.reference),upload.pixels)}
      const scene=JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,sceneId:'image',revision:'1',environment:{background:'#ffffffff',colorSpace:'srgb'},resources,operations:paint.operations}),width=400*dpr,height=300*dpr
      const cpu=window.cpuRenderer.render_snapshot(width,height,scene,dpr,0,0)
      await window.gpuRenderer.prepare_snapshot(width,height,scene,dpr,0,0);window.gpuRenderer.present_prepared()
      const read=document.createElement('canvas');read.width=width;read.height=height;const ctx=read.getContext('2d');ctx.drawImage(window.gpuCanvas,0,0)
      window.imageRegistry.stage(resources);window.imageRegistry.present()
      return {cpu:Array.from(cpu),gpu:Array.from(ctx.getImageData(0,0,width,height).data),revision:resources[0].revision}
     }finally{capture.release()}
    },{dpr,matrix:scenario.matrix})
    const compare=bytes=>{let difference=0,mass=0;for(let i=0;i<bytes.length;i+=4)for(let c=0;c<3;c++){difference+=Math.abs(dom.data[i+c]-bytes[i+c]);mass+=255-dom.data[i+c]}return difference/Math.max(mass,1)}
    const record={dpr,name:scenario.name,revision:result.revision,cpuL1:compare(result.cpu),gpuL1:compare(result.gpu)};record.passed=record.cpuL1<.04&&record.gpuL1<.04;records.push(record);console.log(JSON.stringify(record))
    await sharp(dom.data,{raw:dom.info}).png().toFile(resolve(output,`image-${dpr}-${scenario.name}-dom.png`))
    await sharp(Uint8Array.from(result.cpu),{raw:{width:dom.info.width,height:dom.info.height,channels:4}}).png().toFile(resolve(output,`image-${dpr}-${scenario.name}-cpu.png`))
   }
   contentRevision=2
   await page.locator('img').evaluate(image=>new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=image.src}))
   const reload=await page.locator('img').evaluate(async image=>{
    const transaction=window.imageProvider.forCapture()
    try{const paint=await transaction.providers.image(image,{id:'image',revision:1,sourceFingerprint:'reloaded',contentSize:{width:100,height:80},borderBoxTransform:[1,0,0,1,0,0],canonicalRead:fn=>fn()});return {revision:paint.uploads[0].reference.revision,firstPixel:Array.from(paint.uploads[0].pixels.slice(0,4))}}finally{transaction.release()}
   })
   // Reassigning an identical URL may legally reuse the browser's live decoded
   // image despite HTTP no-store. Verify the provider follows the accepted DOM
   // pixels, then request a new resource URL to exercise changed decode bytes.
   const domPixel=await page.locator('img').evaluate(image=>{const c=document.createElement('canvas');c.width=16;c.height=8;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return Array.from(ctx.getImageData(0,0,1,1).data)})
   assert(reload.revision>records.at(-1).revision);assert.deepEqual(reload.firstPixel,domPixel)
   await page.locator('img').evaluate(image=>new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src='/p0-image-oracle.png?revision=2'}))
   const replaced=await page.locator('img').evaluate(async image=>{
    const transaction=window.imageProvider.forCapture()
    try{const paint=await transaction.providers.image(image,{id:'image',revision:1,sourceFingerprint:'replacement',contentSize:{width:100,height:80},borderBoxTransform:[1,0,0,1,0,0],canonicalRead:fn=>fn()});return {revision:paint.uploads[0].reference.revision,firstPixel:Array.from(paint.uploads[0].pixels.slice(0,4))}}finally{transaction.release()}
   })
   assert(replaced.revision>reload.revision);assert.deepEqual(replaced.firstPixel,[255,0,220,255]);records.push({dpr,name:'same-uri-reload-and-changed-resource',reload,replaced,passed:true})
   await page.evaluate(()=>{window.imageProvider.dispose();window.imageRegistry.dispose();window.cpuRenderer.dispose();window.cpuRenderer.free();window.gpuRenderer.dispose();window.gpuRenderer.free()});await context.close()
  }
 }finally{await browser.close();await writeFile(resolve(output,'IMAGE_PIXEL_ACCEPTANCE.json'),JSON.stringify({generatedAt:new Date().toISOString(),passed:records.length===18&&records.every(record=>record.passed),records,limitations:['Actual production image provider/registry and actual GPU/CPU pixels in isolated mounted image fixture.','Full App ownership invalidation, arbitrary crops/nested rounded clips, srcset replacement and native WebView2 remain separate gates.']},null,2)+'\n')}
 assert.equal(records.length,18);assert(records.every(record=>record.passed),'Mounted image GPU/CPU discrepancy')
}
