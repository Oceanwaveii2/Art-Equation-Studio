import type { CanvasSceneSnapshot } from './contracts'

/** Disposable live paint state. Canonical documents and history belong to the
 * host; this stream only delivers immutable scene projections to presenters. */
export class LiveCanvasScene {
  private value: CanvasSceneSnapshot
  private listeners = new Set<(scene: CanvasSceneSnapshot) => void>()
  revision = 0
  constructor(initial: CanvasSceneSnapshot) { this.value = initial }
  get current(): CanvasSceneSnapshot { return this.value }
  present(scene: CanvasSceneSnapshot) {
    if (scene === this.value) return false
    this.value = scene; this.revision++
    for (const listener of [...this.listeners]) listener(this.value)
    return true
  }
  subscribe(listener: (scene: CanvasSceneSnapshot) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
