import type { BoardNode, BoardPoint, VectorPath, VectorPathPoint } from './project'
import { transformVectorPath, vectorNodeMatrix, vectorPathBounds } from './vector.ts'

type Cubic = { p0: BoardPoint; p1: BoardPoint; p2: BoardPoint; p3: BoardPoint }
const add = (a: BoardPoint, b: BoardPoint): BoardPoint => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: BoardPoint, b: BoardPoint): BoardPoint => ({ x: a.x - b.x, y: a.y - b.y })
const mul = (a: BoardPoint, value: number): BoardPoint => ({ x: a.x * value, y: a.y * value })
const mix = (a: BoardPoint, b: BoardPoint, t: number) => add(a, mul(sub(b, a), t))
const dist = (a: BoardPoint, b: BoardPoint) => Math.hypot(a.x - b.x, a.y - b.y)
const valid = (point: BoardPoint) => Boolean(point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y))
const boundedPoint = (point: unknown): point is BoardPoint => Boolean(point && typeof point === 'object'
  && valid(point as BoardPoint) && Math.abs((point as BoardPoint).x) <= 1e9 && Math.abs((point as BoardPoint).y) <= 1e9)
const validEditablePath = (path: VectorPath | undefined): path is VectorPath => Boolean(path && path.version === 1
  && typeof path.closed === 'boolean' && Array.isArray(path.points) && path.points.length >= (path.closed ? 3 : 2)
  && path.points.length <= 65_536 && path.points.every(point => boundedPoint(point)
    && (point.handleIn === undefined || boundedPoint(point.handleIn)) && (point.handleOut === undefined || boundedPoint(point.handleOut))))

function distanceToSegment(point: BoardPoint, from: BoardPoint, to: BoardPoint) {
  const delta = sub(to, from), length = delta.x ** 2 + delta.y ** 2
  const t = length ? Math.max(0, Math.min(1, ((point.x - from.x) * delta.x + (point.y - from.y) * delta.y) / length)) : 0
  return dist(point, mix(from, to, t))
}

function segmentDistance(a: BoardPoint, b: BoardPoint, c: BoardPoint, d: BoardPoint) {
  const cross = (from: BoardPoint, to: BoardPoint, point: BoardPoint) => (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x)
  const overlaps = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
  if (overlaps && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return 0
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b))
}

function simplify(points: BoardPoint[], tolerance: number): BoardPoint[] {
  if (points.length <= 2 || tolerance <= 0) return points
  const keep = new Set([0, points.length - 1]), work = [[0, points.length - 1]]
  while (work.length) {
    const [first, last] = work.pop()!
    let furthest = -1, maximum = tolerance
    for (let index = first + 1; index < last; index++) {
      const d = distanceToSegment(points[index], points[first], points[last])
      if (d > maximum) { maximum = d; furthest = index }
    }
    if (furthest >= 0) { keep.add(furthest); work.push([first, furthest], [furthest, last]) }
  }
  return [...keep].sort((a, b) => a - b).map((index) => points[index])
}

export type PencilOptions = { tolerance?: number; minDistance?: number; smoothing?: number; closed?: boolean; maxPoints?: number }

/** Freehand samples become editable cubic anchors; no SVG string or raster is stored.
 * Tolerances are board units, so callers convert desired screen pixels by zoom. */
