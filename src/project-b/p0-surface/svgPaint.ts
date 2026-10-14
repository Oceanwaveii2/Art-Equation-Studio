import type {CanvasRect,CanvasVectorCommand} from '../../canvas-engine/contracts'
import type {PaintMatrix,PaintOperation} from '../../canvas-engine/paintDisplayList'
import {normalizeMeasuredColor,roundedRectCommands} from '../../board/measuredCardPaint'
import {prepareVelloVectorGeometry} from '../../board/velloVectorGeometry'
import type {CompleteCardPaintProviders,QualifiedCardContribution} from '../../board/completeMeasuredCardPaint'
import {markerVertices,markerPlacement} from './svgMarkers'
import {parseSvgDropShadows,qualifiedSvgFlow,type SvgEffectRequest,type SvgEffectResult} from './svgEffects'
import type {DecodedImageUpload} from '../../canvas-engine/paintDisplayList'

type SvgOptions=Parameters<NonNullable<CompleteCardPaintProviders['svg']>>[1]
type TextProvider=(element:SVGTextElement,transform:PaintMatrix,id:string)=>Promise<{completePaint:boolean;operations:readonly PaintOperation[];blockers:readonly string[]}>
const finite=(...numbers:number[])=>numbers.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6)
function fail(reason:string):never{throw new Error(`SVG_PAINT_UNSUPPORTED: ${reason}`)}
const multiply=(a:PaintMatrix,b:PaintMatrix):PaintMatrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
const matrix=(value:DOMMatrix):PaintMatrix=>[value.a,value.b,value.c,value.d,value.e,value.f]
const rect=(r:CanvasRect):CanvasVectorCommand[]=>[['M',r.x,r.y],['L',r.x+r.width,r.y],['L',r.x+r.width,r.y+r.height],['L',r.x,r.y+r.height],['Z']]
const mapCommands=(commands:readonly CanvasVectorCommand[],m:PaintMatrix):CanvasVectorCommand[]=>commands.map(command=>command[0]==='Z'?command: [command[0],...command.slice(1).map((value,i,values)=>i%2?m[1]*Number(values[i-1])+m[3]*Number(value)+m[5]:m[0]*Number(value)+m[2]*Number(values[i+1])+m[4])] as unknown as CanvasVectorCommand)
function envelope(box:CanvasRect,m:PaintMatrix,padding=0):CanvasRect{
 const points=[[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]],xs=points.map(([x,y])=>m[0]*x+m[2]*y+m[4]),ys=points.map(([x,y])=>m[1]*x+m[3]*y+m[5])
 return {x:Math.min(...xs)-padding,y:Math.min(...ys)-padding,width:Math.max(...xs)-Math.min(...xs)+2*padding,height:Math.max(...ys)-Math.min(...ys)+2*padding}
}
const union=(a:CanvasRect,b:CanvasRect):CanvasRect=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x),height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)})

/** Strict SVG subset used by canonical board paths. Unknown commands never
 * disappear silently. Quadratics/smooth commands become exact cubics. */
export function svgPathCommands(source:string):CanvasVectorCommand[]{
 if(source.length>1_000_000)fail('path source limit')
 const tokens=source.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)??[]
 if(source.replace(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[\s,]/g,''))fail('path tokens')
 const result:CanvasVectorCommand[]=[];let i=0,command='',x=0,y=0,sx=0,sy=0,cx=0,cy=0,previous=''
 while(i<tokens.length){
  if(/^[a-zA-Z]$/.test(tokens[i]))command=tokens[i++]
  const upper=command.toUpperCase(),relative=command!==upper
  if(upper==='Z'){result.push(['Z']);x=sx;y=sy;previous='Z';command='';continue}
  const count=({M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2} as Record<string,number>)[upper]
  if(!count||i+count>tokens.length||tokens.slice(i,i+count).some(token=>/^[a-zA-Z]$/.test(token)))fail('path command')
  const n=tokens.slice(i,i+count).map(Number);i+=count;if(!finite(...n))fail('path coordinates')
  const p=(index:number):[number,number]=>[n[index]+(relative?x:0),n[index+1]+(relative?y:0)]
  if(upper==='M'||upper==='L'){[x,y]=p(0);result.push([upper,x,y]);if(upper==='M'){sx=x;sy=y;command=relative?'l':'L'}}
  else if(upper==='H'){x=n[0]+(relative?x:0);result.push(['L',x,y])}
  else if(upper==='V'){y=n[0]+(relative?y:0);result.push(['L',x,y])}
  else if(upper==='C'||upper==='S'){
   const first:readonly[number,number]=upper==='C'?p(0):(previous==='C'||previous==='S'?[2*x-cx,2*y-cy]:[x,y]),second=p(upper==='C'?2:0),end=p(upper==='C'?4:2)
   result.push(['C',...first,...second,...end]);[cx,cy]=second;[x,y]=end
  }else{
   const control:readonly[number,number]=upper==='Q'?p(0):(previous==='Q'||previous==='T'?[2*x-cx,2*y-cy]:[x,y]),end=p(upper==='Q'?2:0)
   result.push(['C',x+2*(control[0]-x)/3,y+2*(control[1]-y)/3,end[0]+2*(control[0]-end[0])/3,end[1]+2*(control[1]-end[1])/3,...end]);[cx,cy]=control;[x,y]=end
  }
  previous=upper;if(result.length>65536||!finite(x,y,cx,cy))fail('path complexity')
 }
 if(result.length&&result[0][0]!=='M')fail('path must start with moveto')
 return result
}

