import type { ProjectModel } from '../model/project'
type ViewState={schemaVersion:1;projectId:string;baseUpdatedAt:string;updatedAt:string;viewports:Record<string,{x:number;y:number;scale:number}>}
const sameExcept=(a:object,b:object,ignored:ReadonlySet<string>)=>{
 const keys=new Set([...Object.keys(a),...Object.keys(b)])
 return [...keys].every(key=>ignored.has(key)||Object.is((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]))
}
export function onlyViewsChanged(previous:ProjectModel,next:ProjectModel) {
 return sameExcept(previous,next,new Set(['boards','updatedAt']))&&previous.boards.length===next.boards.length
  &&previous.boards.every((board,index)=>sameExcept(board,next.boards[index],new Set(['viewport'])))
}
export function restoreProjectViews(project:ProjectModel,value:unknown):ProjectModel {
 const state=value as ViewState|null
 if(!state||state.schemaVersion!==1||state.projectId!==project.id||state.baseUpdatedAt!==project.updatedAt||!state.viewports||typeof state.viewports!=='object')return project
 return {...project,boards:project.boards.map(board=>{
  const view=state.viewports[board.id]
  return view&&[view.x,view.y,view.scale].every(Number.isFinite)&&view.scale>0
   ?{...board,viewport:{x:view.x,y:view.y,scale:view.scale}}:board
 })}
}
/** Writes are serialized per project. A failed write never advances the baseline.
 * Stale sidecars cannot override a newer full save, including after a crash. */
export class ProjectAutosave {
 private saved=new Map<string,{project:ProjectModel;baseUpdatedAt:string}>()
 private pending=new Map<string,Promise<void>>()
 remember(project:ProjectModel,baseUpdatedAt=project.updatedAt){this.saved.set(project.id,{project,baseUpdatedAt})}
 hasPendingContent(project:ProjectModel){const saved=this.saved.get(project.id)?.project;return !saved||!onlyViewsChanged(saved,project)}
 enqueue(project:ProjectModel,writeFull:(project:ProjectModel)=>Promise<void>,writeViews:(state:ViewState)=>Promise<void>,forceFull=false){
  const prior=this.pending.get(project.id)??Promise.resolve()
  const task=prior.catch(()=>{}).then(async()=>{
   const saved=this.saved.get(project.id)
   if(!forceFull&&saved&&onlyViewsChanged(saved.project,project)){
    await writeViews({schemaVersion:1,projectId:project.id,baseUpdatedAt:saved.baseUpdatedAt,updatedAt:project.updatedAt,viewports:Object.fromEntries(project.boards.map(board=>[board.id,{...board.viewport}]))})
    this.remember(project,saved.baseUpdatedAt)
   }else{await writeFull(project);this.remember(project)}
  })
  this.pending.set(project.id,task)
  void task.finally(()=>{if(this.pending.get(project.id)===task)this.pending.delete(project.id)}).catch(()=>{})
  return task
 }
}