export function createPencilPath(samples: BoardPoint[], options: PencilOptions = {}): VectorPath {
  const minimum = Math.max(0, options.minDistance ?? .5), limit = Math.max(2, Math.floor(options.maxPoints ?? 2048))
  const filtered: BoardPoint[] = []
  for (const sample of samples) if (valid(sample) && (!filtered.length || dist(filtered.at(-1)!, sample) >= minimum)) filtered.push({ x: sample.x, y: sample.y })
  const last = samples.findLast(valid)
  if (last && filtered.length && dist(last, filtered.at(-1)!) > 1e-8) filtered.push({ ...last })
  const closed = Boolean(options.closed && filtered.length > 2)
  if (closed && dist(filtered[0], filtered.at(-1)!) <= minimum) filtered.pop()
  let anchors = simplify(filtered, Math.max(0, options.tolerance ?? 1.5))
  if (anchors.length > limit) anchors = Array.from({ length: limit }, (_, index) => anchors[Math.round(index * (anchors.length - 1) / (limit - 1))])
  const smoothing = Math.max(0, Math.min(1, options.smoothing ?? .7))
  const points: VectorPathPoint[] = anchors.map((point, index) => {
    if (!smoothing || anchors.length < 3) return { ...point }
    const previous = anchors[index - 1] || (closed ? anchors.at(-1)! : point), next = anchors[index + 1] || (closed ? anchors[0] : point)
    const direction = sub(next, previous), length = Math.hypot(direction.x, direction.y)
    if (length < 1e-9) return { ...point }
    const incoming = dist(previous, point) * smoothing / 3, outgoing = dist(point, next) * smoothing / 3, axis = mul(direction, 1 / length)
    return { ...point, ...(closed || index > 0 ? { handleIn: mul(axis, -incoming) } : {}), ...(closed || index < anchors.length - 1 ? { handleOut: mul(axis, outgoing) } : {}), handleMode: 'smooth' }
  })
  return { version: 1, closed: closed && points.length > 2, points }
}

function curveFor(path: VectorPath, index: number): Cubic {
  const from = path.points[index], to = path.points[(index + 1) % path.points.length]
  return { p0: from, p1: add(from, from.handleOut || { x: 0, y: 0 }), p2: add(to, to.handleIn || { x: 0, y: 0 }), p3: to }
}

function split(curve: Cubic, t: number): [Cubic, Cubic] {
  const a = mix(curve.p0, curve.p1, t), b = mix(curve.p1, curve.p2, t), c = mix(curve.p2, curve.p3, t)
  const d = mix(a, b, t), e = mix(b, c, t), point = mix(d, e, t)
  return [{ p0: curve.p0, p1: a, p2: d, p3: point }, { p0: point, p1: e, p2: c, p3: curve.p3 }]
}

function curveSlice(curve: Cubic, low: number, high: number): Cubic {
  const left = high < 1 ? split(curve, high)[0] : curve
  return low > 0 ? split(left, low / high)[1] : left
}

function sweepDistance(point: BoardPoint, sweep: BoardPoint[]) {
  if (sweep.length === 1) return dist(point, sweep[0])
  let minimum = Infinity
  for (let index = 1; index < sweep.length; index++) minimum = Math.min(minimum, distanceToSegment(point, sweep[index - 1], sweep[index]))
  return minimum
}

/** Erase intervals are located with a bounded geometric tolerance. Every surviving
 * section is the original cubic's exact De Casteljau slice, not a flattened redraw. */
export function eraseVectorPath(path: VectorPath, sweep: BoardPoint[], radius: number, tolerance = .1): { changed: boolean; paths: VectorPath[] } {
  const samples = sweep.filter(valid)
  if (!validEditablePath(path) || path.closed || !samples.length || !Number.isFinite(radius) || radius <= 0) return { changed: false, paths: [path] }
  const epsilon = Math.max(.001, Math.min(radius / 8, Number.isFinite(tolerance) ? tolerance : .1))
  const survivors: VectorPath[] = []
  let current: VectorPathPoint[] = [], changed = false
  const flush = () => { if (current.length > 1) survivors.push({ version: 1, closed: false, points: current }); current = [] }
  const appendCurve = (curve: Cubic) => {
    const outgoing = sub(curve.p1, curve.p0), incoming = sub(curve.p2, curve.p3)
    if (!current.length) current.push({ x: curve.p0.x, y: curve.p0.y, handleOut: outgoing, handleMode: 'corner' })
    else current[current.length - 1] = { ...current.at(-1)!, handleOut: outgoing, handleMode: 'corner' }
    current.push({ x: curve.p3.x, y: curve.p3.y, handleIn: incoming, handleMode: 'corner' })
  }
  for (let index = 0; index < path.points.length - 1; index++) {
    const original = curveFor(path, index), intervals: { low: number; high: number; keep: boolean }[] = []
    const locate = (curve: Cubic, low: number, high: number, depth: number) => {
      const halves = split(curve, .5), center = halves[0].p3
      const reach = Math.max(...[curve.p0, curve.p1, curve.p2, curve.p3].map((point) => dist(point, center))), d = sweepDistance(center, samples)
      // Distance to the swept centreline is 1-Lipschitz. These decisions are
      // certain for the whole control hull, including looping cubics.
      if (d - reach > radius) { intervals.push({ low, high, keep: true }); return }
      if (d + reach < radius) { intervals.push({ low, high, keep: false }); return }
      if (reach <= epsilon || depth >= 20) { intervals.push({ low, high, keep: d >= radius }); return }
      const middle = (low + high) / 2
      locate(halves[0], low, middle, depth + 1); locate(halves[1], middle, high, depth + 1)
    }
    locate(original, 0, 1, 0)
    const merged: typeof intervals = []
    for (const interval of intervals) {
      const previous = merged.at(-1)
      if (previous?.keep === interval.keep) previous.high = interval.high
      else merged.push({ ...interval })
    }
    for (const interval of merged) {
      if (interval.keep) appendCurve(curveSlice(original, interval.low, interval.high))
      else { changed = true; flush() }
    }
  }
  flush()
  return changed ? { changed: true, paths: survivors } : { changed: false, paths: [path] }
}

