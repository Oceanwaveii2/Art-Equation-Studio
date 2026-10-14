import {invoke} from '@tauri-apps/api/core'
import type {CanvasRect} from '../../canvas-engine/contracts'
import {captureLoadedImagePaint,DecodedImageRegistry} from '../../canvas-engine/decodedImageRegistry'
import type {PaintMatrix,PaintOperation} from '../../canvas-engine/paintDisplayList'
import {createNativeTextFontResolver,createTextPaintSession} from '../../canvas-engine/semanticTextPaint'
import type {CompleteCardPaintProviders} from '../../board/completeMeasuredCardPaint'
import {loadVelloEngine} from './backends'
import {captureSvgPaint} from './svgPaint'
import {createSvgEffectProvider} from './svgEffects'
import {imageDemand} from '../../canvas-engine/imageDemand'
import {captureLiveVideoPaint,watchLiveVideoFrames,retireLiveVideoPaintBindings,type LiveVideoFrameWatcher} from './liveVideoPaint'
import {captureBackgroundImagePaint} from './backgroundImagePaint'

export type CardScalePolicy={exactScale:boolean;images:readonly {width:number;height:number;transform:PaintMatrix;acceptedWidth:number;acceptedHeight:number}[]}
/** Unhinted HTML outlines and measured CSS boxes are in world coordinates.
 * Hinted/SVG text retains its actual-scale oracle. Static image derivatives
 * can be reused only while their decoded mip still meets physical demand. */
export function retainedCardSupportsScale(policy:CardScalePolicy,capturedScale:number,requestedScale:number,dpr:number):boolean{
 if(![capturedScale,requestedScale,dpr].every(value=>Number.isFinite(value)&&value>0)||policy.exactScale&&capturedScale!==requestedScale)return false
 return policy.images.every(image=>{const demand=imageDemand(image.width,image.height,image.transform,requestedScale*dpr);return demand.width<=image.acceptedWidth&&demand.height<=image.acceptedHeight})
}

const rectPath=(width:number,height:number)=>[['M',0,0],['L',width,0],['L',width,height],['L',0,height],['Z']] as const
function worldBounds(points:readonly (readonly [number,number])[],matrix:PaintMatrix):CanvasRect {
 const [a,b,c,d,e,f]=matrix,xs=points.map(([x,y])=>a*x+c*y+e),ys=points.map(([x,y])=>b*x+d*y+f)
 return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}
}
function outlineBounds(operations:readonly PaintOperation[],fallback:PaintMatrix):CanvasRect {
 const points: (readonly [number,number])[]=[]
 for(const operation of operations)if(operation.type==='vector') {
  const matrix=(operation.object.transform??fallback) as PaintMatrix,[a,b,c,d,e,f]=matrix
  const commands=(operation.object.payload as {commands:readonly (readonly (string|number)[])[]}).commands
  for(const command of commands)for(let i=1;i+1<command.length;i+=2){const x=Number(command[i]),y=Number(command[i+1]);points.push([a*x+c*y+e,b*x+d*y+f])}
 }
 return worldBounds(points.length?points:[[fallback[4],fallback[5]]],[1,0,0,1,0,0])
}
const position=(token:string,space:number)=>{
 if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(token))return Number.parseFloat(token)*space/100
 if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(token))return Number.parseFloat(token)
 throw new Error('IMAGE_OBJECT_POSITION_UNSUPPORTED: explicit computed px or percentage required')
}

/** Providers read the existing mounted layout and accepted static image only.
 * No document/editor state is copied into a second model. Derivative ownership
 * and resource pins remain with the enclosing complete frame transaction. */
