import { metricSpan,recordMetric } from '../../diagnostics/performance'
import type {CanvasSceneSnapshot,CanvasViewport,CanvasRect} from '../../canvas-engine/contracts'
import {DecodedImageRegistry} from '../../canvas-engine/decodedImageRegistry'
import type {PreparedPaintDisplayList} from '../../canvas-engine/paintDisplayList'
import {canvasResourceBudget} from '../../canvas-engine/resourceBudget'
import {captureCompleteMeasuredCardPaint,withCanonicalStageCardPaint,type CompleteCardPaintResult} from '../../board/completeMeasuredCardPaint'
import {createMeasuredCardProviders,retainedCardSupportsScale,type CardScalePolicy} from './cardProviders'
import {assembleCompletePaintList,type QualifiedObjectPaint} from './mixedPaint'
import {maskCompleteRectanglePaint} from '../../board/rectangleErasurePaint'
import type {BoardNode} from '../../model/project'
import {createStructuredCardPainter} from './structuredCardPaint'
import {createModelArtworkPainter} from './modelArtworkPaint'
import {modelPaintKey,moveModelPaint} from './modelPaintRetention'

let nextEpoch=0
/** The host owns mutation observation. Unknown/inherited style changes bump
 * globalRevision; a known card's provider/interaction changes bump only its ID.
 * Without this evidence, legacy callers retain conservative global invalidation. */
export type MountedPaintInvalidation={globalRevision:number;objectRevisions:ReadonlyMap<string,number>}
/** LiveCanvasScene and the board adapter deliver immutable projections. A
 * replacement identity conservatively invalidates even when a caller forgets
 * to advance its revision; camera wrappers retain those object identities.
 * Weak keys store numeric metadata, never another copy of path/source payloads. */
