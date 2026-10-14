import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const modules = new Map()
function load(name, trim = false) {
  const file = path.resolve(name)
  if (modules.has(file)) return modules.get(file)
  let source = fs.readFileSync(file,'utf8')
  if (trim) source = source.slice(0,source.indexOf('let tiffWorkers:'))
  const output = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  const exports = {}; modules.set(file,exports)
  new Function('require','exports',output)(specifier => load(path.resolve(path.dirname(file),specifier+'.ts')),exports)
  return exports
}
const { CanvasResourceBudget } = load('src/canvas-engine/resourceBudget.ts')
const { RetainedPaintCompiler } = load('src/canvas-engine/retainedPaintCompiler.ts')
const { compileVectorPaintList } = load('src/canvas-engine/paintDisplayList.ts')
const { preparationPolicy } = load('src/canvas-engine/preparationPolicy.ts')
const { PreparationWorkers,PreparationAdmission } = load('src/board/preparationWorkers.ts',true)
const { planPyramid, planDirectionalPrefetch, requiredPyramidLevel, pyramidDetailState } = load('src/canvas-engine/imagePyramid.ts')
const { maximumTransformScale } = load('src/canvas-engine/imageDemand.ts')

const host = fs.readFileSync('src/board/VelloBoardBackdrop.tsx','utf8')
const ast = ts.createSourceFile('host.tsx',host,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['commands','velloVectorRecord','velloBoardSnapshot'].includes(node.name?.text)).map(node => node.getText(ast).replace(/^export /,'')).join('\n')
const { velloVectorRecord, velloBoardSnapshot } = new Function('eligibleVelloObjects',ts.transpileModule(helpers,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return {velloVectorRecord,velloBoardSnapshot}')(scene=>scene.objects)
const budget = new CanvasResourceBudget({total:200000,pools:{retained:200000,'tile-atlas':0,'tile-surface':0}})
const compiler = new RetainedPaintCompiler(budget)
let objects = Array.from({length:12},(_,i)=>Object.freeze({id:'vector-'+i,order:(i%3),bounds:{x:i*50,y:20,width:40,height:50},locked:i%2===0,appearance:{opacity:.4+i*.01,fill:'#12345678',stroke:'#ddeecc',strokeWidth:i%3,strokeScaling:i%2?'scene':'screen',vectorFillRule:i%2?'evenodd':'nonzero'},vectorPath:{closed:i%2===0,points:[{x:0,y:0,handleOut:{x:3,y:2}},{x:4,y:7,handleIn:{x:1,y:-2}}]}}))
const compile = (scale=1,sceneId='scene') => compiler.compile(sceneId,'1',objects,object=>object.appearance.strokeScaling==='scene'||object.appearance.strokeWidth===0?1:scale,object=>velloVectorRecord(object,scale))
const oracle = scale => compileVectorPaintList(JSON.parse(velloBoardSnapshot({id:'scene',revision:1,objects},[],scale).json))
for (const scale of [1,1,.5,2,2,.25]) assert.deepEqual(JSON.parse(compile(scale).json),oracle(scale),'Retained paint preserves the existing path/order/alpha/stroke oracle')
const before = compile(.25)
assert.equal(compile(.25).stats.builds,before.stats.builds,'Camera translation does not rebuild fragments')
assert.equal(compile(.25).damage.world.length,0)
const generationOnly=compiler.compile('scene','999',objects,object=>object.appearance.strokeScaling==='scene'||object.appearance.strokeWidth===0?1:.25,object=>velloVectorRecord(object,.25))
assert.equal(generationOnly.json,before.json,'Enclosing generation changes do not assemble a full vector scene')
const changed = {...objects[3],bounds:{...objects[3].bounds,x:1000}}
objects=objects.map((object,index)=>index===3?changed:object)
const edit=compile(.25)
assert.equal(edit.stats.builds,before.stats.builds+1,'One edit rebuilds exactly one retained fragment')
assert.deepEqual(edit.damage.world,[{x:150,y:20,width:40,height:50},changed.bounds])
objects=objects.slice(1); assert.equal(compile(.25).ids.has('vector-0'),false)
assert.ok(compile(.25,'another').damage.sceneChanged)
compiler.clear(); assert.equal(budget.snapshot().bytes,0,'All retained leases are released')
const deniedBudget=new CanvasResourceBudget({total:0,pools:{retained:0,'tile-atlas':0,'tile-surface':0}})
const denied = new RetainedPaintCompiler(deniedBudget)
assert.deepEqual(JSON.parse(denied.compile('scene','1',objects,()=>1,o=>velloVectorRecord(o,1)).json),oracle(1),'Memory denial keeps the complete uncached render')
denied.clear(); assert.equal(deniedBudget.snapshot().bytes,0)
assert.throws(()=>compiler.compile('scene','1',[objects[0],objects[0]],()=>1,o=>velloVectorRecord(o,1)),/duplicate/)
compiler.clear()
for(const cores of [1,2,4,8,64,NaN]) { const policy=preparationPolicy(cores); assert.ok(policy.workers>=1&&policy.workers<=4); if(cores>=4)assert.ok(policy.workers<=cores-2) }
assert.equal(preparationPolicy(64,512).workers,1)
assert.equal(preparationPolicy(64,NaN).workers,1)

const fakes=[]
const create=()=>{const worker={sent:[],postMessage(message){this.sent.push(message)},terminate(){this.stopped=true},onmessage:null,onerror:null};fakes.push(worker);return worker}
const pool=new PreparationWorkers(create,{workers:4,queued:4,workingBytes:20,taskBytes:10},2000)
const aborts=Array.from({length:6},()=>new AbortController())
const request=(id,priority=0)=>pool.run(id,{signal:aborts[id].signal,bytes:10,priority})
const a=request(0),b=request(1),c=request(2),d=request(3,100)
assert.equal(pool.snapshot().workers,2,'Working-memory admission caps actual concurrent jobs')
assert.equal(pool.snapshot().workingBytes,20)
const firstMessage=fakes[0].sent[0]
aborts[0].abort(); await assert.rejects(a,/cancelled/)
assert.ok(fakes[0].stopped,'Cancelling active decode retires the worker immediately')
assert.equal(fakes.at(-1).sent[0].payload,3,'Selected work gets the next available slot')
fakes[0].onmessage({data:{id:firstMessage.id,result:'stale'}})
assert.equal(pool.snapshot().completed,0,'Late result cannot commit after cancellation')
const finish=(worker,value)=>worker.onmessage({data:{id:worker.sent.at(-1).id,result:value}})
finish(fakes[1],'second'); assert.equal(await b,'second')
const third=fakes.find(worker=>worker.sent.at(-1)?.payload===2&&!worker.stopped)
finish(third,'third'); assert.equal(await c,'third')
const selected=fakes.find(worker=>worker.sent.at(-1)?.payload===3&&!worker.stopped)
finish(selected,'selected'); assert.equal(await d,'selected')
assert.equal(pool.snapshot().workingBytes,0)
await assert.rejects(pool.run(5,{signal:aborts[5].signal,bytes:11}),/limit/)
pool.dispose(); await assert.rejects(request(4),/disposed/)
const timed=new PreparationWorkers(create,{workers:1,queued:1,workingBytes:10,taskBytes:10},10)
await assert.rejects(timed.run('timeout',{signal:new AbortController().signal}),/timed out/)
assert.equal(timed.snapshot().workingBytes,0); timed.dispose()

const shared=new PreparationAdmission(2,20),workersA=[],workersB=[]
const makeFor=group=>()=>{const worker={sent:[],stopped:false,onmessage:null,onerror:null,postMessage(message){this.sent.push(message)},terminate(){this.stopped=true}};group.push(worker);return worker}
const policyForShared={workers:2,queued:4,workingBytes:20,taskBytes:10}
const poolA=new PreparationWorkers(makeFor(workersA),policyForShared,1000,shared),poolB=new PreparationWorkers(makeFor(workersB),policyForShared,1000,shared)
const a1=poolA.run('a1',{signal:new AbortController().signal,bytes:10}),a2=poolA.run('a2',{signal:new AbortController().signal,bytes:10})
const bAbort=new AbortController(),b1=poolB.run('b1',{signal:bAbort.signal,bytes:10})
assert.equal(shared.snapshot().active,2);assert.equal(workersB.length,0,'Different pool cannot exceed aggregate admission')
finish(workersA[0],'a1');await a1;await Promise.resolve()
assert.equal(workersB.length,1,'Shared release wakes another pool');assert.equal(shared.snapshot().workingBytes,20)
bAbort.abort();await assert.rejects(b1,/cancelled/);finish(workersA[1],'a2');await a2
assert.equal(shared.snapshot().active,0);assert.equal(shared.snapshot().workingBytes,0)
poolA.dispose();poolB.dispose()

const pyramid={width:16384,height:16384,maxLevel:14}
const required=requiredPyramidLevel(pyramid,1), tiles=planPyramid(pyramid,{x:0,y:0,width:16384,height:16384},1)
assert.ok(tiles[0].level<required)
assert.equal(pyramidDetailState(tiles.length,tiles.length,0,tiles[0].level,required,1,1),'budget-limited','Resident lower mip cannot claim full detail')
assert.equal(pyramidDetailState(4,3,0,14,14,1,1),'refining')
assert.equal(pyramidDetailState(4,4,0,14,14,.5,1),'budget-limited','Downsampled backing cannot claim full detail')
assert.equal(pyramidDetailState(4,4,0,14,14,1,1),'ready')
assert.equal(pyramidDetailState(4,4,1,14,14,1,1),'error')
assert.equal(pyramidDetailState(0,0,0,14,14,1,1),'refining')
const view={x:1024,y:1024,width:512,height:512},visible=planPyramid(pyramid,view,1)
const ahead=planDirectionalPrefetch(pyramid,visible,view,{...view,x:512})
assert.ok(ahead.every(tile=>tile.x>=1536),'Lookahead follows the panning direction')
assert.ok(ahead.length<=2&&ahead.every(tile=>!visible.some(item=>item.key===tile.key)),'Prefetch is bounded and never competes with visible membership')
assert.equal(maximumTransformScale([1,0,0,3]),3,'DPI demand uses both transform axes')
assert.ok(maximumTransformScale([1,0,1,1])>Math.hypot(1,1),'Shear uses the conservative singular value')
console.log('Engine 2.6 correctness: PASS (paint oracle, bounded memory, scoped edits, teardown, priority, cancellation, stale response, timeout, mip/backing readiness; no performance qualification)')
