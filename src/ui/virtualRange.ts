/** Variable row heights are measured once by ResizeObserver, keyed by stable ID. */
export function virtualRange(heights: readonly number[], top: number, viewport: number, overscan = 4) {
  const offsets = [0]
  for (const height of heights) offsets.push(offsets.at(-1)! + Math.max(1, height))
  let first = 0, last = heights.length
  const search = (value: number) => {
    let lo = 0, hi = heights.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (offsets[mid + 1] < value) lo = mid + 1; else hi = mid }
    return lo
  }
  first = Math.max(0, search(Math.max(0, top)) - overscan)
  last = Math.min(heights.length, search(Math.max(0, top) + Math.max(1, viewport)) + overscan + 1)
  return { first, last, offsets, total: offsets.at(-1)! }
}
