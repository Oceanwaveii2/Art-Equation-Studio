/**
 * Art Equation Canvas Engine - Frames & Nested Scopes
 *
 * Implements Miro/Lucidchart-style first-class container frames:
 * - Child-relative coordinates & automatic bounding-box fitting
 * - Collapsible state (collapsed into summary header vs expanded)
 * - Semantic group ports
 * - High-visibility title bar and styling tokens
 */

import { normalizeColor8 } from './colorUtils.ts'
import type { Rect } from './snapManager.ts'

export interface BoardFrame {
  id: string
  title: string
  childIds: string[]
  bounds: Rect
  collapsed: boolean
  style?: {
    borderColor?: string
    borderWidth?: number
    backgroundColor?: string
    titleColor?: string
    badgeText?: string
  }
}

/**
 * Calculates outer bounding box to snugly enclose child cards with padding.
 */
export function fitFrameToChildren(
  childBounds: Rect[],
  padding: { x: number; y: number } = { x: 32, y: 48 }
): Rect {
  if (childBounds.length === 0) {
    return { x: 0, y: 0, width: 300, height: 200 }
  }

  const minX = Math.min(...childBounds.map((b) => b.x))
  const minY = Math.min(...childBounds.map((b) => b.y))
  const maxX = Math.max(...childBounds.map((b) => b.x + b.width))
  const maxY = Math.max(...childBounds.map((b) => b.y + b.height))

  return {
    x: minX - padding.x,
    y: minY - padding.y,
    width: maxX - minX + padding.x * 2,
    height: maxY - minY + padding.y * 2
  }
}

/**
 * Generates Display List v2 vector operations to render a frame container.
 */
export function createFrameRenderOps(
  frame: BoardFrame,
  nextOpId: () => number
): any[] {
  const { x, y, width, height } = frame.bounds
  const borderColor = normalizeColor8(frame.style?.borderColor || '#06b6d4ff')
  const bgColor = normalizeColor8(frame.style?.backgroundColor || '#0c1a2433')
  const borderWidth = frame.style?.borderWidth || 2

  const ops: any[] = []

  // 1. Frame background panel (subtle tinted backdrop)
  ops.push({
    type: 'vector',
    object: {
      id: `frame-bg-${frame.id}-${nextOpId()}`,
      kind: 'vector',
      bounds: { x, y, width, height },
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      payload: {
        commands: [
          ['M', x + 12, y],
          ['L', x + width - 12, y],
          ['C', x + width, y, x + width, y, x + width, y + 12],
          ['L', x + width, y + height - 12],
          ['C', x + width, y + height, x + width, y + height, x + width - 12, y + height],
          ['L', x + 12, y + height],
          ['C', x, y + height, x, y + height, x, y + height - 12],
          ['L', x, y + 12],
          ['C', x, y, x, y, x + 12, y],
          ['Z']
        ],
        fill: bgColor,
        stroke: borderColor,
        strokeWidth: borderWidth,
        vectorFillRule: 'nonzero'
      },
      transform: [1, 0, 0, 1, 0, 0]
    }
  })

  // 2. Frame Title Header Tab
  const tabWidth = Math.min(Math.max(160, frame.title.length * 10 + 36), width - 24)
  const tabHeight = 32
  ops.push({
    type: 'vector',
    object: {
      id: `frame-tab-${frame.id}-${nextOpId()}`,
      kind: 'vector',
      bounds: { x: x + 16, y: y - 16, width: tabWidth, height: tabHeight },
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      payload: {
        commands: [
          ['M', x + 24, y - 16],
          ['L', x + 16 + tabWidth - 8, y - 16],
          ['C', x + 16 + tabWidth, y - 16, x + 16 + tabWidth, y - 16, x + 16 + tabWidth, y - 8],
          ['L', x + 16 + tabWidth, y + 16],
          ['L', x + 16, y + 16],
          ['L', x + 16, y - 8],
          ['C', x + 16, y - 16, x + 16, y - 16, x + 24, y - 16],
          ['Z']
        ],
        fill: '#151d28ff',
        stroke: borderColor,
        strokeWidth: 1.5,
        vectorFillRule: 'nonzero'
      },
      transform: [1, 0, 0, 1, 0, 0]
    }
  })

  return ops
}
