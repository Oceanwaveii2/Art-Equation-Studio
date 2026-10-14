import type { CanvasSceneObject, CanvasSceneSnapshot } from '../canvas-engine/contracts'
import type { BoardNode } from '../model/project'
import { boardNodeVisualBounds } from './arrangement'
import { connectorSvgMarkup } from './connectors'
import { escapeSvg, vectorNodeSvgMarkup } from './vectorSvg'
import { imageDrawRect } from '../model/imageFraming'

export type MinimapBounds = { minX: number; minY: number; maxX: number; maxY: number }
export type MinimapImage = { source: string; width: number; height: number }

export function minimapBounds(objects: readonly CanvasSceneObject[], stageWidth: number, stageHeight: number, nodes?: readonly BoardNode[]): MinimapBounds {
  const visible = objects.filter((object) => !object.hidden)
  if (!visible.length) return { minX: -40, minY: -40, maxX: stageWidth + 40, maxY: stageHeight + 40 }
  const byId = new Map(nodes?.map((node) => [node.id, node]))
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const object of visible) {
    const node = byId.get(object.id)
    const box = node ? boardNodeVisualBounds(node) : { left: object.bounds.x, top: object.bounds.y, right: object.bounds.x + object.bounds.width, bottom: object.bounds.y + object.bounds.height }
    minX = Math.min(minX, box.left); minY = Math.min(minY, box.top)
    maxX = Math.max(maxX, box.right); maxY = Math.max(maxY, box.bottom)
  }
  return { minX: minX - 40, minY: minY - 40, maxX: maxX + 40, maxY: maxY + 40 }
}

export function mapToMinimap(bounds: MinimapBounds, width: number, height: number) {
  const padding = 7
  const scale = Math.max(.00001, Math.min(Math.max(1, width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX), Math.max(1, height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY)))
  const offsetX = (width - (bounds.maxX - bounds.minX) * scale) / 2
  const offsetY = (height - (bounds.maxY - bounds.minY) * scale) / 2
  return { scale, offsetX, offsetY, x: (value: number) => offsetX + (value - bounds.minX) * scale, y: (value: number) => offsetY + (value - bounds.minY) * scale }
}

function fallbackNode(object: CanvasSceneObject): BoardNode {
  const box = object.localBounds || object.bounds
  return {
    id: object.id, kind: object.kind === 'vector' ? 'shape' : object.kind === 'container' ? 'group' : 'note', title: '',
    x: box.x, y: box.y, width: box.width, height: box.height,
    color: object.appearance.fill, strokeColor: object.appearance.stroke, opacity: object.appearance.opacity,
    strokeWidth: object.appearance.strokeWidth, cornerRadius: object.appearance.cornerRadius, rotation: object.appearance.rotation,
    vectorFillRule: object.appearance.vectorFillRule, vectorStrokeJoin: object.appearance.vectorStrokeJoin, vectorStrokeCap: object.appearance.vectorStrokeCap,
    ...(object.vectorPath ? { shapeType: 'path' as const, vectorPath: { ...object.vectorPath, points: object.vectorPath.points.map((point) => ({ ...point })) } } : {}),
  }
}

