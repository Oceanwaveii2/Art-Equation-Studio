import type { CanvasRect, CanvasSceneObject, CanvasSceneSnapshot, CanvasVectorCommand, CanvasViewport } from '../canvas-engine/contracts'
import type { DecodedImageUpload, PaintMatrix, PaintOperation } from '../canvas-engine/paintDisplayList'
import { borderBoxSize, captureMeasuredCardPaint, measuredLinearWorld, normalizeCornerRadii, normalizeMeasuredColor, reconstructWorldMatrix, roundedRectCommands } from './measuredCardPaint.ts'
import { parseMeasuredBackground, resolveMeasuredBackgroundGeometry, measuredBackgroundGradientOperation, type MeasuredBackgroundLayer } from './measuredBackgroundPaint.ts'

type Size = Readonly<{ width: number; height: number }>
type Radii = readonly (readonly [number, number])[]
type Stop = Readonly<{ offset: number; color: string }>
const LIMIT = 1_000_000
const finite = (...values: number[]) => values.every(value => Number.isFinite(value) && Math.abs(value) <= LIMIT)
const identity: PaintMatrix = [1, 0, 0, 1, 0, 0]
const px = (value: string) => /^-?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(value) ? Number.parseFloat(value) : value === '0' ? 0 : NaN
const rectCommands = (rect: CanvasRect): readonly CanvasVectorCommand[] => [['M', rect.x, rect.y], ['L', rect.x + rect.width, rect.y], ['L', rect.x + rect.width, rect.y + rect.height], ['L', rect.x, rect.y + rect.height], ['Z']]
const shift = (commands: readonly CanvasVectorCommand[], x: number, y: number) => commands.map(command => command.map((value, index) => index === 0 ? value : typeof value === 'number' ? value + (index % 2 ? x : y) : value) as unknown as CanvasVectorCommand)
const union = (a: CanvasRect, b: CanvasRect): CanvasRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) })
function bounds(size: Size, matrix: PaintMatrix): CanvasRect {
  const [a, b, c, d, e, f] = matrix, xs = [e, a * size.width + e, c * size.height + e, a * size.width + c * size.height + e], ys = [f, b * size.width + f, d * size.height + f, b * size.width + d * size.height + f]
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

/** Tokenize computed CSS without splitting rgba(), nested functions or quoted URLs. */
export function splitCssPaintList(source: string): string[] {
  const result: string[] = []; let start = 0, depth = 0, quote = '', escape = false
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (escape) { escape = false; continue }
    if (character === '\\') { escape = true; continue }
    if (quote) { if (character === quote) quote = ''; continue }
    if (character === '"' || character === "'") { quote = character; continue }
    if (character === '(') depth++
    else if (character === ')') { if (--depth < 0) throw new Error('CARD_CSS_INVALID: unmatched function') }
    else if (character === ',' && depth === 0) { result.push(source.slice(start, index).trim()); start = index + 1 }
  }
  if (quote || depth || escape) throw new Error('CARD_CSS_INVALID: incomplete function')
  result.push(source.slice(start).trim())
  if (result.length > 32 || result.some(part => !part)) throw new Error('CARD_CSS_INVALID: paint layer limit')
  return result
}

export type MeasuredLinearGradient = Readonly<{ kind: 'linear'; start: readonly [number, number]; end: readonly [number, number]; stops: readonly Stop[]; interpolation: 'srgb'; alphaInterpolation: 'premultiplied' }>
/** CSS gradient line passes through the box center; diagonal direction uses
 * the CSS magic-corner line length, never the AABB diagonal. Computed sRGB
 * colors and fixed/percentage stops only; hints/repeating/other spaces refuse. */
export function parseMeasuredLinearGradient(source: string, size: Size): MeasuredLinearGradient {
  if (!finite(size.width, size.height) || size.width <= 0 || size.height <= 0) throw new Error('CARD_GRADIENT_INVALID: size')
  const match = /^linear-gradient\((.*)\)$/.exec(source.trim())
  if (!match) throw new Error('CARD_GRADIENT_UNSUPPORTED: only computed linear gradient')
  const tokens = splitCssPaintList(match[1]); let angle = Math.PI, first = tokens[0]
  const explicit = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(deg|rad|grad|turn)$/.exec(first)
  if (explicit) { const amount = Number(explicit[1]); angle = amount * ({ deg: Math.PI / 180, rad: 1, grad: Math.PI / 200, turn: 2 * Math.PI }[explicit[2]]!); tokens.shift() }
  else if (first.startsWith('to ')) {
    const words = first.slice(3).split(/\s+/), x = words.includes('right') ? 1 : words.includes('left') ? -1 : 0, y = words.includes('bottom') ? 1 : words.includes('top') ? -1 : 0
    if (!words.length || words.length > 2 || words.some(word => !['right', 'left', 'top', 'bottom'].includes(word)) || words.includes('right') && words.includes('left') || words.includes('top') && words.includes('bottom')) throw new Error('CARD_GRADIENT_UNSUPPORTED: direction')
    angle = x && y ? Math.atan2(x * size.height, -y * size.width) : Math.atan2(x, -y); tokens.shift()
  }
  const dx = Math.sin(angle), dy = -Math.cos(angle), length = Math.abs(size.width * dx) + Math.abs(size.height * dy)
  if (!finite(angle, length) || length <= 0 || tokens.length < 2 || tokens.length > 64) throw new Error('CARD_GRADIENT_INVALID: stops')
  const stops: { offset: number | null; color: string }[] = []
  for (const token of tokens) {
    const colorEnd = token.indexOf('(') >= 0 ? (() => { let depth = 0; for (let index = token.indexOf('('); index < token.length; index++) { if (token[index] === '(') depth++; else if (token[index] === ')' && --depth === 0) return index + 1 } return 0 })() : token.indexOf(' ')
    const colorText = colorEnd > 0 ? token.slice(0, colorEnd) : token, color = normalizeMeasuredColor(colorText)
    if (!color) throw new Error('CARD_GRADIENT_UNSUPPORTED: computed color')
    const positions = (colorEnd > 0 ? token.slice(colorEnd).trim() : '').split(/\s+/).filter(Boolean)
    if (positions.length > 2) throw new Error('CARD_GRADIENT_UNSUPPORTED: color hint')
    for (const position of positions.length ? positions : ['']) {
      const offset = !position ? null : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(position) ? Number.parseFloat(position) / 100 : px(position) / length
      if (offset !== null && !finite(offset)) throw new Error('CARD_GRADIENT_UNSUPPORTED: stop unit')
      stops.push({ offset, color })
    }
  }
  stops[0].offset ??= 0; stops.at(-1)!.offset ??= 1
  let previous = -Infinity
  for (const stop of stops) if (stop.offset !== null) { stop.offset = Math.max(previous, stop.offset); previous = stop.offset }
  for (let index = 0; index < stops.length; index++) if (stops[index].offset === null) {
    const from = index - 1; let to = index; while (stops[to].offset === null) to++
    for (let current = index; current < to; current++) stops[current].offset = stops[from].offset! + (stops[to].offset! - stops[from].offset!) * (current - from) / (to - from)
    index = to
  }
  // Preserve out-of-range stops by extending the gradient line itself. The
  // renderer contract deliberately requires normalized ordered stop offsets.
  const low = Math.min(0, stops[0].offset!), high = Math.max(1, stops.at(-1)!.offset!), cx = size.width / 2, cy = size.height / 2
  return { kind: 'linear', start: [cx + dx * length * (low - .5), cy + dy * length * (low - .5)], end: [cx + dx * length * (high - .5), cy + dy * length * (high - .5)], stops: stops.map(stop => ({ color: stop.color, offset: (stop.offset! - low) / (high - low) })), interpolation: 'srgb', alphaInterpolation: 'premultiplied' }
}

