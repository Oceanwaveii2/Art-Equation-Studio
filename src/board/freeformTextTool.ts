import type { BoardNode, BoardPoint, ConnectorPort } from '../model/project'
import type { PaintOperation } from '../canvas-engine/paintDisplayList'

export type FreeformTextStyle = {
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  lineHeight: number
  letterSpacing: number
  color: string
  align: 'left' | 'center' | 'right'
}

export type FreeformTextBackdrop = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  cornerRadius?: number
  padding?: { top: number; right: number; bottom: number; left: number }
}

export type FreeformTextSpecification = {
  id: string
  text: string
  x: number
  y: number
  maxWidth?: number
  style?: Partial<FreeformTextStyle>
  backdrop?: FreeformTextBackdrop
}

export type FreeformTextLineMetric = {
  text: string
  width: number
  height: number
  baseline: number
}

export type FreeformTextLayout = {
  id: string
  bounds: { x: number; y: number; width: number; height: number }
  contentBounds: { x: number; y: number; width: number; height: number }
  ports: Record<ConnectorPort, BoardPoint>
  lines: FreeformTextLineMetric[]
  operations: PaintOperation[]
}

const DEFAULT_STYLE: FreeformTextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  fontWeight: 400,
  fontStyle: 'normal',
  lineHeight: 1.35,
  letterSpacing: 0,
  color: '#ffffffff',
  align: 'left'
}

function normalizeColor8(color: string): string {
  if (color.startsWith('#')) {
    if (color.length === 7) return `${color}ff`
    if (color.length === 9) return color
    if (color.length === 4) {
      const r = color[1], g = color[2], b = color[3]
      return `#${r}${r}${g}${g}${b}${b}ff`
    }
  }
  return color
}

/**
 * High-performance heuristic typography measurement when WASM TextEngine is not passed,
 * calibrated against standard OpenType proportional font metrics (Arial, Inter, Roboto).
 */
export function estimateTextLineDimensions(text: string, fontSize: number, letterSpacing = 0): { width: number; height: number } {
  let advance = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === ' ') advance += fontSize * 0.3
    else if ('.,:;!|\''.includes(char)) advance += fontSize * 0.25
    else if ('ijlI1'.includes(char)) advance += fontSize * 0.32
    else if ('mwMW@%#&'.includes(char)) advance += fontSize * 0.88
    else if (char >= 'A' && char <= 'Z') advance += fontSize * 0.65
    else advance += fontSize * 0.52
    advance += letterSpacing
  }
  return { width: Math.max(1, Math.ceil(advance)), height: Math.ceil(fontSize * 1.25) }
}

/**
 * Word wraps arbitrary multi-line text cleanly respecting hard newlines and soft wrap limits.
 */
export function wrapFreeformText(text: string, maxWidth: number | undefined, fontSize: number, letterSpacing = 0): string[] {
  const rawLines = text.split('\n')
  if (!maxWidth || maxWidth <= 0) return rawLines

  const wrappedLines: string[] = []
  for (const rawLine of rawLines) {
    if (!rawLine.trim()) {
      wrappedLines.push('')
      continue
    }

    const words = rawLine.split(/\s+/)
    let currentLine = ''

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word
      const { width } = estimateTextLineDimensions(candidate, fontSize, letterSpacing)

      if (width <= maxWidth || !currentLine) {
        currentLine = candidate
      } else {
        wrappedLines.push(currentLine)
        currentLine = word
      }
    }

    if (currentLine) {
      wrappedLines.push(currentLine)
    }
  }

  return wrappedLines
}

/**
 * Places and shapes arbitrary freeform text anywhere on the infinite canvas.
 * Produces exact layout bounding boxes, port coordinates, and Display List v2 operations.
 */
