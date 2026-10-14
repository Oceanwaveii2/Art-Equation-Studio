import type { BoardNode, VectorPath } from '../model/project'
import { resolveRectangleErasureMask, isRectangleErasure } from '../model/rectangleErasure.ts'
import { vectorNodeMatrix, vectorPathBounds, vectorPathData, vectorBoardToLocal, transformVectorPath } from '../model/vector.ts'
import type { CanvasPreparedVectorGeometry, CanvasRect, CanvasVectorCommand } from '../canvas-engine/contracts'
import type { PaintMatrix } from '../canvas-engine/paintDisplayList'
import { parseMeasuredBoxShadows, withCanonicalCardPaint, type CompleteCardPaintResult } from './completeMeasuredCardPaint.ts'
import { borderBoxSize } from './measuredCardPaint.ts'

export function rectangleMaskCommands(paths: readonly VectorPath[]): readonly CanvasVectorCommand[] {
  return paths.flatMap(path => {
    if (!path.points.length) return []
    const commands: CanvasVectorCommand[] = [['M', path.points[0].x, path.points[0].y]]
    for (let i = 1; i <= path.points.length; i++) {
      const previous = path.points[i - 1], point = path.points[i % path.points.length]
      if (previous.handleOut || point.handleIn) commands.push(['C', previous.x + (previous.handleOut?.x ?? 0), previous.y + (previous.handleOut?.y ?? 0), point.x + (point.handleIn?.x ?? 0), point.y + (point.handleIn?.y ?? 0), point.x, point.y])
      else commands.push(['L', point.x, point.y])
    }
    commands.push(['Z']); return commands
  })
}

/** Supply measured local paint bounds, including shadows. No guessed radius,
 * inset border or shadow style is reconstructed by the clip derivative. */
export function rectangleErasureCssClip(node: BoardNode, localPaintBounds: CanvasRect): string | undefined {
  if (!isRectangleErasure(node)) return undefined
  const contours = resolveRectangleErasureMask(node, localPaintBounds)
  if (!contours) return undefined
  // Empty masks must clip everything; path("") has inconsistent CSS support.
  const data = contours.length ? contours.map(vectorPathData).join(' ') : 'M 0 0 Z'
  return `path(nonzero, "${data}")`
}

/** Mounted CSS fallback uses the actual computed shadow list and border box.
 * Call synchronously in a layout commit, before allowing the guarded eraser
 * transaction. Return undefined on unsupported styles rather than dropping
 * the saved rectangle's appearance. No canonical state is changed here. */
export function captureRectangleErasureCssClip(article: HTMLElement, node: BoardNode): { clipPath: string; localPaintBounds: CanvasRect } | undefined {
  if (!isRectangleErasure(node) || article.dataset.nodeId !== node.id) return undefined
  return withCanonicalCardPaint(article, () => {
    const style = article.ownerDocument.defaultView?.getComputedStyle(article)
    if (!style || style.filter !== 'none' || style.backdropFilter !== 'none' || style.maskImage !== 'none' || style.clipPath !== 'none' || style.borderImageSource !== 'none') return undefined
    const size = borderBoxSize(style)
    if (!size || Math.abs(size.width - node.width) > .1 || Math.abs(size.height - node.height) > .1) return undefined
    let left = 0, top = 0, right = size.width, bottom = size.height
    try {
      for (const shadow of parseMeasuredBoxShadows(style.boxShadow)) if (!shadow.inset && !shadow.color.endsWith('00')) {
        const extent = shadow.spread + shadow.blur * 2
        left = Math.min(left, shadow.offsetX - extent); top = Math.min(top, shadow.offsetY - extent)
        right = Math.max(right, size.width + shadow.offsetX + extent); bottom = Math.max(bottom, size.height + shadow.offsetY + extent)
      }
    } catch { return undefined }
    const localPaintBounds = { x: left, y: top, width: right - left, height: bottom - top }, clipPath = rectangleErasureCssClip(node, localPaintBounds)
    return clipPath && article.ownerDocument.defaultView?.CSS.supports('clip-path', clipPath) ? { clipPath, localPaintBounds } : undefined
  })
}

