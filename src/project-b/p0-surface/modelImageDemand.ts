import type {CanvasSceneObject,CanvasViewport} from '../../canvas-engine/contracts'
import {imageDrawRect} from '../../model/imageFraming'
import {imageDemand} from '../../canvas-engine/imageDemand'

/** Required physical density, rounded UP to a stable mip bucket. Sources remain
 * unchanged. Rotation/flip are orthogonal; explicit fill uses its largest axis. */
export function modelImageDemand(object:CanvasSceneObject,source:{width:number;height:number},view?:CanvasViewport,dpr=1){
 const frame=object.localBounds!,model=object.modelArtwork
 if(model?.kind!=='image')throw Error('MODEL_IMAGE_DESCRIPTOR_INVALID')
 const fit=imageDrawRect(source,{width:frame.width,height:frame.height-(model.header?.height||0)},model.framing)
 if(!fit)throw Error('MODEL_IMAGE_FRAMING_INVALID')
 const demand=view?imageDemand(source.width,source.height,[fit.scaleX,0,0,fit.scaleY,0,0],view.scale*dpr):{...source,divisor:1}
 return {...demand,sourceWidth:source.width,sourceHeight:source.height}
}
