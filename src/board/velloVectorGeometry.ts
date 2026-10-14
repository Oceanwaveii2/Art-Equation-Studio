import type { BoardNode, VectorPath } from '../model/project'
import type { CanvasPreparedVectorGeometry, CanvasVectorCommand } from '../canvas-engine/contracts'
import { vectorNodeMatrix } from '../model/vector'
import { resolveVectorBooleanGeometry } from '../model/vectorBooleanGeometry'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const pointValid = (point: unknown): boolean => Boolean(point && typeof point === 'object'
  && finite((point as { x?: unknown }).x) && finite((point as { y?: unknown }).y))

function pathValid(path: VectorPath | undefined, closedOnly = false): path is VectorPath {
  return Boolean(path && path.version === 1 && typeof path.closed === 'boolean'
    && (!closedOnly || path.closed) && Array.isArray(path.points)
    && path.points.length >= (path.closed ? 3 : 2)
    && path.points.every(point => pointValid(point)
      && (point.handleIn === undefined || pointValid(point.handleIn))
      && (point.handleOut === undefined || pointValid(point.handleOut))))
}

const refuse = (status: 'unsupported' | 'invalid', reason: string): CanvasPreparedVectorGeometry => Object.freeze({ status, reason })

// A unit-circle cubic's squared radius is a degree-six Bernstein polynomial.
// Its coefficient hull bounds radial error over the entire parameter interval.
// Positive Bernstein coefficients of cross(B,B') certify monotone angular
// coverage, so the radial bound describes the complete arc, not just samples.
const choose3 = [1, 3, 3, 1], choose2 = [1, 2, 1], choose5 = [1, 5, 10, 10, 5, 1], choose6 = [1, 6, 15, 20, 15, 6, 1]
function ellipseArcCertificate(angle: number) {
  const k = 4 / 3 * Math.tan(angle / 4), c = Math.cos(angle), s = Math.sin(angle)
  const p = [[1, 0], [1, k], [c + k * s, s - k * c], [c, s]]
  const radial = Array(7).fill(0) as number[], angular = Array(6).fill(0) as number[]
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    radial[i + j] += choose3[i] * choose3[j] / choose6[i + j] * (p[i][0] * p[j][0] + p[i][1] * p[j][1])
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const dx = 3 * (p[j + 1][0] - p[j][0]), dy = 3 * (p[j + 1][1] - p[j][1])
    angular[i + j] += choose3[i] * choose2[j] / choose5[i + j] * (p[i][0] * dy - p[i][1] * dx)
  }
  // This margin exceeds accumulated double precision arithmetic error here.
  return { radialError: Math.max(...radial.map(value => Math.abs(value - 1))) + 256 * Number.EPSILON,
    monotone: angular.every(value => value > 256 * Number.EPSILON) }
}

