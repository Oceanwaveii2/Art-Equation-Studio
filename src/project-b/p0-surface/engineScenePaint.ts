import {ModelTileStream} from './modelTileStream'
import {decodeModelTile} from './modelTilePaint'
import {decodeModelImage,modelImageSourceIdentity} from './modelImageDecode'
import {modelImageDemand} from './modelImageDemand'
import {planModelImageTiles} from './modelImageTiles'
import {metricSpan, recordMetric} from '../../diagnostics/performance'
import type {CanvasSceneSnapshot,CanvasViewport} from '../../canvas-engine/contracts'
import {DecodedImageRegistry} from '../../canvas-engine/decodedImageRegistry'
import type {PreparedPaintDisplayList} from '../../canvas-engine/paintDisplayList'
import {canvasResourceBudget} from '../../canvas-engine/resourceBudget'
import type {CompleteCardPaintResult} from '../../canvas-engine/completePaint'
import {assembleCompletePaintList,type QualifiedObjectPaint} from './mixedPaint'
import {createStructuredCardPainter} from './structuredCardPaint'
import {createModelArtworkPainter} from './modelArtworkPaint'
import {modelPaintKey,moveModelPaint} from './modelPaintRetention'

let nextEpoch=100000
type SceneInputs={scene:string;environment:string;camera:string;objects:CanvasSceneSnapshot['objects'];demands:string[];vectors:string;editor:string|undefined;detail:number}
const sameInputs=(a:SceneInputs,b:SceneInputs)=>a.scene===b.scene&&a.environment===b.environment&&a.camera===b.camera&&a.vectors===b.vectors&&a.editor===b.editor&&a.detail===b.detail&&a.objects.length===b.objects.length&&a.objects.every((object,index)=>object===b.objects[index]&&a.demands[index]===b.demands[index])
/** The production compiler consumes authored scene data. Legacy CSSOM/card
 * providers are not instantiated here. Active IME/viewer controls are separate
 * overlays; unsupported families remain explicit blockers, never captured DOM. */
