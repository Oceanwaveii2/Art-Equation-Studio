import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
import {committedInputEvents,auditCommittedInputs} from './quality-evidence.mjs'

// Exercise the real tracker -> recordMetric -> DiagnosticBuffer -> native JSON
// payload -> evidence parser. Only the native command is controlled here.
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const load=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const {CanvasInputTracker}=await load(compile(await fs.readFile('src/diagnostics/canvasInput.ts','utf8')))
const {DiagnosticBuffer}=await load(compile(await fs.readFile('src/diagnostics/diagnosticBuffer.ts','utf8')))
const sends=[]
Object.assign(globalThis,{devicePixelRatio:2,innerWidth:1280,innerHeight:900,document:{visibilityState:'visible'},window:{dispatchEvent:()=>{}}})
globalThis.__inputMetricBoundary={CanvasInputTracker,DiagnosticBuffer,isTauri:()=>true,invoke:async(command,args)=>{assert.equal(command,'record_performance_batch');sends.push(args.batch)}}
const source=compile(await fs.readFile('src/diagnostics/performance.ts','utf8')).replace(/^import .*$/gm,'')
const app=await load('const {CanvasInputTracker,DiagnosticBuffer,isTauri,invoke}=globalThis.__inputMetricBoundary; const preparationWorkerSnapshot=()=>({workers:0,queued:0,workingBytes:0});\n'+source)
const rows=id=>app.diagnosticsSnapshot().rows.filter(row=>row.data.testId===id)
let checks=0
const check=(test,message)=>{assert(test,message);checks++}
const expectedById=new Map()
function recordCommit(id,commit){
 const expected=committedInputEvents(commit)
 app.recordMetric('input.commit',{testId:id,...commit})
 const actual=rows(id)
 assert.deepEqual(actual.flatMap(row=>committedInputEvents(row.data)),expected);checks++
 check(actual.length===Math.ceil(expected.length/128)&&actual.length<=4,'Every event fits in at most four 128-event rows')
 for(const [index,row] of actual.entries()){
  const events=committedInputEvents(row.data)
  check(events.length<=128&&row.data.coalesced===events.length&&row.data.inputChunkIndex===index&&row.data.inputChunks===actual.length&&row.data.inputBatchEvents===expected.length,'Chunk metadata describes the actual credited events')
  check(row.data.inputScope===commit.inputScope&&row.data.inputSeq===commit.inputSeq&&row.data.dropped===commit.dropped,'Scope, request identity and overflow stay truthful')
 }
 expectedById.set(id,expected)
 return actual
}

let now=0
const nine=new CanvasInputTracker(()=>now)
for(let i=0;i<9;i++){now=i*17;nine.mark(i%3===0?'zoom':'pan')}
now=150;const request=nine.begin();now=900;const nineCommit=nine.commit(request)
check(nineCommit.inputSamplesJson.length>160,'Observed nine-event regression exceeds the generic string allowance')
recordCommit('nine-mixed',nineCommit)
check(Math.max(...rows('nine-mixed').flatMap(row=>committedInputEvents(row.data)).map(event=>event.ms))===900,'Long input latency is retained without clamping')

const full=new CanvasInputTracker(()=>now)
for(let i=0;i<512;i++){now=1000+i;full.mark(i%2?'pan':'zoom')}
const fullRequest=full.begin();now=3000;recordCommit('full-queue',full.commit(fullRequest))

const overflow=new CanvasInputTracker(()=>now)
for(let i=0;i<513;i++){now=4000+i;overflow.mark(i%2?'zoom':'pan')}
const overflowRequest=overflow.begin();now=6000;const overflowCommit=overflow.commit(overflowRequest)
recordCommit('overflow',overflowCommit)
check(rows('overflow').every(row=>row.data.dropped===1),'Tracker overflow remains explicit in every chunk')

const stale=new CanvasInputTracker(()=>now)
now=7000;stale.mark('pan');now=7010;const earlier=stale.begin();now=7020;stale.mark('zoom')
now=7500;recordCommit('stale-first',stale.commit(earlier));now=7510;const later=stale.begin();now=8000;recordCommit('stale-second',stale.commit(later))
check(rows('stale-first')[0].data.pendingInputs===1&&rows('stale-second')[0].data.pendingInputs===0,'Later input waits for the generation that credits it')
const credited=new Set()
for(const [id] of expectedById)for(const row of rows(id))for(const event of committedInputEvents(row.data)){
 const key=row.data.inputScope+':'+event.seq;assert(!credited.has(key));credited.add(key)
}
checks++

