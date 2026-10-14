import type { BoardModel, BoardNode } from '../model/project'
import { boardNodeVisualBounds } from './arrangement'

export const isBoundedFrame = (node: BoardNode) => node.kind === 'group' && Boolean(node.boundedCanvas)
export const drawingOnly = (node: BoardNode) => node.kind === 'shape' || node.kind === 'text'

/** Explicit bounded frames only. Historical groups/frames retain authored geometry. */
export function containFrameEdit(previous: BoardModel, next: BoardModel): { ok: true; board: BoardModel } | { ok: false; message: string } {
  const frames = next.nodes.filter(isBoundedFrame)
  if (!frames.length) return { ok: true, board: next }
  const old = new Map(previous.nodes.map(node => [node.id, node]))
  let changed = false
  const nodes = next.nodes.map(node => {
    if (isBoundedFrame(node)) return node
    const before = old.get(node.id)
    let owner = frames.find(frame => frame.id === node.groupId || frame.id === before?.groupId)
    // A new object or a moved free object enters a frame; existing unrelated
    // records never acquire membership just because another control was used.
    if (!owner && !node.groupId && !node.parentColumnId && node.kind !== 'group' && node.kind !== 'column'
      && (!before || before.x !== node.x || before.y !== node.y)) {
      const box = boardNodeVisualBounds(node)
      owner = [...frames].reverse().find(frame => (!before ? box.right >= frame.x && box.bottom >= frame.y && box.left <= frame.x + frame.width && box.top <= frame.y + frame.height : box.left >= frame.x && box.top >= frame.y && box.right <= frame.x + frame.width && box.bottom <= frame.y + frame.height))
    }
    if (!owner) return node
    if (owner.boundedCanvas === 'drawing' && !drawingOnly(node)) throw new Error('Drawing Canvas accepts drawing shapes and text only. Place media on the surrounding board.')
    const box = boardNodeVisualBounds(node)
    const pad = node.shapeType === 'path' ? 0 : Math.max(0, node.strokeWidth ?? (node.kind === 'shape' ? 2 : 0)) / 2
    const width = box.right - box.left + 2 * pad, height = box.bottom - box.top + 2 * pad
    if (width > owner.width || height > owner.height) throw new Error('This object does not fit inside its frame. Enlarge the frame first; the edit was cancelled.')
    const dx = Math.max(owner.x + pad - box.left, Math.min(0, owner.x + owner.width - pad - box.right))
    const dy = Math.max(owner.y + pad - box.top, Math.min(0, owner.y + owner.height - pad - box.bottom))
    if (dx || dy || node.groupId !== owner.id) { changed = true; return { ...node, groupId: owner.id, x: node.x + dx, y: node.y + dy } }
    return node
  })
  // Rotating a container would separate its world-space members. Members may
  // rotate independently; their actual transformed visual envelope is bounded.
  if (frames.some(frame => Boolean(frame.rotation))) return { ok: false, message: 'Frames stay aligned with the board. Rotate the artwork inside the frame instead.' }
  return { ok: true, board: changed ? { ...next, nodes } : next }
}

export function safeFrameEdit(previous: BoardModel, next: BoardModel) {
  try { return containFrameEdit(previous, next) }
  catch (error) { return { ok: false as const, message: String(error instanceof Error ? error.message : error) } }
}
