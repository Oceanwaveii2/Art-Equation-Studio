import type {CanvasSceneObject,CanvasSceneSnapshot} from './contracts'
type Index={objects:Map<string,{object:CanvasSceneObject;index:number}>;edges:Map<string,CanvasSceneSnapshot['connections'][number][]>}
const objectIndexes=new WeakMap<CanvasSceneSnapshot['objects'],Index['objects']>(),edgeIndexes=new WeakMap<CanvasSceneSnapshot['connections'],Index['edges']>()
/** Membership is supplied by the spatial index. Camera work visits only those
 * IDs and incident graph edges; immutable source arrays are indexed once. */
export function subsetPaintScene(scene:CanvasSceneSnapshot,ids?:ReadonlySet<string>):CanvasSceneSnapshot {
 if(!ids)return scene
 let byId=objectIndexes.get(scene.objects)
 if(!byId){byId=new Map(scene.objects.map((object,index)=>[object.id,{object,index}]));objectIndexes.set(scene.objects,byId)}
 let edges=edgeIndexes.get(scene.connections)
 if(!edges){edges=new Map();for(const edge of scene.connections)if(edge.relationshipStyle==='graph-v2'&&edge.sourceId&&edge.targetId){const list=edges.get(edge.sourceId)||[];list.push(edge);edges.set(edge.sourceId,list)}edgeIndexes.set(scene.connections,edges)}
 const found=new Map<string,{object:CanvasSceneObject;index:number}>()
 for(const id of ids){const entry=byId.get(id);if(entry)found.set(id,entry);for(const edge of edges.get(id)||[])if(ids.has(edge.targetId!)){const record=byId.get(edge.id);if(record)found.set(edge.id,record)}}
 return {...scene,objects:[...found.values()].sort((a,b)=>a.index-b.index).map(e=>e.object)}
}