function preparePlainEllipse(node: BoardNode): CanvasPreparedVectorGeometry {
  if (node.diagramShape || node.vectorPath !== undefined || node.vectorBoolean !== undefined || node.vectorTransform !== undefined) return refuse('unsupported', 'uncompiled-ellipse-metadata')
  if (![node.x, node.y, node.width, node.height].every(finite) || node.width <= 0 || node.height <= 0
    || (node.rotation !== undefined && !finite(node.rotation))) return refuse('invalid', 'invalid-ellipse-frame')
  const strokeWidth = node.strokeWidth ?? 2, opacity = node.opacity ?? 1
  if (!finite(strokeWidth) || strokeWidth < 0 || !finite(opacity) || opacity < 0 || opacity > 1) return refuse('invalid', 'invalid-ellipse-paint')
  if ((node.color !== undefined && typeof node.color !== 'string') || (node.strokeColor !== undefined && typeof node.strokeColor !== 'string')
    || (node.body !== undefined && typeof node.body !== 'string')) return refuse('invalid', 'invalid-ellipse-style')
  const fill = node.color || '#56748e', stroke = node.strokeColor || '#b9d4e7'
  if ([fill, stroke].some(value => /\b(?:var|env|url)\s*\(|\b(?:currentcolor|inherit|initial|unset|revert|context-stroke|context-fill)\b/i.test(value))) return refuse('unsupported', 'unresolved-ellipse-paint')
  // Bound aspect, curvature, thickness and float32 world precision for this
  // first paint slice. Larger objects remain authored ellipses in the DOM.
  const smallest = Math.min(node.width, node.height), largest = Math.max(node.width, node.height)
  if (smallest < 2 || largest > 2048 || largest / smallest > 64 || strokeWidth > 64
    || Math.abs(node.x) + largest > 8192 || Math.abs(node.y) + largest > 8192) return refuse('unsupported', 'ellipse-numerical-envelope')
  const rx = node.width * .49, ry = node.height * .49, targetError = 1 / 120
  let segments = 4, error = Infinity
  while (segments <= 2048) {
    const certificate = ellipseArcCertificate(2 * Math.PI / segments)
    error = certificate.radialError * Math.max(rx, ry)
    if (certificate.monotone && error <= targetError) break
    segments *= 2
  }
  if (segments > 2048 || !finite(error)) return refuse('unsupported', 'ellipse-contour-budget')
  const theta = ((node.rotation ?? 0) % 360) * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta)
  const cx = node.x + node.width / 2, cy = node.y + node.height / 2
  const world = (x: number, y: number) => [cx + c * x - s * y, cy + s * x + c * y] as const
  const step = 2 * Math.PI / segments, k = 4 / 3 * Math.tan(step / 4)
  // Exact cardinal points and exact closure avoid a small closing seam.
  const trig = (index: number): readonly [number, number] => {
    const quadrant = index / (segments / 4)
    if (Number.isInteger(quadrant)) return [[1, 0], [0, 1], [-1, 0], [0, -1]][quadrant % 4] as [number, number]
    return [Math.cos(index * step), Math.sin(index * step)]
  }
  const start = world(rx, 0), commands: CanvasVectorCommand[] = [Object.freeze(['M', ...start])]
  for (let index = 0; index < segments; index++) {
    const [a, b] = trig(index), [d, e] = trig(index + 1)
    const first = world(rx * (a - k * b), ry * (b + k * a))
    const second = world(rx * (d + k * e), ry * (e - k * d))
    const end = index + 1 === segments ? start : world(rx * d, ry * e)
    commands.push(Object.freeze(['C', ...first, ...second, ...end]))
  }
  commands.push(Object.freeze(['Z']))
  if (commands.some(command => command.slice(1).some(value => !finite(value)))) return refuse('invalid', 'invalid-ellipse-world')
  // Include control rounding and float32 GPU representation in the envelope.
  const worldError = error + .002, ex = Math.hypot(rx * c, ry * s) + worldError, ey = Math.hypot(rx * s, ry * c) + worldError
  return Object.freeze({ status: 'ready', primitive: 'ellipse', commands: Object.freeze(commands),
    bounds: Object.freeze({ x: cx - ex, y: cy - ey, width: 2 * ex, height: 2 * ey }), fillRule: 'nonzero', hasFill: true,
    strokeOutsetCssPx: strokeWidth / 2 + 1, hitOutsetCssPx: Math.max(8, strokeWidth * 2),
    approximation: Object.freeze({ worldError, minCssScale: .18, maxCssScale: 3, maxBackingResolution: 2 }),
    effectivePaint: Object.freeze({ fill, stroke, strokeWidth, vectorStrokeJoin: 'miter', vectorStrokeCap: 'butt' }) })
}

/** The actual App line branch paints first/last anchors in a normalized SVG,
 * then applies reverse and centered node rotation. Handles, inner path affine
 * and arrows are separate paint contracts. Parenting never adds a translation. */
