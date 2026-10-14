import { FrameScheduler, SampleRing } from '../canvas-engine/frameScheduler'

export type PointerSample = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'pressure' | 'timeStamp' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>
export type InputMetrics = { received: number; coalesced: number; merged: number; dropped: number; applied: number; maxPending: number; cancelled: number; completed: number }
export function createInputMetrics(): InputMetrics {
  return { received: 0, coalesced: 0, merged: 0, dropped: 0, applied: 0, maxPending: 0, cancelled: 0, completed: 0 }
}

/** Absolute-position tools consume the newest sample once per frame. Stroke
 * consumers can preserve every ordered/coalesced sample retained by the ring.
 * Stroke overload cancels rather than committing a silently truncated trace;
 * latest-position tools can still merge/drop older samples safely. */
export function scheduledPointerGesture(options: {
  initial: { clientX: number; clientY: number; pointerId?: number }
  captureTarget: EventTarget
  scheduler: FrameScheduler
  metrics: InputMetrics
  move: (sample: PointerSample) => void
  finish: (sample: PointerSample) => void
  cancel: () => void
  changed: () => void
  preserveSamples?: boolean
}) {
  const { scheduler, metrics } = options
  const ring = new SampleRing<PointerSample>(64)
  let closed = false
  let pointerId = options.initial.pointerId
  let latest = options.initial
  let receivedPosition = options.initial
  const matches = (event: PointerEvent) => pointerId === undefined || event.pointerId === pointerId
  const copy = (event: PointerEvent): PointerSample => ({ pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, pressure: event.pressure, timeStamp: event.timeStamp, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })
  const apply = () => {
    const samples = ring.drain()
    if (!samples.length || closed) return
    if (options.preserveSamples) {
      for (const sample of samples) {
        if (closed) break
        latest = sample; metrics.applied++
        options.move(sample)
      }
    } else {
      metrics.merged += samples.length - 1
      latest = samples[samples.length - 1]
      metrics.applied++
      options.move(latest as PointerSample)
    }
    options.changed()
  }
  const queue = (event: PointerEvent) => {
    if (closed) return
    const droppedBefore = ring.dropped
    ring.push(copy(event))
    metrics.received++
    metrics.dropped += ring.dropped - droppedBefore
    metrics.maxPending = Math.max(metrics.maxPending, ring.size)
    if (options.preserveSamples && ring.dropped > droppedBefore) cancel()
  }
  const move = (event: PointerEvent) => {
    if (!matches(event) || closed) return
    pointerId ??= event.pointerId
    receivedPosition = event
    const samples = event.getCoalescedEvents?.() || []
    metrics.coalesced += samples.length
    if (samples.length) for (const sample of samples) queue(sample)
    // Always retain the dispatch position, including final modifiers.
    queue(event)
    if (!closed) scheduler.schedule('pointer', apply)
  }
  const finish = (event: PointerEvent) => {
    if (!matches(event) || closed) return
    if (event.clientX !== receivedPosition.clientX || event.clientY !== receivedPosition.clientY) {
      queue(event)
      if (closed) return
      scheduler.schedule('pointer', apply)
    }
    // Releasing a modifier immediately before pointer-up must not undo the
    // last snapped preview when the pointer itself has not moved.
    scheduler.flush('pointer')
    metrics.completed++
    dispose()
    options.finish(copy(event))
  }
  const cancel = () => {
    if (closed) return
    metrics.cancelled++
    dispose()
    options.cancel()
  }
  const pointerCancel = (event: Event) => { if (matches(event as PointerEvent)) cancel() }
  const visibility = () => { if (document.hidden) cancel() }
  function dispose() {
    if (closed) return
    closed = true
    scheduler.cancel('pointer')
    ring.drain()
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', pointerCancel)
    window.removeEventListener('blur', cancel)
    document.removeEventListener('visibilitychange', visibility)
    options.captureTarget.removeEventListener('lostpointercapture', pointerCancel)
    scheduler.settle(options.changed)
  }
  scheduler.beginInteraction()
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', pointerCancel)
  window.addEventListener('blur', cancel)
  document.addEventListener('visibilitychange', visibility)
  options.captureTarget.addEventListener('lostpointercapture', pointerCancel)
  return dispose
}