export function createMountedPaintKeys(){
 const identities=new WeakMap<object,number>();let nextIdentity=0
 const identity=(value:object)=>{let token=identities.get(value);if(token===undefined){token=++nextIdentity;identities.set(value,token)}return token}
 const object=(value:CanvasSceneSnapshot['objects'][number])=>[value.id,value.revision,identity(value)]
 return {object,scene:(value:CanvasSceneSnapshot)=>({id:value.id,objects:value.objects.map(object),connections:value.connections?.map(connection=>[connection.id,connection.revision,identity(connection)]),environment:value.environment})}
}
export function createMountedScenePaint(stage:HTMLElement){
 const registry=new DecodedImageRegistry(++nextEpoch),providers=createMeasuredCardProviders(registry,stage),structuredPainter=createStructuredCardPainter(),artworkPainter=createModelArtworkPainter(registry)
 type Paint={ids:ReadonlySet<string>;cardIds:ReadonlySet<string>;json:string;images:ReturnType<typeof assembleCompletePaintList>['images'];blockers:Record<string,readonly string[]>;stage():void;present():void;release():void}
 let cached:{key:string;vectorsJson:string;paint:Paint;holds:number}|undefined
 const semanticKeys=createMountedPaintKeys()
 type CardEntry={key:string;article:HTMLElement;card:CompleteCardPaintResult;capturedScale:number;scalePolicy:CardScalePolicy;release():void}
 const cardsById=new Map<string,CardEntry>()
 // Bounded, budget-admitted derivatives survive membership and board changes.
 // Measured DOM cards keep their conservative mounted/style keys separately.
 const modelCards=new Map<string,{key:string;object:CanvasSceneSnapshot['objects'][number];card:CompleteCardPaintResult;release():void}>()
 const releaseModels=()=>{for(const entry of modelCards.values())entry.release();modelCards.clear()}
 const mountedIdentities=new WeakMap<HTMLElement,number>()
 let nextMountedIdentity=0
 const mountedIdentity=(article:HTMLElement)=>{let id=mountedIdentities.get(article);if(id===undefined){id=++nextMountedIdentity;mountedIdentities.set(article,id)}return id}
 const evictionCounts:Record<string,number>={}
 const releaseCard=(id:string,reason='clear')=>{const entry=cardsById.get(id);if(entry){cardsById.delete(id);entry.release();evictionCounts[reason]=(evictionCounts[reason]??0)+1}}
 const releaseCards=()=>{for(const id of cardsById.keys())releaseCard(id)}
 const releaseCache=()=>{if(cached){const old=cached;cached=undefined;if(--old.holds===0)old.paint.release()}}
 const acquire=(entry:NonNullable<typeof cached>)=>{entry.holds++;let released=false;return {...entry.paint,release(){if(released)return;released=true;if(--entry.holds===0)entry.paint.release()}}}
 let disposed=false
 const bounds=(object:CanvasSceneSnapshot['objects'][number],scale:number):CanvasRect=>{
  const geometry=object.preparedVectorGeometry,rect=geometry?.status==='ready'?geometry.bounds:object.bounds
  const padding=(geometry?.status==='ready'?geometry.strokeOutsetCssPx:Math.max(16,(object.appearance.strokeWidth??2)*2+1))/scale
  return rect?{x:rect.x-padding,y:rect.y-padding,width:rect.width+padding*2,height:rect.height+padding*2}:{x:0,y:0,width:0,height:0}
 }
 return {
  async capture(scene:CanvasSceneSnapshot,view:CanvasViewport,vectors:{ids:ReadonlySet<string>;json:string},layoutRevision:number,current:()=>boolean,invalidation?:MountedPaintInvalidation,contentCurrent?:()=>boolean){
   // Same-scale pan changes only the renderer's camera. Retain the complete
   // world-space paint list and its image pins while content/membership is stable.
   if(disposed||!current())return undefined
   for(const key of Object.keys(evictionCounts))delete evictionCounts[key]
   const articles=[...stage.querySelectorAll<HTMLElement>('.board-world>.board-object-layer>article.board-node[data-node-id]')]
   const mountedArticles=new Map<string,HTMLElement[]>();for(const article of articles){const id=article.dataset.nodeId;if(id){const found=mountedArticles.get(id)??[];found.push(article);mountedArticles.set(id,found)}}
   const mounted=new Set(mountedArticles.keys())
   const candidates=scene.objects.filter(object=>!object.hidden&&!vectors.ids.has(object.id)&&mounted.has(object.id))
   const activeEditor=(object:CanvasSceneSnapshot['objects'][number])=>!!object.modelArtwork && !!stage.ownerDocument.activeElement && mountedArticles.get(object.id)?.some(article=>article.contains(stage.ownerDocument.activeElement)&&stage.ownerDocument.activeElement?.closest('[contenteditable="true"]'))
   const modelIds=new Set(candidates.filter(object=>(object.structuredCard||object.modelArtwork)&&!activeEditor(object)).map(object=>object.id))
   const modelKey=(object:CanvasSceneSnapshot['objects'][number])=>modelPaintKey(scene.id,object)
   const modelSlot=(id:string)=>JSON.stringify([scene.id,id])
   const running=(article:HTMLElement)=>article.getAnimations?.({subtree:true}).some(animation=>animation.playState==='running'||animation.pending)??false
   const animatedCards=new Set(candidates.filter(object=>mountedArticles.get(object.id)?.some(running)).map(object=>object.id))
   const animated=invalidation?animatedCards.size>0:stage.getAnimations?.({subtree:true}).some(animation=>animation.playState==='running'||animation.pending)??false
   const dpr=stage.ownerDocument.defaultView?.devicePixelRatio||1
   const dirty=invalidation?{global:invalidation.globalRevision,objects:candidates.map(object=>[object.id,invalidation.objectRevisions.get(object.id)??0]),mounted:articles.map(article=>[article.dataset.nodeId,mountedIdentity(article)])}:{layoutRevision}
   const key=JSON.stringify({animationTick:animated?performance.now():0,scene:semanticKeys.scene(scene),vectorIds:[...vectors.ids],scale:view.scale,dpr,dirty})
   if(cached?.key===key&&cached.vectorsJson===vectors.json&&!disposed&&current())return acquire(cached)
   releaseCache()
   if(!invalidation)releaseCards()
   const candidateIds=new Set(candidates.map(object=>object.id))
   for(const id of cardsById.keys())if(!candidateIds.has(id))releaseCard(id,'membership')
   // Scale is not part of authored world geometry. Check the provider's
   // explicit scale policy separately: actual-scale text/SVG still recaptures,
   // and images keep a sharper mip only while it meets rounded physical demand.
   const cardKeys=new Map(candidates.map(object=>[object.id,JSON.stringify({scene:scene.id,object:semanticKeys.object(object),dpr,global:invalidation?.globalRevision,local:invalidation?(invalidation.objectRevisions.get(object.id)??0):layoutRevision})]))
   const reusedIds=new Set<string>()
   const capturedCards=new Map<string,CompleteCardPaintResult>()
   const misses:Record<string,number>={uncached:0,global:0,local:0,semantic:0,mounted:0,dpr:0,physicalDemand:0,exactScale:0,animation:0,legacy:0}
   for(const object of candidates){
    if(modelIds.has(object.id)){
     const entry=modelCards.get(modelSlot(object.id))
     if(entry?.key===modelKey(object)){
      const moved=moveModelPaint(entry.card,entry.object,object)
      reusedIds.add(object.id);capturedCards.set(object.id,moved)
      modelCards.delete(modelSlot(object.id));modelCards.set(modelSlot(object.id),entry)
      continue
     }
    }
    const entry=cardsById.get(object.id),elements=mountedArticles.get(object.id)!
    const scaleReady=entry&&retainedCardSupportsScale(entry.scalePolicy,entry.capturedScale,view.scale,dpr)
    if(invalidation&&entry&&elements.length===1&&entry.article===elements[0]&&entry.key===cardKeys.get(object.id)&&scaleReady&&!animatedCards.has(object.id)){
     reusedIds.add(object.id);capturedCards.set(object.id,entry.card)
    }else {
     let reason='uncached'
     if(!invalidation)reason='legacy'
     else if(entry){
      const previous=JSON.parse(entry.key),next=JSON.parse(cardKeys.get(object.id)!)
      reason=elements.length!==1||entry.article!==elements[0]?'mounted':previous.global!==next.global?'global':previous.local!==next.local?'local':previous.dpr!==next.dpr?'dpr':entry.key!==cardKeys.get(object.id)?'semantic':animatedCards.has(object.id)?'animation':!scaleReady?(entry.scalePolicy.exactScale?'exactScale':'physicalDemand'):'uncached'
     }
     misses[reason]++;releaseCard(object.id,reason)
    }
   }
   recordMetric('paint.card-miss',{...misses,reused:reusedIds.size,scale:view.scale,globalRevision:invalidation?.globalRevision??-1,layoutRevision})
   const finishMetric=metricSpan('paint.capture',{objects:scene.objects.length})
   const transaction=providers.forCapture(reusedIds)
   let disposition='failed',blocked=0,admissionDenied=0
   try {
    const vectorList=JSON.parse(vectors.json) as PreparedPaintDisplayList,byId=new Map(scene.objects.map(object=>[object.id,object]))
    const contributions:QualifiedObjectPaint[]=vectorList.operations.flatMap(operation=>operation.type==='vector'?[{id:operation.object.id,ownership:'vector' as const,bounds:bounds(byId.get(operation.object.id)!,view.scale),operations:[operation],uploads:[]}]:[])
    const blockers:Record<string,readonly string[]>={}
    // All initial DOM measurements share one synchronous canonical skin.
    // Restore ownership before any browser paint or asynchronous provider IO.
    const fresh=candidates.filter(object=>!reusedIds.has(object.id))
    const fallbackIds=new Set<string>()
    const captureFresh=()=>fresh.map(object=>{
     if(activeEditor(object))return Promise.resolve({objectId:object.id,objectRevision:object.revision,order:object.order,layoutRevision,sourceFingerprint:'',status:'unsupported' as const,completePaint:false,operations:[],uploads:[],visualBounds:null,blockers:['ACTIVE_TYPE_EDITOR_DOM_OVERLAY']})
     if(object.structuredCard||object.modelArtwork)return (object.modelArtwork?artworkPainter.paint(object):structuredPainter.paint(object)).catch(error=>{
      if(disposed)throw error
      fallbackIds.add(object.id);recordMetric('paint.model-blocked',{id:object.id,reason:String(error),domMeasurements:0})
      // A failed model compiler must not resurrect mounted-card capture. Keep
      // ownership explicit; the host preserves its interaction/viewer overlay.
      return {objectId:object.id,objectRevision:object.revision,order:object.order,layoutRevision,sourceFingerprint:'',status:'unsupported' as const,completePaint:false,operations:[],uploads:[],visualBounds:null,blockers:['MODEL_PAINT_FAILED:'+String(error)]}
     })
     return captureCompleteMeasuredCardPaint(stage,scene,object,view,transaction.providers,layoutRevision)
    })
    // Retained cards and model-painted graph bodies need no semantic DOM read.
    // Avoid toggling every mounted card's ownership skin on these paths: that
    // needlessly invalidates browser styles even when the provider reads none.
    const pending=fresh.some(object=>!object.structuredCard&&!object.modelArtwork)?withCanonicalStageCardPaint(stage,captureFresh):captureFresh()
    // Wait for every provider before releasing their shared transaction, even
    // when one rejects while another still owns an asynchronous image/font read.
    const settled=await Promise.allSettled(pending)
    const rejected=settled.find(result=>result.status==='rejected')
    if(rejected?.status==='rejected')throw rejected.reason
    settled.forEach((result,index)=>{if(result.status!=='fulfilled')throw new Error('CARD_CAPTURE_INCOMPLETE');capturedCards.set(fresh[index].id,result.value)})
    // Camera motion may supersede this frame while its providers are running.
    // Qualified world paint can still warm the next capture when the host proves
    // content unchanged. The obsolete frame is NEVER compiled or presented.
    const obsolete=!current()
    if(disposed||obsolete&&(!invalidation||!contentCurrent?.())){disposition='obsolete';return undefined}
    for(let index=0;index<candidates.length;index++){
     if(disposed){disposition='obsolete';return undefined}
     const object=candidates[index]
     let card=capturedCards.get(object.id)!
     if(!reusedIds.has(object.id)&&object.shapeType==='rectangle'&&object.vectorBoolean){
      // Read-only model view for the saved cutters. The editing frame is
      // already in global board coordinates; the scene AABB is not that frame.
      const frame=object.localBounds
      if(frame){
       const expression=object.vectorBoolean
       const node:BoardNode={id:object.id,kind:'shape',shapeType:'rectangle',title:'',...frame,rotation:object.appearance.rotation,cornerRadius:object.appearance.cornerRadius,vectorBoolean:{operation:expression.operation,operands:expression.operands.map(path=>({...path,points:path.points.map(point=>({...point}))})),fillRules:expression.fillRules&&[...expression.fillRules]},vectorTransform:object.vectorTransform}
       card=maskCompleteRectanglePaint(node,card)
      }else card={...card,status:'unsupported',completePaint:false,operations:[],uploads:[],visualBounds:null,blockers:[...card.blockers,'RECTANGLE_MASK_EDITING_FRAME_MISSING']}
     }
     if(card.completePaint&&card.status==='ready'&&card.visualBounds){
      contributions.push({id:object.id,ownership:'card',bounds:card.visualBounds,operations:card.operations,uploads:card.uploads})
      if(modelIds.has(object.id)&&!fallbackIds.has(object.id)&&!reusedIds.has(object.id)){
       const slot=modelSlot(object.id),key=modelKey(object),old=modelCards.get(slot)
       old?.release();modelCards.delete(slot)
       while(modelCards.size>=128){const first=modelCards.keys().next().value!;modelCards.get(first)!.release();modelCards.delete(first)}
       const lease=canvasResourceBudget.acquire({owner:modelCards,key:slot,pool:'retained',bytes:(JSON.stringify(card.operations).length+key.length)*2,pinned:true})
       if(lease){
        try{
         const pin=registry.retain(card.operations.flatMap(operation=>operation.type==='image'?[operation.resource]:[]))
         modelCards.set(slot,{key,object,card:{...card,sourceFingerprint:''},release(){pin.release();lease.release()}})
        }catch(error){lease.release();throw error}
       }else admissionDenied++
      }
      if(!modelIds.has(object.id)&&invalidation&&!reusedIds.has(object.id)&&!animatedCards.has(object.id)&&mountedArticles.get(object.id)!.length===1&&cardsById.size<1024){
       const cardKey=cardKeys.get(object.id)!,bytes=(JSON.stringify(card.operations).length+cardKey.length)*2
       const lease=canvasResourceBudget.acquire({owner:cardsById,key:object.id,pool:'retained',bytes,pinned:true})
       // Retention is optional admission; complete paint is still submitted
       // unchanged when the shared resource budget cannot keep this derivative.
       if(lease){
        const references=card.operations.flatMap(operation=>operation.type==='image'?[operation.resource]:[])
        let pin:ReturnType<typeof registry.retain>
        try{pin=registry.retain(references)}catch(error){lease.release();throw error}
        let released=false
        // The full DOM/style fingerprint already verified asynchronous source
        // stability. Retention needs the derivative only; do not keep a second
        // copy of every computed CSS value or inline image URL for each card.
        cardsById.set(object.id,{key:cardKey,article:mountedArticles.get(object.id)![0],card:{...card,sourceFingerprint:''},capturedScale:view.scale,scalePolicy:transaction.scalePolicyFor(object.id),release(){if(released)return;released=true;pin.release();lease.release()}})
       }else admissionDenied++
      }
     }
     else {blockers[object.id]=card.blockers;blocked++}
    }
    if(!current()||disposed){disposition='obsolete';return undefined}
    // Virtualized objects with no mounted DOM and no engine contribution do
    // not paint. Their saved bounds cannot block this visible presentation.
    const contributing=new Set(contributions.map(contribution=>contribution.id))
    const paintedScene={...scene,objects:scene.objects.filter(object=>mounted.has(object.id)||contributing.has(object.id))}
    const compiled=assembleCompletePaintList(paintedScene,contributions,view.scale),json=JSON.stringify(compiled.displayList)
    const length=new TextEncoder().encode(json).byteLength
    if(length>16*1024*1024)throw new Error('DISPLAY_LIST_RESOURCE_LIMIT: encoded snapshot exceeds engine limit')
    const lease=canvasResourceBudget.acquire({owner:registry,key:`scene-paint:${scene.id}:${scene.revision}:${layoutRevision}`,pool:'retained',bytes:(json.length+key.length+vectors.json.length)*2,pinned:true})
    if(!lease)throw new Error('RESOURCE_BUDGET_EXCEEDED: complete snapshot admission denied')
    let pin:ReturnType<typeof registry.retain>
    try{pin=registry.retain(compiled.displayList.resources)}catch(error){lease.release();throw error}
    const paint:Paint={ids:compiled.ids,cardIds:compiled.cardIds,json,images:compiled.images,blockers,
     stage(){registry.stage(compiled.displayList.resources)},present(){registry.stage(compiled.displayList.resources);registry.present()},
     release(){pin.release();lease.release()}}
    cached={key,vectorsJson:vectors.json,paint,holds:1}
    recordMetric('paint.card-retention',{reused:reusedIds.size,captured:fresh.length,cached:cardsById.size,modelCached:modelCards.size,modelCandidates:modelIds.size,modelFallbacks:fallbackIds.size,scale:view.scale,globalRevision:invalidation?.globalRevision??-1})
    disposition='complete'
    return acquire(cached)
   } finally {
    recordMetric('paint.capture-outcome',{disposition,blocked,admissionDenied,candidates:candidates.length,cached:cardsById.size})
    if(Object.keys(evictionCounts).length)recordMetric('paint.cache-evict',evictionCounts)
    finishMetric();transaction.release();registry.discard()
   }
  },
  dispose(){if(disposed)return;disposed=true;releaseCache();releaseCards();releaseModels();structuredPainter.dispose();artworkPainter.dispose();providers.dispose();registry.dispose()},
  stats(){return registry.stats()},
 }
}

