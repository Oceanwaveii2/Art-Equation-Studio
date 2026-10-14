import type { BoardNode, VectorGradient } from '../model/project'
import { paintId, paintAlpha } from './vectorPaint'
function Gradient({gradient:g,id}:{gradient:VectorGradient;id:string}) {
  const common={id,gradientUnits:'userSpaceOnUse' as const,gradientTransform:`matrix(${g.transform.join(' ')})`,spreadMethod:g.spread}
  const stops=g.stops.map((s,i)=><stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={paintAlpha(s.opacity)}/>)
  return g.kind==='linear'?<linearGradient {...common} x1={g.start.x} y1={g.start.y} x2={g.end.x} y2={g.end.y}>{stops}</linearGradient>:<radialGradient {...common} cx={g.start.x} cy={g.start.y} fx={g.end.x} fy={g.end.y} r={g.radius} fr={g.focalRadius??0}>{stops}</radialGradient>
}
export function VectorPaintDefs({node,prefix}:{node:BoardNode;prefix:string}) { return <defs>{node.vectorFillGradient&&<Gradient gradient={node.vectorFillGradient} id={paintId(prefix,'fill')}/>} {node.vectorStrokeGradient&&<Gradient gradient={node.vectorStrokeGradient} id={paintId(prefix,'stroke')}/>}</defs> }
