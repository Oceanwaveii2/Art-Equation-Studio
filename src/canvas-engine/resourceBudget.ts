export type CanvasResourcePool = 'tile-atlas' | 'tile-surface' | 'retained'
export type CanvasResourceLimits = Readonly<{ total: number; pools: Readonly<Record<CanvasResourcePool, number>> }>
export type CanvasResourceSnapshot = Readonly<{
  version: number
  bytes: number
  limit: number
  allocations: number
  evictions: number
  denied: number
  callbackErrors: number
  pools: Readonly<Record<CanvasResourcePool, Readonly<{ bytes: number; limit: number; allocations: number }>>>
}>

export type CanvasResourceRequest = {
  owner: object
  key: string
  pool: CanvasResourcePool
  bytes: number
  /** Active/visible resources are pinned. Only idle rebuildable entries may be evicted. */
  pinned?: boolean
  /** Larger values survive before smaller values. */
  priority?: number
  evict?: () => void
}

type RecordEntry = CanvasResourceRequest & { id: number; used: number; released: boolean }

export type CanvasResourceLease = {
  readonly key: string
  readonly pool: CanvasResourcePool
  readonly bytes: number
  touch(): void
  setPinned(pinned: boolean): void
  resize(bytes: number): boolean
  release(): void
}

export const DEFAULT_CANVAS_RESOURCE_LIMITS: CanvasResourceLimits = {
  // Estimated renderer-owned bytes. Browser compositor/driver allocations remain unavailable.
  total: 512 * 1024 * 1024,
  pools: { 'tile-atlas': 256 * 1024 * 1024, 'tile-surface': 128 * 1024 * 1024, retained: 128 * 1024 * 1024 },
}

/** Shared accounting and deterministic LRU eviction for rebuildable canvas resources. */
export class CanvasResourceBudget {
  readonly limits: CanvasResourceLimits
  private records = new Map<number, RecordEntry>()
  private listeners = new Set<() => void>()
  private serial = 0
  private nextId = 1
  private version = 0
  private evictions = 0
  private denied = 0
  private callbackErrors = 0
  private callbacks: (() => void)[] = []
  private notifying = false
  private notificationPending = false
  constructor(limits: CanvasResourceLimits = DEFAULT_CANVAS_RESOURCE_LIMITS) {
    const total = normalizedBytes(limits.total)
    const pools = Object.fromEntries(RESOURCE_POOLS.map(pool => [pool, normalizedBytes(limits.pools[pool])])) as Record<CanvasResourcePool, number>
    this.limits = Object.freeze({ total, pools: Object.freeze(pools) })
  }

  acquire(request: CanvasResourceRequest): CanvasResourceLease | undefined {
    const bytes = normalizedBytes(request.bytes)
    if (!RESOURCE_POOLS.includes(request.pool)) throw new Error('Unknown canvas resource pool')
    if (request.priority !== undefined && !Number.isFinite(request.priority)) throw new Error('Canvas resource priority must be finite')
    const victims = this.planRoom(request.pool, bytes)
    if (!victims) { this.denied++; this.changed(); return }
    const entry: RecordEntry = { ...request, bytes, id: this.nextId++, used: ++this.serial, released: false }
    // Commit the replacement before invoking disposal or subscription callbacks.
    // Those callbacks may re-enter the budget, so no half-reserved state leaks.
    for (const victim of victims) this.detach(victim, true)
    this.records.set(entry.id, entry)
    const lease: CanvasResourceLease = {
      key: entry.key,
      pool: entry.pool,
      get bytes() { return entry.bytes },
      touch: () => { if (!entry.released) entry.used = ++this.serial },
      setPinned: pinned => { if (!entry.released) { entry.pinned = pinned; entry.used = ++this.serial; this.changed() } },
      resize: value => {
        if (entry.released) return false
        const next = normalizedBytes(value), growth = Math.max(0, next - entry.bytes)
        const victims = growth ? this.planRoom(entry.pool, growth, entry.id) : []
        if (!victims) { this.denied++; this.changed(); return false }
        for (const victim of victims) this.detach(victim, true)
        entry.bytes = next; entry.used = ++this.serial; this.changed(); return true
      },
      release: () => this.release(entry, false),
    }
    this.changed()
    return lease
  }

