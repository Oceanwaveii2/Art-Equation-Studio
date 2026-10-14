import {parseFragment,html,type DefaultTreeAdapterTypes} from 'parse5'
import {validPyramid} from '../canvas-engine/imagePyramid'
import parseInlineStyle from 'inline-style-parser'
import type { BoardNode, ProjectAsset } from '../model/project'
import type { CanvasSceneObject } from '../canvas-engine/contracts'

// Pure saved-source parsing: no browser DOM, editor access or CSSOM layout.
// Unsupported source constructs remain explicit rather than being flattened.
export function projectModelArtwork(node: BoardNode, asset: ProjectAsset | undefined, source?: string, tilesSource?:string): CanvasSceneObject['modelArtwork'] {
  if(node.kind==='image' && asset?.status!=='missing' && asset?.status!=='modified' && validPyramid(asset?.imagePyramid) && tilesSource && source && !node.imageTransform?.overlay && (!node.imageTransform?.blendMode||['source-over','multiply','screen'].includes(node.imageTransform.blendMode)))return {kind:'image',source,sourceRevision:1,pyramid:asset.imagePyramid,tilesSource,framing:node.imageTransform,header:node.imagePresentation==='artwork'?undefined:{title:node.title,fill:'#22252c',color:node.textColor||'#dfe1e6',height:37}}
  if (node.kind === 'image' && (!node.imageTransform?.blendMode || ['source-over','multiply','screen'].includes(node.imageTransform.blendMode)) &&
      !asset?.imagePyramid && !asset?.requiresTiledPreview && asset?.status !== 'missing' &&
      (!asset || asset.imageDimensions && asset.imageDimensions.width <= 4096 && asset.imageDimensions.height <= 4096) &&
      source && /^(png|jpe?g|bmp|ico|webp|tiff?)$/i.test(asset?.extension || (source.startsWith('data:image/png') ? 'png' : ''))) {
    return { kind: 'image', source, sourceRevision: 1, sourceDimensions:asset?.imageDimensions, extension: asset?.extension, framing: node.imageTransform, header: node.imagePresentation==='artwork' ? undefined : {title:node.title,fill:'#22252c',color:node.textColor || '#dfe1e6',height:37} }
  }
  if (!['text','note','column','group','document','board-link','clip'].includes(node.kind) || node.graphColumn) return undefined
  if (node.coverAssetId) return undefined
  if ((node.kind === 'document' && node.assetId) || node.kind === 'board-link' || (node.kind === 'clip' && node.assetId) || (node.kind === 'group' && (node.containerRole === 'frame' || /\bframe\b/i.test(node.title)))) return undefined
  const plain = node.kind !== 'text' && node.kind !== 'clip'
  type SourceNode=DefaultTreeAdapterTypes.ChildNode
  const sourceHtml=plain ? '<p></p>' : node.kind === 'clip' ? node.captured?.articleHtml || node.captured?.transcriptHtml || '<p></p>' : node.body || '<p>New text</p>'
  if(new TextEncoder().encode(sourceHtml).length>2_000_000)return undefined
  const sourceTree=parseFragment(sourceHtml)
  const pending=sourceTree.childNodes.map(node=>({node,depth:0}));let sourceNodes=0
  while(pending.length){const {node,depth}=pending.pop()!;if(++sourceNodes>16384||depth>128)return undefined;if('childNodes' in node)for(const child of node.childNodes)pending.push({node:child,depth:depth+1})}
  const tag=(node:SourceNode)=>'tagName' in node?node.tagName.toUpperCase():''
  const children=(node:SourceNode)=>'childNodes' in node?node.childNodes:[]
  const attr=(node:SourceNode,name:string)=>'attrs' in node?node.attrs.find(attr=>attr.name===name)?.value:''
  const styles=new WeakMap<object,Record<string,string>>()
  let qualified=true
  const styleOf=(node:SourceNode)=>{let result=styles.get(node);if(!result){result={};try{for(const value of parseInlineStyle(attr(node,'style') || ''))if(value.type==='declaration')result[value.property.toLowerCase()]=value.value}catch{qualified=false};styles.set(node,result)}return result}
  const styledRun=(nodes:SourceNode[]):SourceNode|undefined=>{for(const node of nodes){if(tag(node)==='SPAN'&&attr(node,'style'))return node;const found=styledRun(children(node));if(found)return found}}
  const first=styledRun(sourceTree.childNodes),firstStyle=first?styleOf(first):{}
  const textNode=(value:string):SourceNode=>({nodeName:'#text',value,parentNode:null})
  if(plain)sourceTree.childNodes=[{nodeName:'p',tagName:'p',attrs:[],namespaceURI:html.NS.HTML,parentNode:sourceTree,childNodes:[textNode(['column','group'].includes(node.kind)?'':node.body || '')]}]
  const family = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2')
  const number = (value: string, fallback: number) => value ? Number.parseFloat(value) : fallback
  const base = { family: family(firstStyle['font-family'] || 'Segoe UI'), size: number(firstStyle['font-size'] || '', node.textMode ? 32 : node.kind === 'note' ? 10 : 11),
    weight: number(firstStyle['font-weight'] || '', 400), italic: false, lineHeight: number(firstStyle['line-height'] || '', 1.2),
    spacing: 0, color: node.textColor || (node.kind === 'note' ? '#29231e' : '#dfe1e6'), underline: false, strike: false, highlight: undefined as string | undefined }
  type Style = typeof base
  const spans: NonNullable<Extract<CanvasSceneObject['modelArtwork'], {kind:'type'}>>['spans'][number][] = []
  const blocks: NonNullable<Extract<CanvasSceneObject['modelArtwork'], {kind:'type'}>>['blocks'] extends readonly (infer B)[] | undefined ? B[] : never = []
  let text = '', bytes = 0
  function visit(element: SourceNode, inherited: Style, explicitWeight = false) {
    if (element.nodeName === '#text') {
      const run = 'value' in element ? element.value : '', end = bytes + new TextEncoder().encode(run).length
      if (run) spans.push({ start: bytes, end, ...inherited })
      bytes = end; text += run; return
    }
    if (!tag(element) || !['P','SPAN','STRONG','B','EM','I','U','S','BR','A','MARK','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','CODE','PRE'].includes(tag(element))) { qualified = false; return }
    if (tag(element) === 'BR') { visit(textNode('\n'), inherited, explicitWeight); return }
    const style = styleOf(element), next = { ...inherited }
    for (const name of Object.keys(style)) if (!['font-family','font-size','font-weight','font-style','line-height','letter-spacing','color','text-decoration','background-color','text-align','margin','margin-top','margin-bottom','text-transform'].includes(name)) qualified = false
    // Zero margin is commonly authored by transparent Type frames. Nonzero
    // shorthand needs a full box model and remains explicitly unsupported.
    if (style.margin && !/^0(?:px)?$/.test(style.margin)) qualified = false
    if (style['font-family']) {if(style['font-family'].includes(','))qualified=false;next.family = family(style['font-family'])}
    if (style['font-size']) { if (!/^[\d.]+px$/.test(style['font-size'])) qualified = false; next.size = number(style['font-size'], next.size) }
    if (style['font-weight']) next.weight = style['font-weight'] === 'bold' ? 700 : number(style['font-weight'], next.weight)
    if (style['font-style']) { if (!['normal','italic'].includes(style['font-style'])) qualified = false; next.italic = style['font-style'] === 'italic' }
    if (style['line-height']) { if (!/^[\d.]+$/.test(style['line-height'])) qualified = false; next.lineHeight = number(style['line-height'], next.lineHeight) }
    if (style['letter-spacing']) { if (!/^-?[\d.]+px$/.test(style['letter-spacing'])) qualified = false; next.spacing = number(style['letter-spacing'], 0) }
    if (style['color']) next.color = style['color']
    if (style['background-color']) next.highlight = style['background-color']
    if (tag(element) === 'MARK') next.highlight = style['background-color'] || '#fff09a'
    if (/^H[1-6]$/.test(tag(element))) { if (!style['font-size']) next.size *= [2,1.5,1.17,1,0.83,0.67][Number(tag(element)[1])-1]; next.weight = 700 }
    if (['CODE','PRE'].includes(tag(element))) next.family = 'Consolas'
    if (tag(element) === 'A') next.underline = true
    if (['STRONG','B'].includes(tag(element)) && !style['font-weight'] && !explicitWeight) next.weight = 700
    if (['EM','I'].includes(tag(element))) next.italic = true
    next.underline ||= tag(element) === 'U' || (style['text-decoration'] || '').includes('underline')
    next.strike ||= tag(element) === 'S' || (style['text-decoration'] || '').includes('line-through')
    if (style['text-decoration'] && !/^(underline|line-through|none)$/.test(style['text-decoration'])) qualified = false
    const transform = style['text-transform']
    if(transform && !['none','uppercase','lowercase','capitalize'].includes(transform)) qualified=false
    for (const child of children(element)) {
      if (transform && child.nodeName === '#text') {const value = 'value' in child ? child.value : ''; visit(textNode(transform === 'uppercase' ? value.toUpperCase() : transform === 'lowercase' ? value.toLowerCase() : transform === 'capitalize' ? value.replace(/\b\p{L}/gu,c=>c.toUpperCase()) : value), next, explicitWeight || Boolean(style['font-weight']))}
      else visit(child, next, explicitWeight || Boolean(style['font-weight']))
    }
  }
  function block(element: SourceNode, indent = 0, marker = '') {
    if(tag(element) && ['UL','OL'].includes(tag(element))) { let count=Number(attr(element,'start') || 1); for(const child of children(element).filter(child=>tag(child)==='LI')) block(child, indent+18, tag(element)==='OL' ? `${count++}. ` : '\u2022 '); return }
    if(tag(element) && tag(element) === 'HR') { qualified=false; return }
    const start=bytes
    if(marker)visit(textNode(marker),base)
    if(tag(element) && tag(element) === 'LI') { for(const child of children(element)) { if(tag(child) && ['UL','OL'].includes(tag(child))) continue; visit(child,base) } } else visit(element,base)
    const style=tag(element) ? styleOf(element) : undefined
    const alignment=style?.['text-align'] || 'left'
    if(!['left','center','right','justify'].includes(alignment))qualified=false
    const margin=(value:string|undefined)=>{if(!value)return 0;if(!/^-?[\d.]+px$/.test(value)){qualified=false;return 0}return Number.parseFloat(value)}
    blocks.push({start,end:bytes,alignment:alignment as 'left'|'center'|'right'|'justify',before:margin(style?.['margin-top']),after:margin(style?.['margin-bottom']),indent})
    if(tag(element) && tag(element)==='LI')for(const child of children(element))if(['UL','OL'].includes(tag(child)))block(child,indent)
  }
  for(const element of sourceTree.childNodes)if(element.nodeName!=='#comment'&&(tag(element)||('value' in element&&element.value.trim())))block(element)
  if (!qualified || bytes > 1_000_000 || spans.some(s => ![s.size,s.weight,s.lineHeight,s.spacing].every(Number.isFinite) || s.size <= 0 || s.lineHeight <= 0)) return undefined
  // Type frames start at their authored bounds, without Note-card padding.
  const headerHeight = node.textMode ? 0 : node.kind === 'column' ? (node.columnPresentation==='top-strip'?46:58) : node.kind === 'group' ? 28 : 37
  return { kind: 'type', text, spans, blocks, wrap: node.textMode !== 'point', inset: node.textMode ? 0 : 14, top: node.textMode ? 0 : headerHeight+12,
    background: node.textMode ? undefined : node.kind === 'note' ? '#ece2cf' : node.kind === 'group' ? '#00000000' : node.columnBodyColor || '#252931',
    header: node.textMode ? undefined : {title:node.title,fill:node.color || '#22252c',color:node.textColor || '#ffffff',height:headerHeight} } 
}

