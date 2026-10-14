import {createRetainedTextShape} from './retainedTextShape'
import type {ModelTileStream} from './modelTileStream'
import {paintModelTiles} from './modelTilePaint'
import { imageDrawRect } from '../../model/imageFraming'
import {decodeModelImage,clearModelImageDecodes,decodedModelImageDimensions} from './modelImageDecode'
import { invoke } from '@tauri-apps/api/core'
import type { CanvasSceneObject, CanvasVectorCommand, CanvasViewport, CanvasSize } from '../../canvas-engine/contracts'
import type { PaintMatrix, PaintOperation, DecodedImageUpload } from '../../canvas-engine/paintDisplayList'
import { DecodedImageRegistry } from '../../canvas-engine/decodedImageRegistry'
import {createNativeTextFontResolver} from '../../canvas-engine/nativeTextFonts'
import type {ShapedTextEngineHost} from '../../canvas-engine/semanticTextPaint'
import {authoredColor} from './authoredColor'
import { canvasResourceBudget } from '../../canvas-engine/resourceBudget'
import type { CompleteCardPaintResult } from '../../canvas-engine/completePaint'
import { loadVelloEngine } from './backends'
import { metricSpan, recordMetric } from '../../diagnostics/performance'

/** Bounded passive artwork compiler. HTML is already parsed into authored runs;
 * image dimensions come from decoded source pixels. Neither is measured from a
 * mounted card. Resource lifetime follows this canvas, rather than its board. */