const CIRCLE_K = .5522847498307936
export function vectorCircle(center: BoardPoint, radius: number): VectorPath {
  const h = radius * CIRCLE_K
  return { version: 1, closed: true, points: [
    { x: center.x + radius, y: center.y, handleIn: { x: 0, y: -h }, handleOut: { x: 0, y: h } },
    { x: center.x, y: center.y + radius, handleIn: { x: h, y: 0 }, handleOut: { x: -h, y: 0 } },
    { x: center.x - radius, y: center.y, handleIn: { x: 0, y: h }, handleOut: { x: 0, y: -h } },
    { x: center.x, y: center.y - radius, handleIn: { x: -h, y: 0 }, handleOut: { x: h, y: 0 } },
  ] }
}

/** Capsule cutters keep a filled vector Eraser independent of canvas color. */
export function vectorEraserCutters(sweep: BoardPoint[], radius: number): VectorPath[] {
  const samples = sweep.filter(valid)
  if (!samples.length || !Number.isFinite(radius) || radius <= 0) return []
  if (samples.length === 1) return [vectorCircle(samples[0], radius)]
  const cutters: VectorPath[] = []
  for (let index = 1; index < samples.length; index++) {
    const a = samples[index - 1], b = samples[index], delta = sub(b, a), length = Math.hypot(delta.x, delta.y)
    if (length < 1e-8) continue
    const axis = mul(delta, 1 / length), normal = { x: -axis.y, y: axis.x }, cap = radius * CIRCLE_K
    const ar = add(a, mul(normal, radius)), br = add(b, mul(normal, radius)), end = add(b, mul(axis, radius))
    const bl = sub(b, mul(normal, radius)), al = sub(a, mul(normal, radius)), start = sub(a, mul(axis, radius))
    cutters.push({ version: 1, closed: true, points: [
      { ...ar, handleIn: mul(axis, -cap) },
      { ...br, handleOut: mul(axis, cap) },
      { ...end, handleIn: mul(normal, cap), handleOut: mul(normal, -cap) },
      { ...bl, handleIn: mul(axis, cap) },
      { ...al, handleOut: mul(axis, -cap) },
      { ...start, handleIn: mul(normal, -cap), handleOut: mul(normal, cap) },
    ] })
  }
  return cutters.length ? cutters : [vectorCircle(samples[0], radius)]
}

