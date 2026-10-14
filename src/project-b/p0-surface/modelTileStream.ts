import type {CanvasSceneObject} from '../../canvas-engine/contracts'
import type {PyramidTile,TileRect} from '../../canvas-engine/imagePyramid'
import type {DecodedImageRegistry} from '../../canvas-engine/decodedImageRegistry'
import type {DecodedImageUpload,DecodedImageReference} from '../../canvas-engine/paintDisplayList'
import {recordMetric} from '../../diagnostics/performance'

export type TileDetail={state:'refining'|'sharp'|'budget-limited'|'error';wanted:number;ready:number;requiredLevel:number;actualLevel:number;error?:string}
type Job={key:string;object:CanvasSceneObject;tile:PyramidTile;reference:DecodedImageReference;priority:number;abort:AbortController;promise:Promise<DecodedImageUpload>;resolve:(value:DecodedImageUpload)=>void;reject:(error:unknown)=>void;running:boolean}

/** Bounded per-canvas streaming service. Visible detail precedes lookahead;
 * pins survive decode-to-presentation and obsolete requests abort real IO.
 * A coarse complete image is a disclosed preview, never a sharp receipt. */
export class ModelTileStream {
 private views=new Map<string,TileRect>()
 private versions=new Map<string,number>()
 private jobs=new Map<string,Job>();private wanted=new Set<string>();private holds=new Map<string,ReturnType<DecodedImageRegistry['retain']>>()
 private failures=new Map<string,string>();private demand=new Map<string,Set<string>>();private active=0;private stopped=false;private scene='';private notifyIds=new Set<string>();private notifyPending=false
 private owners=new Map<string,Set<string>>();private demandKeyVisits=0
 revision=0
 readonly details=new Map<string,TileDetail>()
 private registry:DecodedImageRegistry;private load:(object:CanvasSceneObject,tile:PyramidTile,signal:AbortSignal,priority:number)=>Promise<DecodedImageUpload>;private ready:(ids:ReadonlySet<string>)=>void
 constructor(registry:DecodedImageRegistry,load:(object:CanvasSceneObject,tile:PyramidTile,signal:AbortSignal,priority:number)=>Promise<DecodedImageUpload>,ready:(ids:ReadonlySet<string>)=>void){this.registry=registry;this.load=load;this.ready=ready}
 reference(object:CanvasSceneObject,tile:PyramidTile):DecodedImageReference {const model=object.modelArtwork;if(model?.kind!=='image'||!model.pyramid)throw Error('MODEL_TILE_SOURCE_REQUIRED');return {key:'tile:'+model.tilesSource+':'+model.pyramid.sourceSha256+':source-rev:'+model.sourceRevision+':'+tile.key+(model.framing?.grayscale?':gray':''),revision:model.sourceRevision,epoch:this.registry.epoch,width:tile.pixelWidth,height:tile.pixelHeight}}
 private key(reference:DecodedImageReference){return JSON.stringify([reference.key,reference.revision,reference.epoch])}
 begin(scene:string,ids:ReadonlySet<string>){
  if(scene!==this.scene){this.scene=scene;this.demand.clear();this.owners.clear();this.wanted.clear();this.details.clear();this.failures.clear();this.versions.clear();this.views.clear();this.prune()}
  for(const id of this.demand.keys())if(!ids.has(id)){this.replaceDemand(id,new Set());this.demand.delete(id);this.details.delete(id)}
 }
 update(object:CanvasSceneObject,visible:readonly PyramidTile[],preview:readonly PyramidTile[],prefetch:readonly PyramidTile[]){
  this.replaceDemand(object.id,new Set([...visible,...preview,...prefetch].map(tile=>this.key(this.reference(object,tile)))))
 }
 private replaceDemand(id:string,next:Set<string>){
  const prior=this.demand.get(id)
  for(const key of next){this.demandKeyVisits++;if(prior?.has(key))continue;let owners=this.owners.get(key);if(!owners){owners=new Set();this.owners.set(key,owners)}owners.add(id);this.wanted.add(key)}
  for(const key of prior||[]){this.demandKeyVisits++;if(next.has(key))continue;const owners=this.owners.get(key);owners?.delete(id);if(!owners?.size){this.owners.delete(key);this.wanted.delete(key);this.cancelKey(key)}}
  this.demand.set(id,next)
 }
 private cancelKey(key:string){
  const job=this.jobs.get(key);if(job){job.abort.abort();if(!job.running){this.jobs.delete(key);job.reject(Error('MODEL_TILE_CANCELLED'))}}
  this.failures.delete(key);this.holds.get(key)?.release();this.holds.delete(key)
 }
 private prune(){
  // Full retirement is reserved for scene changes/disposal. Individual image
  // updates visit changed tile keys, not every other card's demand and pins.
  for(const key of new Set([...this.jobs.keys(),...this.holds.keys(),...this.failures.keys()]))if(!this.wanted.has(key))this.cancelKey(key)
 }
 resolve(object:CanvasSceneObject,tile:PyramidTile){try{return this.registry.resolve(this.reference(object,tile))}catch{return undefined}}
 error(object:CanvasSceneObject,tiles:readonly PyramidTile[]){return tiles.map(tile=>this.failures.get(this.key(this.reference(object,tile)))).find(Boolean)}
 request(object:CanvasSceneObject,tile:PyramidTile,priority:number):Promise<DecodedImageUpload>{
  const reference=this.reference(object,tile),key=this.key(reference),resident=this.resolve(object,tile)
  if(resident)return Promise.resolve(resident)
  const existing=this.jobs.get(key);if(existing){
   // Returning to a board while its previous IO is still aborting must not
   // attach the new preview to that doomed job. Retry after its cleanup tick.
   if(existing.abort.signal.aborted){const retry=()=>new Promise<void>(resolve=>setTimeout(resolve,0)).then(()=>this.request(object,tile,priority));return existing.promise.then(retry,retry)}
   existing.priority=Math.max(existing.priority,priority);return existing.promise
  }
  const failed=this.failures.get(key);if(failed)return Promise.reject(Error(failed))
  if(this.stopped||!this.wanted.has(key))return Promise.reject(Error('MODEL_TILE_CANCELLED'))
  if(this.jobs.size>=64){this.failures.set(key,'MODEL_TILE_QUEUE_LIMIT');return Promise.reject(Error('MODEL_TILE_QUEUE_LIMIT'))}
  let resolve!:(value:DecodedImageUpload)=>void,reject!:(reason:unknown)=>void
  const promise=new Promise<DecodedImageUpload>((yes,no)=>{resolve=yes;reject=no})
  const job:Job={key,object,tile,reference,priority,abort:new AbortController(),promise,resolve,reject,running:false};this.jobs.set(key,job);this.pump();return promise
 }
 private pump(){
  if(this.stopped)return
  while(this.active<2){
   const job=[...this.jobs.values()].filter(job=>!job.running).sort((a,b)=>b.priority-a.priority)[0];if(!job)return
   job.running=true;this.active++
   void this.load(job.object,job.tile,job.abort.signal,job.priority).then(upload=>{
    if(this.stopped||job.abort.signal.aborted||!this.wanted.has(job.key))throw Error('MODEL_TILE_CANCELLED')
    this.holds.get(job.key)?.release();this.holds.set(job.key,this.registry.retain([upload.reference]));job.resolve(upload)
    if(job.priority>=300&&job.priority<1000)for(const id of this.owners.get(job.key)||[]){this.notifyIds.add(id);this.versions.set(id,(this.versions.get(id)||0)+1)}
   }).catch(error=>{job.reject(error);if(!job.abort.signal.aborted&&!this.stopped){this.failures.set(job.key,String(error));if(job.priority>=300&&job.priority<1000)for(const id of this.owners.get(job.key)||[]){this.notifyIds.add(id);this.versions.set(id,(this.versions.get(id)||0)+1)}}}).finally(()=>{
    this.active--;this.jobs.delete(job.key)
    // Queue admission is temporary. Retry deferred visible requests when a slot
    // opens, rather than leaving a permanent refining state or spinning.
    for(const [key,error] of this.failures)if(error==='MODEL_TILE_QUEUE_LIMIT'){
     this.failures.delete(key);for(const id of this.owners.get(key)||[]){this.notifyIds.add(id);this.versions.set(id,(this.versions.get(id)||0)+1)}
    }
    if(job.priority>=300&&job.priority<1000||this.notifyIds.size){this.revision++;this.notify()}this.pump()
   })
  }
 }
 private notify(){if(this.notifyPending||!this.notifyIds.size||this.stopped)return;this.notifyPending=true;queueMicrotask(()=>{this.notifyPending=false;if(this.stopped)return;const ids=new Set(this.notifyIds);this.notifyIds.clear();recordMetric('paint.tile-stream',{completedIds:ids.size,...this.stats()});this.ready(ids)})}
 previousView(id:string,view:TileRect){const previous=this.views.get(id);this.views.set(id,view);return previous}
 version(id:string){return this.versions.get(id)||0}
 stats(){return {active:this.active,queued:[...this.jobs.values()].filter(job=>!job.running).length,pinned:this.holds.size,failures:this.failures.size,wanted:this.wanted.size,demandKeyVisits:this.demandKeyVisits}}
 dispose(){this.stopped=true;this.demand.clear();this.owners.clear();this.wanted.clear();this.prune();for(const job of this.jobs.values())job.abort.abort();for(const hold of this.holds.values())hold.release();this.holds.clear();this.details.clear()}
}
