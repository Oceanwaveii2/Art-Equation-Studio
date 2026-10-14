import type {PaintMatrix,PaintOperation} from '../../canvas-engine/paintDisplayList'
import {canvasResourceBudget} from '../../canvas-engine/resourceBudget'
import {recordMetric} from '../../diagnostics/performance'

export type VectorPathCommand =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['Q', number, number, number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z']

export const OP_MOVE_TO = 1
export const OP_LINE_TO = 2
export const OP_QUAD_TO = 3
export const OP_CUBIC_TO = 4
export const OP_CLOSE = 5

/**
 * Packed binary Float32Array protocol for glyph outlines (Optimization Task 3):
 * [OP_MOVE_TO, x, y, OP_LINE_TO, x, y, OP_QUAD_TO, cx, cy, x, y, OP_CUBIC_TO, c1x, c1y, c2x, c2y, x, y, OP_CLOSE]
 */
export function encodeBinaryGlyphCommands(commands: readonly VectorPathCommand[]): Float32Array {
 const floats: number[] = []
 for (const cmd of commands) {
  const op = cmd[0]
  if (op === 'M') floats.push(OP_MOVE_TO, cmd[1], cmd[2])
  else if (op === 'L') floats.push(OP_LINE_TO, cmd[1], cmd[2])
  else if (op === 'Q') floats.push(OP_QUAD_TO, cmd[1], cmd[2], cmd[3], cmd[4])
  else if (op === 'C') floats.push(OP_CUBIC_TO, cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6])
  else if (op === 'Z') floats.push(OP_CLOSE)
 }
 return new Float32Array(floats)
}

export function decodeBinaryGlyphCommands(stream: ArrayLike<number>): VectorPathCommand[] {
 const commands: VectorPathCommand[] = []
 let i = 0
 const len = stream.length
 while (i < len) {
  const op = stream[i++]
  if (op === OP_MOVE_TO && i + 1 < len) {
   commands.push(['M', stream[i++], stream[i++]])
  } else if (op === OP_LINE_TO && i + 1 < len) {
   commands.push(['L', stream[i++], stream[i++]])
  } else if (op === OP_QUAD_TO && i + 3 < len) {
   commands.push(['Q', stream[i++], stream[i++], stream[i++], stream[i++]])
  } else if (op === OP_CUBIC_TO && i + 5 < len) {
   commands.push(['C', stream[i++], stream[i++], stream[i++], stream[i++], stream[i++], stream[i++]])
  } else if (op === OP_CLOSE) {
   commands.push(['Z'])
  } else {
   throw new Error(`RETAINED_TEXT_BINARY_OPCODE_INVALID: ${String(op)}`)
  }
 }
 return commands
}

/** Content/font/layout cache. Identity and placement never affect shaping.
 * Returned operation wrappers are independent, so opacity edits cannot mutate
 * cached glyphs. Budget eviction/disposal drops only derived outlines. */
export function createRetainedTextShape(){
 const owner={},entries=new Map<string,{result:Record<string,any>;lease:NonNullable<ReturnType<typeof canvasResourceBudget.acquire>>}>()
 let hits=0,misses=0,retainedBytes=0
 const multiply=(a:PaintMatrix,b:PaintMatrix):PaintMatrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
 return {
  shape(host:{shape(request:string):string},request:Record<string,any>):Record<string,any> & {operations:PaintOperation[]}{
   const {id,revision,transform,...content}=request
   const key=JSON.stringify(content),entry=entries.get(key)
   let result=entry?.result
   if(result){hits++;entry!.lease.touch();entries.delete(key);entries.set(key,entry!)}
   else{
    misses++;const json=host.shape(JSON.stringify({...content,id:'retained-text',revision:'0',transform:[1,0,0,1,0,0]}))
    result=JSON.parse(json)
    if(!result||!Array.isArray(result.operations))throw Error('RETAINED_TEXT_INVALID')
    for (const op of result.operations) {
     if (op?.type === 'vector' && op.object?.payload && !Array.isArray(op.object.payload.commands) && ArrayBuffer.isView(op.object.payload.binaryCommands)) {
      op.object.payload.commands = decodeBinaryGlyphCommands(op.object.payload.binaryCommands as Float32Array)
     }
    }
    const bytes=(key.length+json.length)*2
    while(entries.size&&(entries.size>=128||retainedBytes+bytes>8*1024*1024)){const first=entries.keys().next().value!;retainedBytes-=entries.get(first)!.lease.bytes;entries.get(first)!.lease.release();entries.delete(first)}
    if(bytes<=8*1024*1024){const lease=canvasResourceBudget.acquire({owner,key,pool:'retained',bytes,pinned:false,priority:1,evict:()=>{const old=entries.get(key);if(old)retainedBytes-=old.lease.bytes;entries.delete(key)}});if(lease){entries.set(key,{result:result!,lease});retainedBytes+=bytes}}
   }
   const rename=(value:string)=>value.replaceAll('retained-text',String(id))
   const operations:PaintOperation[]=result!.operations.map((op:PaintOperation)=>{
    if(op.type==='vector')return {...op,object:{...op.object,id:rename(op.object.id),transform:multiply(transform,op.object.transform as PaintMatrix)}}
    if(op.type==='pop')return {...op,scopeId:rename(op.scopeId)}
    return {...op,...('id' in op?{id:rename(op.id)}:{scopeId:rename(op.scopeId)}),transform:multiply(transform,op.transform)}
   })
   recordMetric('paint.text-cache',{hit:!!entry,hits,misses,entries:entries.size})
   return {...result,id,revision,operations}
  },
  stats(){return {hits,misses,entries:entries.size,retainedBytes}},
  dispose(){canvasResourceBudget.releaseOwner(owner);entries.clear();retainedBytes=0}
 }
}
