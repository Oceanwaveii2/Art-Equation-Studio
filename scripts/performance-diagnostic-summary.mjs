import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {auditCommittedInputs} from './quality-evidence.mjs'

const distribution=values=>{
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b)
  const at=p=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]:null
  return {count:sorted.length,minMs:sorted[0]??null,medianMs:at(.5),p95Ms:at(.95),maxMs:sorted.at(-1)??null}
}
const counts=values=>values.reduce((result,value)=>{result[value]=(result[value]??0)+1;return result},{})

/** Summarize measured diagnostics without creating acceptance or replacing the
 * native input-to-commit gate with browser frame gaps. Missing samples stay null. */
export function summarizePerformanceDiagnostic(report){
  return {
    schema:1,measuredAt:report.at,kind:'browser-diagnostic-not-release-acceptance',
    scope:report.method,requiredPhysicalCanvas:report.requiredPhysicalCanvas??null,
    timingNote:'Capture/GPU spans overlap and include elapsed waiting. Browser frame gaps are not native input-to-committed-frame latency. Do not add these phases or compare their ratios to Retina gates.',
    runs:report.results.map(result=>{
      const diagnostics=result.observed?.diagnostics,rows=diagnostics?.rows??[],gpu=result.observed?.gpu??{}
      const samples=kind=>rows.filter(row=>row.kind===kind)
      const spans=kind=>distribution(samples(kind).map(row=>row.data?.ms))
      const retention=samples('paint.card-retention').map(row=>({t:row.t,...row.data}))
      const commits=samples('input.commit')
      const inputAudit=auditCommittedInputs(rows)
      const inputLatencies={pan:[],zoom:[]}
      for(const event of inputAudit.events)inputLatencies[event.kind].push(event.ms)
      let blockers=null
      try{blockers=JSON.parse(gpu.completePaintBlockers??'null')}catch{blockers={parseError:true}}
      return {
        board:result.board,run:result.run,readyMs:result.readyMs,browserFrameGaps:result.frames,
        backingCanvases:result.observed?.canvases??[],backend:gpu.renderer??null,
        paintedObjects:gpu.paintedObjects===undefined?null:Number(gpu.paintedObjects),
        completePaintBlockers:blockers,
        generation:{requested:gpu.generation??null,accepted:gpu.acceptedGeneration??null,pending:gpu.pending??null,ownership:gpu.paintOwnership??null},
        capture:spans('paint.capture'),gpuPrepareElapsed:spans('gpu.prepare'),gpuWaitElapsed:spans('gpu.phase.gpuWait'),
        gpuFrontend:{references:spans('gpu.frontend.references'),uploadValidation:spans('gpu.frontend.upload-validation'),residency:spans('gpu.frontend.residency')},
        longTasks:distribution((result.observed?.tasks??[]).map(row=>row.ms)),
        retention:{samples:retention.length,maxReused:retention.length?Math.max(...retention.map(row=>row.reused)):null,lastFive:retention.slice(-5)},
        requestsByTrigger:counts(samples('paint.request').map(row=>row.data.trigger)),
        coalescedByTrigger:counts(samples('paint.coalesced').map(row=>row.data.trigger)),
        deferredCaptures:samples('paint.deferred').length,
        inputCommitSamples:commits.length,lastInputCommit:commits.at(-1)?.data??null,
        inputEventLatencies:{pan:distribution(inputLatencies.pan),zoom:distribution(inputLatencies.zoom),commitsWithEventSamples:inputAudit.commitsWithEventSamples,parseErrors:inputAudit.parseErrors,failures:inputAudit.failures,complete:inputAudit.complete,scope:'Event to accepted canvas generation; not physical monitor scan-out or native release evidence'},
        telemetry:{present:!!diagnostics,transportDropped:diagnostics?.dropped??null,historyDropped:diagnostics?.historyDropped??null,rows:rows.length,complete:!!diagnostics&&diagnostics.dropped===0&&diagnostics.historyDropped===0},
        accessibilityFindings:result.violations?.length??null,runtimeErrors:result.errors??null,
      }
    }),
  }
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const input=process.argv[2]
  if(!input)throw new Error('Usage: node scripts/performance-diagnostic-summary.mjs <comparison.json> [output.json]')
  const file=path.resolve(input),output=path.resolve(process.argv[3]??path.join(path.dirname(file),'performance-analysis.json'))
  const summary=summarizePerformanceDiagnostic(JSON.parse(await fs.readFile(file,'utf8')))
  await fs.writeFile(output,JSON.stringify(summary,null,2))
  console.log(JSON.stringify({output,runs:summary.runs.length,kind:summary.kind}))
}
