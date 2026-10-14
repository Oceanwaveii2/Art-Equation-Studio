import {appendAssetPathUrl} from '../../canvas-engine/assetPathUrl'
import type {CanvasSceneObject,CanvasViewport,CanvasSize} from '../../canvas-engine/contracts'
import type {PaintOperation,DecodedImageUpload,PaintMatrix} from '../../canvas-engine/paintDisplayList'
import type {DecodedImageRegistry} from '../../canvas-engine/decodedImageRegistry'
import {canvasResourceBudget} from '../../canvas-engine/resourceBudget'
import {metricSpan,recordMetric} from '../../diagnostics/performance'
import {planModelImageTiles} from './modelImageTiles'
import {planPyramid,planDirectionalPrefetch,type PyramidTile} from '../../canvas-engine/imagePyramid'
import type {ModelTileStream} from './modelTileStream'
import {prepareModelImage} from '../../board/preparationWorkers'

export async function decodeModelTile(object:CanvasSceneObject,tile:PyramidTile,registry:DecodedImageRegistry,current:()=>boolean,signal?:AbortSignal,priority=100){
 const model=object.modelArtwork;if(model?.kind!=='image'||!model.tilesSource||!model.pyramid)throw Error('MODEL_TILE_SOURCE_REQUIRED')
 const reference={key:'tile:'+model.tilesSource+':'+model.pyramid.sourceSha256+':source-rev:'+model.sourceRevision+':'+tile.key+(model.framing?.grayscale?':gray':''),revision:model.sourceRevision,epoch:registry.epoch,width:tile.pixelWidth,height:tile.pixelHeight}
  let upload:DecodedImageUpload
  try{upload=registry.resolve(reference)}catch(error){
   if(!String(error).includes('RESOURCE_NOT_READY'))throw error
   const admission=registry.reserve(reference)
   const lease=canvasResourceBudget.acquire({owner:registry,key:'decode:'+reference.key,pool:'tile-surface',bytes:tile.pixelWidth*tile.pixelHeight*12,pinned:true})
   if(!lease){admission.release();throw Error('MODEL_TILE_RESOURCE_LIMIT')}
   const abort=new AbortController(),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)abort.abort();const timer=setTimeout(()=>abort.abort(),15000),finish=metricSpan('paint.prepare.tile-decode',{id:object.id,level:tile.level})
   
   try{
    const response=await fetch(appendAssetPathUrl(model.tilesSource,tile.key),{signal:abort.signal})
    if(abort.signal.aborted||!current())throw Error('MODEL_TILE_CANCELLED')
    if(!response.ok||!response.body)throw Error('MODEL_TILE_FETCH_FAILED:'+response.status)
    const reader=response.body.getReader(),parts:BlobPart[]=[];let bytes=0
    try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4*1024*1024){await reader.cancel();throw Error('MODEL_TILE_TRANSFER_LIMIT')}parts.push(new Uint8Array(part.value))}}finally{reader.releaseLock()}
    const decoded=await prepareModelImage({blob:new Blob(parts,{type:'image/png'}),width:tile.pixelWidth,height:tile.pixelHeight,gray:!!model.framing?.grayscale},abort.signal,tile.pixelWidth*tile.pixelHeight*12,priority)
    if(abort.signal.aborted||!current())throw Error('MODEL_TILE_CANCELLED')
    if(decoded.sourceWidth!==tile.pixelWidth||decoded.sourceHeight!==tile.pixelHeight)throw Error('MODEL_TILE_DIMENSIONS_MISMATCH')
    upload=registry.register(reference,decoded.pixels)
   }finally{finish();clearTimeout(timer);signal?.removeEventListener('abort',cancel);lease.release();admission.release()}
  }
 return upload
}

