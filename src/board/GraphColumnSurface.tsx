import type { BoardNode } from '../model/project'
import { graphColumnRows } from './graphColumnV2'
/** Accessible canonical SVG fallback. The accepted native frame replaces this
 * paint; the native path reads model descriptors, never this DOM. */
export function GraphColumnSurface({node,sources,result}:{node:BoardNode;sources:readonly BoardNode[];result:string}) {
  const rows=graphColumnRows(node,sources)
  return <svg className="graph-v2-summary" width="100%" height="100%" viewBox={`0 0 ${node.width} ${node.height}`} aria-label={`${node.title}: ${rows.join(', ')}. ${result}`}>
    <defs><clipPath id={'graph-text-'+node.id}><rect width={node.width} height={node.height}/></clipPath></defs>
    <rect width={node.width} height={node.height} fill={node.columnBodyColor||node.color||'#34546c'} stroke="#67d5cd" strokeWidth="1"/>
    <rect width={node.width} height={Math.min(58,node.height)} fill={node.color||'#34546c'}/>
    <g clipPath={`url(#graph-text-${node.id})`} fill={node.textColor||'#fff'} fontFamily="Segoe UI" fontSize="12">
      <text x="12" y="24" fontSize="14" fontWeight="700">{node.title}</text>
      {rows.map((row,i)=>34+i*20<=node.height-54?<text key={i} x="12" y={46+i*20}>{row}</text>:null)}
      <text x="12" y={node.height-18} fontWeight="700" aria-label="Graph computed result">{result.replace(/[\r\n]+/g,' ')}</text>
    </g>
  </svg>
}