export function createEngineScenePaint(activeEditor:()=>string|undefined=()=>undefined,onDetailReady?: (ids:ReadonlySet<string>)=>void) {
 const registry=new DecodedImageRegistry(++nextEpoch,canvasResourceBudget,onDetailReady?8*1024*1024:0),graph=createStructuredCardPainter()
 const stream=onDetailReady?new ModelTileStream(registry,(object,tile,signal,priority)=>decodeModelTile(object,tile,registry,()=>!signal.aborted,signal,priority),onDetailReady):undefined
 const artwork=createModelArtworkPainter(registry,stream)
 const vectorContributions=new WeakMap<object,{object:CanvasSceneSnapshot['objects'][number];scale:number;paint:QualifiedObjectPaint}>()
 const cards=new Map<string,{key:string;object:CanvasSceneSnapshot['objects'][number];card:CompleteCardPaintResult;bytes:number;release():void}>()
 type Paint={ids:ReadonlySet<string>;cardIds:ReadonlySet<string>;json:string;displayList:PreparedPaintDisplayList;images:ReturnType<typeof assembleCompletePaintList>['images'];blockers:Record<string,readonly string[]>;imageDetail:Record<string,unknown>;stage():void;present():void;release():void}
 const CARD_CACHE_BYTES=32*1024*1024
 let retainedBytes=0,cacheEvictions=0,activeSceneId:string|undefined
 const evictCard=(slot:string)=>{const entry=cards.get(slot);if(!entry)return;cards.delete(slot);retainedBytes-=entry.bytes;entry.release();cacheEvictions++}
 const demandKey=(object:CanvasSceneSnapshot['objects'][number],view:CanvasViewport,dpr:number)=>{
  const m=object.modelArtwork
  return m?.kind==='image'&&!m.pyramid&&m.sourceDimensions?JSON.stringify(modelImageDemand(object,m.sourceDimensions,view,dpr)):
   m?.kind==='image'&&!m.pyramid?JSON.stringify([view.scale,dpr]):''
 }
 let cached:{inputs:SceneInputs;paint:Paint;holds:number}|undefined,disposed=false
 let stableScale=0,stableDpr=0
 const releaseCache=()=>{const old=cached;cached=undefined;if(old&&--old.holds===0)old.paint.release()}
 const acquire=(entry:NonNullable<typeof cached>)=>{entry.holds++;let released=false;return {...entry.paint,release(){if(released)return;released=true;if(--entry.holds===0)entry.paint.release()}}}
 return {
  async capture(scene:CanvasSceneSnapshot,view:CanvasViewport,vectors:{ids:ReadonlySet<string>;json:string;displayList?:PreparedPaintDisplayList},_layoutRevision:number,current:()=>boolean,_invalidation?:unknown,contentCurrent?:()=>boolean,surfaceSize?:{width:number;height:number},dpr=1){
   if(disposed||!current())return undefined
   const editor=activeEditor()
   // Visible immutable membership, paint tokens and detail revision are the dependencies.
   // Non-tiled paint does not depend on camera translation; bypass preparation bookkeeping.
   if(cached&&cached.inputs.scene===scene.id&&cached.inputs.editor===editor&&cached.inputs.vectors===vectors.json&&cached.inputs.detail===(stream?.revision||0)&&stableScale===view.scale&&stableDpr===dpr&&cached.inputs.environment===JSON.stringify(scene.environment)&&!cached.inputs.camera&&scene.objects.length===cached.inputs.objects.length&&scene.objects.every((object,i)=>object===cached!.inputs.objects[i])){
    recordMetric('paint.preparation-reused',{objects:scene.objects.length});return acquire(cached)
   }
   stream?.begin(scene.id,new Set(scene.objects.filter(o=>!o.hidden).map(o=>o.id)))
   // The caller supplies spatial-index membership. Drop inactive/offscreen
   // retained cards before new decode admission; outstanding snapshots keep
   // their independent pins until the renderer settles.
   if(activeSceneId!==scene.id){releaseCache();registry.retirePresentation();activeSceneId=scene.id}
   const slots=new Set(scene.objects.filter(o=>!o.hidden).map(o=>JSON.stringify([scene.id,o.id])))
   for(const [slot,entry] of cards)if(!slots.has(slot)&&entry.card.uploads.length)evictCard(slot)
   // Compare immutable ordered membership and narrow demand inputs directly.
   // Whole rich-text/media/vector payloads are not serialized into cache keys.
   const inputs:SceneInputs={scene:scene.id,environment:JSON.stringify(scene.environment),camera:scene.objects.some(o=>o.modelArtwork?.kind==='image'&&o.modelArtwork.pyramid)?JSON.stringify([view,surfaceSize,dpr]):'',objects:scene.objects,demands:scene.objects.map(object=>demandKey(object,view,dpr)),vectors:vectors.json,editor,detail:stream?.revision||0}
   if(cached&&sameInputs(cached.inputs,inputs))return acquire(cached)
   const oldObjects=new Map(cached?.inputs.objects.map(object=>[object.id,object])||[])
   const changedObjects=scene.objects.filter(object=>oldObjects.get(object.id)!==object).length
   releaseCache()
   const end=metricSpan('paint.engine-compile',{objects:scene.objects.length}),blockers:Record<string,readonly string[]>={}
   let reused=0,compiled=0
   const capturePins:ReturnType<typeof registry.retain>[]=[]
   try {
    const vectorList=vectors.displayList??JSON.parse(vectors.json) as PreparedPaintDisplayList,byId=new Map(scene.objects.map(object=>[object.id,object]))
    const contributions:QualifiedObjectPaint[]=vectorList.operations.flatMap(operation=>{
     if(operation.type!=='vector')return []
     const object=byId.get(operation.object.id);if(!object)throw Error('ENGINE_VECTOR_ID_MISSING')
     const cachedVector=vectorContributions.get(operation)
     if(cachedVector?.object===object&&cachedVector.scale===view.scale)return [cachedVector.paint]
     const padding=Math.max(16,(object.appearance.strokeWidth || 0)*2+1)/view.scale
     const paint:QualifiedObjectPaint={id:object.id,ownership:'vector',bounds:{x:object.bounds.x-padding,y:object.bounds.y-padding,width:object.bounds.width+padding*2,height:object.bounds.height+padding*2},operations:[operation],uploads:[]}
     vectorContributions.set(operation,{object,scale:view.scale,paint});return [paint]
    })
    // Two visible-image lanes overlap async asset IO and worker decoding.
    // Share identical asset/demand jobs; pin each prepared upload until the
    // complete snapshot owns it. Fonts/cards remain ordered below.
    const jobs=new Map<string,CanvasSceneSnapshot['objects'][number]>()
    for(const object of scene.objects){
     const model=object.modelArtwork
     if(object.hidden||object.id===editor||model?.kind!=='image'||model.pyramid||!model.sourceDimensions)continue
     const slot=JSON.stringify([scene.id,object.id]),entry=cards.get(slot)
     if(entry?.key===modelPaintKey(scene.id,object)+demandKey(object,view,dpr))continue
     const job=JSON.stringify([modelImageSourceIdentity(object),model.sourceRevision,model.framing?.grayscale,demandKey(object,view,dpr)])
     if(!jobs.has(job))jobs.set(job,object)
    }
    const queue=[...jobs.values()]
    const prepare=async()=>{while(queue.length&&!disposed&&(current()||!!contentCurrent?.())){
     const object=queue.shift()!
     try{const upload=await decodeModelImage(object,registry,()=>!disposed&&(current()||!!contentCurrent?.()),view,dpr);capturePins.push(registry.retain([upload.reference]))}
     catch{/* The ordered painter below reports the visible source/admission error. */}
    }}
    await Promise.all([prepare(),prepare()])
    // Ordered card assembly follows bounded image preparation. Camera-obsolete work stops between cards; accepted cached
    // unchanged paint survives camera moves and pure translations. Idle text
    // may remain in the byte-bounded LRU; inactive image pins are released.
    for(const object of scene.objects){
     if(object.hidden||vectors.ids.has(object.id))continue
     if(object.id===editor){blockers[object.id]=['ACTIVE_IME_EDITOR_OVERLAY'];continue}
     if(!object.modelArtwork&&!object.structuredCard){blockers[object.id]=['ENGINE_MODEL_PROVIDER_REQUIRED:'+object.kind];continue}
     if(disposed||!current()&&!contentCurrent?.())return undefined
     const slot=JSON.stringify([scene.id,object.id]),paintKey=modelPaintKey(scene.id,object)+demandKey(object,view,dpr)+(object.modelArtwork?.kind==='image'&&object.modelArtwork.pyramid&&surfaceSize?JSON.stringify(planModelImageTiles(object,view,surfaceSize,dpr ).tiles.map(t=>[t.key,!!stream?.resolve(object,t),stream?.version(object.id)])):''),entry=cards.get(slot)
     let card:CompleteCardPaintResult
     if(entry?.key===paintKey){card=moveModelPaint(entry.card,entry.object,object);reused++;capturePins.push(registry.retain(card.uploads.map(upload=>upload.reference)));cards.delete(slot);cards.set(slot,entry)}
     else {
      try {card=await(object.modelArtwork?artwork.paint(object,view,surfaceSize,dpr,()=>!disposed&&(current()||!!contentCurrent?.())):graph.paint(object));compiled++}
      catch(error){if(disposed)return undefined;blockers[object.id]=['ENGINE_MODEL_PAINT_FAILED:'+String(error)];recordMetric('paint.model-blocked',{id:object.id,reason:String(error),domMeasurements:0});continue}
      if(disposed)return undefined
      if(card.completePaint&&card.status==='ready'){
       capturePins.push(registry.retain(card.uploads.map(upload=>upload.reference)))
       evictCard(slot)
       const bytes=(JSON.stringify(card.operations).length+paintKey.length)*2+card.uploads.reduce((sum,upload)=>sum+upload.pixels.byteLength*2,0)
       while(cards.size&&(cards.size>=128||retainedBytes+bytes>CARD_CACHE_BYTES))evictCard(cards.keys().next().value!)
       const lease=canvasResourceBudget.acquire({owner:cards,key:slot,pool:'retained',bytes:(JSON.stringify(card.operations).length+paintKey.length)*2,pinned:true})
       if(lease&&bytes<=CARD_CACHE_BYTES){try {const pin=registry.retain(card.uploads.map(upload=>upload.reference));cards.set(slot,{key:paintKey,object,bytes,card:{...card,sourceFingerprint:''},release(){pin.release();lease.release()}});retainedBytes+=bytes}catch(error){lease.release();throw error}}else lease?.release()
      }
     }
     if(card.completePaint&&card.status==='ready'&&card.visualBounds)contributions.push({id:object.id,ownership:'card',bounds:card.visualBounds,operations:card.operations,uploads:card.uploads})
     else blockers[object.id]=card.blockers
    }
    if(disposed||!current())return undefined
    const result=assembleCompletePaintList(scene,contributions,view.scale),json=JSON.stringify(result.displayList)
    if(new TextEncoder().encode(json).length>16*1024*1024)throw Error('DISPLAY_LIST_RESOURCE_LIMIT')
    const lease=canvasResourceBudget.acquire({owner:registry,key:'snapshot:'+scene.id,pool:'retained',bytes:json.length*2+inputs.objects.length*32+inputs.environment.length*2+inputs.camera.length*2,pinned:true})
    if(!lease)throw Error('RESOURCE_BUDGET_EXCEEDED: engine snapshot')
    let pin:ReturnType<typeof registry.retain>;try{pin=registry.retain(result.displayList.resources)}catch(error){lease.release();throw error}
    const paint:Paint={ids:result.ids,cardIds:result.cardIds,json,displayList:result.displayList,images:result.images,blockers,imageDetail:Object.fromEntries(stream?.details||[]),stage(){registry.stage(result.displayList.resources)},present(){registry.stage(result.displayList.resources);registry.present()},release(){pin.release();lease.release()}}
    cached={inputs,paint,holds:1};stableScale=view.scale;stableDpr=dpr
    recordMetric('paint.engine-owned',{compiled,reused,changedObjects,cached:cards.size,retainedBytes,cacheEvictions,decodedBytes:registry.stats().bytes,decodedCount:registry.stats().count,accepted:result.ids.size,overlays:Object.keys(blockers).length,domMeasurements:0})
    return acquire(cached)
   } finally{for(const pin of capturePins)pin.release();end();registry.discard()}
  },
  dispose(){if(disposed)return;disposed=true;releaseCache();for(const entry of cards.values())entry.release();cards.clear();stream?.dispose();graph.dispose();artwork.dispose();registry.dispose()},
  stats(){return {...registry.stats(),retainedCardBytes:retainedBytes,retainedCards:cards.size,cacheEvictions,stream:stream?.stats()}}
 }
}

