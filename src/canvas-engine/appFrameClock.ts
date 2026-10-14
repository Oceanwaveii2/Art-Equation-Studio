import type { FrameClock } from './frameScheduler'
export type AppFramePhase = 'input' | 'update' | 'present' | 'after'
const phases: AppFramePhase[] = ['input', 'update', 'present', 'after']
/** One browser rAF per realm, not one per canvas/viewer. Work scheduled into a
 * later phase joins this frame; same/earlier phase waits until the next frame. */
export class AppFrameClock {
  private queues = new Map<AppFramePhase, Map<number, (time: number) => void>>(phases.map(phase => [phase, new Map()]))
  private next = 1
  private frame: number | null = null
  private running = false
  readonly metrics = { frames: 0, callbacks: 0 }
  private clock: FrameClock
  private onError: (error: unknown) => void
  constructor(clock: FrameClock, onError: (error: unknown) => void = error => { throw error }) { this.clock = clock; this.onError = onError }
  request = (callback: (time: number) => void, phase: AppFramePhase = 'present') => {
    const id = this.next++; this.queues.get(phase)!.set(id, callback); this.wake(); return id
  }
  cancel = (id: number) => {
    for (const queue of this.queues.values()) queue.delete(id)
    if (!this.running && !this.pending && this.frame !== null) { this.clock.cancel(this.frame); this.frame = null }
  }
  get pending() { return [...this.queues.values()].reduce((sum, queue) => sum + queue.size, 0) }
  private wake() {
    if (this.frame !== null || this.running || !this.pending) return
    this.frame = this.clock.request(time => {
      this.frame = null; this.running = true; this.metrics.frames++
      const errors: unknown[] = []
      try {
        for (const phase of phases) {
          const queue = this.queues.get(phase)!
          for (const id of [...queue.keys()]) {
            const callback = queue.get(id); if (!callback) continue
            queue.delete(id); this.metrics.callbacks++
            try { callback(time) } catch (error) { errors.push(error) }
          }
        }
      } finally { this.running = false; this.wake() }
      errors.forEach(this.onError)
    })
  }
}
let shared: AppFrameClock | undefined
function sharedClock() {
  return shared ??= new AppFrameClock({ request: callback => window.requestAnimationFrame(callback), cancel: id => window.cancelAnimationFrame(id) }, error => {
    // A failed viewer must not prevent other canvases and cleanup from running.
    window.setTimeout(() => { throw error }, 0)
  })
}
export const requestAppFrame = (callback: (time: number) => void) => sharedClock().request(callback, 'present')
export const cancelAppFrame = (id: number) => sharedClock().cancel(id)
export const appInputClock: FrameClock = { request: callback => sharedClock().request(callback, 'input'), cancel: cancelAppFrame }
export const appUpdateClock: FrameClock = { request: callback => sharedClock().request(callback, 'update'), cancel: cancelAppFrame }
