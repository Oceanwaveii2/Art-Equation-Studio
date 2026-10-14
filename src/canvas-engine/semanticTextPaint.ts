import { normalizeMeasuredColor } from './measuredColor'
import type { PaintMatrix, PaintOperation } from './paintDisplayList'
import { canvasResourceBudget, type CanvasResourceBudget } from './resourceBudget'

/** These are derivatives of the semantic DOM. No editable text model is added. */
import type {ResolvedTextFont,TextFontResolver} from './nativeTextFonts'
export {createNativeTextFontResolver} from './nativeTextFonts'
export type {ResolvedTextFont,TextFontDescriptor,TextFallbackDescriptor,TextFontResolver,ManagedTextFontResolver} from './nativeTextFonts'
export type SemanticTextSpan = Readonly<{
  start: number; end: number; fonts: readonly Readonly<{ key: string; revision: string }>[]
  fontSize: number; fontWeight: number; fontStyle: 'normal' | 'italic'; lineHeight: number
  letterSpacing: number; color: string; underline: boolean; strike: boolean; highlight?: string
  features?: Readonly<Record<string, number>>
}>
export type ShapedTextRequest = Readonly<{
  schema: 'art-equation.shaped-text'; schemaVersion: 1; id: string; revision: string
  fontEpoch: string; text: string; maxWidth: number; alignment: string; transform: PaintMatrix
  spans: readonly SemanticTextSpan[]; overflowWrap: 'normal' | 'anywhere' | 'break-word'; wrapMode: 'wrap' | 'nowrap'
}>
export type PositionedTextPaint = Readonly<{
  schema: 'art-equation.positioned-outlines'; schemaVersion: 1; id: string; revision: string
  fontEpoch: string; width: number; height: number; completePaint: boolean
  operations: readonly PaintOperation[]
  lines: readonly Readonly<{ textRange: readonly [number, number]; advance: number; trailingWhitespace: number; baseline: number; height: number }>[]
}>
export type TextLayoutMeasurement = Readonly<{
  clientLines: readonly Readonly<{ x: number; y: number; width: number; height: number }>[]
  completePaint: false; blockers: readonly string[]; sourceFingerprint: string
  direction?: 'ltr' | 'rtl'
  sourceToLayoutUtf16?: readonly number[]
}>

