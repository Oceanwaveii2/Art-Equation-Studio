import type { CanvasSceneSnapshot, CanvasViewport, CanvasRect, CanvasVectorCommand } from '../canvas-engine/contracts'
import type { PaintMatrix, PaintOperation } from '../canvas-engine/paintDisplayList'

type Size = Readonly<{ width: number; height: number }>
type Radii = readonly (readonly [number, number])[]
const LIMIT = 1_000_000
const finite = (...values: number[]) => values.every(v => Number.isFinite(v) && Math.abs(v) <= LIMIT)
const px = (value: string): number | null => /^-?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(value) ? Number.parseFloat(value) : value === '0' ? 0 : null

/** CSSOM serializes matrices with fewer digits than the live camera. Bound the
 * resulting error in CSS pixels across the visible viewport, instead of using
 * an absolute coefficient epsilon which rejects valid fractional pan/zoom. */
export function measuredCameraMatrixCurrent(matrix: Readonly<{a:number;b:number;c:number;d:number;e:number;f:number;is2D:boolean}>, camera: CanvasViewport, viewport: Size): boolean {
  if (!matrix.is2D || !finite(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f,camera.x,camera.y,camera.scale,viewport.width,viewport.height) || camera.scale <= 0 || viewport.width <= 0 || viewport.height <= 0) return false
  for (const [screenX,screenY] of [[0,0],[viewport.width,0],[0,viewport.height],[viewport.width,viewport.height]]) {
    const x=(screenX-camera.x)/camera.scale,y=(screenY-camera.y)/camera.scale
    if (Math.abs(matrix.a*x+matrix.c*y+matrix.e-screenX)>.01 || Math.abs(matrix.b*x+matrix.d*y+matrix.f-screenY)>.01) return false
  }
  return true
}

/** Computed colour, not model colour. Unknown colour spaces remain refused. */
export function normalizeMeasuredColor(css: string): string | null {
  if (css === 'transparent') return '#00000000'
  const match = /^(rgba?|color)\((.*)\)$/.exec(css.trim())
  if (!match) return null
  let value = match[2].trim(), normalized = false
  if (match[1] === 'color') {
    if (!value.startsWith('srgb ')) return null
    value = value.slice(5); normalized = true
  }
  const tokens = value.replace(/,/g, ' ').replace(/\//g, ' ').trim().split(/\s+/)
  if (tokens.length !== 3 && tokens.length !== 4) return null
  const numbers = tokens.map((token, index) => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(token)) return NaN
    const n = Number.parseFloat(token)
    return token.endsWith('%') ? n / 100 : index === 3 || normalized ? n : n / 255
  })
  if (!numbers.every(Number.isFinite)) return null
  if (numbers.length === 3) numbers.push(1)
  return '#' + numbers.map(n => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')).join('')
}

export function borderBoxSize(style: Pick<CSSStyleDeclaration, 'width' | 'height' | 'boxSizing' | 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom' | 'borderLeftWidth' | 'borderRightWidth' | 'borderTopWidth' | 'borderBottomWidth'>): Size | null {
  const w = px(style.width), h = px(style.height)
  if (w === null || h === null || w < 0 || h < 0) return null
  let width = w, height = h
  if (style.boxSizing === 'content-box') {
    const extra = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth,
      style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth].map(px)
    if (extra.some(n => n === null || n < 0)) return null
    width += extra.slice(0, 4).reduce<number>((sum, n) => sum + n!, 0)
    height += extra.slice(4).reduce<number>((sum, n) => sum + n!, 0)
  } else if (style.boxSizing !== 'border-box') return null
  return finite(width, height) && width > 0 && height > 0 ? { width, height } : null
}

/** Recover translation from the transformed AABB AND the known untransformed
 * size/linear map. Inverting the AABB alone loses rotation/skew/flip geometry. */
