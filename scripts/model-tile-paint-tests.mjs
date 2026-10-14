import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createServer} from 'vite'
import {chromium} from 'playwright-core'
const out=path.resolve('output/playwright/model-tiles');await fs.mkdir(out,{recursive:true})
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
try{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]+'src/project-b/p0-surface/generated/p0_engine_wasm.js')
 const bytes=await page.evaluate(async()=>Promise.all([0,1].map(async col=>{const canvas=new OffscreenCanvas(513,512),ctx=canvas.getContext('2d');ctx.fillStyle=col?'#ffd269':'#37d5b5';ctx.fillRect(0,0,513,512);return Array.from(new Uint8Array(await(await canvas.convertToBlob()).arrayBuffer()))})))
 await fs.mkdir(path.join(out,'10'),{recursive:true});for(let col=0;col<2;col++)await fs.writeFile(path.join(out,'10',col+'_0.png'),new Uint8Array(bytes[col]))
 const result=await page.evaluate(async()=>{
  const {paintModelTiles}=await import('/src/project-b/p0-surface/modelTilePaint.ts'),{planModelImageTiles}=await import('/src/project-b/p0-surface/modelImageTiles.ts')
  const {DecodedImageRegistry}=await import('/src/canvas-engine/decodedImageRegistry.ts'),{loadVelloEngine}=await import('/src/project-b/p0-surface/backends.ts')
  const pyramid={schemaVersion:1,generator:'fixture',sourceSha256:'test-source',width:1024,height:512,tileSize:512,overlap:1,maxLevel:10,format:'png',tilesRelativePath:'projects/test/assets/pyramids/test/tiles',posterRelativePath:'projects/test/assets/pyramids/test/poster.png',manifestRelativePath:'projects/test/assets/pyramids/test/manifest.json',tileCount:2,generatedBytes:1,displayColorSpace:'srgb'}
  const object={id:'tiled',kind:'raster',localBounds:{x:0,y:0,width:512,height:256},bounds:{x:0,y:0,width:512,height:256},appearance:{rotation:0,opacity:1},modelArtwork:{kind:'image',source:'unused',sourceRevision:1,pyramid,tilesSource:location.origin+'/output/playwright/model-tiles',framing:{fit:'contain'}}}
  const registry=new DecodedImageRegistry(12001),cpu=new (await loadVelloEngine()).B4CpuRenderer()
  const fail=()=>{throw Error('Tile provider measured DOM')};window.getComputedStyle=fail;Element.prototype.getBoundingClientRect=fail
  const draw=async(view,size)=>{const paint=await paintModelTiles(object,registry,view,size,1,()=>true);for(const upload of paint.uploads)cpu.register_image(JSON.stringify(upload.reference),upload.pixels);const json=JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,sceneId:'tiles',revision:'1',environment:{background:'#000000',colorSpace:'srgb'},operations:paint.operations,resources:paint.uploads.map(u=>u.reference)});const pixels=cpu.render_snapshot(size.width,size.height,json,view.scale,view.x,view.y);return {sample:(x,y)=>Array.from(pixels.slice((y*size.width+x)*4,(y*size.width+x)*4+4)),count:paint.uploads.length}}
  const first=await draw({x:0,y:0,scale:2},{width:1024,height:512}),pan=await draw({x:-512,y:0,scale:2},{width:512,height:512})
  const rotated=planModelImageTiles({...object,appearance:{...object.appearance,rotation:90}},{x:0,y:0,scale:2},{width:1024,height:512},1)
  const result={left:first.sample(100,100),right:first.sample(900,100),seamLeft:first.sample(511,100),seamRight:first.sample(512,100),pan:pan.sample(100,100),firstTiles:first.count,panTiles:pan.count,rotationTiles:rotated.tiles.length,registry:registry.stats()};cpu.free();registry.dispose();return result
 })
 for(const key of ['left','seamLeft'])assert.deepEqual(result[key],[55,213,181,255]);for(const key of ['right','seamRight','pan'])assert.deepEqual(result[key],[255,210,105,255]);assert.equal(result.firstTiles,2);assert.equal(result.panTiles,1);assert.ok(result.rotationTiles>0)
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({scope:'Bounded actual Vello CPU tile pixels; no 4K or native product acceptance',passed:true,...result},null,2));console.log('Model tiles PASS: pixel colors/seams, pan crop, rotation geometry and no DOM measurements')
}finally{await browser.close();await server.close()}
