import type { BoardNode } from '../model/project'
import { vectorNodeBounds } from '../model/vector'

export type ArrangementAxis = 'horizontal' | 'vertical'
export type Alignment = 'left' | 'right' | 'center' | 'top' | 'middle' | 'bottom'
export type ArrangementBounds = { left: number; top: number; right: number; bottom: number }

/** Arrange free objects only. Moving a container without its members or a
 * member independently would break the existing ownership contract. */
export function eligibleArrangementNodes(nodes: BoardNode[], selectedIds: readonly string[]): BoardNode[] {
  const selected = new Set(selectedIds)
  return nodes.filter((node) => selected.has(node.id) && !node.locked && !node.parentColumnId && !node.groupId && node.kind !== 'column' && node.kind !== 'group')
}

export function boardNodeVisualBounds(node: BoardNode): ArrangementBounds {
  if (node.shapeType === 'path' && node.vectorPath) return vectorNodeBounds(node)
  const angle = (node.rotation || 0) * Math.PI / 180
  const width = Math.abs(node.width * Math.cos(angle)) + Math.abs(node.height * Math.sin(angle))
  const height = Math.abs(node.width * Math.sin(angle)) + Math.abs(node.height * Math.cos(angle))
  const left = node.x + (node.width - width) / 2, top = node.y + (node.height - height) / 2
  return { left, top, right: left + width, bottom: top + height }
}

function translate(nodes: BoardNode[], offsets: Map<string, { x: number; y: number }>): BoardNode[] {
  return nodes.map((node) => {
    const offset = offsets.get(node.id)
    return offset && (offset.x || offset.y) ? { ...node, x: node.x + offset.x, y: node.y + offset.y } : node
  })
}

export function alignBoardNodes(nodes: BoardNode[], selectedIds: readonly string[], alignment: Alignment): BoardNode[] {
  const selected = eligibleArrangementNodes(nodes, selectedIds)
  if (selected.length < 2) return nodes
  const boxes = selected.map(boardNodeVisualBounds)
  const left = Math.min(...boxes.map((box) => box.left)), right = Math.max(...boxes.map((box) => box.right))
  const top = Math.min(...boxes.map((box) => box.top)), bottom = Math.max(...boxes.map((box) => box.bottom))
  return translate(nodes, new Map(selected.map((node, index) => {
    const box = boxes[index]
    const x = alignment === 'left' ? left - box.left : alignment === 'right' ? right - box.right : alignment === 'center' ? (left + right - box.left - box.right) / 2 : 0
    const y = alignment === 'top' ? top - box.top : alignment === 'bottom' ? bottom - box.bottom : alignment === 'middle' ? (top + bottom - box.top - box.bottom) / 2 : 0
    return [node.id, { x, y }]
  })))
}

/** Equal centers remains distinct from equal clear gaps. If the existing span
 * cannot contain the items, gap distribution expands it instead of overlapping. */
export function distributeBoardNodes(nodes: BoardNode[], selectedIds: readonly string[], axis: ArrangementAxis, mode: 'centers' | 'gaps' = 'centers', explicitGap?: number): BoardNode[] {
  const selected = eligibleArrangementNodes(nodes, selectedIds)
  if (selected.length < 3) return nodes
  const low = axis === 'horizontal' ? 'left' : 'top', high = axis === 'horizontal' ? 'right' : 'bottom'
  const ordered = selected.map((node) => ({ node, bounds: boardNodeVisualBounds(node) })).sort((a, b) => a.bounds[low] - b.bounds[low])
  const start = ordered[0].bounds[low], end = Math.max(...ordered.map((entry) => entry.bounds[high]))
  const sizes = ordered.map((entry) => entry.bounds[high] - entry.bounds[low])
  const gap = Number.isFinite(explicitGap) ? Math.max(0, explicitGap!) : Math.max(0, (end - start - sizes.reduce((sum, size) => sum + size, 0)) / (ordered.length - 1))
  const firstCenter = (ordered[0].bounds[low] + ordered[0].bounds[high]) / 2
  const last = ordered.at(-1)!.bounds, lastCenter = (last[low] + last[high]) / 2
  let position = start
  return translate(nodes, new Map(ordered.map(({ node, bounds }, index) => {
    const delta = mode === 'gaps' ? position - bounds[low] : firstCenter + index * (lastCenter - firstCenter) / (ordered.length - 1) - (bounds[low] + bounds[high]) / 2
    position += sizes[index] + gap
    return [node.id, axis === 'horizontal' ? { x: delta, y: 0 } : { x: 0, y: delta }]
  })))
}

/** Shelf packing preserves every source, crop and object size. Variable widths
 * create tight rows; row height is the tallest visual object in that row. */
export function packBoardNodes(nodes: BoardNode[], selectedIds: readonly string[], options: { gap?: number; rows?: number; columns?: number } = {}): BoardNode[] {
  const selected = eligibleArrangementNodes(nodes, selectedIds)
  if (selected.length < 2) return nodes
  const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap!) : 24
  const count = options.rows ? Math.ceil(selected.length / Math.max(1, Math.floor(options.rows))) : options.columns || Math.ceil(Math.sqrt(selected.length))
  const columns = Math.max(1, Math.min(selected.length, Math.floor(count)))
  const boxes = selected.map(boardNodeVisualBounds)
  const left = Math.min(...boxes.map((box) => box.left)), top = Math.min(...boxes.map((box) => box.top))
  const offsets = new Map<string, { x: number; y: number }>()
  let y = top
  for (let start = 0; start < selected.length; start += columns) {
    let x = left, rowHeight = 0
    for (let index = start; index < Math.min(selected.length, start + columns); index++) {
      const box = boxes[index]
      offsets.set(selected[index].id, { x: x - box.left, y: y - box.top })
      x += box.right - box.left + gap
      rowHeight = Math.max(rowHeight, box.bottom - box.top)
    }
    y += rowHeight + gap
  }
  return translate(nodes, offsets)
}
