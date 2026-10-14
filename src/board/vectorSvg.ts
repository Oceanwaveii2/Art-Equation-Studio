import type { BoardNode } from '../model/project'
import { vectorPathBounds, vectorPathData, vectorTransformData } from '../model/vector'
import { resolveVectorBooleanGeometry } from '../model/vectorBooleanGeometry'
import { paintId, paintAlpha, vectorPaintDefinitions, validTexture } from './vectorPaint'

export function escapeSvg(value: string | number): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** Shared canonical SVG path renderer for export and minimap. Opacity is
 * applied once to the complete object, never as an arbitrary preview tint. */
export function vectorNodeSvgMarkup(node: BoardNode, x = node.x, y = node.y, prefix = 'vector'): string {
  if (!node.vectorPath) return ''
  const safe = escapeSvg
  const boolean = node.vectorBoolean
  const operands = boolean?.operands?.length ? boolean.operands : [node.vectorPath]
  const paintPrefix=`${prefix}:${node.id}`
  const fill = node.vectorFillGradient ? `url(#${paintId(paintPrefix,'fill')})` : safe(node.color || '#313742'), stroke = node.vectorStrokeGradient ? `url(#${paintId(paintPrefix,'stroke')})` : safe(node.strokeColor || '#a8b1bd')
  const fillRule = boolean?.operation === 'exclude' ? 'evenodd' : node.vectorFillRule || 'nonzero'
  const opacity = Math.max(0, Math.min(1, node.opacity ?? 1))
  const strokeAttrs = `fill-opacity="${paintAlpha(node.fillOpacity)}" stroke-opacity="${paintAlpha(node.strokeOpacity)}" stroke="${node.vectorStrokeGeometry?'none':stroke}" stroke-width="${safe(node.strokeWidth ?? 2)}" stroke-linejoin="${safe(node.vectorStrokeJoin || 'miter')}" stroke-linecap="${safe(node.vectorStrokeCap || 'butt')}"`
  const rotation = node.rotation ? ` rotate(${safe(node.rotation)} ${safe(node.width / 2)} ${safe(node.height / 2)})` : ''
  const transform = vectorTransformData(node)
  const group = `translate(${safe(x)} ${safe(y)})${rotation}`
  const identity = [...`${prefix}:${node.id}`].map((character) => character.codePointAt(0)!.toString(16)).join('-')
  const id = `boolean-${identity}`
  const opening = `<g transform="${group}" opacity="${safe(opacity)}"><defs>${vectorPaintDefinitions(node,paintPrefix)}</defs>${transform ? `<g transform="${safe(transform)}">` : ''}`
  const caption = diagramCaptionSvgMarkup(node)
  const clips=node.vectorClipPaths||[]
  const strokeGeometry=node.vectorStrokeGeometry
  const strokeMarkup=strokeGeometry?`<defs>${clips.map((paths,i)=>`<clipPath id="${id}-stroke-${i}"><path d="${safe(paths.map(vectorPathData).join(' '))}"/></clipPath>`).join('')}</defs>${clips.map((_,i)=>`<g clip-path="url(#${id}-stroke-${i})">`).join('')}<path d="${safe(strokeGeometry.paths.map(vectorPathData).join(' '))}" transform="matrix(${strokeGeometry.transform.join(' ')})" fill="none" stroke="${stroke}" stroke-opacity="${paintAlpha(node.strokeOpacity)}" stroke-width="${safe(node.strokeWidth??2)}" stroke-linejoin="${safe(node.vectorStrokeJoin||'miter')}" stroke-linecap="${safe(node.vectorStrokeCap||'butt')}"/>${clips.map(()=>'</g>').join('')}`:''
  const closing = `${strokeMarkup}${caption}${transform ? '</g>' : ''}</g>`
  const resolved = boolean ? boolean.resolvedPaths ?? resolveVectorBooleanGeometry(boolean.operation, operands, boolean.fillRules ?? operands.map(() => node.vectorFillRule ?? 'nonzero')) : undefined
  if(node.vectorTexture && validTexture(node.vectorTexture)) {
    const t=node.vectorTexture,data=(resolved||operands).map(vectorPathData).join(' ')
    return `${opening}<defs><clipPath id="${id}-texture"><path d="${safe(data)}" clip-rule="${fillRule}"/></clipPath></defs><g clip-path="url(#${id}-texture)"><image href="${safe(t.href)}" width="${t.width}" height="${t.height}" transform="matrix(${t.transform.join(' ')})" opacity="${paintAlpha(node.fillOpacity)}" preserveAspectRatio="none"/></g>${closing}`
  }
  if (resolved) return `${opening}<path d="${safe(resolved.map(vectorPathData).join(' '))}" fill="${fill}" fill-rule="nonzero" clip-rule="nonzero" ${strokeAttrs}/>${closing}`
  if (boolean?.operation === 'subtract' && operands.length > 1) {
    const bounds = vectorPathBounds(operands[0]), padding = Math.max(0, node.strokeWidth ?? 2) / 2 + 1
    const x = bounds.left - padding, y = bounds.top - padding, width = bounds.right - bounds.left + padding * 2, height = bounds.bottom - bounds.top + padding * 2
    const mask = `<mask id="${id}" maskUnits="userSpaceOnUse" x="${safe(x)}" y="${safe(y)}" width="${safe(width)}" height="${safe(height)}"><rect x="${safe(x)}" y="${safe(y)}" width="${safe(width)}" height="${safe(height)}" fill="white"/>${operands.slice(1).map((path) => `<path d="${safe(vectorPathData(path))}" fill="black" fill-rule="${fillRule}"/>`).join('')}</mask>`
    return `${opening}${mask}<g mask="url(#${id})"><path d="${safe(vectorPathData(operands[0]))}" fill="${operands[0].closed ? fill : 'none'}" fill-rule="${fillRule}" ${strokeAttrs}/></g>${closing}`
  }
  if (boolean?.operation === 'intersect' && operands.length > 1) {
    const clips = operands.slice(0, -1).map((path, index) => `<clipPath id="${id}-${index}"><path d="${safe(vectorPathData(path))}" fill-rule="${fillRule}"/></clipPath>`).join('')
    const openingClips = operands.slice(0, -1).map((_, index) => `<g clip-path="url(#${id}-${index})">`).join('')
    const closingClips = operands.slice(0, -1).map(() => '</g>').join('')
    return `${opening}${clips}${openingClips}<path d="${safe(vectorPathData(operands.at(-1)!))}" fill="${fill}" fill-rule="${fillRule}" clip-rule="${fillRule}" ${strokeAttrs}/>${closingClips}${closing}`
  }
  const data = operands.map(vectorPathData).join(' ')
  const filled = operands.some((path) => path.closed)
  return `${opening}<path d="${safe(data)}" fill="${filled ? fill : 'none'}" fill-rule="${fillRule}" clip-rule="${fillRule}" ${strokeAttrs}/>${closing}`
}

