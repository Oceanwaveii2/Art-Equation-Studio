import type { CanvasRect, CanvasVectorCommand } from '../canvas-engine/contracts'
import type { GradientPaint, PaintMatrix, PaintOperation } from '../canvas-engine/paintDisplayList'
import { normalizeMeasuredColor } from './measuredCardPaint.ts'

type Size = Readonly<{ width: number; height: number }>
type Edges = readonly [number, number, number, number]
type Length = Readonly<{ unit: 'px' | 'percent'; value: number }>
type Box = 'border-box' | 'padding-box' | 'content-box'
type Stop = Readonly<{ offset: number; color: string }>
export type MeasuredBackgroundStyle = Pick<CSSStyleDeclaration, 'backgroundImage' | 'backgroundOrigin' | 'backgroundClip' | 'backgroundSize' | 'backgroundPosition' | 'backgroundRepeat' | 'backgroundAttachment' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'> & Partial<Pick<CSSStyleDeclaration, 'backgroundBlendMode'>>
export type MeasuredBackgroundLayer = Readonly<{
  /** CSS index zero is frontmost; consumers paint the array in reverse. */
  index: number; kind: 'image' | 'gradient'; source: string; origin: CanvasRect; clip: CanvasRect
  originBox: Box; clipBox: Box
  sizing: Readonly<{ mode: 'cover' | 'contain' }> | Readonly<{ mode: 'explicit'; width: Length | null; height: Length | null }>
  position: readonly [Length, Length]; repeat: readonly [boolean, boolean]
}>
export type MeasuredBackgroundGeometry = Readonly<{ tile: CanvasRect; tiles: readonly CanvasRect[]; clip: CanvasRect }>
const LIMIT = 1_000_000
const finite = (...values: number[]) => values.every(value => Number.isFinite(value) && Math.abs(value) <= LIMIT)
const error = (reason: string): never => { throw new Error('CARD_BACKGROUND_UNSUPPORTED: ' + reason) }