function geometry(element:SVGGraphicsElement,transform:PaintMatrix,cameraScale:number):CanvasVectorCommand[]{
 const number=(name:string,fallback=0)=>{const raw=element.getAttribute(name),value=raw===null?fallback:Number(raw);if(!finite(value))fail('primitive coordinates');return value}
 switch(element.localName){
  case 'path':return svgPathCommands(element.getAttribute('d')??'')
  case 'line':return [['M',number('x1'),number('y1')],['L',number('x2'),number('y2')]]
  case 'rect':{const x=number('x'),y=number('y'),width=number('width'),height=number('height');if(width<0||height<0)fail('negative rect');const rx=number('rx',number('ry')),ry=number('ry',rx);if(rx<0||ry<0)fail('negative corner');return rx&&ry?mapCommands(roundedRectCommands({width,height},Array.from({length:4},()=>[Math.min(rx,width/2),Math.min(ry,height/2)] as const)),[1,0,0,1,x,y]):rect({x,y,width,height})}
  case 'polyline':case 'polygon':{const raw=element.getAttribute('points')??'';if(raw.length>1_000_000)fail('points limit');const points=raw.trim().split(/[\s,]+/).filter(Boolean).map(Number);if(points.length%2||!finite(...points))fail('points');return points.reduce<CanvasVectorCommand[]>((commands,_,index)=>{if(index%2===0)commands.push([index?'L':'M',points[index],points[index+1]]);return commands},[]).concat(element.localName==='polygon'?[['Z']]:[])}
  case 'circle':case 'ellipse':{
   const rx=number(element.localName==='circle'?'r':'rx'),ry=number(element.localName==='circle'?'r':'ry'),cx=number('cx'),cy=number('cy'),sx=Math.hypot(transform[0],transform[1]),sy=Math.hypot(transform[2],transform[3])
   if(rx<=0||ry<=0)return []
   if(Math.abs(transform[0]*transform[2]+transform[1]*transform[3])>1e-6)fail('skewed ellipse certification pending')
   const width=rx*2*sx/.98,height=ry*2*sy/.98,x=transform[0]*cx+transform[2]*cy+transform[4]-width/2,y=transform[1]*cx+transform[3]*cy+transform[5]-height/2
   const derivative=prepareVelloVectorGeometry({id:'svg-ellipse',kind:'shape',shapeType:'ellipse',title:'',x,y,width,height,rotation:Math.atan2(transform[1],transform[0])*180/Math.PI,strokeWidth:0})
   if(derivative.status!=='ready'||!derivative.approximation||cameraScale<derivative.approximation.minCssScale||cameraScale>derivative.approximation.maxCssScale)fail('ellipse numerical envelope')
   const det=transform[0]*transform[3]-transform[1]*transform[2]
   return mapCommands(derivative.commands,[transform[3]/det,-transform[1]/det,-transform[2]/det,transform[0]/det,(transform[2]*transform[5]-transform[3]*transform[4])/det,(transform[1]*transform[4]-transform[0]*transform[5])/det])
  }
  default:return fail(`element ${element.localName}`)
 }
}

/** Whole mounted SVG ownership. The real CTM and computed styles are sampled
 * under canonical paint; unsupported effects/animation refuse the full tree. */
