import { requestAppFrame } from '../canvas-engine/appFrameClock'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { CanvasInputTracker } from './canvasInput'
import {DiagnosticBuffer,type DiagnosticRow} from './diagnosticBuffer'
import { preparationWorkerSnapshot } from '../board/preparationWorkers'
const inputTrackers = new WeakMap<Element, CanvasInputTracker>()
export function canvasInputsFor(stage: Element) {
  let tracker = inputTrackers.get(stage)
  if (!tracker) { tracker = new CanvasInputTracker(); inputTrackers.set(stage, tracker) }
  return tracker
}
type Row=DiagnosticRow
const session = crypto.randomUUID()
const environment=()=>({userAgent:navigator.userAgent,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],visibility:document.visibilityState})
const buffer=new DiagnosticBuffer({session,native:isTauri,maxBatchBytes:252_000,send:batch=>{
  const payload=JSON.stringify({...JSON.parse(batch),schema:1,version:'2.1.0-alpha',at:new Date().toISOString(),environment:environment()})
  if(new TextEncoder().encode(payload).length>256_000)return Promise.reject(new Error('DIAGNOSTIC_BATCH_TOO_LARGE'))
  return invoke('record_performance_batch',{batch:payload})
}})
let installed=false,flushScheduled=false
const allowed = /^[a-z0-9_.:-]{1,80}$/i
const boundedData = (data: Row['data']) => Object.fromEntries(Object.entries(data).filter(([key,value]) => allowed.test(key) && (typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=160)).slice(0,32))
type CommittedInputSample = { seq: number; kind: 'pan' | 'zoom'; ms: number }
const inputSampleKeys = new Set(['kind','inputSeq','coalesced','oldestInputMs','latestInputMs','dropped','sampleSchema','inputScope','inputSamplesJson','inputChunkIndex','inputChunks','inputBatchEvents'])

/** Only canonical numeric input evidence receives a longer string allowance.
 * Split at 128 events so the tracker's full 512-event queue fits in at most
 * four bounded rows without changing any credited event, age or identity. */
function inputCommitChunks(data: Row['data']): Row['data'][] | undefined {
  if (data.sampleSchema!==1 || typeof data.inputSamplesJson!=='string' || data.inputSamplesJson.length>64_000 ||
    typeof data.inputScope!=='number' || !Number.isSafeInteger(data.inputScope) || data.inputScope<=0 ||
    typeof data.inputSeq!=='number' || !Number.isSafeInteger(data.inputSeq) || data.inputSeq<=0 ||
    typeof data.coalesced!=='number' || !Number.isInteger(data.coalesced) || data.coalesced<1 || data.coalesced>512 ||
    typeof data.dropped!=='number' || !Number.isSafeInteger(data.dropped) || data.dropped<0) return
  let decoded: unknown
  try { decoded=JSON.parse(data.inputSamplesJson) } catch { return }
  if (!Array.isArray(decoded) || decoded.length!==data.coalesced) return
  const samples: CommittedInputSample[]=[]
  let previous=0
  for (const raw of decoded) {
    if (!raw || typeof raw!=='object' || Array.isArray(raw) || Object.keys(raw).length!==3) return
    const event=raw as Record<string,unknown>
    if (typeof event.seq!=='number' || !Number.isSafeInteger(event.seq) || event.seq<=previous || event.seq>data.inputSeq ||
      (event.kind!=='pan' && event.kind!=='zoom') || typeof event.ms!=='number' || !Number.isFinite(event.ms) || event.ms<0) return
    previous=event.seq
    samples.push({seq:event.seq,kind:event.kind,ms:event.ms})
  }
  // Reject disagreement rather than repairing or lowering recorded latency.
  if (data.kind!==samples.at(-1)!.kind || data.oldestInputMs!==Math.max(...samples.map(event=>event.ms)) || data.latestInputMs!==Math.min(...samples.map(event=>event.ms))) return
  const extras=Object.fromEntries(Object.entries(boundedData(data)).filter(([key])=>!inputSampleKeys.has(key)).slice(0,20))
  const rows: Row['data'][]=[]
  const chunks=Math.ceil(samples.length/128)
  for (let offset=0;offset<samples.length;offset+=128) {
    const chunk=samples.slice(offset,offset+128)
    rows.push({...extras,kind:chunk.at(-1)!.kind,inputSeq:data.inputSeq,coalesced:chunk.length,
      oldestInputMs:Math.max(...chunk.map(event=>event.ms)),latestInputMs:Math.min(...chunk.map(event=>event.ms)),
      dropped:data.dropped,sampleSchema:1,inputScope:data.inputScope,inputSamplesJson:JSON.stringify(chunk),
      inputChunkIndex:rows.length,inputChunks:chunks,inputBatchEvents:samples.length})
  }
  return rows
}

