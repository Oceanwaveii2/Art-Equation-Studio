import type {CanvasRect} from '../../canvas-engine/contracts'
import type {PaintMatrix,PaintOperation} from '../../canvas-engine/paintDisplayList'
import {normalizeMeasuredColor} from '../../board/measuredCardPaint'
import {DecodedImageRegistry,imageIdentity,MAX_DECODED_IMAGE_BYTES} from '../../canvas-engine/decodedImageRegistry'
import type {DecodedImageReference,DecodedImageUpload} from '../../canvas-engine/paintDisplayList'
import {canvasResourceBudget} from '../../canvas-engine/resourceBudget'

export type SvgEffectRequest={id:string;filter:string;operations:readonly PaintOperation[];transform:PaintMatrix;bounds:CanvasRect;cameraScale:number}
export type SvgEffectResult={operations:readonly PaintOperation[];uploads:readonly DecodedImageUpload[];visualBounds:CanvasRect}
/** Only the app's linear dash-offset flow may be sampled into paint frames.
 * Transform, opacity and arbitrary property animations retain DOM ownership. */
export function qualifiedSvgFlow(animation:Animation):boolean{
 const effect=animation.effect
 if(!(effect instanceof KeyframeEffect)||!(effect.target instanceof SVGElement)||!('animationName' in animation)||!['shape-arrow-flow','connector-flow'].includes(String(animation.animationName)))return false
 const timing=effect.getTiming(),frames=effect.getKeyframes()
 if(timing.easing!=='linear'||typeof timing.duration!=='number'||timing.duration<=0||timing.duration>10000||frames.length<2||frames.length>4)return false
 return frames.every(frame=>Object.keys(frame).every(key=>['offset','computedOffset','easing','composite','strokeDashoffset'].includes(key))&&frame.easing==='linear'&&(frame.strokeDashoffset===undefined||/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(String(frame.strokeDashoffset))))
}

export type SvgDropShadow=Readonly<{x:number;y:number;sigma:number;color:string}>
export function parseSvgDropShadows(source:string):SvgDropShadow[]{
 if(source==='none')return []
 const result:SvgDropShadow[]=[];let offset=0
 while(offset<source.length){
  while(source[offset]===' ')offset++
  if(!source.startsWith('drop-shadow(',offset))throw new Error('SVG_FILTER_UNSUPPORTED: drop-shadow only')
  const start=offset+12;let depth=1;offset=start
  while(offset<source.length&&depth){if(source[offset]==='(')depth++;if(source[offset]===')')depth--;offset++}
  if(depth)throw new Error('SVG_FILTER_INVALID: unbalanced filter')
  const value=source.slice(start,offset-1),colorMatch=/rgba?\([^)]*\)|#[\da-f]{6,8}\b/i.exec(value)
  if(!colorMatch)throw new Error('SVG_FILTER_UNSUPPORTED: explicit computed sRGB color required')
  const color=normalizeMeasuredColor(colorMatch[0]),tokens=value.replace(colorMatch[0],'').trim().split(/\s+/)
  if(!color||tokens.length<2||tokens.length>3||tokens.some(token=>!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(token)))throw new Error('SVG_FILTER_UNSUPPORTED: computed px shadow')
  const [x,y,sigma=0]=tokens.map(Number.parseFloat)
  if(![x,y,sigma].every(Number.isFinite)||Math.max(Math.abs(x),Math.abs(y),sigma)>128||sigma<0||result.length>=4)throw new Error('SVG_FILTER_UNSUPPORTED: bounded shadow limit')
  result.push({x,y,sigma,color})
 }
 return result
}
export const multiplyEffectMatrix=(a:PaintMatrix,b:PaintMatrix):PaintMatrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
export function inverseEffectMatrix(m:PaintMatrix):PaintMatrix{
 const det=m[0]*m[3]-m[1]*m[2]
 if(!m.every(Number.isFinite)||Math.abs(det)<1e-12)throw new Error('SVG_FILTER_INVALID: singular transform')
 return [m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,(m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det]
}
export function effectBounds(box:CanvasRect,m:PaintMatrix):CanvasRect{
 const points=[[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]],xs=points.map(([x,y])=>m[0]*x+m[2]*y+m[4]),ys=points.map(([x,y])=>m[1]*x+m[3]*y+m[5])
 return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}
}
export function effectLocalOperations(operations:readonly PaintOperation[],inverse:PaintMatrix):PaintOperation[]{
 return operations.map(operation=>{
  if(operation.type==='pop')return operation
  if(operation.type==='vector')return {...operation,object:{...operation.object,transform:multiplyEffectMatrix(inverse,(operation.object.transform??[1,0,0,1,0,0]) as PaintMatrix)}}
  return {...operation,transform:multiplyEffectMatrix(inverse,operation.transform)}
 })
}

