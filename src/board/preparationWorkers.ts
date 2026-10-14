import { preparationPolicy } from '../canvas-engine/preparationPolicy'

/** Shared admission across decoder pools in this UI realm. Native pipelines are bounded separately. */
export class PreparationAdmission {
  private active=0;private bytes=0;private listeners=new Set<()=>void>();private scheduled=false;private turn=0
  readonly workers:number;readonly workingBytes:number
  constructor(workers=4,workingBytes=256*1024*1024){this.workers=workers;this.workingBytes=workingBytes}
  subscribe(wake:()=>void){this.listeners.add(wake);return ()=>this.listeners.delete(wake)}
  acquire(bytes:number){
    if(this.active>=this.workers||this.bytes+bytes>this.workingBytes)return undefined
    this.active++;this.bytes+=bytes;let released=false
    return ()=>{if(released)return;released=true;this.active--;this.bytes-=bytes;if(!this.scheduled){this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;const wakes=[...this.listeners];const start=this.turn++%Math.max(1,wakes.length);for(let i=0;i<wakes.length;i++)wakes[(start+i)%wakes.length]()})}}
  }
  snapshot(){return {active:this.active,workingBytes:this.bytes,workerLimit:this.workers,workingLimit:this.workingBytes}}
}
const sharedPolicy=preparationPolicy(typeof navigator==='undefined'?8:navigator.hardwareConcurrency||2)
const sharedAdmission=new PreparationAdmission(Math.max(1,Math.floor(sharedPolicy.workers/2)),sharedPolicy.workingBytes)
type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>
type Task = { id: number; payload: unknown; bytes: number; priority: number; resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void; releaseAdmission?:()=>void;queuedAt:number;startedAt?:number;timer?: ReturnType<typeof setTimeout> }
type Slot = { worker: WorkerLike; task?: Task }