export function recordMetric(kind: string, data: Row['data'] = {}) {
  if (!allowed.test(kind)) return
  const chunks=kind==='input.commit' ? inputCommitChunks(data) : undefined
  const rows=chunks ?? [boundedData(data)]
  // Malformed schema-1 JSON must stay visibly invalid at the evidence parser,
  // even if its string happens to fit the generic 160-character allowance.
  if (kind==='input.commit' && data.sampleSchema===1 && !chunks) delete rows[0].inputSamplesJson
  const t=Math.round(performance.now())
  for (const safe of rows) buffer.record({t,kind,data:safe})
  if(isTauri()&&buffer.pendingRows>=100&&!flushScheduled){flushScheduled=true;queueMicrotask(()=>{flushScheduled=false;void flush()})}
}
export function metricSpan(kind: string, data: Row['data'] = {}) {
  const start = performance.now()
  return () => recordMetric(kind, { ...data, ms: Math.round((performance.now() - start) * 100) / 100 })
}
export function diagnosticsSnapshot() {
  return { schema: 1, version: '2.1.0-alpha', session, at: new Date().toISOString(), ...buffer.snapshot(),
    environment: environment(), preparation: preparationWorkerSnapshot(),
  }
}
async function flush() {
  return buffer.flush()
}
export async function exportDiagnostics() {
  recordMetric('issue.marker')
  const snapshot = diagnosticsSnapshot()
  const text = JSON.stringify(snapshot, null, 2)
  if (isTauri()) {
    // The native JSONL already receives the same rows in bounded batches.
    // Sending the whole snapshot again can exceed its 256000-byte command cap.
    if(!await buffer.flush(true))throw new Error('Diagnostics could not be written; buffered rows are retained for retry')
    window.dispatchEvent(new CustomEvent('ae-diagnostics-saved'))
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'art-equation-diagnostics.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
export function installDiagnostics() {
  if (installed) return; installed = true
  recordMetric('session.start')
  // Capture before the App wheel handler schedules its camera generation.
  window.addEventListener('wheel', event => {
    if (!(event.target instanceof Element)) return
    const stage = event.target.closest('.canvas-stage')
    if (stage) canvasInputsFor(stage).mark(event.ctrlKey || event.metaKey ? 'zoom' : 'pan')
  }, { capture: true, passive: true })
  for (const type of ['longtask','event','long-animation-frame'] as const) {
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (type === 'event' && entry.duration < 40) continue
          const frame = entry as PerformanceEntry & { blockingDuration?: number; scripts?: { duration: number; forcedStyleAndLayoutDuration: number }[] }
          recordMetric(type, { name: entry.name, ms: Math.round(entry.duration), start: Math.round(entry.startTime),
            blockingMs: Math.round(frame.blockingDuration || 0), forcedLayoutMs: Math.round(frame.scripts?.reduce((total,script) => total + script.forcedStyleAndLayoutDuration,0) || 0) })
        }
      })
      observer.observe(type === 'event' ? { type, buffered: true, durationThreshold: 40 } as PerformanceObserverInit : { type, buffered: true })
    } catch { recordMetric('observer.unavailable', { type }) }
  }
  let lastSample = 0
  const sample = () => {
    if (document.hidden || performance.now() - lastSample < 4000) return
    lastSample = performance.now()
    const gaps: number[] = []; let before = performance.now(), start = before
    const frame = (now: number) => {
      gaps.push(now - before); before = now
      if (document.hidden) return
      if (now - start < 800 && gaps.length < 120) requestAppFrame(frame)
      else {
        gaps.sort((a,b) => a-b)
        const stage = document.querySelector<HTMLElement>('.canvas-stage')
        const host = document.querySelector<HTMLElement>('.vello-board')
        recordMetric('frame.sample', { p95: Math.round(gaps[Math.floor(gaps.length*.95)] || 0), max: Math.round(gaps.at(-1)||0),
          samples: gaps.length, dom: document.getElementsByTagName('*').length, total: Number(stage?.dataset.totalNodes||0),
          visible: Number(stage?.dataset.visibleNodes||0), backend: host?.dataset.renderer||'unavailable',
          pending: host?.dataset.pending==='true', commits: Number(stage?.dataset.reactCommits||0) })
      }
    }; requestAppFrame(frame)
  }
  setInterval(sample, 5000); setInterval(() => { void flush() }, 1000)
  document.addEventListener('visibilitychange', () => { recordMetric('visibility', { hidden: document.hidden }); void flush() })
  window.addEventListener('error', () => recordMetric('error.window'))
  window.addEventListener('unhandledrejection', () => recordMetric('error.promise'))
  window.addEventListener('keydown', event => { if (event.ctrlKey && event.shiftKey && event.code==='KeyD') { event.preventDefault(); void exportDiagnostics() } })
  Object.assign(window, { __AE_DIAGNOSTICS__: { snapshot: diagnosticsSnapshot, mark: () => recordMetric('issue.marker'), export: exportDiagnostics } })
}

