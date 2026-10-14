import paper from 'paper'
import type { BoardModel, BoardNode, VectorPath, VectorGradient, VectorTexture } from '../model/project'
import { validGradient, validTexture } from './vectorPaint'

export type SvgTree = { tag: string; attrs: Record<string, string>; children: SvgTree[] }
export type SvgDrawingImport = { nodes: BoardNode[]; width: number; height: number; sourceShapes: number; clippedShapes: number; warnings: string[]; layers: string[] }
const identity = [1, 0, 0, 1, 0, 0]
function multiply(a: number[], b: number[]) { return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]] }
export function svgTransform(text = '') {
  let matrix = identity.slice()
  for (const match of text.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const n = match[2].trim().split(/[\s,]+/).map(Number), angle = n[0]*Math.PI/180
    let next: number[]
    if (match[1] === 'matrix') { if (n.length !== 6) throw new Error('Invalid SVG matrix'); next = n }
    else if (match[1] === 'translate') next = [1,0,0,1,n[0],n[1] || 0]
    else if (match[1] === 'scale') next = [n[0],0,0,n[1] ?? n[0],0,0]
    else if (match[1] === 'rotate') { next = [Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0]; if (n.length === 3) next = multiply(multiply([1,0,0,1,n[1],n[2]],next),[1,0,0,1,-n[1],-n[2]]) }
    else next = match[1] === 'skewX' ? [1,0,Math.tan(angle),1,0,0] : [1,Math.tan(angle),0,1,0,0]
    if (!next.every(Number.isFinite)) throw new Error('Nonfinite SVG transform')
    matrix = multiply(matrix,next)
  }
  const remaining = text.replace(/(matrix|translate|scale|rotate|skewX|skewY)\s*\([^)]*\)/g,'').replace(/[\s,]/g,'')
  if (remaining) throw new Error('Unsupported SVG transform')
  return matrix
}

/** Converts source geometry into the existing editable board path model.
 * No SVG strings, executable markup, image substitute or new renderer is used. */
