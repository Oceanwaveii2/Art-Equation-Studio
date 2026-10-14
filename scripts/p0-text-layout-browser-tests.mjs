import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const baseUrl=process.env.UI_TEST_BASE_URL||'http://127.0.0.1:5185/'
const output=resolve(process.argv[2]||'../docs/engine-p0/2026-10-03/shaped-text/browser-probe')
await mkdir(output,{recursive:false})
const privateRoot='C:/Users/User/.codex/worktrees/2439/Art_Equation_Studio_2026-08-27_v81-combined-with-desktop-scope/tmp'
const fonts=await Promise.all(['sans-serif-400','sans-serif-700','georgia-400'].map(async name=>JSON.parse(await readFile(resolve(privateRoot,`p0-native-${name}.json`),'utf8'))))
const actualResolver=resolve('../docs/engine-p0/2026-10-03/shaped-text/native-resolver-check/target/debug/ae-p0-native-font-resolver-check.exe')
const nativeCalls=new Map(),exec=promisify(execFile)
async function resolveActualFont(request){
  const key=JSON.stringify(request);if(nativeCalls.has(key))return nativeCalls.get(key)
  const work=(async()=>{const target=resolve(privateRoot,`p0-native-tuple-${createHash('sha256').update(key).digest('hex')}.json`);try{await exec(actualResolver,[request.family,String(request.weight),String(request.italic),target],{maxBuffer:100000});return JSON.parse(await readFile(target,'utf8'))}catch(error){if(String(error.stderr).includes('FONT_FAMILY_NOT_FOUND'))throw new Error('FONT_FAMILY_NOT_FOUND: '+request.family);throw error}})();nativeCalls.set(key,work);return work
}
async function resolveActualFallbacks(request){
  const key=JSON.stringify(request),digest=createHash('sha256').update(key).digest('hex'),input=resolve(privateRoot,`p0-native-fallback-${digest}-request.json`),target=resolve(privateRoot,`p0-native-fallback-${digest}.json`)
  await writeFile(input,key);await exec(actualResolver,['--fallbacks',input,target],{maxBuffer:100000});return JSON.parse(await readFile(target,'utf8'))
}
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const budgetSource=compile(await readFile('src/canvas-engine/resourceBudget.ts','utf8'))
const measurementSource=compile(await readFile('src/canvas-engine/measuredColor.ts','utf8'))
const source=await readFile('src/canvas-engine/semanticTextPaint.ts','utf8')
const nativeFonts=compile(await readFile('src/canvas-engine/nativeTextFonts.ts','utf8')).replace("'./resourceBudget'",JSON.stringify(url(budgetSource)))
const semanticSource=compile(source).replaceAll("'./nativeTextFonts'",JSON.stringify(url(nativeFonts))).replace("'./measuredColor'",JSON.stringify(url(measurementSource))).replace("'./resourceBudget'",JSON.stringify(url(budgetSource)))
const engineDirectory=process.env.P0_TEXT_ENGINE_DIR||'src/project-b/p0-surface/generated'
const wasm=await readFile(resolve(engineDirectory,'p0_engine_wasm_bg.wasm'))
const wasmSource=await readFile(resolve(engineDirectory,'p0_engine_wasm.js'),'utf8')
const {createBlankProject,DEFAULT_DOCUMENT_LAYOUT}=await import(url(compile(await readFile('src/model/project.ts','utf8'))))
let project=createBlankProject('Actual mounted text parity fixture'); project.id='p0-text-layout'
project.boards=[{id:'text-board',title:'Text parity board',nodes:[{id:'note',kind:'note',title:'Measured note title',body:'Actual mounted note typography wraps within its content box. office affix café.',x:70,y:60,width:320,height:200,color:'#a58b64',opacity:1},{id:'rich',kind:'text',title:'Actual rich text',body:'<p>Actual mounted rich text typography wraps within its content box. office affix café.</p><p><strong>Styled bold semantic text stays editable.</strong></p><p>Mixed <strong>bold office</strong> and normal <span style="color: #b52525">colored café</span> keep their semantic spans.</p>',x:450,y:60,width:330,height:220,color:'#a58b64',opacity:1},{id:'column',kind:'column',title:'Measured actual column',body:'',x:70,y:350,width:660,height:300,color:'#a58b64',opacity:1}],connectors:[],viewport:{x:28,y:28,scale:1},gridVisible:false}]
project.documents=[{id:'doc',title:'Actual text document',layout:DEFAULT_DOCUMENT_LAYOUT,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Actual document kicker'}]},{type:'heading',attrs:{level:1},content:[{type:'text',text:'Actual document heading'}]},{type:'paragraph',content:[{type:'text',text:'Actual body typography wraps within the measured page width. office affix café. '.repeat(5)}]},{type:'paragraph',content:[{type:'text',text:'Final paragraph for actual body typography'}]}]}}]
const settings={schemaVersion:5,theme:'dark',viewMode:'canvas',splitRatio:50,activeProjectId:project.id,canvasEnginePreference:'generation-1',projectNavigation:{[project.id]:{activeBoardId:'text-board',activeDocumentId:'doc',activeNavigatorItem:'board:text-board',viewMode:'canvas'}}}
project.boards[0].nodes.find(node=>node.id==='rich').body += '<p>Combining x\u0301 and cafe\u0301 retain their source clusters.</p><p>English office \u0627\u0644\u0639\u0631\u0628\u064a\u0629 123 and mixed \u0633\u0644\u0627\u0645 keep paragraph context while wrapping.</p><p>Actual Japanese \u65e5\u672c\u8a9e and Chinese \u4e2d\u6587 keep native font fallback.</p><p>\u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0633\u0644\u0627\u0645 office 123 \u0648\u0645\u062d\u062a\u0648\u0649 \u0645\u062e\u062a\u0644\u0637 \u064a\u0644\u062a\u0641 \u0628\u0634\u0643\u0644 \u0635\u062d\u064a\u062d.</p><p><span style="font-family: Georgia">Real <em>Georgia italic office</em> and regular serif remain editable.</span></p>'
const errors=[],receipts=[]
async function invoke(command,args={}) {
  if(command==='workspace_info')return {root:output,workspaceId:'p0-text-layout',readOnly:false,lockOwned:true}
  if(command==='load_json')return args.relativePath==='settings.json'?settings:project
  if(command==='save_json'){if(args.relativePath!=='settings.json')project=args.value;return {relativePath:args.relativePath,bytesWritten:1,backupCreated:false}}
  if(command==='list_projects')return [{id:project.id,title:project.title,updatedAt:project.updatedAt,boardCount:1,assetCount:0}]
  if(['list_trashed_projects','list_project_trash','audit_project_assets','list_system_fonts'].includes(command))return []
  if(command==='project_b_preflight_context')return {enabled:false}
  if(command==='plugin:window|scale_factor')return 1
  if(command==='plugin:window|inner_size')return {width:1440,height:1000}
  if(command==='plugin:event|listen')return 1
  if(['mini_bridge_launch','ensure_project_workspace','ensure_managed_board_folders','plugin:event|unlisten','plugin:window|set_title','record_frontend_diagnostic'].includes(command))return
  if(command==='resolve_system_font') {
    return resolveActualFont(args.request)
  }
  if(command==='resolve_system_font_fallbacks')return resolveActualFallbacks(args.request)
  throw new Error('Unsupported disposable IPC '+command)
}
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const dpr=Number(process.env.P0_TEXT_DPR||1),context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:dpr}),page=await context.newPage()
page.on('pageerror',error=>errors.push(error.message))
await page.exposeFunction('__p0TestInvoke',invoke)
await page.addInitScript(()=>{let id=0;window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},invoke:(command,args)=>window.__p0TestInvoke(command,args),transformCallback:callback=>{window['_'+ ++id]=callback;return id},unregisterCallback:id=>delete window['_'+id]};window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}}})
async function capture(selector,label) {
  const record=await page.locator(selector).first().evaluate(async(element,{label,dpr})=>{
    const owner=element.closest('[data-vello-card-paint]'),canonicalRead=read=>{const value=owner?.getAttribute('data-vello-card-paint');owner?.removeAttribute('data-vello-card-paint');try{return read()}finally{if(value!==null&&value!==undefined)owner.setAttribute('data-vello-card-paint',value)}}
    const s=getComputedStyle(element),r=element.getBoundingClientRect(),width=parseFloat(s.width),scale=r.width/width
    const transform=[1,0,0,1,0,0]
    const captured=await window.__text.captureSemanticParagraph(element,{id:label,revision:'1',fontEpoch:'browser-text',transform,resolveFont:window.__resolveFont,canonicalRead})
    if(!captured.request)return {label,style:{family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,leading:s.lineHeight,whiteSpace:s.whiteSpace,direction:s.direction,transform:s.textTransform,feature:s.fontFeatureSettings,kerning:s.fontKerning,variation:s.fontVariationSettings,shadow:s.textShadow,filter:s.filter,stroke:s.webkitTextStrokeWidth,stretch:s.fontStretch,opacity:s.opacity,blend:s.mixBlendMode,spacing:s.wordSpacing,visibility:s.visibility},blockers:captured.measurement.blockers}
    for(const f of captured.fonts)window.__shaper.register_font(f.key,f.revision,f.faceIndex,f.bytes)
    let shaped;try{shaped=JSON.parse(window.__shaper.shape(JSON.stringify(captured.request)))}catch(error){return {label,error:String(error),request:captured.request,blockers:captured.measurement.blockers}}
    const widths=window.__text.compareTextLineWidths(shaped,captured.measurement.clientLines,scale)
    const clone=element.cloneNode(true);const copy=(a,b)=>{const cs=getComputedStyle(a);for(const key of cs)b.style.setProperty(key,cs.getPropertyValue(key));for(let i=0;i<a.children.length;i++)copy(a.children[i],b.children[i])};copy(element,clone)
    Object.assign(clone.style,{position:'fixed',left:'0px',top:'0px',margin:'0px',transform:'none',opacity:'0',pointerEvents:'none',width:s.width,height:'auto',minHeight:'0px'});clone.setAttribute('aria-hidden','true');clone.inert=true
    const probe=document.createElement('span');Object.assign(probe.style,{display:'inline-block',width:'0px',height:'0px',padding:'0px',margin:'0px',border:'0px',verticalAlign:'baseline',font:s.font});clone.prepend(probe);document.body.append(clone)
    const c=clone.getBoundingClientRect(),baseline=probe.getBoundingClientRect().top-c.top-parseFloat(s.paddingTop)-parseFloat(s.borderTopWidth);clone.remove()
    const lineHeight=s.lineHeight==='normal'?shaped.lines[0]?.height:parseFloat(s.lineHeight)
    const baselines=shaped.lines.map((line,index)=>baseline+index*lineHeight)
    const prepared=await window.__session.prepare(element,{id:label,revision:'1',transform,resolveFont:window.__resolveFont,rootBackgroundOwned:true,canonicalRead,rasterScale:dpr})
    window.__latest={captured,shaped,baselines,label,prepared,element}
    return {label,style:{family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,leading:s.lineHeight,whiteSpace:s.whiteSpace,tracking:s.letterSpacing},fontHashes:captured.fonts.map(f=>f.contentHash),request:captured.request,lines:shaped.lines,widths,baseline,baselines,height:r.height/scale,scale,blockers:captured.measurement.blockers,prepared:{completePaint:prepared.completePaint,blockers:prepared.blockers,operationCount:prepared.operations.length,qualification:prepared.qualification}}
  },{label,dpr})
  receipts.push(record);console.log(JSON.stringify({label,widths:record.widths,baseline:record.baseline,shaperBaseline:record.lines?.[0]?.baseline,blockers:record.blockers,error:record.error}))
  if(record.prepared?.operationCount)await pixels(label)
  return record
}
async function pixels(label){
  await page.evaluate(async({dpr})=>{
    const {prepared,element}=window.__latest,source=getComputedStyle(element),bounds=element.getBoundingClientRect(),scale=bounds.width/parseFloat(source.width)
    // Equal reference planes begin at integral backing pixels at DPR 1/1.5/2.
    // This prevents screenshot crop/compositor resampling from fabricating a
    // CPU-versus-GPU discrepancy at an unrelated half-pixel plane origin.
    const width=Math.ceil((bounds.width/scale+16)/2)*2,height=Math.ceil((bounds.height/scale+16)/2)*2
    const host=document.createElement('div');host.id='p0-pixel-plane';Object.assign(host.style,{position:'fixed',left:'0px',top:'0px',width:`${width*2}px`,height:`${height*2}px`,background:'white',zIndex:'999999',margin:'0',padding:'0',border:'0'})
    const copy=(a,b)=>{const s=getComputedStyle(a);for(const k of s)b.style.setProperty(k,s.getPropertyValue(k));b.style.color='#000';b.style.webkitTextFillColor='#000';if(!window.__latest.label.includes('decorations'))b.style.background='transparent';b.style.opacity='1';for(let i=0;i<a.children.length;i++)copy(a.children[i],b.children[i])}
    const clone=element.cloneNode(true);copy(element,clone);clone.id='p0-dom-pixel-reference';Object.assign(clone.style,{position:'absolute',left:'8px',top:'8px',width:source.width,height:'auto',minHeight:'0',margin:'0',transform:'none',opacity:'1',outline:'0'});host.append(clone)
    const gpu=document.createElement('canvas');gpu.id='p0-gpu-pixel-reference';gpu.width=Math.round(width*dpr);gpu.height=Math.round(height*dpr);Object.assign(gpu.style,{position:'absolute',left:width+'px',top:'0px',width:width+'px',height:height+'px'});host.append(gpu)
    const cpu=document.createElement('canvas');cpu.id='p0-cpu-pixel-reference';cpu.width=gpu.width;cpu.height=gpu.height;Object.assign(cpu.style,{position:'absolute',left:width+'px',top:height+'px',width:width+'px',height:height+'px'});host.append(cpu);document.body.append(host)
    const operations=prepared.operations.map(o=>({...o,object:{...o.object,transform:[1,0,0,1,8+parseFloat(source.borderLeftWidth)+parseFloat(source.paddingLeft),8+parseFloat(source.borderTopWidth)+parseFloat(source.paddingTop)],payload:{...o.object.payload,fill:window.__latest.label.includes('decorations')&&o.object.id.endsWith('highlight')?o.object.payload.fill:'#000000ff'}}}))
    const list={schema:'art-equation.display-list',schemaVersion:2,sceneId:'actual-dom-text',revision:'1',environment:{background:'#ffffffff',colorSpace:'srgb'},resources:[],operations}
    const surface=new window.__engine.B4SurfaceRenderer();await surface.initialize(gpu);await surface.prepare_snapshot(gpu.width,gpu.height,JSON.stringify(list),dpr,0,0);const receipt=surface.present_prepared();window.__pixelSurface=surface
    const bytes=window.__engine.render_cpu_snapshot(cpu.width,cpu.height,JSON.stringify(list),dpr,0,0);cpu.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(bytes),cpu.width,cpu.height),0,0)
    window.__pixelDimensions={width,height,receipt}
  },{dpr})
  const dimensions=await page.evaluate(()=>window.__pixelDimensions),screens={}
  for(const [name,x,y]of[['DOM',0,0],['GPU',dimensions.width,0],['CPU',dimensions.width,dimensions.height]])screens[name]=await page.screenshot({path:resolve(output,`${label}_${name}.png`),clip:{x,y,width:dimensions.width,height:dimensions.height},animations:'disabled'})
  const raw=await Promise.all(['DOM','GPU','CPU'].map(async name=>{const {data,info}=await sharp(screens[name]).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {name,data,info}}))
  const compare=(a,b)=>{
    assert.equal(a.info.width,b.info.width);assert.equal(a.info.height,b.info.height)
    const w=a.info.width,h=a.info.height,ink=data=>Float64Array.from({length:w*h},(_,i)=>(255-Math.min(data[i*4],data[i*4+1],data[i*4+2]))/255),aa=ink(a.data),bb=ink(b.data)
    const mass=a=>a.reduce((s,v)=>s+v,0),within=(source,target)=>{let n=0,missed=0;for(let i=0;i<source.length;i++)if(source[i]>.05){n++;const x=i%w,y=Math.floor(i/w);let near=false;for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++)if(target[yy*w+xx]>.05)near=true;if(!near)missed++}return n?missed/n:1}
    return {l1:aa.reduce((sum,v,i)=>sum+Math.abs(v-bb[i]),0)/Math.max(mass(aa),mass(bb),1),massRatio:mass(bb)/Math.max(mass(aa),1),missForward:within(aa,bb),missBackward:within(bb,aa),massA:mass(aa),massB:mass(bb)}
  }
  // At physical sizes <=12px native grid fitting can move coverage between
  // adjacent pixels while preserving every glyph mask and advance. Retain the
  // mass/one-pixel geometry gates and use the documented small-text AA limit.
  const physicalSize=parseFloat(receipts.find(r=>r.label===label).style.size)*dpr,l1Limit=physicalSize<=12?.6:.55
  const cpu=compare(raw[0],raw[2]),gpu=compare(raw[0],raw[1]),shared=compare(raw[1],raw[2]),passed=[cpu,gpu].every(r=>r.l1<=l1Limit&&r.massRatio>=.65&&r.massRatio<=1.4&&r.missForward<=.1&&r.missBackward<=.1)&&shared.l1<=.08
  receipts.find(r=>r.label===label).pixels={passed,cpu,gpu,shared,dimensions,policy:{l1:l1Limit,smallTextPhysicalSizeLimit:12,massRatio:[.65,1.4],maskMiss:.1,maskRadiusDevicePixels:1,sharedL1:.08}}
  console.log(JSON.stringify({label,pixelsPassed:passed,cpu,gpu,shared}))
  await page.evaluate(()=>{window.__pixelSurface.dispose();delete window.__pixelSurface;document.querySelector('#p0-pixel-plane').remove();window.__latest.prepared.release()})
}
try {
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'});await page.locator('.boot-loader').waitFor({state:'hidden'});await page.locator('article[data-node-id="note"] .node-copy p').waitFor()
  await page.evaluate(async({semanticUrl,engineUrl,wasmBase64})=>{window.__text=await import(semanticUrl);window.__engine=await import(engineUrl);await window.__engine.default({module_or_path:Uint8Array.from(atob(wasmBase64),c=>c.charCodeAt(0))});window.__shaper=new window.__engine.TextEngine('browser-text');window.__session=window.__text.createTextPaintSession(window.__shaper,'browser-text');window.__resolveFont=window.__text.createNativeTextFontResolver((cmd,args)=>window.__p0TestInvoke(cmd,args))},{semanticUrl:url(semanticSource),engineUrl:url(wasmSource),wasmBase64:wasm.toString('base64')})
  await capture('article[data-node-id="note"] .node-copy p','mounted-note')
  await capture('article[data-node-id="rich"] .tiptap p','mounted-rich-body')
  await capture('article[data-node-id="rich"] .tiptap p:nth-child(2)','mounted-rich-bold')
  await capture('article[data-node-id="rich"] .tiptap p:nth-child(3)','mounted-rich-inline-mixed')
  await capture('article[data-node-id="rich"] .tiptap p:nth-child(4)','mounted-rich-combining')
  await capture('article[data-node-id="rich"] .tiptap p:nth-child(5)','mounted-rich-arabic-bidi-ltr')
  await page.locator('article[data-node-id="rich"] .tiptap p:nth-child(6)').evaluate(node=>node.lang='ja')
  await capture('article[data-node-id="rich"] .tiptap p:nth-child(6)','mounted-rich-cjk-fallback')
  await page.locator('article[data-node-id="rich"] .tiptap p:nth-child(7)').evaluate(node=>{node.style.direction='rtl';node.style.textAlign='right'})
  await capture('article[data-node-id="rich"] .tiptap p:nth-child(7)','mounted-rich-arabic-bidi-rtl')
  await capture('article[data-node-id="rich"] .tiptap p:nth-child(8)','mounted-rich-native-italic-mixed')
  await page.locator('article[data-node-id="rich"] .tiptap p:nth-child(8)').evaluate(node=>{
    const source=node,fixture=document.createElement('p'),css=getComputedStyle(source);for(const key of css)fixture.style.setProperty(key,css.getPropertyValue(key));Object.assign(fixture.style,{position:'fixed',left:'0px',top:'0px',width:css.width,height:'auto',margin:'0px',transform:'none'});fixture.id='p0-rich-text-fixture';document.body.append(fixture);node=fixture;
    node.innerHTML='<span style="font-size:11px;line-height:1.4">Small office </span><span style="font-size:20px;line-height:1.8;font-weight:700">LARGE text </span><span style="font-size:14px;line-height:2">different leading and more words wrap onto the next line correctly.</span>';
  })
  await capture('#p0-rich-text-fixture','mounted-rich-mixed-sizes-leading')
  await page.locator('#p0-rich-text-fixture').evaluate(node=>{
    node.innerHTML='<u>Underline jumping glyphs</u> and <s>strike through office</s> with <mark style="background-color:rgb(255,230,100)">highlighted words across a wrapped line</mark>.';
  })
  await capture('#p0-rich-text-fixture','mounted-rich-decorations')
  await page.locator('#p0-rich-text-fixture').evaluate(node=>{
    node.innerHTML='<span style="font-size:24px"><u>jumping <span>glyphs</span></u> <s>strike <span>nested</span></s> <mark style="background-color:rgb(255,230,100)"><span>nested highlight wraps</span></mark></span>';
  })
  await capture('#p0-rich-text-fixture','mounted-rich-large-nested-decorations')
  await page.locator('#p0-rich-text-fixture').evaluate(node=>node.innerHTML='<span style="text-decoration:underline wavy">Keep unsupported decoration in the semantic editor.</span>')
  const unsupported=await capture('#p0-rich-text-fixture','mounted-rich-custom-decoration-refused')
  assert.ok(unsupported.blockers.includes('TEXT_DECORATION_STYLE_UNSUPPORTED'))
  await page.locator('#p0-rich-text-fixture').evaluate(node=>node.remove())
  await capture('article[data-node-id="note"] .node-drag-handle strong','mounted-title')
  await page.locator('article[data-node-id="note"] .node-drag-handle strong').evaluate(node=>{window.__titleWeight=node.style.fontWeight;node.style.fontWeight='600'})
  await capture('article[data-node-id="note"] .node-drag-handle strong','mounted-title-weight600')
  await page.locator('article[data-node-id="note"] .node-drag-handle strong').evaluate(node=>node.style.fontWeight=window.__titleWeight)
  await capture('article[data-node-id="note"] .node-drag-handle > span','mounted-kind-tag')
  await capture('article[data-node-id="column"] .column-header-copy > strong','mounted-column-title')
  await capture('article[data-node-id="column"] .column-header-copy > small','mounted-column-badge')
  await capture('article[data-node-id="column"] .column-header > button','mounted-column-collapse')
  await page.locator('article[data-node-id="rich"] .tiptap p').first().evaluate(node=>{window.__bodyStyle=node.style.fontStyle;node.style.fontStyle='italic'})
  await capture('article[data-node-id="rich"] .tiptap p','mounted-rich-italic-font-probe')
  await page.locator('article[data-node-id="rich"] .tiptap p').first().evaluate(node=>node.style.fontStyle=window.__bodyStyle)
  await page.getByRole('button',{name:'Document',exact:true}).click();await page.locator('.tiptap p').first().waitFor()
  await capture('.tiptap p','mounted-document-kicker')
  await capture('.tiptap p:nth-of-type(2)','mounted-document-intro')
  await capture('.tiptap p:last-child','mounted-document-body')
  await page.screenshot({path:resolve(output,'ACTUAL_DOCUMENT.png'),fullPage:true})
}finally {
  await page.evaluate(()=>{window.__session?.dispose();window.__resolveFont?.dispose()}).catch(()=>{})
  await writeFile(resolve(output,'TEXT_LAYOUT_BROWSER.json'),JSON.stringify({checkedAt:new Date().toISOString(),baseUrl,dpr,sourceHash:createHash('sha256').update(source).digest('hex'),wasmHash:createHash('sha256').update(wasm).digest('hex'),receipts,errors,limitations:['Native command body executes in a read-only CLI; this does not certify packaged WebView2, native Tauri IPC, IME or screen readers.','The diagnostic clone uses exact measured font/CSS geometry and black-on-white for independent glyph coverage comparison; semantic editor content is unchanged.']},null,2));await browser.close()
}
const required=['mounted-rich-arabic-bidi-ltr','mounted-rich-arabic-bidi-rtl','mounted-rich-mixed-sizes-leading','mounted-rich-decorations','mounted-rich-large-nested-decorations']
for(const label of required){const result=receipts.find(receipt=>receipt.label===label);assert.ok(result?.prepared?.completePaint&&result.prepared.operationCount>0&&result.pixels?.passed,'Required qualified text pixel acceptance: '+label)}
for(const receipt of receipts.filter(receipt=>receipt.pixels))assert.ok(receipt.pixels.passed,'Text pixel acceptance: '+receipt.label)
assert.deepEqual(errors,[],'No browser page errors')
