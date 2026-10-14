import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import ts from 'typescript'
import sharp from 'sharp'
import {chromium} from 'playwright-core'

const baseUrl=process.env.P0_SVG_URL||'http://127.0.0.1:4193/',dpr=Number(process.env.P0_TEXT_DPR||1)
const output=resolve(process.argv[2]);await mkdir(output,{recursive:false})
const privateRoot='C:/Users/User/.codex/worktrees/2439/Art_Equation_Studio_2026-08-27_v81-combined-with-desktop-scope/tmp'
const resolver=resolve('../docs/engine-p0/2026-10-03/shaped-text/native-resolver-check/target/debug/ae-p0-native-font-resolver-check.exe'),exec=promisify(execFile),fontReceipts=[]
async function invoke(command,args){
  if(command!=='resolve_system_font')throw new Error('Unsupported isolated SVG command '+command)
  const request=args.request,key=JSON.stringify(request),target=resolve(privateRoot,'p0-native-tuple-'+createHash('sha256').update(key).digest('hex')+'.json')
  try{await exec(resolver,[request.family,String(request.weight),String(request.italic),target],{maxBuffer:100000})}catch(error){if(String(error.stderr).includes('FONT_FAMILY_NOT_FOUND'))throw new Error('FONT_FAMILY_NOT_FOUND: '+request.family);throw error}
  const receipt=JSON.parse(await readFile(target,'utf8'));const{bytesBase64,...metadata}=receipt;fontReceipts.push({...metadata,request});return receipt
}
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
const source=await readFile('src/canvas-engine/semanticTextPaint.ts','utf8'),budget=compile(await readFile('src/canvas-engine/resourceBudget.ts','utf8')),measurement=compile(await readFile('src/canvas-engine/measuredColor.ts','utf8'))
const nativeFonts=compile(await readFile('src/canvas-engine/nativeTextFonts.ts','utf8')).replace("'./resourceBudget'",JSON.stringify(url(budget)))
const semantic=compile(source).replaceAll("'./nativeTextFonts'",JSON.stringify(url(nativeFonts))).replace("'./measuredColor'",JSON.stringify(url(measurement))).replace("'./resourceBudget'",JSON.stringify(url(budget)))
const wasm=await readFile('src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm'),engine=await readFile('src/project-b/p0-surface/generated/p0_engine_wasm.js','utf8')
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:dpr}),page=await context.newPage(),errors=[],receipts=[]
page.on('pageerror',e=>errors.push(e.message));await page.exposeFunction('__nativeFont',invoke)
function compare(a,b){
  assert.equal(a.info.width,b.info.width);assert.equal(a.info.height,b.info.height)
  const w=a.info.width,h=a.info.height,ink=data=>Float64Array.from({length:w*h},(_,i)=>(255-Math.min(...data.subarray(i*4,i*4+3)))/255),aa=ink(a.data),bb=ink(b.data),mass=a=>a.reduce((s,v)=>s+v,0)
  const within=(a,b)=>{let n=0,miss=0;for(let i=0;i<a.length;i++)if(a[i]>.05){n++;let near=false,x=i%w,y=Math.floor(i/w);for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++)if(b[yy*w+xx]>.05)near=true;if(!near)miss++}return n?miss/n:1}
  return{l1:aa.reduce((s,v,i)=>s+Math.abs(v-bb[i]),0)/Math.max(mass(aa),mass(bb),1),massRatio:mass(bb)/Math.max(mass(aa),1),missForward:within(aa,bb),missBackward:within(bb,aa),massA:mass(aa),massB:mass(bb)}
}
try{
  await page.goto(baseUrl,{waitUntil:'networkidle'});await page.locator('.diagram-caption-svg text').first().waitFor()
  await page.evaluate(async({semantic,engine,wasm})=>{window.__text=await import(semantic);window.__engine=await import(engine);await window.__engine.default({module_or_path:Uint8Array.from(atob(wasm),x=>x.charCodeAt(0))});window.__shaper=new window.__engine.TextEngine('actual-svg');window.__session=window.__text.createTextPaintSession(window.__shaper,'actual-svg');window.__resolve=window.__text.createNativeTextFontResolver(window.__nativeFont)},{semantic:url(semantic),engine:url(engine),wasm:wasm.toString('base64')})
  const targets=await page.locator('article[data-node-id="svg-ellipse"] svg text, article[data-node-id="svg-diagram"] svg text').count()
  assert.ok(targets>=3,'Actual SVG fixture includes ellipse plus multiline diagram captions')
  for(let index=0;index<targets;index++){
    const label='svg-caption-'+index
    const record=await page.locator('article[data-node-id="svg-ellipse"] svg text, article[data-node-id="svg-diagram"] svg text').nth(index).evaluate(async(element,{label,dpr})=>{
      const m=element.getScreenCTM(),transform=[m.a,m.b,m.c,m.d,m.e,m.f],r=element.getBoundingClientRect(),style=getComputedStyle(element),bbox=element.getBBox()
      const prepared=await window.__text.prepareSemanticSvgTextPaint(window.__session,element,{id:label,revision:'1',transform,resolveFont:window.__resolve,rootOpacityOwned:true})
      const record={label,text:element.textContent,style:{family:style.fontFamily,size:style.fontSize,weight:style.fontWeight,anchor:style.textAnchor,baseline:style.dominantBaseline},transform,bbox:{x:bbox.x,y:bbox.y,width:bbox.width,height:bbox.height},prepared:{completePaint:prepared.completePaint,blockers:prepared.blockers,operationCount:prepared.operations.length,qualification:prepared.qualification}}
      if(!prepared.operations.length){prepared.release();return record}
      const width=Math.ceil((r.width+16)/2)*2,height=Math.ceil((r.height+16)/2)*2,host=document.createElement('div');host.id='svg-pixels';Object.assign(host.style,{position:'fixed',left:'0',top:'0',width:width*2+'px',height:height*2+'px',background:'white',zIndex:'999999'})
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));Object.assign(svg.style,{position:'absolute',left:'0',top:'0',overflow:'hidden'});const g=document.createElementNS(svg.namespaceURI,'g'),shifted=[m.a,m.b,m.c,m.d,m.e-r.left+8,m.f-r.top+8];g.setAttribute('transform','matrix('+shifted.join(' ')+')')
      const clone=element.cloneNode(true);for(const key of style)clone.style.setProperty(key,style.getPropertyValue(key));clone.removeAttribute('transform');Object.assign(clone.style,{transform:'none',opacity:'1',fill:'#000',stroke:'none',filter:'none'});g.append(clone);svg.append(g);host.append(svg)
      const gpu=document.createElement('canvas'),cpu=document.createElement('canvas');for(const c of[gpu,cpu]){c.width=Math.round(width*dpr);c.height=Math.round(height*dpr);Object.assign(c.style,{position:'absolute',width:width+'px',height:height+'px',left:width+'px'})};gpu.style.top='0';cpu.style.top=height+'px';host.append(gpu,cpu);document.body.append(host)
      const operations=prepared.operations.map(operation=>({...operation,object:{...operation.object,transform:shifted,payload:{...operation.object.payload,fill:'#000000ff'}}})),list={schema:'art-equation.display-list',schemaVersion:2,sceneId:label,revision:'1',environment:{background:'#ffffffff',colorSpace:'srgb'},resources:[],operations}
      const surface=new window.__engine.B4SurfaceRenderer();await surface.initialize(gpu);await surface.prepare_snapshot(gpu.width,gpu.height,JSON.stringify(list),dpr,0,0);record.gpu=surface.present_prepared();const bytes=window.__engine.render_cpu_snapshot(cpu.width,cpu.height,JSON.stringify(list),dpr,0,0);cpu.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(bytes),cpu.width,cpu.height),0,0)
      window.__pixels={surface,prepared};return{...record,dimensions:{width,height}}
    },{label,dpr})
    if(record.dimensions){
      const{width,height}=record.dimensions,raw=[]
      for(const[name,x,y]of[['DOM',0,0],['GPU',width,0],['CPU',width,height]]){const png=await page.screenshot({path:resolve(output,label+'_'+name+'.png'),clip:{x,y,width,height},animations:'disabled'}),image=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});raw.push(image)}
      const cpu=compare(raw[0],raw[2]),gpu=compare(raw[0],raw[1]),shared=compare(raw[1],raw[2]),physicalSize=parseFloat(record.style.size)*Math.hypot(record.transform[2],record.transform[3])*dpr,l1=physicalSize<=12?.6:.55
      record.pixels={passed:[cpu,gpu].every(x=>x.l1<=l1&&x.massRatio>=.65&&x.massRatio<=1.4&&x.missForward<=.1&&x.missBackward<=.1)&&shared.l1<=.08,cpu,gpu,shared,policy:{l1,massRatio:[.65,1.4],maskMiss:.1,maskRadiusDevicePixels:1,sharedL1:.08}}
      await page.evaluate(()=>{window.__pixels.surface.dispose();window.__pixels.prepared.release();document.querySelector('#svg-pixels').remove()})
    }
    receipts.push(record);console.log(JSON.stringify(record))
  }
}finally{
  await page.evaluate(()=>{window.__session?.dispose();window.__resolve?.dispose()}).catch(()=>{});await browser.close()
  await writeFile(resolve(output,'SVG_TEXT_BROWSER.json'),JSON.stringify({checkedAt:new Date().toISOString(),baseUrl,dpr,sourceHash:createHash('sha256').update(source).digest('hex'),wasmHash:createHash('sha256').update(wasm).digest('hex'),fontReceipts,receipts,errors,limitations:['Fresh actual JSX/CSS SVG fixture with native installed font CLI and shared genuine CPU/GPU; packaged native Tauri IPC and WebView2 are separate gates.','Reference and engine use identical measured screen affine matrix; ancestor opacity is independently owned by compositor and normalized to one for glyph-only proof.']},null,2))
}
assert.equal(errors.length,0,errors.join('\n'));assert.ok(receipts.length>=3&&receipts.every(r=>r.prepared.completePaint&&r.pixels?.passed),'Every qualified actual SVG caption must pass pixel gates')
