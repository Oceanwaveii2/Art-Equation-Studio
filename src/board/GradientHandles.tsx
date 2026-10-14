import { useState } from 'react'
import type { BoardNode, VectorGradient } from '../model/project'
export function GradientHandles({node,scale,onChange}:{node:BoardNode;scale:number;onChange:(gradient:VectorGradient)=>void}) {
 const [draft,setDraft]=useState<VectorGradient|null>(null),stored=node.vectorFillGradient,g=draft||stored
 if(!g)return null
 const m=g.transform,point=(p:{x:number;y:number})=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]})
 const a=point(g.start),b=point(g.kind==='linear'?g.end:{x:g.start.x+(g.radius??1),y:g.start.y})
 const drag=(key:'start'|'end',event:React.PointerEvent<SVGCircleElement>)=>{
  event.preventDefault();event.stopPropagation();const target=event.currentTarget,screen=(target.parentElement as unknown as SVGGraphicsElement).getScreenCTM();if(!screen)return;const inverse=screen.inverse(),initial=stored!,matrix=initial.transform,det=matrix[0]*matrix[3]-matrix[1]*matrix[2]
  if(Math.abs(det)<1e-12)return
  target.setPointerCapture(event.pointerId);let next=initial
  const move=(e:PointerEvent)=>{const local=new DOMPoint(e.clientX,e.clientY).matrixTransform(inverse),x=local.x-matrix[4],y=local.y-matrix[5],p={x:(matrix[3]*x-matrix[2]*y)/det,y:(-matrix[1]*x+matrix[0]*y)/det};next=initial.kind==='radial'&&key==='end'?{...initial,radius:Math.max(.001,Math.hypot(p.x-initial.start.x,p.y-initial.start.y))}:{...initial,[key]:p};setDraft(next)}
  const stop=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',cancel);setDraft(null)}
  const up=()=>{stop();onChange(next)},cancel=()=>stop()
  target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',cancel)
 }
 return <g data-gradient-handles="true"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth={2/scale} pointerEvents="none"/>{([['start',a],['end',b]] as const).map(([key,p])=><circle key={key} aria-label={`Gradient ${key} handle`} cx={p.x} cy={p.y} r={6/scale} fill={key==='start'?'#00b9ec':'#ff77ab'} stroke="#ffffff" strokeWidth={1.5/scale} pointerEvents="all" onPointerDown={e=>drag(key,e)}/>)}</g>
}
