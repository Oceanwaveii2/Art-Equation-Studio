export type DiagnosticRow={t:number;kind:string;data:Record<string,number|string|boolean>;sequence?:number}
type Entry={row:DiagnosticRow;json:string;bytes:number}
type Options={session:string;native:()=>boolean;send:(batch:string)=>Promise<unknown>;now?:()=>number;historyCapacity?:number;transportCapacity?:number;maxBufferedBytes?:number;maxBatchBytes?:number}

/** Local history and native transport are separate bounded owners. In-flight
 * rows cannot be evicted or overtaken by a second drain. Failed rows return to
 * the front, and every actual eviction has a persistent explicit counter. */
export class DiagnosticBuffer{
 private readonly options:Required<Options>
 private readonly encoder=new TextEncoder()
 private history:Entry[]=[]
 private pending:Entry[]=[]
 private active:Entry[]=[]
 private historyBytes=0
 private pendingBytes=0
 private activeBytes=0
 private drain:Promise<boolean>|undefined
 private retryAt=0
 private rowSequence=0
 private batchSequence=0
 private reportedDropped=0
 private reportedHistoryDropped=0
 dropped=0
 historyDropped=0
 transportFailures=0
 constructor(options:Options){
  this.options={now:Date.now,historyCapacity:2000,transportCapacity:2000,maxBufferedBytes:2*1024*1024,maxBatchBytes:256_000,...options}
  if(!Number.isInteger(this.options.maxBatchBytes)||this.options.maxBatchBytes<1024||this.options.maxBatchBytes>256_000||!Number.isInteger(this.options.historyCapacity)||this.options.historyCapacity<1||!Number.isInteger(this.options.transportCapacity)||this.options.transportCapacity<1||!Number.isInteger(this.options.maxBufferedBytes)||this.options.maxBufferedBytes<1024||this.encoder.encode(JSON.stringify(options.session)).length>256)throw new Error('DIAGNOSTIC_BUFFER_INVALID_LIMITS')
 }
 get pendingRows(){return this.pending.length+this.active.length}
 snapshot(){return {rows:this.history.map(entry=>entry.row),dropped:this.dropped,historyDropped:this.historyDropped,pendingRows:this.pendingRows,inFlightRows:this.active.length,transportFailures:this.transportFailures}}
 record(source:DiagnosticRow){
  const row={...source,data:{...source.data},sequence:++this.rowSequence},json=JSON.stringify(row),bytes=this.encoder.encode(json).length
  // App metrics have bounded names/values. Refuse a hostile/accidental giant
  // row explicitly instead of retaining an entry that can never fit a batch.
  if(bytes>Math.min(24_000,this.options.maxBatchBytes-512,this.options.maxBufferedBytes)){
   this.historyDropped++;if(this.options.native())this.dropped++;return
  }
  const entry={row,json,bytes}
  while(this.history.length>=this.options.historyCapacity||this.historyBytes+bytes>this.options.maxBufferedBytes){const old=this.history.shift()!;this.historyBytes-=old.bytes;this.historyDropped++}
  this.history.push(entry);this.historyBytes+=bytes
  if(!this.options.native())return
  while(this.pending.length&&(this.pendingRows>=this.options.transportCapacity||this.pendingBytes+this.activeBytes+bytes>this.options.maxBufferedBytes)){const old=this.pending.shift()!;this.pendingBytes-=old.bytes;this.dropped++}
  if(this.pendingRows>=this.options.transportCapacity||this.pendingBytes+this.activeBytes+bytes>this.options.maxBufferedBytes){this.dropped++;return}
  this.pending.push(entry);this.pendingBytes+=bytes
 }
 flush(force=false):Promise<boolean>{
  if(this.drain)return this.drain
  if(!this.options.native())return Promise.resolve(true)
  if(!force&&this.options.now()<this.retryAt)return Promise.resolve(false)
  // Publish drain ownership before entering user/native transport callbacks.
  const running=Promise.resolve().then(()=>this.flushSerially())
  this.drain=running
  void running.finally(()=>{if(this.drain===running)this.drain=undefined})
  return running
 }
 private async flushSerially():Promise<boolean>{
  drain:while(this.pending.length||this.dropped!==this.reportedDropped||this.historyDropped!==this.reportedHistoryDropped){
   const dropped=this.dropped,historyDropped=this.historyDropped
   const prefix=`{"session":${JSON.stringify(this.options.session)},"batchSequence":${this.batchSequence+1},"dropped":${dropped},"historyDropped":${historyDropped},"rows":[`
   let bytes=this.encoder.encode(prefix).length+2
   const active:Entry[]=[]
   while(this.pending.length){
    const entry=this.pending[0],extra=entry.bytes+(active.length?1:0)
    if(bytes+extra>this.options.maxBatchBytes){
     if(active.length)break
     // Defensive refusal if a future envelope grows beyond the reservation.
     // Do not loop sending empty batches forever around an impossible head row.
     this.pending.shift();this.pendingBytes-=entry.bytes;this.dropped++;continue drain
    }
    this.pending.shift();this.pendingBytes-=entry.bytes;active.push(entry);bytes+=extra
   }
   this.active=active;this.activeBytes=active.reduce((sum,entry)=>sum+entry.bytes,0)
   const batch=prefix+active.map(entry=>entry.json).join(',')+']}'
   try{
    await this.options.send(batch)
    this.batchSequence++;this.reportedDropped=dropped;this.reportedHistoryDropped=historyDropped;this.retryAt=0
    this.active=[];this.activeBytes=0
   }catch{
    // Capacity already includes active rows, so restoring this prefix cannot
    // overflow. New records are never allowed to evict an in-flight authority.
    this.pending=[...active,...this.pending];this.pendingBytes+=this.activeBytes
    this.active=[];this.activeBytes=0;this.transportFailures++;this.retryAt=this.options.now()+1000
    return false
   }
  }
  return true
 }
}
