import { imageDemand } from './imageDemand'
import { canvasResourceBudget, type CanvasResourceBudget, type CanvasResourceLease } from './resourceBudget'
import type { DecodedImageReference, DecodedImageUpload, PaintMatrix, PaintOperation,PreparedPaintDisplayList } from './paintDisplayList'

export const MAX_DECODED_IMAGE_EDGE = 4096, MAX_DECODED_IMAGE_BYTES = 64 * 1024 * 1024
const MAX_IMAGES = 1024
// Private originals let transport validation refuse caller mutation. The
// exposed typed array is a separate transport copy, never this authority.
const canonicalPixels = new WeakMap<DecodedImageUpload,Uint8Array>()
/** Exact comparison at every ownership boundary, including exposed transport
 * mutation. Aligned words avoid one callback per RGBA byte; no equality result
 * is cached. Subviews and the final one to three bytes are compared directly. */
export function sameImageBytes(left: Uint8Array, right: Uint8Array): boolean {
  const length = left.byteLength
  if (length !== right.byteLength) return false
  try {
    // Detached views also report zero length. Constructing a zero-length view
    // distinguishes them from valid empty arrays without copying any pixels.
    if (!length) {
      new Uint8Array(left.buffer, left.byteOffset, 0)
      new Uint8Array(right.buffer, right.byteOffset, 0)
      return true
    }
    let offset = 0
    if (left.byteOffset % 4 === 0 && right.byteOffset % 4 === 0) {
      const count = Math.floor(length / 4)
      const leftWords = new Uint32Array(left.buffer, left.byteOffset, count)
      const rightWords = new Uint32Array(right.buffer, right.byteOffset, count)
      for (let index = 0; index < count; index++) if (leftWords[index] !== rightWords[index]) return false
      offset = count * 4
    }
    for (; offset < length; offset++) if (left[offset] !== right[offset]) return false
    return true
  } catch {
    return false
  }
}
export function imageIdentity(reference: DecodedImageReference): string {
  return JSON.stringify([reference.epoch, reference.key, reference.revision, reference.width, reference.height])
}
export function validateImageReference(value: unknown): DecodedImageReference {
  const r = value as DecodedImageReference
  if (!r || typeof r !== 'object' || Array.isArray(r)
    || Object.keys(r).length !== 5 || !['key','revision','epoch','width','height'].every(key => Object.hasOwn(r,key))
    || typeof r.key !== 'string' || !r.key || new TextEncoder().encode(r.key).length > 1024
    || !Number.isSafeInteger(r.revision) || r.revision <= 0 || !Number.isInteger(r.epoch) || r.epoch <= 0 || r.epoch > 0xffffffff
    || ![r.width,r.height].every(n => Number.isInteger(n) && n > 0 && n <= MAX_DECODED_IMAGE_EDGE)) {
    throw new Error('RESOURCE_INVALID: exact bounded image reference required')
  }
  return r
}
export function frameImageReferences(snapshot: string): readonly DecodedImageReference[] {return checkedFrameReferences(JSON.parse(snapshot))}
function checkedFrameReferences(source: {schema?:unknown;resources?:unknown}): readonly DecodedImageReference[] {
  if (source.schema !== 'art-equation.display-list') return []
  if (!Array.isArray(source.resources) || source.resources.length > MAX_IMAGES) throw new Error('RESOURCE_INVALID: bounded image reference list required')
  const references = source.resources.map(validateImageReference), ids = new Set<string>(), epochs = new Set<number>()
  for (const r of references) {
    const id = JSON.stringify([r.key,r.revision])
    if (ids.has(id)) throw new Error('RESOURCE_INVALID: duplicate image reference')
    ids.add(id); epochs.add(r.epoch)
  }
  if (epochs.size > 1) throw new Error('RESOURCE_EPOCH_MISMATCH: mixed image epochs')
  return references
}
/** One retained frame only; camera reuse must not parse the display list. */
export function createFrameReferenceCache() {
  let snapshot:string|undefined,references:readonly DecodedImageReference[]=[]
  return {read(source:string,prepared?:PreparedPaintDisplayList){if(source!==snapshot){const next=Object.freeze((prepared?checkedFrameReferences(prepared):frameImageReferences(source)).map(reference=>Object.freeze({...reference})));snapshot=source;references=next}return references},clear(){snapshot=undefined;references=[]}}
}
export function imageUploads(references: readonly DecodedImageReference[], uploads: readonly DecodedImageUpload[] = []): Map<string,DecodedImageUpload> {
  if (!Array.isArray(uploads) || uploads.length > MAX_IMAGES) throw new Error('RESOURCE_INVALID: bounded image upload list required')
  const wanted = new Set(references.map(imageIdentity)), result = new Map<string,DecodedImageUpload>()
  let bytes = 0
  for (const upload of uploads) {
    const r = validateImageReference(upload?.reference), id = imageIdentity(r), p = upload.pixels
    if (!wanted.has(id) || result.has(id) || !(p instanceof Uint8Array) || !(p.buffer instanceof ArrayBuffer)
      || p.byteLength !== r.width * r.height * 4) throw new Error('RESOURCE_INVALID: upload must match a unique declared image')
    bytes += p.byteLength
    if (bytes > MAX_DECODED_IMAGE_BYTES) throw new Error('RESOURCE_BUDGET_EXCEEDED: image upload bytes exceed capacity')
    const canonical = canonicalPixels.get(upload)
    if (canonical && !sameImageBytes(canonical,p)) throw new Error('RESOURCE_REVISION_CONFLICT: registered transport bytes were mutated')
    result.set(id,upload)
  }
  return result
}

