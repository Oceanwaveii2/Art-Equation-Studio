import type { BoardNode } from '../model/project'
import { boardNodeVisualBounds } from './arrangement'

export type SnapRect = { x: number; y: number; width: number; height: number }
export type LayoutSnapGuide = { axis: 'x' | 'y'; value: number; kind: 'guide' | 'object' | 'grid' | 'gap'; targetId: string }
type Options = { zoom: number; ignoredIds?: readonly string[]; gridEnabled: boolean; objectEnabled: boolean; guideEnabled: boolean; gridSize: number; guides?: readonly { id: string; axis: 'x' | 'y'; position: number }[]; thresholdPx?: number; resizeHandle?: string; minWidth?: number; minHeight?: number }

/** One candidate solver for pointer commands. Distances are CSS pixels, not DPR pixels.
 * No quantization outside the acquire zone; numeric commands do not call this solver. */
export function solveLayoutSnap(rect: SnapRect, nodes: readonly BoardNode[], options: Options): SnapRect & { guides: LayoutSnapGuide[] } {
  const tolerance = (options.thresholdPx ?? 6) / Math.max(.01, options.zoom)
  const ignored = new Set(options.ignoredIds)
  const boxes = nodes.filter(n => !ignored.has(n.id) && !n.hidden && !n.layoutBackground).map(n => ({ id: n.id, bounds: boardNodeVisualBounds(n) }))
  const guides: LayoutSnapGuide[] = []
  const result = { ...rect, guides }
  for (const axis of ['x', 'y'] as const) {
    const origin = rect[axis], size = axis === 'x' ? rect.width : rect.height
    const start = axis === 'x' ? 'w' : 'n', end = axis === 'x' ? 'e' : 's'
    if (options.resizeHandle && !options.resizeHandle.includes(start) && !options.resizeHandle.includes(end)) continue
    let best: { delta: number; priority: number; guide: LayoutSnapGuide } | undefined
    const consider = (value: number, candidate: number, kind: LayoutSnapGuide['kind'], targetId: string, priority: number) => {
      const delta = value - candidate
      if (!Number.isFinite(delta) || Math.abs(delta) > tolerance) return
      if (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-8 || (Math.abs(Math.abs(delta) - Math.abs(best.delta)) < 1e-8 && (priority < best.priority || priority === best.priority && targetId < best.guide.targetId))) best = { delta, priority, guide: { axis, value, kind, targetId } }
    }
    const anchors = options.resizeHandle ? [options.resizeHandle.includes(start) ? origin : origin + size] : [origin, origin + size / 2, origin + size]
    if (options.guideEnabled) for (const guide of options.guides || []) if (guide.axis === axis) for (const candidate of anchors) consider(guide.position, candidate, 'guide', guide.id, 0)
    if (options.objectEnabled) {
      const low = axis === 'x' ? 'left' : 'top', high = axis === 'x' ? 'right' : 'bottom'
      const crossLow = axis === 'x' ? 'top' : 'left', crossHigh = axis === 'x' ? 'bottom' : 'right'
      for (const box of boxes) for (const value of [box.bounds[low], (box.bounds[low] + box.bounds[high]) / 2, box.bounds[high]]) for (const candidate of anchors) consider(value, candidate, 'object', box.id, 1)
      const nearby = options.resizeHandle ? [] : boxes.filter(box => box.bounds[crossHigh] >= rect[axis === 'x' ? 'y' : 'x'] && box.bounds[crossLow] <= rect[axis === 'x' ? 'y' : 'x'] + (axis === 'x' ? rect.height : rect.width)).sort((a, b) => a.bounds[low] - b.bounds[low])
      for (let i = 1; i < nearby.length; i++) {
        const a = nearby[i - 1], b = nearby[i], gap = b.bounds[low] - a.bounds[high]
        if (gap < 0) continue
        consider(b.bounds[high] + gap, origin, 'gap', a.id + ':' + b.id, 2)
        consider(a.bounds[low] - gap - size, origin, 'gap', a.id + ':' + b.id, 2)
        if (gap >= size) consider(a.bounds[high] + (gap - size) / 2, origin, 'gap', a.id + ':' + b.id, 2)
      }
    }
    if (options.gridEnabled && options.gridSize > 0) for (const candidate of options.resizeHandle ? anchors : [origin]) consider(Math.round(candidate / options.gridSize) * options.gridSize, candidate, 'grid', 'grid', 3)
    if (best) {
      const sizeKey = axis === 'x' ? 'width' : 'height'
      if (options.resizeHandle) {
        const newSize = size + (options.resizeHandle.includes(start) ? -best.delta : best.delta)
        if (newSize < (axis === 'x' ? options.minWidth ?? 1 : options.minHeight ?? 1)) continue
        if (options.resizeHandle.includes(start)) result[axis] = origin + best.delta
        result[sizeKey] = newSize
      } else result[axis] = origin + best.delta
      guides.push(best.guide)
    }
  }
  return result
}
