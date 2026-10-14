import type { BoardModel } from '../model/project'

export type NativeBoardCommand = { before: BoardModel; after: BoardModel; mergeKey?: string }

export function recordNativeCommand(undo: NativeBoardCommand[], redo: NativeBoardCommand[], before: BoardModel, after: BoardModel, mergeKey?: string) {
  const previous = undo.at(-1)
  // One focused text session is one board command. Retain the first immutable
  // snapshot and update only its endpoint; never clone the board per character.
  // An intervening command, undo or externally replaced model ends the chain.
  if (mergeKey && previous?.mergeKey === mergeKey && previous.after === before && redo.length === 0) {
    previous.after = after
    return
  }
  undo.splice(0, Math.max(0, undo.length - 49))
  undo.push({ before, after, ...(mergeKey ? { mergeKey } : {}) })
  redo.length = 0
}

export function undoNativeCommand(undo: NativeBoardCommand[], redo: NativeBoardCommand[]) {
  const command = undo.pop()
  if (!command) return null
  redo.push(command)
  return command.before
}

export function redoNativeCommand(undo: NativeBoardCommand[], redo: NativeBoardCommand[]) {
  const command = redo.pop()
  if (!command) return null
  undo.push(command)
  return command.after
}