/** Semantic fill picking shares precisely the retained subtract contours.
 * Call the canonical picker with hitRadiusCssPx:0: erased holes are not wide
 * hit strokes. This derivative grants no artwork paint ownership. */
export function prepareRectangleErasurePick(node: BoardNode): CanvasPreparedVectorGeometry {
  const contours = resolveRectangleErasureMask(node)
  if (!contours) return { status: 'unsupported', reason: 'rectangle-erasure-invalid' }
  const matrix = vectorNodeMatrix(node), world = contours.map(path => transformVectorPath(path, matrix))
  const all = world.map(vectorPathBounds)
  const bounds = !all.length ? null : { x: Math.min(...all.map(b => b.left)), y: Math.min(...all.map(b => b.top)), width: Math.max(...all.map(b => b.right)) - Math.min(...all.map(b => b.left)), height: Math.max(...all.map(b => b.bottom)) - Math.min(...all.map(b => b.top)) }
  return Object.freeze({ status: 'ready' as const, commands: Object.freeze(rectangleMaskCommands(world).map(command => Object.freeze(command))), bounds: bounds && Object.freeze(bounds), fillRule: 'nonzero' as const, hasFill: true, strokeOutsetCssPx: 0, hitOutsetCssPx: 0 })
}

/** Wrap the complete background/border/shadow/glyph operations. Every original
 * paint record, resource, opacity and group stays unchanged inside this scope. */
export function maskCompleteRectanglePaint(node: BoardNode, paint: CompleteCardPaintResult): CompleteCardPaintResult {
  if (node.shapeType !== 'rectangle' || !node.vectorBoolean || !paint.completePaint || paint.status !== 'ready') return paint
  const refuse = (reason: string): CompleteCardPaintResult => ({ ...paint, status: 'unsupported', completePaint: false, operations: [], uploads: [], visualBounds: null, blockers: [...paint.blockers, reason] })
  if (!isRectangleErasure(node)) return refuse('RECTANGLE_MASK_CANONICAL_STATE_INVALID')
  if (paint.objectId !== node.id || !paint.visualBounds) return refuse('RECTANGLE_MASK_IDENTITY_OR_BOUNDS')
  const b = paint.visualBounds, corners = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }].map(point => vectorBoardToLocal(node, point))
  if (corners.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return refuse('RECTANGLE_MASK_TRANSFORM')
  const points = corners as { x: number; y: number }[], x = Math.min(0, ...points.map(p => p.x)), y = Math.min(0, ...points.map(p => p.y))
  const local = { x, y, width: Math.max(node.width, ...points.map(p => p.x)) - x, height: Math.max(node.height, ...points.map(p => p.y)) - y }
  const contours = resolveRectangleErasureMask(node, local)
  if (!contours) return refuse('RECTANGLE_MASK_GEOMETRY')
  const commands = rectangleMaskCommands(contours)
  // An empty frame is a truthful ready contribution with no paint, not a
  // fabricated empty clipping command rejected by the shared engine.
  if (!commands.length) return { ...paint, operations: [], uploads: [], sourceFingerprint: paint.sourceFingerprint + ':rectangle-mask:' + JSON.stringify(node.vectorBoolean) }
  if (commands.length > 8192) return refuse('RECTANGLE_MASK_COMMAND_BUDGET')
  const m = vectorNodeMatrix(node), transform: PaintMatrix = [m.a, m.b, m.c, m.d, m.e, m.f], scopeId = node.id + ':rectangle-erasure'
  return { ...paint, sourceFingerprint: paint.sourceFingerprint + ':rectangle-mask:' + JSON.stringify(node.vectorBoolean), operations: [{ type: 'pushClip', scopeId, commands, transform, fillRule: 'nonzero', isolation: 'isolated' }, ...paint.operations, { type: 'pop', scopeId }] }
}