export function reconstructWorldMatrix(rect: CanvasRect, size: Size, linear: readonly [number, number, number, number], camera: CanvasViewport, stageOrigin: { x: number; y: number }): PaintMatrix | null {
  const [a, b, c, d] = linear
  if (!finite(...linear, rect.x, rect.y, rect.width, rect.height, size.width, size.height, camera.x, camera.y, camera.scale, stageOrigin.x, stageOrigin.y)
    || camera.scale <= 0 || size.width <= 0 || size.height <= 0 || rect.width <= 0 || rect.height <= 0 || Math.abs(a*d-b*c) < 1e-12) return null
  const xs = [0, a*size.width, c*size.height, a*size.width+c*size.height]
  const ys = [0, b*size.width, d*size.height, b*size.width+d*size.height]
  const expectedWidth = (Math.max(...xs)-Math.min(...xs))*camera.scale
  const expectedHeight = (Math.max(...ys)-Math.min(...ys))*camera.scale
  // Subpixel layout rounding, not permission to accept unrelated/stale boxes.
  if (Math.abs(expectedWidth-rect.width) > .1 || Math.abs(expectedHeight-rect.height) > .1) return null
  const e = (rect.x-stageOrigin.x-camera.x)/camera.scale-Math.min(...xs)
  const f = (rect.y-stageOrigin.y-camera.y)/camera.scale-Math.min(...ys)
  return finite(e, f) ? [a,b,c,d,e,f] : null
}

export function normalizeCornerRadii(css: readonly [string,string,string,string], size: Size): Radii | null {
  if (!finite(size.width,size.height) || size.width <= 0 || size.height <= 0) return null
  const result: [number,number][] = []
  for (const corner of css) {
    const values = corner.trim().split(/\s+/)
    if (values.length < 1 || values.length > 2) return null
    const pair = [values[0], values[1] ?? values[0]].map((v,i) => v.endsWith('%') && /^\d+(?:\.\d+)?%$/.test(v)
      ? Number.parseFloat(v)/100*(i===0 ? size.width : size.height) : px(v))
    if (pair.some(v => v === null || v < 0 || !finite(v))) return null
    result.push(pair as [number,number])
  }
  const [tl,tr,br,bl]=result
  const factor = Math.min(1, ...[[size.width,tl[0]+tr[0]],[size.width,bl[0]+br[0]],
    [size.height,tl[1]+bl[1]],[size.height,tr[1]+br[1]]].map(([edge,total])=>total ? edge/total : 1))
  return result.map(([x,y])=>[x*factor,y*factor] as const)
}

/** Standard cubic derivative for measured CSS elliptical corners. This is not
 * the independently certified ordinary ellipse drawing contour. */
export function roundedRectCommands(size: Size, radii: Radii): readonly CanvasVectorCommand[] {
  if (radii.length!==4 || !finite(size.width,size.height,...radii.flat()) || size.width<=0 || size.height<=0 || radii.some(p=>p[0]<0||p[1]<0)) throw new Error('CARD_LAYOUT_INVALID: rounded rectangle')
  const [tl,tr,br,bl]=radii, k=.5522847498307936, w=size.width,h=size.height
  return [['M',tl[0],0],['L',w-tr[0],0],['C',w-tr[0]*(1-k),0,w,tr[1]*(1-k),w,tr[1]],
    ['L',w,h-br[1]],['C',w,h-br[1]*(1-k),w-br[0]*(1-k),h,w-br[0],h],
    ['L',bl[0],h],['C',bl[0]*(1-k),h,0,h-bl[1]*(1-k),0,h-bl[1]],
    ['L',0,tl[1]],['C',0,tl[1]*(1-k),tl[0]*(1-k),0,tl[0],0],['Z']]
}

