import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {resolve,dirname} from 'node:path'
import ts from 'typescript'
import {geometryModuleUrl,p0GeometrySourceHashes} from './p0-test-module-loader.mjs'

// Offline real adapter/geometry and real compact identity helper. Measures all
// fixture objects, not actual browser mounted visibility or input-to-commit.
const files=['src/board/artEquationCanvasAdapter.ts','src/board/diagramStructureCore.ts','src/canvasTheme.ts','src/board/velloEligibility.ts','src/canvas-engine/paintDisplayList.ts','src/board/VelloBoardBackdrop.tsx','src/project-b/p0-surface/captureScenePaint.ts','src/canvas-engine/contracts.ts','src/canvas-engine/liveScene.ts']
const texts=Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(file,'utf8')])))
const hashes={...p0GeometrySourceHashes,...Object.fromEntries(files.map(file=>[file,createHash('sha256').update(texts[file]).digest('hex')]))}
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64')
const compile=(text,fileName='probe.ts')=>ts.transpileModule(text,{fileName,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText
const core=url(compile(texts['src/board/diagramStructureCore.ts'])),theme=url(compile(texts['src/canvasTheme.ts']))
let adapterCode=compile(texts['src/board/artEquationCanvasAdapter.ts'])
for(const [path,replacement] of [['../canvasTheme',theme],['./velloVectorGeometry',geometryModuleUrl],['./diagramStructureCore',core]])adapterCode=adapterCode.replace(`from '${path}'`,`from '${replacement}'`)
const {createArtEquationCanvasScene}=await import(url(adapterCode))
const eligibility=await import(url(compile(texts['src/board/velloEligibility.ts']))),display=await import(url(compile(texts['src/canvas-engine/paintDisplayList.ts'])))
globalThis.__paintKeyProbeEligible=eligibility.eligibleVelloObjects;globalThis.__paintKeyProbeDisplay=display.compileVectorPaintList
const backdrop=compile(texts['src/board/VelloBoardBackdrop.tsx'],'probe.tsx').replace(/^import .*$/gm,'')
const {velloDisplayListSnapshot}=await import(url('const eligibleVelloObjects=globalThis.__paintKeyProbeEligible,compileVectorPaintList=globalThis.__paintKeyProbeDisplay;\n'+backdrop))
const {createMountedPaintKeys}=await import(url(compile(texts['src/project-b/p0-surface/captureScenePaint.ts']).replace(/^import .*$/gm,'')))
const fixture=resolve(process.argv[2]||'../fixtures/workspace/projects/p1-v2-studies/project.json'),bytes=await readFile(fixture),project=JSON.parse(bytes.toString('utf8'))
const measure=(fn,samples=10)=>{const timings=[];let result;for(let index=0;index<samples;index++){const begin=performance.now();result=fn();timings.push(performance.now()-begin)}timings.sort((a,b)=>a-b);return{samples,chars:typeof result==='string'?result.length:0,minMs:timings[0],medianMs:timings[Math.floor(samples/2)],maxMs:timings.at(-1)}}
const results=[]
for(const id of ['BasketballMohawks','sample-miami-by-giordano-poloni','sample-vision-by-nastka-drabot']){
 const board=project.boards.find(board=>board.id===id),begin=performance.now(),scene=createArtEquationCanvasScene(board,project.assets,{background:'#191b20',grid:'#3a3f49'}),adapterMs=performance.now()-begin
 const vectors=velloDisplayListSnapshot(scene,[],1,true),dirty={global:0,objects:scene.objects.map(object=>[object.id,0]),mounted:scene.objects.map((object,index)=>[object.id,index])},keys=createMountedPaintKeys()
 const fullReference=measure(()=>JSON.stringify({animationTick:0,scene:{...scene,revision:0},vectors:{...JSON.parse(vectors.json),revision:0},scale:1,dpr:1,dirty}))
 const cardsReference=measure(()=>scene.objects.map(object=>JSON.stringify({scene:scene.id,object,dpr:1,global:0,local:0})).join(''))
 const fullCompact=measure(()=>JSON.stringify({animationTick:0,scene:keys.scene(scene),vectorIds:[...vectors.ids],scale:1,dpr:1,dirty}))
 const cardsCompact=measure(()=>scene.objects.map(object=>JSON.stringify({scene:scene.id,object:keys.object(object),dpr:1,global:0,local:0})).join(''))
 const hrefs=board.nodes.filter(node=>node.vectorTexture?.href).map(node=>node.vectorTexture.href).sort((a,b)=>b.length-a.length)
 const fingerprintJsonProxy=hrefs.length?measure(()=>JSON.stringify({scene:id,revision:1,objectRevision:1,camera:{x:0,y:0,scale:1},html:`<article><svg><image href='${hrefs[0]}'/></svg></article>`,styles:[]}),5):undefined
 const sceneJson=JSON.stringify(scene)
 const objectFieldChars={};for(const object of scene.objects)for(const [field,value] of Object.entries(object))objectFieldChars[field]=(objectFieldChars[field]??0)+JSON.stringify(value).length
 results.push({id,nodes:board.nodes.length,textureCount:hrefs.length,textureHrefChars:hrefs.reduce((total,href)=>total+href.length,0),sceneChars:sceneJson.length,objectFieldChars,containsInlineDataInScene:sceneJson.includes('data:image/'),adapterMs,vectorJsonChars:vectors.json.length,fullReference,cardsReference,fullCompact,cardsCompact,fingerprintJsonProxy})
}
const report={schema:'art-equation.offline-paint-key-cost',generatedAt:new Date().toISOString(),scope:'ALL_FIXTURE_OBJECTS_OFFLINE_KEY_COST_ONLY',fixture:{path:fixture,sha256:createHash('sha256').update(bytes).digest('hex')},sourceHashes:hashes,results,limitations:['All objects included; actual DOM virtualization/mounted subset is not measured.','Node.js serialization and actual immutable adapter/geometry only; no browser DOM capture, GPU, input-to-commit or acceptance measurement.','Fingerprint JSON proxy includes the largest actual inline texture URL in synthetic minimal article HTML; excludes outerHTML construction, computed styles and provider work.','Reference rows reproduce the previous full-object key expressions; compact rows use the production identity helper and key shapes. Exact vector JSON comparison is retained without reparsing.']}
const output=resolve(process.argv[3]||'../evidence/paint-key-offline-cost.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({output,scope:report.scope,fixtureSha256:report.fixture.sha256,results},null,2))
