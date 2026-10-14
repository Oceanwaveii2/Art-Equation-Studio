import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

// Exercise the production function with the real keyed scheduler. Controlled
// clock evidence checks ordering and coalescing, not native latency targets.
const source = await fs.readFile('src/App.tsx', 'utf8')
const start = source.indexOf('  function presentViewport(viewport: BoardViewport) {')
const end = source.indexOf('\n  function commitViewport(', start)
assert(start >= 0 && end > start)
const transpile = source => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const url = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64')
const {FrameScheduler} = await import(url(transpile(await fs.readFile('src/canvas-engine/frameScheduler.ts','utf8'))))
const {LiveCamera} = await import(url(transpile(await fs.readFile('src/canvas-engine/liveCamera.ts','utf8'))))
const queued = new Map(); let next = 0, queries = 0, commits = 0
const scheduler = new FrameScheduler({request:f=>{queued.set(++next,f);return next},cancel:id=>queued.delete(id)})
const camera = new LiveCamera({x:0,y:0,scale:1}), presentations = []
const viewportRef = {current:camera.current}, stageRef = {current:{dataset:{}}}, membership = {current:'a'}
const env = {presentedViewportRef:viewportRef,frameScheduler:scheduler,stageRef,MIN_CANVAS_ZOOM:.1,MAX_CANVAS_ZOOM:10,
 presentCamera:(_,view)=>presentations.push(view),liveCamera:camera,vectorQueryOutsetCssPx:16,
 spatialIndex:{query:()=>{queries++;return[{id:'a'},{id:viewportRef.current.x>20?'b':'a'}]}},
 stageSize:{width:500,height:500},visibleDiagramIds:new Set(['a','b']),selectedIds:[],nodeById:new Map(),mountedMembership:membership,
 setPresentedViewport:()=>commits++,publishInputMetrics:()=>{}}
const fn = new Function(...Object.keys(env),transpile(source.slice(start,end))+';return presentViewport')(...Object.values(env))
fn({x:10,y:0,scale:1})
assert.equal(camera.current.x,10,'camera must reach renderer before scheduler rAF')
assert.equal(presentations.length,1,'accepted-pixel reprojection must be immediate')
assert.equal(queries,0,'membership scan remains deferred')
fn({x:30,y:5,scale:1}); fn({x:40,y:10,scale:1})
assert.equal(camera.current.x,40)
assert.equal(queued.size,1,'burst must share one membership rAF')
for(const [id,run] of queued){queued.delete(id);run(16)}
assert.equal(queries,1);assert.equal(commits,1);assert.equal(membership.current,'a\nb')
fn({x:0,y:0,scale:1}) // cancelled gesture restores original camera immediately
assert.deepEqual(camera.current,{x:0,y:0,scale:1})
scheduler.flush('viewport')
assert.equal(membership.current,'a');assert.equal(commits,2)
scheduler.dispose()
console.log('PASS immediate camera delivery, latest-input coalescing, deferred membership and cancellation restore; native performance not qualified')