export type MeasuredBoxShadow = Readonly<{ color: string; offsetX: number; offsetY: number; blur: number; spread: number; inset: boolean }>
/** CSS Backgrounds3 spread correction preserves sharp corners when a small
 * corner grows; shrinking corners use ordinary subtraction and zero floor. */
export function measuredShadowRadius(radius: number, growth: number): number {
  if (!finite(radius, growth) || radius < 0) throw new Error('CARD_SHADOW_INVALID: radius')
  const spread = growth > radius ? growth * (1 + (radius / growth - 1) ** 3) : growth
  return Math.max(0, radius + spread)
}
export function parseMeasuredBoxShadows(source: string): readonly MeasuredBoxShadow[] {
  if (source === 'none') return []
  return splitCssPaintList(source).map(token => {
    const inset = /(?:^|\s)inset(?:\s|$)/.test(token); token = token.replace(/(?:^|\s)inset(?=\s|$)/, ' ').trim()
    const colorMatch = /(?:rgba?\([^)]*\)|color\(srgb[^)]*\))/.exec(token)
    if (!colorMatch) throw new Error('CARD_SHADOW_UNSUPPORTED: computed color')
    const color = normalizeMeasuredColor(colorMatch[0]), lengths = token.replace(colorMatch[0], '').trim().split(/\s+/).map(px)
    if (!color || lengths.length < 2 || lengths.length > 4 || !lengths.every(value => finite(value)) || (lengths[2] ?? 0) < 0) throw new Error('CARD_SHADOW_INVALID: computed geometry')
    return { color, offsetX: lengths[0], offsetY: lengths[1], blur: lengths[2] ?? 0, spread: lengths[3] ?? 0, inset }
  })
}

export type QualifiedCardContribution = Readonly<{
  completePaint: boolean; sourceFingerprint: string; operations: readonly PaintOperation[]
  uploads?: readonly DecodedImageUpload[]; visualBounds: CanvasRect; blockers?: readonly string[]
}>
export type CompleteCardBox = Readonly<{
  id: string; size: Size; transform: PaintMatrix; radii: Radii; background: string
  gradients: readonly MeasuredLinearGradient[]; gradientOrigin?: CanvasRect; shadows: readonly MeasuredBoxShadow[]
  backgrounds?: readonly QualifiedCardContribution[]
  borderWidths: readonly [number, number, number, number]; borderColors: readonly [string, string, string, string]
  opacity: number; clipContent: boolean; isolation: 'auto' | 'isolate'; blendMode: 'normal' | 'multiply' | 'screen'
  zIndex: number; sourceOrder: number; contributions: readonly QualifiedCardContribution[]; children: readonly CompleteCardBox[]
  /** Only a solid outline whose outer edge is exactly the border-box edge is
   * qualified. Other outline offsets/patterns retain browser ownership. */
  insetOutline?: Readonly<{ width: number; color: string }>
}>
export type {CompleteCardPaintResult} from '../canvas-engine/completePaint'
import type {CompleteCardPaintResult} from '../canvas-engine/completePaint'
function insetContour(box: CompleteCardBox) {
  const [top, right, bottom, left] = box.borderWidths, size = { width: box.size.width - left - right, height: box.size.height - top - bottom }
  if (size.width <= 0 || size.height <= 0) return { commands: [] as readonly CanvasVectorCommand[], radii: [] as Radii, size, x: left, y: top }
  const values = box.radii.map(([x, y], index) => [Math.max(0, x - (index === 0 || index === 3 ? left : right)), Math.max(0, y - (index < 2 ? top : bottom))] as const)
  const radii = normalizeCornerRadii(values.map(([x, y]) => `${x}px ${y}px`) as [string, string, string, string], size)!
  return { commands: shift(roundedRectCommands(size, radii), left, top), radii, size, x: left, y: top }
}
const vector = (id: string, commands: readonly CanvasVectorCommand[], transform: PaintMatrix, fill: string, fillRule: 'nonzero' | 'evenodd' = 'nonzero'): PaintOperation => ({ type: 'vector', object: { id, kind: 'vector', transform, payload: { commands, fill, vectorFillRule: fillRule, strokeWidth: 0 } } })
const clip = (scopeId: string, commands: readonly CanvasVectorCommand[], transform: PaintMatrix, fillRule: 'nonzero' | 'evenodd' = 'nonzero'): PaintOperation => ({ type: 'pushClip', scopeId, commands, transform, fillRule, isolation: 'isolated' })
const pop = (scopeId: string): PaintOperation => ({ type: 'pop', scopeId })

export function measuredInsetSolidOutline(style: Pick<CSSStyleDeclaration, 'outlineStyle' | 'outlineWidth' | 'outlineOffset' | 'outlineColor'>): CompleteCardBox['insetOutline'] | null {
  const width = px(style.outlineWidth)
  if (style.outlineStyle === 'none' || width === 0) return undefined
  const offset = px(style.outlineOffset), color = normalizeMeasuredColor(style.outlineColor)
  if (style.outlineStyle !== 'solid' || !finite(width, offset) || width <= 0 || Math.abs(offset + width) > 1e-7 || !color) return null
  return { width, color }
}