export function createMeasuredCardProviders(registry:DecodedImageRegistry,stage?:HTMLElement) {
 const resolver=createNativeTextFontResolver((command,args)=>invoke(command,args as Record<string,unknown>))
 const effects=createSvgEffectProvider(registry,loadVelloEngine)
 let disposed=false,version=0
 const sources=new Map<string,{source:string;width:number;height:number;revision:number;image:HTMLImageElement;loadVersion:number}>()
 const videos=new Map<string,{element:HTMLVideoElement;watcher:LiveVideoFrameWatcher;frameRevision:number;revision:number}>()
 const backgrounds=new Map<string,{source:string;image:HTMLImageElement;ready:Promise<void>;revision:number;invalidated:boolean;cancel():void}>()
 const loads=new WeakMap<HTMLImageElement,number>()
 let loadVersion=0
 const invalidateBackgrounds=(image:HTMLImageElement)=>{
  const matching=new Set([image.currentSrc,image.src].filter(Boolean))
  for(const record of backgrounds.values())if(matching.has(record.source))record.invalidated=true
 }
 const loaded=(event:Event)=>{
  const image=event.target,Image=stage?.ownerDocument.defaultView?.HTMLImageElement
  if(Image&&image instanceof Image){loads.set(image,++loadVersion);invalidateBackgrounds(image)}
 }
 stage?.addEventListener('load',loaded,true)
 // A same-URL assignment can retain currentSrc/natural metrics while its new
 // request is pending. Invalidate the derivative at request time as well as
 // load time; a later successful load gets a separate immutable revision.
 const sourceObserver=stage?new MutationObserver(records=>{
  const Image=stage.ownerDocument.defaultView?.HTMLImageElement
  for(const record of records){
   if(Image&&record.target instanceof Image){loads.set(record.target,++loadVersion);invalidateBackgrounds(record.target)}
   else if(record.target instanceof Element&&record.target.localName==='source'){
    const image=record.target.closest('picture')?.querySelector('img')
    if(image){loads.set(image,++loadVersion);invalidateBackgrounds(image)}
   }
  }
 }):undefined
 sourceObserver?.observe(stage!,{subtree:true,attributes:true,attributeFilter:['src','srcset','sizes']})
 const derivatives=new Set<{release():void}>()
 const knownEffectIds=new Set<string>()
 let sessionPromise:Promise<ReturnType<typeof createTextPaintSession>>|undefined
 const textSession=()=>sessionPromise??=(loadVelloEngine().then(module=>{
  if(disposed)throw new Error('TEXT_ENGINE_DISPOSED')
  return createTextPaintSession(new module.TextEngine(String(registry.epoch)),String(registry.epoch))
 }).catch(error=>{sessionPromise=undefined;throw error}))
 const createProviders=(owned:Set<{release():void}>,seen:Set<string>,effectIds:Set<string>,scales:Map<string,CardScalePolicy>):CompleteCardPaintProviders=>({
  async video(element,options){return options.canonicalRead(()=>{
   seen.add(options.id)
   let record=videos.get(options.id)
   if(record?.element!==element){
    record?.watcher.dispose()
    if(record)retireLiveVideoPaintBindings(registry,options.id)
    const watcher=watchLiveVideoFrames(element,{onInvalidate:(reason,frameRevision)=>element.dispatchEvent(new CustomEvent('vello-provider-frame',{bubbles:true,detail:{reason,frameRevision}}))})
    record={element,watcher,frameRevision:0,revision:++version};videos.set(options.id,record)
   }
   const frame=record.watcher.snapshot()
   if(!frame)throw new Error('CARD_VIDEO_FRAME_NOT_READY')
   if(record.frameRevision!==frame.revision){record.frameRevision=frame.revision;record.revision=++version}
   const style=element.ownerDocument.defaultView!.getComputedStyle(element)
   const tokens=style.objectPosition.trim().split(/\s+/)
   if(tokens.length!==2||tokens.some(token=>!/^[-+]?\d+(?:\.\d+)?%$/.test(token)))throw new Error('VIDEO_OBJECT_POSITION_UNSUPPORTED')
   const captured=captureLiveVideoPaint(element,registry,{id:options.id,key:options.id,revision:record.revision,frame,contentTransform:options.contentTransform,contentSize:options.contentSize,physicalScale:options.cameraScale*(element.ownerDocument.defaultView?.devicePixelRatio||1),objectFit:style.objectFit as 'contain',objectPosition:[Number.parseFloat(tokens[0])/100,Number.parseFloat(tokens[1])/100],isCurrentFrame:record.watcher.isCurrent})
   // Live frames invalidate this object's retained paint through the watcher;
   // decoded marker revisions identify immutable frame pixels independently
   // of document revision. No recurring work is scheduled while paused.
   scales.set(options.id,{exactScale:true,images:[]})
   return {completePaint:true,sourceFingerprint:options.sourceFingerprint,operations:captured.operations,uploads:[captured.upload],visualBounds:captured.visualBounds,blockers:[]}
  })},
  async backgroundImage(element,options){
   seen.add(options.id)
   const source=options.layer.source
   if(!/\.(?:png|jpe?g|bmp|tiff?|ico)(?:[?#]|$)/i.test(decodeURIComponent(source)))throw new Error('BACKGROUND_STATIC_FORMAT_UNQUALIFIED')
   let record=backgrounds.get(options.id)
   if(!record||record.source!==source||record.invalidated){
    if(backgrounds.size>=1024&&!record)throw new Error('BACKGROUND_PROVIDER_SOURCE_LIMIT')
    const image=element.ownerDocument.createElement('img')
    record?.cancel()
    // CSS URLs inherit the page's origin policy; unreadable cross-origin pixels
    // remain an explicit provider refusal rather than guessed GPU ownership.
    image.crossOrigin='anonymous'
    let cancel=()=>{}
    const ready=new Promise<void>((resolve,reject)=>{
     let settled=false
     const finish=(error?:Error)=>{if(settled)return;settled=true;window.clearTimeout(timer);image.onload=image.onerror=null;if(error)reject(error);else resolve()}
     const timer=window.setTimeout(()=>finish(new Error('BACKGROUND_IMAGE_LOAD_TIMEOUT')),15000)
     cancel=()=>{finish(new Error('BACKGROUND_IMAGE_SOURCE_RETIRED'));image.removeAttribute('src')}
     image.onload=()=>finish()
     image.onerror=()=>finish(new Error('BACKGROUND_IMAGE_LOAD_FAILED'))
     image.src=source
    })
    record={source,image,ready,revision:++version,invalidated:false,cancel};backgrounds.set(options.id,record)
   }
   await record.ready
   if(disposed||!element.isConnected||backgrounds.get(options.id)!==record)throw new Error('BACKGROUND_IMAGE_SOURCE_STALE')
   const captured=options.canonicalRead(()=>captureBackgroundImagePaint(record!.image,registry,{id:options.id,key:options.id,revision:record!.revision,layer:options.layer,borderBoxTransform:options.borderBoxTransform,physicalScale:options.cameraScale*(element.ownerDocument.defaultView?.devicePixelRatio||1)}))
   scales.set(options.id,{exactScale:false,images:captured.scaleImages})
   return {completePaint:true,sourceFingerprint:options.sourceFingerprint,operations:captured.operations,uploads:captured.uploads,visualBounds:captured.visualBounds,blockers:[]}
  },
  async svg(element,options){
   // SVG text baselines and ellipse approximation certification currently
   // depend on the sampled scale. Conservatively retain every SVG at one scale.
   scales.set(options.id,{exactScale:true,images:[]})
   return captureSvgPaint(element,options,async(text,transform,id)=>{
    const session=await textSession()
    const result=await session.prepareSvg(text,{id,revision:String(options.revision),transform,resolveFont:resolver,canonicalRead:options.canonicalRead,rootOpacityOwned:true})
    derivatives.add(result);owned.add(result)
    return result
   },request=>{effectIds.add(request.id);knownEffectIds.add(request.id);return effects.prepare(request)})
  },
  async text(element,options){
   const session=await textSession()
   const result=await session.prepare(element,{id:options.id,revision:String(options.revision),transform:options.contentTransform,resolveFont:resolver,canonicalRead:options.canonicalRead,rootBackgroundOwned:true})
   scales.set(options.id,{exactScale:result.qualification?.scaleDependent!==false,images:[]})
   derivatives.add(result)
   owned.add(result)
   return {completePaint:result.completePaint,sourceFingerprint:options.sourceFingerprint,operations:result.operations,visualBounds:outlineBounds(result.operations,options.contentTransform),blockers:result.blockers}
  },
  async image(element,options){return options.canonicalRead(()=>{
   seen.add(options.id)
   if(seen.size>1024)throw new Error('IMAGE_PROVIDER_SOURCE_LIMIT')
   const extension=element.closest<HTMLElement>('[data-image-extension]')?.dataset.imageExtension?.toLowerCase()
   // Animated/unknown providers need their own lifecycle derivative. PNG/JPEG
   // and decoded TIFF/BMP previews are the measured static providers here.
   if(!extension||!['png','jpg','jpeg','bmp','tif','tiff','ico'].includes(extension))throw new Error('IMAGE_PROVIDER_STATIC_FORMAT_UNQUALIFIED')
   const style=element.ownerDocument.defaultView!.getComputedStyle(element),source=element.currentSrc||element.src
   const size=options.contentSize,width=element.naturalWidth,height=element.naturalHeight
   if(![size.width,size.height,width,height].every(n=>Number.isFinite(n)&&n>0))throw new Error('IMAGE_CONTENT_METRICS_INVALID')
   let scaleX=size.width/width,scaleY=size.height/height
   if(style.objectFit!=='fill'){
    const scale=style.objectFit==='cover'?Math.max(scaleX,scaleY):style.objectFit==='contain'?Math.min(scaleX,scaleY):style.objectFit==='none'?1:style.objectFit==='scale-down'?Math.min(1,scaleX,scaleY):NaN
    if(!Number.isFinite(scale))throw new Error('IMAGE_OBJECT_FIT_UNSUPPORTED')
    scaleX=scaleY=scale
   }
   const tokens=style.objectPosition.trim().split(/\s+/)
   if(tokens.length!==2)throw new Error('IMAGE_OBJECT_POSITION_UNSUPPORTED')
   const x=Number.parseFloat(style.borderLeftWidth)+Number.parseFloat(style.paddingLeft)+position(tokens[0],size.width-width*scaleX)
   const y=Number.parseFloat(style.borderTopWidth)+Number.parseFloat(style.paddingTop)+position(tokens[1],size.height-height*scaleY)
   const [a,b,c,d,e,f]=options.borderBoxTransform
   const transform:PaintMatrix=[a*scaleX,b*scaleX,c*scaleY,d*scaleY,e+a*x+c*y,f+b*x+d*y]
   let record=sources.get(options.id)
   const acceptedLoad=loads.get(element)??0
   if(!record||record.source!==source||record.width!==width||record.height!==height||record.image!==element||record.loadVersion!==acceptedLoad){
    record={source,width,height,revision:++version,image:element,loadVersion:acceptedLoad};sources.set(options.id,record)
   }
   const captured=captureLoadedImagePaint(element,registry,{id:options.id,key:options.id,revision:record.revision,providerKind:'static-image',transform,opacity:1,physicalScale:options.cameraScale*(element.ownerDocument.defaultView?.devicePixelRatio||1)})
   scales.set(options.id,{exactScale:false,images:[{width,height,transform,acceptedWidth:captured.upload.reference.width,acceptedHeight:captured.upload.reference.height}]})
   const left=Number.parseFloat(style.borderLeftWidth)+Number.parseFloat(style.paddingLeft),top=Number.parseFloat(style.borderTopWidth)+Number.parseFloat(style.paddingTop)
   const content:PaintMatrix=[a,b,c,d,e+a*left+c*top,f+b*left+d*top],scopeId=options.id+':content-clip'
   const operations:PaintOperation[]=[{type:'pushClip',scopeId,commands:rectPath(size.width,size.height),transform:content,fillRule:'nonzero',isolation:'isolated'},captured.operation,{type:'pop',scopeId}]
   return {completePaint:true,sourceFingerprint:options.sourceFingerprint,operations,uploads:[captured.upload],visualBounds:worldBounds([[0,0],[size.width,0],[size.width,size.height],[0,size.height]],content),blockers:[]}
  })},
 })
 return {forCapture(retainedObjectIds:ReadonlySet<string>=new Set()){
  const owned=new Set<{release():void}>(),seen=new Set<string>(),effectIds=new Set<string>(),scales=new Map<string,CardScalePolicy>()
  // A retained complete card still owns the provider identities that created
  // its uploads. A partial capture must not retire a neighboring cached card.
  // Provider IDs use the compiler's objectId:box-N namespace, not a revision.
  const retained=(id:string)=>[...retainedObjectIds].some(objectId=>id.startsWith(objectId+':box-'))
  return {providers:createProviders(owned,seen,effectIds,scales),scalePolicyFor(objectId:string):CardScalePolicy{
   const matches=[...scales].filter(([id])=>id.startsWith(objectId+':box-')).map(([,policy])=>policy)
   return {exactScale:matches.some(policy=>policy.exactScale),images:matches.flatMap(policy=>policy.images)}
  },release(){
   for(const result of owned){result.release();derivatives.delete(result)}owned.clear()
   for(const id of knownEffectIds)if(retained(id))effectIds.add(id)
   effects.retireExcept(effectIds)
   for(const id of knownEffectIds)if(!effectIds.has(id))knownEffectIds.delete(id)
   for(const id of sources.keys())if(!seen.has(id)&&!retained(id))sources.delete(id)
   for(const [id,record] of videos)if(!seen.has(id)&&!retained(id)){record.watcher.dispose();retireLiveVideoPaintBindings(registry,id);videos.delete(id)}
   for(const [id,record] of backgrounds)if(!seen.has(id)&&!retained(id)){record.cancel();backgrounds.delete(id)}
  }}
 },dispose(){disposed=true;effects.dispose();knownEffectIds.clear();sourceObserver?.disconnect();stage?.removeEventListener('load',loaded,true);resolver.dispose();sources.clear();for(const [id,record] of videos){record.watcher.dispose();retireLiveVideoPaintBindings(registry,id)}videos.clear();for(const record of backgrounds.values())record.cancel();backgrounds.clear();for(const result of derivatives)result.release();derivatives.clear();void sessionPromise?.then(session=>session.dispose(),()=>{})}}
}