/** Decodes bounded source tiles offscreen. Mounted cards and CSSOM are absent. */
export async function paintModelTiles(object:CanvasSceneObject,registry:DecodedImageRegistry,view:CanvasViewport,size:CanvasSize,dpr:number,current:()=>boolean,stream?:ModelTileStream) {
 const model=object.modelArtwork
 if(model?.kind!=='image'||!model.tilesSource||!model.pyramid)throw Error('MODEL_TILE_SOURCE_REQUIRED')
 const plan=planModelImageTiles(object,view,size,dpr),operations:PaintOperation[]=[],uploads:DecodedImageUpload[]=[]
 let chosen=plan.tiles
 if(stream){
  const previewLevel=Math.max(0,Math.min(plan.requiredLevel-2,plan.tiles[0]?.level??plan.requiredLevel))
  const preview=planPyramid(model.pyramid,plan.crop,2**(previewLevel-model.pyramid.maxLevel),4)
  const lookahead=planDirectionalPrefetch(model.pyramid,plan.tiles,plan.crop,stream.previousView(object.id,plan.crop),2)
  stream.update(object,plan.tiles,preview,lookahead)
  let ready=plan.tiles.filter(tile=>stream.resolve(object,tile)).length
  if(ready<plan.tiles.length){
   await Promise.all(preview.map(tile=>stream.request(object,tile,1000)))
   chosen=preview
   for(const tile of plan.tiles)if(!stream.resolve(object,tile))void stream.request(object,tile,300).catch(()=>{})
   ready=plan.tiles.filter(tile=>stream.resolve(object,tile)).length
   if(ready===plan.tiles.length)chosen=plan.tiles
  }
  // Do not let lookahead consume admission before visible detail completes.
  if(ready===plan.tiles.length)for(const tile of lookahead)void stream.request(object,tile,0).catch(()=>{})
  const error=stream.error(object,plan.tiles),actualLevel=chosen[0]?.level??plan.requiredLevel
  stream.details.set(object.id,{state:error?'error':actualLevel<plan.requiredLevel?(ready<plan.tiles.length?'refining':'budget-limited'):'sharp',wanted:plan.tiles.length,ready,requiredLevel:plan.requiredLevel,actualLevel,...(error?{error}:{})})
 }
 const scope=object.id+':tile-content',frame=object.localBounds!,r=object.appearance.rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r)
 const frameMatrix:PaintMatrix=[c,s,-s,c,frame.x+frame.width/2-c*frame.width/2+s*frame.height/2,frame.y+frame.height/2-s*frame.width/2-c*frame.height/2]
 const commands=[['M',0,plan.top],['L',frame.width,plan.top],['L',frame.width,frame.height],['L',0,frame.height],['Z']] as const
 const blend=model.framing?.blendMode
 if(blend&&blend!=='source-over')operations.push({type:'pushComposite',scopeId:scope+':blend',commands,transform:frameMatrix,fillRule:'nonzero',isolation:'isolated',opacity:1,blendMode:blend==='multiply'?'multiply':'screen'})
 operations.push({type:'pushClip',scopeId:scope,commands,transform:frameMatrix,fillRule:'nonzero',isolation:'isolated'})
 for(const tile of chosen){
  if(!current())throw Error('MODEL_TILE_CANCELLED')
  const reference={key:'tile:'+model.tilesSource+':'+model.pyramid.sourceSha256+':source-rev:'+model.sourceRevision+':'+tile.key+(model.framing?.grayscale?':gray':''),revision:model.sourceRevision,epoch:registry.epoch,width:tile.pixelWidth,height:tile.pixelHeight}
  const upload=stream?.resolve(object,tile) || await decodeModelTile(object,tile,registry,current)
  const factor=2**(model.pyramid.maxLevel-tile.level),[a,b,cc,d,e,f]=plan.matrix
  // Overlap pixels remain in the source but only the core paints, avoiding seams/duplicate alpha.
  operations.push({type:'image',id:object.id+':'+tile.key,resource:reference,sourceRect:{x:tile.left,y:tile.top,width:tile.coreWidth,height:tile.coreHeight},transform:[a*factor,b*factor,cc*factor,d*factor,e+a*(tile.x-tile.left*factor)+cc*(tile.y-tile.top*factor),f+b*(tile.x-tile.left*factor)+d*(tile.y-tile.top*factor)],opacity:object.appearance.opacity*(model.framing?.opacity??1),sampling:'bilinear'})
  uploads.push(upload)
 }
 operations.push({type:'pop',scopeId:scope});if(blend&&blend!=='source-over')operations.push({type:'pop',scopeId:scope+':blend'})
 recordMetric('paint.model-tiles',{id:object.id,tiles:plan.tiles.length,requiredLevel:plan.requiredLevel,actualLevel:chosen[0]?.level??plan.requiredLevel,detail:stream?.details.get(object.id)?.state || (plan.tiles.some(tile=>tile.level<plan.requiredLevel)?'budget-limited':'ready'),domMeasurements:0})
 return {operations,uploads}
}
