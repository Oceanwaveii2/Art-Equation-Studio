/**
 * Art Equation Canvas Engine - Column Object & Square Slot Snapping Architecture
 *
 * Implements column and square container objects with explicit uniform media fit
 * and direct perimeter port attachment. Stretching is opt-in for legacy callers.
 */

import type { Rect } from './snapManager.ts'
import type { MediaFitMode } from './mediaEngine.ts'
import { calculateMediaFit, createMediaRenderOp } from './mediaEngine.ts'
import { computePortPosition, createStandardCardPorts, PORT_SEMANTIC_COLORS, type CardPort } from './cardPorts.ts'

export interface ImageResourceRef {
  key: string
  width: number
  height: number
  revision?: number
  epoch?: number
}
export type SlotMediaFitMode = MediaFitMode | 'stretch'

export interface ColumnItemSpec {
  id: string
  title?: string
  imageKey?: string
  isSquare?: boolean
  width?: number
  height?: number
  aspectRatio?: number
  role?: 'continuity' | 'reference' | 'identity' | 'branch' | 'reservoir'
  fillColor?: string
  borderColor?: string
}

export interface SnappedSlot {
  id: string
  role: string
  bounds: Rect
  title?: string
  imageKey?: string
  ports: CardPort[]
  fillColor?: string
  borderColor?: string
}

export interface ColumnLayoutResult {
  columnBounds: Rect
  slots: SnappedSlot[]
}

/**
 * Creates a column container object and computes snapped vertical slots for each child item.
 * Every item inherits the column width and snaps flush to the column's horizontal track.
 */
export function layoutColumnContainer(
  _columnId: string,
  origin: { x: number; y: number },
  columnWidth: number,
  gap: number,
  items: ColumnItemSpec[]
): ColumnLayoutResult {
  let currentY = origin.y
  const slots: SnappedSlot[] = []

  for (const item of items) {
    let itemHeight = item.height || columnWidth // Default to square if unspecified

    if (item.isSquare) {
      itemHeight = columnWidth
    } else if (item.aspectRatio && item.aspectRatio > 0) {
      itemHeight = Math.round(columnWidth / item.aspectRatio)
    }

    const bounds: Rect = {
      x: origin.x,
      y: currentY,
      width: columnWidth,
      height: itemHeight
    }

    const role = item.role || 'continuity'
    const ports = createStandardCardPorts(item.id, role === 'reservoir' ? 'general' : role)

    slots.push({
      id: item.id,
      role,
      bounds,
      title: item.title,
      imageKey: item.imageKey,
      ports,
      fillColor: item.fillColor,
      borderColor: item.borderColor
    })

    currentY += itemHeight + gap
  }

  const totalHeight = currentY > origin.y ? currentY - origin.y - gap : 0
  const columnBounds: Rect = {
    x: origin.x,
    y: origin.y,
    width: columnWidth,
    height: totalHeight
  }

  return { columnBounds, slots }
}

export interface SquareContainerSpec {
  id: string
  x: number
  y: number
  size: number
  role?: 'continuity' | 'reference' | 'identity' | 'branch' | 'reservoir'
  title?: string
  imageKey?: string
  fillColor?: string
  borderColor?: string
}

export interface SnappedSquare {
  id: string
  bounds: Rect
  role: string
  title?: string
  imageKey?: string
  ports: CardPort[]
  fillColor?: string
  borderColor?: string
}

/**
 * Creates a standalone square container object where cards and images snap flush inside.
 * Treats the square identically to column object slots with single-pixel perimeter bounds.
 */
export function createSquareContainer(spec: SquareContainerSpec): SnappedSquare {
  const bounds: Rect = {
    x: spec.x,
    y: spec.y,
    width: spec.size,
    height: spec.size
  }
  const role = spec.role || 'continuity'
  const ports = createStandardCardPorts(spec.id, role === 'reservoir' ? 'general' : role)
  return {
    id: spec.id,
    bounds,
    role,
    title: spec.title,
    imageKey: spec.imageKey,
    ports,
    fillColor: spec.fillColor,
    borderColor: spec.borderColor
  }
}

/**
 * Uniform cover fills the slot using a source crop; contain preserves the whole
 * source within the slot. Explicit stretch retains the older affine behavior.
 * Layout screenshots must never be used as source media for any fit mode.
 */
export function snapImageToSlot(
  opId: string,
  slotRect: Rect,
  imageRef: ImageResourceRef,
  opacity: number = 1.0,
  fitMode: SlotMediaFitMode = 'cover'
): any {
  if (![slotRect.x, slotRect.y, slotRect.width, slotRect.height, imageRef.width, imageRef.height].every(Number.isFinite)
    || ![slotRect.x + slotRect.width, slotRect.y + slotRect.height].every(Number.isFinite)
    || slotRect.width <= 0 || slotRect.height <= 0 || !Number.isInteger(imageRef.width) || !Number.isInteger(imageRef.height)
    || imageRef.width <= 0 || imageRef.height <= 0) {
    throw new Error('Slot and image dimensions must be finite and positive.')
  }
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('Image opacity must be between zero and one.')
  if (!['contain', 'cover', 'crop', 'native', 'stretch'].includes(fitMode)) throw new Error(`Unsupported slot media fit: ${fitMode}`)
  if (fitMode !== 'stretch') {
    const fit = calculateMediaFit({ intrinsicWidth: imageRef.width, intrinsicHeight: imageRef.height },
      { frameRect: slotRect, fitMode })
    return createMediaRenderOp(opId, { ...imageRef, revision: imageRef.revision ?? 1, epoch: imageRef.epoch ?? 1 }, fit, opacity)
  }

  // Compatibility mode only: independent affine scales intentionally distort.
  const sx = slotRect.width / imageRef.width
  const sy = slotRect.height / imageRef.height
  const tx = slotRect.x
  const ty = slotRect.y

  return {
    type: 'image',
    id: opId,
    resource: {
      key: imageRef.key,
      revision: imageRef.revision || 1,
      epoch: imageRef.epoch || 1,
      width: imageRef.width,
      height: imageRef.height
    },
    sourceRect: {
      x: 0,
      y: 0,
      width: imageRef.width,
      height: imageRef.height
    },
    transform: [sx, 0, 0, sy, tx, ty],
    opacity,
    sampling: 'bilinear'
  }
}

/**
 * Snaps an image flush inside a square slot with zero margin/padding.
 * Uses the same uniform media fit contract as a column slot.
 */
export function snapImageToSquareSlot(
  opId: string,
  slotRect: Rect,
  imageRef: ImageResourceRef,
  opacity: number = 1.0,
  fitMode: SlotMediaFitMode = 'cover'
): any {
  return snapImageToSlot(opId, slotRect, imageRef, opacity, fitMode)
}

/**
 * Snaps an image flush inside a column slot with zero margin/padding.
 */
export function snapImageToColumnSlot(
  opId: string,
  slotRect: Rect,
  imageRef: ImageResourceRef,
  opacity: number = 1.0,
  fitMode: SlotMediaFitMode = 'cover'
): any {
  return snapImageToSlot(opId, slotRect, imageRef, opacity, fitMode)
}

/**
 * Computes socket handle positions attached directly to the flush perimeter of a slot.
 */
export function getSlotPerimeterPorts(slot: SnappedSlot | SnappedSquare): Array<{ port: CardPort; x: number; y: number; color: string }> {
  return slot.ports.map((port) => {
    const pt = computePortPosition(port, slot.bounds)
    const color = PORT_SEMANTIC_COLORS[port.semanticType] || '#3b82f6'
    return { port, x: pt.x, y: pt.y, color }
  })
}