  releaseOwner(owner: object) {
    const entries = [...this.records.values()].filter(entry => entry.owner === owner)
    for (const entry of entries) this.detach(entry, false)
    if (entries.length) this.changed()
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  snapshot(): CanvasResourceSnapshot {
    const pools = Object.fromEntries((Object.keys(this.limits.pools) as CanvasResourcePool[]).map(pool => {
      const entries = [...this.records.values()].filter(entry => entry.pool === pool)
      return [pool, { bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), limit: this.limits.pools[pool], allocations: entries.length }]
    })) as CanvasResourceSnapshot['pools']
    return { version: this.version, bytes: Object.values(pools).reduce((sum, pool) => sum + pool.bytes, 0), limit: this.limits.total, allocations: this.records.size, evictions: this.evictions, denied: this.denied, callbackErrors: this.callbackErrors, pools }
  }

  private planRoom(pool: CanvasResourcePool, bytes: number, excludedId?: number): RecordEntry[] | undefined {
    if (bytes > this.limits.total || bytes > this.limits.pools[pool]) return
    let total = 0, pooled = 0
    for (const entry of this.records.values()) { total += entry.bytes; if (entry.pool === pool) pooled += entry.bytes }
    const victims: RecordEntry[] = []
    const candidates = [...this.records.values()]
      .filter(entry => entry.id !== excludedId && !entry.pinned)
      .sort((a, b) => (a.priority || 0) - (b.priority || 0) || a.used - b.used || a.id - b.id)
    // Pool-only pressure cannot be relieved by destroying another pool. Satisfy
    // this constraint first, then apply global LRU only if total pressure remains.
    for (const victim of candidates) {
      if (pooled + bytes <= this.limits.pools[pool]) break
      if (victim.pool !== pool || victim.bytes === 0) continue
      victims.push(victim); total -= victim.bytes; pooled -= victim.bytes
    }
    if (pooled + bytes > this.limits.pools[pool]) return
    const selected = new Set(victims)
    for (const victim of candidates) {
      if (total + bytes <= this.limits.total) break
      if (selected.has(victim) || victim.bytes === 0) continue
      victims.push(victim); total -= victim.bytes
    }
    if (total + bytes > this.limits.total) return
    return victims
  }

  private release(entry: RecordEntry, evicted: boolean) {
    if (entry.released) return
    this.detach(entry, evicted)
    this.changed()
  }

  private detach(entry: RecordEntry, evicted: boolean) {
    entry.released = true; this.records.delete(entry.id)
    if (evicted) { this.evictions++; if (entry.evict) this.callbacks.push(entry.evict) }
  }

  private changed() {
    this.version++; this.notificationPending = true
    if (this.notifying) return
    this.notifying = true
    const invoke = (callback: () => void) => {
      try { callback() }
      catch (error) {
        // A disposal/listener failure cannot lose an already committed lease or
        // prevent the remaining resources from being retired. Keep it observable.
        this.callbackErrors++
        console.error('Canvas resource callback failed', error)
      }
    }
    try {
      while (this.callbacks.length || this.notificationPending) {
        const callbacks = this.callbacks; this.callbacks = []
        for (const callback of callbacks) invoke(callback)
        if (this.notificationPending) {
          this.notificationPending = false
          for (const listener of [...this.listeners]) invoke(listener)
        }
      }
    } finally { this.notifying = false }
  }
}

const RESOURCE_POOLS: CanvasResourcePool[] = ['tile-atlas', 'tile-surface', 'retained']

function normalizedBytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Canvas resource bytes must be a non-negative safe integer')
  return value
}

export const canvasResourceBudget = new CanvasResourceBudget()
