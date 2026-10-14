import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import fs from 'node:fs/promises'
registerHooks({resolve(s,c,next){try{return next(s,c)}catch(e){if(s.startsWith('.'))return next(s+'.ts',c);throw e}}})
const {createSelectorStore}=await import('../src/state/selectorStore.ts')
const {AppFrameClock}=await import('../src/canvas-engine/appFrameClock.ts')
const {virtualRange}=await import('../src/ui/virtualRange.ts')
const {moveContainerWithDescendants}=await import('../src/board/diagramStructureCore.ts')
const {recordNativeCommand,undoNativeCommand,redoNativeCommand}=await import('../src/board/nativeCommandJournal.ts')
const {GraphColumnRuntime,createGraphColumnItem,bindGraphColumnInputs}=await import('../src/board/graphColumnV2.ts')
const {modelEqual}=await import('../src/state/modelEquality.ts')
let checks=0
const check=(name,work)=>{work();checks++;console.log('PASS',name)}
check('independent field subscribers ignore unrelated state and synchronous edits compose',()=>{
 const model={boards:[],documents:[],assets:[]},store=createSelectorStore({model,tool:'select',selection:[]})
 const content=store.select(s=>s.model),tool=store.select(s=>s.tool)
 let modelEvents=0,toolEvents=0
 const off=content.subscribe(()=>modelEvents++),offTool=tool.subscribe(()=>toolEvents++)
 store.field('tool','hand');store.field('tool','hand');store.field('selection',['a'])
 assert.equal(modelEvents,0);assert.equal(toolEvents,1);assert.equal(store.revision,2)
 store.field('model',previous=>({...previous,boards:['one']}))
 store.field('model',previous=>({...previous,documents:['two']}))
 assert.equal(modelEvents,2);assert.deepEqual(content.getSnapshot().boards,['one']);assert.deepEqual(content.getSnapshot().documents,['two'])
 assert.equal(content.getSnapshot().assets,model.assets)
 off();offTool();store.field('tool','zoom');assert.equal(toolEvents,1)
})
check('shared frame clock coalesces owners, phases, cancellation, exceptions and reentrancy',()=>{
 let id=0;const pending=new Map(),errors=[],events=[]
 const clock=new AppFrameClock({request:cb=>{pending.set(++id,cb);return id},cancel:id=>pending.delete(id)},e=>errors.push(e))
 const tick=()=>{const jobs=[...pending.values()];pending.clear();jobs.forEach(cb=>cb(16))}
 clock.request(()=>events.push('paint'),'present')
 clock.request(()=>{events.push('input');clock.request(()=>events.push('update'),'update');clock.request(()=>events.push('next-input'),'input')},'input')
 const cancelled=clock.request(()=>assert.fail('cancelled callback'),'present');clock.cancel(cancelled)
 clock.request(()=>{throw Error('failed view')},'update');clock.request(()=>events.push('after'),'after')
 assert.equal(pending.size,1);tick();assert.deepEqual(events,['input','update','paint','after']);assert.equal(errors.length,1)
 assert.equal(pending.size,1);tick();assert.equal(events.at(-1),'next-input');assert.equal(pending.size,0)
 const last=clock.request(()=>assert.fail('cancelled last owner'));clock.cancel(last);assert.equal(pending.size,0)
})
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze)};return value}
check('family movement shares unrelated geometry; undo/redo and serialized saves preserve exact data',()=>{
 const nodes=Array.from({length:300},(_,i)=>({id:'n'+i,kind:'text',title:'text '+i,body:'full original '+i,x:i*200,y:0,width:100,height:100}))
 nodes[0]={...nodes[0],kind:'group'};nodes[1]={...nodes[1],groupId:'n0'}
 const before=freeze({id:'b',title:'board',viewport:{x:0,y:0,scale:1},nodes,connectors:[]})
 const moved=moveContainerWithDescendants(before.nodes,before.connectors,['n0'],{x:12.5,y:-7});assert.equal(moved.ok,true)
 const after={...before,nodes:moved.value.nodes,connectors:moved.value.connectors}
 assert.equal(before.nodes[0].x,0);assert.equal(after.nodes[0].x,12.5);assert.equal(after.nodes[1].x,before.nodes[1].x+12.5)
 for(let i=2;i<nodes.length;i++)assert.equal(after.nodes[i],before.nodes[i])
 const undo=[],redo=[];recordNativeCommand(undo,redo,before,after)
 assert.equal(undoNativeCommand(undo,redo),before);assert.equal(redoNativeCommand(undo,redo),after)
 assert.deepEqual(JSON.parse(JSON.stringify(after)).nodes,after.nodes)
 assert(modelEqual(after,{...after}));assert(!modelEqual(after,{...after,title:'changed'}))
})
check('variable-height list window is bounded and preserves first/last rows and total extent',()=>{
 const heights=Array.from({length:10000},(_,i)=>i%3===0?80:40)
 const first=virtualRange(heights,0,600);assert.equal(first.first,0);assert(first.last<25)
 const middle=virtualRange(heights,200000,600);assert(middle.first>1000);assert(middle.last-middle.first<30)
 assert.equal(middle.total,heights.reduce((a,b)=>a+b,0))
 const end=virtualRange(heights,middle.total-600,600);assert.equal(end.last,10000)
 assert.deepEqual(virtualRange([],0,600).offsets,[0])
})
check('graph cache ignores source position/camera changes but refreshes text, quality and attributes',()=>{
 const source={id:'s',kind:'image',title:'original',body:'<p>full text</p>',assetId:'media',x:0,y:0,width:200,height:100}
 let board={id:'b',title:'graph',viewport:{x:0,y:0,scale:1},nodes:[source,createGraphColumnItem('g',{x:500,y:0},[])],connectors:[]}
 board=bindGraphColumnInputs(board,'g',['s']);const runtime=new GraphColumnRuntime()
 const assets=[{id:'media',status:'available',extension:'png',byteLength:100,imageDimensions:{width:400,height:200}}]
 const first=runtime.evaluate(board,'g',assets),count=runtime.evaluations
 assert.equal(runtime.evaluate({...board,viewport:{x:500,y:300,scale:.1}},'g',assets),first)
 const moved={...board,nodes:board.nodes.map(n=>n.id==='s'?{...n,x:100,y:50}:n)}
 assert.equal(runtime.evaluate(moved,'g',assets),first);assert.equal(runtime.evaluations,count)
 const resized={...moved,nodes:moved.nodes.map(n=>n.id==='s'?{...n,width:240}:n)}
 assert.notEqual(runtime.evaluate(resized,'g',assets),first)
 const missing=runtime.evaluate(resized,'g',[{...assets[0],status:'missing'}]);assert.equal(missing.value[0].media.status,'missing')
 const changed=runtime.evaluate({...resized,nodes:resized.nodes.map(n=>n.id==='s'?{...n,body:'<p>edited</p>'}:n)},'g',assets)
 assert.equal(changed.value[0].html,'<p>edited</p>')
})
const app=await fs.readFile('src/App.tsx','utf8')
assert(!/const initialBoard = structuredClone/.test(app),'gesture entry must not clone full boards')
assert(app.includes('new FrameScheduler(appInputClock)'))
console.log(`Controller optimization: PASS (${checks} behavioral checks; no performance qualification)`)
