import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dataUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const measurementSource=await readFile(new URL('../src/canvas-engine/measuredColor.ts',import.meta.url),'utf8')
const textSource=await readFile(new URL('../src/canvas-engine/semanticTextPaint.ts',import.meta.url),'utf8')
const moduleSource=compile(textSource).replace("'./measuredColor'",JSON.stringify(dataUrl(compile(measurementSource))))
const budgetSource=compile(await readFile(new URL('../src/canvas-engine/resourceBudget.ts',import.meta.url),'utf8'))
const nativeFonts=compile(await readFile('src/canvas-engine/nativeTextFonts.ts','utf8')).replace("'./resourceBudget'",JSON.stringify(dataUrl(budgetSource)))
const {CanvasResourceBudget}=await import(dataUrl(budgetSource))
const {parseCssFontFamilies,parseCssFontFeatures,utf8Offsets,collapseCssWhitespace,createNativeTextFontResolver,compareTextLineWidths,createTextPaintSession}=await import(dataUrl(moduleSource.replaceAll("'./nativeTextFonts'",JSON.stringify(dataUrl(nativeFonts))).replace("'./resourceBudget'",JSON.stringify(dataUrl(budgetSource)))))
const cases=[],check=async(name,fn)=>{await fn();cases.push(name)}
await check('computed semantic OpenType features preserve editor ligature and kerning controls',()=>{
  assert.deepEqual(parseCssFontFeatures('"liga" 0'),{liga:0});assert.deepEqual(parseCssFontFeatures('"kern" off, "ss01" on'),{kern:0,ss01:1});assert.deepEqual(parseCssFontFeatures('normal','none'),{kern:0})
  for(const bad of ['liga 0','"bad" 0','"liga" -1','"liga" 65536','"liga" nope'])assert.throws(()=>parseCssFontFeatures(bad))
})
await check('CSS family list preserves quoted commas, spaces, escapes and declared fallback order',()=>{
  assert.deepEqual(parseCssFontFamilies('"Example, Serif", \'Noto Sans\', Arial, sans-serif'),['Example, Serif','Noto Sans','Arial','sans-serif'])
  assert.deepEqual(parseCssFontFamilies('"A\\"B", serif'),['A"B','serif'])
  for(const invalid of ['', '"unclosed', 'bad\\'])assert.throws(()=>parseCssFontFamilies(invalid))
})
await check('UTF-16 offsets map to real UTF-8 bytes and refuse surrogate splitting',()=>{
  assert.deepEqual(utf8Offsets('Aé中🦄'),[0,1,3,6,-1,10]);assert.deepEqual(utf8Offsets('x\u0301'),[0,1,3])
  for(const invalid of ['\ud800','\udfff','A\ud800Z'])assert.throws(()=>utf8Offsets(invalid))
})
await check('normal CSS whitespace map preserves semantic offsets across differently styled spans',()=>{
  const source=['  A ',' \tB\n',' C  '],collapsed=collapseCssWhitespace(source)
  assert.equal(collapsed.pieces.join(''),'A B C');assert.equal(collapsed.sourceToLayoutUtf16.length,source.join('').length+1)
  assert.equal(collapsed.sourceToLayoutUtf16.at(-1),5);assert.equal(source.join(''),'  A  \tB\n C  ')
  assert.deepEqual(collapseCssWhitespace(['  \n','\t']).pieces,['',''])
  assert.equal(collapseCssWhitespace(['A\u00a0',' B']).pieces.join(''),'A\u00a0 B')
})
const receipt={bytesBase64:Buffer.from([0,1,2,255]).toString('base64'),contentHash:'a'.repeat(64),faceIndex:2,requestedFamily:'Example',resolvedFamily:'Real Example',resolvedWeight:400,resolvedStyle:'normal',synthesisRequired:false,axes:[]}
await check('native resolver passes exact family attributes and reuses one pending resolution',async()=>{
  const calls=[],resolve=createNativeTextFontResolver(async(command,args)=>{calls.push({command,args});return receipt})
  const request={family:'Example',weight:400,italic:false},[a,b]=await Promise.all([resolve(request),resolve(request)])
  assert.equal(calls.length,1);assert.equal(calls[0].command,'resolve_system_font');assert.deepEqual(calls[0].args,{request});assert.equal(a,b)
  assert.equal(a.key,`${receipt.contentHash}:2`);assert.deepEqual([...a.bytes],[0,1,2,255]);assert.equal(a.resolvedFamily,'Real Example');resolve.dispose()
})
await check('malformed native identity, bytes and selected-face metadata cannot reach a text paint request',async()=>{
  for(const change of [{bytesBase64:''},{bytesBase64:'%%%='},{bytesBase64:'A='},{bytesBase64:'===='},{faceIndex:-1},{faceIndex:1.5},{contentHash:'wrong'},{resolvedWeight:NaN},{resolvedFamily:''},{axes:null},{synthesisRequired:null},{requestedFamily:'fabricated'}]) {
    const resolve=createNativeTextFontResolver(async()=>({...receipt,...change}));await assert.rejects(resolve({family:'Example',weight:400,italic:false}));resolve.dispose()
  }
})
await check('native failures are retryable and never become a fabricated fallback face',async()=>{
  let attempts=0;const resolve=createNativeTextFontResolver(async()=>{if(++attempts===1)throw new Error('FONT_FAMILY_NOT_FOUND');return receipt})
  const req={family:'Example',weight:400,italic:false};await assert.rejects(resolve(req),/FONT_FAMILY_NOT_FOUND/);await resolve(req);assert.equal(attempts,2)
  resolve.dispose()
})
await check('native font and bounded shaper leases release and reject denied shared budget',async()=>{
  const budget=new CanvasResourceBudget({total:100,pools:{retained:50,'tile-surface':50,'tile-atlas':50}})
  const resolve=createNativeTextFontResolver(async()=>receipt,budget);await resolve({family:'Example',weight:400,italic:false});assert.equal(budget.snapshot().bytes,4);assert.equal(resolve.stats().bytes,4);resolve.dispose();assert.equal(budget.snapshot().bytes,0);await assert.rejects(resolve({family:'Example',weight:400,italic:false}),/DISPOSED/)
  const deniedBudget=new CanvasResourceBudget({total:0,pools:{retained:0,'tile-surface':0,'tile-atlas':0}}),denied=createNativeTextFontResolver(async()=>receipt,deniedBudget);await assert.rejects(denied({family:'Example',weight:400,italic:false}),/FONT_RESOURCE_LIMIT/);assert.equal(deniedBudget.snapshot().bytes,0);denied.dispose()
  let disposed=0;const session=createTextPaintSession({free(){disposed++},resource_stats(){return '{}'}},'epoch',deniedBudget);const result=await session.prepare(null,{id:'x',revision:'1',transform:[1,0,0,1,0,0],resolveFont:denied});assert.equal(result.completePaint,false);assert(result.blockers[0].includes('RESOURCE_LIMIT'));session.dispose();session.dispose();assert.equal(disposed,1)
})
await check('fragment union compares true CSS line widths and explicitly keeps paint partial',()=>{
  const shaped={lines:[{advance:42,trailingWhitespace:2},{advance:24,trailingWhitespace:0}]}
  const rectangles=[{x:20,y:40,width:30,height:20},{x:50,y:40,width:50,height:20},{x:20,y:80,width:48,height:20}]
  const result=compareTextLineWidths(shaped,rectangles,2);assert.equal(result.passed,true);assert.equal(result.completePaint,false);assert.deepEqual(result.differences,[0,0])
  assert.equal(compareTextLineWidths(shaped,rectangles,1).passed,false);assert.equal(compareTextLineWidths(shaped,rectangles.slice(0,2),2).passed,false)
  for(const scale of [0,-1,NaN,Infinity])assert.equal(compareTextLineWidths(shaped,rectangles,scale).passed,false)
})
let wasmHash=null,fontHashes={}
if(!process.argv.includes('--semantic-only')) {
  const wasm=await readFile(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm',import.meta.url))
  const engine=await import(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm.js',import.meta.url));await engine.default({module_or_path:wasm});wasmHash=createHash('sha256').update(wasm).digest('hex')
  assert.equal(typeof engine.TextEngine,'function','current generated WASM must include the actual shared text engine')
  const e=new engine.TextEngine('node-font-epoch')
  for(const [key,file] of [['latin','NotoSans-wdth-wght.ttf'],['arabic','NotoSansArabic-wdth-wght.ttf']]) {
    const bytes=await readFile(new URL(`../engine/vello-surface/rust/fixtures/fonts/${file}`,import.meta.url));fontHashes[key]=createHash('sha256').update(bytes).digest('hex')
    const receipt=JSON.parse(e.register_font(key,'1',0,bytes));assert.equal(receipt.contentHash,fontHashes[key]);assert.equal(receipt.faceIndex,0)
  }
  const request=text=>({schema:'art-equation.shaped-text',schemaVersion:1,id:'node-shaped',revision:'1',fontEpoch:'node-font-epoch',text,maxWidth:400,alignment:'left',transform:[1,0,0,1,12,10],spans:[{start:0,end:Buffer.byteLength(text),fonts:[{key:'latin',revision:'1'},{key:'arabic',revision:'1'}],fontSize:24,color:'#000000ff'}]})
  const shape=req=>JSON.parse(e.shape(JSON.stringify(req)))
  await check('actual WASM shapes ligatures, combining clusters and declared Arabic fallback',()=>{
    const ffi=shape(request('office ffi'));assert(ffi.glyphs.length<'office ffi'.length)
    const mark=shape(request('x\u0301'));assert(mark.glyphs.some(g=>g.advance===0))
    const arabic=shape(request('hello سلام'));assert(arabic.runs.some(r=>r.rtl&&r.font.key==='arabic'))
    assert.equal(arabic.completePaint,false);assert.deepEqual(arabic.blockers,['TEXT_DOM_LAYOUT_PARITY_PENDING'])
  })
  await check('actual WASM layout wraps, positions spaces, variable axes and real styled decorations',()=>{
    const wrap=request('one two three four five');wrap.maxWidth=95;assert(shape(wrap).lines.length>1)
    const normal=shape(request('Variable')),bold=request('Variable');bold.spans[0].fontWeight=700;assert.notDeepEqual(shape(bold).runs[0].normalizedCoords,normal.runs[0].normalizedCoords)
    const decorated=request('word');decorated.spans[0].underline=true;decorated.spans[0].highlight='#ffff0080';assert(shape(decorated).operations.some(o=>o.object.id.endsWith('underline')))
  })
  await check('actual WASM enforces the caller outline scratch limit before emission',()=>{
    const tiny=request('Bounded font outline scratch');tiny.maxCommands=1;assert.throws(()=>shape(tiny),/TEXT_RESOURCE_LIMIT/)
    tiny.maxCommands=0;assert.throws(()=>shape(tiny),/TEXT_INPUT_INVALID/)
    const normal=request('font');normal.maxCommands=1024;assert(shape(normal).operations.length>0)
  })
  await check('same actual positioned outline list renders through genuine CPU at backing scales 1 and 2',()=>{
    const paint=shape(request('office سلام')),list={schema:'art-equation.display-list',schemaVersion:2,sceneId:'text-fixture',revision:'1',environment:{background:'#00000000',colorSpace:'srgb'},resources:[],operations:paint.operations}
    for(const scale of [1,2]){const pixels=engine.render_cpu_snapshot(400*scale,120*scale,JSON.stringify(list),scale,0,0);const count=pixels.filter((_,index)=>index%4===3&&pixels[index]>0).length;assert(count>200*scale)}
  })
  await check('actual WASM refuses stale resource identities, absent glyphs, synthetic faces and malformed spans',()=>{
    const epoch=request('x');epoch.fontEpoch='old';assert.throws(()=>shape(epoch),/FONT_EPOCH_STALE/)
    const revision=request('x');revision.spans[0].fonts[0].revision='old';assert.throws(()=>shape(revision),/FONT_REVISION_STALE/)
    const italic=request('x');italic.spans[0].fontStyle='italic';assert.throws(()=>shape(italic),/FONT_SYNTHESIS_UNSUPPORTED/)
    const malformed=request('سلام');malformed.spans[0].end=1;assert.throws(()=>shape(malformed),/TEXT_INPUT_INVALID/)
    assert.throws(()=>shape(request('🦄')),/FONT_GLYPH_MISSING/)
  })
  await check('actual font registry clears cached outlines and refuses removed fonts',()=>{
    assert(JSON.parse(e.resource_stats()).outlineCommands>0);e.remove_font('latin');assert.equal(JSON.parse(e.resource_stats()).outlineCommands,0);assert.throws(()=>shape(request('x')),/FONT_NOT_READY/);e.free()
  })
}
const evidence=process.env.P0_TEXT_EVIDENCE_DIR?pathToFileURL(resolve(process.env.P0_TEXT_EVIDENCE_DIR)+'/'):new URL('../output/playwright/shaped-text/',import.meta.url);await mkdir(evidence,{recursive:true})
await writeFile(new URL(process.argv.includes('--semantic-only')?'SEMANTIC_TEXT_TESTS.json':'SHAPED_TEXT_WASM_TESTS.json',evidence),JSON.stringify({checkedAt:new Date().toISOString(),passed:true,checks:cases.length,cases,wasmHash,fontHashes,sourceHash:createHash('sha256').update(textSource).digest('hex'),limits:['Semantic HTML/editing/IME/accessibility remains DOM authoritative.','Line width comparisons never certify font pixels, baseline or whole-component ownership.','Actual browser/GPU/native acceptance requires separate evidence.']},null,2))
console.log(JSON.stringify({passed:true,checks:cases.length,wasmHash}))