/** Bounded separable Gaussian alpha only. Original vectors are retained in the
 * paint list; the derived shadow image is shared by Vello GPU and Vello CPU. */
export function gaussianShadowAlpha(source:Float32Array,width:number,height:number,sigma:number):Float32Array{
 if(source.length!==width*height||!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>2048||height>2048||width*height>1_048_576||!Number.isFinite(sigma)||sigma<0||sigma>64)throw new Error('SVG_FILTER_BUDGET: alpha surface')
 if(sigma<.01)return source.slice()
 const radius=Math.ceil(3*sigma),kernel=Float64Array.from({length:radius*2+1},(_,index)=>Math.exp(-.5*((index-radius)/sigma)**2)),total=kernel.reduce((a,b)=>a+b,0)
 for(let i=0;i<kernel.length;i++)kernel[i]/=total
 const horizontal=new Float32Array(source.length),result=new Float32Array(source.length)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let sum=0;for(let k=-radius;k<=radius;k++)if(x+k>=0&&x+k<width)sum+=source[y*width+x+k]*kernel[k+radius];horizontal[y*width+x]=sum}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let sum=0;for(let k=-radius;k<=radius;k++)if(y+k>=0&&y+k<height)sum+=horizontal[(y+k)*width+x]*kernel[k+radius];result[y*width+x]=sum}
 return result
}