export async function captureSvgPaint(root:SVGSVGElement,options:SvgOptions,text:TextProvider,effect?:(request:SvgEffectRequest)=>Promise<SvgEffectResult>):Promise<QualifiedCardContribution>{
 const snapshots=options.canonicalRead(()=>{
  if(root.getAnimations({subtree:true}).some(animation=>!qualifiedSvgFlow(animation)))fail('animated SVG lifecycle pending')
  const screen=root.getScreenCTM();if(!screen||screen.is2D===false||!finite(screen.a,screen.b,screen.c,screen.d,screen.e,screen.f))fail('root CTM')
  const inverse=screen.inverse(),snapshots:{element:SVGGraphicsElement;id:string;transform:PaintMatrix;style:CSSStyleDeclaration;opacity:number;box:CanvasRect;children:number[];commands?:CanvasVectorCommand[];markers:PaintOperation[]}[]=[]
  const visit=(element:SVGGraphicsElement,depth:number):number=>{
   if(depth>32||snapshots.length>=512)fail('tree limit')
   const computed=root.ownerDocument.defaultView!.getComputedStyle(element)
   // Copy primitives before any asynchronous font lookup; CSSStyleDeclaration
   // is live and may otherwise observe ownership-hidden paint later.
   const style={} as CSSStyleDeclaration
   for(const key of ['display','visibility','filter','clipPath','maskImage','mixBlendMode','fill','fillOpacity','fillRule','stroke','strokeOpacity','strokeWidth','strokeLinecap','strokeLinejoin','strokeMiterlimit','strokeDasharray','strokeDashoffset','vectorEffect','markerStart','markerMid','markerEnd','paintOrder'] as const)style[key]=computed[key]
   if(style.display==='none'||style.visibility==='hidden')return -1
   if(style.filter!=='none'){if(!effect)fail('SVG effects pending');parseSvgDropShadows(style.filter)}
   if(style.clipPath!=='none'||style.maskImage!=='none'||style.mixBlendMode!=='normal')fail('SVG effects pending')
   if(style.paintOrder!=='normal'&&style.paintOrder!=='fill stroke markers')fail('custom paint order pending')
   if(element.localName==='text'&&!element.textContent&&element.children.length===0)return -1
   const ctm=element.getScreenCTM();if(!ctm||ctm.is2D===false||!finite(ctm.a,ctm.b,ctm.c,ctm.d,ctm.e,ctm.f))fail('child CTM')
   const transform=multiply(options.userSpaceTransform,matrix(inverse.multiply(ctm))),opacity=element===root?1:Number(computed.opacity),bbox=element.getBBox(),box={x:bbox.x,y:bbox.y,width:bbox.width,height:bbox.height}
   if(!finite(...transform,opacity,...Object.values(box))||opacity<0||opacity>1)fail('geometry/opacity')
   const index=snapshots.length,snapshot={element,id:`${options.id}:svg-${index}`,transform,style,opacity,box,children:[] as number[],commands:undefined as CanvasVectorCommand[]|undefined,markers:[] as PaintOperation[]};snapshots.push(snapshot)
   if(element.localName==='svg'||element.localName==='g')for(const child of element.children){if(['defs','title','desc','metadata'].includes(child.localName))continue;const childIndex=visit(child as SVGGraphicsElement,depth+1);if(childIndex>=0)snapshot.children.push(childIndex)}
   else if(element.localName!=='text')snapshot.commands=geometry(element,transform,options.cameraScale)
   if(snapshot.commands?.length&&[style.markerStart,style.markerMid,style.markerEnd].some(value=>value!=='none')){
    // Only the app's bounded, static triangular arrowhead is qualified here.
    // Other marker trees retain the entire SVG under DOM ownership.
    if(style.markerMid!=='none')fail('mid-marker paint qualification pending')
    const nonScaling=style.vectorEffect==='non-scaling-stroke',hostCommands=snapshot.commands
    for(const vertex of markerVertices(hostCommands)){
     if(vertex.kind==='mid')continue
     const value=vertex.kind==='start'?style.markerStart:style.markerEnd
     if(value==='none')continue
     const match=/^url\(["']?([^"')]+)["']?\)$/.exec(value)
     if(!match)fail('marker reference')
     const target=new URL(match[1],root.ownerDocument.baseURI),documentUrl=new URL(root.ownerDocument.URL)
     if(target.origin!==documentUrl.origin||target.pathname!==documentUrl.pathname||target.search!==documentUrl.search||!target.hash)fail('external marker')
     const marker=root.ownerDocument.getElementById(decodeURIComponent(target.hash.slice(1)))
     if(!marker||marker.localName!=='marker'||!root.contains(marker)||marker.hasAttribute('viewBox')||marker.hasAttribute('transform')||marker.children.length!==1)fail('marker tree qualification pending')
     const child=marker.firstElementChild!,markerStyle=root.ownerDocument.defaultView!.getComputedStyle(marker),childStyle=root.ownerDocument.defaultView!.getComputedStyle(child)
     const units=marker.getAttribute('markerUnits')??'strokeWidth',orient=marker.getAttribute('orient')??'0'
     if(units!=='strokeWidth'||!['auto','auto-start-reverse'].includes(orient)||marker.getAttribute('markerWidth')!=='8'||marker.getAttribute('markerHeight')!=='8'||marker.getAttribute('refX')!=='7'||marker.getAttribute('refY')!=='4'||child.localName!=='path'||child.hasAttribute('transform'))fail('marker metrics qualification pending')
     const commands=svgPathCommands(child.getAttribute('d')??'')
     if(JSON.stringify(commands)!==JSON.stringify([['M',0,0],['L',8,4],['L',0,8],['Z']]))fail('marker geometry qualification pending')
     if(markerStyle.display==='none'||markerStyle.visibility!=='visible'||childStyle.display==='none'||childStyle.visibility!=='visible'||markerStyle.opacity!=='1'||markerStyle.filter!=='none'||childStyle.opacity!=='1'||childStyle.filter!=='none'||childStyle.stroke!=='none'||childStyle.clipPath!=='none'||childStyle.maskImage!=='none'||childStyle.mixBlendMode!=='normal')fail('marker effects qualification pending')
     const normalized=normalizeMeasuredColor(childStyle.fill),alpha=Number(childStyle.fillOpacity),width=Number.parseFloat(style.strokeWidth)
     if(!normalized||!Number.isFinite(alpha)||alpha<0||alpha>1||!finite(width)||width<0)fail('marker color/width')
     if(width===0)continue
     const fill=normalized.slice(0,7)+Math.round(Number.parseInt(normalized.slice(7),16)*alpha).toString(16).padStart(2,'0')
     const markerScale=nonScaling?Math.sqrt((transform[0]**2+transform[1]**2+transform[2]**2+transform[3]**2)/2):1
     // Chromium's StrokeWidthForMarkerUnits uses the RMS lengths of the
     // non-scaling CTM columns; marker orientation stays in path user space.
     const placement=markerPlacement(vertex,width/markerScale,[7,4],orient==='auto-start-reverse')
     snapshot.markers.push({type:'vector',object:{id:snapshot.id+':marker-'+snapshot.markers.length+'-'+vertex.kind,kind:'vector',transform:multiply(transform,placement),payload:{commands,fill,strokeWidth:0}}})
    }
   }
   return index
  }
  visit(root,0);return snapshots
 })
 const operations:PaintOperation[]=[],uploads:DecodedImageUpload[]=[],blockers:string[]=[];let visualBounds=envelope({x:0,y:0,...options.contentSize},options.borderBoxTransform)
 const bounds=new Map<number,CanvasRect>(),sourceBounds=new Map<number,CanvasRect>()
 const scopeBoundsFor=(index:number):CanvasRect=>{
  const cached=bounds.get(index);if(cached)return cached
  const snapshot=snapshots[index],{transform,style,box}=snapshot
  const strokeWidth=Number.parseFloat(style.strokeWidth),scale=Math.max(Math.hypot(transform[0],transform[1]),Math.hypot(transform[2],transform[3])),padding=Number.isFinite(strokeWidth)?strokeWidth*(style.vectorEffect==='non-scaling-stroke'?1:scale)*Math.max(2,Number(style.strokeMiterlimit)||4):0
  let result=envelope(box,transform,padding)
  for(const marker of snapshot.markers)if(marker.type==='vector')result=union(result,envelope({x:0,y:0,width:8,height:8},marker.object.transform as PaintMatrix))
  for(const child of snapshot.children)result=union(result,scopeBoundsFor(child))
  sourceBounds.set(index,result)
  const effectPadding=parseSvgDropShadows(style.filter).reduce((sum,shadow)=>sum+(Math.max(Math.abs(shadow.x),Math.abs(shadow.y))+3*shadow.sigma)*scale,0)
  if(effectPadding)result={x:result.x-effectPadding,y:result.y-effectPadding,width:result.width+effectPadding*2,height:result.height+effectPadding*2}
  bounds.set(index,result);return result
 }
 const visit=async(index:number):Promise<void>=>{
  const snapshot=snapshots[index],{element,id,transform,style,opacity}=snapshot,scopeBounds=scopeBoundsFor(index)
  const strokeWidth=Number.parseFloat(style.strokeWidth)
  visualBounds=union(visualBounds,scopeBounds)
  if(opacity!==1)operations.push({type:'pushComposite',scopeId:id+':opacity',commands:rect(scopeBounds),transform:[1,0,0,1,0,0],fillRule:'nonzero',isolation:'isolated',opacity,blendMode:'normal'})
  const effectStart=operations.length
  if(element.localName==='text'){const result=await text(element as SVGTextElement,transform,id);if(!result.completePaint)blockers.push(...result.blockers);else operations.push(...result.operations)}
  else if(snapshot.commands?.length){
   const color=(source:string,alpha:string)=>{if(source==='none')return '#00000000';const normalized=normalizeMeasuredColor(source),opacity=Number(alpha);if(!normalized||!Number.isFinite(opacity)||opacity<0||opacity>1)fail('paint color');return normalized.slice(0,7)+Math.round(Number.parseInt(normalized.slice(7),16)*opacity).toString(16).padStart(2,'0')}
   const fill=color(style.fill,style.fillOpacity),stroke=color(style.stroke,style.strokeOpacity),nonScaling=style.vectorEffect==='non-scaling-stroke'
   if(!['none','non-scaling-stroke'].includes(style.vectorEffect)||!Number.isFinite(strokeWidth)||strokeWidth<0)fail('stroke style')
   const uniform=Math.abs(Math.hypot(transform[0],transform[1])-Math.hypot(transform[2],transform[3]))<1e-6&&Math.abs(transform[0]*transform[2]+transform[1]*transform[3])<1e-6
   if(nonScaling&&!fill.endsWith('00')){
    operations.push({type:'vector',object:{id:id+':fill',kind:'vector',transform,payload:{commands:snapshot.commands,fill,strokeWidth:0,vectorFillRule:style.fillRule}}})
   }
   if(!nonScaling||!stroke.endsWith('00')){
    if(!nonScaling&&!uniform&&!stroke.endsWith('00'))fail('affine scaling stroke pending')
    // SVG non-scaling stroke cancels its SVG user-space CTM, while the outer
    // CSS camera still scales the completed viewport. This list is in world
    // coordinates: dividing by camera scale here would cancel that scale twice.
    const dashArray=style.strokeDasharray==='none'?[]:style.strokeDasharray.split(/[\s,]+/).map(Number.parseFloat),dashOffset=Number.parseFloat(style.strokeDashoffset),factor=1
    if(!finite(...dashArray,dashOffset)||dashArray.some(n=>n<=0))fail('dash geometry')
    operations.push({type:'vector',object:{id:id+':base',kind:'vector',transform:nonScaling?[1,0,0,1,0,0]:transform,payload:{commands:nonScaling?mapCommands(snapshot.commands,transform):snapshot.commands,fill:nonScaling?'#00000000':fill,stroke,strokeWidth:strokeWidth*factor,vectorFillRule:style.fillRule,vectorStrokeCap:style.strokeLinecap,vectorStrokeJoin:style.strokeLinejoin,miterLimit:Number(style.strokeMiterlimit),dashArray:dashArray.map(n=>n*factor),dashOffset:dashOffset*factor}}})
   }
   operations.push(...snapshot.markers)
  }
  for(const child of snapshot.children)await visit(child)
  if(style.filter!=='none'){
   const result=await effect!({id,filter:style.filter,operations:operations.slice(effectStart),transform,bounds:sourceBounds.get(index)!,cameraScale:options.cameraScale})
   operations.splice(effectStart,operations.length-effectStart,...result.operations);uploads.push(...result.uploads);visualBounds=union(visualBounds,result.visualBounds)
  }
  if(opacity!==1)operations.push({type:'pop',scopeId:id+':opacity'})
 }
 if(snapshots.length)await visit(0)
 return {completePaint:!blockers.length,sourceFingerprint:options.sourceFingerprint,operations:blockers.length?[]:operations,uploads:blockers.length?[]:uploads,visualBounds,blockers}
}
