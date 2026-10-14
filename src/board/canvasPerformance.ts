import { requestAppFrame, cancelAppFrame } from '../canvas-engine/appFrameClock'
/** Local, bounded browser diagnostics. Frame intervals are not GPU execution timings. */
export function observeCanvasPerformance(stage: HTMLElement) {
  const frames: number[] = []
  const gestures: number[] = []
  let previous = 0
  let published = 0
  let request = 0
  let longTasks = 0
  let longestTask = 0
  const summarize = (samples: number[]) => {
    const sorted = [...samples].sort((a, b) => a - b)
    return { samples: sorted.length, medianMs: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(2) : 0, p95Ms: sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))].toFixed(2) : 0, over33Ms: sorted.filter((value) => value > 33.4).length }
  }
  const push = (samples: number[], value: number) => { samples.push(value); if (samples.length > 240) samples.shift() }
  const observer = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask') ? new PerformanceObserver((entries) => {
    for (const entry of entries.getEntries()) { longTasks++; longestTask = Math.max(longestTask, entry.duration) }
  }) : null
  observer?.observe({ type: 'longtask', buffered: false })
  const tick = (now: number) => {
    if (document.visibilityState === 'visible') {
      if (previous) {
        push(frames, now - previous)
        if (stage.dataset.gesturePreview === 'true' || stage.dataset.activeTransform) push(gestures, now - previous)
      }
      if (now - published >= 1000) {
        stage.dataset.canvasPerformance = JSON.stringify({ boardFrames: summarize(frames), gestureFrames: summarize(gestures), longTasks, longestTaskMs: +longestTask.toFixed(2), nodes: Number(stage.dataset.totalNodes), renderer: stage.dataset.canvasRenderer, viewport: { width: stage.clientWidth, height: stage.clientHeight }, devicePixelRatio: window.devicePixelRatio })
        published = now
      }
      previous = now
    } else previous = 0
    request = requestAppFrame(tick)
  }
  request = requestAppFrame(tick)
  return () => { cancelAppFrame(request); observer?.disconnect(); delete stage.dataset.canvasPerformance }
}