export function createSvgEffectProvider(registry:DecodedImageRegistry,load:()=>Promise<typeof import('./generated/p0_engine_wasm')>){
 let revision=0,disposed=false
 const cache=new Map<string,{fingerprint:string;references:DecodedImageReference[];operations:PaintOperation[];visualBounds:CanvasRect}>()
 return {async prepare(request:SvgEffectRequest):Promise<SvgEffectResult>{
  if(disposed)throw new Error('SVG_FILTER_DISPOSED')
  const shadows=parseSvgDropShadows(request.filter),inverse=inverseEffectMatrix(request.transform),box=effectBounds(request.bounds,inverse)
  const scale=Math.max(.25,Math.min(4,(globalThis.devicePixelRatio||1)*request.cameraScale*Math.max(Math.hypot(request.transform[0],request.transform[1]),Math.hypot(request.transform[2],request.transform[3]))))
  const padding=shadows.reduce((sum,shadow)=>sum+Math.max(Math.abs(shadow.x),Math.abs(shadow.y))+3*shadow.sigma,2/scale)
  const x=Math.floor((box.x-padding)*scale)/scale,y=Math.floor((box.y-padding)*scale)/scale,width=Math.ceil((box.x+box.width+padding-x)*scale),height=Math.ceil((box.y+box.height+padding-y)*scale)
  if(!Number.isFinite(width*height)||width<=0||height<=0||width>2048||height>2048||width*height>262144)throw new Error('SVG_FILTER_BUDGET: bounded derivative required')
  const signature=JSON.stringify({...request,scale})
  if(signature.length>2_000_000)throw new Error('SVG_FILTER_BUDGET: source encoding')
  const lease=canvasResourceBudget.acquire({owner:cache,key:request.id,pool:'tile-surface',bytes:width*height*64+signature.length*4,pinned:true})
  if(!lease)throw new Error('SVG_FILTER_BUDGET: transient admission denied')
  try{
   const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature))),value=>value.toString(16).padStart(2,'0')).join(''),previous=cache.get(request.id)
   if(previous?.fingerprint===fingerprint){try{return {operations:[...previous.operations,...request.operations],visualBounds:previous.visualBounds,uploads:previous.references.map(reference=>registry.resolve(reference))}}catch(error){if(!String(error).includes('RESOURCE_NOT_READY'))throw error}}
   if(cache.size>=1024&&!cache.has(request.id))throw new Error('SVG_FILTER_BUDGET: derivative identity limit')
   const module=await load()
   if(disposed)throw new Error('SVG_FILTER_DISPOSED')
   const renderer=new module.B4CpuRenderer(),resources=new Map<string,DecodedImageReference>()
   for(const operation of request.operations)if(operation.type==='image')resources.set(imageIdentity(operation.resource),operation.resource)
   let rgba:Uint8Array
   try{
    for(const resource of resources.values()){const upload=registry.resolve(resource);renderer.register_image(JSON.stringify(resource),upload.pixels)}
    rgba=renderer.render_snapshot(width,height,JSON.stringify({schema:'art-equation.display-list',schemaVersion:2,sceneId:request.id,revision:'1',environment:{background:'#00000000',colorSpace:'srgb'},resources:[...resources.values()],operations:effectLocalOperations(request.operations,inverse)}),scale,-x*scale,-y*scale)
   }finally{renderer.dispose();renderer.free()}
   let alpha=Float32Array.from({length:width*height},(_,index)=>rgba[index*4+3]/255)
   const operations:PaintOperation[]=[],uploads:DecodedImageUpload[]=[],references:DecodedImageReference[]=[]
   const pending:{reference:DecodedImageReference;pixels:Uint8Array}[]=[]
   for(const [index,shadow] of shadows.entries()){
    const blurred=gaussianShadowAlpha(alpha,width,height,shadow.sigma*scale),pixels=new Uint8Array(width*height*4),color=[1,3,5,7].map(offset=>Number.parseInt(shadow.color.slice(offset,offset+2),16))
    for(let i=0;i<blurred.length;i++){pixels[i*4]=color[0];pixels[i*4+1]=color[1];pixels[i*4+2]=color[2];pixels[i*4+3]=Math.round(blurred[i]*color[3])}
    const reference={key:request.id+':shadow-'+index,revision:++revision,epoch:registry.epoch,width,height}
    pending.push({reference,pixels})
    operations.unshift({type:'image',id:reference.key,resource:reference,sourceRect:{x:0,y:0,width,height},transform:multiplyEffectMatrix(request.transform,[1/scale,0,0,1/scale,x+shadow.x,y+shadow.y]),opacity:1,sampling:'bilinear'})
    // A successive drop-shadow sees the source plus prior shadows. Retain that
    // combined alpha, including fractional offsets, for its next convolution.
    const next=new Float32Array(alpha.length),dx=shadow.x*scale,dy=shadow.y*scale
    const sample=(px:number,py:number)=>px>=0&&py>=0&&px<width&&py<height?blurred[py*width+px]:0
    for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
     const sx=xx-dx,sy=yy-dy,bx=Math.floor(sx),by=Math.floor(sy),fx=sx-bx,fy=sy-by,b=(sample(bx,by)*(1-fx)*(1-fy)+sample(bx+1,by)*fx*(1-fy)+sample(bx,by+1)*(1-fx)*fy+sample(bx+1,by+1)*fx*fy)*color[3]/255,a=alpha[yy*width+xx]
     next[yy*width+xx]=a+(1-a)*b
    }
    alpha=next
   }
   // Admit all derived resources before publishing any of them. Registration
   // is synchronous after this reservation, so another async capture cannot
   // consume the checked budget between the reservation and registrations.
   const retainedBytes=width*height*8*pending.length,stats=registry.stats()
   if(stats.count+pending.length>1024||stats.bytes+retainedBytes>MAX_DECODED_IMAGE_BYTES)throw new Error('SVG_FILTER_BUDGET: registry admission denied')
   const admission=canvasResourceBudget.acquire({owner:cache,key:request.id+':admission',pool:'retained',bytes:retainedBytes,pinned:true})
   if(!admission)throw new Error('SVG_FILTER_BUDGET: retained admission denied')
   admission.release()
   for(const item of pending){references.push(item.reference);uploads.push(registry.register(item.reference,item.pixels))}
   const visualBounds=effectBounds({x,y,width:width/scale,height:height/scale},request.transform)
   const completeOperations=[...operations,...request.operations]
   cache.set(request.id,{fingerprint,references,operations,visualBounds})
   return {operations:completeOperations,uploads,visualBounds}
  }finally{lease.release()}
 },retireExcept(ids:ReadonlySet<string>){for(const id of cache.keys())if(!ids.has(id))cache.delete(id)},dispose(){disposed=true;cache.clear()}}
}
