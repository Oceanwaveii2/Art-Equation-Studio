import type { BoardPoint } from '../model/project'
import type { FrameClock } from '../canvas-engine/frameScheduler'

export type StrokeBounds = { minX: number; minY: number; maxX: number; maxY: number }

/** Disposable gesture paint, never document state. Commands are encoded once
 * per accepted point; a coalesced input batch publishes only once per frame.
 * The canonical ordered samples stay with the gesture for fitting/erasure. */
export class StrokePreview {
  private commands: string[] = []
  private rawPoints: BoardPoint[] = []
  private pending: number | null = null
  private generation = 0
  private dirtyBounds: StrokeBounds | null = null
  readonly metrics = { samples: 0, frames: 0, cleared: 0 }
  private clock: FrameClock
  private paint: (path: string) => void

  constructor(clock: FrameClock, paint: (path: string) => void) {
    this.clock = clock
    this.paint = paint
  }

  get bounds(): StrokeBounds | null {
    return this.dirtyBounds ? { ...this.dirtyBounds } : null
  }

  get points(): readonly BoardPoint[] {
    return this.rawPoints
  }

  begin(point: BoardPoint) {
    this.clear()
    this.rawPoints.push({ x: point.x, y: point.y })
    this.commands.push(`M ${point.x} ${point.y}`)
    this.dirtyBounds = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
    this.metrics.samples++
    this.schedule()
  }

  append(point: BoardPoint) {
    if (!this.commands.length) return
    this.rawPoints.push({ x: point.x, y: point.y })
    this.commands.push(`L ${point.x} ${point.y}`)
    if (this.dirtyBounds) {
      this.dirtyBounds.minX = Math.min(this.dirtyBounds.minX, point.x)
      this.dirtyBounds.minY = Math.min(this.dirtyBounds.minY, point.y)
      this.dirtyBounds.maxX = Math.max(this.dirtyBounds.maxX, point.x)
      this.dirtyBounds.maxY = Math.max(this.dirtyBounds.maxY, point.y)
    }
    this.metrics.samples++
    this.schedule()
  }

  /** Produce a smoothed quadratic Bézier path using consecutive midpoint interpolation
   * for ink rendering that matches pen curve dynamics. */
  toSmoothPath(): string {
    const pts = this.rawPoints
    if (pts.length <= 2) return this.commands.join(' ')
    const parts = [`M ${pts[0].x} ${pts[0].y}`]
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2
      const midY = (pts[i].y + pts[i + 1].y) / 2
      parts.push(`Q ${pts[i].x} ${pts[i].y} ${midX} ${midY}`)
    }
    const last = pts.at(-1)!
    parts.push(`L ${last.x} ${last.y}`)
    return parts.join(' ')
  }

  private schedule() {
    if (this.pending !== null) return
    const generation = this.generation
    this.pending = this.clock.request(() => {
      if (generation !== this.generation) return
      this.pending = null
      this.metrics.frames++
      this.paint(this.commands.join(' '))
    })
  }

  clear() {
    this.generation++
    if (this.pending !== null) this.clock.cancel(this.pending)
    this.pending = null
    this.commands.length = 0
    this.rawPoints.length = 0
    this.dirtyBounds = null
    this.metrics.cleared++
    this.paint('')
  }
}
