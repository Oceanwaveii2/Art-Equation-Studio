export type VectorPoint = {
  x: number
  y: number
  handleIn?: { x: number; y: number }
  handleOut?: { x: number; y: number }
}

export type VectorPathLike = { closed: boolean; points: VectorPoint[] }
export type VectorLodBand = 'exact' | 'near' | 'medium' | 'far'
export type VectorGeometry = Readonly<{
  canonicalData: string
  renderData: string
  hitData: string
  segmentData: readonly string[]
  segmentHitData: readonly string[]
  band: VectorLodBand
  estimatedBytes: number
}>

type BaseGeometry = { id: number; canonicalData: string; segmentData: string[] }
type CacheEntry = VectorGeometry & { key: string; used: number }

const round = (value: number) => Math.round(value * 1e4) / 1e4
const pointText = (point: { x: number; y: number }) => `${round(point.x)} ${round(point.y)}`
const add = (point: { x: number; y: number }, offset?: { x: number; y: number }) => ({ x: point.x + (offset?.x || 0), y: point.y + (offset?.y || 0) })

function segmentData(path: VectorPathLike, index: number) {
  const from = path.points[index]
  const nextIndex = index + 1 < path.points.length ? index + 1 : path.closed ? 0 : -1
  const to = path.points[nextIndex]
  if (!from || !to) return ''
  return from.handleOut || to.handleIn
    ? `M ${pointText(from)} C ${pointText(add(from, from.handleOut))} ${pointText(add(to, to.handleIn))} ${pointText(to)}`
    : `M ${pointText(from)} L ${pointText(to)}`
}

function exactPathData(path: VectorPathLike) {
  if (!path.points.length) return ''
  const segments = Array.from({ length: path.closed ? path.points.length : Math.max(0, path.points.length - 1) }, (_, index) => segmentData(path, index).replace(/^M [^CL]+ (?=[CL])/, ''))
  return `M ${pointText(path.points[0])}${segments.length ? ` ${segments.join(' ')}` : ''}${path.closed && path.points.length > 2 ? ' Z' : ''}`
}

function distanceToLine(point: VectorPoint, start: VectorPoint, end: VectorPoint) {
  const dx = end.x - start.x, dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  return length < 1e-8 ? Math.hypot(point.x - start.x, point.y - start.y) : Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length
}

function flattenCubic(p0: VectorPoint, p1: VectorPoint, p2: VectorPoint, p3: VectorPoint, tolerance: number, output: VectorPoint[], depth = 0) {
  if (depth >= 10 || Math.max(distanceToLine(p1, p0, p3), distanceToLine(p2, p0, p3)) <= tolerance) { output.push({ x: p3.x, y: p3.y }); return }
  const midpoint = (a: VectorPoint, b: VectorPoint): VectorPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const a = midpoint(p0, p1), b = midpoint(p1, p2), c = midpoint(p2, p3), d = midpoint(a, b), e = midpoint(b, c), m = midpoint(d, e)
  flattenCubic(p0, a, d, m, tolerance, output, depth + 1)
  flattenCubic(m, e, c, p3, tolerance, output, depth + 1)
}

function flattenedSegments(path: VectorPathLike, tolerance: number) {
  const count = path.closed ? path.points.length : Math.max(0, path.points.length - 1)
  return Array.from({ length: count }, (_, index) => {
    const from = path.points[index], to = path.points[index + 1 < path.points.length ? index + 1 : 0]
    const points: VectorPoint[] = [{ x: from.x, y: from.y }]
    if (from.handleOut || to.handleIn) flattenCubic(from, add(from, from.handleOut), add(to, to.handleIn), to, tolerance, points)
    else points.push({ x: to.x, y: to.y })
    return points
  })
}

function polylineData(points: VectorPoint[]) {
  if (!points.length) return ''
  return `M ${pointText(points[0])}${points.slice(1).map((point) => ` L ${pointText(point)}`).join('')}`
}

function combinedPolylineData(segments: VectorPoint[][], closed: boolean) {
  if (!segments.length) return ''
  return `${polylineData([segments[0][0], ...segments.flatMap((points) => points.slice(1))])}${closed ? ' Z' : ''}`
}