export type MeasuredCardPart = Readonly<{
  role: 'article'|'header'|'body'|'badge'|'surface'
  size: Size; worldMatrix: PaintMatrix; layoutBounds: CanvasRect; radii: Radii
  background: string | null; backgroundImage: string; opacity: number
  borderWidths: readonly number[]; borderColors: readonly (string|null)[]; borderStyles: readonly string[]
  overflowX: string; overflowY: string; isolation: string; blendMode: string
  boxShadow: string; filter: string; backdropFilter: string
  blockers: readonly string[]
}>
export type MeasuredCardPaint = Readonly<{
  objectId: string; objectRevision: number; order: number; mountEpoch: number
  status: 'measured-partial'|'invalid'; completePaint: false
  layoutBounds: CanvasRect | null; parts: readonly MeasuredCardPart[]; blockers: readonly string[]
}>
export type MeasuredCardPaintSnapshot = Readonly<{
  schema: 'art-equation.measured-card-paint'; sceneId: string; sceneRevision: number
  layoutRevision: number; camera: CanvasViewport; objects: readonly MeasuredCardPaint[]
  unmeasuredObjects: number
}>
const mountEpochs = new WeakMap<HTMLElement, number>()
let mountEpoch = 0
function union(a: CanvasRect|null,b: CanvasRect): CanvasRect {
  if (!a) return b
  const x=Math.min(a.x,b.x), y=Math.min(a.y,b.y)
  return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y}
}
export function measuredLinearWorld(element: Element, world: HTMLElement): readonly [number,number,number,number] | null {
  let result = new DOMMatrixReadOnly()
  const parents: Element[]=[]
  for (let current: Element|null=element;current && current!==world;current=current.parentElement) {
    if (parents.length>=32) return null
    parents.push(current)
  }
  for (const current of parents.reverse()) {
    const style=getComputedStyle(current)
    if (style.perspective !== 'none') return null
    const matrix=new DOMMatrixReadOnly(style.transform==='none' ? undefined : style.transform)
    if (!matrix.is2D) return null
    result=result.multiply(matrix)
  }
  return [result.a,result.b,result.c,result.d]
}
function partRole(element: HTMLElement, article: HTMLElement): MeasuredCardPart['role'] {
  if (element===article) return 'article'
  if (element.matches('.node-drag-handle')) return 'header'
  if (element.matches('.column-header-copy>small')) return 'badge'
  if (element.matches('.node-copy,.board-rich-text,.node-document,.transformed-image,.board-link-card')) return 'body'
  return 'surface'
}

/** Actual mounted layout only. No inferred card skin, saved layout registry,
 * text contents, resource pixels or permission to claim complete object paint. */
