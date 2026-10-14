/**
 * Art Equation Canvas Engine - Typed Card Ports & Anchors
 *
 * Implements Rete/React-Flow style first-class connection handles:
 * - Typed sockets: reference, identity, evidence, continuity, branch, transform, video-range.
 * - Normalized side placement (left, right, top, bottom).
 * - Dynamic port creation and runtime validation before committing edges.
 * - Normalized coordinate tracking so card resize/drag preserves edge attachment.
 */

export type PortSemanticType =
  | 'reference'
  | 'identity'
  | 'evidence'
  | 'continuity-in'
  | 'continuity-out'
  | 'branch-out'
  | 'branch-in'
  | 'transform'
  | 'media-time-range'
  | 'generic'

export type PortSide = 'left' | 'right' | 'top' | 'bottom' | 'auto'
export type PortDirection = 'source' | 'target' | 'both'

export interface CardPort {
  id: string
  cardId: string
  semanticType: PortSemanticType
  side: PortSide
  normalizedOffset: number // 0.0 to 1.0 along the specified edge
  direction: PortDirection
  label?: string
  colorToken?: string
}

export interface CardBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AbsolutePoint {
  x: number
  y: number
}

/**
 * Computes exact canvas coordinates for a port based on current card bounds.
 */
export function computePortPosition(port: CardPort, bounds: CardBounds): AbsolutePoint {
  const { x, y, width, height } = bounds
  const offset = Math.max(0, Math.min(1, port.normalizedOffset))

  switch (port.side) {
    case 'top':
      return { x: x + width * offset, y }
    case 'bottom':
      return { x: x + width * offset, y: y + height }
    case 'left':
      return { x, y: y + height * offset }
    case 'right':
    default:
      return { x: x + width, y: y + height * offset }
  }
}

/**
 * Validates whether two ports can legally form a directional semantic connection.
 */
export function validatePortConnection(
  source: CardPort,
  target: CardPort
): { valid: boolean; reason?: string } {
  if (source.cardId === target.cardId) {
    return { valid: false, reason: 'Self-connecting loops are prohibited.' }
  }

  if (!['source', 'target', 'both'].includes(source.direction) || !['source', 'target', 'both'].includes(target.direction)) {
    return { valid: false, reason: 'Both ports must have a valid direction.' }
  }

  if (source.direction === 'target') {
    return { valid: false, reason: `Port ${source.id} is target-only and cannot initiate a connection.` }
  }

  if (target.direction === 'source') {
    return { valid: false, reason: `Port ${target.id} is source-only and cannot receive a connection.` }
  }

  // Type compatibility rules
  if (source.semanticType === 'identity' && target.semanticType !== 'identity' && target.semanticType !== 'generic') {
    return { valid: false, reason: 'Identity ports can only connect to identity or generic sockets.' }
  }

  if (source.semanticType === 'continuity-out' && target.semanticType !== 'continuity-in' && target.semanticType !== 'branch-in' && target.semanticType !== 'generic') {
    return { valid: false, reason: 'Continuity-out must terminate on continuity-in or branch-in.' }
  }

  if (source.semanticType === 'branch-out' && target.semanticType !== 'branch-in' && target.semanticType !== 'continuity-in' && target.semanticType !== 'generic') {
    return { valid: false, reason: 'Branch-out must terminate on branch-in or continuity-in.' }
  }

  return { valid: true }
}

/**
 * Color tokens representing semantic port types on canvas.
 */
export const PORT_SEMANTIC_COLORS: Record<PortSemanticType, string> = {
  reference: '#3b82f6', // blue
  identity: '#a855f7', // purple
  evidence: '#10b981', // green
  'continuity-in': '#f59e0b', // amber
  'continuity-out': '#f59e0b', // amber
  'branch-out': '#ef4444', // red
  'branch-in': '#ef4444', // red
  transform: '#ec4899', // pink
  'media-time-range': '#06b6d4', // cyan
  generic: '#94a3b8' // slate
}

/**
 * Generates standard semantic ports for cards based on their narrative / structural role.
 */
export function createStandardCardPorts(
  cardId: string,
  role: 'continuity' | 'branch' | 'reference' | 'identity' | 'video' | 'general'
): CardPort[] {
  switch (role) {
    case 'continuity':
      return [
        { id: `${cardId}-cin`, cardId, semanticType: 'continuity-in', side: 'left', normalizedOffset: 0.5, direction: 'target', label: 'Continuity In' },
        { id: `${cardId}-cout`, cardId, semanticType: 'continuity-out', side: 'right', normalizedOffset: 0.5, direction: 'source', label: 'Continuity Out' },
        { id: `${cardId}-bout`, cardId, semanticType: 'branch-out', side: 'bottom', normalizedOffset: 0.5, direction: 'source', label: 'Branch Out' },
        { id: `${cardId}-ref`, cardId, semanticType: 'reference', side: 'top', normalizedOffset: 0.5, direction: 'target', label: 'Reference In' }
      ]
    case 'branch':
      return [
        { id: `${cardId}-bin`, cardId, semanticType: 'branch-in', side: 'top', normalizedOffset: 0.5, direction: 'target', label: 'Branch In' },
        { id: `${cardId}-cout`, cardId, semanticType: 'continuity-out', side: 'right', normalizedOffset: 0.5, direction: 'source', label: 'Continuity Out' },
        { id: `${cardId}-ref`, cardId, semanticType: 'reference', side: 'bottom', normalizedOffset: 0.5, direction: 'target', label: 'Reference In' }
      ]
    case 'identity':
      return [
        { id: `${cardId}-idin`, cardId, semanticType: 'identity', side: 'left', normalizedOffset: 0.5, direction: 'target', label: 'Identity In' },
        { id: `${cardId}-idout`, cardId, semanticType: 'identity', side: 'right', normalizedOffset: 0.5, direction: 'source', label: 'Identity Out' },
        { id: `${cardId}-ref`, cardId, semanticType: 'reference', side: 'top', normalizedOffset: 0.5, direction: 'both', label: 'Ref Socket' }
      ]
    case 'video':
      return [
        { id: `${cardId}-refout`, cardId, semanticType: 'reference', side: 'right', normalizedOffset: 0.5, direction: 'source', label: 'Ref Out' },
        { id: `${cardId}-time`, cardId, semanticType: 'media-time-range', side: 'bottom', normalizedOffset: 0.5, direction: 'source', label: 'Time Range' }
      ]
    case 'reference':
    case 'general':
    default:
      return [
        { id: `${cardId}-ref-left`, cardId, semanticType: 'reference', side: 'left', normalizedOffset: 0.5, direction: 'both', label: 'Ref Left' },
        { id: `${cardId}-ref-right`, cardId, semanticType: 'reference', side: 'right', normalizedOffset: 0.5, direction: 'both', label: 'Ref Right' },
        { id: `${cardId}-ref-top`, cardId, semanticType: 'reference', side: 'top', normalizedOffset: 0.5, direction: 'both', label: 'Ref Top' },
        { id: `${cardId}-ref-bottom`, cardId, semanticType: 'reference', side: 'bottom', normalizedOffset: 0.5, direction: 'both', label: 'Ref Bottom' }
      ]
  }
}
