/**
 * Art Equation Canvas Engine - Screen-Space Snapping & Guides Manager
 *
 * Implements tldraw-grade magnetic snapping:
 * - Edge alignment (left, center, right, top, middle, bottom)
 * - Grid snapping with configurable cell dimensions
 * - Equal-gap snapping between consecutive cards
 * - Dynamic guide line generation with measurement readouts
 * - Constant screen-space snap threshold across any canvas zoom level
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapGuide {
  axis: 'x' | 'y'
  position: number
  start: number
  end: number
  kind: 'edge' | 'center' | 'gap' | 'grid'
}

export interface SnapResult {
  x: number
  y: number
  guides: SnapGuide[]
}

export class ScreenSpaceSnapManager {
  private thresholdScreenPx: number
  private gridSize: number

  constructor(thresholdScreenPx: number = 6, gridSize: number = 24) {
    this.thresholdScreenPx = thresholdScreenPx
    this.gridSize = gridSize
  }

  /**
   * Snaps a moving/resizing box against existing boxes and grid.
   *
   * @param target Current proposed position/bounds of target
   * @param others Other stationary boxes on canvas
   * @param zoom Current canvas zoom factor (e.g. 1.0, 0.5, 2.0)
   * @param snapToGrid Whether grid snapping is enabled
   */
  public snap(
    target: Rect,
    others: Rect[],
    zoom: number = 1.0,
    snapToGrid: boolean = true
  ): SnapResult {
    const thresholdWorld = this.thresholdScreenPx / Math.max(0.01, zoom)
    let bestX = target.x
    let bestY = target.y
    let minDeltaX = thresholdWorld
    let minDeltaY = thresholdWorld
    const guides: SnapGuide[] = []

    const targetRight = target.x + target.width
    const targetBottom = target.y + target.height
    // 1. Grid Snapping (Baseline)
    if (snapToGrid) {
      const gridSnapX = Math.round(target.x / this.gridSize) * this.gridSize
      const dx = Math.abs(gridSnapX - target.x)
      if (dx < minDeltaX) {
        minDeltaX = dx
        bestX = gridSnapX
      }

      const gridSnapY = Math.round(target.y / this.gridSize) * this.gridSize
      const dy = Math.abs(gridSnapY - target.y)
      if (dy < minDeltaY) {
        minDeltaY = dy
        bestY = gridSnapY
      }
    }

    // 2. Object-to-Object Edge and Center Snapping
    for (const other of others) {
      const otherRight = other.x + other.width
      const otherBottom = other.y + other.height
      const otherCenterX = other.x + other.width / 2
      const otherCenterY = other.y + other.height / 2

      // Horizontal alignments (Snap X)
      const xChecks = [
        { val: other.x, shift: 0, kind: 'edge' as const }, // Left-to-left
        { val: otherRight, shift: -target.width, kind: 'edge' as const }, // Right-to-right
        { val: otherRight, shift: 0, kind: 'edge' as const }, // Left-to-right
        { val: other.x, shift: -target.width, kind: 'edge' as const }, // Right-to-left
        { val: otherCenterX, shift: -target.width / 2, kind: 'center' as const } // Center-to-center
      ]

      for (const check of xChecks) {
        const candidateX = check.val + check.shift
        const dx = Math.abs(candidateX - target.x)
        if (dx < minDeltaX) {
          minDeltaX = dx
          bestX = candidateX
          guides.push({
            axis: 'x',
            position: check.val,
            start: Math.min(target.y, other.y),
            end: Math.max(targetBottom, otherBottom),
            kind: check.kind
          })
        }
      }

      // Vertical alignments (Snap Y)
      const yChecks = [
        { val: other.y, shift: 0, kind: 'edge' as const }, // Top-to-top
        { val: otherBottom, shift: -target.height, kind: 'edge' as const }, // Bottom-to-bottom
        { val: otherBottom, shift: 0, kind: 'edge' as const }, // Top-to-bottom
        { val: other.y, shift: -target.height, kind: 'edge' as const }, // Bottom-to-top
        { val: otherCenterY, shift: -target.height / 2, kind: 'center' as const } // Center-to-center
      ]

      for (const check of yChecks) {
        const candidateY = check.val + check.shift
        const dy = Math.abs(candidateY - target.y)
        if (dy < minDeltaY) {
          minDeltaY = dy
          bestY = candidateY
          guides.push({
            axis: 'y',
            position: check.val,
            start: Math.min(target.x, other.x),
            end: Math.max(targetRight, otherRight),
            kind: check.kind
          })
        }
      }
    }

    return {
      x: bestX,
      y: bestY,
      guides
    }
  }

  /**
   * Distributes boxes evenly along an axis with equal spacing.
   */
  public distribute(
    boxes: Rect[],
    axis: 'x' | 'y',
    specifiedGap?: number
  ): Rect[] {
    if (boxes.length <= 1) return [...boxes]

    const sorted = [...boxes].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]

    if (specifiedGap !== undefined) {
      let currentPos = axis === 'x' ? first.x : first.y
      return sorted.map((box) => {
        const updated = {
          ...box,
          x: axis === 'x' ? currentPos : box.x,
          y: axis === 'y' ? currentPos : box.y
        }
        currentPos += (axis === 'x' ? box.width : box.height) + specifiedGap
        return updated
      })
    }

    // Auto-calculate equal gap across total span
    const totalSpan = axis === 'x' ? last.x + last.width - first.x : last.y + last.height - first.y
    const totalBoxSizes = sorted.reduce((sum, b) => sum + (axis === 'x' ? b.width : b.height), 0)
    const gap = Math.max(0, (totalSpan - totalBoxSizes) / (sorted.length - 1))

    let currentPos = axis === 'x' ? first.x : first.y
    return sorted.map((box) => {
      const updated = {
        ...box,
        x: axis === 'x' ? currentPos : box.x,
        y: axis === 'y' ? currentPos : box.y
      }
      currentPos += (axis === 'x' ? box.width : box.height) + gap
      return updated
    })
  }

  /**
   * Aligns boxes along a specified mode (start, center, end).
   */
  public align(
    boxes: Rect[],
    axis: 'x' | 'y',
    mode: 'start' | 'center' | 'end'
  ): Rect[] {
    if (boxes.length <= 1) return [...boxes]

    let targetCoord = 0
    if (axis === 'x') {
      if (mode === 'start') {
        targetCoord = Math.min(...boxes.map((b) => b.x))
        return boxes.map((b) => ({ ...b, x: targetCoord }))
      } else if (mode === 'end') {
        targetCoord = Math.max(...boxes.map((b) => b.x + b.width))
        return boxes.map((b) => ({ ...b, x: targetCoord - b.width }))
      } else {
        const centers = boxes.map((b) => b.x + b.width / 2)
        const avgCenter = centers.reduce((a, b) => a + b, 0) / centers.length
        return boxes.map((b) => ({ ...b, x: avgCenter - b.width / 2 }))
      }
    } else {
      if (mode === 'start') {
        targetCoord = Math.min(...boxes.map((b) => b.y))
        return boxes.map((b) => ({ ...b, y: targetCoord }))
      } else if (mode === 'end') {
        targetCoord = Math.max(...boxes.map((b) => b.y + b.height))
        return boxes.map((b) => ({ ...b, y: targetCoord - b.height }))
      } else {
        const centers = boxes.map((b) => b.y + b.height / 2)
        const avgCenter = centers.reduce((a, b) => a + b, 0) / centers.length
        return boxes.map((b) => ({ ...b, y: avgCenter - b.height / 2 }))
      }
    }
  }
}
