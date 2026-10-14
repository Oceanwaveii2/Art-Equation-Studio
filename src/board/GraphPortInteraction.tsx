import { useMemo, useRef, useState } from 'react'
import type { BoardModel, BoardPoint, BoardNode } from '../model/project'
import { bindGraphColumnInputs, editGraphColumn } from './graphColumnV2'
import { diagramProjectionStates } from './diagramStructureCore'

const anchor=(node:BoardNode,x:number,y:number):BoardPoint=>{const a=(node.rotation||0)*Math.PI/180,dx=x-node.width/2,dy=y-node.height/2;return{x:node.x+node.width/2+dx*Math.cos(a)-dy*Math.sin(a),y:node.y+node.height/2+dx*Math.sin(a)+dy*Math.cos(a)}}
/** UI-only hit regions. Graph data retains object/port IDs; the renderer owns
 * the graph's visible pins. Magnetic hit distance is constant in screen pixels. */
export function GraphPortInteraction({board,readOnly,onChange,onError,onEdit}:{board:BoardModel;readOnly:boolean;onChange(board:BoardModel):void;onError(message:string):void;onEdit(id:string):void}) {
  const svg=useRef<SVGSVGElement>(null), [drag,setDrag]=useState<{source:string;from:BoardPoint;at:BoardPoint}|null>(null)
  const states=useMemo(()=>diagramProjectionStates(board.nodes),[board.nodes])
  const visible=useMemo(()=>states.ok?board.nodes.filter(n=>!states.value.get(n.id)?.hidden):[],[board.nodes,states])
  const targets=visible.flatMap(n=>n.graphColumn?[{id:n.id,point:anchor(n,0,n.height/2),input:undefined as string|undefined},...n.graphColumn.inputs.map((p,i)=>({id:n.id,point:anchor(n,0,n.height*(i+1)/(n.graphColumn!.inputs.length+1)),input:p.id}))]:[])
  const point=(event:React.PointerEvent)=>{const matrix=svg.current?.getScreenCTM();if(!matrix)return null;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return{x:p.x,y:p.y}}
  const nearest=(p:BoardPoint,source:string)=>targets.filter(t=>t.id!==source).sort((a,b)=>Math.hypot(a.point.x-p.x,a.point.y-p.y)-Math.hypot(b.point.x-p.x,b.point.y-p.y) || Number(Boolean(b.input))-Number(Boolean(a.input))).find(t=>Math.hypot(t.point.x-p.x,t.point.y-p.y)<=14/board.viewport.scale)
  const hot=drag?nearest(drag.at,drag.source):undefined
  return <svg ref={svg} className="graph-v2-port-overlay graph-port-interaction" aria-label="Graph connection ports" onPointerMove={e=>{if(!drag)return;e.stopPropagation();const p=point(e);if(p)setDrag({...drag,at:p})}} onPointerCancel={()=>setDrag(null)} onPointerUp={e=>{if(!drag)return;e.stopPropagation();const p=point(e),target=p&&nearest(p,drag.source);setDrag(null);if(!target)return;try{const graph=board.nodes.find(n=>n.id===target.id)!;onChange(target.input?editGraphColumn(board,target.id,{inputs:graph.graphColumn!.inputs.map(i=>i.id===target.input?{...i,sourceId:drag.source}:i)}):bindGraphColumnInputs(board,target.id,[...graph.graphColumn!.inputs.map(i=>i.sourceId),drag.source]))}catch(error){onError(String(error))}}}>
    {visible.map(n=>{const p=anchor(n,n.width,n.height/2),s=states.ok?states.value.get(n.id):undefined;return <circle key={n.id} cx={p.x} cy={p.y} r={8/board.viewport.scale} className="graph-port-hit" role="button" tabIndex={readOnly?-1:0} aria-label={`Connect from ${n.title||n.kind}`} onKeyDown={e=>{if(e.key==='Enter'&&n.graphColumn){e.stopPropagation();onEdit(n.id)}}} onPointerDown={e=>{e.stopPropagation();e.preventDefault();if(readOnly||!s||s.locked)return;e.currentTarget.setPointerCapture(e.pointerId);setDrag({source:n.id,from:p,at:p})}}/>})}
    {targets.map(t=><circle key={t.id+':'+(t.input||'new')} cx={t.point.x} cy={t.point.y} r={8/board.viewport.scale} className={'graph-port-target'+(hot===t?' magnetic':'')} onPointerDown={e=>{e.stopPropagation();e.preventDefault();onEdit(t.id)}}><title>{t.input?'Reconnect input':'Connect to graph'}</title></circle>)}
    {drag&&<path className="graph-port-draft" d={`M${drag.from.x} ${drag.from.y} L${hot?.point.x??drag.at.x} ${hot?.point.y??drag.at.y}`} fill="none" stroke="#67d5cd" strokeWidth={1.5/board.viewport.scale}/>}
  </svg>
}
