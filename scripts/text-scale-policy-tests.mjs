import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
let semanticSource=await fs.readFile('src/canvas-engine/semanticTextPaint.ts','utf8')
const ast=ts.createSourceFile('semanticTextPaint.ts',semanticSource,ts.ScriptTarget.Latest,true)
const replacements=[]
for(const node of ast.statements)if(ts.isFunctionDeclaration(node)&&node.body&&['captureSemanticParagraph','measureSemanticTextLines'].includes(node.name?.text)){
 replacements.push({start:node.body.getStart(ast),end:node.body.end,text:node.name.text==='captureSemanticParagraph'?'{ return globalThis.__textScaleFixture.capture(); }':'{ return globalThis.__textScaleFixture.lines; }'})
}
assert.equal(replacements.length,2,'Control only DOM measurement boundaries; retain the actual preparation/shaping branches')
for(const change of replacements.sort((a,b)=>b.start-a.start))semanticSource=semanticSource.slice(0,change.start)+change.text+semanticSource.slice(change.end)
const budget={acquire:()=>({resize:()=>true,release(){}}),releaseOwner(){}}
globalThis.__textScaleFixture={budget}
const {createTextPaintSession}=await import(url('const canvasResourceBudget=globalThis.__textScaleFixture.budget;const normalizeMeasuredColor=value=>value;\n'+compile(semanticSource).replace(/^import .*$/gm,'').replace(/^export .* from '\.\/nativeTextFonts';?$/gm,'')))
const prepared=new Map(),shapeRequests=[]
const engine={shape(json){const request=JSON.parse(json);shapeRequests.push(request);return JSON.stringify({paragraphDirection:request.baseDirection??'ltr',lines:[{textRange:[0,new TextEncoder().encode(request.text).length],advance:10,baseline:10,height:12,offset:0}],operationLines:[0],operations:[{type:'vector',object:{id:'probe:outline',kind:'vector',transform:request.transform,payload:{commands:[['M',0,0],['L',10,0],['L',10,10],['Z']]}}}],runs:[{font:{contentHash:'controlled-unqualified-font',faceIndex:0}}]})},resource_stats:()=> '{}',free(){}}
const session=createTextPaintSession(engine,'controlled-epoch',budget)
for(const [id,text,direction,expected]of [['latin','A','ltr',false],['complex','中','ltr',true],['rtl-latin','A','rtl',true]]){
 const line={layoutStart:0,layoutEnd:text.length,sourceStart:0,sourceEnd:text.length,x:0,y:0,width:10,height:12,baseline:10}
 globalThis.__textScaleFixture.lines=[line]
 globalThis.__textScaleFixture.capture=()=>({request:{schema:'art-equation.shaped-text',schemaVersion:1,id,revision:'1',fontEpoch:'controlled-epoch',text,maxWidth:100,alignment:'left',transform:[1,0,0,1,0,0],spans:[],overflowWrap:'normal',wrapMode:'nowrap'},measurement:{direction,blockers:[],clientLines:[]},fonts:[]})
 const element={id,innerHTML:text,isConnected:true}
 const result=await session.prepare(element,{id,revision:'1',transform:[1,0,0,1,0,0],resolveFont:async()=>{throw new Error('unexpected font lookup')},rasterScale:2,canonicalRead:read=>read()})
 assert.equal(result.qualification?.scaleDependent,expected,JSON.stringify({id,blockers:result.blockers}))
 assert.equal(shapeRequests.at(-1).outlineScale,expected?2:undefined,'Retention metadata matches the actual backing-scale hinting request')
 assert.equal(result.completePaint,false,'Controlled font/engine boundaries must not claim pixel qualification')
 prepared.set(id,result)
}
globalThis.__textScaleProviders={createTextPaintSession:()=>({prepare:async element=>prepared.get(element.id),dispose(){}}),loadVelloEngine:async()=>({TextEngine:class{}}),createNativeTextFontResolver:()=>({dispose(){}}),createSvgEffectProvider:()=>({retireExcept(){},dispose(){}})}
const providerSource=compile(await fs.readFile('src/project-b/p0-surface/cardProviders.ts','utf8')).replace(/^import .*$/gm,'')
const {createMeasuredCardProviders}=await import(url('const {createTextPaintSession,loadVelloEngine,createNativeTextFontResolver,createSvgEffectProvider}=globalThis.__textScaleProviders;\n'+providerSource))
const providers=createMeasuredCardProviders({epoch:1}),transaction=providers.forCapture()
for(const id of prepared.keys()){
 await transaction.providers.text({id},{id:id+':box-0:text',revision:1,sourceFingerprint:'controlled',contentTransform:[1,0,0,1,0,0],canonicalRead:read=>read()})
 assert.equal(transaction.scalePolicyFor(id).exactScale,prepared.get(id).qualification.scaleDependent,'Provider consumes the prepared shaping receipt')
}
prepared.set('unknown',{completePaint:true,operations:[],blockers:[],release(){}})
await transaction.providers.text({id:'unknown'},{id:'unknown:box-0:text',revision:1,sourceFingerprint:'controlled',contentTransform:[1,0,0,1,0,0],canonicalRead:read=>read()})
assert.equal(transaction.scalePolicyFor('unknown').exactScale,true,'Missing scale metadata remains conservative')
transaction.release();providers.dispose();session.dispose()
console.log('Text scale policy: PASS (actual unhinted/complex/RTL shaping branches and provider receipt consumption; controlled layout/engine, no font or pixel qualification)')