export function captureMeasuredCardPaint(stage: HTMLElement, scene: CanvasSceneSnapshot, camera: CanvasViewport, layoutRevision=0): MeasuredCardPaintSnapshot {
  const world=stage.querySelector<HTMLElement>(':scope > .board-world')
  const origin=stage.getBoundingClientRect(), stageOrigin={x:origin.left+stage.clientLeft,y:origin.top+stage.clientTop}
  const articles=world ? [...world.querySelectorAll<HTMLElement>(':scope > .board-object-layer > article.board-node[data-node-id]')] : []
  const byId=new Map<string,HTMLElement>(), duplicates=new Set<string>()
  for (const article of articles) { const id=article.dataset.nodeId!;if(byId.has(id))duplicates.add(id);byId.set(id,article) }
  const snapshot: MeasuredCardPaint[]=[]
  let totalParts=0
  const worldStyle=world && getComputedStyle(world)
  const worldMatrix=worldStyle && new DOMMatrixReadOnly(worldStyle.transform==='none' ? undefined : worldStyle.transform)
  const cameraCurrent=Boolean(worldMatrix && worldStyle?.transformOrigin==='0px 0px'
    && measuredCameraMatrixCurrent(worldMatrix,camera,{width:stage.clientWidth,height:stage.clientHeight}))
  for (const object of scene.objects.filter(o=>o.kind!=='vector' && !o.hidden)) {
    if (snapshot.length>=512) break
    const article=byId.get(object.id), blockers:string[]=[], parts:MeasuredCardPart[]=[]
    let envelope:CanvasRect|null=null
    const invalid=(reason:string)=>snapshot.push({objectId:object.id,objectRevision:object.revision,order:object.order,
      mountEpoch:article ? mountEpochs.get(article) ?? 0 : 0,status:'invalid',completePaint:false,layoutBounds:null,parts:[],blockers:[reason]})
    if (!world || !cameraCurrent || !finite(camera.x,camera.y,camera.scale) || camera.scale<=0) { invalid('CAMERA_LAYOUT_NOT_CURRENT');continue }
    if (!article || duplicates.has(object.id)) { invalid(article?'DUPLICATE_MOUNT_ID':'LAYOUT_NOT_MOUNTED');continue }
    if (article.dataset.velloPaint) { invalid('LAYOUT_PAINT_ALREADY_SUPPRESSED');continue }
    if (!mountEpochs.has(article)) mountEpochs.set(article,++mountEpoch)
    const elements=[article,...article.querySelectorAll<HTMLElement>('*')]
    if (elements.length>128 || totalParts+elements.length>4096 || snapshot.length>=512) { invalid('LAYOUT_MEASUREMENT_LIMIT');continue }
    totalParts+=elements.length
    if (article.textContent?.trim()) blockers.push('TEXT_SHAPING_PENDING')
    if (article.querySelector('img,video,canvas,iframe,svg,object,embed')) blockers.push('RESOURCE_OR_PROVIDER_PAINT_PENDING')
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue
      const style=getComputedStyle(element)
      if (style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse') continue
      if (style.display==='contents') { blockers.push('DISPLAY_CONTENTS_PENDING');continue }
      const rect=element.getBoundingClientRect()
      if (!rect.width || !rect.height) continue
      const bounds={x:(rect.left-stageOrigin.x-camera.x)/camera.scale,y:(rect.top-stageOrigin.y-camera.y)/camera.scale,width:rect.width/camera.scale,height:rect.height/camera.scale}
      if (!finite(bounds.x,bounds.y,bounds.width,bounds.height,bounds.x+bounds.width,bounds.y+bounds.height)) { blockers.push('NONFINITE_OR_UNBOUNDED_LAYOUT');continue }
      envelope=union(envelope,bounds)
      const size=borderBoxSize(style), linear=measuredLinearWorld(element,world)
      const matrix=size && linear && reconstructWorldMatrix({x:rect.left,y:rect.top,width:rect.width,height:rect.height},size,linear,camera,stageOrigin)
      if (!size || !matrix) { blockers.push('FRAGMENTED_OR_UNSUPPORTED_BOX');continue }
      const radii=normalizeCornerRadii([style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomRightRadius,style.borderBottomLeftRadius],size)
      if (!radii) { blockers.push('UNRESOLVED_CORNER_RADII');continue }
      const partBlockers:string[]=[]
      const background=normalizeMeasuredColor(style.backgroundColor)
      const borderColors=[style.borderTopColor,style.borderRightColor,style.borderBottomColor,style.borderLeftColor].map(normalizeMeasuredColor)
      const borderWidths=[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth].map(v=>px(v) ?? NaN)
      const borderStyles=[style.borderTopStyle,style.borderRightStyle,style.borderBottomStyle,style.borderLeftStyle]
      if (!background || borderColors.some(c=>!c)) partBlockers.push('UNRESOLVED_CSS_COLOR')
      if (!borderWidths.every(v=>finite(v)&&v>=0)) partBlockers.push('UNRESOLVED_BORDER_WIDTH')
      if (borderStyles.some(s=>s!=='solid'&&s!=='none')) partBlockers.push('BORDER_STYLE_PENDING')
      if (style.backgroundImage!=='none') partBlockers.push('BACKGROUND_IMAGE_OR_GRADIENT_PENDING')
      if (style.boxShadow!=='none' || style.textShadow!=='none') partBlockers.push('SHADOW_PAINT_PENDING')
      if (style.filter!=='none' || style.backdropFilter!=='none') partBlockers.push('FILTER_PAINT_PENDING')
      if (style.mixBlendMode!=='normal') partBlockers.push('CSS_BLEND_PENDING')
      if (style.clipPath!=='none' || style.maskImage!=='none' || style.borderImageSource!=='none') partBlockers.push('MASK_OR_BORDER_IMAGE_PENDING')
      if (style.animationName!=='none' || style.transitionDuration.split(',').some(t=>Number.parseFloat(t)>0)) partBlockers.push('DYNAMIC_STYLE_PENDING')
      for (const pseudo of ['::before','::after']) {
        const p=getComputedStyle(element,pseudo)
        if (p.content!=='none' && p.content!=='normal' && p.display!=='none') partBlockers.push('PSEUDO_ELEMENT_PAINT_PENDING')
      }
      const opacity=Number(style.opacity)
      if (!Number.isFinite(opacity)||opacity<0||opacity>1) partBlockers.push('INVALID_OPACITY')
      parts.push({role:partRole(element,article),size,worldMatrix:matrix,layoutBounds:bounds,radii,background,
        backgroundImage:style.backgroundImage,opacity,borderWidths,borderColors,borderStyles,overflowX:style.overflowX,
        overflowY:style.overflowY,isolation:style.isolation,blendMode:style.mixBlendMode,boxShadow:style.boxShadow,
        filter:style.filter,backdropFilter:style.backdropFilter,blockers:partBlockers})
      blockers.push(...partBlockers)
    }
    // Root geometry must match the CURRENT live scene, not a prior DOM commit.
    const root=parts.find(p=>p.role==='article'), local=object.localBounds
    const angle=object.appearance.rotation*Math.PI/180, cos=Math.cos(angle),sin=Math.sin(angle)
    const rootCurrent=root && local && Math.abs(root.size.width-local.width)<=.1 && Math.abs(root.size.height-local.height)<=.1
      && Math.abs(root.worldMatrix[0]-cos)<1e-6 && Math.abs(root.worldMatrix[1]-sin)<1e-6
      && Math.abs(root.worldMatrix[2]+sin)<1e-6 && Math.abs(root.worldMatrix[3]-cos)<1e-6
      && Math.abs(root.worldMatrix[0]*root.size.width/2+root.worldMatrix[2]*root.size.height/2+root.worldMatrix[4]-local.x-local.width/2)<=.1
      && Math.abs(root.worldMatrix[1]*root.size.width/2+root.worldMatrix[3]*root.size.height/2+root.worldMatrix[5]-local.y-local.height/2)<=.1
    if (!rootCurrent) blockers.push('OBJECT_LAYOUT_NOT_CURRENT')
    blockers.push('COMPLETE_CARD_OWNERSHIP_PENDING')
    snapshot.push({objectId:object.id,objectRevision:object.revision,order:object.order,mountEpoch:mountEpochs.get(article)!,
      status:root && !blockers.includes('OBJECT_LAYOUT_NOT_CURRENT')?'measured-partial':'invalid',completePaint:false,
      layoutBounds:envelope,parts,blockers:[...new Set(blockers)]})
  }
  return {schema:'art-equation.measured-card-paint',sceneId:scene.id,sceneRevision:scene.revision,layoutRevision,camera:{...camera},objects:snapshot,
    unmeasuredObjects:scene.objects.reduce((count,o)=>count+(o.kind!=='vector'&&!o.hidden?1:0),0)-snapshot.length}
}