export function createModelArtworkPainter(registry: DecodedImageRegistry,stream?:ModelTileStream) {
  const shapedCache=createRetainedTextShape()
  const owner = {}, epoch = 'model-artwork-v1', registered = new Set<string>()
  const resolver = createNativeTextFontResolver((command,args) => invoke(command,args as Record<string,unknown>))
  let hostPromise: Promise<ShapedTextEngineHost> | undefined, disposed = false, fontBytes = 0
  const lease = canvasResourceBudget.acquire({owner,key:'fonts',pool:'retained',bytes:1024,pinned:true})
  const timed = async <T,>(phase:string, work:()=>Promise<T>):Promise<T> => {const finish=metricSpan('paint.prepare.'+phase);try{return await work()}finally{finish()}}
  const host = () => hostPromise ??= loadVelloEngine().then(m => {if(disposed) throw Error('MODEL_PAINT_DISPOSED');return new m.TextEngine(epoch)})
  return {
    async paint(object: CanvasSceneObject, view?:CanvasViewport, size?:CanvasSize, dpr=1, current:()=>boolean=()=>true): Promise<CompleteCardPaintResult> {
      const end = metricSpan('paint.model',{id:object.id,kind:object.modelArtwork?.kind || ''})
      const frame = object.localBounds, model = object.modelArtwork
      if (!frame || !model || !lease || disposed) throw Error('MODEL_PAINT_INVALID')
      const a = object.appearance.rotation*Math.PI/180, c = Math.cos(a), s = Math.sin(a)
      const matrix: PaintMatrix = [c,s,-s,c,frame.x+frame.width/2-c*frame.width/2+s*frame.height/2,frame.y+frame.height/2-s*frame.width/2-c*frame.height/2]
      const rect: CanvasVectorCommand[] = [['M',0,0],['L',frame.width,0],['L',frame.width,frame.height],['L',0,frame.height],['Z']]
      const scope = object.id+':model', operations: PaintOperation[] = [], uploads: DecodedImageUpload[] = []
      if((model.kind==='type' && model.background) || (model.kind==='image' && model.header))operations.push({type:'vector',object:{id:object.id+':body',kind:'vector',transform:matrix,opacity:object.appearance.opacity,payload:{commands:rect,fill:model.kind==='type'?model.background:'#101116',stroke:object.appearance.stroke,strokeWidth:object.appearance.strokeWidth || 0}}})
      // Area frames clip authored overflow. Point text keeps its complete run.
      if(model.kind==='image'||model.wrap) operations.push({type:'pushClip',scopeId:scope,commands:rect,transform:matrix,fillRule:'nonzero',isolation:'isolated'})
      try {
        if (model.kind === 'type') {
          const engine = await timed('text-engine',host)
          const spans = []
          for (const run of model.spans) {
            const fonts = [await timed('font-resolve',()=>resolver({family:run.family,weight:run.weight,italic:run.italic}))]
            if(disposed)throw Error('MODEL_PAINT_DISPOSED')
            const segment = new TextDecoder().decode(new TextEncoder().encode(model.text).slice(run.start,run.end))
            if (/[^\x20-\x7e\u00a0-\u024f]/.test(segment)) {
              if (!resolver.fallbacks) throw Error('MODEL_FALLBACK_UNAVAILABLE')
              const fallbacks=resolver.fallbacks
              for (const font of await timed('font-fallback',()=>fallbacks({families:[run.family],text:segment,weight:run.weight,italic:run.italic}))) if(!fonts.some(f=>f.key===font.key)) fonts.push(font)
            }
            if(disposed)throw Error('MODEL_PAINT_DISPOSED')
            for (const font of fonts) if (!registered.has(font.key)) {
              if (!lease.resize(1024+fontBytes+font.bytes.length*2)) throw Error('MODEL_FONT_RESOURCE_LIMIT')
              const fontFinish=metricSpan('paint.prepare.font-register',{id:object.id});let receipt;try{receipt=JSON.parse(engine.register_font(font.key,font.revision,font.faceIndex,font.bytes))}finally{fontFinish()}
              if(receipt.contentHash!==font.contentHash || receipt.faceIndex!==font.faceIndex) throw Error('MODEL_FONT_FACE_MISMATCH')
              registered.add(font.key); fontBytes+=font.bytes.length*2
            }
            const color=authoredColor(run.color)
            spans.push({start:run.start,end:run.end, fonts:fonts.map(font=>({key:font.key,revision:font.revision})),fontSize:run.size,fontWeight:run.weight,fontStyle:run.italic?'italic':'normal',lineHeight:run.lineHeight,letterSpacing:run.spacing,color,underline:run.underline,strike:run.strike,highlight:run.highlight ? authoredColor(run.highlight) : undefined})
          }
          const scratch = canvasResourceBudget.acquire({owner,key:'shape',pool:'tile-surface',bytes:8*1024*1024,pinned:true})
          if(!scratch)throw Error('MODEL_SHAPE_RESOURCE_LIMIT')
          try {
            const encoded = new TextEncoder().encode(model.text)
            let y = model.top || 0
            const blocks = model.blocks || [{start:0,end:encoded.length,alignment:'left',before:0,after:0,indent:0}]
            for (let index=0;index<blocks.length;index++) {
              const block=blocks[index], text=new TextDecoder().decode(encoded.slice(block.start,block.end))
              y+=block.before
              if(!text){y+=(model.spans[0]?.size || 11)*(model.spans[0]?.lineHeight || 1.2)+block.after;continue}
              const localSpans=spans.filter(run=>run.start<block.end && run.end>block.start).map(run=>({...run,start:Math.max(run.start,block.start)-block.start,end:Math.min(run.end,block.end)-block.start}))
              const x=model.inset+block.indent
              const shapeFinish=metricSpan('paint.prepare.text-shape',{id:object.id,paragraph:index});let result;try{result = shapedCache.shape(engine,{schema:'art-equation.shaped-text',schemaVersion:1,layoutAuthority:'model',id:object.id+':paragraph:'+index,revision:String(object.revision),fontEpoch:epoch,text,maxWidth:model.wrap?Math.max(1,frame.width-model.inset*2-block.indent):1_000_000,wrapMode:model.wrap?'wrap':'nowrap',overflowWrap:'anywhere',alignment:block.alignment,baseDirection:'ltr',maxCommands:262144,transform:[c,s,-s,c,matrix[4]+c*x-s*y,matrix[5]+s*x+c*y],spans:localSpans})}finally{shapeFinish()}
              if (!result.completePaint || !Array.isArray(result.operations) || !Number.isFinite(result.height)) throw Error('MODEL_TEXT_INCOMPLETE')
              operations.push(...result.operations.map(operation=>operation.type==='vector'?{...operation,object:{...operation.object,opacity:object.appearance.opacity}}:operation));y+=result.height+block.after
            }
          } finally {scratch.release()}
        } else if(model.pyramid){
          if(!view||!size)throw Error('MODEL_TILE_VIEW_REQUIRED')
          const tilePaint=await paintModelTiles(object,registry,view,size,dpr,()=>!disposed&&current(),stream)
          operations.push(...tilePaint.operations);uploads.push(...tilePaint.uploads)
        } else {
          // Mips supply at least one source pixel per physical display pixel.
          // Higher zoom demand invalidates retained paint and requests detail.
          const upload=await decodeModelImage(object,registry,()=>!disposed&&current(),view,dpr)
          const reference=upload.reference,{width,height}=reference
          {
            const contentTop=model.header?.height || 0,contentHeight=frame.height-contentTop
            const source=model.sourceDimensions || decodedModelImageDimensions(upload) || {width,height}
            const draw=imageDrawRect(source,{width:frame.width,height:contentHeight},model.framing)
            if(!draw)throw Error('MODEL_IMAGE_FRAMING_INVALID')
            const r=(model.framing?.rotation || 0)*Math.PI/180,rc=Math.cos(r),rs=Math.sin(r),fx=model.framing?.flipX?-1:1,fy=model.framing?.flipY?-1:1
            const ia=rc*fx,ib=rs*fx,ic=-rs*fy,id=rc*fy
            const x=frame.width/2+ia*(draw.x-frame.width/2)+ic*(draw.y-contentHeight/2),y=contentTop+contentHeight/2+ib*(draw.x-frame.width/2)+id*(draw.y-contentHeight/2)
            const blend=model.framing?.blendMode
            const blendScope=object.id+':image-blend'
            if(blend && blend!=='source-over')operations.push({type:'pushComposite',scopeId:blendScope,commands:rect,transform:matrix,fillRule:'nonzero',isolation:'isolated',opacity:1,blendMode:blend==='multiply'?'multiply':'screen'})
            operations.push({type:'image',id:object.id,resource:reference,sourceRect:{x:0,y:0,width,height},transform:[(c*ia-s*ib)*draw.width/width,(s*ia+c*ib)*draw.width/width,(c*ic-s*id)*draw.height/height,(s*ic+c*id)*draw.height/height,matrix[4]+c*x-s*y,matrix[5]+s*x+c*y],opacity:object.appearance.opacity*(model.framing?.opacity??1),sampling:'bilinear'})
            if(blend && blend!=='source-over')operations.push({type:'pop',scopeId:blendScope})
            const overlay=model.framing?.overlay
            if(overlay){
              const lines:CanvasVectorCommand[]=[]
              const vertical=(x:number)=>lines.push(['M',x,0],['L',x,frame.height]),horizontal=(y:number)=>lines.push(['M',0,y],['L',frame.width,y])
              if(overlay==='thirds'){vertical(frame.width/3);vertical(frame.width*2/3);horizontal(frame.height/3);horizontal(frame.height*2/3)}
              else if(overlay==='golden'){vertical(frame.width*.382);vertical(frame.width*.618);horizontal(frame.height*.382);horizontal(frame.height*.618)}
              else if(overlay==='center'){vertical(frame.width/2);horizontal(frame.height/2)}
              else if(overlay==='diagonals')lines.push(['M',0,0],['L',frame.width,frame.height],['M',frame.width,0],['L',0,frame.height])
              else throw Error('MODEL_IMAGE_OVERLAY_UNSUPPORTED')
              operations.push({type:'vector',object:{id:object.id+':guides',kind:'vector',transform:matrix,opacity:1,payload:{commands:lines,fill:'#00000000',stroke:'#ffffffff',strokeWidth:1}}})
            }
            uploads.push(upload)
          }
        }
        if(model.header) {
          const h=model.header, titleFrame={...frame,height:h.height}
          const title=await this.paint({...object,id:object.id+':header',modelPorts:undefined,localBounds:titleFrame,appearance:{...object.appearance,rotation:0},modelArtwork:{kind:'type',text:h.title,wrap:true,inset:11,top:8,background:h.fill,spans:[{start:0,end:new TextEncoder().encode(h.title).length,family:'Segoe UI',size:nodeHeaderSize(h.height),weight:700,italic:false,lineHeight:1.2,spacing:0,color:h.color,underline:false,strike:false}]}})
          // Header uses the same card-local transform, including rotation.
          operations.push(...title.operations.map(op=>{
            const transform: PaintMatrix | undefined=op.type==='vector'?op.object.transform as PaintMatrix:op.type==='pushClip'||op.type==='pushComposite'||op.type==='image'?op.transform:undefined
            if(!transform)return op
            const [a,b,d,e,x,y]=transform,lx=x-frame.x,ly=y-frame.y
            const composed:PaintMatrix=[c*a-s*b,s*a+c*b,c*d-s*e,s*d+c*e,matrix[4]+c*lx-s*ly,matrix[5]+s*lx+c*ly]
            return op.type==='vector'?{...op,object:{...op.object,transform:composed}}:{...op,transform:composed}
          }))
        }
        if(model.kind==='image'||model.wrap) operations.push({type:'pop',scopeId:scope})
        for(const [index,p] of (object.modelPorts||[]).entries()){
          const r=4,k=r*.5522847498307936
          const commands:CanvasVectorCommand[]=[['M',p.x+r,p.y],['C',p.x+r,p.y+k,p.x+k,p.y+r,p.x,p.y+r],['C',p.x-k,p.y+r,p.x-r,p.y+k,p.x-r,p.y],['C',p.x-r,p.y-k,p.x-k,p.y-r,p.x,p.y-r],['C',p.x+k,p.y-r,p.x+r,p.y-k,p.x+r,p.y],['Z']]
          operations.push({type:'vector',object:{id:object.id+':port:'+index,kind:'vector',transform:matrix,opacity:object.appearance.opacity,payload:{commands,fill:authoredColor(p.color),stroke:'#00000000',strokeWidth:0}}})
        }
        if(disposed)throw Error('MODEL_PAINT_DISPOSED')
        recordMetric('paint.model-owned',{id:object.id,kind:model.kind,operations:operations.length,domMeasurements:0})
        return {objectId:object.id,objectRevision:object.revision,order:object.order,layoutRevision:0,sourceFingerprint:JSON.stringify(model),status:'ready',completePaint:true,operations,uploads,visualBounds:object.modelPorts?.length?{x:object.bounds.x-5,y:object.bounds.y-5,width:object.bounds.width+10,height:object.bounds.height+10}:object.bounds,blockers:[]}
      } finally {end()}
    },
    dispose(){if(disposed)return;disposed=true;shapedCache.dispose();clearModelImageDecodes(registry);resolver.dispose();void hostPromise?.then(engine=>engine.free?.(),()=>{});canvasResourceBudget.releaseOwner(owner)}
  }
}

function nodeHeaderSize(height:number){return height>=46?13:10}