/** Computed OpenType feature syntax. Unknown settings are never erased. */
export function parseCssFontFeatures(source: string, kerning = 'auto'): Readonly<Record<string, number>> {
  const features: Record<string, number> = {}
  if (source !== 'normal') for (const setting of source.split(',')) {
    const match = /^\s*["']([\x20-\x7e]{4})["'](?:\s+(on|off|\d+))?\s*$/.exec(setting)
    if (!match) throw new Error('TEXT_FEATURES_UNSUPPORTED')
    const value = match[2] === 'off' ? 0 : match[2] === 'on' || !match[2] ? 1 : Number(match[2])
    if (!Number.isInteger(value) || value > 65535) throw new Error('TEXT_FEATURES_UNSUPPORTED')
    features[match[1]] = value
  }
  if (kerning === 'none') features.kern = 0
  else if (!['auto', 'normal'].includes(kerning)) throw new Error('TEXT_FEATURES_UNSUPPORTED')
  return features
}

/** CSS family parser preserves ordered names and quoted commas. */
export function parseCssFontFamilies(source: string): string[] {
  const result: string[] = []; let current = ''; let quote = ''; let escape = false
  for (const char of source) {
    if (escape) { current += char; escape = false; continue }
    if (char === '\\') { escape = true; continue }
    if (quote) { if (char === quote) quote = ''; else current += char; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === ',') { if (current.trim()) result.push(current.trim()); current = '' }
    else current += char
  }
  if (quote || escape) throw new Error('TEXT_INPUT_INVALID: malformed CSS font family')
  if (current.trim()) result.push(current.trim())
  if (!result.length || result.length > 32 || result.some(name => name.length > 256)) throw new Error('TEXT_INPUT_INVALID: font families')
  return result
}

/** Never interpret JS UTF-16 indices as the shaper's UTF-8 byte offsets. */
export function utf8Offsets(text: string): readonly number[] {
  const result = [0]; let bytes = 0
  for (let index = 0; index < text.length;) {
    const point = text.codePointAt(index)!
    if (point >= 0xd800 && point <= 0xdfff) throw new Error('TEXT_INPUT_INVALID: unpaired surrogate')
    const length = point > 0xffff ? 2 : 1
    if (length === 2) result.push(-1)
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
    result.push(bytes); index += length
  }
  return result
}

/** Explicit derivative map for CSS normal/nowrap whitespace. Source HTML is
 * untouched. Collapsed source characters remain represented in the map. */
export function collapseCssWhitespace(pieces: readonly string[]): { pieces: readonly string[]; sourceToLayoutUtf16: readonly number[] } {
  const output: string[] = []; const offsets = [0]; let space = true; let length = 0
  for (const piece of pieces) {
    let normalized = ''
    for (const char of piece) {
      if (' \t\n\r\f'.includes(char)) {
        if (!space) { normalized += ' '; length++; space = true }
        offsets.push(length)
      } else {
        normalized += char; space = false
        for (let index = 0; index < char.length; index++) offsets.push(++length)
      }
    }
    output.push(normalized)
  }
  // CSS collapses the final paragraph-edge space as well as leading space.
  if (space && length > 0) {
    for (let index = output.length - 1; index >= 0; index--) if (output[index]) { output[index] = output[index].slice(0, -1); break }
    length--; for (let index = 0; index < offsets.length; index++) offsets[index] = Math.min(offsets[index], length)
  }
  return { pieces: output, sourceToLayoutUtf16: offsets }
}



type TextPiece = { node: Text; text: string; element: HTMLElement; style: CSSStyleDeclaration; styleFingerprint: string; ancestors: readonly {element:HTMLElement;style:CSSStyleDeclaration;fingerprint:string}[] }
export type CanonicalTextRead = <T>(read: () => T) => T
function snapshotComputedStyle(element: Element, view: Window): CSSStyleDeclaration {
  const source = view.getComputedStyle(element), snapshot: Record<string, string> = {}
  // A detached CSS declaration normalizes shorthands and can reset other
  // properties. Copy primitive computed values verbatim before any await.
  for (const property of ['fontFamily','fontSize','fontWeight','fontStyle','fontStretch','fontFeatureSettings','fontVariationSettings','fontKerning','lineHeight','letterSpacing','wordSpacing','textTransform','whiteSpace','wordBreak','overflowWrap','writingMode','direction','textAlign','textDecoration','textDecorationLine','color','backgroundColor','width','height','padding','border','transform','opacity','filter','textShadow','display','visibility','boxSizing','paddingLeft','paddingRight','borderLeftWidth','borderRightWidth','textOverflow','webkitTextStrokeWidth','mixBlendMode']) snapshot[property] = source[property as keyof CSSStyleDeclaration] as string
  for(const property of ['verticalAlign','textDecorationStyle','textDecorationThickness','textDecorationColor','textUnderlineOffset','textDecorationSkipInk'])snapshot[property]=source[property as keyof CSSStyleDeclaration] as string
  return snapshot as unknown as CSSStyleDeclaration
}
const inlineTags = new Set(['SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'MARK', 'A', 'CODE'])
const styleFingerprint = (style: CSSStyleDeclaration) => JSON.stringify([
  style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.fontStretch,
  style.fontFeatureSettings, style.fontVariationSettings, style.fontKerning, style.lineHeight,
  style.letterSpacing, style.wordSpacing, style.textTransform, style.whiteSpace, style.wordBreak,
  style.overflowWrap, style.writingMode, style.direction, style.textAlign, style.textDecoration,
  style.color, style.backgroundColor, style.width, style.height, style.padding, style.border,
  style.transform, style.opacity, style.filter, style.textShadow, style.display, style.visibility,
  style.verticalAlign,style.textDecorationStyle,style.textDecorationThickness,style.textDecorationColor,style.textUnderlineOffset,style.textDecorationSkipInk,
])

/** Capture one actual mounted paragraph/heading/title. Lists and multi-block
 * HTML must be compiled as independent measured paragraphs by the caller.
 * Decorations need actual inline paint geometry; output stays partial. */
export async function captureSemanticParagraph(element: HTMLElement, options: {
  id: string; revision: string; fontEpoch: string; transform: PaintMatrix; resolveFont: TextFontResolver; canonicalRead?: CanonicalTextRead; rootBackgroundOwned?: boolean
}): Promise<{ request: ShapedTextRequest | null; fonts: readonly ResolvedTextFont[]; measurement: TextLayoutMeasurement }> {
  const view = element.ownerDocument.defaultView
  const blockers = new Set<string>(['TEXT_DOM_LAYOUT_PARITY_PENDING', 'TEXT_BASELINE_ORACLE_PENDING'])
  const measuredLines: { x: number; y: number; width: number; height: number }[] = []
  const fonts = new Map<string, ResolvedTextFont>()
  const read = options.canonicalRead ?? (read => read())
  const fingerprint = read(() => element.innerHTML)
  const fail = (reason: string) => {
    blockers.add(reason)
    return { request: null, fonts: [...fonts.values()], measurement: { clientLines: measuredLines, completePaint: false as const, blockers: [...blockers], sourceFingerprint: fingerprint } }
  }
  if (!view || !element.isConnected || !options.id || !options.revision || !options.fontEpoch) return fail('TEXT_LAYOUT_NOT_MOUNTED')
  if (options.transform.length !== 6 || options.transform.some(value => !Number.isFinite(value))) return fail('TEXT_MATRIX_INVALID')
  const rootStyle = read(() => snapshotComputedStyle(element, view))
  const rootStyleFingerprint = styleFingerprint(rootStyle)
  if (rootStyle.writingMode !== 'horizontal-tb' || !['none', 'uppercase', 'lowercase'].includes(rootStyle.textTransform) || !['ltr', 'rtl'].includes(rootStyle.direction)) return fail('TEXT_WRITING_MODE_OR_TRANSFORM_UNSUPPORTED')
  if (!['normal', 'nowrap', 'pre', 'pre-wrap', 'break-spaces'].includes(rootStyle.whiteSpace)) return fail('TEXT_WHITESPACE_MAPPING_PENDING')
  if (rootStyle.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + 0.5 || !['normal', 'anywhere', 'break-word'].includes(rootStyle.overflowWrap) || rootStyle.wordBreak !== 'normal') return fail('TEXT_BREAK_OR_ELLIPSIS_UNSUPPORTED')
  const pieces: TextPiece[] = []
  const collect = (current: Node): boolean => {
    if (current.nodeType === 3) {
      const node = current as Text; if (!node.data) return true
      const parent = node.parentElement
      if (!(parent instanceof view.HTMLElement)) return false
      const style = read(() => snapshotComputedStyle(parent, view))
      const ancestors: TextPiece['ancestors'][number][]=[]
      for(let ancestor:HTMLElement|null=parent;ancestor;ancestor=ancestor.parentElement){const css=snapshotComputedStyle(ancestor,view);ancestors.push({element:ancestor,style:css,fingerprint:styleFingerprint(css)});if(ancestor===element)break}
      pieces.push({ node, text: node.data, element: parent, style, styleFingerprint: styleFingerprint(style),ancestors }); return true
    }
    if (current !== element && (!(current instanceof view.HTMLElement) || !inlineTags.has(current.tagName))) return false
    for (const child of current.childNodes) if (!collect(child)) return false
    return true
  }
  if (!read(() => collect(element))) return fail('TEXT_BLOCK_OR_REPLACED_CONTENT_UNSUPPORTED')
  const collapsed = ['normal', 'nowrap'].includes(rootStyle.whiteSpace) ? collapseCssWhitespace(pieces.map(piece => piece.text)) : null
  const layoutPieces = [...(collapsed?.pieces ?? pieces.map(piece => piece.text))]
  for (const [index, piece] of pieces.entries()) {
    if (piece.style.textTransform === 'none') continue
    if (!['uppercase', 'lowercase'].includes(piece.style.textTransform) || /[^\x00-\x7f]/.test(piece.text) || element.closest('[lang]')?.getAttribute('lang') && !/^en(?:-|$)/i.test(element.closest('[lang]')!.getAttribute('lang')!)) return fail('TEXT_CASE_TRANSFORM_MAPPING_PENDING')
    layoutPieces[index] = piece.style.textTransform === 'uppercase' ? layoutPieces[index].toUpperCase() : layoutPieces[index].toLowerCase()
  }
  const text = layoutPieces.join('')
  try { utf8Offsets(text) } catch { return fail('TEXT_INPUT_INVALID') }
  if (new TextEncoder().encode(text).length > 64 * 1024 || pieces.length > 1024) return fail('TEXT_RESOURCE_LIMIT')
  const width = Number.parseFloat(rootStyle.width)
  const padding = Number.parseFloat(rootStyle.paddingLeft) + Number.parseFloat(rootStyle.paddingRight)
  const borders = Number.parseFloat(rootStyle.borderLeftWidth) + Number.parseFloat(rootStyle.borderRightWidth)
  const contentWidth = rootStyle.boxSizing === 'border-box' ? width - padding - borders : width
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return fail('TEXT_LAYOUT_WIDTH_INVALID')
  const spans: SemanticTextSpan[] = []; let offset = 0
  for (const [pieceIndex, piece] of pieces.entries()) {
    const style = piece.style
    if (style.fontVariationSettings !== 'normal' || style.textShadow !== 'none' || style.filter !== 'none' || style.webkitTextStrokeWidth !== '0px' || style.fontStretch !== '100%' && style.fontStretch !== 'normal' || Number.parseFloat(style.opacity) !== 1 || style.mixBlendMode !== 'normal' || style.wordSpacing !== 'normal' && Number.parseFloat(style.wordSpacing) !== 0 || style.display === 'none' || style.visibility !== 'visible') return fail('TEXT_STYLE_UNSUPPORTED')
    let features: Readonly<Record<string, number>>
    try { features = parseCssFontFeatures(style.fontFeatureSettings, style.fontKerning) } catch { return fail('TEXT_FEATURES_UNSUPPORTED') }
    const weight = Number(style.fontWeight), size = Number.parseFloat(style.fontSize)
    // Normal CSS leading is measured by the independent baseline oracle. The
    // shaper's provisional leading is never claimed to be the browser metric.
    const leading = style.lineHeight === 'normal' ? 1.2 : Number.parseFloat(style.lineHeight) / size
    const spacing = style.letterSpacing === 'normal' ? 0 : Number.parseFloat(style.letterSpacing)
    if (!Number.isFinite(weight) || !Number.isFinite(size) || size < 1 || size > 1024 || !Number.isFinite(leading) || !Number.isFinite(spacing)) return fail('TEXT_METRICS_PENDING')
    if (!['normal', 'italic'].includes(style.fontStyle)) return fail('TEXT_STYLE_UNSUPPORTED')
    const refs: { key: string; revision: string }[] = []
    const families = parseCssFontFamilies(style.fontFamily)
    for (const family of families) {
      try {
        const face = await options.resolveFont({ family, weight, italic: style.fontStyle === 'italic' })
        if (face.synthesisRequired) return fail(`FONT_SYNTHESIS_UNSUPPORTED: ${JSON.stringify({ family, weight, style: style.fontStyle, resolvedFamily: face.resolvedFamily, face: face.key })}`)
        fonts.set(face.key, face); refs.push({ key: face.key, revision: face.revision })
      } catch (error) {
        if (!String(error).includes('FONT_FAMILY_NOT_FOUND')) return fail(String(error))
      }
    }
    if (options.resolveFont.fallbacks && /[^\x20-\x7e\u00a0-\u024f]/.test(layoutPieces[pieceIndex])) {
      try {
        const locale = element.closest('[lang]')?.getAttribute('lang') || undefined
        const fallbacks = await options.resolveFont.fallbacks({ families, weight, italic: style.fontStyle === 'italic', text: layoutPieces[pieceIndex], ...(locale ? { locale } : {}) })
        for (const face of fallbacks) { if (face.synthesisRequired) return fail('FONT_SYNTHESIS_UNSUPPORTED'); fonts.set(face.key, face); if (!refs.some(ref => ref.key === face.key)) refs.push({ key: face.key, revision: face.revision }) }
      } catch (error) { return fail(String(error)) }
    }
    if (!refs.length) return fail('FONT_NOT_READY')
    const color = normalizeMeasuredColor(style.color)
    if(piece.element!==element&&(style.verticalAlign!=='baseline'||style.transform!=='none'))return fail('TEXT_INLINE_ALIGNMENT_OR_TRANSFORM_UNSUPPORTED')
    const decorations=piece.ancestors.filter(ancestor=>ancestor.style.textDecorationLine!=='none')
    if(decorations.some(({style:css})=>css.textDecorationStyle!=='solid'||css.textDecorationThickness!=='auto'||css.textUnderlineOffset!=='auto'||normalizeMeasuredColor(css.textDecorationColor)!==normalizeMeasuredColor(style.color)))return fail('TEXT_DECORATION_STYLE_UNSUPPORTED')
    const underline=decorations.some(({style:css})=>css.textDecorationLine.includes('underline')),strike=decorations.some(({style:css})=>css.textDecorationLine.includes('line-through'))
    if(decorations.some(({style:css})=>css.textDecorationLine.includes('overline')))return fail('TEXT_DECORATION_STYLE_UNSUPPORTED')
    const background=piece.ancestors.find(ancestor=>!(options.rootBackgroundOwned&&ancestor.element===element)&&normalizeMeasuredColor(ancestor.style.backgroundColor)!=='#00000000')
    const highlight=background?normalizeMeasuredColor(background.style.backgroundColor):'#00000000'
    if (!color || !highlight) return fail('TEXT_COLOR_UNSUPPORTED')
    const byteLength = new TextEncoder().encode(layoutPieces[pieceIndex]).length
    if (byteLength) spans.push({ start: offset, end: offset + byteLength, fonts: refs, fontSize: size, fontWeight: weight,
      fontStyle: style.fontStyle as 'normal' | 'italic', lineHeight: leading, letterSpacing: spacing, color,
      underline,strike,
      ...(Object.keys(features).length ? { features } : {}),
      ...(highlight !== '#00000000' ? { highlight } : {}),
    }); offset += byteLength
    read(() => {
      const range = element.ownerDocument.createRange(); range.selectNodeContents(piece.node)
      for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) measuredLines.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      range.detach()
    })
  }
  if (!read(() => element.isConnected && element.innerHTML === fingerprint && styleFingerprint(view.getComputedStyle(element)) === rootStyleFingerprint && pieces.every(piece => piece.element.isConnected && styleFingerprint(view.getComputedStyle(piece.element)) === piece.styleFingerprint&&piece.ancestors.every(ancestor=>ancestor.element.isConnected&&styleFingerprint(view.getComputedStyle(ancestor.element))===ancestor.fingerprint)))) return fail('TEXT_LAYOUT_CHANGED_DURING_FONT_RESOLUTION')
  const alignment = rootStyle.textAlign === 'justify-all' ? 'justify' : rootStyle.textAlign
  if (!['left', 'right', 'start', 'end', 'center', 'justify'].includes(alignment)) return fail('TEXT_ALIGNMENT_UNSUPPORTED')
  return {
    request: { schema: 'art-equation.shaped-text', schemaVersion: 1, id: options.id, revision: options.revision,
      fontEpoch: options.fontEpoch, text, maxWidth: contentWidth,
      alignment: rootStyle.direction === 'ltr' && alignment === 'start' ? 'left' : rootStyle.direction === 'ltr' && alignment === 'end' ? 'right' : alignment,
      transform: options.transform, spans, overflowWrap: rootStyle.overflowWrap as 'normal' | 'anywhere' | 'break-word',
      wrapMode: ['pre', 'nowrap'].includes(rootStyle.whiteSpace) ? 'nowrap' : 'wrap' },
    fonts: [...fonts.values()], measurement: { clientLines: measuredLines, completePaint: false,
      blockers: [...blockers], sourceFingerprint: fingerprint, direction: rootStyle.direction as 'ltr' | 'rtl', ...(collapsed ? { sourceToLayoutUtf16: collapsed.sourceToLayoutUtf16 } : {}) },
  }
}

/** Only a partial geometry comparison. A line-width match cannot certify
 * baseline, hinting, glyph pixels, decorations, selection or IME equivalence. */
export function compareTextLineWidths(shaped: PositionedTextPaint, clientLines: TextLayoutMeasurement['clientLines'], cssScale: number, tolerance = 0.5): { passed: boolean; completePaint: false; differences: readonly number[] } {
  if (!Number.isFinite(cssScale) || cssScale <= 0 || !Number.isFinite(tolerance) || tolerance < 0) return { passed: false, completePaint: false, differences: [] }
  const lines: { y: number; left: number; right: number }[] = []
  for (const rect of clientLines) {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0) return { passed: false, completePaint: false, differences: [] }
    const line = lines.find(line => Math.abs(line.y - rect.y) <= 0.5 * cssScale)
    if (line) { line.left = Math.min(line.left, rect.x); line.right = Math.max(line.right, rect.x + rect.width) }
    else lines.push({ y: rect.y, left: rect.x, right: rect.x + rect.width })
  }
  lines.sort((a, b) => a.y - b.y)
  if (lines.length !== shaped.lines.length) return { passed: false, completePaint: false, differences: [] }
  const differences = lines.map((line, index) => (line.right - line.left) / cssScale - (shaped.lines[index].advance - shaped.lines[index].trailingWhitespace))
  return { passed: differences.every(value => Math.abs(value) <= tolerance), completePaint: false, differences }
}

export type ShapedTextEngineHost = {
  register_font(key: string, revision: string, faceIndex: number, bytes: Uint8Array): string
  shape(request: string): string; resource_stats(): string; remove_font(key: string): void; free?(): void
}
export type QualifiedParagraphPaint = Readonly<{
  completePaint: boolean; operations: readonly PaintOperation[]; blockers: readonly string[]
  id: string; revision: string; fontEpoch: string; sourceFingerprint: string
  qualification?: Readonly<{ policy: string; fontHashes: readonly string[]; widthDifferences: readonly number[]; lines: readonly DomTextLine[]; scaleDependent?: boolean }>
  visualBounds?: Readonly<{ x: number; y: number; width: number; height: number }>
  /** Release when the caller retires this derivative; editing state is untouched. */
  release(): void
}>
type DomTextLine = Readonly<{ layoutStart: number; layoutEnd: number; sourceStart: number; sourceEnd: number; x: number; y: number; width: number; height: number; baseline: number }>

// Filled only after immutable actual mounted DOM / shared GPU / genuine CPU
// pixel receipts pass. A different platform font remains in its semantic DOM.
const PIXEL_QUALIFIED_FONT_FACES = new Set<string>([
  // Exact installed face identities checked against actual mounted App DOM,
  // shared Vello GPU and genuine CPU at DPR 1, 1.5 and 2 on the capped bundle.
  '3127f0b873387ee37e2040135a06e9e9c05030f509eb63689529becf28b50384:0', // Inter regular
  '412c068eab6f36e6807d630ff89127165e8e4d3e8653434cdfb56b60cdcc3a32:0', // Inter bold
  '8134dbcd09e7b123c9a7f229d49cffbcb01352cc72ea5e1076b65d0dca9f73cd:0', // Segoe UI regular
  '2d9b22d71f72de2823fee5d9c8bc1b0fc32b2577c4c27b9ec6abdbb8df0e1731:0', // Segoe UI semibold
  'aeb9e4a6ec5cc59f4d72df8189032d7dbb28f45161cf1552174818b5465dac4e:0', // Segoe UI bold
  '38dffcaf1fac89492f7c56c600a14daf36ae42f7c21985cd4134ae113124a58f:0', // Georgia regular
  '72a6cd94fab6c179392075d3fb361e269cdddfad41bb7ab385fa22a37e49a900:0', // Georgia bold
  // Explicit paragraph direction + shared backing-scale hinting, all 3 DPRs.
  'b3658eadae55e682b5f69eb64c439c1ecc8f196c0bb8d4756d145d13bc86476a:0', // Arial Arabic fallback
])
const SVG_PIXEL_QUALIFIED_FONT_FACES = new Set<string>([
  // Actual transformed ellipse and nested diagram captions, DPR 1/1.5/2:
  // docs/engine-p0/2026-10-03/text-completion/svg-viewport-dpr*/.
  'b0b540e69bf6717016e33874670e09acf4bffc2ca3f4c1cf174a4ff696308c65:0',
  '8134dbcd09e7b123c9a7f229d49cffbcb01352cc72ea5e1076b65d0dca9f73cd:0',
])
export type SvgTextPaintOptions = Readonly<{ id: string; revision: string; transform: PaintMatrix; resolveFont: TextFontResolver; canonicalRead?: CanonicalTextRead; rootOpacityOwned?: boolean }>

/** Independent baseline oracle in an inert, transparent clone outside the app.
 * No probe is inserted into Tiptap: canonical HTML, selection and IME are intact.
 * Character ranges give the real browser line partition and content offsets. */
export function measureSemanticTextLines(element: HTMLElement, measurement: TextLayoutMeasurement): readonly DomTextLine[] {
  const view = element.ownerDocument.defaultView
  if (!view || !element.isConnected) throw new Error('TEXT_LAYOUT_NOT_MOUNTED')
  const style = view.getComputedStyle(element), bounds = element.getBoundingClientRect()
  const boxWidth = Number.parseFloat(style.width), scale = bounds.width / boxWidth
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(bounds.height / (Number.parseFloat(style.height) || bounds.height) - scale) > 0.05) throw new Error('TEXT_NONUNIFORM_DOM_TRANSFORM_UNSUPPORTED')
  const left = bounds.left + (Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft)) * scale
  const top = bounds.top + (Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop)) * scale
  const document = element.ownerDocument, texts: { node: Text; start: number; end: number }[] = []
  const walker = document.createTreeWalker(element, 4); let total = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) { const text = node as Text; texts.push({ node: text, start: total, end: total + text.length }); total += text.length }
  if (total > 8192) throw new Error('TEXT_DOM_MEASUREMENT_LIMIT: 8192 source code units')
  const lines: { layoutStart: number; layoutEnd: number; sourceStart: number; sourceEnd: number; x: number; y: number; width: number; height: number; baseline: number }[] = []
  const characters: { sourceStart: number; sourceEnd: number; x: number; y: number; width: number; height: number }[] = []
  const map = measurement.sourceToLayoutUtf16
  for (const { node, start } of texts) for (let index = 0; index < node.length;) {
    const length = node.data.codePointAt(index)! > 0xffff ? 2 : 1, sourceStart = start + index, sourceEnd = sourceStart + length
    const layoutStart = map?.[sourceStart] ?? sourceStart, layoutEnd = map?.[sourceEnd] ?? sourceEnd
    if (layoutEnd > layoutStart) {
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + length)
      const rect = range.getBoundingClientRect(); range.detach()
      if (rect.width > 0 && rect.height > 0) {
        const x = (rect.x - left) / scale, y = (rect.y - top) / scale, width = rect.width / scale, height = rect.height / scale
        characters.push({ sourceStart, sourceEnd, x, y, width, height })
        // Inline faces can have different ascent/descent rectangles on the
        // same baseline. Group their real overlapping glyph rectangles, then
        // certify the resulting baseline and clone layout independently below.
        const candidates = lines.filter(line => Math.min(line.y + line.height, y + height) - Math.max(line.y, y) >= Math.min(line.height, height) * 0.5)
        if (candidates.length > 1) throw new Error('TEXT_AMBIGUOUS_DOM_LINE_PARTITION')
        const line = candidates[0]
        if (line) { const right = Math.max(line.x + line.width, x + width), bottom = Math.max(line.y + line.height, y + height); line.x = Math.min(line.x, x); line.y = Math.min(line.y, y); line.width = right - line.x; line.height = bottom - line.y; line.layoutStart = Math.min(line.layoutStart, layoutStart); line.layoutEnd = Math.max(line.layoutEnd, layoutEnd); line.sourceStart = Math.min(line.sourceStart, sourceStart); line.sourceEnd = Math.max(line.sourceEnd, sourceEnd) }
        else lines.push({ layoutStart, layoutEnd, sourceStart, sourceEnd, x, y, width, height, baseline: NaN })
      }
    }
    index += length
  }
  lines.sort((a, b) => a.y - b.y)
  if (lines.some((line, index) => index > 0 && line.layoutStart < lines[index - 1].layoutEnd)) throw new Error('TEXT_OVERLAPPING_DOM_SOURCE_LINES')
  const clone = element.cloneNode(true) as HTMLElement
  const copyStyles = (original: Element, copy: Element) => {
    if (!(copy instanceof view.HTMLElement)) throw new Error('TEXT_CLONE_UNSUPPORTED')
    const css = view.getComputedStyle(original); for (const property of css) copy.style.setProperty(property, css.getPropertyValue(property))
    for (let index = 0; index < original.children.length; index++) copyStyles(original.children[index], copy.children[index])
  }
  copyStyles(element, clone)
  Object.assign(clone.style, { position: 'fixed', left: '0px', top: '0px', margin: '0px', transform: 'none', opacity: '0', pointerEvents: 'none', width: style.width, height: 'auto', minHeight: '0px' })
  clone.setAttribute('aria-hidden', 'true'); clone.inert = true
  const cloneTexts: Text[] = [], cloneWalker = document.createTreeWalker(clone, 4)
  for (let node = cloneWalker.nextNode(); node; node = cloneWalker.nextNode()) cloneTexts.push(node as Text)
  const probes: { line: typeof lines[number]; probe: HTMLElement }[] = []
  const sourceText = element.textContent ?? ''
  for (const line of [...lines].reverse()) {
    // A single measured line needs no internal wrap anchor. A probe between
    // its words can change the preceding space's Range even without wrapping.
    let anchor = line.sourceEnd
    if (lines.length > 1) {
      // A probe before a wrapped word can stay on the preceding line. Anchor
      // after the first word and its break-spaces wrapping unit instead.
      anchor = line.sourceStart
      while (anchor < line.sourceEnd && /[ \t\n\r\f]/.test(sourceText[anchor])) anchor++
      while (anchor < line.sourceEnd && !/[ \t\n\r\f]/.test(sourceText[anchor])) anchor += sourceText.codePointAt(anchor)! > 0xffff ? 2 : 1
      while (anchor < line.sourceEnd && /[ \t\n\r\f]/.test(sourceText[anchor])) anchor++
    }
    const textIndex = texts.findIndex(text => anchor > text.start && anchor <= text.end)
    if (textIndex < 0) throw new Error('TEXT_BASELINE_SOURCE_MAPPING_INVALID')
    const text = cloneTexts[textIndex], probe = document.createElement('span')
    Object.assign(probe.style, { display: 'inline-block', width: '0px', height: '0px', padding: '0px', margin: '0px', border: '0px', verticalAlign: 'baseline' })
    const range = document.createRange(); range.setStart(text, anchor - texts[textIndex].start); range.collapse(true); range.insertNode(probe); range.detach(); probes.push({ line, probe })
  }
  document.body.append(clone)
  try {
    const cloneBounds = clone.getBoundingClientRect(), inset = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop)
    if (Math.abs(cloneBounds.height - bounds.height / scale) > 0.5) throw new Error('TEXT_BASELINE_CLONE_LAYOUT_CHANGED')
    const finalTexts: { node: Text; start: number; end: number }[] = [], finalWalker = document.createTreeWalker(clone, 4)
    let finalOffset = 0
    for (let node = finalWalker.nextNode(); node; node = finalWalker.nextNode()) { const text = node as Text; finalTexts.push({ node: text, start: finalOffset, end: finalOffset + text.length }); finalOffset += text.length }
    if (finalOffset !== total) throw new Error('TEXT_BASELINE_CLONE_SOURCE_CHANGED')
    const cloneLeft = cloneBounds.left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft)
    for (const character of characters) {
      const text = finalTexts.find(text => character.sourceStart >= text.start && character.sourceEnd <= text.end)
      if (!text) throw new Error('TEXT_BASELINE_CLONE_CLUSTER_SPLIT')
      const range = document.createRange(); range.setStart(text.node, character.sourceStart - text.start); range.setEnd(text.node, character.sourceEnd - text.start)
      const rect = range.getBoundingClientRect(); range.detach()
      if (Math.abs(rect.x - cloneLeft - character.x) > 0.5 || Math.abs(rect.y - cloneBounds.top - inset - character.y) > 0.5 || Math.abs(rect.width - character.width) > 0.5 || Math.abs(rect.height - character.height) > 0.5) throw new Error(`TEXT_BASELINE_CLONE_LAYOUT_CHANGED: source ${character.sourceStart}`)
    }
    for (const { line, probe } of probes) line.baseline = probe.getBoundingClientRect().top - cloneBounds.top - inset
    if (lines.some(line => !Number.isFinite(line.baseline) || line.baseline < line.y - 0.5 || line.baseline > line.y + line.height + 0.5)) throw new Error(`TEXT_BASELINE_ORACLE_INVALID: ${JSON.stringify({ sourceLength: total, scale, lines })}`)
  } finally { clone.remove() }
  return lines
}

