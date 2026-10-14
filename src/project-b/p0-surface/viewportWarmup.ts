/** Actual viewport-session preparation, independent of native helper devices. */
let snapshot: Readonly<{ pending: number; ready: number; failed: number }> = Object.freeze({ pending: 0, ready: 0, failed: 0 })
const listeners = new Set<() => void>()
export const viewportWarmup = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  begin() {
    snapshot = Object.freeze({ ...snapshot, pending: snapshot.pending + 1 })
    for (const listener of listeners) listener()
    let finished = false
    return (success: boolean) => {
      if (finished) return
      finished = true
      snapshot = Object.freeze({ pending: snapshot.pending - 1, ready: snapshot.ready + Number(success), failed: snapshot.failed + Number(!success) })
      for (const listener of listeners) listener()
    }
  },
}
