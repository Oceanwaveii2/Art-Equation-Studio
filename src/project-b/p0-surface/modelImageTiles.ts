import type {CanvasSceneObject,CanvasViewport,CanvasSize} from '../../canvas-engine/contracts'
import {imageDrawRect} from '../../model/imageFraming'
import {planPyramid,requiredPyramidLevel,validPyramid} from '../../canvas-engine/imagePyramid'
import type {PaintMatrix} from '../../canvas-engine/paintDisplayList'

/** Camera and authored transforms are the only tile-demand geometry inputs. */
export function planModelImageTiles(object:CanvasSceneObject,view:CanvasViewport,size:CanvasSize,dpr:number) {
 const model=object.modelArtwork,frame=object.localBounds
 if(model?.kind!=='image'||!validPyramid(model.pyramid)||!frame||!size.width||!size.height)throw Error('MODEL_TILE_DESCRIPTOR_INVALID')
 const p=model.pyramid,top=model.header?.height||0,height=frame.height-top
 const fit=imageDrawRect(p,{width:frame.width,height},model.framing)
 if(!fit||!Number.isFinite(dpr)||dpr<=0||!Number.isFinite(view.scale)||view.scale<=0)throw Error('MODEL_TILE_VIEW_INVALID')
 const angle=object.appearance.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle)
 const imageAngle=(model.framing?.rotation||0)*Math.PI/180,rc=Math.cos(imageAngle),rs=Math.sin(imageAngle),fx=model.framing?.flipX?-1:1,fy=model.framing?.flipY?-1:1
 const ia=rc*fx,ib=rs*fx,ic=-rs*fy,id=rc*fy
 const tx=frame.x+frame.width/2-c*frame.width/2+s*frame.height/2,ty=frame.y+frame.height/2-s*frame.width/2-c*frame.height/2
 const x=frame.width/2+ia*(fit.x-frame.width/2)+ic*(fit.y-height/2),y=top+height/2+ib*(fit.x-frame.width/2)+id*(fit.y-height/2)
 const matrix:PaintMatrix=[(c*ia-s*ib)*fit.scaleX,(s*ia+c*ib)*fit.scaleX,(c*ic-s*id)*fit.scaleY,(s*ic+c*id)*fit.scaleY,tx+c*x-s*y,ty+s*x+c*y]
 const [a,b,cc,d,e,f]=matrix,det=a*d-b*cc
 if(Math.abs(det)<1e-12)throw Error('MODEL_TILE_TRANSFORM_INVALID')
 const points=[[0,0],[size.width,0],[size.width,size.height],[0,size.height]].map(([sx,sy])=>{const wx=(sx-view.x)/view.scale-e,wy=(sy-view.y)/view.scale-f;return {x:(d*wx-cc*wy)/det,y:(a*wy-b*wx)/det}})
 const left=Math.max(0,Math.min(...points.map(p=>p.x))),upper=Math.max(0,Math.min(...points.map(p=>p.y)))
 const crop={x:left,y:upper,width:Math.max(0,Math.min(p.width,Math.max(...points.map(p=>p.x)))-left),height:Math.max(0,Math.min(p.height,Math.max(...points.map(p=>p.y)))-upper)}
 const density=Math.max(fit.scaleX,fit.scaleY)*view.scale*dpr,tiles=planPyramid(p,crop,density)
 return {matrix,fit,tiles,requiredLevel:requiredPyramidLevel(p,density),density,top,height,crop}
}