/** Shared frontend decoded authority. It copies and premultiplies a bounded
 * accepted preview/mip. Private canonical pixels are separate from exposed
 * transport bytes; resolve/transport validation refuses mutated copies.
 * The image element must already be loaded by the existing media provider. */
export class DecodedImageRegistry {
  private entries = new Map<string,{ upload: DecodedImageUpload; canonical:Uint8Array; lease: CanvasResourceLease }>()
  private idle = new Map<string,number>()
  private idleBytes = 0
  private idleLimit: number
  private newest = new Map<string,number>()
  private visible = new Set<string>()
  private pending = new Set<string>()
  private held = new Map<string,number>()
  private bytes = 0
  private disposed = false
  private residencyRevision = 0
  private reservations = new Map<string,{lease:CanvasResourceLease;bytes:number}>()
  private reservedBytes = 0
  readonly epoch:number
  private budget:CanvasResourceBudget
  constructor(epoch: number, budget: CanvasResourceBudget = canvasResourceBudget, idleLimit = 0) {
    if (!Number.isInteger(epoch) || epoch <= 0 || epoch > 0xffffffff) throw new Error('RESOURCE_INVALID: image epoch required')
    this.epoch=epoch;this.budget=budget;this.idleLimit=Math.min(8*1024*1024,Math.max(0,idleLimit))
  }
  /** Reserve retained bytes before fetch/readback. Active and in-flight pins
   * are never evicted to make a new image appear successful. */
  reserve(reference:DecodedImageReference) {
    const r=validateImageReference(reference),id=imageIdentity(r),bytes=r.width*r.height*8
    if(this.disposed||r.epoch!==this.epoch)throw Error('RESOURCE_EPOCH_MISMATCH: stale decoded registry')
    if(this.entries.has(id))return {release(){}}
    if(this.reservations.has(id))throw Error('RESOURCE_NOT_READY: image admission already pending')
    this.makeRoom(bytes)
    if(this.entries.size+this.reservations.size>=MAX_IMAGES||this.bytes+this.reservedBytes+bytes>MAX_DECODED_IMAGE_BYTES)
      throw Error('RESOURCE_BUDGET_EXCEEDED: decoded image registry full')
    const lease=this.budget.acquire({owner:this,key:id,pool:'retained',bytes,pinned:true,evict:()=>this.drop(id)})
    if(!lease)throw Error('RESOURCE_BUDGET_EXCEEDED: decoded image admission denied')
    const reservation={lease,bytes};this.reservations.set(id,reservation);this.reservedBytes+=bytes
    return {release:()=>{if(this.reservations.get(id)!==reservation)return;this.reservations.delete(id);this.reservedBytes-=bytes;lease.release();this.residencyRevision++}}
  }
  /** Board switch clears the presentation pin, while snapshot/transport holds
   * continue protecting pixels referenced by any outstanding frame. */
  retirePresentation(){this.visible.clear();this.pending.clear();this.prune()}
  register(reference: DecodedImageReference, straightPixels: Uint8Array | Uint8ClampedArray): DecodedImageUpload {
    const r = Object.freeze({ ...validateImageReference(reference) })
    if (this.disposed || r.epoch !== this.epoch) throw new Error('RESOURCE_EPOCH_MISMATCH: stale decoded registry')
    if (!(straightPixels instanceof Uint8Array || straightPixels instanceof Uint8ClampedArray)
      || straightPixels.length !== r.width*r.height*4) throw new Error('RESOURCE_INVALID: exact straight RGBA8 pixels required')
    const id = imageIdentity(r), previous = this.entries.get(id), newest = this.newest.get(r.key) ?? 0
    if ([...this.entries.values()].some(e=>e.upload.reference.key===r.key && e.upload.reference.revision===r.revision && imageIdentity(e.upload.reference)!==id)) throw new Error('RESOURCE_REVISION_CONFLICT: registered image dimensions differ')
    if (r.revision < newest && !previous) throw new Error('RESOURCE_STALE_REVISION: stale image decode')
    const count = straightPixels.length, retainedBytes=count*2, reservation=this.reservations.get(id)
    if(!previous&&!reservation)this.makeRoom(retainedBytes)
    if (!previous && !reservation && (this.entries.size >= MAX_IMAGES || this.bytes+this.reservedBytes+retainedBytes > MAX_DECODED_IMAGE_BYTES)) throw new Error('RESOURCE_BUDGET_EXCEEDED: decoded image registry full')
    const lease = previous?.lease ?? reservation?.lease ?? this.budget.acquire({ owner:this,key:id,pool:'retained',bytes:retainedBytes,pinned:true,evict:()=>this.drop(id) })
    if (!lease) throw new Error('RESOURCE_BUDGET_EXCEEDED: decoded image admission denied')
    try {
      if (previous) {
        const old = previous.canonical
        for (let i=0;i<count;i+=4) {
          const a = straightPixels[i+3]
          if (old[i+3] !== a || [0,1,2].some(c => old[i+c] !== Math.round(straightPixels[i+c]*a/255))) throw new Error('RESOURCE_REVISION_CONFLICT: immutable image pixels differ')
        }
        this.resolve(r); return previous.upload
      }
      const pixels = new Uint8Array(count)
      for (let i=0;i<count;i+=4) { const a=straightPixels[i+3]; pixels[i+3]=a; for(let c=0;c<3;c++) pixels[i+c]=Math.round(straightPixels[i+c]*a/255) }
      const upload = Object.freeze({ reference:r,pixels:new Uint8Array(pixels) })
      canonicalPixels.set(upload,pixels)
      if(reservation){this.reservations.delete(id);this.reservedBytes-=reservation.bytes}
      this.entries.set(id,{upload,canonical:pixels,lease}); this.bytes+=retainedBytes;this.residencyRevision++; this.newest.set(r.key,Math.max(newest,r.revision))
      return upload
    } catch(error) { if (!previous && !reservation) lease.release(); throw error }
  }
  resolve(reference: DecodedImageReference): DecodedImageUpload {
    const entry=this.entries.get(imageIdentity(validateImageReference(reference)))
    if (this.disposed || !entry) throw new Error('RESOURCE_NOT_READY: decoded image unavailable')
    if (!sameImageBytes(entry.canonical,entry.upload.pixels)) throw new Error('RESOURCE_REVISION_CONFLICT: decoded transport bytes were mutated')
    const id=imageIdentity(entry.upload.reference),idle=this.idle.get(id)
    if(idle!==undefined){this.idleBytes-=idle;this.idle.delete(id);entry.lease.setPinned(true)}
    entry.lease.touch(); return entry.upload
  }
  stage(references: readonly DecodedImageReference[]) { for(const r of references)this.resolve(r); this.pending=new Set(references.map(imageIdentity)) }
  retain(references:readonly DecodedImageReference[]) {
    for(const r of references)this.resolve(r)
    const ids=new Set(references.map(imageIdentity));for(const id of ids)this.held.set(id,(this.held.get(id)??0)+1)
    let released=false
    return {release:()=>{if(released)return;released=true;for(const id of ids){const count=(this.held.get(id)??1)-1;if(count)this.held.set(id,count);else this.held.delete(id)}this.prune()}}
  }
  present() { this.visible=this.pending;this.pending=new Set();this.prune() }
  discard() { this.pending.clear();this.prune() }
  private prune() {
    for(const [id,entry] of this.entries) if(!this.visible.has(id)&&!this.pending.has(id)&&!this.held.has(id)){
      if(!this.idleLimit||entry.lease.bytes>this.idleLimit){this.drop(id);continue}
      if(!this.idle.has(id)){this.idle.set(id,entry.lease.bytes);this.idleBytes+=entry.lease.bytes;entry.lease.setPinned(false)}
    }else {const size=this.idle.get(id);if(size!==undefined){this.idleBytes-=size;this.idle.delete(id);entry.lease.setPinned(true)}}
    while(this.idleBytes>this.idleLimit&&this.idle.size)this.drop(this.idle.keys().next().value!)
    for(const key of this.newest.keys()) if(![...this.entries.values()].some(e=>e.upload.reference.key===key))this.newest.delete(key)
  }
  private drop(id:string){const entry=this.entries.get(id);if(!entry)return;const idle=this.idle.get(id);if(idle!==undefined){this.idleBytes-=idle;this.idle.delete(id)}this.entries.delete(id);this.bytes-=entry.lease.bytes;entry.lease.release();this.residencyRevision++}
  private makeRoom(bytes:number){while(this.idle.size&&(this.bytes+this.reservedBytes+bytes>MAX_DECODED_IMAGE_BYTES||this.entries.size+this.reservations.size>=MAX_IMAGES))this.drop(this.idle.keys().next().value!)}
  stats() { return {epoch:this.epoch,bytes:this.bytes,idleBytes:this.idleBytes,idleLimit:this.idleLimit,reservedBytes:this.reservedBytes,residencyRevision:this.residencyRevision,count:this.entries.size,visiblePins:this.visible.size,pendingPins:this.pending.size,transportPins:this.held.size} }
  dispose() { for(const reservation of this.reservations.values())reservation.lease.release();this.reservations.clear();this.reservedBytes=0;for(const entry of this.entries.values())entry.lease.release();this.entries.clear();this.idle.clear();this.idleBytes=0;this.newest.clear();this.visible.clear();this.pending.clear();this.held.clear();this.bytes=0;this.disposed=true }
}

