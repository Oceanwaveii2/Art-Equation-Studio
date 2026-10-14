export type FrameClock = {
  request: (callback: (timestamp: number) => void) => number
  cancel: (id: number) => void
}

export type FramePhase = 'idle' | 'interaction' | 'settle'

/** Host-neutral keyed work queue. Repeated invalidations share one animation frame. */
export class FrameScheduler {
  private readonly clock: FrameClock
  private readonly tasks = new Map<string, () => void>()
  private frame: number | null = null
  private running = false
  private interacting = false
  private disposed = false
  phase: FramePhase = 'idle'
  readonly metrics = { frames: 0, mergedTasks: 0, executedTasks: 0, settleFrames: 0 }

  constructor(clock: FrameClock) { this.clock = clock }

  get processingFrame() { return this.running }

  clear() {
    if (this.frame !== null) this.clock.cancel(this.frame)
    this.frame = null
    this.tasks.clear()
    this.interacting = false
    this.phase = 'idle'
  }

  schedule(key: string, task: () => void) {
    if (this.disposed) return
    if (this.tasks.has(key)) this.metrics.mergedTasks++
    this.tasks.set(key, task)
    this.request()
  }

  beginInteraction() { this.tasks.delete('settle'); this.interacting = true; this.phase = 'interaction' }

  settle(task?: () => void) {
    if (this.disposed) return
    this.interacting = false
    this.phase = 'settle'
    if (task) this.tasks.set('settle', task)
    this.request()
  }

  flush(key: string) {
    const task = this.tasks.get(key)
    if (!task) return
    this.tasks.delete(key)
    this.metrics.executedTasks++
    task()
  }

  cancel(key: string) {
    this.tasks.delete(key)
    if (!this.tasks.size && this.phase !== 'settle' && this.frame !== null) {
      this.clock.cancel(this.frame)
      this.frame = null
    }
  }

  dispose() {
    this.disposed = true
    this.clear()
  }

  private request() {
    if (this.frame !== null || this.running) return
    this.frame = this.clock.request(() => {
      this.frame = null
      this.running = true
      this.metrics.frames++
      const settling = this.phase === 'settle'
      if (settling) this.metrics.settleFrames++
      // Snapshot keys, then delete before executing: tasks can safely cancel or
      // enqueue other work. A key runs at most once in an animation frame.
      try {
        for (const key of [...this.tasks.keys()]) this.flush(key)
      } finally {
        this.running = false
        this.phase = this.interacting ? 'interaction' : this.tasks.size ? 'settle' : 'idle'
        if (this.tasks.size) this.request()
      }
    })
  }
}

/** Keeps ordered samples with fixed memory; overload drops the oldest samples. */
export class SampleRing<T> {
  readonly capacity: number
  private readonly values: Array<T | undefined>
  private head = 0
  size = 0
  dropped = 0

  constructor(capacity = 64) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Sample capacity must be a positive integer')
    this.capacity = capacity
    this.values = new Array(capacity)
  }

  push(value: T) {
    if (this.size === this.capacity) {
      this.values[this.head] = value
      this.head = (this.head + 1) % this.capacity
      this.dropped++
    } else {
      this.values[(this.head + this.size++) % this.capacity] = value
    }
  }

  drain(): T[] {
    const values: T[] = []
    while (this.size) {
      values.push(this.values[this.head]!)
      this.values[this.head] = undefined
      this.head = (this.head + 1) % this.capacity
      this.size--
    }
    return values
  }
}