/** CSS lists and whitespace are tokenized without splitting URLs/functions. */
function tokenize(source: string, separator: 'comma' | 'space'): string[] {
  const values: string[] = []; let depth = 0, quote = '', escaped = false, start = 0
  const add = (end: number) => { const value = source.slice(start, end).trim(); if (value) values.push(value); else if (separator === 'comma') error('empty layer') }
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (escaped) { escaped = false; continue }
    if (character === '\\') { escaped = true; continue }
    if (quote) { if (character === quote) quote = ''; continue }
    if (character === '"' || character === "'") { quote = character; continue }
    if (character === '(') depth++
    else if (character === ')' && --depth < 0) error('unmatched function')
    else if (depth === 0 && (separator === 'comma' ? character === ',' : /\s/.test(character))) { add(index); start = index + 1 }
  }
  if (depth || quote || escaped) error('incomplete CSS value')
  add(source.length)
  if (!values.length || values.length > 32) error('layer/token limit')
  return values
}
const lists = (source: string) => tokenize(source, 'comma')
function length(source: string): Length {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|%)$/.exec(source)
  if (source === '0') return { unit: 'px', value: 0 }
  if (!match || !finite(Number(match[1]))) return error('computed px/percentage required: ' + source)
  return { unit: match[2] === '%' ? 'percent' : 'px', value: Number(match[1]) }
}
const used = (value: Length, basis: number) => value.unit === 'percent' ? value.value / 100 * basis : value.value
const px = (source: string) => { const value = length(source); if (value.unit !== 'px' || value.value < 0) error('box metrics'); return value.value }
function position(source: string): readonly [Length, Length] {
  const words = tokenize(source, 'space')
  const keyword = (word: string, axis: number): Length | undefined => word === 'center' ? { unit: 'percent', value: 50 }
    : word === (axis ? 'top' : 'left') ? { unit: 'percent', value: 0 }
    : word === (axis ? 'bottom' : 'right') ? { unit: 'percent', value: 100 } : undefined
  if (words.length === 1) {
    if (words[0] === 'top' || words[0] === 'bottom') return [{ unit: 'percent', value: 50 }, keyword(words[0], 1)!]
    return [keyword(words[0], 0) ?? length(words[0]), { unit: 'percent', value: 50 }]
  }
  if (words.length !== 2) return error('position needs two computed components')
  if (['top', 'bottom'].includes(words[0]) || ['left', 'right'].includes(words[1])) words.reverse()
  return [keyword(words[0], 0) ?? length(words[0]), keyword(words[1], 1) ?? length(words[1])]
}
function sizing(source: string): MeasuredBackgroundLayer['sizing'] {
  if (source === 'cover' || source === 'contain') return { mode: source }
  const words = tokenize(source, 'space')
  if (words.length > 2) return error('background size')
  const side = (word: string) => { if (word === 'auto') return null; const value = length(word); if (value.value < 0) error('negative image size'); return value }
  return { mode: 'explicit', width: side(words[0]), height: side(words[1] ?? 'auto') }
}
function repeat(source: string): readonly [boolean, boolean] {
  if (source === 'repeat-x') return [true, false]
  if (source === 'repeat-y') return [false, true]
  const words = tokenize(source, 'space')
  if (words.length > 2 || words.some(word => !['repeat', 'no-repeat'].includes(word))) return error('repeat mode')
  return [words[0] === 'repeat', (words[1] ?? words[0]) === 'repeat']
}
function box(source: string, size: Size, borders: Edges, padding: Edges): CanvasRect {
  if (!['border-box', 'padding-box', 'content-box'].includes(source)) return error('background box')
  const edges = source === 'border-box' ? [0, 0, 0, 0] : source === 'padding-box' ? borders : borders.map((value, index) => value + padding[index])
  const rect = { x: edges[3], y: edges[0], width: size.width - edges[1] - edges[3], height: size.height - edges[0] - edges[2] }
  if (!finite(rect.x, rect.y, rect.width, rect.height) || rect.width <= 0 || rect.height <= 0) error('empty/invalid background box')
  return rect
}
function url(source: string): string {
  const match = /^url\((.*)\)$/is.exec(source)
  if (!match) return error('background image type')
  let value = match[1].trim()
  if (value[0] === '"' || value[0] === "'") {
    if (value.at(-1) !== value[0]) error('URL quotes')
    value = value.slice(1, -1)
  } else if (/[\s"']/.test(value)) error('unquoted URL')
  value = value.replace(/\\([\da-f]{1,6})(?:\s)?|\\([^\r\n])/gi, (_, hex: string, escaped: string) => {
    if (!hex) return escaped
    const code = Number.parseInt(hex, 16)
    if (!code || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) return error('invalid URL escape')
    return String.fromCodePoint(code)
  })
  if (!value || /[\u0000-\u001f]/.test(value)) error('empty/invalid URL')
  return value
}

/** Only measured CSS is parsed. URLs are inert identities, never loaded here.
 * CSS list cycling, sizing and positioning follow CSS Backgrounds3 §§2.1/2.6/2.9:
 * https://www.w3.org/TR/css-backgrounds-3/ . */
export function parseMeasuredBackground(style: MeasuredBackgroundStyle, size: Size, borderWidths: Edges): readonly MeasuredBackgroundLayer[] {
  if (!finite(size.width, size.height, ...borderWidths) || size.width <= 0 || size.height <= 0 || borderWidths.some(value => value < 0)) error('box metrics')
  const images = lists(style.backgroundImage)
  if (images.every(image => image === 'none')) return []
  const origin = lists(style.backgroundOrigin), clip = lists(style.backgroundClip), sizes = lists(style.backgroundSize)
  const positions = lists(style.backgroundPosition), repeats = lists(style.backgroundRepeat), attachments = lists(style.backgroundAttachment)
  const blends = style.backgroundBlendMode ? lists(style.backgroundBlendMode) : ['normal']
  const padding: Edges = [px(style.paddingTop), px(style.paddingRight), px(style.paddingBottom), px(style.paddingLeft)]
  return images.flatMap((source, index) => {
    if (source === 'none') return []
    const at = (values: string[]) => values[index % values.length]
    if (at(attachments) !== 'scroll' || at(blends) !== 'normal') return error('attachment or backdrop blend')
    const kind = source.startsWith('url(') ? 'image' : /^(?:linear|radial)-gradient\(/.test(source) ? 'gradient' : error('background image type')
    return [{ index, kind, source: kind === 'image' ? url(source) : source, origin: box(at(origin), size, borderWidths, padding), clip: box(at(clip), size, borderWidths, padding), originBox: at(origin) as Box, clipBox: at(clip) as Box, sizing: sizing(at(sizes)), position: position(at(positions)), repeat: repeat(at(repeats)) }]
  })
}

/** Image providers supply actual intrinsic dimensions after decode. Gradients
 * have no intrinsic ratio/dimensions and use their CSS positioning box. */
export function resolveMeasuredBackgroundGeometry(layer: MeasuredBackgroundLayer, intrinsic?: Size): MeasuredBackgroundGeometry {
  const origin = layer.origin, clip = layer.clip
  if (layer.kind === 'image' && (!intrinsic || !finite(intrinsic.width, intrinsic.height) || intrinsic.width <= 0 || intrinsic.height <= 0)) error('decoded image dimensions required')
  let width: number, height: number
  if (layer.sizing.mode !== 'explicit') {
    if (layer.kind === 'image') {
      const ratio = layer.sizing.mode === 'cover' ? Math.max(origin.width / intrinsic!.width, origin.height / intrinsic!.height) : Math.min(origin.width / intrinsic!.width, origin.height / intrinsic!.height)
      width = intrinsic!.width * ratio; height = intrinsic!.height * ratio
    } else { width = origin.width; height = origin.height }
  } else {
    const horizontal = layer.sizing.width, vertical = layer.sizing.height
    width = horizontal ? used(horizontal, origin.width) : intrinsic?.width ?? origin.width
    height = vertical ? used(vertical, origin.height) : intrinsic?.height ?? origin.height
    if (layer.kind === 'image') {
      if (horizontal && !vertical) height = width * intrinsic!.height / intrinsic!.width
      if (vertical && !horizontal) width = height * intrinsic!.width / intrinsic!.height
    }
  }
  if (!finite(width, height) || width <= 0 || height <= 0) error('empty/invalid tile')
  const tile = { x: origin.x + used(layer.position[0], origin.width - width), y: origin.y + used(layer.position[1], origin.height - height), width, height }
  if (!finite(tile.x, tile.y, tile.x + width, tile.y + height)) error('tile position')
  const range = (axis: number) => {
    if (!layer.repeat[axis]) return [0, 1] as const
    const start = axis ? tile.y : tile.x, low = axis ? clip.y : clip.x, edge = axis ? clip.height : clip.width, step = axis ? height : width
    return [Math.floor((low - start) / step), Math.ceil((low + edge - start) / step)] as const
  }
  const [x0, x1] = range(0), [y0, y1] = range(1)
  if (![x0, x1, y0, y1].every(Number.isSafeInteger) || (x1 - x0) * (y1 - y0) > 64) error('tile limit')
  const tiles: CanvasRect[] = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const rect = { ...tile, x: tile.x + x * width, y: tile.y + y * height }
    if (rect.x < clip.x + clip.width && rect.x + width > clip.x && rect.y < clip.y + clip.height && rect.y + height > clip.y) tiles.push(rect)
  }
  return { tile, tiles, clip }
}

function stops(tokens: readonly string[], basis: number, radial: boolean): readonly Stop[] {
  const values: { offset: number | null; color: string }[] = []
  for (const token of tokens) {
    const parts = tokenize(token, 'space'), color = normalizeMeasuredColor(parts[0])
    if (!color || parts.length > 3) return error('computed gradient colors/stops required')
    for (const value of parts.length > 1 ? parts.slice(1) : ['']) {
      const offset = value ? used(length(value), basis) / basis : null
      if (offset !== null && (!finite(offset) || radial && offset < 0)) error('gradient stop range')
      values.push({ color, offset })
    }
  }
  if (values.length < 2 || values.length > 64) error('gradient stop count')
  values[0].offset ??= 0; values.at(-1)!.offset ??= 1
  let previous = -Infinity
  for (const value of values) if (value.offset !== null) { value.offset = Math.max(previous, value.offset); previous = value.offset }
  for (let index = 0; index < values.length; index++) if (values[index].offset === null) {
    const first = index - 1; let last = index; while (values[last].offset === null) last++
    for (let current = index; current < last; current++) values[current].offset = values[first].offset! + (values[last].offset! - values[first].offset!) * (current - first) / (last - first)
    index = last
  }
  return values as readonly Stop[]
}
const rectangle = (rect: CanvasRect): readonly CanvasVectorCommand[] => [['M', rect.x, rect.y], ['L', rect.x + rect.width, rect.y], ['L', rect.x + rect.width, rect.y + rect.height], ['L', rect.x, rect.y + rect.height], ['Z']]

/** Produces the existing Vello radial/linear operation, not a raster preview.
 * Caller owns rounded background clipping and CSS reverse-layer order.
 * brushTransform is relative to the shape: both pinned Vello backends apply
 * shapeTransform × brushTransform. Card/world placement must occur only once.
 * Radial geometry follows CSS Images3 §3.2 (ellipse axis scaling is explicit):
 * https://www.w3.org/TR/css-images-3/#radial-gradients . */
export function measuredBackgroundGradientOperation(layer: MeasuredBackgroundLayer, tile: CanvasRect, id: string, transform: PaintMatrix): Extract<PaintOperation, { type: 'gradient' }> {
  if (layer.kind !== 'gradient' || !id || !finite(...transform, tile.x, tile.y, tile.width, tile.height) || tile.width <= 0 || tile.height <= 0 || Math.abs(transform[0] * transform[3] - transform[1] * transform[2]) < 1e-12) error('gradient operation metrics')
  const match = /^(linear|radial)-gradient\((.*)\)$/.exec(layer.source)
  if (!match) return error('gradient type')
  const tokens = lists(match[2]); let gradient: GradientPaint, brushTransform: PaintMatrix = [1, 0, 0, 1, 0, 0]
  if (match[1] === 'linear') {
    let angle = Math.PI
    const direction = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(deg|rad|grad|turn)$/.exec(tokens[0])
    if (direction) { angle = Number(direction[1]) * ({ deg: Math.PI / 180, rad: 1, grad: Math.PI / 200, turn: Math.PI * 2 }[direction[2]]!); tokens.shift() }
    else if (tokens[0].startsWith('to ')) {
      const words = tokens.shift()!.slice(3).trim().split(/\s+/), x = words.includes('right') ? 1 : words.includes('left') ? -1 : 0, y = words.includes('bottom') ? 1 : words.includes('top') ? -1 : 0
      if (!words.length || words.length > 2 || words.some(word => !['left', 'right', 'top', 'bottom'].includes(word)) || words.includes('left') && words.includes('right') || words.includes('top') && words.includes('bottom')) error('linear direction')
      angle = x && y ? Math.atan2(x * tile.height, -y * tile.width) : Math.atan2(x, -y)
    }
    const dx = Math.sin(angle), dy = -Math.cos(angle), basis = Math.abs(tile.width * dx) + Math.abs(tile.height * dy)
    if (!finite(angle, basis) || basis <= 0) error('linear geometry')
    const colors = stops(tokens, basis, false), low = Math.min(0, colors[0].offset), high = Math.max(1, colors.at(-1)!.offset), cx = tile.x + tile.width / 2, cy = tile.y + tile.height / 2
    gradient = { kind: 'linear', start: [cx + dx * basis * (low - .5), cy + dy * basis * (low - .5)], end: [cx + dx * basis * (high - .5), cy + dy * basis * (high - .5)], stops: colors.map(stop => ({ ...stop, offset: (stop.offset - low) / (high - low) })), interpolation: 'srgb', alphaInterpolation: 'premultiplied' }
  } else {
    let shape = 'ellipse', extent = 'farthest-corner', center: readonly [Length, Length] = [{ unit: 'percent', value: 50 }, { unit: 'percent', value: 50 }], radii: readonly Length[] = []
    if (!normalizeMeasuredColor(tokenize(tokens[0], 'space')[0])) {
      const header = tokens.shift()!, pieces = header.startsWith('at ') ? ['', header.slice(3)] : header.split(/\s+at\s+/)
      if (pieces.length > 2) error('radial center')
      if (pieces[1]) center = position(pieces[1])
      const words = pieces[0].trim() ? tokenize(pieces[0], 'space') : []
      if (words.includes('circle')) shape = 'circle'
      if (words.includes('ellipse') && words.includes('circle')) error('radial shape')
      const sizes = words.filter(word => !['circle', 'ellipse'].includes(word))
      if (sizes.length === 1 && ['closest-side', 'farthest-side', 'closest-corner', 'farthest-corner'].includes(sizes[0])) extent = sizes[0]
      else if (sizes.length) { radii = sizes.map(length); if (radii.length > 2) error('radial extent'); if (!words.includes('ellipse') && !words.includes('circle') && radii.length === 1) shape = 'circle' }
    }
    const cx = used(center[0], tile.width), cy = used(center[1], tile.height), xs = [Math.abs(cx), Math.abs(tile.width - cx)], ys = [Math.abs(cy), Math.abs(tile.height - cy)]
    const closest = extent.startsWith('closest'), choose = closest ? Math.min : Math.max
    let rx: number, ry: number
    if (radii.length) {
      if (shape === 'circle' && (radii.length !== 1 || radii[0].unit !== 'px') || shape === 'ellipse' && radii.length !== 2) error('radial explicit size')
      rx = used(radii[0], tile.width); ry = shape === 'circle' ? rx : used(radii[1], tile.height)
    } else if (shape === 'circle') {
      rx = extent.endsWith('side') ? choose(...xs, ...ys) : choose(...xs.flatMap(x => ys.map(y => Math.hypot(x, y)))); ry = rx
    } else {
      rx = choose(...xs); ry = choose(...ys)
      if (extent.endsWith('corner')) {
        if (rx <= 0 || ry <= 0) error('degenerate radial extent')
        const factor = choose(...xs.flatMap(x => ys.map(y => Math.hypot(x / rx, y / ry))))
        rx *= factor; ry *= factor
      }
    }
    if (!finite(cx, cy, rx, ry) || rx <= 0 || ry <= 0) error('radial geometry')
    const colors = stops(tokens, rx, true), high = Math.max(1, colors.at(-1)!.offset)
    gradient = { kind: 'radial', center: [0, 0], radius: 1, stops: colors.map(stop => ({ ...stop, offset: stop.offset / high })), interpolation: 'srgb', alphaInterpolation: 'premultiplied' }
    brushTransform = [rx * high, 0, 0, ry * high, tile.x + cx, tile.y + cy]
  }
  return { type: 'gradient', id, commands: rectangle(tile), transform, brushTransform, fillRule: 'nonzero', gradient }
}
