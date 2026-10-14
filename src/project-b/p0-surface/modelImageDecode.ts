import type {CanvasSceneObject,CanvasViewport} from '../../canvas-engine/contracts'
import type {DecodedImageRegistry} from '../../canvas-engine/decodedImageRegistry'
import type {DecodedImageUpload,DecodedImageReference} from '../../canvas-engine/paintDisplayList'
import {canvasResourceBudget} from '../../canvas-engine/resourceBudget'
import {metricSpan,recordMetric} from '../../diagnostics/performance'
import {decodeTiff,prepareModelImage} from '../../board/preparationWorkers'
import {modelImageDemand} from './modelImageDemand'

const sourceIds=new Map<string,number>();let nextSourceId=0,sourceIdBytes=0
const modelSourceIds=new WeakMap<object,{source:string;identity:string}>()
export function modelImageSourceIdentity(object:CanvasSceneObject){
 const model=object.modelArtwork;if(model?.kind!=='image')throw Error('MODEL_IMAGE_DESCRIPTOR_INVALID')
 // Short URLs are stable across cache eviction and fit the image-key limit.
 if(model.source.length<=800&&new TextEncoder().encode(model.source).length<=800)return 'source:'+model.source
 const cached=modelSourceIds.get(model);if(cached?.source===model.source)return cached.identity
 // Long exact strings share IDs while resident; immutable models keep their ID
 // after interner eviction. Oversized inline sources never alias by object ID.
 const source=model.source,bytes=source.length*2
 let id=sourceIds.get(source);if(id===undefined){id=++nextSourceId;if(bytes<=8*1024*1024){while(sourceIds.size&&(sourceIds.size>=128||sourceIdBytes+bytes>8*1024*1024)){const key=sourceIds.keys().next().value!;sourceIdBytes-=key.length*2;sourceIds.delete(key)}sourceIds.set(source,id);sourceIdBytes+=bytes}}
 const identity='source-id:'+id;modelSourceIds.set(model,{source,identity});return identity
}

type Known={source:string;revision:number;gray:boolean;reference:DecodedImageReference;dimensions:{width:number;height:number}}
const knownSources=new WeakMap<DecodedImageRegistry,Map<string,Known>>()
const sourceSizes=new WeakMap<DecodedImageUpload,{width:number;height:number}>()
export const decodedModelImageDimensions=(upload:DecodedImageUpload)=>sourceSizes.get(upload)
const rejected=new WeakMap<DecodedImageRegistry,Map<string,{revision:string;error:string}>>()
export function clearModelImageDecodes(registry:DecodedImageRegistry){knownSources.delete(registry);rejected.delete(registry)}

/** Only visible scene members reach this decoder. Fetch is asynchronous; decode,
 * scaling and pixel readback run in the bounded shared preparation worker pool. */