/** A qualified primitive contribution for isolated diagnostics/future compiler.
 * It is NOT a card list and must never authorize production ownership. */
export function compileMeasuredSurface(part: MeasuredCardPart, id: string): { operations: readonly PaintOperation[]; completePaint: false; blockers: readonly string[] } {
  const blockers=[...part.blockers]
  if (!finite(part.size.width,part.size.height) || part.size.width<=0 || part.size.height<=0
    || part.radii.length!==4 || part.radii.some(pair=>pair.length!==2||!finite(...pair)||pair.some(n=>n<0))
    || part.borderWidths.length!==4 || part.borderWidths.some(n=>!finite(n)||n<0)
    || part.borderColors.length!==4 || part.borderStyles.length!==4) blockers.push('SURFACE_GEOMETRY_INVALID')
  if (part.opacity!==1) blockers.push('SURFACE_SUBTREE_OPACITY_PENDING')
  if (part.borderWidths.some(w=>w!==part.borderWidths[0]) || part.borderColors.some(c=>c!==part.borderColors[0])) blockers.push('ASYMMETRIC_BORDER_PAINT_PENDING')
  if (!part.background || !/^#[a-f0-9]{8}$/i.test(part.background) || part.borderColors.some(c=>!c||!/^#[a-f0-9]{8}$/i.test(c))) blockers.push('UNRESOLVED_CSS_COLOR')
  if (part.borderStyles.some(s=>s!==part.borderStyles[0]) || part.borderStyles.some(s=>s!=='solid'&&s!=='none')) blockers.push('BORDER_STYLE_PENDING')
  if (part.backgroundImage!=='none' || part.boxShadow!=='none' || part.filter!=='none' || part.backdropFilter!=='none' || part.blendMode!=='normal') blockers.push('SURFACE_EFFECT_PAINT_PENDING')
  // An inset border can require another CSS corner-overlap reduction even
  // when the measured outer radii fit. Refuse that case until its CSS inner
  // contour is independently qualified; never emit a self-crossing ring.
  if (part.radii.length===4 && part.borderWidths.length===4) {
    const inset=part.borderWidths[0], iw=part.size.width-2*inset, ih=part.size.height-2*inset
    if (iw>0 && ih>0) {
      const [tl,tr,br,bl]=part.radii.map(([x,y])=>[Math.max(0,x-inset),Math.max(0,y-inset)])
      if (tl[0]+tr[0]>iw || bl[0]+br[0]>iw || tl[1]+bl[1]>ih || tr[1]+br[1]>ih) blockers.push('INSET_RADIUS_OVERLAP_PENDING')
    }
  }
  if (!id || !finite(...part.worldMatrix)) blockers.push('SURFACE_ID_OR_MATRIX_INVALID')
  if (blockers.length) return {operations:[],completePaint:false,blockers:[...new Set(blockers)]}
  const operations:PaintOperation[]=[]
  operations.push({type:'vector',object:{id:id+':background',kind:'vector',transform:part.worldMatrix,
    payload:{commands:roundedRectCommands(part.size,part.radii),fill:part.background,strokeWidth:0}}})
  const width=part.borderStyles[0]==='solid'?part.borderWidths[0]:0
  if (width>0) {
    const outer=roundedRectCommands(part.size,part.radii), innerSize={width:part.size.width-2*width,height:part.size.height-2*width}
    const inner=innerSize.width>0&&innerSize.height>0 ? roundedRectCommands(innerSize,part.radii.map(([x,y])=>[Math.max(0,x-width),Math.max(0,y-width)]))
      .map(command=>command.map((n,index)=>index===0?n:typeof n==='number'?n+width:n) as unknown as CanvasVectorCommand) : []
    operations.push({type:'vector',object:{id:id+':border',kind:'vector',transform:part.worldMatrix,
      payload:{commands:[...outer,...inner],fill:part.borderColors[0],vectorFillRule:'evenodd',strokeWidth:0}}})
  }
  return {operations,completePaint:false,blockers:['COMPLETE_CARD_OWNERSHIP_PENDING']}
}
