import type {CanvasEnvironment, CanvasSize, CanvasViewport, CanvasVectorCommand} from './contracts'
import type {PaintOperation, PreparedPaintDisplayList} from './paintDisplayList'

/** View-bounded world-space grid. No CSS gradients or mounted object geometry. */
export function environmentPaint(environment:CanvasEnvironment, view:CanvasViewport, size:CanvasSize, pixelRatio=1):readonly PaintOperation[] {
  if (![view.x,view.y,view.scale,size.width,size.height].every(Number.isFinite)||view.scale<=0||size.width<=0||size.height<=0) throw Error('ENVIRONMENT_VIEW_INVALID')
  const grid=environment.grid
  if (!grid.visible||grid.opacity<=0||!Number.isFinite(grid.spacing)||grid.spacing<=0) return []
  if(!Number.isFinite(pixelRatio)||pixelRatio<=0)throw Error('ENVIRONMENT_PIXEL_RATIO_INVALID')
  // Decimate authored lines by whole powers of two rather than changing the
  // world grid continuously at distant zoom levels. Its origin stays fixed.
  // Keep distant lines distinguishable instead of forming a dense raster that
  // shimmers when a retained frame is rescaled during zoom.
  const stride=2**Math.max(0,Math.ceil(Math.log2(12/(grid.spacing*view.scale))))
  const spacing=grid.spacing*stride,left=-view.x/view.scale,top=-view.y/view.scale
  const right=left+size.width/view.scale,bottom=top+size.height/view.scale
  const minor:CanvasVectorCommand[]=[],major:CanvasVectorCommand[]=[]
  // Align constant-width strokes to the backing pixels. Fractional camera
  // movement must not alternate between one bright line and two dim lines.
  const strokePixels=Math.max(1,Math.round(pixelRatio)),phase=strokePixels%2/2
  const aligned=(world:number,pan:number)=>(Math.round((world*view.scale+pan)*pixelRatio-phase)+phase)/pixelRatio/view.scale-pan/view.scale
  for(let i=Math.ceil(left/spacing);i<=Math.floor(right/spacing);i++) {const path=i%4===0?major:minor,x=aligned(i*spacing,view.x);path.push(['M',x,top],['L',x,bottom])}
  for(let i=Math.ceil(top/spacing);i<=Math.floor(bottom/spacing);i++) {const path=i%4===0?major:minor,y=aligned(i*spacing,view.y);path.push(['M',left,y],['L',right,y])}
  return [minor,major].map((commands,index)=>({type:'vector',object:{id:'environment:grid:'+index,kind:'vector',order:-1,bounds:{x:left,y:top,width:right-left,height:bottom-top},transform:[1,0,0,1,0,0],visible:true,locked:true,opacity:Math.min(1,Math.max(0,grid.opacity)*(index?1.18:.78)),blendMode:'normal',payload:{commands,fill:'#00000000',stroke:grid.color||'#3a3f49',strokeWidth:strokePixels/pixelRatio/view.scale,vectorStrokeCap:'butt'}}}))
}

export function withEnvironmentPaint(list:PreparedPaintDisplayList, environment:CanvasEnvironment, view:CanvasViewport, size:CanvasSize,pixelRatio=1):PreparedPaintDisplayList {
  return {...list,environment:{background:environment.background,colorSpace:'srgb'},operations:[...environmentPaint(environment,view,size,pixelRatio),...list.operations]}
}