/** Actual ordered paint compilation, not another surface measurement. Any
 * missing glyph/image/provider paint discards the whole object contribution;
 * callers can retain its semantic paint until a complete frame is accepted. */
export function compileCompleteCardPaint(box: CompleteCardBox, identityData: Omit<CompleteCardPaintResult, 'status' | 'completePaint' | 'operations' | 'uploads' | 'visualBounds' | 'blockers'>): CompleteCardPaintResult {
  const operations: PaintOperation[] = [], uploads: DecodedImageUpload[] = [], blockers: string[] = [], ids = new Set<string>()
  let count = 0
  const visit = (current: CompleteCardBox, depth: number): CanvasRect => {
    if (++count > 512 || depth > 32 || !current.id || ids.has(current.id) || !finite(current.size.width, current.size.height, ...current.transform, current.opacity, current.zIndex, current.sourceOrder) || current.size.width <= 0 || current.size.height <= 0 || current.transform.length !== 6 || Math.abs(current.transform[0] * current.transform[3] - current.transform[1] * current.transform[2]) < 1e-12 || current.opacity < 0 || current.opacity > 1 || current.radii.length !== 4 || current.radii.some(pair => pair.length !== 2 || !finite(...pair) || pair.some(value => value < 0)) || current.borderWidths.length !== 4 || current.borderWidths.some(value => !finite(value) || value < 0) || current.borderColors.length !== 4 || !/^#[a-f0-9]{8}$/i.test(current.background) || current.borderColors.some(color => !/^#[a-f0-9]{8}$/i.test(color)) || !['normal', 'multiply', 'screen'].includes(current.blendMode)) throw new Error('CARD_PAINT_INVALID: box geometry/style/tree')
    ids.add(current.id)
    const outline = current.insetOutline
    if (outline && (!finite(outline.width) || outline.width <= 0 || outline.width * 2 >= Math.min(current.size.width, current.size.height) || !/^#[a-f0-9]{8}$/i.test(outline.color))) throw new Error('CARD_INSET_OUTLINE_GEOMETRY_UNSUPPORTED')
    const outer = roundedRectCommands(current.size, current.radii), inner = insetContour(current)
    let envelope = bounds(current.size, current.transform)
    for (const contribution of [...(current.backgrounds ?? []), ...current.contributions]) {
      if (!contribution.completePaint || contribution.sourceFingerprint !== identityData.sourceFingerprint || contribution.blockers?.length) blockers.push(...(contribution.blockers?.length ? contribution.blockers : ['CARD_CONTENT_PAINT_INCOMPLETE']))
      if (!finite(contribution.visualBounds.x, contribution.visualBounds.y, contribution.visualBounds.width, contribution.visualBounds.height) || contribution.visualBounds.width < 0 || contribution.visualBounds.height < 0) throw new Error('CARD_PAINT_INVALID: provider bounds')
      envelope = union(envelope, contribution.visualBounds)
    }
    for (const shadow of current.shadows) {
      if (!finite(shadow.offsetX, shadow.offsetY, shadow.blur, shadow.spread) || shadow.blur < 0 || !/^#[a-f0-9]{8}$/i.test(shadow.color)) throw new Error('CARD_SHADOW_INVALID: geometry')
      if (!shadow.inset) { const spread = shadow.spread + shadow.blur * 2, expanded = { width: current.size.width + 2 * spread, height: current.size.height + 2 * spread }; if (expanded.width > 0 && expanded.height > 0) envelope = union(envelope, bounds(expanded, [current.transform[0], current.transform[1], current.transform[2], current.transform[3], current.transform[4] + current.transform[0] * (shadow.offsetX - spread) + current.transform[2] * (shadow.offsetY - spread), current.transform[5] + current.transform[1] * (shadow.offsetX - spread) + current.transform[3] * (shadow.offsetY - spread)])) }
    }
    const start = operations.length, children = [...current.children].sort((a, b) => a.zIndex - b.zIndex || a.sourceOrder - b.sourceOrder)
    // CSS shadow lists paint first-listed shadows on top.
    const circular = current.radii.every(([x, y]) => Math.abs(x - current.radii[0][0]) < 1e-6 && Math.abs(y - x) < 1e-6)
    for (const [index, shadow] of [...current.shadows.entries()].reverse()) {
      if (shadow.inset || shadow.color.endsWith('00')) continue
      if (!circular) { blockers.push('CARD_ASYMMETRIC_SHADOW_PENDING'); continue }
      const width = current.size.width + 2 * shadow.spread, height = current.size.height + 2 * shadow.spread
      if (width <= 0 || height <= 0) continue
      const extent = shadow.blur * 2 + Math.abs(shadow.spread) + Math.max(Math.abs(shadow.offsetX), Math.abs(shadow.offsetY)) + 1
      const scope = `${current.id}:outer-shadow-${index}`, expanded = rectCommands({ x: -extent, y: -extent, width: current.size.width + 2 * extent, height: current.size.height + 2 * extent })
      operations.push(clip(scope, [...expanded, ...outer], current.transform, 'evenodd'))
      operations.push({ type: 'blurredRoundedRect', id: scope + ':blur', rect: { x: shadow.offsetX - shadow.spread, y: shadow.offsetY - shadow.spread, width, height }, radius: measuredShadowRadius(current.radii[0][0], shadow.spread), stdDeviation: shadow.blur / 2, color: shadow.color, transform: current.transform })
      operations.push(pop(scope))
    }
    if (!current.background.endsWith('00')) operations.push(vector(current.id + ':background', outer, current.transform, current.background))
    // Qualified CSS layers paint behind borders/content, in back-to-front
    // order, under the same rounded border clip as the original card.
    for (const [index, contribution] of (current.backgrounds ?? []).entries()) {
      const scope = `${current.id}:background-layer-${index}`
      operations.push(clip(scope, outer, current.transform), ...contribution.operations, pop(scope))
      uploads.push(...(contribution.uploads ?? []))
    }
    for (let index = current.gradients.length - 1; index >= 0; index--) {
      const origin = current.gradientOrigin
      if (!origin) { operations.push({ type: 'gradient', id: `${current.id}:gradient-${index}`, commands: outer, transform: current.transform, brushTransform: identity, fillRule: 'nonzero', gradient: current.gradients[index] }); continue }
      if (!finite(origin.x, origin.y, origin.width, origin.height) || origin.width <= 0 || origin.height <= 0) throw new Error('CARD_GRADIENT_INVALID: origin')
      const scope = `${current.id}:gradient-${index}:clip`, source = current.gradients[index]
      operations.push(clip(scope, outer, current.transform))
      const startX = Math.floor(-origin.x / origin.width), endX = Math.ceil((current.size.width - origin.x) / origin.width), startY = Math.floor(-origin.y / origin.height), endY = Math.ceil((current.size.height - origin.y) / origin.height)
      if ((endX - startX) * (endY - startY) > 64) throw new Error('CARD_GRADIENT_TILE_LIMIT')
      for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
        const ox = origin.x + x * origin.width, oy = origin.y + y * origin.height
        operations.push({ type: 'gradient', id: `${current.id}:gradient-${index}:tile-${x}-${y}`, commands: rectCommands({ x: ox, y: oy, width: origin.width, height: origin.height }), transform: current.transform, brushTransform: identity, fillRule: 'nonzero', gradient: { ...source, start: [source.start[0] + ox, source.start[1] + oy], end: [source.end[0] + ox, source.end[1] + oy] } })
      }
      operations.push(pop(scope))
    }
    for (const [index, shadow] of [...current.shadows.entries()].reverse()) {
      if (!shadow.inset || shadow.color.endsWith('00') || !inner.commands.length) continue
      if (!circular || !inner.radii.every(([x, y]) => Math.abs(x - inner.radii[0][0]) < 1e-6 && Math.abs(y - x) < 1e-6)) { blockers.push('CARD_ASYMMETRIC_SHADOW_PENDING'); continue }
      const scope = `${current.id}:inset-shadow-${index}`, punch = scope + ':hole', width = inner.size.width - 2 * shadow.spread, height = inner.size.height - 2 * shadow.spread
      operations.push(clip(scope, inner.commands, current.transform), { type: 'pushComposite', scopeId: scope + ':color', commands: inner.commands, transform: current.transform, fillRule: 'nonzero', isolation: 'isolated', opacity: 1, blendMode: 'normal' }, vector(scope + ':fill', inner.commands, current.transform, shadow.color))
      if (width > 0 && height > 0) operations.push({ type: 'pushComposite', scopeId: punch, commands: inner.commands, transform: current.transform, fillRule: 'nonzero', isolation: 'isolated', opacity: 1, blendMode: 'destination-out' } as PaintOperation,
        { type: 'blurredRoundedRect', id: punch + ':blur', rect: { x: inner.x + shadow.offsetX + shadow.spread, y: inner.y + shadow.offsetY + shadow.spread, width, height }, radius: measuredShadowRadius(inner.radii[0][0], -shadow.spread), stdDeviation: shadow.blur / 2, color: '#ffffffff', transform: current.transform }, pop(punch))
      operations.push(pop(scope + ':color'), pop(scope))
    }
    const ring = [...outer, ...inner.commands]
    if (current.borderWidths.some(width => width > 0)) {
      const [top, right, bottom, left] = current.borderWidths, w = current.size.width, h = current.size.height
      const sides: readonly (readonly CanvasVectorCommand[])[] = [ [['M', 0, 0], ['L', w, 0], ['L', w - right, top], ['L', left, top], ['Z']], [['M', w, 0], ['L', w, h], ['L', w - right, h - bottom], ['L', w - right, top], ['Z']], [['M', 0, h], ['L', w, h], ['L', w - right, h - bottom], ['L', left, h - bottom], ['Z']], [['M', 0, 0], ['L', left, top], ['L', left, h - bottom], ['L', 0, h], ['Z']] ]
      const same = current.borderColors.every(color => color === current.borderColors[0])
      if (same) operations.push(vector(current.id + ':border', ring, current.transform, current.borderColors[0], 'evenodd'))
      else for (let index = 0; index < 4; index++) if (current.borderWidths[index] > 0 && !current.borderColors[index].endsWith('00')) { const scope = `${current.id}:border-side-${index}`; operations.push(clip(scope, sides[index], current.transform), vector(scope + ':paint', ring, current.transform, current.borderColors[index], 'evenodd'), pop(scope)) }
    }
    const content = current.id + ':content'
    if (current.clipContent && inner.commands.length) operations.push(clip(content, inner.commands, current.transform))
    if (current.clipContent && !inner.commands.length && (current.children.length || current.contributions.length)) blockers.push('CARD_EMPTY_CONTENT_CLIP')
    for (const child of children.filter(child => child.zIndex < 0)) envelope = union(envelope, visit(child, depth + 1))
    for (const contribution of current.contributions) { operations.push(...contribution.operations); uploads.push(...(contribution.uploads ?? [])) }
    for (const child of children.filter(child => child.zIndex >= 0)) envelope = union(envelope, visit(child, depth + 1))
    if (current.clipContent && inner.commands.length) operations.push(pop(content))
    // Outlines paint over the box and its contents without participating in
    // layout. The qualified negative offset leaves the ink inside this box.
    if (outline && !outline.color.endsWith('00')) {
      const inset = insetContour({ ...current, borderWidths: [outline.width, outline.width, outline.width, outline.width] })
      operations.push(vector(current.id + ':inset-outline', [...outer, ...inset.commands], current.transform, outline.color, 'evenodd'))
    }
    if (current.opacity !== 1 || current.blendMode !== 'normal' || current.isolation === 'isolate') {
      const scope = current.id + ':composite'
      operations.splice(start, 0, { type: 'pushComposite', scopeId: scope, commands: rectCommands(envelope), transform: identity, fillRule: 'nonzero', isolation: 'isolated', opacity: current.opacity, blendMode: current.blendMode })
      operations.push(pop(scope))
    }
    return envelope
  }
  let visualBounds: CanvasRect | null = null
  try { visualBounds = visit(box, 0) } catch (error) { blockers.push(String(error)) }
  if (operations.length > 8192) blockers.push('CARD_PAINT_OPERATION_LIMIT')
  const unique = [...new Set(blockers)]
  return { ...identityData, status: unique.length ? 'unsupported' : 'ready', completePaint: unique.length === 0, operations: unique.length ? [] : operations, uploads: unique.length ? [] : uploads, visualBounds: unique.length ? null : visualBounds, blockers: unique }
}

export type CompleteCardPaintProviders = Readonly<{
  text?: (element: HTMLElement, options: { id: string; revision: number; sourceFingerprint: string; contentTransform: PaintMatrix; canonicalRead: CanonicalCardRead; rootBackgroundOwned: true }) => Promise<QualifiedCardContribution>
  image?: (element: HTMLImageElement, options: { id: string; revision: number; sourceFingerprint: string; borderBoxTransform: PaintMatrix; contentSize: Size; cameraScale: number; canonicalRead: CanonicalCardRead }) => Promise<QualifiedCardContribution>
  backgroundImage?: (element: HTMLElement, options: { id: string; revision: number; sourceFingerprint: string; borderBoxTransform: PaintMatrix; layer: MeasuredBackgroundLayer; cameraScale: number; canonicalRead: CanonicalCardRead }) => Promise<QualifiedCardContribution>
  video?: (element: HTMLVideoElement, options: { id: string; revision: number; sourceFingerprint: string; contentTransform: PaintMatrix; contentSize: Size; cameraScale: number; canonicalRead: CanonicalCardRead }) => Promise<QualifiedCardContribution>
  /** Entire rendered SVG tree, including captions/markers/effects. CSS root
   * chrome, opacity and overflow are owned by the surrounding box compiler. */
  svg?: (element: SVGSVGElement, options: { id: string; revision: number; sourceFingerprint: string; userSpaceTransform: PaintMatrix; borderBoxTransform: PaintMatrix; contentSize: Size; cameraScale: number; canonicalRead: CanonicalCardRead; rootOpacityOwned: true }) => Promise<QualifiedCardContribution>
}>
/** The actual browser CTM includes viewBox, preserveAspectRatio and inherited
 * CSS/SVG transforms. Rebase client pixels once into the accepted world camera. */
export function measuredSvgWorldMatrix(matrix: Readonly<{a:number;b:number;c:number;d:number;e:number;f:number;is2D?:boolean}>, camera: CanvasViewport, stageOrigin: {x:number;y:number}): PaintMatrix | null {
  // Chromium still exposes the legacy six-coefficient SVGMatrix without an
  // is2D property. The enclosing CSS measurement separately rejects 3D parents.
  if (matrix.is2D === false || !finite(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f,camera.x,camera.y,camera.scale,stageOrigin.x,stageOrigin.y) || camera.scale <= 0 || Math.abs(matrix.a*matrix.d-matrix.b*matrix.c)<1e-12) return null
  const result:PaintMatrix=[matrix.a/camera.scale,matrix.b/camera.scale,matrix.c/camera.scale,matrix.d/camera.scale,(matrix.e-stageOrigin.x-camera.x)/camera.scale,(matrix.f-stageOrigin.y-camera.y)/camera.scale]
  return finite(...result) ? result : null
}
export type CanonicalCardRead = <T>(read: () => T) => T
/** A synchronous style read under the original semantic skin. Markers are
 * restored before returning, including on errors; async callbacks are refused
 * so no browser paint turn can observe an unowned card during font/network IO. */
export function withCanonicalCardPaint<T>(article: HTMLElement, read: () => T): T {
  const card = article.getAttribute('data-vello-card-paint'), vector = article.getAttribute('data-vello-paint'), canonical = article.getAttribute('data-vello-card-canonical-read')
  if(canonical==='true'&&card===null&&vector===null){
    const result=read()
    if(result&&typeof (result as {then?:unknown}).then==='function')throw new Error('CARD_CANONICAL_READ_MUST_BE_SYNCHRONOUS')
    return result
  }
  article.setAttribute('data-vello-card-canonical-read', 'true')
  if (card !== null) article.removeAttribute('data-vello-card-paint')
  if (vector !== null) article.removeAttribute('data-vello-paint')
  try {
    const result = read()
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('CARD_CANONICAL_READ_MUST_BE_SYNCHRONOUS')
    return result
  } finally {
    if (card !== null) article.setAttribute('data-vello-card-paint', card)
    if (vector !== null) article.setAttribute('data-vello-paint', vector)
    if (canonical !== null) article.setAttribute('data-vello-card-canonical-read', canonical)
    else article.removeAttribute('data-vello-card-canonical-read')
  }
}
/** An observational stage capture must see all original skins in one
 * synchronous pass. Ownership marker writes are not content mutations. */
export function withCanonicalStageCardPaint<T>(stage: HTMLElement, read: () => T): T {
  const articles = [...stage.querySelectorAll<HTMLElement>('.board-world>.board-object-layer>article.board-node[data-node-id]')]
  const saved = articles.map(article => ({ article, card: article.getAttribute('data-vello-card-paint'), vector: article.getAttribute('data-vello-paint'), canonical: article.getAttribute('data-vello-card-canonical-read') }))
  try {
    for (const { article, card, vector } of saved) {
      article.setAttribute('data-vello-card-canonical-read', 'true')
      if (card !== null) article.removeAttribute('data-vello-card-paint')
      if (vector !== null) article.removeAttribute('data-vello-paint')
    }
    const result = read()
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('CARD_CANONICAL_READ_MUST_BE_SYNCHRONOUS')
    return result
  } finally {
    for (const { article, card, vector, canonical } of saved.reverse()) {
      if (card !== null) article.setAttribute('data-vello-card-paint', card)
      if (vector !== null) article.setAttribute('data-vello-paint', vector)
      if (canonical !== null) article.setAttribute('data-vello-card-canonical-read', canonical)
      else article.removeAttribute('data-vello-card-canonical-read')
    }
  }
}
const inline = new Set(['SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'MARK', 'A', 'CODE'])
const paragraph = (element: HTMLElement): boolean => {
  if (!element.textContent?.trim()) return false
  if (!element.children.length) return true
  const display = element.ownerDocument.defaultView?.getComputedStyle(element).display
  // Flex/grid positions are independent paragraphs, even when every child is
  // an inline tag. Joining a title and right-aligned badge loses their layout.
  return !['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display ?? '') && [...element.children].every(child => inline.has(child.tagName) && paragraph(child as HTMLElement))
}
const semanticOverlay = (element: Element) => element.matches('.node-transform-box,.node-resize-handle,.node-rotate-handle,.vector-anchors,.diagram-anchors,.diagram-selection,.selection-handle,.column-resize-handle,.vector-node-editor,.vector-handle-lines,.diagram-node-editor,.video-control-hit')
const styleKey = (style: CSSStyleDeclaration) => [...style].map(key => `${key}:${style.getPropertyValue(key)}`).join(';')
/** Empty inline labels can have width:auto and a zero-width client rect. They
 * contribute no paint; visible zero-size borders/effects are not discarded. */
export function emptyUnpaintedCardLeaf(element: Pick<HTMLElement, 'textContent' | 'children'>, style: CSSStyleDeclaration, rect: Pick<DOMRect, 'width' | 'height'>): boolean {
  const background = normalizeMeasuredColor(style.backgroundColor)
  return (!rect.width || !rect.height) && !element.textContent?.trim() && !element.children.length
    && Boolean(background?.endsWith('00')) && style.backgroundImage === 'none' && style.boxShadow === 'none'
    && style.textShadow === 'none' && style.filter === 'none' && style.backdropFilter === 'none' && style.borderImageSource === 'none'
    && style.maskImage === 'none' && style.clipPath === 'none'
    && [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].every(width => px(width) === 0)
    && (style.outlineStyle === 'none' || px(style.outlineWidth) === 0)
}
/** In-memory mounted derivative only. Parent layout, CSS and source content
 * are recaptured after async providers. Camera-only translation may retain
 * world paint, but the presenter must still reject obsolete frame generations. */
export async function captureCompleteMeasuredCardPaint(stage: HTMLElement, scene: CanvasSceneSnapshot, object: CanvasSceneObject, camera: CanvasViewport, providers: CompleteCardPaintProviders = {}, layoutRevision = 0): Promise<CompleteCardPaintResult> {
  const world = stage.querySelector<HTMLElement>(':scope>.board-world'), articles = [...stage.querySelectorAll<HTMLElement>('.board-world>.board-object-layer>article.board-node[data-node-id]')].filter(element => element.dataset.nodeId === object.id), article = articles.length === 1 ? articles[0] : null
  const base = { objectId: object.id, objectRevision: object.revision, order: object.order, layoutRevision, sourceFingerprint: '' }
  const fail = (status: 'unsupported' | 'stale', reasons: readonly string[]): CompleteCardPaintResult => ({ ...base, status, completePaint: false, operations: [], uploads: [], visualBounds: null, blockers: [...new Set(reasons)] })
  if (!article || !world) return fail('unsupported', ['CARD_LAYOUT_NOT_CURRENT'])
  if (article.getAnimations().some(animation => animation.playState === 'running' || animation.pending)) return fail('unsupported', ['CARD_ACTIVE_ANIMATION_PENDING'])
  const canonicalRead: CanonicalCardRead = read => withCanonicalCardPaint(article, read)
  // Vector artwork can have an entire measured CSS/SVG skin and captions.
  // The legacy observer excludes vectors, so use only a transient layout view
  // for preflight; the original source identity and complete provider gate stay.
  const layoutObject = object.kind === 'vector' ? { ...object, kind: 'container' as const } : object
  const partial = canonicalRead(() => captureMeasuredCardPaint(stage, { ...scene, objects: [layoutObject] }, camera, layoutRevision).objects[0])
  if (partial?.status !== 'measured-partial' || partial.blockers.includes('OBJECT_LAYOUT_NOT_CURRENT')) return fail('unsupported', ['CARD_LAYOUT_NOT_CURRENT',...(partial?.blockers.filter(reason=>reason!=='COMPLETE_CARD_OWNERSHIP_PENDING')??['CARD_PREFLIGHT_OBJECT_NOT_MEASURED'])])
  const view = article.ownerDocument.defaultView
  const focused = article.ownerDocument.activeElement
  const nativeHitControl = focused?.matches('.video-control-hit:is(input[type="range"],input[type="color"],select)')
  if (!view || article.contains(focused) && focused?.matches('input,textarea,select,[contenteditable="true"]') && !nativeHitControl) return fail('unsupported', ['CARD_EDITING_ACTIVE'])
  const origin = stage.getBoundingClientRect(), stageOrigin = { x: origin.left + stage.clientLeft, y: origin.top + stage.clientTop }
  const records: { element: HTMLElement | SVGSVGElement }[] = [], reasons: string[] = []; let order = 0
  const capturedWorldStyle = view.getComputedStyle(world)
  const capturedWorldMatrix = new DOMMatrixReadOnly(capturedWorldStyle.transform === 'none' ? undefined : capturedWorldStyle.transform)
  const capturedFontFaces = [...article.ownerDocument.fonts]
  const capturedParents: HTMLElement[] = []
  for (let parent = article.parentElement; parent && parent !== world; parent = parent.parentElement) capturedParents.push(parent)
  const source = () => canonicalRead(() => {
    const worldStyle = view.getComputedStyle(world), matrix = new DOMMatrixReadOnly(worldStyle.transform === 'none' ? undefined : worldStyle.transform)
    // Translation changes screen rectangles, not card paint. Scale changes
    // still require capture at the new text/image quality policy. Refuse any
    // different linear map/origin rather than normalizing skew or perspective.
    if (!matrix.is2D || worldStyle.transformOrigin !== '0px 0px' || worldStyle.perspective !== 'none'
      || !finite(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f) || matrix.a <= 0
      || matrix.a !== capturedWorldMatrix.a || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== capturedWorldMatrix.d) return null
    const currentOrigin = stage.getBoundingClientRect(), geometry: number[][] = []
    const currentFocus = article.ownerDocument.activeElement
    const editing = article.contains(currentFocus) && currentFocus?.matches('input,textarea,select,[contenteditable="true"]')
      && !currentFocus.matches('.video-control-hit:is(input[type="range"],input[type="color"],select)')
    if (editing || !world.isConnected || !stage.contains(world) || !world.contains(article)) return null
    // Group/layer transforms, opacity and clipping are not inherited CSS.
    // A stable child AABB alone cannot prove this ancestry remained unchanged.
    const parents: HTMLElement[] = []
    for (let parent = article.parentElement; parent && parent !== world; parent = parent.parentElement) parents.push(parent)
    if (parents.length !== capturedParents.length || parents.some((parent,index) => parent !== capturedParents[index])) return null
    const fontSet = article.ownerDocument.fonts
    if (fontSet.size !== capturedFontFaces.length || capturedFontFaces.some(face => !fontSet.has(face))) return null
    const styles = records.map(({ element }) => {
      if (!element.isConnected || !article.contains(element) || element.getAnimations().some(animation => animation.playState === 'running' || animation.pending)) return null
      const rect = element.getBoundingClientRect()
      geometry.push([(rect.x-currentOrigin.left-stage.clientLeft-matrix.e)/matrix.a,
        (rect.y-currentOrigin.top-stage.clientTop-matrix.f)/matrix.d,rect.width/matrix.a,rect.height/matrix.d])
      return [styleKey(view.getComputedStyle(element)), element.getClientRects().length, element.scrollLeft, element.scrollTop,
        element instanceof view.HTMLImageElement ? [element.currentSrc,element.complete,element.naturalWidth,element.naturalHeight] : null]
    })
    if (styles.some(style => style === null) || !geometry.flat().every(value => finite(value))) return null
    return { signature: JSON.stringify({ scene: scene.id, revision: scene.revision, objectRevision: object.revision,
      scale: camera.scale, dpr: view.devicePixelRatio, viewport: [stage.clientWidth,stage.clientHeight],
      fonts: [fontSet.status,capturedFontFaces.map(face => [face.family,face.style,face.weight,face.stretch,face.status])],
      parents: parents.map(parent => styleKey(view.getComputedStyle(parent))),
      html: article.outerHTML, styles }), geometry }
  })
  const providerQueue: { box: { contributions: QualifiedCardContribution[]; backgrounds: QualifiedCardContribution[] }; element: HTMLElement | SVGSVGElement; kind: 'text' | 'image' | 'svg' | 'video' | 'background'; matrix: PaintMatrix; userSpaceTransform?:PaintMatrix; contentSize: Size; id: string; layer?: MeasuredBackgroundLayer }[] = []
  const capture = (element: HTMLElement | SVGSVGElement, depth: number, parentStacking: boolean): CompleteCardBox | null => {
    if (semanticOverlay(element)) return null
    if (depth > 32 || records.length >= 512) { reasons.push('CARD_LAYOUT_RESOURCE_LIMIT'); return null }
    const style = view.getComputedStyle(element)
    if (style.display === 'none') return null
    if (style.visibility !== 'visible') {
      // Visibility preserves layout. Hidden hover controls contribute no
      // visual paint until the real pointer/focus lifecycle invalidates them.
      const descendants = [...element.querySelectorAll('*')]
      if (descendants.length > 512 || descendants.some(child => view.getComputedStyle(child).visibility === 'visible')) reasons.push('CARD_VISIBILITY_OVERRIDE_PENDING')
      return null
    }
    records.push({ element })
    if (element.getAnimations().some(animation => animation.playState === 'running' || animation.pending) || style.animationName !== 'none') reasons.push('CARD_ACTIVE_ANIMATION_PENDING')
    const insetOutline = measuredInsetSolidOutline(style)
    if (style.display === 'contents' || style.cssFloat !== 'none' || style.order !== '0' || style.clipPath !== 'none' || style.maskImage !== 'none' || style.borderImageSource !== 'none' || style.filter !== 'none' || style.backdropFilter !== 'none' || style.textShadow !== 'none' || insetOutline === null) reasons.push('CARD_STYLE_EFFECT_UNSUPPORTED')
    // Only this permanent article ring has a matching accepted-owner CSS rule.
    // Other outlines remain explicit DOM paint until their lifecycle qualifies.
    if (insetOutline && (element !== article || !article.matches('.node-graph-column') || article.matches('.selected,.marquee-preview,.connector-source'))) reasons.push('CARD_STYLE_EFFECT_UNSUPPORTED')
    for (const pseudo of ['::before', '::after']) { const computed = view.getComputedStyle(element, pseudo); if (computed.content !== 'none' && computed.content !== 'normal' && computed.display !== 'none') reasons.push('CARD_PSEUDO_ELEMENT_PENDING') }
    if (['INPUT', 'TEXTAREA', 'SELECT', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED'].includes(element.tagName.toUpperCase())) { reasons.push('CARD_PROVIDER_LIFECYCLE_UNSUPPORTED'); return null }
    const rect = element.getBoundingClientRect()
    if (emptyUnpaintedCardLeaf(element, style, rect)) return null
    const size = borderBoxSize(style), linear = measuredLinearWorld(element, world), transform = size && linear && reconstructWorldMatrix({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, size, linear, camera, stageOrigin)
    if (!size || !transform || element.getClientRects().length !== 1) { reasons.push('CARD_FRAGMENTED_OR_UNSUPPORTED_BOX'); return null }
    const radii = normalizeCornerRadii([style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius], size), background = normalizeMeasuredColor(style.backgroundColor), borderWidths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(px) as [number, number, number, number], borderColors = [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor].map(normalizeMeasuredColor)
    if (!radii || !background || borderColors.some(color => !color) || !borderWidths.every(width => finite(width) && width >= 0) || [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle].some(border => border !== 'solid' && border !== 'none')) { reasons.push('CARD_SURFACE_STYLE_UNSUPPORTED'); return null }
    if (!['visible', 'hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) || style.overflowX !== style.overflowY || (style.overflowX === 'auto' || style.overflowX === 'scroll') && (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)) reasons.push('CARD_OVERFLOW_OR_SCROLLBAR_PENDING')
    const zIndex = style.zIndex === 'auto' ? 0 : Number(style.zIndex), ownStacking = style.transform !== 'none' || Number(style.opacity) !== 1 || style.isolation === 'isolate' || style.mixBlendMode !== 'normal' || style.position !== 'static' && style.zIndex !== 'auto'
    if (!Number.isFinite(zIndex) || Math.abs(zIndex) > LIMIT || style.position !== 'static' && style.zIndex !== 'auto' && !parentStacking) reasons.push('CARD_ESCAPING_STACKING_CONTEXT_PENDING')
    if (style.mixBlendMode !== 'normal' || !['auto', 'isolate'].includes(style.isolation)) reasons.push('CARD_BLEND_BACKDROP_PARITY_PENDING')
    let backgrounds: readonly MeasuredBackgroundLayer[] = [], shadows: readonly MeasuredBoxShadow[] = []
    const gradientOrigin = { x: borderWidths[3], y: borderWidths[0], width: size.width - borderWidths[1] - borderWidths[3], height: size.height - borderWidths[0] - borderWidths[2] }
    try {
      backgrounds = parseMeasuredBackground(style, size, borderWidths)
      if (backgrounds.some(layer => layer.clipBox !== 'border-box')) reasons.push('CARD_BACKGROUND_ROUNDED_CLIP_UNSUPPORTED')
      shadows = parseMeasuredBoxShadows(style.boxShadow)
    } catch (error) { reasons.push(String(error)) }
    const id = `${object.id}:box-${order}`, box = { id, size, transform, radii, background, gradients: [], gradientOrigin, backgrounds: [] as QualifiedCardContribution[], shadows, borderWidths, borderColors: borderColors as [string, string, string, string], opacity: Number(style.opacity), clipContent: style.overflowX !== 'visible', isolation: style.isolation as 'auto' | 'isolate', blendMode: style.mixBlendMode as 'normal' | 'multiply' | 'screen', zIndex, sourceOrder: order++, contributions: [] as QualifiedCardContribution[], children: [] as CompleteCardBox[], insetOutline: insetOutline ?? undefined }
    for (const layer of [...backgrounds].reverse()) providerQueue.push({ box, element, kind: 'background', matrix: transform, contentSize: size, id: `${id}:background-${layer.index}`, layer })
    const [top, right, bottom, left] = borderWidths, paddingLeft = px(style.paddingLeft), paddingTop = px(style.paddingTop), paddingRight = px(style.paddingRight), paddingBottom = px(style.paddingBottom), contentSize = { width: size.width - left - right - paddingLeft - paddingRight, height: size.height - top - bottom - paddingTop - paddingBottom }, x = left + paddingLeft, y = top + paddingTop, contentTransform: PaintMatrix = [transform[0], transform[1], transform[2], transform[3], transform[4] + transform[0] * x + transform[2] * y, transform[5] + transform[1] * x + transform[3] * y]
    if (!finite(paddingLeft, paddingTop, paddingRight, paddingBottom)) reasons.push('CARD_CONTENT_METRICS_INVALID')
    if (element instanceof view.SVGSVGElement) {
      const clientMatrix=element.getScreenCTM(), userSpaceTransform=clientMatrix && measuredSvgWorldMatrix(clientMatrix,camera,stageOrigin)
      if (!userSpaceTransform) reasons.push('CARD_SVG_USER_SPACE_MATRIX_INVALID')
      else providerQueue.push({box,element,kind:'svg',matrix:transform,userSpaceTransform,contentSize,id:id+':svg'})
    }
    else if (element instanceof view.HTMLImageElement) providerQueue.push({ box, element, kind: 'image', matrix: transform, contentSize, id: id + ':image' })
    else if (element instanceof view.HTMLVideoElement) providerQueue.push({ box, element, kind: 'video', matrix: contentTransform, contentSize, id: id + ':video' })
    else if (paragraph(element)) providerQueue.push({ box, element, kind: 'text', matrix: contentTransform, contentSize, id: id + ':text' })
    else {
      if ([...element.childNodes].some(child => child.nodeType === 3 && child.textContent?.trim())) reasons.push('CARD_MIXED_INLINE_BLOCK_TEXT_PENDING')
      for (const child of element.children) if (child instanceof view.HTMLElement || child instanceof view.SVGSVGElement) { const captured = capture(child, depth + 1, ownStacking); if (captured) box.children.push(captured) } else reasons.push('CARD_NON_HTML_PROVIDER_PENDING')
    }
    return box
  }
  const tree = canonicalRead(() => capture(article, 0, true))
  if (!tree || reasons.length) return fail('unsupported', reasons.length ? reasons : ['CARD_LAYOUT_CAPTURE_FAILED'])
  const capturedSource = source()
  if (!capturedSource) return fail('stale', ['CARD_LAYOUT_CHANGED_DURING_PROVIDER_CAPTURE'])
  base.sourceFingerprint = JSON.stringify(capturedSource)
  for (const queued of providerQueue) {
    try {
      const common = { id: queued.id, revision: object.revision, sourceFingerprint: base.sourceFingerprint, canonicalRead }
      if (queued.kind === 'background') {
        const layer = queued.layer!
        const contribution = layer.kind === 'image'
          ? await providers.backgroundImage?.(queued.element as HTMLElement, { ...common, borderBoxTransform: queued.matrix, layer, cameraScale: camera.scale })
          : { completePaint: true, sourceFingerprint: base.sourceFingerprint, operations: resolveMeasuredBackgroundGeometry(layer).tiles.map((tile, index) => measuredBackgroundGradientOperation(layer, tile, `${queued.id}:tile-${index}`, queued.matrix)), visualBounds: bounds(queued.contentSize, queued.matrix), blockers: [] }
        if (!contribution) reasons.push('CARD_BACKGROUND_IMAGE_PROVIDER_NOT_READY')
        else queued.box.backgrounds.push(contribution)
        continue
      }
      const contribution = queued.kind === 'svg'
        ? await providers.svg?.(queued.element as SVGSVGElement,{...common,userSpaceTransform:queued.userSpaceTransform!,borderBoxTransform:queued.matrix,contentSize:queued.contentSize,cameraScale:camera.scale,rootOpacityOwned:true})
        : queued.kind === 'video' ? await providers.video?.(queued.element as HTMLVideoElement, { ...common, contentTransform: queued.matrix, contentSize: queued.contentSize, cameraScale: camera.scale })
        : queued.kind === 'text' ? await providers.text?.(queued.element as HTMLElement, { ...common, contentTransform: queued.matrix, rootBackgroundOwned: true }) : await providers.image?.(queued.element as HTMLImageElement, { ...common, borderBoxTransform: queued.matrix, contentSize: queued.contentSize, cameraScale: camera.scale })
      if (!contribution) reasons.push(queued.kind === 'video' ? 'CARD_VIDEO_PROVIDER_NOT_READY' : queued.kind === 'svg' ? 'CARD_SVG_PROVIDER_NOT_READY' : queued.kind === 'text' ? 'CARD_TEXT_PROVIDER_NOT_READY' : 'CARD_IMAGE_PROVIDER_NOT_READY')
      else queued.box.contributions.push(contribution)
    } catch (error) { reasons.push(String(error)) }
  }
  const currentSource = source()
  // CSSOM matrix serialization and fractional BCR subtraction can differ by
  // subpixels during translation. Bound error by the same .01 CSS-pixel
  // budget used by camera preflight; do not round fingerprints or lose edits.
  const geometryCurrent = currentSource && currentSource.geometry.length === capturedSource.geometry.length
    && currentSource.geometry.every((rect,index) => rect.every((value,axis) => Math.abs(value-capturedSource.geometry[index][axis])*camera.scale <= .01))
  if (!article.isConnected || !currentSource || currentSource.signature !== capturedSource.signature || !geometryCurrent || !scene.objects.some(current => current === object)) return fail('stale', ['CARD_LAYOUT_CHANGED_DURING_PROVIDER_CAPTURE'])
  if (reasons.length) return fail('unsupported', reasons)
  return compileCompleteCardPaint(tree, base)
}

