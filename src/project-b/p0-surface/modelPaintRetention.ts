import type { CanvasSceneObject } from '../../canvas-engine/contracts'
import type { CompleteCardPaintResult } from '../../canvas-engine/completePaint'

// Scene objects are immutable. Camera requests reuse their identities and must
// not serialize every rich-text/media descriptor again on each pointer sample.
const paintKeys=new WeakMap<CanvasSceneObject,Map<string,string>>()

/** Position/order/selection are not glyph or decoded-image inputs. Saved
 * geometry dimensions, all paint styles and source descriptors remain inputs.
 * Rotations deliberately require recompilation until affine parity is tested. */
export function modelPaintKey(sceneId: string, object: CanvasSceneObject): string {
  let keys=paintKeys.get(object)
  const existing=keys?.get(sceneId);if(existing!==undefined)return existing
  const key=JSON.stringify([sceneId,object.id,object.localBounds?.width,object.localBounds?.height,
    object.appearance,object.structuredCard,object.modelArtwork,object.modelPorts])
  if(!keys){keys=new Map();paintKeys.set(object,keys)}
  if(keys.size>=8)keys.delete(keys.keys().next().value!)
  keys.set(sceneId,key);return key
}

export function moveModelPaint(card: CompleteCardPaintResult, previous: CanvasSceneObject, next: CanvasSceneObject): CompleteCardPaintResult {
  if(previous===next)return card
  const dx=next.localBounds!.x-previous.localBounds!.x,dy=next.localBounds!.y-previous.localBounds!.y
  if(!dx&&!dy)return {...card,objectRevision:next.revision,order:next.order}
  const operations=card.operations.map(operation=>{
    if(operation.type==='pop')return operation
    if(operation.type==='vector'){
      const matrix=operation.object.transform as readonly number[]|undefined
      if(!matrix||matrix.length!==6)throw Error('MODEL_RETAINED_TRANSFORM_MISSING')
      return {...operation,object:{...operation.object,transform:[...matrix.slice(0,4),matrix[4]+dx,matrix[5]+dy]}}
    }
    return {...operation,transform:[...operation.transform.slice(0,4),operation.transform[4]+dx,operation.transform[5]+dy] as [number,number,number,number,number,number]}
  })
  return {...card,objectRevision:next.revision,order:next.order,operations,visualBounds:card.visualBounds?{...card.visualBounds,x:card.visualBounds.x+dx,y:card.visualBounds.y+dy}:null}
}


