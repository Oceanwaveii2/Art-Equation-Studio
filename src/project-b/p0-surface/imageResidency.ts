import type { DecodedImageReference } from '../../canvas-engine/paintDisplayList'
import { imageIdentity } from '../../canvas-engine/decodedImageRegistry'

/** Active images always win. A small LRU of checked resident images may remain
 * across boards; this schedules no rendering/decoding for inactive boards.
 * GPU admission still accounts for every retained byte and atlas page. */
export class ImageResidency {
  private recent = new Map<string,DecodedImageReference>()
  private capacity: number
  private maxCount: number
  constructor(capacity = 16 * 1024 * 1024, maxCount = 128) {this.capacity=capacity;this.maxCount=maxCount}
  request(active: readonly DecodedImageReference[]): readonly DecodedImageReference[] {
    const result = new Map(active.map(reference=>[imageIdentity(reference),reference]))
    let bytes = active.reduce((sum,r)=>sum+r.width*r.height*4,0)
    for(const [key,reference] of [...this.recent].reverse()){
      if(result.has(key))continue
      // A newer asset revision supersedes its old pixels even across boards.
      if(active.some(r=>r.key===reference.key&&r.epoch===reference.epoch))continue
      const size=reference.width*reference.height*4
      if(result.size>=this.maxCount||bytes+size>this.capacity)continue
      result.set(key,reference);bytes+=size
    }
    return [...result.values()]
  }
  checked(resident: readonly DecodedImageReference[], active: readonly DecodedImageReference[]) {
    const known=new Map(resident.map(r=>[imageIdentity(r),r]))
    for(const key of this.recent.keys())if(!known.has(key))this.recent.delete(key)
    for(const r of resident)if(!this.recent.has(imageIdentity(r)))this.recent.set(imageIdentity(r),r)
    for(const r of active){const key=imageIdentity(r);if(known.has(key)){this.recent.delete(key);this.recent.set(key,r)}}
  }
  clear(){this.recent.clear()}
}