/** Derived work only. No document mutations, GPU handles or media copies in the queue. */
export class PreparationWorkers {
  private waiting: Task[] = []
  private slots = new Set<Slot>()
  private serial = 0
  private bytes = 0
  private completed = 0
  private cancelled = 0
  private stopped = false
  private createWorker: () => WorkerLike
  private policy: ReturnType<typeof preparationPolicy>
  private timeoutMs: number
  private admission:PreparationAdmission
  private stopAdmission:()=>void
  private queueMs=0;private workMs=0
  constructor(createWorker: () => WorkerLike, policy = preparationPolicy(navigator.hardwareConcurrency || 2), timeoutMs = 60_000,admission=sharedAdmission) { this.admission=admission;this.stopAdmission=admission.subscribe(()=>this.pump());this.createWorker = createWorker; this.policy = policy; this.timeoutMs = timeoutMs }
  run<T>(payload: unknown, options: { signal: AbortSignal; bytes?: number; priority?: number }): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.stopped) { reject(new Error('Preparation disposed')); return }
      const bytes = options.bytes ?? this.policy.taskBytes
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > Math.min(this.policy.taskBytes,this.admission.workingBytes)) { reject(new Error('Preparation task exceeds working-memory limit')); return }
      if (options.signal.aborted) { reject(new Error('Preparation cancelled')); return }
      if (this.waiting.length >= this.policy.queued) { reject(new Error('Preparation queue is full; try again after another image finishes')); return }
      const task: Task = { id: ++this.serial, queuedAt:performance.now(),payload, bytes, priority: options.priority || 0, resolve: value => resolve(value as T), reject, cleanup: () => options.signal.removeEventListener('abort', abort) }
      const abort = () => { this.cancelled++; this.finish(task, undefined, new Error('Preparation cancelled'), true) }
      options.signal.addEventListener('abort', abort, { once: true })
      this.waiting.push(task); this.waiting.sort((a,b) => b.priority - a.priority || a.id - b.id); this.pump()
    })
  }
  snapshot() { return { workers: this.slots.size, workerLimit: this.policy.workers, queued: this.waiting.length, workingBytes: this.bytes, workingLimit: this.policy.workingBytes, completed: this.completed, cancelled: this.cancelled,queueMs:this.queueMs,workMs:this.workMs,sharedAdmission:this.admission.snapshot() } }
  dispose() {
    this.stopped = true;this.stopAdmission()
    for (const task of [...this.waiting, ...[...this.slots].flatMap(slot => slot.task ? [slot.task] : [])]) this.finish(task, undefined, new Error('Preparation disposed'), true, false)
    for (const slot of this.slots) slot.worker.terminate()
    this.slots.clear()
  }
  private finish(task: Task, value?: unknown, error?: Error, retire = false, pump = true) {
    const index = this.waiting.indexOf(task), slot = [...this.slots].find(slot => slot.task === task)
    if (index < 0 && !slot) return // late/stale response cannot commit
    if (index >= 0) this.waiting.splice(index, 1)
    if (slot) { slot.task = undefined; this.bytes -= task.bytes; if (retire) { slot.worker.terminate(); this.slots.delete(slot) } }
    const admitted=Boolean(task.releaseAdmission);
    clearTimeout(task.timer); task.cleanup();task.releaseAdmission?.();task.releaseAdmission=undefined;
    if(task.startedAt!==undefined)this.workMs+=performance.now()-task.startedAt
    if (error) task.reject(error); else { this.completed++; task.resolve(value) }
    if (pump&&!admitted) this.pump()
  }
  private pump() {
    if(this.stopped)return
    while (this.waiting.length) {
      const task = this.waiting[0]
      if (this.bytes + task.bytes > this.policy.workingBytes) return
      let slot = [...this.slots].find(slot => !slot.task)
      if(!slot&&this.slots.size>=this.policy.workers)return
      const release=this.admission.acquire(task.bytes);if(!release)return
      task.releaseAdmission=release
      if (!slot) {
        if (this.slots.size >= this.policy.workers) return
        try { slot = { worker: this.createWorker() }; this.slots.add(slot) }
        catch (reason) { this.finish(task, undefined, new Error(String(reason)), false, false); continue }
        const created = slot
        slot.worker.onmessage = event => {
          const current = created.task, message = event.data
          if (!current || message?.id !== current.id) return
          this.finish(current, message.result, message.error ? new Error(message.error) : undefined)
        }
        slot.worker.onerror = event => { const current = created.task; if (current) this.finish(current, undefined, new Error(event.message || 'Image worker failed'), true) }
      }
      this.waiting.shift();slot.task = task;task.startedAt=performance.now();this.queueMs+=task.startedAt-task.queuedAt; this.bytes += task.bytes
      task.timer = setTimeout(() => this.finish(task, undefined, new Error('Image preparation timed out'), true), this.timeoutMs)
      try { slot.worker.postMessage({ id: task.id, payload: task.payload }) }
      catch (reason) { this.finish(task, undefined, new Error(String(reason)), true, false) }
    }
  }
}

let tiffWorkers: PreparationWorkers | undefined
export function decodeTiff(source: string, signal: AbortSignal, selected: boolean) {
  tiffWorkers ??= new PreparationWorkers(() => new Worker(new URL('./tiffDecode.worker.ts', import.meta.url), { type: 'module' }))
  return tiffWorkers.run<{ blob: Blob; width: number; height: number; cacheHit: boolean; cacheStored: boolean }>({ source }, { signal, priority: selected ? 100 : 0 })
}
let modelWorkers: PreparationWorkers | undefined
export function prepareModelImage(payload: {blob:Blob;width?:number;height?:number;gray?:boolean;probe?:boolean},signal:AbortSignal,bytes:number,priority=100) {
 modelWorkers ??= new PreparationWorkers(() => new Worker(new URL('./modelImageDecode.worker.ts', import.meta.url), {type:'module'}), {...preparationPolicy(navigator.hardwareConcurrency||2),workers:Math.min(2,preparationPolicy(navigator.hardwareConcurrency||2).workers)})
 return modelWorkers.run<{pixels:Uint8ClampedArray;sourceWidth:number;sourceHeight:number;width:number;height:number}>(payload,{signal,bytes,priority})
}
export function modelImageWorkerSnapshot(){return modelWorkers?.snapshot() || {workers:0,queued:0,workingBytes:0}}
export function preparationWorkerSnapshot() { return {...(tiffWorkers?.snapshot() || { workers: 0, queued: 0, workingBytes: 0 }),modelImages:modelImageWorkerSnapshot()} }
