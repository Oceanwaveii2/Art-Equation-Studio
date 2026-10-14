import type {CanvasSceneObject, CanvasSceneSnapshot} from './contracts'

/** Browser hit/editor overlays are not paint authority for these providers. */
export function ownsModelPaint(object:CanvasSceneObject) {
  return Boolean(object.modelArtwork || object.structuredCard)
}

/** Retain a pending frame only while every visible member has an engine
 * provider. Mixed browser overlays and editors still present in the accepted
 * frame require their
 * explicit handoff. This is last-frame presentation, never acceptance of a
 * newer revision, and must not advance input/quality completion telemetry. */
export function canRetainModelFrame(previous:CanvasSceneSnapshot, current:CanvasSceneSnapshot, accepted:ReadonlySet<string>, editing:boolean) {
  if(editing || previous.id!==current.id || !accepted.size)return false
  const native=(object:CanvasSceneObject)=>ownsModelPaint(object) || object.kind==='vector' && !object.hasDiagramCaption && !object.hasShapeCaption && object.preparedVectorGeometry?.status==='ready'
  const visible=current.objects.filter(object=>!object.hidden)
  if(visible.some(object=>!native(object)))return false
  const ids=new Set(visible.map(object=>object.id))
  return [...accepted].every(id=>ids.has(id))
}
