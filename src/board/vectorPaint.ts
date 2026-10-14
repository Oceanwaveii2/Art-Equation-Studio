import type { BoardNode, VectorGradient, VectorTexture } from '../model/project'

export const paintAlpha = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 1
const escape = (value: string | number) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
export const paintId = (id: string, channel: string) => `paint-${channel}-${[...id].map(c=>c.codePointAt(0)!.toString(16)).join('-')}`
export function validGradient(g: VectorGradient): boolean {
  return g.version===1 && ['linear','radial'].includes(g.kind) && g.transform.length===6 && g.transform.every(Number.isFinite) && Math.abs(g.transform[0]*g.transform[3]-g.transform[1]*g.transform[2])>1e-12 && [g.start.x,g.start.y,g.end.x,g.end.y].every(Number.isFinite) && ['pad','reflect','repeat'].includes(g.spread) && (g.kind!=='radial' || Number.isFinite(g.radius) && g.radius!>0 && (g.focalRadius===undefined || Number.isFinite(g.focalRadius) && g.focalRadius>=0 && g.focalRadius<=g.radius!)) && g.stops.length>=2 && g.stops.length<=256 && g.stops.every((s,i)=>Number.isFinite(s.offset)&&s.offset>=0&&s.offset<=1&&(!i||s.offset>=g.stops[i-1].offset)&&Number.isFinite(s.opacity)&&s.opacity>=0&&s.opacity<=1&&/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(s.color))
}
export function validTexture(t: VectorTexture): boolean { return t.version===1 && /^data:image\/(png|jpeg);base64,[a-z\d+/=\s]+$/i.test(t.href) && t.href.length<=40_000_000 && t.width>0 && t.height>0 && [t.width,t.height,...t.transform].every(Number.isFinite) && t.transform.length===6 }
export function gradientMarkup(g: VectorGradient, id: string): string {
  if(!validGradient(g)) return ''
  const tag=g.kind==='linear'?'linearGradient':'radialGradient'
  const coordinates=g.kind==='linear'?`x1="${g.start.x}" y1="${g.start.y}" x2="${g.end.x}" y2="${g.end.y}"`:`cx="${g.start.x}" cy="${g.start.y}" fx="${g.end.x}" fy="${g.end.y}" r="${g.radius}" fr="${g.focalRadius??0}"`
  return `<${tag} id="${escape(id)}" gradientUnits="userSpaceOnUse" gradientTransform="matrix(${g.transform.join(' ')})" spreadMethod="${g.spread}" ${coordinates}>${g.stops.map(s=>`<stop offset="${s.offset}" stop-color="${escape(s.color)}" stop-opacity="${paintAlpha(s.opacity)}"/>`).join('')}</${tag}>`
}
export function vectorPaintDefinitions(node: BoardNode, prefix: string): string {
  return (node.vectorFillGradient?gradientMarkup(node.vectorFillGradient,paintId(prefix,'fill')):'')+(node.vectorStrokeGradient?gradientMarkup(node.vectorStrokeGradient,paintId(prefix,'stroke')):'')
}
export function transformVectorPaint(node: BoardNode, m: VectorGradient['transform']): Partial<BoardNode> {
  const matrix=(n: VectorGradient['transform'])=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]] as VectorGradient['transform']
  const point=(p:{x:number;y:number},translate=true)=>({x:m[0]*p.x+m[2]*p.y+(translate?m[4]:0),y:m[1]*p.x+m[3]*p.y+(translate?m[5]:0)})
  return {
    ...(node.vectorFillGradient?{vectorFillGradient:{...node.vectorFillGradient,transform:matrix(node.vectorFillGradient.transform)}}:{}),
    // Stroke gradients live inside the original stroke geometry's coordinate system.
    ...(node.vectorStrokeGradient&&!node.vectorStrokeGeometry?{vectorStrokeGradient:{...node.vectorStrokeGradient,transform:matrix(node.vectorStrokeGradient.transform)}}:{}),
    ...(node.vectorTexture?{vectorTexture:{...node.vectorTexture,transform:matrix(node.vectorTexture.transform)}}:{}),
    ...(node.vectorStrokeGeometry?{vectorStrokeGeometry:{...node.vectorStrokeGeometry,transform:matrix(node.vectorStrokeGeometry.transform)}}:{}),
    ...(node.vectorClipPaths?{vectorClipPaths:node.vectorClipPaths.map(paths=>paths.map(p=>({...p,points:p.points.map(v=>({...v,...point(v),...(v.handleIn?{handleIn:point(v.handleIn,false)}:{}),...(v.handleOut?{handleOut:point(v.handleOut,false)}:{})}))})))}:{})
  }
}
export function resizeVectorPaint(node: BoardNode, sx: number, sy: number): Partial<BoardNode> {
  return transformVectorPaint(node,[sx,0,0,sy,0,0])
}
