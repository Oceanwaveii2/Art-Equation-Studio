import fs from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createServer} from 'vite'
import {chromium} from 'playwright-core'
const root='D:/0/ArtEquation-Tests/2026-10-11-mixed-baseline',out=root+'/hybrid-0.2-pilot';await fs.mkdir(out,{recursive:true})
const manifest=JSON.parse(await fs.readFile(root+'/fixture-manifest.json','utf8')),fixture=manifest.fixtures.find(f=>f.count===500),project=JSON.parse(await fs.readFile(fixture.project,'utf8'))
const assetById=new Map(project.assets.map(a=>[a.id,a]));const server=await createServer({plugins:[{name:'local-owned-fixture-media',configureServer(server){server.middlewares.use('/hybrid-asset/',async(req,res,next)=>{try{const a=assetById.get(req.url.split('?')[0].replace(/^\/+/,''));if(!a){res.statusCode=404;res.end();return}res.setHeader('Content-Type',a.extension==='png'?'image/png':a.extension==='webp'?'image/webp':'image/jpeg');res.end(await fs.readFile(path.join(fixture.workspace,a.relativePath)))}catch(e){res.statusCode=500;res.end(String(e))}})}}],server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd(),root]}}});await server.listen();const url=server.resolvedUrls.local[0].replace(/\/$/,'')
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-gpu','--disable-webgpu']})
try{
 const page=await browser.newPage();await page.exposeFunction('nativeFont',async(command,args)=>await new Promise((resolve,reject)=>{const child=execFile('D:/0/AE2Target-20261007/release/examples/audit-font-resolver.exe',[],{windowsHide:true,timeout:20000,maxBuffer:64*1024*1024},(error,stdout,stderr)=>error?reject(Error(stderr||String(error))):resolve(JSON.parse(stdout)));child.stdin.end(JSON.stringify({command,request:args.request}))}))
 await page.goto(url+'/src/project-b/p0-surface/generated/p0_engine_wasm.js')
 const data=await page.evaluate(async({project,workspace})=>{
  document.body.replaceChildren();window.__TAURI_INTERNALS__={invoke:(command,args)=>window.nativeFont(command,args)}
  const {createArtEquationCanvasScene}=await import('/src/board/artEquationCanvasAdapter.ts'),{createEngineScenePaint}=await import('/src/project-b/p0-surface/engineScenePaint.ts'),{UniformGridSpatialIndex}=await import('/src/canvas-engine/spatialIndex.ts')
  const sources=new Map(project.assets.map(a=>[a.id,'/hybrid-asset/'+a.id]))
  const board=project.boards[0],scene=createArtEquationCanvasScene(board,project.assets,{background:'#102131',grid:'#254052'},sources),unsupported=scene.objects.filter(o=>!o.modelArtwork&&!o.structuredCard&&o.preparedVectorGeometry?.status!=='ready').map(o=>({id:o.id,kind:o.kind}))
  const supported=scene.objects.filter(o=>!unsupported.some(u=>u.id===o.id)),index=new UniformGridSpatialIndex(supported),width=1818,height=693,dpr=1.5,results=[]
  const bounds={right:Math.max(...scene.objects.map(o=>o.bounds.x+o.bounds.width)),bottom:Math.max(...scene.objects.map(o=>o.bounds.y+o.bounds.height))}
  for(const mode of ['subset','overview']){
   const view=mode==='subset'?board.viewport:{x:28,y:28,scale:Math.min((width/dpr-56)/bounds.right,(height/dpr-56)/bounds.bottom)}
   const margin=360/view.scale,visible=mode==='subset'?index.query({x:-view.x/view.scale-margin,y:-view.y/view.scale-margin,width:width/dpr/view.scale+margin*2,height:height/dpr/view.scale+margin*2}):supported
   const paintScene={...scene,objects:visible},vectors={ids:new Set(visible.filter(o=>o.kind==='vector').map(o=>o.id)),json:JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,sceneId:scene.id,revision:String(scene.revision),environment:{background:'#00000000',colorSpace:'srgb'},resources:[],operations:visible.filter(o=>o.kind==='vector').map(o=>({type:'vector',object:{id:o.id,kind:'vector',transform:[1,0,0,1,0,0],opacity:o.appearance.opacity,payload:{commands:o.preparedVectorGeometry.commands,fill:o.preparedVectorGeometry.hasFill?o.appearance.fill||'#00000000':'#00000000',stroke:o.appearance.stroke||'#b9d4e7',strokeWidth:(o.appearance.strokeWidth??2)/(o.appearance.strokeScaling==='scene'?1:view.scale),vectorFillRule:o.preparedVectorGeometry.fillRule||'nonzero',vectorStrokeJoin:o.appearance.vectorStrokeJoin||'miter',vectorStrokeCap:o.appearance.vectorStrokeCap||'butt'}}}))})},compiler=createEngineScenePaint()
   const paint=await compiler.capture(paintScene,view,vectors,0,()=>true,undefined,undefined,{width:width/dpr,height:height/dpr},dpr)
   if(!paint)throw Error('No prepared paint');if(Object.keys(paint.blockers).length)throw Error(JSON.stringify(paint.blockers))
   results.push({mode,view,width,height,dpr,objects:visible.length,accepted:paint.ids.size,snapshot:JSON.parse(paint.json),uploads:paint.images.map(u=>({reference:u.reference,pixels:Array.from(u.pixels)}))});paint.release();compiler.dispose()
  }
  return {unsupported,results}
 },{project,workspace:fixture.workspace})
 const receipts=[]
 for(const entry of data.results){const dir=out+'/'+entry.mode;await fs.mkdir(dir,{recursive:true});const resources=[];for(let i=0;i<entry.uploads.length;i++){const u=entry.uploads[i],file=dir+'/pixels-'+i+'.rgba';await fs.writeFile(file,Buffer.from(u.pixels));resources.push({reference:u.reference,path:file,sha256:createHash('sha256').update(Buffer.from(u.pixels)).digest('hex')})}delete entry.uploads;entry.resources=resources;entry.excludedObjects=data.unsupported;entry.fixtureSha256=fixture.projectSha256;entry.scope='Renderer replay of supported canonical paint only; 50 subboard-link objects have no production model provider and remain excluded. Not native app interactions.';await fs.writeFile(dir+'/input.json',JSON.stringify(entry));receipts.push({mode:entry.mode,accepted:entry.accepted,excluded:data.unsupported.length,resources:resources.length})}
 await fs.writeFile(out+'/preparation.json',JSON.stringify({status:'PREPARED_SUPPORTED_PAINT; NOT_FULL_BOARD_ACCEPTANCE',fixtureSha256:fixture.projectSha256,counts:receipts},null,2));console.log(JSON.stringify({out,receipts}))
}finally{await browser.close();await server.close()}
