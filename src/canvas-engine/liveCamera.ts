import type { CanvasViewport } from './contracts'

/** Live presentation state, independent of React and persisted documents.
 * Hosts present this snapshot directly; document/history updates happen at commit. */
export class LiveCamera {
  private value: CanvasViewport
  private listeners = new Set<(viewport: CanvasViewport) => void>()
  revision = 0
  constructor(initial: CanvasViewport) { this.value = { ...initial } }
  get current(): CanvasViewport { return this.value }
  present(viewport: CanvasViewport) {
    if (![viewport.x, viewport.y, viewport.scale].every(Number.isFinite) || viewport.scale <= 0) throw new Error('Invalid camera transform')
    if (viewport.x === this.value.x && viewport.y === this.value.y && viewport.scale === this.value.scale) return false
    this.value = { ...viewport }; this.revision++
    for (const listener of [...this.listeners]) listener(this.value)
    return true
  }
  subscribe(listener: (viewport: CanvasViewport) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