/** CSS inline background geometry uses the browser's fragmented inline boxes,
 * not Parley's paragraph line height. Source offsets remain UTF-16 here. */
function measuredInlineBounds(element: HTMLElement, start: number, end: number, line: DomTextLine) {
  const document=element.ownerDocument, css=document.defaultView!.getComputedStyle(element), box=element.getBoundingClientRect(), scale=box.width/parseFloat(css.width)
  const left=box.left+(parseFloat(css.borderLeftWidth)+parseFloat(css.paddingLeft))*scale
  const top=box.top+(parseFloat(css.borderTopWidth)+parseFloat(css.paddingTop))*scale
  const walker=document.createTreeWalker(element,4), rects: DOMRect[]=[];let offset=0
  for(let node=walker.nextNode();node;node=walker.nextNode()) {
    const text=node as Text,a=Math.max(start-offset,0),b=Math.min(end-offset,text.length)
    if(b>a){const range=document.createRange();range.setStart(text,a);range.setEnd(text,b);rects.push(...range.getClientRects());range.detach()}
    offset+=text.length
  }
  const visible=rects.filter(rect=>rect.width>0&&Math.min((rect.bottom-top)/scale,line.y+line.height)>Math.max((rect.top-top)/scale,line.y))
  if(!visible.length)throw new Error('TEXT_RUN_DOM_RANGE_EMPTY')
  const x=(Math.min(...visible.map(rect=>rect.left))-left)/scale,y=(Math.min(...visible.map(rect=>rect.top))-top)/scale
  return {x,y,width:(Math.max(...visible.map(rect=>rect.right))-left)/scale-x,height:(Math.max(...visible.map(rect=>rect.bottom))-top)/scale-y}
}

