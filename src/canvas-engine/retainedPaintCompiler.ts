import { canvasResourceBudget, type CanvasResourceLease, type CanvasResourceBudget } from './resourceBudget'
import type { CanvasRect } from './contracts'
import type { VectorPaintRecord,PaintOperation,PreparedPaintDisplayList } from './paintDisplayList'

type Source = { id: string; order: number; bounds: CanvasRect }
type Fragment<T> = { source: T; variant: number; json: string; operation:PaintOperation; token: number; lease: CanvasResourceLease }

/** Rebuildable display derivatives, never document state or GPU handles. Object
 * projections are immutable: replacement identity invalidates even if revision
 * bookkeeping was missed. Camera translation is deliberately absent. */
export class RetainedPaintCompiler<T extends Source> {
  private fragments = new Map<string, Fragment<T>>()
  private sceneId = ''
  private frame?: { key: string; json: string; lease: CanvasResourceLease }
  private previous = new Map<string, CanvasRect>()
  private builds = 0
  private hits = 0
  private budget: CanvasResourceBudget
  constructor(budget: CanvasResourceBudget = canvasResourceBudget) { this.budget = budget }
  compile(sceneId: string, revision: string, sources: readonly T[], variant: (source: T) => number,
    build: (source: T) => VectorPaintRecord) {
    const sceneChanged = this.sceneId !== sceneId
    if (sceneChanged) { this.clear(); this.sceneId = sceneId }
    const ids = new Set<string>(), changed: CanvasRect[] = [], parts: string[] = [], operations:PaintOperation[]=[], tokens: number[] = []
    const ordered = sources.map((source, index) => ({ source, index }))
      .sort((a, b) => a.source.order - b.source.order || a.index - b.index)
    for (const { source } of ordered) {
      if (!source.id || ids.has(source.id) || !Number.isFinite(source.order)) throw new Error('DISPLAY_LIST_INVALID: duplicate identity or invalid order')
      ids.add(source.id)
      const scale = variant(source)
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('DISPLAY_LIST_INVALID: invalid physical scale variant')
      let entry = this.fragments.get(source.id)
      if (entry?.source === source && entry.variant === scale) { entry.lease.touch(); this.hits++ }
      else {
        const old = this.previous.get(source.id)
        if (old) changed.push({ ...old })
        changed.push({ ...source.bounds })
        entry?.lease.release(); this.fragments.delete(source.id)
        const operation:PaintOperation={type:'vector',object:build(source)}
        const json = JSON.stringify(operation)
        const token = ++this.builds
        const lease = this.budget.acquire({ owner: this, key: source.id, pool: 'retained', bytes: json.length * 2,
          priority: 2, evict: () => { this.fragments.delete(source.id); this.releaseFrame() } })
        entry = lease ? { source, variant: scale, json, operation, token, lease } : undefined
        if (entry) this.fragments.set(source.id, entry)
        if (!entry) { parts.push(json); operations.push(operation);tokens.push(token) }
      }
      if (entry) { parts.push(entry.json);operations.push(entry.operation); tokens.push(entry.token) }
    }
    for (const [id, entry] of this.fragments) if (!ids.has(id)) { entry.lease.release(); this.fragments.delete(id) }
    for (const [id, bounds] of this.previous) if (!ids.has(id)) changed.push({ ...bounds })
    this.previous = new Map(sources.map(source => [source.id, { ...source.bounds }]))
    // Full target rendering remains the pixel oracle. Damage records authorize
    // preparation reuse only; effects/clips are not silently scissored here.
    // Frame identity is derived paint, not the enclosing camera/document generation.
    // Immutable source/variant tokens change whenever paint changes.
    const key = JSON.stringify([sceneId, tokens])
    let json: string
    if (this.frame?.key === key) { this.frame.lease.touch(); json = this.frame.json }
    else {
      this.releaseFrame()
      json = `{"schema":"art-equation.display-list","schemaVersion":2,"sceneId":${JSON.stringify(sceneId)},"revision":${JSON.stringify(revision)},"environment":{"background":"#00000000","colorSpace":"srgb"},"resources":[],"operations":[${parts.join(',')}]}`
      const lease = this.budget.acquire({ owner: this, key: 'frame', pool: 'retained', bytes: (key.length + json.length) * 2,
        priority: 1, evict: () => { this.frame = undefined } })
      if (lease) this.frame = { key, json, lease }
    }
    const displayList:PreparedPaintDisplayList={schema:'art-equation.display-list',schemaVersion:2,sceneId,revision,environment:{background:'#00000000',colorSpace:'srgb'},resources:[],operations}
    return { ids, json, displayList, damage: { sceneChanged, gpuFullRedraw: true, world: changed }, stats: { builds: this.builds, hits: this.hits, retained: this.fragments.size } }
  }
  private releaseFrame() { this.frame?.lease.release(); this.frame = undefined }
  clear() {
    this.releaseFrame()
    for (const entry of this.fragments.values()) entry.lease.release()
    this.fragments.clear(); this.previous.clear(); this.sceneId = ''
  }
}
