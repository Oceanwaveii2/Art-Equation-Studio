import type { BoardNode } from '../model/project'
import { vectorPathData } from '../model/vector'
import { paintAlpha } from './vectorPaint'
export function VectorStrokePaint({node,id,stroke}:{node:BoardNode;id:string;stroke:string}) {
 const geometry=node.vectorStrokeGeometry;if(!geometry)return null
 const clips=node.vectorClipPaths||[]
 let content=<path d={geometry.paths.map(vectorPathData).join(' ')} transform={`matrix(${geometry.transform.join(' ')})`} fill="none" stroke={stroke} strokeOpacity={paintAlpha(node.strokeOpacity)} strokeWidth={node.strokeWidth??2} strokeLinejoin={node.vectorStrokeJoin||'miter'} strokeLinecap={node.vectorStrokeCap||'butt'} pointerEvents="none"/>
 for(let i=clips.length-1;i>=0;i--)content=<g clipPath={`url(#${id}-stroke-${i})`}>{content}</g>
 return <><defs>{clips.map((paths,i)=><clipPath id={`${id}-stroke-${i}`} key={i}><path d={paths.map(vectorPathData).join(' ')}/></clipPath>)}</defs>{content}</>
}
