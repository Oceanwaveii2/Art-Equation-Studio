import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const files = ['src/board/measuredCardPaint.ts', 'src/board/completeMeasuredCardPaint.ts', 'src/board/completeMeasuredCardPaint.css', 'src/canvas-engine/paintDisplayList.ts']
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])))
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const compile = source => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const measuredUrl = url(compile(sources.get(files[0])))
const {measuredCameraMatrixCurrent}=await import(measuredUrl)
const backgroundUrl = url(compile(await readFile(new URL('../src/board/measuredBackgroundPaint.ts', import.meta.url), 'utf8')).replace(/from ['"]\.\/measuredCardPaint(?:\.ts)?['"]/g,`from '${measuredUrl}'`))
const module = await import(url(compile(sources.get(files[1])).replace(/from ['"]\.\/measuredCardPaint(?:\.ts)?['"]/g,`from '${measuredUrl}'`).replace(/from ['"]\.\/measuredBackgroundPaint(?:\.ts)?['"]/g,`from '${backgroundUrl}'`)))
const {splitCssPaintList,parseMeasuredLinearGradient,parseMeasuredBoxShadows,measuredShadowRadius,compileCompleteCardPaint,withCanonicalCardPaint,withCanonicalStageCardPaint,emptyUnpaintedCardLeaf,measuredSvgWorldMatrix}=module
const checks=[],check=(name,body)=>{body();checks.push(name)},near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`)
const box=(extra={})=>({id:'card',size:{width:200,height:100},transform:[1,0,0,1,20,30],radii:[[8,8],[8,8],[8,8],[8,8]],background:'#223344ff',gradients:[],shadows:[],borderWidths:[1,1,1,1],borderColors:['#8899aaff','#8899aaff','#8899aaff','#8899aaff'],opacity:1,clipContent:true,isolation:'auto',blendMode:'normal',zIndex:0,sourceOrder:0,contributions:[],children:[],...extra})
const metadata={objectId:'card',objectRevision:4,order:3,layoutRevision:7,sourceFingerprint:'actual-layout-fingerprint'}
const glyph=(id)=>({type:'vector',object:{id,kind:'vector',transform:[1,0,0,1,20,30],payload:{commands:[['M',10,10],['L',12,10],['L',12,20],['Z']],fill:'#ffffffff',strokeWidth:0}}})
const contribution=(id,extra={})=>({completePaint:true,sourceFingerprint:metadata.sourceFingerprint,operations:[glyph(id)],visualBounds:{x:30,y:40,width:2,height:10},...extra})
const ids=result=>result.operations.flatMap(op=>op.type==='vector'?[op.object.id]:['gradient','image','blurredRoundedRect'].includes(op.type)?[op.id]:[])
const balanced=result=>{const stack=[];for(const op of result.operations){if(op.type==='pushClip'||op.type==='pushComposite')stack.push(op.scopeId);else if(op.type==='pop')assert.equal(stack.pop(),op.scopeId)}assert.equal(stack.length,0)}

check('camera preflight accepts CSSOM fractional serialization and rejects physically stale pan/zoom/skew',()=>{
  const camera={x:34.61351688609335,y:33.44893959920452,scale:.9786316094148843},viewport={width:483,height:566},matrix={a:.978632,b:0,c:0,d:.978632,e:34.6135,f:33.4489,is2D:true}
  assert(measuredCameraMatrixCurrent(matrix,camera,viewport))
  for(const patch of[{e:matrix.e+.02},{a:matrix.a+.001},{c:.001},{is2D:false},{f:NaN}])assert(!measuredCameraMatrixCurrent({...matrix,...patch},camera,viewport))
  assert(!measuredCameraMatrixCurrent(matrix,{...camera,scale:0},viewport));assert(!measuredCameraMatrixCurrent(matrix,camera,{width:0,height:566}))
})
check('SVG user-space CTM preserves anisotropic viewBox, reflection, skew and article rotation once',()=>{
  const camera={x:34.61351688609335,y:33.44893959920452,scale:.9786316094148843},origin={x:20,y:70},world=[1.9,.4,.3,-1.3,190,80],matrix={a:world[0]*camera.scale,b:world[1]*camera.scale,c:world[2]*camera.scale,d:world[3]*camera.scale,e:world[4]*camera.scale+camera.x+origin.x,f:world[5]*camera.scale+camera.y+origin.y,is2D:true}
  measuredSvgWorldMatrix(matrix,camera,origin).forEach((value,index)=>near(value,world[index]))
  const {is2D,...legacySvgMatrix}=matrix;measuredSvgWorldMatrix(legacySvgMatrix,camera,origin).forEach((value,index)=>near(value,world[index]))
  for(const patch of[{is2D:false},{a:NaN},{a:0,b:0,c:0,d:0}])assert.equal(measuredSvgWorldMatrix({...matrix,...patch},camera,origin),null)
})

check('CSS token list retains nested sRGB functions/rgba commas and refuses unbalanced source',()=>{
  assert.deepEqual(splitCssPaintList('linear-gradient(rgb(1, 2, 3), color(srgb 1 0 0 / .5)), linear-gradient(rgba(4, 5, 6, .4), rgb(7, 8, 9))').length,2)
  for(const invalid of ['rgb(1,2,3','a),b','a,,b'])assert.throws(()=>splitCssPaintList(invalid))
})
check('default linear-gradient spans actual box height and preserves alpha',()=>{
  const gradient=parseMeasuredLinearGradient('linear-gradient(rgb(0, 0, 0), rgba(255, 255, 255, 0.5))',{width:200,height:100})
  near(gradient.start[0],100);near(gradient.start[1],0);near(gradient.end[0],100);near(gradient.end[1],100)
  assert.deepEqual(gradient.stops,[{offset:0,color:'#000000ff'},{offset:1,color:'#ffffff80'}]);assert.equal(gradient.alphaInterpolation,'premultiplied')
})
check('diagonal CSS direction uses magic corners and explicit angles preserve physical stops',()=>{
  const gradient=parseMeasuredLinearGradient('linear-gradient(to top right, rgb(0, 0, 0), rgb(255, 255, 255))',{width:200,height:100})
  near(gradient.start[0],60);near(gradient.start[1],130);near(gradient.end[0],140);near(gradient.end[1],-30)
  const horizontal=parseMeasuredLinearGradient('linear-gradient(90deg, rgb(0, 0, 0) 20px, rgb(255, 0, 0) 50%, rgb(255, 255, 255))',{width:200,height:100})
  near(horizontal.stops[0].offset,.1);near(horizontal.stops[1].offset,.5)
})
check('CSS stop fixup distributes unspecified colors, clamps decreasing stops and extends out of range',()=>{
  const gradient=parseMeasuredLinearGradient('linear-gradient(rgb(0, 0, 0) -50%, rgb(255, 0, 0), rgb(0, 255, 0) 25%, rgb(0, 0, 255) 10%, rgb(255, 255, 255) 150%)',{width:200,height:100})
  near(gradient.start[1],-50);near(gradient.end[1],150);assert.deepEqual(gradient.stops.map(stop=>stop.offset),[0,.1875,.375,.375,1])
  for(const invalid of ['radial-gradient(rgb(0,0,0),rgb(1,1,1))','linear-gradient(in oklab, rgb(0,0,0),rgb(1,1,1))','linear-gradient(rgb(0,0,0), 25%, rgb(1,1,1))','linear-gradient(to left right,rgb(0,0,0),rgb(1,1,1))'])assert.throws(()=>parseMeasuredLinearGradient(invalid,{width:200,height:100}))
})
check('computed outer/inset shadows preserve color, offsets, blur and signed spread',()=>{
  assert.deepEqual(parseMeasuredBoxShadows('rgba(0, 0, 0, 0.4) 0px 10px 28px -2px, rgb(255, 255, 255) 0px 1px 0px 0px inset'),[
    {color:'#00000066',offsetX:0,offsetY:10,blur:28,spread:-2,inset:false},{color:'#ffffffff',offsetX:0,offsetY:1,blur:0,spread:0,inset:true}])
  for(const invalid of ['rgb(0,0,0) 0px 0px -4px','url(a) 0px 0px','rgb(0,0,0) 2em 0px'])assert.throws(()=>parseMeasuredBoxShadows(invalid))
})
check('CSS spread preserves sharp corners and uses published small-radius growth correction',()=>{
  near(measuredShadowRadius(10,20),27.5);near(measuredShadowRadius(0,20),0);near(measuredShadowRadius(8,-10),0);near(measuredShadowRadius(8,2),10)
})
check('padding-box gradient origin generates actual repeating tiles under translucent borders',()=>{
  const result=compileCompleteCardPaint(box({gradientOrigin:{x:1,y:1,width:198,height:98},gradients:[parseMeasuredLinearGradient('linear-gradient(rgb(0,0,0),rgb(255,255,255))',{width:198,height:98})]}),metadata)
  assert.equal(result.completePaint,true);balanced(result);const tiles=result.operations.filter(op=>op.type==='gradient');assert.equal(tiles.length,9);const middle=tiles.find(op=>op.id.endsWith('tile-0-0'));near(middle.gradient.start[1],1);near(middle.gradient.end[1],99);const top=tiles.find(op=>op.id.endsWith('tile-0--1'));near(top.gradient.start[1],-97)
})
check('complete card emits ordered shadow/background/gradient/border/header/content/glyph/media with clips',()=>{
  const imageRef={key:'photo',revision:4,epoch:2,width:2,height:2},upload={reference:imageRef,pixels:new Uint8Array(16)}
  const value=box({gradients:[parseMeasuredLinearGradient('linear-gradient(rgb(0,0,0),rgb(100,100,100))',{width:200,height:100})],shadows:parseMeasuredBoxShadows('rgba(0,0,0,.4) 0px 10px 28px'),children:[
    box({id:'header',size:{width:198,height:37},transform:[1,0,0,1,21,31],radii:[[0,0],[0,0],[0,0],[0,0]],shadows:[],borderWidths:[0,0,1,0],borderColors:['#00000000','#00000000','#ffffff12','#00000000'],sourceOrder:1,contributions:[contribution('header-glyph')]}),
    box({id:'body',size:{width:198,height:61},transform:[1,0,0,1,21,68],sourceOrder:2,contributions:[contribution('body-glyph'),contribution('photo',{operations:[{type:'image',id:'photo',resource:imageRef,sourceRect:{x:0,y:0,width:2,height:2},transform:[20,0,0,20,30,75],opacity:1,sampling:'bilinear'}],uploads:[upload]})]})]})
  const result=compileCompleteCardPaint(value,metadata);assert.equal(result.completePaint,true);assert.equal(result.status,'ready');balanced(result)
  const order=ids(result);for(const [before,after] of [['card:outer-shadow-0:blur','card:background'],['card:background','card:gradient-0'],['card:gradient-0','card:border'],['card:border','header:background'],['header:background','header-glyph'],['header-glyph','body:background'],['body:background','body-glyph'],['body-glyph','photo']])assert(order.indexOf(before)<order.indexOf(after),`${before} must precede ${after}`)
  assert.equal(result.uploads[0],upload);assert(result.visualBounds.y<30);assert(result.visualBounds.height>100)
})
check('typed background image and gradient contributions remain rounded-clipped behind borders and content',()=>{
  const result=compileCompleteCardPaint(box({backgrounds:[contribution('cover-image'),contribution('cover-overlay')],contributions:[contribution('card-label')]}),metadata)
  assert.equal(result.completePaint,true);balanced(result)
  const order=ids(result)
  for(const [before,after] of [['card:background','cover-image'],['cover-image','cover-overlay'],['cover-overlay','card:border'],['card:border','card-label']])assert(order.indexOf(before)<order.indexOf(after))
  for(const index of [0,1])assert(result.operations.some(op=>op.type==='pushClip'&&op.scopeId===`card:background-layer-${index}`))
  for(const extra of [{completePaint:false},{sourceFingerprint:'obsolete'}, {blockers:['BACKGROUND_IMAGE_SOURCE_STALE']}]){
    const rejected=compileCompleteCardPaint(box({backgrounds:[contribution('bad-cover',extra)]}),metadata)
    assert.equal(rejected.completePaint,false);assert.deepEqual(rejected.operations,[]);assert.deepEqual(rejected.uploads,[])
  }
})
check('CSS first background/shadow layer is topmost and inset uses true destination-out hole',()=>{
  const gradients=[parseMeasuredLinearGradient('linear-gradient(rgb(255,0,0),rgb(255,0,0))',{width:200,height:100}),parseMeasuredLinearGradient('linear-gradient(rgb(0,0,255),rgb(0,0,255))',{width:200,height:100})]
  const result=compileCompleteCardPaint(box({gradients,shadows:parseMeasuredBoxShadows('rgb(255,0,0) 1px 1px 2px, rgb(0,0,255) 2px 2px 4px, rgba(255,255,255,.1) 0px 1px 2px inset')}),metadata)
  assert.equal(result.completePaint,true);balanced(result);const order=ids(result);assert(order.indexOf('card:outer-shadow-1:blur')<order.indexOf('card:outer-shadow-0:blur'));assert(order.indexOf('card:gradient-1')<order.indexOf('card:gradient-0'));assert(result.operations.some(op=>op.type==='pushComposite'&&op.blendMode==='destination-out'));near(result.operations.find(op=>op.id==='card:outer-shadow-0:blur').stdDeviation,1)
})
check('opacity groups whole subtree once and negative/positive z-index branches preserve authored order',()=>{
  const result=compileCompleteCardPaint(box({opacity:.5,isolation:'isolate',contributions:[contribution('root-glyph')],children:[box({id:'high',zIndex:2,sourceOrder:1}),box({id:'low',zIndex:-1,sourceOrder:2}),box({id:'middle',zIndex:0,sourceOrder:3})]}),metadata)
  assert.equal(result.completePaint,true);balanced(result);assert.equal(result.operations[0].type,'pushComposite');near(result.operations[0].opacity,.5)
  const order=ids(result);assert(order.indexOf('low:background')<order.indexOf('root-glyph'));assert(order.indexOf('root-glyph')<order.indexOf('middle:background'));assert(order.indexOf('middle:background')<order.indexOf('high:background'))
})
check('missing/incomplete/stale glyph or media contribution refuses whole card with no operations/uploads',()=>{
  for(const extra of [{completePaint:false},{sourceFingerprint:'old'},{blockers:['FONT_NOT_READY']}]){const result=compileCompleteCardPaint(box({contributions:[contribution('glyph',extra)]}),metadata);assert.equal(result.completePaint,false);assert.equal(result.status,'unsupported');assert.deepEqual(result.operations,[]);assert.deepEqual(result.uploads,[])}
})
check('invalid matrix, geometry, excessive nested layout and duplicate IDs fail closed',()=>{
  for(const value of [box({transform:[1,0,0,0,0,0]}),box({size:{width:NaN,height:10}}),box({radii:[[NaN,0],[0,0],[0,0],[0,0]]}),box({children:[box({id:'card'})]})])assert.equal(compileCompleteCardPaint(value,metadata).completePaint,false)
  let tree=box({id:'nested-0'});for(let i=1;i<35;i++)tree=box({id:`nested-${i}`,children:[tree]});assert.equal(compileCompleteCardPaint(tree,metadata).completePaint,false)
})
check('asymmetric elliptical shadow refuses full ownership until shared effect can represent it',()=>{
  const result=compileCompleteCardPaint(box({radii:[[4,8],[8,8],[8,8],[8,8]],shadows:parseMeasuredBoxShadows('rgb(0,0,0) 0px 5px 10px')}),metadata)
  assert.equal(result.completePaint,false);assert(result.blockers.includes('CARD_ASYMMETRIC_SHADOW_PENDING'));assert.equal(result.operations.length,0)
})
check('complete CSS marker hides visual descendants while preserving hit/accessibility/interaction overlay',()=>{
  const css=sources.get(files[2]);assert(css.includes('[data-vello-card-paint="complete"]'));assert(css.includes('opacity: 0'));assert(css.includes(':not(.node-transform-box)'));assert(!/pointer-events\s*:\s*none|display\s*:\s*none|visibility\s*:\s*hidden/.test(css))
})
check('zero-area empty inline label skips only genuinely absent paint, retaining visible effects',()=>{
  const leaf={textContent:'',children:[]},style={backgroundColor:'rgba(0,0,0,0)',backgroundImage:'none',boxShadow:'none',textShadow:'none',filter:'none',backdropFilter:'none',borderImageSource:'none',maskImage:'none',clipPath:'none',borderTopWidth:'0px',borderRightWidth:'0px',borderBottomWidth:'0px',borderLeftWidth:'0px',outlineStyle:'none',outlineWidth:'0px'}
  assert(emptyUnpaintedCardLeaf(leaf,style,{width:0,height:14}))
  assert(!emptyUnpaintedCardLeaf(leaf,style,{width:20,height:14}))
  for(const extra of [{backgroundColor:'red'},{backgroundImage:'linear-gradient(red,blue)'},{boxShadow:'black 0px 0px 4px'},{borderTopWidth:'4px'},{outlineStyle:'solid',outlineWidth:'2px'},{filter:'blur(3px)'},{backdropFilter:'blur(6px)'}])assert(!emptyUnpaintedCardLeaf(leaf,{...style,...extra},{width:0,height:14}))
  assert(!emptyUnpaintedCardLeaf({...leaf,textContent:'visible'},style,{width:0,height:14}));assert(!emptyUnpaintedCardLeaf({...leaf,children:[{}]},style,{width:0,height:14}))
})
check('canonical stage observer reads every original owner and restores exact markers through errors',()=>{
  const article=values=>{const attributes=new Map(Object.entries(values));return{attributes,getAttribute:key=>attributes.get(key)??null,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)}}
  const one=article({'data-vello-card-paint':'complete','data-vello-paint':'true'}),two=article({'data-vello-card-paint':'complete','data-vello-card-canonical-read':'previous'}),three=article({})
  const stage={querySelectorAll:()=>[one,two,three]},before=[one,two,three].map(item=>[...item.attributes])
  for(const error of [false,true]){try{withCanonicalStageCardPaint(stage,()=>{for(const item of[one,two,three]){assert.equal(item.getAttribute('data-vello-card-paint'),null);assert.equal(item.getAttribute('data-vello-paint'),null);assert.equal(item.getAttribute('data-vello-card-canonical-read'),'true')}if(error)throw Error('expected')})}catch(e){assert.equal(e.message,'expected')};assert.deepEqual([one,two,three].map(item=>Object.fromEntries(item.attributes)),before.map(entries=>Object.fromEntries(entries)))}
  assert.throws(()=>withCanonicalStageCardPaint(stage,()=>Promise.resolve()),/MUST_BE_SYNCHRONOUS/)
})
check('canonical owned-card reads restore exact marker values before promises/errors escape',()=>{
  const attributes=new Map([['data-vello-card-paint','complete'],['data-vello-paint','true']]),element={getAttribute:key=>attributes.get(key)??null,removeAttribute:key=>attributes.delete(key),setAttribute:(key,value)=>attributes.set(key,value)}
  assert.equal(withCanonicalCardPaint(element,()=>{assert.equal(attributes.get('data-vello-card-paint'),undefined);assert.equal(attributes.get('data-vello-paint'),undefined);assert.equal(attributes.get('data-vello-card-canonical-read'),'true');return 'real-css'}),'real-css');assert.equal(attributes.get('data-vello-card-paint'),'complete');assert.equal(attributes.get('data-vello-paint'),'true')
  assert.throws(()=>withCanonicalCardPaint(element,()=>{throw Error('style failure')}));assert.equal(attributes.size,2)
  assert.throws(()=>withCanonicalCardPaint(element,()=>Promise.resolve('must not wait')),/MUST_BE_SYNCHRONOUS/);assert.equal(attributes.size,2)
})

const output={schema:'art-equation.complete-card-paint-tests',date:new Date().toISOString(),passed:checks.length,checks,sourceHashes:Object.fromEntries([...sources].map(([file,source])=>[file,createHash('sha256').update(source).digest('hex')])),limitations:['Pure complete ordered compiler tests; actual DOM/CSS capture and backend pixel qualification are separate gates','Qualified glyph/image provider fixtures are explicit operations, not fake production font acceptance','No native app launch or user data changes']}
const target=new URL('../../docs/engine-p0/2026-10-03/artwork-coverage/',import.meta.url);await mkdir(target,{recursive:true});await writeFile(new URL('COMPLETE_CARD_PAINT_TESTS.json',target),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2))

// Separate actual mounted-CSS fixture: production JSX note header/body, not a
// hand-written replacement. It deliberately has NO fake glyph provider.
const appSource=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('App.tsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let header,body
const find=node=>{if(ts.isJsxElement(node)){const open=node.openingElement.getText(ast);if(open.includes('className="node-drag-handle"')&&node.getText(ast).includes('isFrameNode(node)'))header??=node.getText(ast);if(open.includes('className="node-copy"')&&node.getText(ast).includes('{node.body}'))body??=node.getText(ast)}ts.forEachChild(node,find)};find(ast);assert(header&&body,'Actual production note JSX must exist')
const require=createRequire(new URL('../package.json',import.meta.url)),{renderToStaticMarkup}=require('react-dom/server')
const actual=await import(url(ts.transpileModule(`const nodeTitle=node=>node.title;const isFrameNode=()=>false;export const note=node=><>${header}${body}</>;`,{fileName:'actual-card.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ['"]react\/jsx-runtime['"]/g,`from '${pathToFileURL(require.resolve('react/jsx-runtime')).href}'`)))
const noteMarkup=renderToStaticMarkup(actual.note({id:'note',kind:'note',title:'Measured title',body:'A measured note uses the actual current card header, paper and paragraph.'}))
const fixture=`<!doctype html><html><head><meta charset="utf-8"><title>P0 complete card CSS capture</title><link rel="stylesheet" href="http://127.0.0.1:4183/src/App.css?direct"><style>body{margin:0;background:#12151a;color:#e8e4dc;font:12px 'Segoe UI',Arial,sans-serif}#fixture{display:block;position:relative;height:600px}#stage{position:absolute;left:20px;top:80px;width:1100px;height:430px;overflow:hidden}.board-world{position:absolute;inset:0;transform:translate(28px,28px) scale(.82);transform-origin:0 0}.board-object-layer{position:absolute;inset:0}#controls{padding:14px;display:flex;gap:12px}button{font:inherit}#output{position:absolute;left:20px;top:530px;white-space:pre-wrap}</style></head><body><main id="fixture" class="studio-shell"><div id="controls"><button id="capture">Capture actual cards</button><button id="theme">Toggle light theme</button><span>Actual App JSX and App.css; missing text stays explicit.</span></div><div id="stage" class="canvas-stage"><div class="board-world"><div class="board-object-layer"><article class="board-node node-note" data-node-id="empty" style="left:30px;top:30px;width:270px;height:140px;transform:rotate(0deg);--node-accent:#d7a36a"></article><article class="board-node node-note" data-node-id="note" style="left:350px;top:30px;width:270px;height:140px;transform:rotate(0deg);--node-accent:#d7a36a">${noteMarkup}</article><article class="board-node node-column" data-node-id="gradient" style="left:30px;top:230px;width:270px;height:140px;transform:rotate(0deg);--node-accent:#d7a36a"></article><article class="board-node node-note" data-node-id="video" style="left:350px;top:230px;width:270px;height:140px;transform:rotate(0deg);--node-accent:#d7a36a"><video aria-label="Unsupported dynamic provider"></video></article></div></div></div><pre id="output" aria-live="polite">Ready to capture.</pre></main><script type="module">import {captureCompleteMeasuredCardPaint} from 'http://127.0.0.1:4183/src/board/completeMeasuredCardPaint.ts';const stage=document.querySelector('#stage'),camera={x:28,y:28,scale:.82},objects=[['empty',30,30],['note',350,30],['gradient',30,230],['video',350,230]].map(([id,x,y],order)=>({id,revision:1,order,kind:'container',bounds:{x,y,width:270,height:140},localBounds:{x,y,width:270,height:140},zIndex:order,locked:false,hidden:false,appearance:{opacity:1,rotation:0}}));const scene={id:'actual-card-css-fixture',revision:1,objects,connections:[],environment:{background:'#00000000',grid:{visible:false,color:'#000',opacity:0,spacing:20}}};document.querySelector('#capture').onclick=async()=>{const results=[];for(const object of objects)results.push(await captureCompleteMeasuredCardPaint(stage,scene,object,camera));document.querySelector('#output').textContent=JSON.stringify(results.map(result=>({id:result.objectId,status:result.status,complete:result.completePaint,operations:result.operations.length,types:[...new Set(result.operations.map(op=>op.type))],blockers:result.blockers})),null,2);document.querySelector('#output').dataset.receipt=JSON.stringify(results)};document.querySelector('#theme').onclick=()=>document.querySelector('#fixture').classList.toggle('workspace-light');</script></body></html>`
const hosted=fixture.replaceAll('http://127.0.0.1:4183','')
  .replace('<style>','<link rel="stylesheet" href="/src/board/completeMeasuredCardPaint.css?direct"><link rel="stylesheet" href="/src/board/VelloBoardBackdrop.css?direct"><style>')
  .replace('<button id="theme">','<button id="owner">Toggle accepted empty-card ownership</button><button id="theme">')
  .replace('<button id="owner">','<button id="observe">Start real layout observer</button><button id="observer-read">Publish observer receipt</button><button id="owner">')
  .replace('const stage=document.querySelector','window.addEventListener("error",event=>document.querySelector("#output").textContent=String(event.error?.stack||event.message));window.addEventListener("unhandledrejection",event=>document.querySelector("#output").textContent=String(event.reason?.stack||event.reason));const paragraphs=[];const stage=document.querySelector')
  .replace('onclick=async()=>{const results=[];','onclick=async()=>{paragraphs.length=0;const results=[];')
  .replace('captureCompleteMeasuredCardPaint(stage,scene,object,camera)','captureCompleteMeasuredCardPaint(stage,scene,object,camera,{text:async(element,options)=>{const style=options.canonicalRead(()=>getComputedStyle(element));paragraphs.push({id:options.id,tag:element.tagName,text:element.textContent,family:style.fontFamily,contentTransform:options.contentTransform});return {completePaint:false,sourceFingerprint:options.sourceFingerprint,operations:[],visualBounds:{x:0,y:0,width:0,height:0},blockers:["TEXT_DOM_PARITY_PENDING"]}}})')
  .replace("dataset.receipt=JSON.stringify(results)","dataset.receipt=JSON.stringify(results);document.querySelector('#output').dataset.paragraphs=JSON.stringify(paragraphs)")
  .replace('</script></body>',`document.querySelector('#owner').onclick=()=>{const article=document.querySelector('[data-node-id="empty"]');if(article.dataset.velloCardPaint){delete article.dataset.velloCardPaint;delete article.dataset.velloPaint}else{article.dataset.velloCardPaint='complete';article.dataset.velloPaint='true'}observer?.invalidate()};import{observeMeasuredCardPaint}from'/src/board/useMeasuredCardPaint.ts';let observer,publicationCount=0,latestLayout;document.querySelector('#observe').onclick=()=>{observer?.dispose();publicationCount=0;observer=observeMeasuredCardPaint(stage,()=>({scene,viewport:camera}),snapshot=>{publicationCount++;latestLayout=snapshot;document.querySelector('#output').dataset.publications=String(publicationCount)})};document.querySelector('#observer-read').onclick=()=>{document.querySelector('#output').textContent='Real layout observer publications: '+publicationCount;document.querySelector('#output').dataset.layoutReceipt=JSON.stringify({publicationCount,snapshot:latestLayout})};</script></body>`)
await writeFile(new URL('COMPLETE_CARD_DOM_FIXTURE.html',target),hosted)
await writeFile(new URL('CARD_FIXTURE_SERVER.mjs',target),`import{createServer}from'node:http';import{readFile}from'node:fs/promises';createServer(async(request,response)=>{try{if(request.url==='/'){response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(await readFile(new URL('./COMPLETE_CARD_DOM_FIXTURE.html',import.meta.url)));return}const upstream=await fetch(\`http://127.0.0.1:4183\${request.url}\`);response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'text/plain'});response.end(Buffer.from(await upstream.arrayBuffer()))}catch(error){response.writeHead(500,{'content-type':'text/plain'});response.end(String(error))}}).listen(4187,'127.0.0.1',()=>console.log('Disposable measured card fixture: http://127.0.0.1:4187/'));`)
