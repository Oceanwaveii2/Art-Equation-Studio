import type { BoardModel, BoardNode } from '../model/project'
import { GraphColumnRuntime } from './graphColumnV2'
import { diagramState } from './diagramStructureCore'
import { patchBoardNode } from './boardMutationSafety'

export type GraphWritableAttribute = 'title' | 'body' | 'color' | 'textColor' | 'opacity'

/** An explicit authored command, never an evaluation side effect. The caller
 * publishes this immutable board through the ordinary undo/history boundary. */
export function writeGraphObjectAttribute(board: BoardModel, graphId: string, objectId: string, field: GraphWritableAttribute, value: string, readOnly = false): BoardModel {
  if (!board.nodes.some(n => n.id === graphId && n.graphColumn)) throw Error('Choose a Graph Column before sending changes.')
  const state = diagramState(board.nodes, graphId)
  if (readOnly || !state.ok || state.value.locked || state.value.hidden) throw Error('Unlock and show the graph before sending changes.')
  const records = new GraphColumnRuntime().evaluate(board, graphId)
  if (records.type !== 'records' || !records.value.some(r => r.objectId === objectId)) throw Error('Choose an object in this graph’s collected records.')
  if (!['title','body','color','textColor','opacity'].includes(field)) throw Error('Unsupported object attribute.')
  if (value.length > 200000) throw Error('Attribute text exceeds the edit limit.')
  let patch: Partial<BoardNode>
  if (field === 'opacity') {
    const opacity = Number(value)
    if (!value.trim() || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw Error('Opacity must be between 0 and 1.')
    patch = {opacity}
  } else {
    if ((field === 'color' || field === 'textColor') && !/^(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8}|transparent)$/i.test(value.trim())) throw Error('Use a hexadecimal colour or transparent.')
    patch = {[field]:value}
  }
  const changed = patchBoardNode(board, objectId, patch, readOnly)
  if (!changed.ok) throw Error(changed.issues[0]?.detail || 'Object edit refused.')
  return changed.value
}
