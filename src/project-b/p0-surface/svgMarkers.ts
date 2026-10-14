import type {CanvasVectorCommand} from '../../canvas-engine/contracts'
import type {PaintMatrix} from '../../canvas-engine/paintDisplayList'

type Point=readonly[number,number]
type Segment={start:Point;end:Point;out:Point;incoming:Point}
export type MarkerVertex={kind:'start'|'mid'|'end';point:Point;angle:number}
const difference=(a:Point,b:Point):Point=>[a[0]-b[0],a[1]-b[1]]
const nonzero=(p:Point)=>Math.hypot(...p)>1e-12
const direction=(vectors:Point[])=>vectors.find(nonzero)??[0,0] as Point
const angle=(p:Point)=>Math.atan2(p[1],p[0])

/** Marker placement follows path vertices, not dash endpoints. Cubic tangent
 * fallback uses the next distinct control/end point at degenerate endpoints.
 * Closed and multiple subpaths each retain their own start/end markers. */
export function markerVertices(commands:readonly CanvasVectorCommand[]):MarkerVertex[]{
 const result:MarkerVertex[]=[],segments:Segment[]=[];let point:Point=[0,0],start:Point=point
 const flush=()=>{
  if(!segments.length)return
  const forward=(index:number):Point=>{
   for(let i=index;i<segments.length;i++)if(nonzero(segments[i].out))return segments[i].out
   return [0,0]
  }
  const backward=(index:number):Point=>{
   for(let i=index;i>=0;i--)if(nonzero(segments[i].incoming))return segments[i].incoming
   return [0,0]
  }
  result.push({kind:'start',point:segments[0].start,angle:angle(forward(0))})
  for(let i=1;i<segments.length;i++){
   const incoming=backward(i-1),outgoing=forward(i),a=angle(nonzero(incoming)?incoming:outgoing),b=angle(nonzero(outgoing)?outgoing:incoming)
   let delta=b-a
   if(delta>Math.PI)delta-=2*Math.PI
   if(delta< -Math.PI)delta+=2*Math.PI
   result.push({kind:'mid',point:segments[i].start,angle:a+delta/2})
  }
  result.push({kind:'end',point:segments.at(-1)!.end,angle:angle(backward(segments.length-1))});segments.length=0
 }
 for(const command of commands){
  if(command[0]==='M'){flush();point=[command[1],command[2]];start=point;continue}
  let end:Point,out:Point,incoming:Point
  if(command[0]==='C'){
   const first:Point=[command[1],command[2]],second:Point=[command[3],command[4]];end=[command[5],command[6]]
   out=direction([difference(first,point),difference(second,point),difference(end,point)])
   incoming=direction([difference(end,second),difference(end,first),difference(end,point)])
  }else if(command[0]==='L'||command[0]==='Z'){
   end=command[0]==='Z'?start:[command[1],command[2]];out=incoming=difference(end,point)
  }else throw new Error('SVG_MARKER_UNSUPPORTED: command')
  segments.push({start:point,end,out,incoming});point=end
 }
 flush();return result
}

/** Matrix for an already-qualified marker in host coordinates. Reference
 * coordinates must already include the marker viewBox mapping. */
export function markerPlacement(vertex:MarkerVertex,scale:number,reference:Point,reverseStart=false):PaintMatrix{
 if(!Number.isFinite(scale)||scale<=0||![...vertex.point,...reference,vertex.angle].every(Number.isFinite))throw new Error('SVG_MARKER_INVALID: placement')
 const theta=vertex.angle+(reverseStart&&vertex.kind==='start'?Math.PI:0),a=Math.cos(theta)*scale,b=Math.sin(theta)*scale,c=-b,d=a
 return [a,b,c,d,vertex.point[0]-a*reference[0]-c*reference[1],vertex.point[1]-b*reference[0]-d*reference[1]]
}
