export type RetainedMode = 'dom' | 'raster' | 'retained' | 'vello'

/** Explicit rollout flags; the existing compositor remains the release default
 * until the retained paths pass their visual and performance gates. A GPU
 * build can flip the default via VITE_DEFAULT_CANVAS_RENDERER=retained; an
 * explicit ?canvas-renderer= parameter always wins. */
export function retainedMode(search = window.location.search): RetainedMode {
  const mode = new URLSearchParams(search).get('canvas-renderer')
  if (mode === 'raster' || mode === 'retained' || mode === 'vello' || mode === 'dom') return mode
  if (import.meta.env.VITE_DEFAULT_CANVAS_RENDERER === 'vello') return 'vello'
  return import.meta.env.VITE_DEFAULT_CANVAS_RENDERER === 'retained' ? 'retained' : 'dom'
}