function nodeMarkup(node: BoardNode, image?: MinimapImage, headerHeight = 0): string {
  if (node.kind === 'shape' && node.shapeType === 'path' && node.vectorPath) return vectorNodeSvgMarkup(node, node.x, node.y, 'minimap')
  const safe = escapeSvg, cx = node.x + node.width / 2, cy = node.y + node.height / 2
  const opacity = Math.max(0, Math.min(1, node.opacity ?? 1))
  const stroke = safe(node.strokeColor || '#a8b1bd'), fill = safe(node.color || '#6e7785')
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${safe(node.strokeWidth ?? 1)}"`
  const transform = node.rotation ? ` transform="rotate(${safe(node.rotation)} ${safe(cx)} ${safe(cy)})"` : ''
  let shape: string
  if (node.shapeType === 'ellipse') shape = `<ellipse cx="${safe(cx)}" cy="${safe(cy)}" rx="${safe(node.width / 2)}" ry="${safe(node.height / 2)}" ${attrs}/>`
  else if (node.shapeType === 'line' || node.shapeType === 'arrow') shape = `<line x1="${safe(node.x)}" y1="${safe(node.y)}" x2="${safe(node.x + node.width)}" y2="${safe(node.y + node.height)}" stroke="${stroke}" stroke-width="${safe(node.strokeWidth ?? 2)}"/>`
  else shape = `<rect x="${safe(node.x)}" y="${safe(node.y)}" width="${safe(node.width)}" height="${safe(node.height)}" rx="${safe(node.cornerRadius || 0)}" ${attrs}/>`
  if (image) {
    const body = { width: node.width, height: Math.max(1, node.height - headerHeight) }
    const fit = imageDrawRect(image, body, node.imageTransform)
    if (fit) {
      const id = `minimap-image-${[...node.id].map(c=>c.codePointAt(0)!.toString(16)).join('-')}`
      const framing = node.imageTransform
      const centerY = node.y + headerHeight + body.height / 2
      const imageTransform = `translate(${safe(cx)} ${safe(centerY)}) rotate(${safe(framing?.rotation || 0)}) scale(${framing?.flipX ? -1 : 1} ${framing?.flipY ? -1 : 1}) translate(${safe(-cx)} ${safe(-centerY)})`
      const markup = `<defs><clipPath id="${id}"><rect x="${safe(node.x)}" y="${safe(node.y + headerHeight)}" width="${safe(body.width)}" height="${safe(body.height)}" rx="${safe(node.cornerRadius || 0)}"/></clipPath></defs><g clip-path="url(#${id})"><image href="${safe(image.source)}" x="${safe(node.x+fit.x)}" y="${safe(node.y+headerHeight+fit.y)}" width="${safe(fit.width)}" height="${safe(fit.height)}" preserveAspectRatio="none" transform="${imageTransform}" opacity="${safe(framing?.opacity ?? 1)}"${framing?.grayscale ? ' filter="url(#minimap-grayscale)"' : ''}/></g>`
      return `<g${transform} opacity="${safe(opacity)}">${shape}${markup}</g>`
    }
  }
  return `<g${transform} opacity="${safe(node.kind === 'column' || node.kind === 'group' ? opacity * .45 : opacity)}">${shape}</g>`
}

/** Use the canonical path instead of the broad-phase rectangular hit envelope.
 * The scene stays retained; camera updates redraw only its viewport outline. */
export function minimapSceneSvg(scene: CanvasSceneSnapshot, nodes: readonly BoardNode[] | undefined, bounds: MinimapBounds, width: number, height: number, images?: ReadonlyMap<string, MinimapImage>): string {
  const byId = new Map(nodes?.map((node) => [node.id, node]))
  const visible = scene.objects.filter((object) => !object.hidden).sort((a, b) => a.order - b.order)
  const canonical = visible.map((object) => byId.get(object.id) || fallbackNode(object))
  const map = mapToMinimap(bounds, width, height)
  const safe = escapeSvg
  const ids = new Set(canonical.map(node => node.id))
  const connections = scene.connections.filter(connection => (!connection.sourceId || ids.has(connection.sourceId)) && (!connection.targetId || ids.has(connection.targetId))).map((connection) => connectorSvgMarkup(connection, canonical, 'minimap')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safe(width)}" height="${safe(height)}" viewBox="0 0 ${safe(width)} ${safe(height)}"><defs><filter id="minimap-grayscale"><feColorMatrix type="saturate" values="0"/></filter></defs><rect width="100%" height="100%" fill="${safe(scene.environment.background)}"/><g transform="translate(${safe(map.offsetX)} ${safe(map.offsetY)}) scale(${safe(map.scale)}) translate(${safe(-bounds.minX)} ${safe(-bounds.minY)})">${connections}${canonical.map((node,index)=>nodeMarkup(node,images?.get(node.id),visible[index].modelArtwork?.kind==='image' ? visible[index].modelArtwork.header?.height || 0 : 0)).join('')}</g></svg>`
}
