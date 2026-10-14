// Mirror Rust's MaxRects Best-Short-Side-Fit (BSSF) packing before allocating GPU pages.
export const ATLAS_EDGE = 4096
export const ATLAS_PAGE_RESERVE = 3 * ATLAS_EDGE * ATLAS_EDGE * 4
export const MAX_NATIVE_ATLAS_PAGES = 4

export interface FreeRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PackedSlot {
  x: number
  y: number
  width: number
  height: number
}

function rectsIntersect(a: FreeRect, b: FreeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function isContainedIn(a: FreeRect, b: FreeRect): boolean {
  return (
    a.x >= b.x &&
    a.y >= b.y &&
    a.x + a.width <= b.x + b.width &&
    a.y + a.height <= b.y + b.height
  )
}

export class MaxRectsBin {
  public freeRects: FreeRect[] = [{ x: 0, y: 0, width: ATLAS_EDGE, height: ATLAS_EDGE }]

  public insert(width: number, height: number): PackedSlot | null {
    let bestIndex = -1
    let bestShortSide = Infinity
    let bestLongSide = Infinity
    let bestY = Infinity
    let bestX = Infinity

    for (let i = 0; i < this.freeRects.length; i += 1) {
      const free = this.freeRects[i]
      if (free.width >= width && free.height >= height) {
        const leftoverH = free.width - width
        const leftoverV = free.height - height
        const shortSide = Math.min(leftoverH, leftoverV)
        const longSide = Math.max(leftoverH, leftoverV)
        if (
          shortSide < bestShortSide ||
          (shortSide === bestShortSide && longSide < bestLongSide) ||
          (shortSide === bestShortSide && longSide === bestLongSide && free.y < bestY) ||
          (shortSide === bestShortSide && longSide === bestLongSide && free.y === bestY && free.x < bestX)
        ) {
          bestIndex = i
          bestShortSide = shortSide
          bestLongSide = longSide
          bestY = free.y
          bestX = free.x
        }
      }
    }

    if (bestIndex === -1) return null

    const placed: FreeRect = {
      x: this.freeRects[bestIndex].x,
      y: this.freeRects[bestIndex].y,
      width,
      height,
    }

    const nextFree: FreeRect[] = []
    for (let i = 0; i < this.freeRects.length; i += 1) {
      const free = this.freeRects[i]
      if (!rectsIntersect(free, placed)) {
        nextFree.push(free)
        continue
      }
      if (placed.x > free.x) {
        nextFree.push({
          x: free.x,
          y: free.y,
          width: placed.x - free.x,
          height: free.height,
        })
      }
      if (placed.x + placed.width < free.x + free.width) {
        nextFree.push({
          x: placed.x + placed.width,
          y: free.y,
          width: free.x + free.width - (placed.x + placed.width),
          height: free.height,
        })
      }
      if (placed.y > free.y) {
        nextFree.push({
          x: free.x,
          y: free.y,
          width: free.width,
          height: placed.y - free.y,
        })
      }
      if (placed.y + placed.height < free.y + free.height) {
        nextFree.push({
          x: free.x,
          y: placed.y + placed.height,
          width: free.width,
          height: free.y + free.height - (placed.y + placed.height),
        })
      }
    }

    // Prune redundant contained free rectangles
    const pruned: FreeRect[] = []
    for (let i = 0; i < nextFree.length; i += 1) {
      let contained = false
      for (let j = 0; j < nextFree.length; j += 1) {
        if (i !== j && isContainedIn(nextFree[i], nextFree[j])) {
          if (
            nextFree[i].x !== nextFree[j].x ||
            nextFree[i].y !== nextFree[j].y ||
            nextFree[i].width !== nextFree[j].width ||
            nextFree[i].height !== nextFree[j].height ||
            i > j
          ) {
            contained = true
            break
          }
        }
      }
      if (!contained) pruned.push(nextFree[i])
    }
    this.freeRects = pruned

    // Return inner slot coordinates with 1px extruded border gutter
    return {
      x: placed.x + 1,
      y: placed.y + 1,
      width: width - 2,
      height: height - 2,
    }
  }
}

export function plannedAtlasPages(images: readonly { width: number; height: number }[]): number {
  if (!images.length) return 0
  let pages = 1
  let currentBin = new MaxRectsBin()

  for (const image of images) {
    const width = image.width + 2
    const height = image.height + 2
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 3 ||
      height < 3 ||
      width > ATLAS_EDGE ||
      height > ATLAS_EDGE
    ) {
      throw new Error('GPU_IMAGE_ATLAS_FULL: image exceeds fixed native page')
    }
    if (!currentBin.insert(width, height)) {
      if (++pages > MAX_NATIVE_ATLAS_PAGES) {
        throw new Error('GPU_IMAGE_ATLAS_FULL: native page budget exceeded')
      }
      currentBin = new MaxRectsBin()
      if (!currentBin.insert(width, height)) {
        throw new Error('GPU_IMAGE_ATLAS_FULL: image exceeds fixed native page')
      }
    }
  }
  return pages
}
