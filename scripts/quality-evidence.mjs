import fs from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {createHash} from 'node:crypto'
const policy=JSON.parse(await fs.readFile(new URL('./quality-policy.json',import.meta.url),'utf8'))
/** Ownership admission alone cannot prove that Vello's GPU allocator completed
 * the frame. This bounded status readback is additional evidence, never a pixel
 * oracle or permission to substitute a CPU recovery frame for qualified GPU. */
function gpuAllocationHealthFailures(metadata){
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))return ['GPU allocation health frame metadata missing/invalid']
 const failures=[]
 if(!['checked','retained-checked'].includes(metadata.gpuAllocationStatus))failures.push('GPU allocation health status missing/failed')
 if(metadata.gpuAllocationFailureFlags!==0)failures.push('GPU allocation failure flags missing/invalid/nonzero')
 if(metadata.gpuAllocationStatusBytes!==32)failures.push('GPU allocation status receipt must contain exactly 32 bytes')
 if(metadata.gpuAllocationCounts!==undefined){
  const counts=metadata.gpuAllocationCounts
  if(!counts||typeof counts!=='object'||Array.isArray(counts))failures.push('GPU allocation counts missing/invalid')
  else{
   for(const [key,value]of Object.entries(counts))if(!Number.isInteger(value)||value<0||value>0xffffffff)failures.push(`GPU allocation count ${key} is not a uint32 integer`)
   if(counts.failed!==metadata.gpuAllocationFailureFlags)failures.push('GPU allocation failed count disagrees with failure flags')
  }
 }
 return failures
}
export function committedInputEvents(data){
 if(!data||![data.oldestInputMs,data.latestInputMs].every(n=>Number.isFinite(n)&&n>=0)||data.oldestInputMs<data.latestInputMs||!Number.isInteger(data.dropped)||data.dropped<0)throw new Error('invalid or missing committed input timing')
 const chunked=['inputChunkIndex','inputChunks','inputBatchEvents'].some(key=>key in data)
 if(data.sampleSchema===undefined){if(chunked)throw new Error('input chunk metadata requires event schema');return null} // Older aggregate-only diagnostic; never per-kind evidence.
 if(data.sampleSchema!==1)throw new Error('unknown input event schema')
 if(!Number.isSafeInteger(data.inputScope)||data.inputScope<=0)throw new Error('missing input canvas scope')
 const events=JSON.parse(data.inputSamplesJson)
 if(!Array.isArray(events)||!Number.isInteger(data.coalesced)||events.length!==data.coalesced||events.length<1||events.length>512||!Number.isSafeInteger(data.inputSeq))throw new Error('invalid input event count')
 let previous=0
 for(const event of events){
  if(!event||typeof event!=='object'||Array.isArray(event)||Object.keys(event).length!==3||!Number.isSafeInteger(event.seq)||event.seq<=previous||event.seq>data.inputSeq||!['pan','zoom'].includes(event.kind)||!Number.isFinite(event.ms)||event.ms<0)throw new Error('invalid input event')
  previous=event.seq
 }
 if(events.at(-1).kind!==data.kind||Math.max(...events.map(e=>e.ms))!==data.oldestInputMs||Math.min(...events.map(e=>e.ms))!==data.latestInputMs)throw new Error('input events disagree with committed timing')
 if(chunked){
  if(!Number.isInteger(data.inputBatchEvents)||data.inputBatchEvents<1||data.inputBatchEvents>512||!Number.isInteger(data.inputChunks)||data.inputChunks!==Math.ceil(data.inputBatchEvents/128)||!Number.isInteger(data.inputChunkIndex)||data.inputChunkIndex<0||data.inputChunkIndex>=data.inputChunks||events.length!==Math.min(128,data.inputBatchEvents-data.inputChunkIndex*128))throw new Error('invalid input event chunk metadata')
 }
 return events
}
/** Validate whole commit batches before any caller treats their event
 * distributions as complete. Zero transport counters cannot excuse a missing
 * oldest chunk, duplicate credit or out-of-order event identity. */