export type DiagramCaptionLayout = { fontSize: number; fontFamily: 'Segoe UI,sans-serif'; fill: string; lines: { text: string; x: number; y: number }[] }

/** Plain-text local caption layout shared by DOM, SVG and native scenes. */
export function diagramCaptionLayout(node: BoardNode): DiagramCaptionLayout | null {
  if (node.kind !== 'shape' || !['process', 'decision', 'start-end', 'document'].includes(node.diagramShape || '') || !node.vectorPath?.closed) return null
  const text = (node.body || node.title || '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const width = node.width * (node.diagramShape === 'decision' ? .5 : .76), size = Math.min(14, Math.max(8, node.height / 5))
  const capacity = Math.max(4, Math.floor(width / (size * .62))), words = text.match(/\S+/g) || [], lines: string[] = []
  let line = ''
  for (const word of words) { if (line && line.length + word.length + 1 > capacity) { lines.push(line); line = '' }; line += (line ? ' ' : '') + word }
  if (line) lines.push(line)
  const maximum = Math.max(1, Math.min(4, Math.floor(node.height * .65 / (size * 1.2)))), visible = lines.slice(0, maximum)
  if (lines.length > maximum) visible[maximum - 1] = visible[maximum - 1].slice(0, Math.max(1, capacity - 1)) + '…'
  return { fontSize: size, fontFamily: 'Segoe UI,sans-serif', fill: node.textColor || '#f5f7fa', lines: visible.map((value, index) => ({ text: value, x: node.width / 2, y: node.height / 2 + (index - (visible.length - 1) / 2) * size * 1.2 })) }
}

export function diagramCaptionSvgMarkup(node: BoardNode): string {
  const layout = diagramCaptionLayout(node)
  if (!layout) return ''
  const safe = escapeSvg
  return layout.lines.map((line) => '<text x="' + safe(line.x) + '" y="' + safe(line.y) + '" fill="' + safe(layout.fill) + '" font-family="' + safe(layout.fontFamily) + '" font-size="' + safe(layout.fontSize) + '" text-anchor="middle" dominant-baseline="middle" pointer-events="none">' + safe(line.text) + '</text>').join('')
}