export function importSvgTree(root: SvgTree, title: string, prefix: string): SvgDrawingImport {
  const view = (root.attrs.viewBox || '').trim().split(/[\s,]+/).map(Number)
  if (root.tag !== 'svg' || view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0) throw new Error('SVG needs a finite, positive viewBox')
  const scale = Math.min(1,1200/view[2]), width = view[2]*scale, height = view[3]*scale
  const result: SvgDrawingImport = { nodes: [], width, height, sourceShapes: 0, clippedShapes: 0, warnings: [], layers: [] }
  const scope = new paper.PaperScope(); new scope.Project(undefined!)
  const definitions = new Map<string,SvgTree>()
  const index = (element: SvgTree) => { if (element.attrs.id) definitions.set(element.attrs.id,element); element.children.forEach(index) }; index(root)
  const warn = (message: string) => { if (!result.warnings.includes(message)) result.warnings.push(message) }
  const id = () => `${prefix}-${result.nodes.length}`
  const rootId = id()
  result.nodes.push({ id: rootId, zIndex:0, kind: 'group', containerRole: 'group', drawingLayer:true, x: 0, y: 0, width, height, title, color: 'transparent', opacity: 1 })
  const number = (a: Record<string,string>, key: string, fallback=0) => a[key] === undefined ? fallback : Number.parseFloat(a[key])
  const length = (value: string | undefined, fallback=0) => value===undefined ? fallback : Number.parseFloat(value)
  const styles = (element: SvgTree) => { const local={...element.attrs};for(const pair of (local.style||'').split(';')){const i=pair.indexOf(':');if(i>=0)local[pair.slice(0,i).trim()]=pair.slice(i+1).trim()}return local }
  const href = (a: Record<string,string>) => a.href || a['xlink:href'] || a['{http://www.w3.org/1999/xlink}href']
  function gradient(value: string, matrix: number[], original: paper.Rectangle, bounds: paper.Rectangle): VectorGradient | undefined {
    const key=/^url\(#([^)]*)\)$/.exec(value),def=key && definitions.get(key[1])
    if(!def || !['linearGradient','radialGradient'].includes(def.tag)){warn('Unresolved or unsupported paint reference');return}
    if(href(def.attrs)){warn('Inherited gradient references require additional import support');return}
    const a=def.attrs,box=a.gradientUnits!=='userSpaceOnUse'
    const coordinate=(key:string,fallback:number)=>a[key]?.endsWith('%')?length(a[key])/100*(box?1:/^[xycf]/.test(key)&&key.endsWith('y')?view[3]:view[2]):length(a[key],fallback)
    const space=box?multiply(matrix,[original.width,0,0,original.height,original.x,original.y]):matrix
    const m=multiply([1,0,0,1,-bounds.x,-bounds.y],multiply(space,svgTransform(a.gradientTransform))) as VectorGradient['transform']
    const radial=def.tag==='radialGradient',start={x:coordinate(radial?'cx':'x1',radial?.5:0),y:coordinate(radial?'cy':'y1',radial?.5:0)}
    const result:VectorGradient={version:1,kind:radial?'radial':'linear',transform:m,start,end:{x:coordinate(radial?'fx':'x2',radial?start.x:1),y:coordinate(radial?'fy':'y2',radial?start.y:0)},...(radial?{radius:coordinate('r',.5),focalRadius:coordinate('fr',0)}:{}),spread:(a.spreadMethod||'pad') as VectorGradient['spread'],stops:def.children.filter(c=>c.tag==='stop').map(c=>{const s=styles(c);return {offset:s.offset?.endsWith('%')?length(s.offset)/100:length(s.offset),color:s['stop-color']||'black',opacity:number(s,'stop-opacity',1)}})}
    if(!validGradient(result)){warn('Invalid gradient values');return}return result
  }
  function geometry(element: SvgTree): paper.PathItem | null {
    const a = element.attrs
    if (element.tag === 'path') return new scope.CompoundPath({ pathData: a.d || '', insert: false })
    if (element.tag === 'rect') return new scope.Path.Rectangle({ rectangle: new scope.Rectangle(number(a,'x'),number(a,'y'),number(a,'width'),number(a,'height')), radius: new scope.Size(number(a,'rx',number(a,'ry')),number(a,'ry',number(a,'rx'))), insert:false })
    if (element.tag === 'circle' || element.tag === 'ellipse') return new scope.Path.Ellipse({ rectangle: new scope.Rectangle(number(a,'cx')-number(a,'rx',number(a,'r')),number(a,'cy')-number(a,'ry',number(a,'r')),2*number(a,'rx',number(a,'r')),2*number(a,'ry',number(a,'r'))),insert:false })
    if (element.tag === 'line') return new scope.Path({ segments:[[number(a,'x1'),number(a,'y1')],[number(a,'x2'),number(a,'y2')]],insert:false })
    if (element.tag === 'polygon' || element.tag === 'polyline') { const values=(a.points || '').trim().split(/[\s,]+/).map(Number); return new scope.Path({segments:Array.from({length:values.length/2},(_,i)=>[values[i*2],values[i*2+1]]),closed:element.tag==='polygon',insert:false}) }
    return null
  }
  function transform(item: paper.PathItem, matrix: number[]) { item.transform(new scope.Matrix(matrix[0],matrix[1],matrix[2],matrix[3],matrix[4],matrix[5])) }
  function clip(element: SvgTree, matrix: number[]): paper.PathItem | null {
    if (element.attrs.clipPathUnits === 'objectBoundingBox') { warn('Object-bounding-box clipping needs a qualified importer'); return null }
    let output: paper.PathItem | null = null
    for (const child of element.children) { const path=geometry(child); if (!path) { warn('Complex clip geometry is unsupported'); continue }; transform(path,multiply(matrix,svgTransform(child.attrs.transform))); const joined: paper.PathItem=output ? output.unite(path,{insert:false}) : path; if(output) {output.remove();path.remove()}; output=joined }
    return output
  }
  const toPath = (path: paper.Path, x: number, y: number): VectorPath => ({version:1,closed:path.closed,points:path.segments.map(s=>({x:s.point.x-x,y:s.point.y-y,...(!s.handleIn.isZero()?{handleIn:{x:s.handleIn.x,y:s.handleIn.y}}:{}),...(!s.handleOut.isZero()?{handleOut:{x:s.handleOut.x,y:s.handleOut.y}}:{})}))})
  const artboardClip = new scope.Path.Rectangle({rectangle:new scope.Rectangle(0,0,width,height),insert:false})
  function walk(element: SvgTree, parentMatrix: number[], inherited: Record<string,string>, owner: string, clips: paper.PathItem[], depth: number) {
    if (depth > 128) throw new Error('SVG nesting limit exceeded')
    if (['defs','clipPath','linearGradient','radialGradient','title','desc','metadata'].includes(element.tag)) return
    if (['script','foreignObject','style','filter','mask','text'].includes(element.tag)) { warn(`${element.tag} requires additional editable import support`); return }
    if(element.tag==='use') {
      const ref=href(element.attrs),def=ref?.startsWith('#')?definitions.get(ref.slice(1)):undefined
      if(!def){warn('Unresolved local instance');return}
      const translated=multiply(parentMatrix,multiply(svgTransform(element.attrs.transform),[1,0,0,1,length(element.attrs.x),length(element.attrs.y)]))
      const attributes={...element.attrs,...def.attrs};delete attributes.transform;delete attributes.x;delete attributes.y
      walk({...def,attrs:attributes},translated,inherited,owner,clips,depth+1);return
    }
    const local = { ...element.attrs }; for(const pair of (element.attrs.style || '').split(';')) { const colon=pair.indexOf(':'); if(colon>=0) local[pair.slice(0,colon).trim()]=pair.slice(colon+1).trim() }
    const style = {...inherited,...local}; const matrix=multiply(parentMatrix,svgTransform(element.attrs.transform))
    if(style.display==='none') return
    if(local.filter || local.mask || local['mix-blend-mode'] && local['mix-blend-mode']!=='normal') warn('Effects or blend modes require compositing support')
    if((element.tag==='g'||element.tag==='svg') && local.opacity && Number(local.opacity)!==1) warn('Group opacity requires isolated compositing')
    let currentClips=clips
    if(local['clip-path']) { const key=/^url\(#([^)]*)\)$/.exec(local['clip-path']); const def=key && definitions.get(key[1]); if(!def) warn('Unresolved clip reference'); else {const item=clip(def,matrix); if(item) currentClips=[...clips,item]} }
    let currentOwner=owner
    if(element.tag==='g' && element.attrs.id) { currentOwner=id(); result.layers.push(element.attrs.id); result.nodes.push({id:currentOwner,zIndex:result.nodes.length,kind:'group',containerRole:'group',drawingLayer:true,groupId:owner,x:0,y:0,width,height,title:element.attrs.id.replaceAll('---',' & '),color:'transparent',opacity:1}) }
    let texture:VectorTexture|undefined
    if(element.tag==='image') {
      texture={version:1,href:href(element.attrs)||'',width:length(element.attrs.width),height:length(element.attrs.height),transform:multiply(matrix,[1,0,0,1,length(element.attrs.x),length(element.attrs.y)]) as VectorTexture['transform']}
      if(!validTexture(texture)){warn('Only finite embedded PNG/JPEG textures are supported');return}
    }
    const source=texture?geometry({tag:'rect',attrs:{x:String(length(element.attrs.x)),y:String(length(element.attrs.y)),width:String(texture.width),height:String(texture.height)},children:[]}):geometry(element)
    if(source) {
      result.sourceShapes++
      const fill=texture?'white':style.fill || 'black',stroke=texture?'none':style.stroke || 'none'
      const original=source.bounds.clone()
      const originalPaths=(source instanceof scope.CompoundPath?source.children as paper.Path[]:[source as paper.Path]).map(p=>toPath(p,0,0))
      transform(source,matrix); source.fillRule=style['fill-rule']==='evenodd'?'evenodd':'nonzero'
      let item: paper.PathItem=source
      const contours = () => item instanceof scope.CompoundPath ? item.children as paper.Path[] : [item as paper.Path]
      // SVG fills implicitly close open contours. Retain open strokes as open.
      if(fill!=='none') for(const p of contours()) p.closed=true
      if(fill!=='none') for(const boundary of [...currentClips,artboardClip]) { const b=item.bounds,c=boundary.bounds; if(c.contains(b)) continue; const next=item.intersect(boundary,{insert:false}); if(item!==source)item.remove(); item=next; result.clippedShapes++ }
      const paths=contours().filter(p=>p.segments.length>=2)
      const bounds=item.bounds
      if(paths.length && bounds.width>=0 && bounds.height>=0) {
        const converted=paths.map(p=>toPath(p,bounds.x,bounds.y))
        const determinant=matrix[0]*matrix[3]-matrix[1]*matrix[2],strokeScale=Math.sqrt(Math.abs(determinant))
        const node: BoardNode={id:id(),zIndex:result.nodes.length,kind:'shape',shapeType:'path',groupId:currentOwner,x:bounds.x,y:bounds.y,width:Math.max(.001,bounds.width),height:Math.max(.001,bounds.height),title:`${result.layers.at(-1)||title} path ${result.sourceShapes}`,color:fill,strokeColor:stroke,strokeWidth:number(style,'stroke-width',1)*strokeScale,opacity:number(style,'opacity',1),vectorPath:converted[0],vectorFillRule:style['fill-rule']==='evenodd'?'evenodd':'nonzero',vectorStrokeCap:(style['stroke-linecap']||'butt') as BoardNode['vectorStrokeCap'],vectorStrokeJoin:(style['stroke-linejoin']||'miter') as BoardNode['vectorStrokeJoin']}
        node.fillOpacity=number(style,'fill-opacity',1);node.strokeOpacity=number(style,'stroke-opacity',1)
        if(stroke!=='none'){
          node.vectorStrokeGeometry={paths:originalPaths,transform:multiply([1,0,0,1,-bounds.x,-bounds.y],matrix) as VectorGradient['transform']}
          node.strokeWidth=number(style,'stroke-width',1)
          node.vectorClipPaths=[...currentClips,artboardClip].map(boundary=>(boundary instanceof scope.CompoundPath?boundary.children as paper.Path[]:[boundary as paper.Path]).map(p=>toPath(p,bounds.x,bounds.y)))
        }
        if(fill.startsWith('url(')){node.vectorFillGradient=gradient(fill,matrix,original,bounds);node.color='transparent'}
        if(stroke.startsWith('url(')){node.vectorStrokeGradient=gradient(stroke,identity,original,new scope.Rectangle(0,0,0,0));node.strokeColor='transparent'}
        if(texture)node.vectorTexture={...texture,transform:multiply([1,0,0,1,-bounds.x,-bounds.y],texture.transform) as VectorTexture['transform']}
        if(converted.length>1) node.vectorBoolean={operation:'union',operands:converted,resolvedPaths:converted}
        result.nodes.push(node)
      }
      if(item!==source)item.remove(); source.remove()
    } else if(!['svg','g'].includes(element.tag)) warn(`Unsupported SVG element ${element.tag}`)
    for(const child of element.children) walk(child,matrix,style,currentOwner,currentClips,depth+1)
    for(const item of currentClips.filter(p=>!clips.includes(p)))item.remove()
  }
  try { walk(root,[scale,0,0,scale,-view[0]*scale,-view[1]*scale],{},rootId,[],0) } finally { artboardClip.remove();scope.project.remove() }
  // Tight layer bounds computed bottom-up; membership does not reflow artwork.
  for(const group of [...result.nodes].reverse().filter(n=>n.kind==='group'&&n.id!==rootId)) { const children=result.nodes.filter(n=>n.groupId===group.id); if(children.length) { group.x=Math.min(...children.map(n=>n.x));group.y=Math.min(...children.map(n=>n.y));group.width=Math.max(...children.map(n=>n.x+n.width))-group.x;group.height=Math.max(...children.map(n=>n.y+n.height))-group.y } }
  return result
}
export function inspectSvgDrawing(source: string,title: string,prefix=crypto.randomUUID()): SvgDrawingImport {
  if(source.length>40_000_000 || /<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('SVG document size or declaration is unsupported')
  const document=new DOMParser().parseFromString(source.replace(/<!DOCTYPE[^>]*>/i,''),'image/svg+xml')
  if(document.querySelector('parsererror'))throw new Error('Invalid SVG XML')
  const tree=(element: Element):SvgTree=>({tag:element.localName,attrs:Object.fromEntries([...element.attributes].map(a=>[a.name,a.value])),children:[...element.children].map(tree)})
  return importSvgTree(tree(document.documentElement),title,prefix)
}
export function appendSvgDrawing(board: BoardModel,drawing: SvgDrawingImport): BoardModel {
  if(drawing.warnings.length)throw new Error('Resolve unsupported features before importing editable artwork')
  const x=board.nodes.length ? Math.max(...board.nodes.map(n=>n.x+n.width))+80 : 0
  return {...board,nodes:[...board.nodes,...drawing.nodes.map(n=>({...n,x:n.x+x}))],gridVisible:false,snapToGrid:false}
}