function preparePlainLine(node: BoardNode): CanvasPreparedVectorGeometry {
  if (node.diagramShape || node.vectorBoolean !== undefined || node.vectorTransform !== undefined) return refuse('unsupported', 'uncompiled-line-metadata')
  if (![node.x, node.y, node.width, node.height].every(finite) || node.width <= 0 || node.height <= 0
    || [node.x, node.y, node.width, node.height].some(value => Math.abs(value) > 1e9)) return refuse('invalid', 'invalid-line-frame')
  if (node.rotation !== undefined && !finite(node.rotation)) return refuse('invalid', 'invalid-line-rotation')
  const savedWidth = node.strokeWidth ?? 2, opacity = node.opacity ?? 1
  if (!finite(savedWidth) || savedWidth < 0 || savedWidth > 1e6) return refuse('invalid', 'invalid-line-stroke-width')
  if (!finite(opacity) || opacity < 0 || opacity > 1) return refuse('invalid', 'invalid-line-opacity')
  if (node.strokeColor !== undefined && typeof node.strokeColor !== 'string') return refuse('invalid', 'invalid-line-stroke-color')
  const stroke = node.strokeColor || '#b9d4e7'
  // Context-dependent CSS paint must be resolved before complete-ID ownership.
  // All remaining color syntax is still validated by the shared Rust parser.
  if (/\b(?:var|env|url)\s*\(|\b(?:currentcolor|inherit|initial|unset|revert|context-stroke|context-fill)\b/i.test(stroke)) return refuse('unsupported', 'unresolved-line-stroke')
  let start = { x: 0, y: 0 }, end = { x: node.width, y: node.height }
  if (node.vectorPath !== undefined) {
    const path = node.vectorPath
    const validEndpoint = (value: unknown) => pointValid(value)
      && Math.abs((value as { x: number }).x) <= 1e9 && Math.abs((value as { y: number }).y) <= 1e9
    if (!path || path.version !== 1 || !Array.isArray(path.points) || path.points.length < 2
      || path.points.length > 65_536 || !validEndpoint(path.points[0]) || !validEndpoint(path.points.at(-1))) return refuse('invalid', 'invalid-line-endpoints')
    start = path.points[0]; end = path.points.at(-1)!
  }
  const theta = ((node.rotation ?? 0) % 360) * Math.PI / 180, cosine = Math.cos(theta), sine = Math.sin(theta)
  const cx = node.width / 2, cy = node.height / 2
  const world = (point: { x: number; y: number }): readonly [number, number] => {
    const px = point.x - cx, py = (node.body === 'reverse' ? node.height - point.y : point.y) - cy
    return Object.freeze([node.x + cx + cosine * px - sine * py, node.y + cy + sine * px + cosine * py])
  }
  const a = world(start), b = world(end)
  if (![...a, ...b].every(finite) || [...a, ...b].some(value => Math.abs(value) > 1e12)) return refuse('invalid', 'invalid-line-world-endpoints')
  const commands = Object.freeze([Object.freeze(['M', ...a]) as CanvasVectorCommand, Object.freeze(['L', ...b]) as CanvasVectorCommand])
  const strokeWidth = savedWidth * .65
  return Object.freeze({ status: 'ready', primitive: 'plain-line', commands,
    bounds: Object.freeze({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }),
    fillRule: 'nonzero', hasFill: false, strokeOutsetCssPx: strokeWidth / 2 + 1,
    hitOutsetCssPx: Math.max(8, savedWidth * 2),
    effectivePaint: Object.freeze({ fill: 'none', stroke, strokeWidth, vectorStrokeJoin: 'miter', vectorStrokeCap: 'butt' }) })
}

/** Exact disposable paint geometry in board coordinates. Ownership, lock,
 * selection and camera stay outside this derivative. Parent IDs never imply
 * an additional translation: current child frames are already board-space. */
export function prepareVelloVectorGeometry(node: BoardNode): CanvasPreparedVectorGeometry {
  if (node.kind === 'shape' && node.shapeType === 'line') return preparePlainLine(node)
  if (node.kind === 'shape' && node.shapeType === 'ellipse') return preparePlainEllipse(node)
  if (node.kind !== 'shape' || node.shapeType !== 'path') return refuse('unsupported', 'not-a-path-shape')
  if (node.diagramShape) return refuse('unsupported', 'diagram-caption')
  if (![node.x, node.y, node.width, node.height].every(finite) || node.width <= 0 || node.height <= 0) return refuse('invalid', 'invalid-frame')
  if (node.rotation !== undefined && !finite(node.rotation)) return refuse('invalid', 'invalid-rotation')
  if (node.vectorTransform !== undefined && (!node.vectorTransform || typeof node.vectorTransform !== 'object' || Array.isArray(node.vectorTransform)
    || ['translateX', 'translateY', 'scaleX', 'scaleY', 'skewX', 'skewY'].some(key => {
      const value = node.vectorTransform![key as keyof NonNullable<BoardNode['vectorTransform']>]
      return value !== undefined && !finite(value)
    }))) return refuse('invalid', 'invalid-inner-transform')
  if (!pathValid(node.vectorPath)) return refuse('invalid', 'invalid-primary-path')
  const strokeWidth = node.strokeWidth ?? 2
  if (!finite(strokeWidth) || strokeWidth < 0) return refuse('invalid', 'invalid-stroke-width')
  if (node.opacity !== undefined && (!finite(node.opacity) || node.opacity < 0 || node.opacity > 1)) return refuse('invalid', 'invalid-opacity')
  if (node.vectorFillRule !== undefined && !['nonzero', 'evenodd'].includes(node.vectorFillRule)) return refuse('invalid', 'invalid-fill-rule')
  if (node.vectorStrokeJoin !== undefined && !['miter', 'round', 'bevel'].includes(node.vectorStrokeJoin)) return refuse('invalid', 'invalid-stroke-join')
  if (node.vectorStrokeCap !== undefined && !['butt', 'round', 'square'].includes(node.vectorStrokeCap)) return refuse('invalid', 'invalid-stroke-cap')

  let paths: readonly VectorPath[] = [node.vectorPath], fillRule = node.vectorFillRule ?? 'nonzero'
  if (node.vectorBoolean !== undefined) {
    const boolean = node.vectorBoolean
    if (!boolean || typeof boolean !== 'object' || Array.isArray(boolean)
      || !['union', 'subtract', 'intersect', 'exclude'].includes(boolean.operation)
      || !Array.isArray(boolean.operands) || boolean.operands.length < 2 || !boolean.operands.every(path => pathValid(path, true))
      || (boolean.fillRules !== undefined && (!Array.isArray(boolean.fillRules)
        || boolean.fillRules.some(rule => !['nonzero', 'evenodd'].includes(rule))))) return refuse('invalid', 'invalid-boolean-operands')
    const resolved = boolean.resolvedPaths ?? resolveVectorBooleanGeometry(boolean.operation, boolean.operands,
      boolean.fillRules ?? boolean.operands.map(() => node.vectorFillRule ?? 'nonzero'))
    if (!resolved || !Array.isArray(resolved) || !resolved.every(path => pathValid(path, true))) return refuse('invalid', 'unresolved-boolean')
    paths = resolved
    // The shared Boolean resolver emits correctly oriented outer/hole contours.
    // [] remains a valid empty set; it must never resurrect the primary path.
    fillRule = 'nonzero'
  }

  const matrix = vectorNodeMatrix(node)
  if (![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(finite)) return refuse('invalid', 'invalid-world-transform')
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (!finite(determinant) || Math.abs(determinant) < 1e-10) return refuse('unsupported', 'singular-world-transform')
  const commands: CanvasVectorCommand[] = []
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  let invalid = false
  const point = (x: number, y: number): [number, number] => {
    const px = matrix.a * x + matrix.c * y + matrix.e, py = matrix.b * x + matrix.d * y + matrix.f
    if (!finite(px) || !finite(py)) invalid = true
    left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px); bottom = Math.max(bottom, py)
    return [px, py]
  }
  const segment = (previous: VectorPath['points'][number], current: VectorPath['points'][number]) => {
    if (previous.handleOut || current.handleIn) commands.push(Object.freeze(['C',
      ...point(previous.x + (previous.handleOut?.x ?? 0), previous.y + (previous.handleOut?.y ?? 0)),
      ...point(current.x + (current.handleIn?.x ?? 0), current.y + (current.handleIn?.y ?? 0)),
      ...point(current.x, current.y)]) as CanvasVectorCommand)
    else commands.push(Object.freeze(['L', ...point(current.x, current.y)]) as CanvasVectorCommand)
  }
  for (const path of paths) {
    commands.push(Object.freeze(['M', ...point(path.points[0].x, path.points[0].y)]) as CanvasVectorCommand)
    for (let index = 1; index < path.points.length; index++) segment(path.points[index - 1], path.points[index])
    if (path.closed) {
      const last = path.points.at(-1)!, first = path.points[0]
      if (last.handleOut || first.handleIn) segment(last, first)
      commands.push(Object.freeze(['Z']) as CanvasVectorCommand)
    }
  }
  const bounds = paths.length ? { x: left, y: top, width: right - left, height: bottom - top } : null
  if (invalid || (bounds && ![bounds.x, bounds.y, bounds.width, bounds.height, right, bottom].every(finite))) return refuse('invalid', 'invalid-world-geometry')
  // SVG non-scaling stroke is applied after all node transforms. Geometry is
  // flattened, so reflection/skew/nonuniform scale cannot distort this stroke.
  // SVG's default miter limit is 4; this conservative extent also covers square
  // caps and one CSS pixel of antialiasing. Consumers divide it by camera scale.
  const strokeOutsetCssPx = strokeWidth * 2 + 1
  if (!finite(strokeOutsetCssPx)) return refuse('invalid', 'invalid-stroke-envelope')
  return Object.freeze({ status: 'ready', commands: Object.freeze(commands), bounds: bounds && Object.freeze(bounds),
    fillRule, hasFill: node.vectorPath.closed, strokeOutsetCssPx })
}