/** Converts live shapes to editable path geometry when a partial edit requires it. */
export function editableShapePath(node: BoardNode): VectorPath | undefined {
  if (node.kind !== 'shape') return undefined
  const w = node.width, h = node.height
  if (![node.x, node.y, w, h, node.rotation ?? 0].every(Number.isFinite) || w <= 0 || h <= 0
    || [node.x, node.y, w, h].some(value => Math.abs(value) > 1e9)) return undefined
  if (node.shapeType === 'line' || node.shapeType === 'arrow') {
    if (node.vectorTransform !== undefined || node.vectorBoolean !== undefined) return undefined
    // App paints only first/last anchors as a straight line. Intermediate
    // anchors and cubic controls are editable metadata, not visible line paint.
    // The CSS reverse transform is applied inside the article before rotation.
    if (node.vectorPath && (!Array.isArray(node.vectorPath.points) || node.vectorPath.points.length < 2)) return undefined
    const first = node.vectorPath ? node.vectorPath.points[0] : { x: 0, y: 0 }
    const last = node.vectorPath ? node.vectorPath.points.at(-1) : { x: w, y: h }
    if (!boundedPoint(first) || !boundedPoint(last)) return undefined
    return { version: 1, closed: false, points: [first, last].map((point) => ({ x: point.x, y: node.body === 'reverse' ? h - point.y : point.y })) }
  }
  // These ordinary CSS/SVG shapes do not consume stored inner path transforms
  // or Boolean metadata. Never erase an invisible derivative instead of paint.
  if ((node.shapeType === 'rectangle' || node.shapeType === 'ellipse')
    && (node.vectorPath !== undefined || node.vectorTransform !== undefined || node.vectorBoolean !== undefined)) return undefined
  if (node.vectorTransform !== undefined && (!node.vectorTransform || typeof node.vectorTransform !== 'object' || Array.isArray(node.vectorTransform)
    || Object.values(node.vectorTransform).some(value => value !== undefined && !Number.isFinite(value)))) return undefined
  if (node.vectorPath) return validEditablePath(node.vectorPath) ? node.vectorPath : undefined
  if (node.shapeType === 'ellipse') {
    const ellipse = vectorCircle({ x: 0, y: 0 }, 1)
    // The actual SVG uses rx/ry=49 in its normalized100 viewport. Converting
    // at50 grows untouched artwork as soon as a partial erasure is committed.
    return transformVectorPath(ellipse, { a: w * .49, b: 0, c: 0, d: h * .49, e: w / 2, f: h / 2 })
  }
  if (node.shapeType !== 'rectangle') return undefined
  const r = Math.max(0, Math.min(node.cornerRadius ?? 14, w / 2, h / 2)), k = r * CIRCLE_K
  if (!r) return { version: 1, closed: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }
  return { version: 1, closed: true, points: [
    { x: r, y: 0, handleIn: { x: -k, y: 0 } }, { x: w - r, y: 0, handleOut: { x: k, y: 0 } },
    { x: w, y: r, handleIn: { x: 0, y: -k } }, { x: w, y: h - r, handleOut: { x: 0, y: k } },
    { x: w - r, y: h, handleIn: { x: k, y: 0 } }, { x: r, y: h, handleOut: { x: -k, y: 0 } },
    { x: 0, y: h - r, handleIn: { x: 0, y: k } }, { x: 0, y: r, handleOut: { x: 0, y: -k } },
  ] }
}

function flatten(path: VectorPath, tolerance = .25): BoardPoint[] {
  const points: BoardPoint[] = path.points.length ? [path.points[0]] : []
  const visit = (curve: Cubic, depth: number) => {
    if (depth >= 15 || Math.max(distanceToSegment(curve.p1, curve.p0, curve.p3), distanceToSegment(curve.p2, curve.p0, curve.p3)) <= tolerance) { points.push(curve.p3); return }
    const [left, right] = split(curve, .5); visit(left, depth + 1); visit(right, depth + 1)
  }
  for (let index = 0; index < (path.closed ? path.points.length : path.points.length - 1); index++) visit(curveFor(path, index), 0)
  return points
}

function inside(point: BoardPoint, polygon: BoardPoint[], evenOdd = false) {
  let winding = 0
  for (let index = 1; index < polygon.length; index++) {
    const a = polygon[index - 1], b = polygon[index], cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
    if (a.y <= point.y && b.y > point.y && cross > 0) winding++
    if (a.y > point.y && b.y <= point.y && cross < 0) winding--
  }
  return evenOdd ? Math.abs(winding) % 2 === 1 : winding !== 0
}