/** Contribution from an already accepted static-image provider. The caller
 * supplies its measured natural-pixel-to-world matrix and surrounding clips;
 * this covers only image content, never card chrome, badges or hit semantics.
 * Large sources must arrive through the existing bounded proxy/tile provider. */
export function captureLoadedImagePaint(image: HTMLImageElement, registry: DecodedImageRegistry, options: {
  id:string; key:string; revision:number; transform:PaintMatrix;
  providerKind:'static-image'; opacity?:number; sampling?:'nearest'|'bilinear';
  sourceRect?:Readonly<{x:number;y:number;width:number;height:number}>;
  budget?:CanvasResourceBudget; physicalScale?:number;
}): {operation:PaintOperation;upload:DecodedImageUpload;source:string} {
  const source=image.currentSrc || image.src, sourceWidth=image.naturalWidth, sourceHeight=image.naturalHeight
  const demand=options.physicalScale===undefined||options.sampling==='nearest'?{width:sourceWidth,height:sourceHeight,divisor:1}:imageDemand(sourceWidth,sourceHeight,options.transform,options.physicalScale)
  const {width,height}=demand
  if(options.providerKind!=='static-image' || !image.isConnected || !image.complete || !source || width<=0 || height<=0) throw new Error('RESOURCE_NOT_READY: loaded static image provider required')
  if(width>MAX_DECODED_IMAGE_EDGE || height>MAX_DECODED_IMAGE_EDGE || width*height*8>MAX_DECODED_IMAGE_BYTES) throw new Error('RESOURCE_BUDGET_EXCEEDED: provider needs a bounded accepted proxy or tile')
  const reference=validateImageReference({key:demand.divisor===1?options.key:`${options.key}:mip:${width}x${height}`,revision:options.revision,epoch:registry.epoch,width,height})
  const [a,b,c,d,e,f]=options.transform
  const matrix:PaintMatrix=[a*sourceWidth/width,b*sourceWidth/width,c*sourceHeight/height,d*sourceHeight/height,e,f], opacity=options.opacity ?? 1
  if(matrix.length!==6 || matrix.some(n=>!Number.isFinite(n)) || Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-12
    || !Number.isFinite(opacity) || opacity<0 || opacity>1) throw new Error('IMAGE_INVALID: measured matrix/opacity invalid')
  const style=image.ownerDocument.defaultView?.getComputedStyle(image)
  if(!style || style.filter!=='none' || style.mixBlendMode!=='normal') throw new Error('IMAGE_PAINT_UNSUPPORTED: provider effects require explicit ordered operations')
  const originalCrop=options.sourceRect ?? {x:0,y:0,width:sourceWidth,height:sourceHeight}
  const crop={x:originalCrop.x*width/sourceWidth,y:originalCrop.y*height/sourceHeight,width:originalCrop.width*width/sourceWidth,height:originalCrop.height*height/sourceHeight}
  if(![crop.x,crop.y,crop.width,crop.height].every(Number.isFinite) || crop.x<0 || crop.y<0 || crop.width<=0 || crop.height<=0
    || crop.x+crop.width>width || crop.y+crop.height>height) throw new Error('IMAGE_INVALID: source crop exceeds decoded pixels')
  let upload:DecodedImageUpload
  try {upload=registry.resolve(reference)} catch(error) {
    if(!String(error).includes('RESOURCE_NOT_READY')) throw error
    // Both the readback array and temporary canvas bitmap coexist here.
    const lease=(options.budget ?? canvasResourceBudget).acquire({owner:registry,key:`decode:${imageIdentity(reference)}`,pool:'tile-surface',bytes:width*height*8,pinned:true})
    if(!lease) throw new Error('RESOURCE_BUDGET_EXCEEDED: bounded provider readback denied')
    const canvas=image.ownerDocument.createElement('canvas')
    try {
      canvas.width=width;canvas.height=height
      const context=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true})
      if(!context) throw new Error('RESOURCE_UNREADABLE: image decoding context unavailable')
      context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high'
      context.drawImage(image,0,0,width,height)
      const pixels=context.getImageData(0,0,width,height,{colorSpace:'srgb'})
      if(!image.isConnected || !image.complete || (image.currentSrc || image.src)!==source || image.naturalWidth!==sourceWidth || image.naturalHeight!==sourceHeight) throw new Error('RESOURCE_STALE_DECODE: provider changed during pixel capture')
      upload=registry.register(reference,pixels.data)
    } catch(error) {
      if(error instanceof DOMException && error.name==='SecurityError') throw new Error('RESOURCE_UNREADABLE: provider pixels cannot be read')
      throw error
    } finally {canvas.width=0;canvas.height=0;lease.release()}
  }
  return {operation:{type:'image',id:options.id,resource:reference,sourceRect:{...crop},transform:matrix,opacity,sampling:options.sampling ?? 'bilinear'},upload,source}
}
