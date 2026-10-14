import {createRetainedTextShape} from './retainedTextShape'
import { invoke } from '@tauri-apps/api/core'
import type { CanvasSceneObject, CanvasVectorCommand } from '../../canvas-engine/contracts'
import type { PaintOperation, PaintMatrix } from '../../canvas-engine/paintDisplayList'
import {createNativeTextFontResolver} from '../../canvas-engine/nativeTextFonts'
import type {ShapedTextEngineHost} from '../../canvas-engine/semanticTextPaint'
import { canvasResourceBudget } from '../../canvas-engine/resourceBudget'
import type { CompleteCardPaintResult } from '../../canvas-engine/completePaint'
import { loadVelloEngine } from './backends'
import { recordMetric } from '../../diagnostics/performance'
import {authoredColor} from './authoredColor'

/** Canonical layout -> actual native font bytes -> vector glyphs. No DOM reads,
 * HTML capture, thumbnail raster or placeholder text participates in this paint. */
export function createStructuredCardPainter() {
  const resolver = createNativeTextFontResolver((command, args) => invoke(command, args as Record<string, unknown>))
  const shapedCache=createRetainedTextShape()
  const epoch = 'structured-card-v1', owner = {}, registered = new Set<string>()
  let enginePromise: Promise<ShapedTextEngineHost> | undefined, disposed = false, registeredBytes = 0
  const engineLease = canvasResourceBudget.acquire({ owner, key: 'fonts', pool: 'retained', bytes: 1024, pinned: true })
  const engine = () => enginePromise ??= loadVelloEngine().then(m => { if (disposed) throw Error('STRUCTURED_PAINT_DISPOSED'); return new m.TextEngine(epoch) })
  return {
    async paint(object: CanvasSceneObject): Promise<CompleteCardPaintResult> {
      if (disposed || !engineLease) throw Error('STRUCTURED_PAINT_RESOURCE_LIMIT')
      const card = object.structuredCard, frame = object.localBounds
      if (!card || !frame || frame.width < 32 || frame.height < 32) throw Error('STRUCTURED_CARD_INVALID')
      const a = object.appearance.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
      const matrix: PaintMatrix = [c, s, -s, c, frame.x + frame.width/2 - c*frame.width/2 + s*frame.height/2, frame.y + frame.height/2 - s*frame.width/2 - c*frame.height/2]
      const rectangle: CanvasVectorCommand[] = [['M',0,0],['L',frame.width,0],['L',frame.width,frame.height],['L',0,frame.height],['Z']]
      const opacityScope = object.id + ':opacity'
      const operations: PaintOperation[] = [{ type: 'pushComposite', scopeId: opacityScope, commands: [['M',-5,-5],['L',frame.width+5,-5],['L',frame.width+5,frame.height+5],['L',-5,frame.height+5],['Z']], transform: matrix, fillRule: 'nonzero', isolation: 'isolated', opacity: object.appearance.opacity, blendMode: 'normal' }, { type: 'vector', object: { id: object.id + ':body', kind: 'vector', bounds: frame, transform: matrix, opacity: 1, payload: { commands: rectangle, fill: card.fill, stroke: '#67d5cd', strokeWidth: 1 } } }]
      if (card.headerFill) operations.push({type:'vector',object:{id:object.id+':header',kind:'vector',transform:matrix,opacity:1,payload:{commands:[['M',0,0],['L',frame.width,0],['L',frame.width,Math.min(58,frame.height)],['L',0,Math.min(58,frame.height)],['Z']],fill:card.headerFill,strokeWidth:0}}})
      const scope = object.id + ':text-clip'
      operations.push({type:'pushClip',scopeId:scope,commands:rectangle,transform:matrix,fillRule:'nonzero',isolation:'isolated'})
      const host = await engine(), textColor=authoredColor(card.text)
      const lines = [{text:card.title,size:14,weight:700,y:10}, ...card.rows.map((text,i)=>({text,size:12,weight:400,y:34+i*20})), {text:card.result,size:12,weight:700,y:frame.height-30}]
      for (let index=0;index<lines.length;index++) {
        const line=lines[index]
        if (index>0 && index<lines.length-1 && line.y>frame.height-54) continue
        const text=line.text.replace(/[\r\n]+/g,' ')
        if (!text) continue
        if(!resolver.fallbacks)throw Error('STRUCTURED_FONT_FALLBACK_UNAVAILABLE')
        const fonts=[await resolver({family:'Segoe UI',weight:line.weight,italic:false})]
        if(disposed)throw Error('STRUCTURED_PAINT_DISPOSED')
        if (/[^\x20-\x7e\u00a0-\u024f]/.test(text)) for (const font of await resolver.fallbacks({families:['Segoe UI'],text,weight:line.weight,italic:false})) if(!fonts.some(f=>f.key===font.key))fonts.push(font)
        if(disposed)throw Error('STRUCTURED_PAINT_DISPOSED')
        for(const font of fonts) if(!registered.has(font.key)) {
          if(!engineLease.resize(1024+registeredBytes+font.bytes.length*2)) throw Error('STRUCTURED_FONT_RESOURCE_LIMIT')
          const receipt=JSON.parse(host.register_font(font.key,font.revision,font.faceIndex,font.bytes))
          if(receipt.contentHash!==font.contentHash||receipt.faceIndex!==font.faceIndex)throw Error('STRUCTURED_FONT_FACE_MISMATCH')
          registered.add(font.key);registeredBytes+=font.bytes.length*2
        }
        const scratch=canvasResourceBudget.acquire({owner,key:'shape',pool:'tile-surface',bytes:8*1024*1024,pinned:true})
        if(!scratch)throw Error('STRUCTURED_SHAPE_RESOURCE_LIMIT')
        try {
          const transform: PaintMatrix=[c,s,-s,c,matrix[4]+c*12-s*line.y,matrix[5]+s*12+c*line.y]
          const shaped=shapedCache.shape(host,{schema:'art-equation.shaped-text',schemaVersion:1,layoutAuthority:'model',id:object.id+':label:'+index,revision:String(object.revision),fontEpoch:epoch,text,maxWidth:Math.max(8,frame.width-24),wrapMode:'nowrap',overflowWrap:'normal',alignment:'left',baseDirection:'ltr',maxCommands:16384,transform,spans:[{start:0,end:new TextEncoder().encode(text).length,fonts:fonts.map(font=>({key:font.key,revision:font.revision})),fontSize:line.size,fontWeight:line.weight,fontStyle:'normal',lineHeight:1.2,letterSpacing:0,color:textColor}]})
          if(!Array.isArray(shaped.operations)||!shaped.operations.length)throw Error('STRUCTURED_GLYPH_PAINT_MISSING')
          operations.push(...shaped.operations)
        }finally{scratch.release()}
      }
      operations.push({type:'pop',scopeId:scope})
      for(let i=0;i<card.ports.length;i++) {
        const p=card.ports[i],r=4,k=r*.5522847498307936
        const commands: CanvasVectorCommand[]=[['M',p.x+r,p.y],['C',p.x+r,p.y+k,p.x+k,p.y+r,p.x,p.y+r],['C',p.x-k,p.y+r,p.x-r,p.y+k,p.x-r,p.y],['C',p.x-r,p.y-k,p.x-k,p.y-r,p.x,p.y-r],['C',p.x+k,p.y-r,p.x+r,p.y-k,p.x+r,p.y],['Z']]
        operations.push({type:'vector',object:{id:object.id+':pin:'+i,kind:'vector',transform:matrix,opacity:1,payload:{commands,fill:'#67d5cd',stroke:'#00000000',strokeWidth:0}}})
      }
      operations.push({type:'pop',scopeId:opacityScope})
      if(disposed)throw Error('STRUCTURED_PAINT_DISPOSED')
      recordMetric('graph.paint',{operations:operations.length,ports:card.ports.length,labels:lines.length,nativeFonts:registered.size,domMeasurements:0})
      return {objectId:object.id,objectRevision:object.revision,order:object.order,layoutRevision:0,sourceFingerprint:JSON.stringify(card),status:'ready',completePaint:true,operations,uploads:[],visualBounds:{x:object.bounds.x-5,y:object.bounds.y-5,width:object.bounds.width+10,height:object.bounds.height+10},blockers:[]}
    },
    dispose(){if(disposed)return;disposed=true;shapedCache.dispose();resolver.dispose();void enginePromise?.then(host=>host.free?.(),()=>{});canvasResourceBudget.releaseOwner(owner)}
  }
}


