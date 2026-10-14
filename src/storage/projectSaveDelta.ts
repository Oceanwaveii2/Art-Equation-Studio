import type { ProjectModel } from '../model/project'
export type SaveRecord={kind:'project'|'board'|'node'|'connector'|'document'|'asset';scope:string;id:string;value:unknown}
export type SaveDelta={projectId:string;baseRevision:number;puts:SaveRecord[];deletes:Omit<SaveRecord,'value'>[];reason:string}
const sameExcept=(a:object,b:object,ignored:string[])=>{const keys=new Set([...Object.keys(a),...Object.keys(b)]);return [...keys].every(k=>ignored.includes(k)||Object.is((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]))}
const ids=(rows:{id:string}[])=>rows.map(r=>r.id)
const sameOrder=(a:{id:string}[],b:{id:string}[])=>a.length===b.length&&a.every((r,i)=>r.id===b[i].id)
const omit=(value:object,keys:string[])=>Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)))
export function projectSaveDelta(previous:ProjectModel|undefined,next:ProjectModel,baseRevision:number,reason='edit'):SaveDelta{
 const puts:SaveRecord[]=[],deletes:SaveDelta['deletes']=[]
 const add=(kind:SaveRecord['kind'],scope:string,id:string,value:unknown)=>puts.push({kind,scope,id,value})
 const rows=(kind:SaveRecord['kind'],scope:string,before:{id:string}[],after:{id:string}[])=>{
  const old=new Map(before.map(r=>[r.id,r])),found=new Set<string>()
  for(const row of after){if(found.has(row.id))throw Error('Duplicate '+kind+' ID');found.add(row.id);if(!Object.is(old.get(row.id),row))add(kind,scope,row.id,row)}
  for(const row of before)if(!found.has(row.id))deletes.push({kind,scope,id:row.id})
 }
 if(!previous||!sameExcept(previous,next,['boards','documents','assets'])||!sameOrder(previous.boards,next.boards)||!sameOrder(previous.documents,next.documents)||!sameOrder(previous.assets,next.assets))
  add('project','',next.id,{data:omit(next,['boards','documents','assets']),boards:ids(next.boards),documents:ids(next.documents),assets:ids(next.assets)})
 const oldBoards=new Map(previous?.boards.map(b=>[b.id,b])||[]),found=new Set<string>()
 for(const board of next.boards){
  if(found.has(board.id))throw Error('Duplicate board ID');found.add(board.id)
  const before=oldBoards.get(board.id)
  if(!before||!sameExcept(before,board,['nodes','connectors'])||!sameOrder(before.nodes,board.nodes)||!sameOrder(before.connectors,board.connectors))
   add('board','',board.id,{data:omit(board,['nodes','connectors']),nodes:ids(board.nodes),connectors:ids(board.connectors)})
  if(before?.nodes!==board.nodes)rows('node',board.id,before?.nodes||[],board.nodes)
  if(before?.connectors!==board.connectors)rows('connector',board.id,before?.connectors||[],board.connectors)
 }
 for(const board of previous?.boards||[])if(!found.has(board.id)){deletes.push({kind:'board',scope:'',id:board.id});for(const kind of ['node','connector'] as const)for(const r of kind==='node'?board.nodes:board.connectors)deletes.push({kind,scope:board.id,id:r.id})}
 if(previous?.documents!==next.documents)rows('document','',previous?.documents||[],next.documents)
 if(previous?.assets!==next.assets)rows('asset','',previous?.assets||[],next.assets)
 return {projectId:next.id,baseRevision,puts,deletes,reason}
}