export function vectorLodBand(scale: number): VectorLodBand {
  if (scale >= 1) return 'exact'
  if (scale >= .5) return 'near'
  if (scale >= .25) return 'medium'
  return 'far'
}

const screenError: Record<VectorLodBand, number> = { exact: 0, near: .35, medium: .6, far: .85 }
// Use each band's upper zoom edge so projected error never exceeds its cap.
const bandScale: Record<VectorLodBand, number> = { exact: 1, near: 1, medium: .5, far: .25 }

/** Bounded, renderer-owned geometry. Canonical document points never depend on it. */
export class VectorGeometryCache {
  readonly byteLimit: number
  private identities = new WeakMap<object, BaseGeometry>()
  private entries = new Map<string, CacheEntry>()
  private nextId = 1
  private serial = 0
  private bytes = 0
  private builds = 0
  private hits = 0
  private evictions = 0
  constructor(byteLimit = 32 * 1024 * 1024) { this.byteLimit = byteLimit }

  get(path: VectorPathLike, scale: number, exact = false): VectorGeometry {
    let base = this.identities.get(path)
    if (!base) {
      const segmentCount = path.closed ? path.points.length : Math.max(0, path.points.length - 1)
      base = { id: this.nextId++, canonicalData: exactPathData(path), segmentData: Array.from({ length: segmentCount }, (_, index) => segmentData(path, index)) }
      this.identities.set(path, base)
    }
    const band = exact ? 'exact' : vectorLodBand(scale)
    const key = `${base.id}/${band}`
    const cached = this.entries.get(key)
    if (cached) { cached.used = ++this.serial; this.hits++; return cached }
    const renderTolerance = screenError[band] / bandScale[band]
    const renderSegments = band === 'exact' ? [] : flattenedSegments(path, renderTolerance)
    const hitSegments = flattenedSegments(path, Math.max(.25, .75 / Math.max(.18, scale)))
    const renderData = band === 'exact' ? base.canonicalData : combinedPolylineData(renderSegments, path.closed)
    const segmentHitData = hitSegments.map(polylineData)
    const hitData = combinedPolylineData(hitSegments, path.closed)
    const strings = [base.canonicalData, renderData, hitData, ...base.segmentData, ...segmentHitData]
    const estimatedBytes = strings.reduce((total, value) => total + value.length * 2, 0) + path.points.length * 64
    const entry: CacheEntry = { key, canonicalData: base.canonicalData, renderData, hitData, segmentData: base.segmentData, segmentHitData, band, estimatedBytes, used: ++this.serial }
    this.entries.set(key, entry); this.bytes += estimatedBytes; this.builds++; this.trim()
    return entry
  }

  clear() { this.identities = new WeakMap(); this.entries.clear(); this.bytes = 0 }
  snapshot() { return { bytes: this.bytes, limit: this.byteLimit, entries: this.entries.size, builds: this.builds, hits: this.hits, evictions: this.evictions } }
  private trim() {
    while (this.bytes > this.byteLimit && this.entries.size > 1) {
      let oldest: CacheEntry | undefined
      for (const entry of this.entries.values()) if (!oldest || entry.used < oldest.used) oldest = entry
      if (!oldest) break
      this.entries.delete(oldest.key); this.bytes -= oldest.estimatedBytes; this.evictions++
    }
  }
}

/** Appends an authored Pen segment in O(1); edits fall back to an exact rebuild. */
export class IncrementalPenPath {
  private points: readonly VectorPoint[] = []
  private data = ''
  private appends = 0
  private rebuilds = 0
  sync(points: readonly VectorPoint[]) {
    if (!points.length) { this.points = points; this.data = ''; return this.data }
    const appended = points.length === this.points.length + 1 && this.points.every((point, index) => point === points[index])
    if (appended) {
      this.data = this.points.length ? `${this.data} ${segmentData({ closed: false, points: points as VectorPoint[] }, points.length - 2).replace(/^M [^CL]+ (?=[CL])/, '')}` : `M ${pointText(points[0])}`
      this.appends++
    } else { this.data = exactPathData({ closed: false, points: points as VectorPoint[] }); this.rebuilds++ }
    this.points = points
    return this.data
  }
  snapshot() { return { appends: this.appends, rebuilds: this.rebuilds, points: this.points.length } }
}

export const vectorGeometryCache = new VectorGeometryCache()