const maximumEvents=Array.from({length:512},(_,index)=>({seq:Number.MAX_SAFE_INTEGER-511+index,kind:index%2?'pan':'zoom',ms:Number.MAX_VALUE}))
const worst={kind:maximumEvents.at(-1).kind,inputSeq:Number.MAX_SAFE_INTEGER,coalesced:512,oldestInputMs:Number.MAX_VALUE,latestInputMs:Number.MAX_VALUE,dropped:0,sampleSchema:1,inputScope:9999,inputSamplesJson:JSON.stringify(maximumEvents),requestToCommitMs:Number.MAX_VALUE,...Object.fromEntries(Array.from({length:20},(_,i)=>['extra'+i,'x'.repeat(160)]))}
recordCommit('largest-numeric',worst)
check(rows('largest-numeric').every(row=>Object.keys(row.data).length<=32&&new TextEncoder().encode(JSON.stringify(row)).length<=24_000),'Largest accepted numbers and generic extras respect field and row byte caps')

app.recordMetric('generic.test',{testId:'generic',short:'x'.repeat(160),long:'x'.repeat(161),inputSamplesJson:nineCommit.inputSamplesJson,...Object.fromEntries(Array.from({length:40},(_,i)=>['field'+i,i]))})
const generic=rows('generic')[0].data
check(generic.short.length===160&&!('long'in generic)&&!('inputSamplesJson'in generic)&&Object.keys(generic).length<=32,'Generic strings and field count retain their existing limits')

const malformed=[
 ['unknown-schema',{...nineCommit,sampleSchema:2}],
 ['wrong-count',{...nineCommit,coalesced:8}],
 ['wrong-age',{...nineCommit,oldestInputMs:899}],
 ['wrong-scope',{...nineCommit,inputScope:0}],
 ['text-content',{kind:'pan',inputSeq:1,coalesced:1,oldestInputMs:500,latestInputMs:500,dropped:0,sampleSchema:1,inputScope:10000,inputSamplesJson:JSON.stringify([{seq:1,kind:'pan',ms:500,content:'private-content'}])}],
 ['bad-json',{...nineCommit,inputSamplesJson:'not JSON'}],
 ['oversized-json',{...nineCommit,inputSamplesJson:' '.repeat(64_001)}],
]
for(const [id,data] of malformed){
 app.recordMetric('input.commit',{testId:id,...data})
 check(rows(id).length===1,'Invalid input evidence remains a recorded row')
 assert.throws(()=>committedInputEvents(rows(id)[0].data));checks++
 if(data.sampleSchema===1)check(!('inputSamplesJson'in rows(id)[0].data),'Malformed schema-1 event content receives no string exception')
}
check(!JSON.stringify(app.diagnosticsSnapshot()).includes('private-content'),'Extra event text cannot enter the trusted numeric payload')

const legacy={...nineCommit};delete legacy.sampleSchema;delete legacy.inputScope;delete legacy.inputSamplesJson
app.recordMetric('input.commit',{testId:'legacy',...legacy})
check(committedInputEvents(rows('legacy')[0].data)===null,'Legacy aggregates remain aggregate-only evidence')
app.recordMetric('input.commit',{testId:'legacy-invalid',...legacy,oldestInputMs:undefined})
assert.throws(()=>committedInputEvents(rows('legacy-invalid')[0].data));checks++

await app.exportDiagnostics()
const transported=sends.flatMap(batch=>JSON.parse(batch).rows)
for(const [id,expected] of expectedById){assert.deepEqual(transported.filter(row=>row.data.testId===id).flatMap(row=>committedInputEvents(row.data)),expected);checks++}
const transportedFull=transported.filter(row=>row.data.testId==='full-queue')
check(auditCommittedInputs(transportedFull).complete,'All four real transported chunks form complete event evidence')
for(const corrupt of [transportedFull.slice(1),transportedFull.slice(0,-1),[transportedFull[0],...transportedFull],transportedFull.toReversed()])check(!auditCommittedInputs(corrupt).complete,'Lost, duplicated or reordered real transport chunks cannot appear complete')
const inconsistent=structuredClone(transportedFull);inconsistent[1].data.inputBatchEvents=384;inconsistent[1].data.inputChunks=3
check(!auditCommittedInputs(inconsistent).complete,'Individually well-formed chunks with inconsistent whole-batch declarations reject')
check(!auditCommittedInputs(transported.filter(row=>row.data.testId==='overflow')).complete,'A tracker overflow never counts as complete event evidence')
check(sends.length>0&&sends.every(batch=>new TextEncoder().encode(batch).length<=256_000),'Actual native payloads retain the command byte limit')
check(transported.length===app.diagnosticsSnapshot().rows.length,'Every recorded row reaches the controlled native transport')
check(app.diagnosticsSnapshot().dropped===0&&app.diagnosticsSnapshot().historyDropped===0,'No transport or history evidence is discarded')
console.log(JSON.stringify({checks,decision:'PASS',scope:'Actual input tracker, metric entry point, diagnostic buffer and evidence parser; controlled native invoke only; not rendering/native acceptance'}))