/** Register once in a bounded shared engine session. Caller retains canonical
 * semantic DOM and releases each prepared derivative when its scene retires. */
export function createTextPaintSession(engine: ShapedTextEngineHost, fontEpoch: string, budget: CanvasResourceBudget = canvasResourceBudget) {
  const owner = {}, registered = new Map<string, ResolvedTextFont>()
  let disposed = false
  const cacheReserve = 8 * 1024 * 1024
  const lease = budget.acquire({ owner, key: `text-engine:${fontEpoch}`, pool: 'retained', bytes: cacheReserve, pinned: true })
  const disposedResult = (options: { id: string; revision: string }, blocker: string, sourceFingerprint = ''): QualifiedParagraphPaint => ({ ...options, fontEpoch, sourceFingerprint, completePaint: false, operations: [], blockers: [blocker], release() {} })
  return {
    async prepareSvg(element: SVGTextElement, options: SvgTextPaintOptions): Promise<QualifiedParagraphPaint> {
      if (disposed) return disposedResult(options, 'TEXT_ENGINE_DISPOSED')
      if (!lease) return disposedResult(options, 'FONT_RESOURCE_LIMIT: engine cache budget')
      const read = options.canonicalRead ?? (read => read()), fingerprint = read(() => element.innerHTML)
      try {
        const captured = read(() => {
          const view = element.ownerDocument.defaultView
          if (!view || !element.isConnected) throw new Error('TEXT_LAYOUT_NOT_MOUNTED')
          if (element.children.length || element.hasAttribute('textLength') || element.hasAttribute('lengthAdjust')) throw new Error('SVG_TEXT_SPANS_OR_LENGTH_ADJUST_PENDING')
          const style = snapshotComputedStyle(element, view), actual = view.getComputedStyle(element)
          if (style.writingMode !== 'horizontal-tb' || style.textTransform !== 'none' || !['ltr', 'rtl'].includes(style.direction) || style.visibility !== 'visible' || style.display === 'none' || style.fontVariationSettings !== 'normal' || style.fontStretch !== '100%' && style.fontStretch !== 'normal' || style.textShadow !== 'none' || style.filter !== 'none' || style.mixBlendMode !== 'normal' || !options.rootOpacityOwned && Number.parseFloat(style.opacity) !== 1 || actual.stroke !== 'none' || style.textDecorationLine !== 'none' || style.wordSpacing !== 'normal' && Number.parseFloat(style.wordSpacing) !== 0) throw new Error('SVG_TEXT_STYLE_UNSUPPORTED')
          const source = element.textContent ?? '', text = ['normal', 'nowrap'].includes(style.whiteSpace) ? collapseCssWhitespace([source]).pieces[0] : source
          if (!text || text.length > 8192 || /[\n\r\t]/.test(text) || element.getNumberOfChars() !== text.length) throw new Error('SVG_TEXT_SOURCE_MAPPING_PENDING')
          const offsets = utf8Offsets(text), width = element.getComputedTextLength(), size = Number.parseFloat(style.fontSize), weight = Number(style.fontWeight), spacing = style.letterSpacing === 'normal' ? 0 : Number.parseFloat(style.letterSpacing)
          const fill = normalizeMeasuredColor(actual.fill), fillOpacity = Number.parseFloat(actual.fillOpacity)
          if (!fill || fillOpacity !== 1 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(size) || size < 1 || size > 1024 || !Number.isFinite(weight) || !Number.isFinite(spacing) || !['normal', 'italic'].includes(style.fontStyle)) throw new Error('SVG_TEXT_METRICS_OR_FILL_UNSUPPORTED')
          let left = Infinity, right = -Infinity, baseline = NaN
          for (let index = 0; index < element.getNumberOfChars(); index++) {
            const start = element.getStartPositionOfChar(index), end = element.getEndPositionOfChar(index)
            if (element.getRotationOfChar(index) !== 0 || ![start.x, start.y, end.x, end.y].every(Number.isFinite)) throw new Error('SVG_TEXT_CHARACTER_TRANSFORM_PENDING')
            if (index === 0) baseline = start.y
            if (Math.abs(start.y - baseline) > 0.5 || Math.abs(end.y - baseline) > 0.5) throw new Error('SVG_TEXT_MULTIPLE_BASELINES_PENDING')
            left = Math.min(left, start.x, end.x); right = Math.max(right, start.x, end.x)
          }
          // SVG character start positions report the alignment baseline. For
          // dominant-baseline:middle that is not the alphabetic glyph baseline.
          // Measure the browser's actual shift using an inert same-font clone,
          // rather than approximating it from a font's ascent or x-height.
          const originalSvg = element.ownerSVGElement
          if (!originalSvg) throw new Error('SVG_TEXT_BASELINE_ROOT_MISSING')
          const probeSvg = originalSvg.cloneNode(false) as SVGSVGElement
          const rootCss = view.getComputedStyle(originalSvg)
          for (const property of rootCss) probeSvg.style.setProperty(property,rootCss.getPropertyValue(property))
          const probeText = element.cloneNode(true) as SVGTextElement
          for (const property of actual) probeText.style.setProperty(property, actual.getPropertyValue(property))
          probeText.removeAttribute('transform'); probeText.style.transform = 'none'
          probeText.style.dominantBaseline = 'alphabetic'; probeText.style.alignmentBaseline = 'baseline'
          probeSvg.setAttribute('aria-hidden', 'true'); probeSvg.setAttribute('inert', '')
          Object.assign(probeSvg.style, { position: 'fixed', left: '0px', top: '0px', opacity: '0', pointerEvents: 'none', overflow: 'visible' })
          const probeGroup = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g')
          const screen = originalSvg.getScreenCTM()
          if (!screen || ![screen.a,screen.b,screen.c,screen.d].every(Number.isFinite)) throw new Error('SVG_TEXT_BASELINE_MATRIX_INVALID')
          // Chromium's SVG font metrics are quantized at the rendered scale.
          // Keep the original linear CTM for this independent baseline probe;
          // an identity-scale clone is not a valid oracle for small transformed text.
          probeSvg.style.transformOrigin = '0px 0px'
          probeSvg.style.transform = 'none'
          let probeParent: SVGElement = probeGroup
          const ancestors: SVGElement[] = []
          for (let parent: Element|null=element.parentElement;parent&&parent!==originalSvg;parent=parent.parentElement) {
            if (parent.localName!=='g'||ancestors.length>=32) throw new Error('SVG_TEXT_BASELINE_ANCESTRY_UNSUPPORTED')
            ancestors.push(parent as unknown as SVGElement)
          }
          for (const original of ancestors.reverse()) {
            const copy=original.cloneNode(false) as SVGElement, css=view.getComputedStyle(original)
            for (const property of css) copy.style.setProperty(property,css.getPropertyValue(property))
            probeParent.append(copy);probeParent=copy
          }
          probeParent.append(probeText); probeSvg.append(probeGroup); element.ownerDocument.body.append(probeSvg)
          const base = probeSvg.getScreenCTM()
          if (!base) { probeSvg.remove(); throw new Error('SVG_TEXT_BASELINE_MATRIX_INVALID') }
          const originalLinear = new DOMMatrix([screen.a,screen.b,screen.c,screen.d,0,0])
          const baseLinear = new DOMMatrix([base.a,base.b,base.c,base.d,0,0])
          const outer = originalLinear.multiply(baseLinear.inverse())
          probeSvg.style.transform = `matrix(${outer.a}, ${outer.b}, ${outer.c}, ${outer.d}, 0, 0)`
          try {
            if (probeText.getNumberOfChars() !== element.getNumberOfChars() || Math.abs(probeText.getComputedTextLength() - width) > 0.5) throw new Error(`SVG_TEXT_BASELINE_ORACLE_INVALID: ${JSON.stringify({originalWidth:width,probeWidth:probeText.getComputedTextLength(),originalCount:element.getNumberOfChars(),probeCount:probeText.getNumberOfChars()})}`)
            const originalExtent = element.getExtentOfChar(0), alphabeticExtent = probeText.getExtentOfChar(0)
            const shift = originalExtent.y - alphabeticExtent.y
            for (let index = 1; index < element.getNumberOfChars(); index++) {
              const original = element.getExtentOfChar(index), alphabetic = probeText.getExtentOfChar(index)
              if (Math.abs(original.y - alphabetic.y - shift) > 0.5 || Math.abs(original.height - alphabetic.height) > 0.5) throw new Error(`SVG_TEXT_BASELINE_ORACLE_INVALID: ${JSON.stringify({index,shift,originalY:original.y,probeY:alphabetic.y,originalHeight:original.height,probeHeight:alphabetic.height})}`)
            }
            baseline += shift
          } finally { probeSvg.remove() }
          if (Math.abs(right - left - width) > 0.5) throw new Error('SVG_TEXT_ADVANCE_GEOMETRY_INVALID')
          const bounds = element.getBBox(), visualBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
          if (![...Object.values(visualBounds), baseline].every(Number.isFinite)) throw new Error('SVG_TEXT_VISUAL_BOUNDS_INVALID')
          return { style, styleFingerprint: styleFingerprint(style), text, bytes: offsets[text.length], width, size, weight, spacing, fill, left, baseline, visualBounds }
        })
        const fonts: ResolvedTextFont[] = [], families = parseCssFontFamilies(captured.style.fontFamily)
        for (const family of families) {
          try { const face = await options.resolveFont({ family, weight: captured.weight, italic: captured.style.fontStyle === 'italic' }); if (face.synthesisRequired) throw new Error('FONT_SYNTHESIS_UNSUPPORTED'); if (!fonts.some(font => font.key === face.key)) fonts.push(face) }
          catch (error) { if (!String(error).includes('FONT_FAMILY_NOT_FOUND')) throw error }
        }
        if (options.resolveFont.fallbacks && /[^\x20-\x7e\u00a0-\u024f]/.test(captured.text)) for (const face of await options.resolveFont.fallbacks({ families, text: captured.text, weight: captured.weight, italic: captured.style.fontStyle === 'italic' })) if (!fonts.some(font => font.key === face.key)) fonts.push(face)
        if (!fonts.length) throw new Error('FONT_NOT_READY')
        for (const font of fonts) if (!registered.has(font.key)) {
          const bytes = cacheReserve + [...registered.values()].reduce((sum, font) => sum + font.bytes.length * 2, 0) + font.bytes.length * 2
          if (!lease.resize(bytes)) throw new Error('FONT_RESOURCE_LIMIT: registered font budget')
          try { const receipt = JSON.parse(engine.register_font(font.key, font.revision, font.faceIndex, font.bytes)); if (receipt.contentHash !== font.contentHash || receipt.faceIndex !== font.faceIndex) throw new Error('FONT_FACE_MISMATCH'); registered.set(font.key, font) }
          catch (error) { lease.resize(bytes - font.bytes.length * 2); throw error }
        }
        const maxCommands = Math.min(262144, Math.max(1024, captured.text.length * 128))
        const scratch = budget.acquire({ owner, key: `svg-text-shape:${options.id}`, pool: 'tile-surface', bytes: maxCommands * 512 + captured.text.length * 128 + 2 * 1024 * 1024, pinned: true })
        if (!scratch) throw new Error('FONT_RESOURCE_LIMIT: SVG shaping scratch estimate')
        let shaped: PositionedTextPaint & { runs: { font: { contentHash: string; faceIndex: number } }[] }
        try { shaped = JSON.parse(engine.shape(JSON.stringify({ schema: 'art-equation.shaped-text', schemaVersion: 1, ...options, resolveFont: undefined, canonicalRead: undefined, rootOpacityOwned: undefined, fontEpoch, text: captured.text, maxCommands, maxWidth: 1000000, wrapMode: 'nowrap', overflowWrap: 'normal', alignment: 'left', baseDirection: captured.style.direction, spans: [{ start: 0, end: captured.bytes, fonts: fonts.map(font => ({ key: font.key, revision: font.revision })), fontSize: captured.size, fontWeight: captured.weight, fontStyle: captured.style.fontStyle, lineHeight: 1.2, letterSpacing: captured.spacing, color: captured.fill, features: parseCssFontFeatures(captured.style.fontFeatureSettings, captured.style.fontKerning) }] }))) }
        finally { scratch.release() }
        if (shaped.lines.length !== 1 || Math.abs(shaped.lines[0].advance - captured.width) > 0.5) throw new Error('SVG_TEXT_ADVANCE_DOM_PARITY_FAILED')
        const dx = captured.left, dy = captured.baseline - shaped.lines[0].baseline
        const operations = shaped.operations.map(operation => {
          if (operation.type !== 'vector') throw new Error('SVG_TEXT_OUTLINE_OPERATION_INVALID')
          const payload = operation.object.payload as { commands: readonly (readonly (string | number)[])[] }
          return { ...operation, object: { ...operation.object, payload: { ...payload, commands: payload.commands.map(command => command.map((value, index) => index === 0 ? value : Number(value) + (index % 2 ? dx : dy))) } } }
        })
        if (disposed || !read(() => element.isConnected && element.innerHTML === fingerprint && styleFingerprint(element.ownerDocument.defaultView!.getComputedStyle(element)) === captured.styleFingerprint)) throw new Error('TEXT_LAYOUT_CHANGED_DURING_PREPARATION')
        const derivativeLease = budget.acquire({ owner, key: `svg-text-paint:${options.id}:${options.revision}`, pool: 'retained', bytes: JSON.stringify(operations).length * 4, pinned: true })
        if (!derivativeLease) throw new Error('FONT_RESOURCE_LIMIT: SVG positioned outlines')
        const usedFaces = shaped.runs.map(run => `${run.font.contentHash}:${run.font.faceIndex}`), completePaint = usedFaces.every(face => SVG_PIXEL_QUALIFIED_FONT_FACES.has(face))
        return { ...options, fontEpoch, sourceFingerprint: fingerprint, completePaint, operations, visualBounds: captured.visualBounds, blockers: completePaint ? [] : ['SVG_TEXT_FONT_PIXEL_ACCEPTANCE_PENDING'], qualification: { policy: 'actual-svg-character-baseline-unhinted-outline-v1', fontHashes: [...new Set(shaped.runs.map(run => run.font.contentHash))], widthDifferences: [captured.width - shaped.lines[0].advance], lines: [{ layoutStart: 0, layoutEnd: captured.text.length, sourceStart: 0, sourceEnd: captured.text.length, x: captured.left, y: captured.visualBounds.y, width: captured.width, height: captured.visualBounds.height, baseline: captured.baseline }] }, release: () => derivativeLease.release() }
      } catch (error) { return disposedResult(options, String(error), fingerprint) }
    },
    async prepare(element: HTMLElement, options: { id: string; revision: string; transform: PaintMatrix; resolveFont: TextFontResolver; canonicalRead?: CanonicalTextRead; rootBackgroundOwned?: boolean; rasterScale?: number }): Promise<QualifiedParagraphPaint> {
      if (disposed) return disposedResult(options, 'TEXT_ENGINE_DISPOSED')
      if (!lease) return disposedResult(options, 'FONT_RESOURCE_LIMIT: engine cache budget')
      const read = options.canonicalRead ?? (read => read())
      const fingerprint = read(() => element.innerHTML)
      try {
        const captured = await captureSemanticParagraph(element, { ...options, fontEpoch })
        if (!captured.request) return { ...disposedResult(options, captured.measurement.blockers.join(';'), fingerprint), blockers: captured.measurement.blockers }
        const request = captured.request
        // Retention consumes the actual shaping decision, rather than guessing
        // from outer DOM text or inherited bidi defaults after preparation.
        const scaleDependent = /[^\x20-\x7e\u00a0-\u024f\u0300-\u036f]/.test(request.text) || captured.measurement.direction === 'rtl'
        // Each native run retains its own size and leading. The independently
        // measured browser line baseline positions every run on that line;
        // neither the first span nor a uniform line-height estimates it.
        const lines = read(() => measureSemanticTextLines(element, captured.measurement)), byteOffsets = utf8Offsets(request.text), operations: PaintOperation[] = [], differences: number[] = [], usedFonts = new Set<string>(), usedFaces = new Set<string>()
        for (const font of captured.fonts) if (!registered.has(font.key)) {
          const bytes = cacheReserve + [...registered.values()].reduce((sum, font) => sum + font.bytes.length * 2, 0) + font.bytes.length * 2
          if (!lease.resize(bytes)) return disposedResult(options, 'FONT_RESOURCE_LIMIT: registered font budget', fingerprint)
          try {
            const receipt = JSON.parse(engine.register_font(font.key, font.revision, font.faceIndex, font.bytes))
            if (receipt.contentHash !== font.contentHash || receipt.faceIndex !== font.faceIndex) throw new Error('FONT_FACE_MISMATCH: actual register receipt')
            registered.set(font.key, font)
          } catch (error) { lease.resize(bytes - font.bytes.length * 2); throw error }
        }
        // The Rust hard limit bounds every emitted command before conversion to
        // JSON. Reserve conservative Rust Value/string/JS-array copies plus
        // paragraph layout scratch. Unmeasurable driver/transport costs remain
        // explicit estimates, not a physical memory guarantee.
        const maxCommands = Math.min(262144, Math.max(1024, request.text.length * 128))
        const scratch = budget.acquire({ owner, key: `text-shape:${options.id}`, pool: 'tile-surface', bytes: maxCommands * 512 + request.text.length * 128 + 2 * 1024 * 1024, pinned: true })
        if (!scratch) return disposedResult(options, 'FONT_RESOURCE_LIMIT: shaping scratch estimate', fingerprint)
        try {
          const positionOperations = (shaped: PositionedTextPaint & { runs: { font: { contentHash: string; faceIndex: number } }[] }, selected: readonly { operation: PaintOperation; dx: number; dy: number; line: DomTextLine; sourceOffset?: number }[]) => {
            for (const run of shaped.runs) { usedFonts.add(run.font.contentHash); usedFaces.add(`${run.font.contentHash}:${run.font.faceIndex}`) }
            for (const { operation, dx, dy, line, sourceOffset=0 } of selected) {
              if (operation.type !== 'vector') throw new Error('TEXT_OUTLINE_OPERATION_INVALID')
              const payload = operation.object.payload as { commands: readonly (readonly (string | number)[])[] }
              let commands = payload.commands.map(command => command.map((value, at) => at === 0 ? value : Number(value) + (at % 2 ? dx : dy)))
              const highlight=/:run:(\d+):highlight$/.exec(operation.object.id)
              if(highlight) {
                const run=shaped.runs[Number(highlight[1])] as unknown as {textRange:number[]}
                const start=byteOffsets.indexOf(sourceOffset+run.textRange[0]),end=byteOffsets.indexOf(sourceOffset+run.textRange[1]),map=captured.measurement.sourceToLayoutUtf16
                if(start<0||end<=start)throw new Error('TEXT_RUN_SOURCE_MAPPING_INVALID')
                const rect=read(()=>measuredInlineBounds(element,map?map.indexOf(start):start,map?map.indexOf(end):end,line))
                commands=[['M',rect.x,rect.y],['L',rect.x+rect.width,rect.y],['L',rect.x+rect.width,rect.y+rect.height],['L',rect.x,rect.y+rect.height],['Z']]
              }
              operations.push({ ...operation, object: { ...operation.object, payload: { ...payload, commands } } })
            }
          }
          if (scaleDependent) {
            // Grid fitting is a shared outline derivative at the real backing
            // scale. It never changes shaping advances or source clusters.
            const outlineScale = options.rasterScale ?? read(()=>{
              const view=element.ownerDocument.defaultView!,css=view.getComputedStyle(element)
              return view.devicePixelRatio*element.getBoundingClientRect().width/parseFloat(css.width)
            })
            if(!Number.isFinite(outlineScale)||outlineScale<.25||outlineScale>16)throw new Error('TEXT_HINT_SCALE_UNSUPPORTED')
            const shaped = JSON.parse(engine.shape(JSON.stringify({ ...request, ...(outlineScale ? {outlineScale} : {}), maxCommands, baseDirection: captured.measurement.direction, measuredBreaks: lines.slice(0, -1).map(line => byteOffsets[line.layoutEnd]), alignment: 'left' }))) as PositionedTextPaint & { paragraphDirection: string; operationLines: number[]; runs: { font: { contentHash: string; faceIndex: number } }[]; lines: (PositionedTextPaint['lines'][number] & { offset: number })[] }
            if (shaped.paragraphDirection !== captured.measurement.direction) throw new Error('TEXT_EXPLICIT_PARAGRAPH_DIRECTION_PENDING')
            if (shaped.lines.length !== lines.length || shaped.operationLines.length !== shaped.operations.length) throw new Error('TEXT_CONTEXT_LINE_PARTITION_FAILED')
            for (const [index, line] of lines.entries()) {
              const actual = shaped.lines[index]
              if (actual.textRange[0] !== byteOffsets[line.layoutStart] || actual.textRange[1] !== byteOffsets[line.layoutEnd]) throw new Error(`TEXT_CONTEXT_SOURCE_PARTITION_FAILED: ${JSON.stringify({ index, measured: [byteOffsets[line.layoutStart], byteOffsets[line.layoutEnd]], shaped: actual.textRange })}`)
              const difference = line.width - actual.advance; differences.push(difference)
              if (Math.abs(difference) > 0.5) throw new Error(`TEXT_ADVANCE_DOM_PARITY_FAILED: ${difference}`)
            }
            positionOperations(shaped, shaped.operations.map((operation, index) => {
              const lineIndex = shaped.operationLines[index], target = lines[lineIndex], actual = shaped.lines[lineIndex]
              if (!target || !actual) throw new Error('TEXT_OUTLINE_LINE_MAPPING_INVALID')
              if(operation.type!=='vector')throw new Error('TEXT_OUTLINE_OPERATION_INVALID')
              const runIndex = /:run:(\d+)$/.exec(operation.object.id)
              const run = runIndex ? (shaped.runs[Number(runIndex[1])] as unknown as {textRange: number[];offset:number;advance:number;rtl:boolean}) : undefined
              let dx = target.x - actual.offset
              if (run) dx = read(() => {
                const start = byteOffsets.indexOf(run.textRange[0]), end = byteOffsets.indexOf(run.textRange[1])
                if (start < 0 || end <= start) throw new Error('TEXT_RUN_SOURCE_MAPPING_INVALID')
                const sourceMap = captured.measurement.sourceToLayoutUtf16
                const sourceStart = sourceMap ? sourceMap.indexOf(start) : start, sourceEnd = sourceMap ? sourceMap.indexOf(end) : end
                if(sourceStart<0||sourceEnd<=sourceStart)throw new Error('TEXT_RUN_SOURCE_MAPPING_INVALID')
                const rect=measuredInlineBounds(element,sourceStart,sourceEnd,target)
                if (Math.abs(rect.width-run.advance)>.5) throw new Error('TEXT_RUN_ADVANCE_DOM_PARITY_FAILED')
                return (run.rtl ? rect.x+rect.width-run.advance : rect.x)-run.offset
              })
              return { operation, dx, dy: target.baseline - actual.baseline, line:target }
            }))
          } else {
          for (const [index, line] of lines.entries()) {
            const start = byteOffsets[line.layoutStart], end = byteOffsets[line.layoutEnd]
            if (start < 0 || end < start) throw new Error('TEXT_LINE_SOURCE_MAPPING_INVALID')
            const spans = request.spans.filter(span => span.end > start && span.start < end).map(span => ({ ...span, start: Math.max(span.start, start) - start, end: Math.min(span.end, end) - start }))
            const shaped = JSON.parse(engine.shape(JSON.stringify({ ...request, id: `${options.id}:line:${index}`, text: request.text.slice(line.layoutStart, line.layoutEnd), maxCommands, maxWidth: 1000000, wrapMode: 'nowrap', alignment: 'left', spans }))) as PositionedTextPaint & { runs: { font: { contentHash: string; faceIndex: number } }[] }
            if (shaped.lines.length !== 1) throw new Error('TEXT_LINE_LAYOUT_INVALID')
            const difference = line.width - shaped.lines[0].advance; differences.push(difference)
            if (Math.abs(difference) > 0.5) throw new Error('TEXT_ADVANCE_DOM_PARITY_FAILED')
            const dx = line.x, dy = line.baseline - shaped.lines[0].baseline
            positionOperations(shaped, shaped.operations.map(operation => ({ operation, dx, dy, line, sourceOffset:start })))
          }
          }
        } finally { scratch.release() }
        if (disposed || !read(() => element.isConnected && element.innerHTML === fingerprint)) return disposedResult(options, 'TEXT_LAYOUT_CHANGED_DURING_PREPARATION', fingerprint)
        const estimatedBytes = JSON.stringify(operations).length * 4
        const resultLease = budget.acquire({ owner, key: `text-paint:${options.id}:${options.revision}`, pool: 'retained', bytes: estimatedBytes, pinned: true })
        if (!resultLease) return disposedResult(options, 'FONT_RESOURCE_LIMIT: positioned outline budget', fingerprint)
        const completePaint = [...usedFaces].every(face => PIXEL_QUALIFIED_FONT_FACES.has(face))
        return { id: options.id, revision: options.revision, fontEpoch, sourceFingerprint: fingerprint, completePaint, operations,
          blockers: completePaint ? [] : ['TEXT_FONT_PIXEL_ACCEPTANCE_PENDING'], qualification: { policy: 'actual-font-measured-lines-shared-outline-v2', fontHashes: [...usedFonts], widthDifferences: differences, lines, scaleDependent }, release: () => resultLease.release() }
      } catch (error) { const blocker = String(error); return disposedResult(options, blocker.includes('TEXT_BASELINE_') ? `${blocker}; provider ${JSON.stringify(options.id)}` : blocker, fingerprint) }
    },
    stats: () => ({ fontEpoch, disposed, registeredFonts: registered.size, engine: JSON.parse(engine.resource_stats()), budgetBytes: lease?.bytes ?? 0 }),
    dispose() { if (disposed) return; disposed = true; registered.clear(); engine.free?.(); budget.releaseOwner(owner) },
  }
}

export const prepareSemanticParagraphPaint = (session: ReturnType<typeof createTextPaintSession>, element: HTMLElement, options: Parameters<typeof session.prepare>[1]) => session.prepare(element, options)
export const prepareSemanticSvgTextPaint = (session: ReturnType<typeof createTextPaintSession>, element: SVGTextElement, options: SvgTextPaintOptions) => session.prepareSvg(element, options)

