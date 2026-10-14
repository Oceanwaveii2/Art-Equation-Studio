import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {chromium} from 'playwright-core'
import {createHash} from 'node:crypto'
import {createServer} from 'vite'

// Small correctness fixture: actual native font resolver, WASM shaping and
// Vello CPU pixels. No app timing, stress board or 4K acceptance claims.
for(const file of ['src/project-b/p0-surface/engineScenePaint.ts','src/board/modelArtwork.ts','src/project-b/p0-surface/modelArtworkPaint.ts','src/canvas-engine/nativeTextFonts.ts','src/project-b/p0-surface/modelImageDecode.ts','src/project-b/p0-surface/modelTilePaint.ts']){
 const source=await fs.readFile(file,'utf8');assert.ok(!/getComputedStyle|getBoundingClientRect|getClientRects|DOMParser|createMeasuredCardProviders|captureCompleteMeasuredCardPaint/.test(source),file+' must not measure mounted DOM')
}
const backdrop=await fs.readFile('src/board/VelloBoardBackdrop.tsx','utf8');assert.ok(!/import\(['"][^'"]*captureScenePaint/.test(backdrop));assert.ok(backdrop.includes('canonicalPaintScene(current.scene, current.visibleIds)'))
const out=path.resolve('output/playwright/model-owned-artwork');await fs.mkdir(out,{recursive:true})
const helper='D:/0/AE2Target-20261007/release/examples/audit-font-resolver.exe'
// Own a temporary local server when invoked by the quality gate. Never rely on
// a stale preview, and never stop a user-owned server.
let server, testUrl=process.env.MODEL_TEST_URL
if(!testUrl){server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});await server.listen();testUrl=server.resolvedUrls.local[0].replace(/\/$/,'')}
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const fontReceipts=[]
try{
 const page=await browser.newPage({viewport:{width:900,height:650}})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.exposeFunction('nativeFont',async(command,args)=>{
  assert.ok(['resolve_system_font','resolve_system_font_fallbacks'].includes(command))
  const result=await new Promise((resolve,reject)=>{const child=execFile(helper,[],{windowsHide:true,timeout:20000,maxBuffer:64*1024*1024},(error,stdout,stderr)=>error?reject(Error(stderr||String(error))):resolve(JSON.parse(stdout)));child.stdin.end(JSON.stringify({command,request:args.request}))})
  for(const face of Array.isArray(result)?result:[result]){if(face.bytesBase64)assert.equal(createHash('sha256').update(Buffer.from(face.bytesBase64,'base64')).digest('hex'),face.contentHash);fontReceipts.push({family:face.resolvedFamily,contentHash:face.contentHash,faceIndex:face.faceIndex})}
  return result
 })
 await page.goto(testUrl+'/src/project-b/p0-surface/generated/p0_engine_wasm.js')
 const result=await page.evaluate(async()=>{
  document.body.replaceChildren();window.__TAURI_INTERNALS__={invoke:(command,args)=>window.nativeFont(command,args)}
  const {projectModelArtwork}=await import('/src/board/modelArtwork.ts')
  const {createArtEquationCanvasScene}=await import('/src/board/artEquationCanvasAdapter.ts')
  const {createModelArtworkPainter}=await import('/src/project-b/p0-surface/modelArtworkPaint.ts')
  const {createStructuredCardPainter}=await import('/src/project-b/p0-surface/structuredCardPaint.ts')
  const {createEngineScenePaint}=await import('/src/project-b/p0-surface/engineScenePaint.ts')
  const {DecodedImageRegistry}=await import('/src/canvas-engine/decodedImageRegistry.ts')
  const {moveModelPaint,modelPaintKey}=await import('/src/project-b/p0-surface/modelPaintRetention.ts')
  const {ImageResidency}=await import('/src/project-b/p0-surface/imageResidency.ts')
  const {loadVelloEngine}=await import('/src/project-b/p0-surface/backends.ts')
  const {canvasResourceBudget}=await import('/src/canvas-engine/resourceBudget.ts')
  const modelNode={id:'type',kind:'text',textMode:'area',color:'transparent',textColor:'#ffffff',x:24,y:25,width:300,height:115,title:'Type',body:'<p><span style="font-family:Segoe UI;font-size:24px;line-height:1.2">Engine-owned <strong>editable</strong> text<br>with wrapping.</span></p>'}
  const modelArtwork=projectModelArtwork(modelNode,undefined)
  if(!modelArtwork)throw Error('Type source not qualified')
  const object={...modelNode,bounds:{x:24,y:25,width:300,height:115},localBounds:{x:24,y:25,width:300,height:115},revision:1,order:1,zIndex:1,locked:false,hidden:false,appearance:{opacity:1,rotation:0},modelArtwork}
  const registry=new DecodedImageRegistry(901),painter=createModelArtworkPainter(registry),graphPainter=createStructuredCardPainter(),cpu=new (await loadVelloEngine()).B4CpuRenderer()
  const source=document.createElement('canvas');source.width=40;source.height=20;const ctx=source.getContext('2d');ctx.fillStyle='#37d5b5';ctx.fillRect(0,0,40,20);ctx.fillStyle='#ffd269';ctx.fillRect(20,0,20,20)
  const imageNode={id:'image',kind:'image',imagePresentation:'artwork',body:source.toDataURL(),x:24,y:170,width:300,height:160,title:'Image'}
  const image={...object,id:'image',kind:'raster',modelPorts:[{x:300,y:80,color:'#67d5cd'}],bounds:{x:24,y:170,width:300,height:160},localBounds:{x:24,y:170,width:300,height:160},modelArtwork:projectModelArtwork(imageNode,undefined,imageNode.body)}
  const asset={id:'replace-asset',kind:'image',extension:'png',status:'available',imageDimensions:{width:40,height:20}}
  const board={id:'source-revision',nodes:[{...imageNode,assetId:asset.id}],connectors:[]}
  const originalProjection=createArtEquationCanvasScene(board,[asset],{},new Map([[asset.id,imageNode.body]])).objects[0].modelArtwork
  const shiftedBoard={...board,nodes:board.nodes.map(node=>({...node,x:node.x+17,y:node.y+9}))}
  const shiftedProjection=createArtEquationCanvasScene(shiftedBoard,[asset],{},new Map([[asset.id,imageNode.body]])).objects[0].modelArtwork
  if(shiftedProjection!==originalProjection)throw Error('Translation reparsed unchanged model artwork')
  const embeddedBoard={id:'embedded-drag',nodes:[imageNode],connectors:[]}
  const embedded=createArtEquationCanvasScene(embeddedBoard,[],{}).objects[0].modelArtwork
  const embeddedMove=createArtEquationCanvasScene({...embeddedBoard,nodes:[{...imageNode,x:imageNode.x+10}]},[],{}).objects[0].modelArtwork
  if(embedded!==embeddedMove||embedded.sourceRevision!==embeddedMove.sourceRevision)throw Error('Translation invalidated unchanged embedded image resource')
  const replacedProjection=createArtEquationCanvasScene(board,[{...asset,relativePath:'replacement.png'}],{},new Map([[asset.id,imageNode.body]])).objects[0].modelArtwork
  if(!(replacedProjection.sourceRevision>originalProjection.sourceRevision))throw Error('Actual adapter failed immutable asset revision change')
  const relocatedProjection=createArtEquationCanvasScene(board,[asset],{},new Map([[asset.id,imageNode.body+'#relocated-source']])).objects[0].modelArtwork
  if(!(relocatedProjection.sourceRevision>originalProjection.sourceRevision))throw Error('Resolved source changed without metadata replacement but reused old image revision')
  const graph={...object,id:'graph',kind:'container',bounds:{x:340,y:25,width:270,height:330},localBounds:{x:340,y:25,width:270,height:330},modelArtwork:undefined,structuredCard:{title:'Graph family',rows:['Type record','Image record'],result:'2 records',fill:'#1a3445',headerFill:'#32746e',text:'#ffffff',ports:[{x:0,y:165},{x:270,y:165}]}}
  const attachedBoard={...board,nodes:[...board.nodes,{id:'connected-graph',kind:'group',title:'Graph',x:400,y:0,width:200,height:300,color:'#34546c',graphColumn:{version:2,operation:'collect',inputs:[{id:'asset-input',sourceId:imageNode.id}]}}]}
  const attached=createArtEquationCanvasScene(attachedBoard,[asset],{},new Map([[asset.id,imageNode.body]])).objects.find(item=>item.id===imageNode.id)
  if(!attached?.modelPorts?.length)throw Error('Connected source lost its model-painted port')
  const originalStyle=window.getComputedStyle,originalRect=Element.prototype.getBoundingClientRect,originalRanges=Range.prototype.getClientRects
  let measurements=0
  const fail=()=>{measurements++;throw Error('Passive model paint attempted DOM measurement')}
  window.getComputedStyle=fail;Element.prototype.getBoundingClientRect=fail;Range.prototype.getClientRects=fail
  let extra, cards, engineProof
  try{
    const models=[{...modelNode,body:'<h2>Heading</h2><p style="text-align:center;margin-bottom:8px">One <mark style="background-color:#ffff00">highlight</mark></p><ol><li><p>First</p></li><li><p>Second</p></li></ol><p>Last paragraph</p>'},{...modelNode,kind:'note',textMode:undefined,color:'#e6b888',body:'Plain note\nSecond line'},{...modelNode,kind:'column',textMode:undefined,color:'#32746e',body:''},{...imageNode,imageTransform:{fit:'cover',zoom:2,flipX:true,grayscale:true}}]
    extra=[]
    for(let i=0;i<models.length;i++){const node=models[i],modelArtwork=projectModelArtwork(node,undefined,node.kind==='image'?imageNode.body:undefined);if(!modelArtwork)throw Error('Extended model not qualified '+node.kind);const card=await painter.paint({...object,id:'extended-'+i,modelArtwork});extra.push({kind:node.kind,complete:card.completePaint,operations:card.operations.length,blocks:modelArtwork.blocks?.length,text:modelArtwork.text})}
    cards=[await painter.paint(object),await painter.paint(image),await graphPainter.paint(graph)]
    const compiler=createEngineScenePaint()
    const scene={id:'compiler-fixture',revision:1,objects:[object,{...image,order:2},{...graph,order:3}],connections:[],environment:{background:'#071322'}}
    const empty={ids:new Set(),json:JSON.stringify({operations:[]})}
    const capture=await compiler.capture(scene,{x:0,y:0,scale:1},empty,0,()=>true)
    if(!capture||capture.cardIds.size!==3)throw Error('Production scene compiler failed full fixture ownership')
    const pan=await compiler.capture(scene,{x:20,y:10,scale:.75},empty,999,()=>true)
    if(!pan||pan.json!==capture.json)throw Error('Camera-only changes rebuilt authored paint')
    const proofCpu=new (await loadVelloEngine()).B4CpuRenderer()
    for(const upload of capture.images)proofCpu.register_image(JSON.stringify(upload.reference),upload.pixels)
    const proofPixels=proofCpu.render_snapshot(640,390,capture.json,1,0,0)
    engineProof={ids:[...capture.cardIds],cameraReused:pan.json===capture.json,imagePixel:Array.from(proofPixels.slice((210*640+60)*4,(210*640+60)*4+4))}
    proofCpu.free();pan.release();capture.release();compiler.dispose();compiler.dispose()
  }
  finally{window.getComputedStyle=originalStyle;Element.prototype.getBoundingClientRect=originalRect;Range.prototype.getClientRects=originalRanges}
  if(cards.some(c=>!c.completePaint))throw Error('Incomplete model paint')
  const resources=cards.flatMap(c=>c.uploads.map(u=>u.reference)),paint={schema:'art-equation.display-list',schemaVersion:2,sceneId:'model-fixture',revision:'1',environment:{background:'#071322',colorSpace:'srgb'},operations:cards.flatMap(c=>c.operations),resources}
  for(const card of cards)for(const upload of card.uploads)cpu.register_image(JSON.stringify(upload.reference),upload.pixels)
  const pixels=cpu.render_snapshot(640,390,JSON.stringify(paint),1,0,0)
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=390;const output=canvas.getContext('2d');output.putImageData(new ImageData(new Uint8ClampedArray(pixels),640,390),0,0);document.body.append(canvas)
  const sample=(x,y)=>Array.from(pixels.slice((y*640+x)*4,(y*640+x)*4+4))
  const moved={...object,revision:2,localBounds:{...object.localBounds,x:44,y:35},bounds:{...object.bounds,x:44,y:35}}
  const repositioned=moveModelPaint(cards[0],object,moved)
  const before=cards[0].operations.find(op=>op.type==='vector').object.transform,after=repositioned.operations.find(op=>op.type==='vector').object.transform
  const residency=new ImageResidency(5000,3),r1={key:'a',revision:1,epoch:1,width:10,height:10},r2={...r1,key:'b'},r3={...r1,revision:2}
  residency.checked([r1],[r1]);const boardSwitch=residency.request([r2]);residency.checked([r1,r2],[r2]);const returnRefs=residency.request([r1]);const replacement=residency.request([r3]);residency.clear()
  const refused=[projectModelArtwork({...modelNode,body:'<table><tr><td>Unsupported table</td></tr></table>'}),projectModelArtwork({...modelNode,body:'<p><span style="background:red">Effect</span></p>'}),projectModelArtwork({...imageNode,imageTransform:{blendMode:'color-burn'}},undefined,imageNode.body)]
  const summary={engineProof,extra,measurements,complete:cards.map(c=>c.completePaint),sourceRevisions:{original:originalProjection.sourceRevision,replacement:replacedProjection.sourceRevision},samples:{port:sample(324,250),left:sample(60,210),right:sample(240,210),graph:sample(590,100)},moves:{keySame:modelPaintKey('s',object)===modelPaintKey('s',moved),before,after},residency:{boardSwitch,returnRefs,replacement},refused:refused.map(x=>x===undefined),operations:paint.operations.length,paint,resources:cards.flatMap(c=>c.uploads.map(u=>({reference:u.reference,pixels:Array.from(u.pixels)})))}
  summary.textPixels=0;for(let y=25;y<140;y++)for(let x=24;x<324;x++){const at=(y*640+x)*4;if(pixels[at]>150&&pixels[at+1]>150&&pixels[at+2]>150)summary.textPixels++}
  cpu.free();graphPainter.dispose();graphPainter.dispose();painter.dispose();painter.dispose();registry.dispose();source.width=0;source.height=0
  // Real WASM hosts must free once even if close/finally/retirement overlap.
  // Also close each painter while its actual native-font response is pending.
  const originalInvoke=window.__TAURI_INTERNALS__.invoke
  summary.retiredFontReads=[]
  for(const [factory,item] of [[()=>createModelArtworkPainter(registry),object],[createStructuredCardPainter,graph]]){
   let entered,release
   const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve)
   window.__TAURI_INTERNALS__.invoke=async(command,args)=>{entered();await gate;return originalInvoke(command,args)}
   const retiring=factory(),pending=retiring.paint(item).then(()=>{throw Error('Disposed painter published late font work')},error=>String(error))
   await started;retiring.dispose();retiring.dispose();release();summary.retiredFontReads.push(await pending)
   window.__TAURI_INTERNALS__.invoke=originalInvoke
  }
  await new Promise(resolve=>setTimeout(resolve,50))
  summary.budget=canvasResourceBudget.snapshot()
  return summary
 })
 assert.equal(result.measurements,0)
 assert.equal(result.engineProof.ids.length,3);assert.ok(result.engineProof.cameraReused);assert.deepEqual(result.engineProof.imagePixel,[55,213,181,255])
 assert.equal(result.extra.length,4);assert.ok(result.extra.every(row=>row.complete&&row.operations>0));assert.equal(result.extra[0].blocks,5);assert.ok(result.extra[0].text.includes('1. First2. Second'));assert.ok(result.extra[1].text.includes('Second line'))
 assert.deepEqual(result.samples.port,[103,213,205,255]);
 assert.deepEqual(result.complete,[true,true,true]);assert.deepEqual(result.samples.left,[55,213,181,255]);assert.deepEqual(result.samples.right,[255,210,105,255])
 assert.ok(result.textPixels>150,'Actual glyphs must appear inside the Type frame')
 assert.ok(result.moves.keySame);assert.equal(result.moves.after[4]-result.moves.before[4],20);assert.equal(result.moves.after[5]-result.moves.before[5],10)
 assert.equal(result.residency.boardSwitch.length,2);assert.equal(result.residency.returnRefs.length,2);assert.ok(!result.residency.replacement.some(r=>r.key==='a'&&r.revision===1));assert.ok(result.refused.every(Boolean))
 assert.ok(result.retiredFontReads.every(error=>/DISPOSED/.test(error)),result.retiredFontReads.join('\n'));assert.deepEqual(errors,[],'Double cleanup and late native-font work must not use freed WASM hosts')
 await fs.writeFile(out+'/scene-paint.json',JSON.stringify(result.paint));await fs.writeFile(out+'/image-uploads.json',JSON.stringify(result.resources));delete result.paint;delete result.resources
 await page.screenshot({path:out+'/fixture.png'})
 await fs.writeFile(out+'/report.json',JSON.stringify({scope:'Small actual WASM/native-font/Vello CPU correctness fixture; not app latency or native GPU acceptance.',...result,fontReceipts:[...new Map(fontReceipts.filter(r=>r.contentHash).map(r=>[r.contentHash,r])).values()]},null,2))
 console.log('Model artwork: PASS (zero DOM measurements, native glyphs, CPU image pixels, translation reuse, board residency and explicit unsupported source refusal)')
}finally{await browser.close();await server?.close()}



