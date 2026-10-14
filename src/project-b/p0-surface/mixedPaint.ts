import type {CanvasRect,CanvasSceneSnapshot} from '../../canvas-engine/contracts'
import type {DecodedImageUpload,PaintOperation,PreparedPaintDisplayList} from '../../canvas-engine/paintDisplayList'
import {imageIdentity} from '../../canvas-engine/decodedImageRegistry'
import {eligibleCompleteVelloPaint} from '../../board/velloEligibility'

export type QualifiedObjectPaint=Readonly<{id:string;ownership:'vector'|'card';bounds:CanvasRect;operations:readonly PaintOperation[];uploads:readonly DecodedImageUpload[]}>
/** Every whole-object contribution is ordered by the existing canonical scene.
 * Unsupported providers retain semantic DOM paint; overlap closure prevents
 * their layer position from changing merely because a neighbor is compiled. */
export function assembleCompletePaintList(scene:CanvasSceneSnapshot,contributions:readonly QualifiedObjectPaint[],cameraScale:number){
 const identities=new Set<string>()
 for(const object of scene.objects){if(!object.id||identities.has(object.id)||!Number.isFinite(object.order))throw new Error('DISPLAY_LIST_INVALID: canonical identity/order');identities.add(object.id)}
 const byId=new Map<string,QualifiedObjectPaint>(),known=new Set(scene.objects.filter(object=>!object.hidden).map(object=>object.id))
 for(const contribution of contributions){if(!known.has(contribution.id)||byId.has(contribution.id))throw new Error('DISPLAY_LIST_INVALID: contribution identity');byId.set(contribution.id,contribution)}
 const ids=eligibleCompleteVelloPaint(scene,new Map(contributions.map(c=>[c.id,c.bounds])),cameraScale)
 const ordered=scene.objects.map((object,index)=>({object,index})).filter(({object})=>ids.has(object.id)).sort((a,b)=>a.object.order-b.object.order||a.index-b.index)
 const operations=ordered.flatMap(({object})=>byId.get(object.id)!.operations),uploads=new Map<string,DecodedImageUpload>()
 for(const {object} of ordered)for(const upload of byId.get(object.id)!.uploads){const key=imageIdentity(upload.reference),old=uploads.get(key);if(old&&old!==upload)throw new Error('RESOURCE_REVISION_CONFLICT: inconsistent shared upload');uploads.set(key,upload)}
 const resources=new Map(operations.flatMap(operation=>operation.type==='image'?[[imageIdentity(operation.resource),operation.resource] as const]:[]))
 const displayList:PreparedPaintDisplayList={schema:'art-equation.display-list',schemaVersion:2,sceneId:scene.id,revision:String(scene.revision),environment:{background:'#00000000',colorSpace:'srgb'},operations,resources:[...resources.values()]}
 return {ids,cardIds:new Set(ordered.filter(({object})=>byId.get(object.id)!.ownership==='card').map(({object})=>object.id)),displayList,images:[...resources.keys()].map(key=>{const upload=uploads.get(key);if(!upload)throw new Error('RESOURCE_NOT_READY: complete image contribution missing upload');return upload})}
}
