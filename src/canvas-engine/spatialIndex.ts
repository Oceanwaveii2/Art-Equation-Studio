/** Fixed shards preserve immutable render snapshots while copying only changed
 * buckets. Forking cost is independent of board membership; no overlay chains. */
class ShardedMap<V> {
 private buckets:Map<string,V>[] = Array.from({length:128},()=>new Map())
 private owned=new Set<number>(Array.from({length:128},(_,i)=>i))
 private count=0
 copiedEntries=0
 private bucket(key:string){let hash=2166136261;for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619);return (hash>>>0)%128}
 private write(i:number){if(!this.owned.has(i)){this.copiedEntries+=this.buckets[i].size;this.buckets[i]=new Map(this.buckets[i]);this.owned.add(i)}return this.buckets[i]}
 fork(){const next=new ShardedMap<V>();next.buckets=this.buckets.slice();next.owned.clear();this.owned.clear();next.count=this.count;return next}
 get size(){return this.count}
 get(key:string){return this.buckets[this.bucket(key)].get(key)}
 set(key:string,value:V){const b=this.write(this.bucket(key));if(!b.has(key))this.count++;b.set(key,value);return this}
 delete(key:string){const i=this.bucket(key);if(!this.buckets[i].has(key))return false;this.write(i).delete(key);this.count--;return true}
 *keys(){for(const b of this.buckets)yield* b.keys()}
 *values(){for(const b of this.buckets)yield* b.values()}
}

import type { CanvasRect } from './contracts'

export type SpatialRecord = Readonly<{ id: string; bounds: CanvasRect }>

function intersects(a: CanvasRect, b: CanvasRect) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

function sameBounds(a: CanvasRect, b: CanvasRect) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function validBounds(bounds: CanvasRect) {
  return [bounds.x, bounds.y, bounds.width, bounds.height, bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite)
    && bounds.width >= 0 && bounds.height >= 0
}

/** A predictable, incrementally maintained broad-phase index for sparse, unbounded 2D boards. */
export class UniformGridSpatialIndex<T extends SpatialRecord> {
  readonly cellSize: number
  private records = new ShardedMap<T>()
  private recordCells = new ShardedMap<string[]>()
  private cells = new ShardedMap<Set<string>>()
  private overflow = new Set<string>()

  constructor(records: readonly T[] = [], cellSize = 512) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Spatial-index cell size must be positive')
    this.cellSize = cellSize
    this.reconcile(records)
  }

  get size() {
    return this.records.size
  }

  get cellCount() {
    return this.cells.size
  }

  get(id: string) {
    return this.records.get(id)
  }

  /** Isolated render snapshot. Unchanged cell sets are shared; edits copy only
   * touched sets so abandoned React renders cannot mutate the committed index. */
  fork(records: readonly T[]) {
    const next = new UniformGridSpatialIndex<T>([], this.cellSize)
    next.records = this.records.fork()
    next.recordCells = this.recordCells.fork()
    next.cells = this.cells.fork()
    next.overflow = new Set(this.overflow)
    next.reconcile(records)
    return next
  }

  /** Explicit edit batches bypass full reconcile and preserve the old snapshot. */
  forkChanges(changed:readonly T[],removed:readonly string[]=[]) {
    const next=new UniformGridSpatialIndex<T>([],this.cellSize)
    next.records=this.records.fork();next.recordCells=this.recordCells.fork();next.cells=this.cells.fork();next.overflow=new Set(this.overflow)
    for(const id of removed)next.remove(id)
    for(const record of changed)next.upsert(record)
    return next
  }
  get copiedEntries(){return this.records.copiedEntries+this.recordCells.copiedEntries+this.cells.copiedEntries}

  query(bounds: CanvasRect): T[] {
    if (!validBounds(bounds)) return []
    const found = new Map<string, T>()
    const range = this.cellRange(bounds, 16_384)
    // An enormous viewport or coordinate must not enumerate unbounded cells.
    // Scan the finite record membership without clamping the user's geometry.
    if (!range) return [...this.records.values()].filter(entry => !validBounds(entry.bounds) || intersects(entry.bounds, bounds))
    this.visitCellKeys(range, (key) => {
      for (const id of this.cells.get(key) || []) {
        const entry = this.records.get(id)
        if (entry && !found.has(id) && intersects(entry.bounds, bounds)) found.set(id, entry)
      }
    })
    for (const id of this.overflow) {
      const entry = this.records.get(id)
      if (entry && (!validBounds(entry.bounds) || intersects(entry.bounds, bounds))) found.set(id, entry)
    }
    return [...found.values()]
  }

  upsert(record: T) {
    const existing = this.records.get(record.id)
    this.records.set(record.id, record)
    if (existing && sameBounds(existing.bounds, record.bounds)) return
    if (existing) this.removeFromCells(record.id)
    const range = this.cellRange(record.bounds, 4_096)
    if (!range) { this.overflow.add(record.id); return }
    const keys: string[] = []
    this.visitCellKeys(range, (key) => {
      keys.push(key)
      const ids = this.cells.get(key)
      this.cells.set(key, new Set(ids).add(record.id))
    })
    this.recordCells.set(record.id, keys)
  }

  remove(id: string) {
    if (!this.records.delete(id)) return false
    this.removeFromCells(id)
    return true
  }

  reconcile(records: readonly T[]) {
    const retained = new Set<string>()
    for (const record of records) {
      retained.add(record.id)
      if(this.records.get(record.id)!==record)this.upsert(record)
    }
    for (const id of this.records.keys()) if (!retained.has(id)) this.remove(id)
  }

  private removeFromCells(id: string) {
    this.overflow.delete(id)
    for (const key of this.recordCells.get(id) || []) {
      const ids = new Set(this.cells.get(key))
      ids.delete(id)
      if (ids.size) this.cells.set(key, ids)
      else this.cells.delete(key)
    }
    this.recordCells.delete(id)
  }

  private cellRange(bounds: CanvasRect, limit: number) {
    if (!validBounds(bounds)) return undefined
    const left = Math.floor(bounds.x / this.cellSize)
    const top = Math.floor(bounds.y / this.cellSize)
    const right = Math.floor((bounds.x + Math.max(0, bounds.width)) / this.cellSize)
    const bottom = Math.floor((bounds.y + Math.max(0, bounds.height)) / this.cellSize)
    if (![left, top, right, bottom].every(Number.isSafeInteger)) return undefined
    const columns = right - left + 1, rows = bottom - top + 1
    if (columns > limit || rows > limit || columns * rows > limit) return undefined
    return { left, top, right, bottom }
  }

  private visitCellKeys({ left, top, right, bottom }: { left: number; top: number; right: number; bottom: number }, visit: (key: string) => void) {
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) visit(`${x}:${y}`)
    }
  }
}