export function auditCommittedInputs(rows){
 const commits=Array.isArray(rows)?rows.filter(row=>row?.kind==='input.commit'):[]
 const failures=[],events=[],groups=new Map(),credited=new Set(),lastByScope=new Map()
 let commitsWithEventSamples=0,parseErrors=0
 for(const row of commits){
  let samples
  try{samples=committedInputEvents(row.data)}catch(error){failures.push(`committed input evidence invalid: ${error.message}`);parseErrors++;continue}
  if(!samples)continue // Legacy aggregates cannot become complete per-event evidence.
  commitsWithEventSamples++
  const data=row.data,key=`${data.inputScope}:${data.inputSeq}`,chunked='inputChunkIndex'in data
  let group=groups.get(key)
  if(!group){group={chunked,chunks:chunked?data.inputChunks:1,batchEvents:chunked?data.inputBatchEvents:samples.length,indices:new Set(),next:0,total:0};groups.set(key,group)}
  if(group.chunked!==chunked||group.chunks!==(chunked?data.inputChunks:1)||group.batchEvents!==(chunked?data.inputBatchEvents:samples.length))failures.push(`${key}: inconsistent input commit chunk counts`)
  const index=chunked?data.inputChunkIndex:0
  if(group.indices.has(index))failures.push(`${key}: duplicate input commit chunk`)
  if(index!==group.next)failures.push(`${key}: missing or out-of-order input commit chunk`)
  group.indices.add(index);group.next++;group.total+=samples.length
  for(const event of samples){
   const identity=`${data.inputScope}:${event.seq}`
   if(credited.has(identity))failures.push(`${key}: input event credited more than once`)
   if(event.seq<=(lastByScope.get(data.inputScope)??0))failures.push(`${key}: overlapping or out-of-order input event identity`)
   credited.add(identity);lastByScope.set(data.inputScope,event.seq);events.push(event)
  }
  if(data.dropped>0)failures.push(`${key}: input telemetry overflow; event evidence incomplete`)
 }
 for(const [key,group]of groups){
  if(group.indices.size!==group.chunks||Array.from({length:group.chunks},(_,index)=>index).some(index=>!group.indices.has(index)))failures.push(`${key}: input commit chunks incomplete`)
  if(group.total!==group.batchEvents)failures.push(`${key}: input commit event total disagrees with declared batch`)
 }
 return {events,commitsWithEventSamples,parseErrors,failures,complete:commits.length>0&&commitsWithEventSamples===commits.length&&failures.length===0}
}
export function screenEvidence(report,version){
 const failures=[]
 const cases=Array.isArray(report?.results)?report.results.filter(r=>r.version===version):[]
 if(!cases.length)failures.push('No cases for requested build; an empty report cannot pass')
 for(const r of cases){
  const label=r.board||'unnamed board',host=r.observed?.gpu
  const fail=reason=>failures.push(`${label}: ${reason}`)
  if(report.requiredPhysicalCanvas&&!r.observed?.canvases?.some(c=>c.width===report.requiredPhysicalCanvas[0]&&c.height===report.requiredPhysicalCanvas[1]))fail('required exact physical canvas dimensions not observed')
  if(!Number.isFinite(r.frames?.p95)||!Number.isFinite(r.frames?.max))fail('frame timing unavailable')
  else{
   if(r.frames.p95>policy.smoke.maxP95FrameGapMs)fail(`p95 frame gap ${r.frames.p95}ms exceeds smoke limit ${policy.smoke.maxP95FrameGapMs}ms`)
   if(r.frames.max>policy.smoke.maxFrameGapMs)fail(`maximum frame gap ${r.frames.max}ms exceeds smoke limit ${policy.smoke.maxFrameGapMs}ms`)
  }
  if(!Array.isArray(r.errors))fail('page-error evidence missing')
  else if(r.errors.length)fail(`${r.errors.length} page/console errors`)
  const diagnostics=r.observed?.diagnostics
  if(!Array.isArray(diagnostics?.rows)||!diagnostics.rows.length)fail('diagnostic rows missing; missing samples cannot qualify')
  for(const key of ['dropped','historyDropped']){
   if(!Number.isInteger(diagnostics?.[key])||diagnostics[key]<0)fail(`diagnostic ${key} count missing`)
   else if(diagnostics[key]>0)fail(`diagnostic ${key}=${diagnostics[key]}; incomplete telemetry cannot qualify`)
  }
  const diagnosticRows=Array.isArray(diagnostics?.rows)?diagnostics.rows:[]
  if(!diagnosticRows.some(row=>row.kind==='input.commit'))fail('input-to-committed-frame samples missing')
  for(const reason of auditCommittedInputs(diagnosticRows).failures)fail(reason)
  for(const row of diagnosticRows)if(row.kind==='input.commit'){
   if(!row.data)continue
   if(row.data.oldestInputMs>policy.smoke.maxFrameGapMs||row.data.latestInputMs>policy.smoke.maxFrameGapMs)fail(`committed input backlog: oldest ${Math.round(row.data.oldestInputMs)}ms, latest ${Math.round(row.data.latestInputMs)}ms`)
   if(row.data.dropped>0)fail('input telemetry overflow; samples cannot qualify')
  }
  if(!host)fail('Vello paint receipt missing')
  else{
   if(host.renderer!=='vello-webgpu'||host.acceptedBackend!=='gpu')fail(`unexpected GPU fallback/unaccepted GPU paint (${host.renderer||'missing'})`)
   if(host.backendReason)fail(`backend/resource refusal: ${host.backendReason}`)
   if(host.pending!=='false'||!host.acceptedGeneration||host.generation!==host.acceptedGeneration)fail('latest generation has not committed; snapshot is stale or pending')
   if(!(Number(host.paintedObjects)>0))fail('no accepted object pixels owned by Vello')
   if(host.renderError)fail(`renderer error: ${host.renderError}`)
   let frameMetadata
   if(typeof host.frameMetadata!=='string')fail('GPU allocation frame metadata JSON missing/invalid')
   else{
    try{frameMetadata=JSON.parse(host.frameMetadata)}catch{fail('GPU allocation frame metadata JSON missing/invalid')}
    for(const reason of gpuAllocationHealthFailures(frameMetadata))fail(reason)
   }
  }
 }
 return {schema:1,level:'smoke',version,decision:failures.length?'REJECT':'SMOKE_ONLY',cases:cases.length,failures,limits:policy.smoke,scope:'Gross-regression screen; not native or release acceptance. rAF is not input-to-commit.'}
}
export function releaseEvidence(bundle,manifestDigest,manifest){
 const failures=[],runs=Array.isArray(bundle?.runs)?bundle.runs:[]
 const fail=x=>failures.push(x)
 if(bundle?.schema!==1)fail('Missing/unknown release-evidence schema')
 for(const reference of policy.retina.referenceReceipts)if(!bundle?.retinaReferences?.includes(reference.sha256))fail(`Pinned Retina baseline receipt missing: ${reference.file}`)
 if(manifest?.schema!==1||!/^[a-f0-9]{64}$/i.test(manifest?.executable?.sha256||'')||!(manifest.executable.bytes>0))fail('Native executable provenance missing')
 if(!Array.isArray(manifest?.files)||!manifest.files.some(f=>f.path.startsWith('production-bundle/'))||!manifest.files.some(f=>f.path.startsWith('rust-renderer/')))fail('Source/WASM/production bundle provenance missing')
 for(const board of policy.requiredBoards)if(!manifest?.fixtures?.some(f=>f.id===board&&/^[a-f0-9]{64}$/i.test(f.sha256||'')))fail(`Fixture provenance missing: ${board}`)
 if(!/^[a-f0-9]{64}$/i.test(manifestDigest||'')||bundle?.manifestSha256!==manifestDigest)fail('Build/fixture provenance does not match supplied manifest')
 for(const transport of ['browser','native'])for(const board of policy.requiredBoards)for(const [width,height]of policy.release.requiredPhysicalSizes){
  const group=runs.filter(r=>r.transport===transport&&r.board===board&&r.physicalCanvas?.[0]===width&&r.physicalCanvas?.[1]===height)
  const label=`${transport}/${board}/${width}x${height}`
  if(group.length<policy.release.minimumRuns||new Set(group.map(r=>r.runId)).size<policy.release.minimumRuns)fail(`${label}: fewer than three independent runs`)
  for(const r of group){
   if(r.manifestSha256!==manifestDigest)fail(`${label}: run provenance mismatch`)
   if(transport==='native'&&r.executableSha256!==manifest?.executable?.sha256)fail(`${label}: native test did not run the qualified executable`)
   if(r.actualBackend!=='gpu'||r.unexpectedFallbacks!==0)fail(`${label}: unexpected fallback or GPU receipt missing`)
   for(const reason of gpuAllocationHealthFailures(r.frameMetadata))fail(`${label}: ${reason}`)
   if(r.latestGeneration!==r.acceptedGeneration||!Number.isInteger(r.latestGeneration)||r.pending!==false)fail(`${label}: incomplete/stale paint`)
   if(!Array.isArray(r.errors)||r.errors.length)fail(`${label}: errors or missing error evidence`)
   const timing=r.inputToCommit
   if(!Number.isInteger(timing?.samples)||timing.samples<120||!Number.isFinite(timing?.p95)||timing.p95<0||timing.p95>policy.release.inputToCommitP95Ms)fail(`${label}: committed-frame latency gate failed/missing (rAF cannot substitute)`)
   if(width===3840&&height===2160){
    const navigation=r.navigation
    for(const [kind,minimum,limit]of [['pan',policy.retina.minimumPanSamples,policy.retina.panP95Ms],['zoom',policy.retina.minimumZoomSamples,policy.retina.zoomP95Ms]]){
     const metric=navigation?.[kind]
     if(metric?.unit!=='input-to-committed-frame-ms'||!Number.isInteger(metric.samples)||metric.samples<minimum||!Number.isFinite(metric.p95)||metric.p95<0||metric.p95>limit)fail(`${label}: Retina ${kind} p95 missing or exceeds ${limit}ms`)
    }
    for(const [key,limit]of [['firstPostGestureFrameMs',policy.retina.firstPostGestureFrameMs],['sharpProfileCompleteMs',policy.retina.sharpProfileCompleteMs]])if(!Number.isFinite(navigation?.[key])||navigation[key]<0||navigation[key]>limit)fail(`${label}: Retina ${key} missing or exceeds ${limit}ms`)
    if(navigation?.fullQuality!==true||navigation?.resolutionReduced!==false)fail(`${label}: Retina quality/resolution not preserved`)
   }
   if(r.expectedPaintIdsSha256!==r.actualPaintIdsSha256||!/^[a-f0-9]{64}$/i.test(r.expectedPaintIdsSha256||''))fail(`${label}: visible paint ownership mismatch or missing oracle`)
   if(r.visualDiffPixels!==0||r.visualOracleManifestSha256!==manifestDigest)fail(`${label}: same-camera visual oracle missing/mismatch`)
   for(const key of ['nodeZoom','colorParity','familyMovement','drawingEdit','saveReopen','undoRedo','deviceRecovery','resourceRefusal'])if(r.checks?.[key]!==true)fail(`${label}: ${key} not accepted`)
  }
 }
 for(const transport of ['browser','native']){
  const soak=bundle?.soaks?.find(s=>s.transport===transport)
  if(!soak||soak.manifestSha256!==manifestDigest||!Number.isFinite(soak.seconds)||soak.seconds<300||soak.errors!==0||soak.unexpectedFallbacks!==0||soak.resourcesReturnedToBaseline!==true)fail(`${transport}: five-minute resource/recovery soak missing or failed`)
 }
 const ui=Array.isArray(bundle?.ui)?bundle.ui:[]
 for(const theme of policy.ui.themes)for(const mode of policy.ui.modes)for(const [width,height]of policy.ui.viewports){
  const label=`P1 UI/${theme}/${mode}/${width}x${height}`
  const cell=ui.find(r=>r.theme===theme&&r.mode===mode&&r.viewport?.[0]===width&&r.viewport?.[1]===height)
  if(!cell){fail(`${label}: missing complete UI evidence`);continue}
  if(cell.manifestSha256!==manifestDigest)fail(`${label}: UI build provenance mismatch`)
  if(cell.transport!=='native'||cell.executableSha256!==manifest?.executable?.sha256)fail(`${label}: complete UI has not been accepted in the qualified native executable`)
  for(const key of policy.ui.requiredChecks)if(cell.checks?.[key]!==true)fail(`${label}: ${key} not accepted`)
  if(!Array.isArray(cell.missingFonts)||cell.missingFonts.length||!Array.isArray(cell.fontReceipts)||!cell.fontReceipts.length||cell.fontReceipts.some(f=>f.expectedFamily!==f.renderedFamily||!/^[a-f0-9]{64}$/i.test(f.contentSha256||'')))fail(`${label}: missing fonts, fallback font mismatch, or no actual font receipts`)
  if(cell.clippedControls!==0||cell.overlappingControls!==0)fail(`${label}: crowding/organization evidence missing or failed`)
  if(!manifest?.uiReferences?.some(r=>r.sha256===cell.referenceSha256)||!/^[a-f0-9]{64}$/i.test(cell.screenshotSha256||''))fail(`${label}: pinned approved P1 reference or actual screenshot missing`)
 }
 return {schema:1,level:'release',decision:failures.length?'REJECT':'ACCEPT',manifestSha256:manifestDigest,failures,limits:policy.release}
}
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1]
 try{
  const input=JSON.parse(await fs.readFile(arg('--report'),'utf8'))
  let result
  if(args.includes('--release')){
   const bytes=await fs.readFile(arg('--manifest')),manifest=JSON.parse(bytes)
   result=releaseEvidence(input,sha256(bytes),manifest)
   // Certificates must refer to files that still have the measured hashes.
   for(const file of [...(manifest.files||[]),manifest.executable].filter(Boolean)){
    try{if(sha256(await fs.readFile(file.absolutePath||file.path))!==file.sha256)result.failures.push(`Changed measured artifact: ${file.path}`)}
    catch{result.failures.push(`Measured artifact unavailable: ${file.path}`)}
   }
   if(result.failures.length)result.decision='REJECT'
   result.executableSha256=manifest.executable?.sha256
  }else result=screenEvidence(input,arg('--version'))
  const target=arg('--output');if(args.includes('--output'))await fs.writeFile(target,JSON.stringify({...result,checkedAt:new Date().toISOString()},null,2))
  console.log(JSON.stringify(result,null,2));if(result.decision==='REJECT')process.exitCode=1
 }catch(error){console.error(`REJECT: evidence unavailable/invalid: ${error.message}`);process.exitCode=1}
}