function localizeNode(node: BoardNode, path: VectorPath, operands?: VectorPath[]): BoardNode {
  const bounds = vectorPathBounds(path), x = bounds.left, y = bounds.top
  const translate = (value: VectorPath) => transformVectorPath(value, { a: 1, b: 0, c: 0, d: 1, e: -x, f: -y })
  return { ...node, shapeType: 'path', x, y, width: Math.max(1, bounds.right - x), height: Math.max(1, bounds.bottom - y), rotation: 0, vectorTransform: undefined, vectorPath: translate(path), vectorBoolean: operands ? { operation: 'subtract', operands: operands.map(translate) } : undefined }
}

export type VectorEraseResult = { changed: boolean; nodes: BoardNode[]; unsupported?: string }

/** Erasure runs in board space, giving a circular brush even on flipped/skewed paths.
 * Filled paths retain editable subtraction operands; open paths become exact cubic fragments.
 * Imported media and non-subtract Boolean expressions are intentionally unsupported. */
export function eraseVectorNode(node: BoardNode, sweep: BoardPoint[], radius: number, options: { tolerance?: number; idFactory?: () => string } = {}): VectorEraseResult {
  const path = editableShapePath(node), samples = sweep.filter(valid)
  if (node.locked || !samples.length || !Number.isFinite(radius) || radius <= 0) return { changed: false, nodes: [node] }
  if (!path) return { changed: false, nodes: [node], unsupported: 'Eraser edits vector shapes only; source media is preserved.' }
  // Rebasing a surviving contour currently has no corresponding caption
  // layout transform. Refuse instead of deleting ordinary shape labels or
  // moving a diagram caption when rotation/inner affine is baked into paths.
  if (node.diagramShape || ((node.shapeType === 'rectangle' || node.shapeType === 'ellipse') && Boolean(node.body))) return { changed: false, nodes: [node], unsupported: 'Captioned shapes retain their text; partial erasure needs shared caption geometry.' }
  // The CSS rectangle paints a background, inset border and drop shadow.
  // Rebasing it into one SVG path would move that border to a centered stroke
  // and discard the shadow. Preserve it until the whole prepared appearance
  // can be clipped by canonical erasure operands without changing its skin.
  if (node.shapeType === 'rectangle') return { changed: false, nodes: [node], unsupported: 'Rectangle appearance is preserved; erasure needs shared inset-border and shadow paint.' }
  if (node.vectorBoolean && node.vectorBoolean.operation !== 'subtract') return { changed: false, nodes: [node], unsupported: 'Resolve Union/Intersect/Exclude before partial erasure.' }
  if (node.vectorBoolean && (!Array.isArray(node.vectorBoolean.operands) || node.vectorBoolean.operands.length < 2
    || node.vectorBoolean.operands.some(operand => !validEditablePath(operand) || !operand.closed))) return { changed: false, nodes: [node], unsupported: 'Invalid subtraction geometry; the original artwork is preserved.' }
  if (node.shapeType === 'arrow') return { changed: false, nodes: [node], unsupported: 'Arrow semantics are preserved; convert the arrow to an ordinary path before erasing.' }
  const matrix = vectorNodeMatrix(node)
  if (![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
    || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-10) return { changed: false, nodes: [node], unsupported: 'Singular vector transform; the original artwork is preserved.' }
  const worldPath = transformVectorPath(path, matrix)
  if (!validEditablePath(worldPath)) return { changed: false, nodes: [node], unsupported: 'Invalid world geometry; the original artwork is preserved.' }
  if (!path.closed) {
    const erased = eraseVectorPath(worldPath, samples, radius, options.tolerance)
    if (!erased.changed) return { changed: false, nodes: [node] }
    const idFactory = options.idFactory || (() => `path-${crypto.randomUUID()}`)
    // A plain line's displayed width is65% of its saved width and its SVG
    // ignores authored path cap/join fields. Preserve that actual stroke when
    // surviving straight sections become ordinary editable paths.
    const source = node.shapeType === 'line' ? { ...node, body: '', strokeWidth: (node.strokeWidth ?? 2) * .65,
      vectorStrokeCap: 'butt' as const, vectorStrokeJoin: 'miter' as const } : node
    return { changed: true, nodes: erased.paths.map((part, index) => localizeNode({ ...source, id: index ? idFactory() : node.id }, part)) }
  }
  const operands = node.vectorBoolean ? node.vectorBoolean.operands.map((value) => transformVectorPath(value, matrix)) : [worldPath]
  const contours = operands.map((value) => flatten(value, options.tolerance ?? .25))
  const filled = (point: BoardPoint) => inside(point, contours[0], node.vectorFillRule === 'evenodd') && !contours.slice(1).some((contour) => inside(point, contour))
  let hit = samples.some(filled)
  // Crossing a thin object may have no sample inside it. Exact segment distance
  // on the flattened boundary avoids work proportional to artwork size / brush
  // radius (a tiny brush on a million-unit line must not freeze the UI).
  if (!hit) for (const contour of contours) for (let index = 1; index < contour.length && !hit; index++) {
    const a = contour[index - 1], b = contour[index]
    if (samples.length === 1) hit = distanceToSegment(samples[0], a, b) <= radius
    else for (let sample = 1; sample < samples.length && !hit; sample++) hit = segmentDistance(a, b, samples[sample - 1], samples[sample]) <= radius
  }
  if (!hit) return { changed: false, nodes: [node] }
  // Simplify noisy pointer samples before storing portable capsule contours.
  const cutters = vectorEraserCutters(simplify(samples, Math.max(.1, radius / 12)), radius)
  return { changed: true, nodes: [localizeNode(node, operands[0], [...operands, ...cutters])] }
}

export type StrokeProfile = 'uniform' | 'calligraphic-ribbon' | 'taper-both' | 'taper-start' | 'taper-end'

/** Converts an open centerline into an exact closed contour with variable width / calligraphic profile.
 * Preserves smooth Bézier tangents for Vello antialiasing and GPU acceleration. */
export function createTaperedStrokeContour(
  path: VectorPath,
  baseWidth: number,
  profile: StrokeProfile = 'calligraphic-ribbon',
  options: { stepsPerSegment?: number; smoothing?: number } = {},
): VectorPath {
  if (!validEditablePath(path) || path.closed || baseWidth <= 0) return path
  const steps = Math.max(8, options.stepsPerSegment ?? 16)
  const segmentCount = path.points.length - 1
  const totalSamples = segmentCount * steps

  const widthFactor = (u: number): number => {
    switch (profile) {
      case 'calligraphic-ribbon':
        return Math.sin(u * Math.PI) * 1.35 + 0.15
      case 'taper-both':
        return Math.sin(u * Math.PI)
      case 'taper-start':
        return Math.sin((u * Math.PI) / 2)
      case 'taper-end':
        return Math.cos((u * Math.PI) / 2)
      case 'uniform':
      default:
        return 1.0
    }
  }

  const leftPoints: BoardPoint[] = []
  const rightPoints: BoardPoint[] = []

  for (let seg = 0; seg < segmentCount; seg++) {
    const curve = curveFor(path, seg)
    const startStep = seg === 0 ? 0 : 1
    for (let s = startStep; s <= steps; s++) {
      const t = s / steps
      const u = (seg * steps + s) / totalSamples
      const pt = mix(
        mix(mix(curve.p0, curve.p1, t), mix(curve.p1, curve.p2, t), t),
        mix(mix(curve.p1, curve.p2, t), mix(curve.p2, curve.p3, t), t),
        t,
      )
      const dt = 1e-4
      const tA = Math.max(0, t - dt), tB = Math.min(1, t + dt)
      const ptA = mix(
        mix(mix(curve.p0, curve.p1, tA), mix(curve.p1, curve.p2, tA), tA),
        mix(mix(curve.p1, curve.p2, tA), mix(curve.p2, curve.p3, tA), tA),
        tA,
      )
      const ptB = mix(
        mix(mix(curve.p0, curve.p1, tB), mix(curve.p1, curve.p2, tB), tB),
        mix(mix(curve.p1, curve.p2, tB), mix(curve.p2, curve.p3, tB), tB),
        tB,
      )
      const delta = sub(ptB, ptA)
      const len = Math.hypot(delta.x, delta.y) || 1
      const normal = { x: -delta.y / len, y: delta.x / len }
      const halfW = (baseWidth * widthFactor(u)) / 2

      leftPoints.push(add(pt, mul(normal, halfW)))
      rightPoints.push(sub(pt, mul(normal, halfW)))
    }
  }

  const contour = [...leftPoints, ...rightPoints.reverse()]
  return createPencilPath(contour, { closed: true, tolerance: 0.3, smoothing: options.smoothing ?? 0.65 })
}

/** Generates a stylized almond-shaped eye contour with sharp corners and smooth arcs.
 * Used for character illustration and repeat pattern motifs. */
export function createStylizedEyeContour(
  center: BoardPoint,
  width: number,
  height: number,
  pupilRadiusRatio = 0.32,
): { outer: VectorPath; pupil: VectorPath } {
  const hw = width / 2, hh = height / 2
  const kx = hw * 0.55, ky = hh * 0.95
  const outer: VectorPath = {
    version: 1,
    closed: true,
    points: [
      { x: center.x - hw, y: center.y, handleOut: { x: kx, y: -ky }, handleMode: 'corner' },
      { x: center.x, y: center.y - hh, handleIn: { x: -kx * 0.6, y: 0 }, handleOut: { x: kx * 0.6, y: 0 }, handleMode: 'smooth' },
      { x: center.x + hw, y: center.y, handleIn: { x: -kx, y: -ky }, handleOut: { x: -kx, y: ky }, handleMode: 'corner' },
      { x: center.x, y: center.y + hh, handleIn: { x: kx * 0.6, y: 0 }, handleOut: { x: -kx * 0.6, y: 0 }, handleMode: 'smooth' },
    ],
  }
  const pr = Math.min(hw, hh) * pupilRadiusRatio
  const pupil = vectorCircle(center, pr)
  return { outer, pupil }
}

/** Computes zoom-adaptive tolerance in board coordinates so drawing simplification
 * maintains consistent screen-pixel fidelity across any canvas zoom level. */
export function adaptivePencilTolerance(zoom: number, screenTolerancePixels = 1.5): number {
  const safeZoom = Math.max(0.001, Math.min(100, Number.isFinite(zoom) ? zoom : 1))
  return Math.max(0.05, screenTolerancePixels / safeZoom)
}

/** Evaluates the exact cubic Bézier first derivative (velocity vector) B'(t). */
export function cubicDerivative(curve: Cubic, t: number): BoardPoint {
  const u = 1 - t
  // B'(t) = 3(1-t)^2 (p1 - p0) + 6(1-t)t (p2 - p1) + 3t^2 (p3 - p2)
  const d0 = sub(curve.p1, curve.p0)
  const d1 = sub(curve.p2, curve.p1)
  const d2 = sub(curve.p3, curve.p2)
  return {
    x: 3 * u * u * d0.x + 6 * u * t * d1.x + 3 * t * t * d2.x,
    y: 3 * u * u * d0.y + 6 * u * t * d1.y + 3 * t * t * d2.y,
  }
}

/** Computes the arc length of a cubic Bézier curve using 5-point Gauss-Legendre quadrature. */
export function cubicArcLength(curve: Cubic): number {
  // 5-point Gauss-Legendre nodes and weights on [-1, 1] mapped to [0, 1]
  const nodes = [
    0.5,
    0.5 - 0.5 * 0.538469310105683,
    0.5 + 0.5 * 0.538469310105683,
    0.5 - 0.5 * 0.906179845938664,
    0.5 + 0.5 * 0.906179845938664,
  ]
  const weights = [
    0.5 * 0.568888888888889,
    0.5 * 0.478628670499366,
    0.5 * 0.478628670499366,
    0.5 * 0.236926885056189,
    0.5 * 0.236926885056189,
  ]

  let length = 0
  for (let i = 0; i < 5; i++) {
    const vel = cubicDerivative(curve, nodes[i])
    const speed = Math.hypot(vel.x, vel.y)
    length += weights[i] * speed
  }
  return length
}

/** Computes the total arc length of a vector path across all segments. */
export function pathArcLength(path: VectorPath): number {
  if (!path || !path.points || path.points.length < 2) return 0
  const count = path.closed ? path.points.length : path.points.length - 1
  let total = 0
  for (let i = 0; i < count; i++) {
    const c = curveFor(path, i)
    total += cubicArcLength(c)
  }
  return total
}

