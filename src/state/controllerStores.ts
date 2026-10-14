import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { BoardModel, ProjectModel, ShapeType } from '../model/project'
import { createSelectorStore, type SelectorStore, type StateUpdate } from './selectorStore'

export type ToolState = {
  interactionTool: 'select' | 'connect' | 'draw' | 'pen' | 'node' | 'type' | 'pencil' | 'erase'
  viewportTool: 'select' | 'hand' | 'zoom'
  shapeKind: ShapeType
  eraserSize: number
}
export type SelectionState = {
  selectedIds: string[]
  selectedConnectorId: string | null
  selectedVectorPoint: { nodeId: string; index: number } | null
  selectedVectorAnchorIndexes: number[]
  selectedVectorSegmentIndexes: number[]
}
export const createToolStore = () => createSelectorStore<ToolState>({ interactionTool: 'select', viewportTool: 'select', shapeKind: 'rectangle', eraserSize: 24 })
export const createSelectionStore = (ids: string[]) => createSelectorStore<SelectionState>({ selectedIds: ids, selectedConnectorId: null, selectedVectorPoint: null, selectedVectorAnchorIndexes: [], selectedVectorSegmentIndexes: [] })
export const createDocumentStore = (project: ProjectModel) => createSelectorStore({ project, activeDocumentId: 'project-brief', activeBoardId: 'master-reference-board' })

export function useStoreField<T, K extends keyof T>(store: SelectorStore<T>, key: K): [T[K], (update: StateUpdate<T[K]>) => void] {
  const slice = useMemo(() => store.select(state => state[key], (a, b) => Object.is(a, b) || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))), [store, key])
  const value = useSyncExternalStore(slice.subscribe, slice.getSnapshot, slice.getSnapshot)
  const set = useMemo(() => (update: StateUpdate<T[K]>) => store.field(key, update), [store, key])
  return [value, set]
}
/** A new selection owner on each board; no previous-board publication window.
 * Remembered IDs are validated against the destination's current model. */
export function useBoardSelectionStore(session: string, board: BoardModel, remembered: readonly string[]) {
  return useMemo(() => createSelectionStore(remembered.filter(id => board.nodes.some(node => node.id === id))), [session])
}
export function useDocumentController(initial: () => ProjectModel) {
  const [store] = useState(() => createDocumentStore(initial()))
  return store
}

/** A mounted input listener stays stable, but always reads the committed
 * controller revision. Capturing the initial board/index causes repeated
 * membership publications after a board edit or switch. */
export function useControllerEvent<Args extends unknown[]>(callback: (...args: Args) => void) {
  const latest = useRef(callback)
  useLayoutEffect(() => { latest.current = callback })
  return useMemo(() => (...args: Args) => latest.current(...args), [])
}