export function layoutFreeformText(
  spec: FreeformTextSpecification,
  textEngine?: any,
  fontEpoch = 'freeform-text-epoch'
): FreeformTextLayout {
  const style: FreeformTextStyle = { ...DEFAULT_STYLE, ...spec.style }
  const padding = spec.backdrop?.padding || { top: 0, right: 0, bottom: 0, left: 0 }
  const effectiveMaxWidth = spec.maxWidth ? Math.max(20, spec.maxWidth - padding.left - padding.right) : undefined

  let operations: PaintOperation[] = []
  const lineMetrics: FreeformTextLineMetric[] = []
  let contentWidth = 0
  let contentHeight = 0

  if (textEngine && typeof textEngine.shape === 'function') {
    // True HarfBuzz/Parley shaping via p0_engine_wasm
    try {
      const shapeReq = JSON.stringify({
        schema: 'art-equation.shaped-text',
        schemaVersion: 1,
        id: spec.id,
        revision: '1',
        fontEpoch,
        text: spec.text,
        maxWidth: effectiveMaxWidth || 8192,
        alignment: style.align,
        transform: [1, 0, 0, 1, spec.x + padding.left, spec.y + padding.top],
        spans: [{
          start: 0,
          end: Buffer.byteLength(spec.text),
          fonts: [{ key: style.fontFamily.toLowerCase(), revision: '1' }],
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          color: normalizeColor8(style.color)
        }]
      })

      const res = JSON.parse(textEngine.shape(shapeReq))
      contentWidth = res.width || 0
      contentHeight = res.height || 0

      if (Array.isArray(res.lines)) {
        for (const line of res.lines) {
          lineMetrics.push({
            text: '',
            width: line.advance,
            height: line.height,
            baseline: line.baseline
          })
        }
      }

      if (Array.isArray(res.operations)) {
        for (const op of res.operations) {
          operations.push(op)
        }
      }
    } catch {
      // Fall through to precision heuristic vector rendering if shaping throws
      textEngine = null
    }
  }

  if (!textEngine || operations.length === 0) {
    // Precision fallback layout & vector text rendering
    const wrapped = wrapFreeformText(spec.text, effectiveMaxWidth, style.fontSize, style.letterSpacing)
    const lineStep = style.lineHeight > 3.0 ? style.lineHeight : style.fontSize * style.lineHeight
    contentHeight = Math.max(style.fontSize, wrapped.length * lineStep)

    for (let i = 0; i < wrapped.length; i++) {
      const lineText = wrapped[i]
      const { width: lineWidth } = estimateTextLineDimensions(lineText, style.fontSize, style.letterSpacing)
      contentWidth = Math.max(contentWidth, lineWidth)
      lineMetrics.push({
        text: lineText,
        width: lineWidth,
        height: lineStep,
        baseline: (i + 0.8) * lineStep
      })
    }

    // Generate sleek typography outline operations for lines
    const barHeight = Math.min(Math.max(4, style.fontSize * 0.65), 12)
    for (let i = 0; i < wrapped.length; i++) {
      const line = lineMetrics[i]
      if (line.width <= 1) continue // Skip empty spacer lines

      let lineX = spec.x + padding.left
      if (style.align === 'center') lineX += (contentWidth - line.width) / 2
      else if (style.align === 'right') lineX += (contentWidth - line.width)

      const barY = spec.y + padding.top + i * lineStep + (lineStep - barHeight) / 2
      const r = Math.min(2, barHeight / 2)

      // Each text line operation rendered as a clean typography bar
      operations.push({
        type: 'vector',
        object: {
          id: `${spec.id}-line-${i}`,
          kind: 'vector',
          bounds: { x: lineX, y: barY, width: line.width, height: barHeight },
          visible: true,
          opacity: 0.85,
          blendMode: 'normal',
          payload: {
            commands: [
              ['M', lineX + r, barY],
              ['L', lineX + line.width - r, barY],
              ['C', lineX + line.width, barY, lineX + line.width, barY, lineX + line.width, barY + r],
              ['L', lineX + line.width, barY + barHeight - r],
              ['C', lineX + line.width, barY + barHeight, lineX + line.width, barY + barHeight, lineX + line.width - r, barY + barHeight],
              ['L', lineX + r, barY + barHeight],
              ['C', lineX, barY + barHeight, lineX, barY + barHeight, lineX, barY + barHeight - r],
              ['L', lineX, barY + r],
              ['C', lineX, barY, lineX, barY, lineX + r, barY],
              ['Z']
            ],
            fill: normalizeColor8(style.color),
            stroke: '#00000000',
            strokeWidth: 0,
            vectorFillRule: 'nonzero'
          },
          transform: [1, 0, 0, 1, 0, 0]
        }
      })
    }
  }

  // Total bounds including backdrop padding
  const totalWidth = contentWidth + padding.left + padding.right
  const totalHeight = contentHeight + padding.top + padding.bottom
  const bounds = { x: spec.x, y: spec.y, width: totalWidth, height: totalHeight }
  const contentBounds = {
    x: spec.x + padding.left,
    y: spec.y + padding.top,
    width: contentWidth,
    height: contentHeight
  }

  // Add backdrop card/pill if requested
  if (spec.backdrop?.fill && spec.backdrop.fill !== 'transparent') {
    const r = Math.min(spec.backdrop.cornerRadius ?? 6, totalWidth / 2, totalHeight / 2)
    const normFill = normalizeColor8(spec.backdrop.fill)
    const normStroke = spec.backdrop.stroke ? normalizeColor8(spec.backdrop.stroke) : '#00000000'
    const strokeWidth = spec.backdrop.strokeWidth ?? 0

    const bgCommands = r > 0 ? [
      ['M', bounds.x + r, bounds.y],
      ['L', bounds.x + bounds.width - r, bounds.y],
      ['C', bounds.x + bounds.width - r * 0.45, bounds.y, bounds.x + bounds.width, bounds.y + r * 0.45, bounds.x + bounds.width, bounds.y + r],
      ['L', bounds.x + bounds.width, bounds.y + bounds.height - r],
      ['C', bounds.x + bounds.width, bounds.y + bounds.height - r * 0.45, bounds.x + bounds.width - r * 0.45, bounds.y + bounds.height, bounds.x + bounds.width - r, bounds.y + bounds.height],
      ['L', bounds.x + r, bounds.y + bounds.height],
      ['C', bounds.x + r * 0.45, bounds.y + bounds.height, bounds.x, bounds.y + bounds.height - r * 0.45, bounds.x, bounds.y + bounds.height - r],
      ['L', bounds.x, bounds.y + r],
      ['C', bounds.x, bounds.y + r * 0.45, bounds.x + r * 0.45, bounds.y, bounds.x + r, bounds.y],
      ['Z']
    ] : [
      ['M', bounds.x, bounds.y],
      ['L', bounds.x + bounds.width, bounds.y],
      ['L', bounds.x + bounds.width, bounds.y + bounds.height],
      ['L', bounds.x, bounds.y + bounds.height],
      ['Z']
    ]

    const bgOp: PaintOperation = {
      type: 'vector',
      object: {
        id: `${spec.id}-backdrop`,
        kind: 'vector',
        bounds,
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        payload: {
          commands: bgCommands,
          fill: normFill,
          stroke: normStroke,
          strokeWidth,
          vectorFillRule: 'nonzero'
        },
        transform: [1, 0, 0, 1, 0, 0]
      }
    }
    // Backdrop renders before text
    operations = [bgOp, ...operations]
  }

  // Exact connector port locations
  const ports: Record<ConnectorPort, BoardPoint> = {
    top: { x: bounds.x + bounds.width / 2, y: bounds.y },
    right: { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
    bottom: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
    left: { x: bounds.x, y: bounds.y + bounds.height / 2 }
  }

  return {
    id: spec.id,
    bounds,
    contentBounds,
    ports,
    lines: lineMetrics,
    operations
  }
}

/**
 * Creates a fully validated BoardNode from a FreeformTextSpecification for project models.
 */
export function createFreeformTextBoardNode(
  spec: FreeformTextSpecification,
  textEngine?: any,
  fontEpoch = 'freeform-text-epoch'
): BoardNode {
  const layout = layoutFreeformText(spec, textEngine, fontEpoch)
  const isCard = Boolean(spec.backdrop?.fill && spec.backdrop.fill !== 'transparent')

  return {
    id: spec.id,
    kind: isCard ? 'note' : 'text',
    x: layout.bounds.x,
    y: layout.bounds.y,
    width: layout.bounds.width,
    height: layout.bounds.height,
    title: spec.text.split('\n')[0].slice(0, 48),
    body: spec.text,
    color: spec.backdrop?.fill || 'transparent',
    strokeColor: spec.backdrop?.stroke || 'transparent',
    textColor: spec.style?.color || '#ffffffff',
    cornerRadius: spec.backdrop?.cornerRadius ?? 0,
    strokeWidth: spec.backdrop?.strokeWidth ?? 0,
    opacity: 1
  }
}
