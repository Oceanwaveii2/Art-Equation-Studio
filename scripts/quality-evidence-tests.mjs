import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {screenEvidence,releaseEvidence,committedInputEvents,auditCommittedInputs} from './quality-evidence.mjs'
const digest='a'.repeat(64),policy=JSON.parse(await fs.readFile(new URL('./quality-policy.json',import.meta.url)))
// Fabricated allocator receipts exercise the validator only. They contain no
// measured GPU readback or pixels and must never become product evidence.
const fakeHealthyGpuMetadata={gpuAllocationStatus:'checked',gpuAllocationFailureFlags:0,gpuAllocationStatusBytes:32,gpuAllocationCounts:{failed:0,binning:1,ptcl:2,tile:3,segCounts:4,segments:5,blend:6,lines:7}}
let allocationHealthChecks=0
const example={results:[{version:'candidate',board:'test',frames:{p95:17,max:33},errors:[],observed:{gpu:{renderer:'vello-webgpu',acceptedBackend:'gpu',pending:'false',generation:'10',acceptedGeneration:'10',paintedObjects:'12'},diagnostics:{dropped:0,historyDropped:0,rows:[{kind:'input.commit',data:{oldestInputMs:16,latestInputMs:16,dropped:0}}]}}}]}
example.results[0].observed.gpu.frameMetadata=JSON.stringify(fakeHealthyGpuMetadata)
assert.equal(screenEvidence(example,'candidate').decision,'SMOKE_ONLY')
for(const key of ['oldestInputMs','latestInputMs','dropped']){
 const copy=structuredClone(example);delete copy.results[0].observed.diagnostics.rows[0].data[key]
 assert.equal(screenEvidence(copy,'candidate').decision,'REJECT','An input.commit marker without timing/drop evidence cannot pass')
}
const mixedEventExample=structuredClone(example)
mixedEventExample.results[0].observed.diagnostics.rows[0].data={kind:'pan',inputScope:1,inputSeq:2,coalesced:2,oldestInputMs:16,latestInputMs:10,dropped:0,sampleSchema:1,inputSamplesJson:JSON.stringify([{seq:1,kind:'zoom',ms:16},{seq:2,kind:'pan',ms:10}])}
assert.equal(screenEvidence(mixedEventExample,'candidate').decision,'SMOKE_ONLY')
for(const mutate of [d=>d.sampleSchema=2,d=>delete d.inputScope,d=>d.inputSamplesJson='invalid',d=>d.coalesced=3,d=>d.kind='zoom',d=>d.oldestInputMs=15,d=>d.inputSamplesJson=JSON.stringify([{seq:1,kind:'zoom',ms:16},{seq:1,kind:'pan',ms:10}]),d=>d.inputSamplesJson=JSON.stringify([{seq:1,kind:'zoom',ms:16},{seq:3,kind:'pan',ms:10}])]){
 const copy=structuredClone(mixedEventExample);mutate(copy.results[0].observed.diagnostics.rows[0].data)
 assert.equal(screenEvidence(copy,'candidate').decision,'REJECT','Malformed or mislabelled event evidence cannot qualify')
}
const repeatedEventExample=structuredClone(mixedEventExample)
repeatedEventExample.results[0].observed.diagnostics.rows.push(structuredClone(repeatedEventExample.results[0].observed.diagnostics.rows[0]))
assert.equal(screenEvidence(repeatedEventExample,'candidate').decision,'REJECT','An event cannot be credited to multiple frames')
repeatedEventExample.results[0].observed.diagnostics.rows[1].data.inputScope=2
assert.equal(screenEvidence(repeatedEventExample,'candidate').decision,'SMOKE_ONLY','Distinct canvases may use the same event sequence')
const chunkEvents=Array.from({length:129},(_,index)=>({seq:index+1,kind:index%2?'pan':'zoom',ms:16-index*.01}))
const chunkRows=[chunkEvents.slice(0,128),chunkEvents.slice(128)].map((events,index)=>({kind:'input.commit',data:{kind:events.at(-1).kind,inputScope:10,inputSeq:129,coalesced:events.length,oldestInputMs:Math.max(...events.map(event=>event.ms)),latestInputMs:Math.min(...events.map(event=>event.ms)),dropped:0,sampleSchema:1,inputSamplesJson:JSON.stringify(events),inputChunkIndex:index,inputChunks:2,inputBatchEvents:129}}))
const chunkExample=structuredClone(example);chunkExample.results[0].observed.diagnostics.rows=chunkRows
assert.equal(screenEvidence(chunkExample,'candidate').decision,'SMOKE_ONLY')
assert.equal(auditCommittedInputs(chunkRows).complete,true)
assert.deepEqual(auditCommittedInputs(chunkRows).events,chunkEvents)
for(const mutate of [
 rows=>rows.shift(), // Lose oldest delayed inputs while transport counters stay zero.
 rows=>rows.pop(),
 rows=>rows.reverse(),
 rows=>rows.splice(1,0,structuredClone(rows[0])),
 rows=>delete rows[0].data.inputChunks,
 rows=>rows[0].data.inputChunkIndex=-1,
 rows=>{rows[1].data.inputChunks=1;rows[1].data.inputBatchEvents=1;rows[1].data.inputChunkIndex=0},
 rows=>{rows[1].data.inputSamplesJson=JSON.stringify([{seq:128,kind:rows[1].data.kind,ms:rows[1].data.oldestInputMs}])},
 rows=>{delete rows[1].data.inputChunkIndex;delete rows[1].data.inputChunks;delete rows[1].data.inputBatchEvents},
 rows=>delete rows[0].data.sampleSchema,
]){
 const copy=structuredClone(chunkExample);mutate(copy.results[0].observed.diagnostics.rows)
 assert.equal(screenEvidence(copy,'candidate').decision,'REJECT','Missing/duplicate/inconsistent chunk credit cannot pass with zero transport counters')
 assert.equal(auditCommittedInputs(copy.results[0].observed.diagnostics.rows).complete,false)
}
for(const mutate of [data=>data.inputChunks=5,data=>data.inputBatchEvents=513,data=>data.inputChunkIndex=2,data=>data.inputChunkIndex=.5,data=>data.inputBatchEvents=128]){
 const data=structuredClone(chunkRows[0].data);mutate(data)
 assert.throws(()=>committedInputEvents(data),/chunk/)
}
const distinctChunkScopes=chunkRows.concat(chunkRows.map(row=>({kind:row.kind,data:{...row.data,inputScope:11}})))
assert.equal(auditCommittedInputs(distinctChunkScopes).complete,true,'Complete groups on different canvases remain independent')
assert.equal(auditCommittedInputs(example.results[0].observed.diagnostics.rows).complete,false,'Legacy aggregates are never complete per-event evidence')
const extraEventData=structuredClone(mixedEventExample.results[0].observed.diagnostics.rows[0].data)
const extraEvents=JSON.parse(extraEventData.inputSamplesJson);extraEvents[0].content='unexpected text';extraEventData.inputSamplesJson=JSON.stringify(extraEvents)
assert.throws(()=>committedInputEvents(extraEventData),/invalid input event/,'Event evidence accepts only canonical seq/kind/ms fields')
for(const mutate of [r=>r.results=[],r=>r.results[0].frames.p95=1516.5,r=>r.results[0].frames.max=2566.8,r=>r.results[0].observed.gpu.renderer='vello-cpu',r=>r.results[0].observed.gpu.acceptedGeneration='9',r=>r.results[0].observed.gpu.paintedObjects='0',r=>r.results[0].errors=undefined]){
 const copy=structuredClone(example);mutate(copy);assert.equal(screenEvidence(copy,'candidate').decision,'REJECT')
}
for(const mutate of [r=>delete r.results[0].observed.diagnostics,r=>r.results[0].observed.diagnostics.rows=[],r=>r.results[0].observed.diagnostics.rows={},r=>delete r.results[0].observed.diagnostics.dropped,r=>delete r.results[0].observed.diagnostics.historyDropped,r=>r.results[0].observed.diagnostics.dropped=1,r=>r.results[0].observed.diagnostics.historyDropped=1,r=>r.results[0].observed.diagnostics.rows=[{kind:'frame.sample',data:{p95:16}}]]){
 const copy=structuredClone(example);mutate(copy);assert.equal(screenEvidence(copy,'candidate').decision,'REJECT','Missing or incomplete diagnostic input evidence must never pass')
}
assert.equal(releaseEvidence({},digest).decision,'REJECT','Missing evidence must never pass')
const checks=Object.fromEntries(['nodeZoom','colorParity','familyMovement','drawingEdit','saveReopen','undoRedo','deviceRecovery','resourceRefusal'].map(k=>[k,true]))
const syntheticManifest={schema:1,executable:{sha256:digest,bytes:1},files:[{path:'production-bundle/test'},{path:'rust-renderer/test'}],fixtures:policy.requiredBoards.map(id=>({id,sha256:digest})),uiReferences:[{sha256:digest}]}
const synthetic={schema:1,manifestSha256:digest,retinaReferences:policy.retina.referenceReceipts.map(r=>r.sha256),runs:[],soaks:[],ui:[]}
for(const transport of ['browser','native']){
 synthetic.soaks.push({transport,manifestSha256:digest,seconds:300,errors:0,unexpectedFallbacks:0,resourcesReturnedToBaseline:true})
 for(const board of policy.requiredBoards)for(const physicalCanvas of policy.release.requiredPhysicalSizes)for(let i=0;i<3;i++)synthetic.runs.push({transport,board,physicalCanvas,runId:`run-${i}`,manifestSha256:digest,actualBackend:'gpu',unexpectedFallbacks:0,latestGeneration:120,acceptedGeneration:120,pending:false,errors:[],inputToCommit:{samples:120,p95:15,p99:30},navigation:{pan:{unit:'input-to-committed-frame-ms',samples:120,p95:12.9},zoom:{unit:'input-to-committed-frame-ms',samples:60,p95:14.7},firstPostGestureFrameMs:70,sharpProfileCompleteMs:483,fullQuality:true,resolutionReduced:false},expectedPaintIdsSha256:digest,actualPaintIdsSha256:digest,visualDiffPixels:0,visualOracleManifestSha256:digest,checks})
}
for(const r of synthetic.runs)r.executableSha256=digest
for(const r of synthetic.runs)r.frameMetadata=structuredClone(fakeHealthyGpuMetadata)
for(const theme of policy.ui.themes)for(const mode of policy.ui.modes)for(const viewport of policy.ui.viewports)synthetic.ui.push({theme,mode,viewport,transport:'native',executableSha256:digest,manifestSha256:digest,checks:Object.fromEntries(policy.ui.requiredChecks.map(k=>[k,true])),missingFonts:[],fontReceipts:[{expectedFamily:'Segoe UI',renderedFamily:'Segoe UI',contentSha256:digest}],clippedControls:0,overlappingControls:0,referenceSha256:digest,screenshotSha256:digest})
assert.equal(releaseEvidence(synthetic,digest,syntheticManifest).decision,'ACCEPT','Synthetic schema unit test only; not a measured product pass')
const assertAllocatorRejects=(metadata,label)=>{
 const smoke=structuredClone(example)
 smoke.results[0].observed.gpu.paintedObjects='76'
 if(metadata===undefined)delete smoke.results[0].observed.gpu.frameMetadata
 else smoke.results[0].observed.gpu.frameMetadata=JSON.stringify(metadata)
 const diagnostic=screenEvidence(smoke,'candidate')
 assert.equal(diagnostic.decision,'REJECT',`76 admitted owners cannot excuse ${label}`)
 assert.ok(diagnostic.failures.some(reason=>reason.includes('GPU allocation')),`Allocation-specific diagnostic rejection required: ${label}`)
 allocationHealthChecks++
 const release=structuredClone(synthetic)
 if(metadata===undefined)delete release.runs[0].frameMetadata
 else release.runs[0].frameMetadata=structuredClone(metadata)
 const qualification=releaseEvidence(release,digest,syntheticManifest)
 assert.equal(qualification.decision,'REJECT',`Release cannot excuse ${label}`)
 assert.ok(qualification.failures.some(reason=>reason.includes('GPU allocation')),`Allocation-specific release rejection required: ${label}`)
 allocationHealthChecks++
}
for(const metadata of [undefined,null,[],true,32,'checked'])assertAllocatorRejects(metadata,'missing/non-object frame metadata')
for(const key of ['gpuAllocationStatus','gpuAllocationFailureFlags','gpuAllocationStatusBytes']){
 const metadata=structuredClone(fakeHealthyGpuMetadata);delete metadata[key]
 assertAllocatorRejects(metadata,`missing ${key}`)
}
for(const gpuAllocationStatus of ['unchecked','failed','retained','',0,false,null])assertAllocatorRejects({...fakeHealthyGpuMetadata,gpuAllocationStatus},'unchecked/failed allocation status')
for(const gpuAllocationFailureFlags of [1,0xffffffff,-1,.5,'0',false,null])assertAllocatorRejects({...fakeHealthyGpuMetadata,gpuAllocationFailureFlags},'nonzero/invalid failure flags')
for(const gpuAllocationStatusBytes of [0,31,33,'32',false,null])assertAllocatorRejects({...fakeHealthyGpuMetadata,gpuAllocationStatusBytes},'missing/incorrect 32-byte receipt')
for(const gpuAllocationCounts of [null,[],false,32,'counts',{}, {failed:1}, {binning:1}])assertAllocatorRejects({...fakeHealthyGpuMetadata,gpuAllocationCounts},'malformed/contradictory allocation counts')
for(const value of [-1,.5,0x100000000,'0',false,null]){
 for(const key of ['failed','tile'])assertAllocatorRejects({...fakeHealthyGpuMetadata,gpuAllocationCounts:{...fakeHealthyGpuMetadata.gpuAllocationCounts,[key]:value}},`invalid uint32 ${key}`)
}
assertAllocatorRejects({...fakeHealthyGpuMetadata,gpuAllocationFailureFlags:1,gpuAllocationCounts:{...fakeHealthyGpuMetadata.gpuAllocationCounts,failed:1}},'consistent counts reporting an actual allocator failure')
// JSON cannot encode these numbers. Both direct release objects and diagnostic
// JSON nulls still need to reject rather than coerce into a healthy counter.
for(const value of [NaN,Infinity,-Infinity]){
 assertAllocatorRejects({...fakeHealthyGpuMetadata,gpuAllocationFailureFlags:value},'non-finite failure flags')
 assertAllocatorRejects({...fakeHealthyGpuMetadata,gpuAllocationStatusBytes:value},'non-finite receipt size')
 assertAllocatorRejects({...fakeHealthyGpuMetadata,gpuAllocationCounts:{failed:0,tile:value}},'non-finite allocator counter')
}
for(const gpuAllocationStatus of ['checked','retained-checked']){
 for(const gpuAllocationCounts of [undefined,{failed:0},{...fakeHealthyGpuMetadata.gpuAllocationCounts,lines:0xffffffff}]){
  const metadata={...fakeHealthyGpuMetadata,gpuAllocationStatus,gpuAllocationCounts}
  const smoke=structuredClone(example);smoke.results[0].observed.gpu.frameMetadata=JSON.stringify(metadata)
  assert.equal(screenEvidence(smoke,'candidate').decision,'SMOKE_ONLY','Fake healthy metadata only validates schema; retained checks need the same complete core receipt')
  allocationHealthChecks++
  const release=structuredClone(synthetic);release.runs[0].frameMetadata=structuredClone(metadata)
  assert.equal(releaseEvidence(release,digest,syntheticManifest).decision,'ACCEPT','Fake release fixture only validates schema; no product qualification')
  allocationHealthChecks++
 }
}
for(const value of ['not-json','{','null','[]']){
 const smoke=structuredClone(example);smoke.results[0].observed.gpu.frameMetadata=value
 assert.equal(screenEvidence(smoke,'candidate').decision,'REJECT','Malformed diagnostic frameMetadata cannot certify allocated pixels')
 allocationHealthChecks++
}
const objectInsteadOfJson=structuredClone(example);objectInsteadOfJson.results[0].observed.gpu.frameMetadata=structuredClone(fakeHealthyGpuMetadata)
assert.equal(screenEvidence(objectInsteadOfJson,'candidate').decision,'REJECT','Diagnostic metadata must preserve the actual host JSON receipt');allocationHealthChecks++
const jsonInsteadOfObject=structuredClone(synthetic);jsonInsteadOfObject.runs[0].frameMetadata=JSON.stringify(fakeHealthyGpuMetadata)
assert.equal(releaseEvidence(jsonInsteadOfObject,digest,syntheticManifest).decision,'REJECT','Release run.frameMetadata requires an explicit object receipt');allocationHealthChecks++
const fakeHealthyCpuSmoke=structuredClone(example);fakeHealthyCpuSmoke.results[0].observed.gpu.renderer='vello-cpu';fakeHealthyCpuSmoke.results[0].observed.gpu.acceptedBackend='cpu'
const cpuSmoke=screenEvidence(fakeHealthyCpuSmoke,'candidate')
assert.equal(cpuSmoke.decision,'REJECT');assert.ok(cpuSmoke.failures.some(reason=>reason.includes('fallback')));allocationHealthChecks++
const fakeHealthyCpuRelease=structuredClone(synthetic);fakeHealthyCpuRelease.runs[0].actualBackend='cpu'
const cpuRelease=releaseEvidence(fakeHealthyCpuRelease,digest,syntheticManifest)
assert.equal(cpuRelease.decision,'REJECT');assert.ok(cpuRelease.failures.some(reason=>reason.includes('fallback')));allocationHealthChecks++
for(const mutate of [r=>r.runs.pop(),r=>r.manifestSha256='b'.repeat(64),r=>r.runs[0].inputToCommit=null,r=>r.runs[0].actualBackend='cpu',r=>r.runs[0].checks={...checks,nodeZoom:false},r=>r.runs[0].visualDiffPixels=1,r=>r.soaks[0].resourcesReturnedToBaseline=false]){
 const copy=structuredClone(synthetic);mutate(copy);assert.equal(releaseEvidence(copy,digest,syntheticManifest).decision,'REJECT')
}
for(const mutate of [r=>r.runs.find(x=>x.physicalCanvas[0]===3840).navigation.pan.p95=16.3,r=>r.runs.find(x=>x.physicalCanvas[0]===3840).navigation.zoom.p95=22.4,r=>r.runs.find(x=>x.physicalCanvas[0]===3840).navigation.sharpProfileCompleteMs=614,r=>r.runs.find(x=>x.physicalCanvas[0]===3840).navigation.resolutionReduced=true,r=>r.ui.pop(),r=>r.ui[0].missingFonts=['Missing font'],r=>r.ui[0].checks={fontCoverage:true},r=>r.ui[0].fontReceipts[0].renderedFamily='Fallback']){
 const copy=structuredClone(synthetic);mutate(copy);assert.equal(releaseEvidence(copy,digest,syntheticManifest).decision,'REJECT')
}
const recorded=JSON.parse(await fs.readFile(new URL('./quality-fixtures/known-bad-2.0.json',import.meta.url)))
const bad=screenEvidence(recorded,'integration-2.0');assert.equal(bad.decision,'REJECT');assert(bad.failures.some(f=>f.includes('frame gap')));assert(bad.failures.some(f=>f.includes('fallback')))
// Execute the real suite orchestrator in an empty disposable directory. Every
// missing suite must produce a nonzero process exit, rather than a green run.
const disposable=await fs.mkdtemp(path.join(os.tmpdir(),'ae-quality-runner-'))
const runner=spawnSync(process.execPath,[path.resolve('scripts/v21-gates.mjs')],{cwd:disposable,encoding:'utf8',timeout:30000})
assert.equal(runner.status,1,runner.stderr)
console.log(JSON.stringify({status:'PASS',knownBadBuild:'REJECT',missingSuiteExit:runner.status,allocationHealthChecks,blank76OwnershipWithBadHealth:'REJECT',syntheticEvidence:'validator tests only; never product qualification',disposable}))
