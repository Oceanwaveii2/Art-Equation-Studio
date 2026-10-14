import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
const source=ts.transpileModule(await fs.readFile('src/diagnostics/diagnosticBuffer.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {DiagnosticBuffer}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const row=t=>({t,kind:'capture.test',data:{value:t}}),encoder=new TextEncoder()
const held=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
let checks=0
function check(test,message){assert(test,message);checks++}
assert.throws(()=>new DiagnosticBuffer({session:'\u0000'.repeat(43),native:()=>true,maxBatchBytes:1024,send:async()=>{}}),/INVALID_LIMITS/);checks++
const browserSends=[],browser=new DiagnosticBuffer({session:'browser',native:()=>false,send:async batch=>browserSends.push(batch),historyCapacity:3,transportCapacity:3})
for(let i=1;i<=5;i++)browser.record(row(i))
assert.deepEqual(browser.snapshot().rows.map(row=>row.t),[3,4,5]);checks++
check(browser.snapshot().historyDropped===2&&browser.snapshot().dropped===0&&browser.pendingRows===0,'Browser history truncation must not invent native transport loss')
await browser.flush();check(browserSends.length===0,'Browser metrics do not queue a disabled native transport')

const boundedSends=[],bounded=new DiagnosticBuffer({session:'utf8',native:()=>true,maxBatchBytes:1024,send:async batch=>boundedSends.push(batch),historyCapacity:20,transportCapacity:20})
for(let i=1;i<=7;i++)bounded.record({...row(i),data:{text:'海'.repeat(100)}})
await bounded.flush()
check(boundedSends.length>=3&&boundedSends.every(batch=>encoder.encode(batch).length<=1024),'UTF-8 byte caps must split batches before the native bound')
assert.deepEqual(boundedSends.flatMap(batch=>JSON.parse(batch).rows.map(row=>row.t)),[1,2,3,4,5,6,7]);checks++
check(bounded.snapshot().dropped===0&&bounded.pendingRows===0,'Bounded batches drain every accepted row without loss')

const gate=held(),slowSends=[];let active=0,maxActive=0
const slow=new DiagnosticBuffer({session:'slow',native:()=>true,historyCapacity:3,transportCapacity:4,send:async batch=>{active++;maxActive=Math.max(maxActive,active);slowSends.push(JSON.parse(batch));if(slowSends.length===1)await gate.promise;active--}})
slow.record(row(1));slow.record(row(2));const firstDrain=slow.flush();await Promise.resolve()
slow.record(row(3));slow.record(row(4));slow.record(row(5))
check(slow.flush()===firstDrain,'Concurrent callers share one native drain')
check(slow.pendingRows===4&&slow.snapshot().inFlightRows===2,'Transport capacity includes protected in-flight rows')
gate.resolve();await firstDrain
assert.deepEqual(slowSends.flatMap(batch=>batch.rows.map(row=>row.t)),[1,2,4,5]);checks++
check(maxActive===1&&slowSends.at(-1).dropped===1&&slowSends.at(-1).historyDropped===2,'Overflow reports separate history and transport counters while preserving in-flight order')

let now=0,attempts=0;const attemptsRows=[]
const retry=new DiagnosticBuffer({session:'retry',native:()=>true,now:()=>now,transportCapacity:10,send:async batch=>{attempts++;attemptsRows.push(JSON.parse(batch).rows.map(row=>row.t));if(attempts===1)throw new Error('controlled write rejection')}})
retry.record(row(1));retry.record(row(2));check(await retry.flush()===false,'A rejected write remains explicit and retryable')
retry.record(row(3));check(await retry.flush()===false&&attempts===1,'Rejected transport backs off instead of retrying per new metric')
now=1001;check(await retry.flush()===true,'Native write succeeds after controlled retry')
assert.deepEqual(attemptsRows,[[1,2],[1,2,3]]);checks++
check(retry.snapshot().transportFailures===1&&retry.snapshot().dropped===0&&retry.pendingRows===0,'Rejected writes do not discard or reorder accepted rows')

const overflowSends=[],overflow=new DiagnosticBuffer({session:'overflow',native:()=>true,transportCapacity:3,historyCapacity:10,send:async batch=>overflowSends.push(JSON.parse(batch))})
for(let i=1;i<=5;i++)overflow.record(row(i));await overflow.flush()
assert.deepEqual(overflowSends.flatMap(batch=>batch.rows.map(row=>row.t)),[3,4,5]);checks++
check(overflowSends.at(-1).dropped===2&&overflowSends.at(-1).historyDropped===0,'Queue overflow must report every discarded transport row')

const finalGate=held(),finalSends=[]
const final=new DiagnosticBuffer({session:'final-drop',native:()=>true,transportCapacity:2,send:async batch=>{finalSends.push(JSON.parse(batch));if(finalSends.length===1)await finalGate.promise}})
final.record(row(1));final.record(row(2));const finalDrain=final.flush();await Promise.resolve();final.record(row(3));finalGate.resolve();await finalDrain
check(finalSends.length===2&&finalSends[1].rows.length===0&&finalSends[1].dropped===1,'A last in-flight overflow gets a metadata-only report even when no rows remain queued')

const oversizedSends=[],oversized=new DiagnosticBuffer({session:'oversized',native:()=>true,maxBatchBytes:1024,send:async batch=>oversizedSends.push(JSON.parse(batch))})
oversized.record({...row(1),data:{text:'海'.repeat(1000)}});await oversized.flush()
check(oversized.snapshot().rows.length===0&&oversizedSends[0].dropped===1&&oversizedSends[0].historyDropped===1,'An impossible oversized row is refused and both losses are explicit')

const nativeSends=[],native=new DiagnosticBuffer({session:'native-cap',native:()=>true,transportCapacity:40,historyCapacity:40,send:async batch=>nativeSends.push(batch)})
for(let i=1;i<=20;i++)native.record({...row(i),data:{text:'海'.repeat(7000)}});await native.flush()
check(nativeSends.length>=2&&nativeSends.every(batch=>encoder.encode(batch).length<=256_000),'Actual 256000-byte native command cap includes Unicode bytes and envelope overhead')
assert.deepEqual(nativeSends.flatMap(batch=>JSON.parse(batch).rows.map(row=>row.sequence)),Array.from({length:20},(_,index)=>index+1));checks++

const reentrantSends=[];let reentrantDrain
const reentrant=new DiagnosticBuffer({session:'reentrant',native:()=>true,send:async batch=>{reentrantSends.push(JSON.parse(batch));reentrantDrain=reentrant.flush()}})
reentrant.record(row(1));const outer=reentrant.flush();await outer
check(reentrantDrain===outer&&reentrantSends.length===1,'Even a synchronous transport callback cannot open a second drain')

// Run the actual performance entry point against a controlled native command,
// including its annotation overhead and coalesced hundred-row scheduling.
const appSends=[],events=[]
Object.assign(globalThis,{devicePixelRatio:2,innerWidth:1280,innerHeight:900,document:{visibilityState:'visible'},window:{dispatchEvent:event=>events.push(event.type)}})
globalThis.__diagnosticAppBoundary={DiagnosticBuffer,CanvasInputTracker:class{},isTauri:()=>true,invoke:async(command,args)=>{assert.equal(command,'record_performance_batch');appSends.push(args.batch)}}
const appSource=ts.transpileModule(await fs.readFile('src/diagnostics/performance.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*$/gm,'')
const appPrelude='const {DiagnosticBuffer,CanvasInputTracker,isTauri,invoke}=globalThis.__diagnosticAppBoundary; const preparationWorkerSnapshot=()=>({workers:0,queued:0,workingBytes:0});\n'
const app=await import('data:text/javascript;base64,'+Buffer.from(appPrelude+appSource).toString('base64'))
for(let i=0;i<99;i++)app.recordMetric('queue.test',{value:i})
await new Promise(resolve=>setImmediate(resolve));check(appSends.length===0,'Sub-threshold metrics await the periodic drain')
for(let i=99;i<150;i++)app.recordMetric('queue.test',{value:i})
await new Promise(resolve=>setImmediate(resolve))
check(appSends.length===1&&JSON.parse(appSends[0]).rows.length===150,'Threshold notifications coalesce into one actual entry-point batch')
check(appSends.every(batch=>encoder.encode(batch).length<=256_000)&&JSON.parse(appSends[0]).environment.dpr===2,'Native payload includes bounded device context within the real command cap')
await app.exportDiagnostics()
check(appSends.length===2&&JSON.parse(appSends[1]).rows.length===1&&events.includes('ae-diagnostics-saved'),'Native issue export drains its marker and avoids a duplicated oversized history write')
check(app.diagnosticsSnapshot().dropped===0&&app.diagnosticsSnapshot().historyDropped===0,'Entry-point snapshots expose both independent counters')
console.log(`Diagnostic buffer: PASS (${checks} checks; bounded UTF-8 batches, serialized slow/rejected transports, retry order and explicit history/transport loss; controlled transport only)`)