export async function decodeModelImage(object:CanvasSceneObject,registry:DecodedImageRegistry,current:()=>boolean,view?:CanvasViewport,dpr=1):Promise<DecodedImageUpload> {
 const model=object.modelArtwork
 if(model?.kind!=='image'||model.pyramid)throw Error('MODEL_IMAGE_DESCRIPTOR_INVALID')
 let known=knownSources.get(registry);if(!known){known=new Map();knownSources.set(registry,known)}
 let failures=rejected.get(registry);if(!failures){failures=new Map();rejected.set(registry,failures)}
 const key=modelImageSourceIdentity(object),previous=known.get(key),gray=!!model.framing?.grayscale
 let dimensions=model.sourceDimensions||(previous?.source===model.source?previous.dimensions:undefined)
 const referenceFor=(size:{width:number;height:number})=>{
  const demand=modelImageDemand(object,size,view,dpr)
  return {key:'model:'+key+':source-rev:'+model.sourceRevision+(gray?':gray':'')+':'+demand.width+'x'+demand.height,revision:model.sourceRevision,epoch:registry.epoch,width:demand.width,height:demand.height}
 }
 let reference=dimensions?referenceFor(dimensions):undefined,reservation:ReturnType<DecodedImageRegistry['reserve']>|undefined
 const failureKey=JSON.stringify([model.source,model.sourceRevision,gray,reference?.width,reference?.height])
 const capacityToken=()=>registry.stats().residencyRevision+':'+canvasResourceBudget.snapshot().bytes
 const failed=failures.get(failureKey)
 if(failed?.revision===capacityToken()){recordMetric('paint.prepare.image-admission-skipped',{id:object.id});throw Error(failed.error)}
 if(reference){try{return registry.resolve(reference)}catch(error){if(!String(error).includes('RESOURCE_NOT_READY'))throw error}}
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000),finish=metricSpan('paint.prepare.image-decode',{id:object.id})
 let scratch:ReturnType<typeof canvasResourceBudget.acquire>
 try{
  if(reference)reservation=registry.reserve(reference)
  if(!current())throw Error('MODEL_IMAGE_CANCELLED')
  let blob:Blob
  if(/^tiff?$/i.test(model.extension||''))blob=(await decodeTiff(model.source,abort.signal,false)).blob
  else{
   const response=await fetch(model.source,{signal:abort.signal})
   if(!response.ok||!response.body)throw Error('MODEL_IMAGE_FETCH_FAILED:'+response.status)
   const reader=response.body.getReader(),parts:BlobPart[]=[];let bytes=0
   try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>64*1024*1024){await reader.cancel();throw Error('MODEL_IMAGE_TRANSFER_LIMIT')}parts.push(new Uint8Array(chunk.value))}}finally{reader.releaseLock()}
   blob=new Blob(parts,{type:response.headers.get('content-type')||'application/octet-stream'})
  }
  if(abort.signal.aborted||!current())throw Error('MODEL_IMAGE_CANCELLED')
  if(!dimensions){const probe=await prepareModelImage({blob,probe:true},abort.signal,128*1024*1024);dimensions={width:probe.width,height:probe.height}}
  reference ??= referenceFor(dimensions)
  reservation ??= registry.reserve(reference)
  const workingBytes=blob.size+dimensions.width*dimensions.height*4+reference.width*reference.height*8
  scratch=canvasResourceBudget.acquire({owner:registry,key:object.id+':decode',pool:'tile-surface',bytes:workingBytes,pinned:true})
  if(!scratch)throw Error('MODEL_IMAGE_RESOURCE_LIMIT')
  const decoded=await prepareModelImage({blob,width:reference.width,height:reference.height,gray},abort.signal,workingBytes)
  if(!current()||abort.signal.aborted)throw Error('MODEL_IMAGE_CANCELLED')
  if(decoded.sourceWidth!==dimensions.width||decoded.sourceHeight!==dimensions.height)throw Error('MODEL_IMAGE_SOURCE_DIMENSIONS_MISMATCH')
  const upload=registry.register(reference,decoded.pixels)
  sourceSizes.set(upload,dimensions)
  failures.delete(failureKey);known.delete(key);while(known.size>=128)known.delete(known.keys().next().value!)
  known.set(key,{source:model.source,revision:model.sourceRevision,gray,reference,dimensions})
  recordMetric('paint.prepare.image-demand',{id:object.id,width:reference.width,height:reference.height,sourceWidth:dimensions.width,sourceHeight:dimensions.height})
  return upload
 }catch(error){
  reservation?.release();reservation=undefined;scratch?.release();scratch=undefined
  if(String(error).includes('RESOURCE_BUDGET_EXCEEDED')){
   while(failures.size>=128)failures.delete(failures.keys().next().value!)
   failures.set(failureKey,{revision:capacityToken(),error:String(error)})
  }
  throw error
 }finally{reservation?.release();scratch?.release();finish();clearTimeout(timer)}
}
