import type { BoardModel, BoardNode, ProjectModel } from '../model/project'

// Board-organization logic lives in the app layer (src/board), not in
// canvas-engine: the engine boundary test forbids engine modules from
// importing the application model, and hierarchy rules operate on that model.

export type BoardHierarchyIssue = Readonly<{
  boardId: string
  kind: 'missing-parent' | 'self-parent' | 'cycle'
}>

export type NestedBoardCreation = Readonly<{
  board: BoardModel
}>

export function boardAncestors(boards: readonly BoardModel[], boardId: string): BoardModel[] {
  const byId = new Map(boards.map((board) => [board.id, board]))
  const result: BoardModel[] = []
  const visited = new Set([boardId])
  let current = byId.get(boardId)
  while (current?.parentBoardId) {
    if (visited.has(current.parentBoardId)) break
    const parent = byId.get(current.parentBoardId)
    if (!parent) break
    result.unshift(parent)
    visited.add(parent.id)
    current = parent
  }
  return result
}

export function boardChildren(boards: readonly BoardModel[], parentBoardId: string): BoardModel[] {
  return boards.filter((board) => board.parentBoardId === parentBoardId)
}

export function canReparentBoard(boards: readonly BoardModel[], boardId: string, parentBoardId?: string): boolean {
  if (!parentBoardId) return true
  if (boardId === parentBoardId) return false
  return !boardAncestors(boards, parentBoardId).some((board) => board.id === boardId)
}

/** Recover invalid ownership without discarding a board. Existing board-link
 * shortcuts remain shortcuts; ownership is expressed only by parentBoardId. */
export function normalizeBoardHierarchy(boards: readonly BoardModel[]): { boards: BoardModel[]; issues: BoardHierarchyIssue[] } {
  const byId = new Map(boards.map((board) => [board.id, board]))
  const issues: BoardHierarchyIssue[] = []
  const normalized = boards.map((board) => {
    if (!board.parentBoardId) return board
    if (board.parentBoardId === board.id) {
      issues.push({ boardId: board.id, kind: 'self-parent' })
      return { ...board, parentBoardId: undefined }
    }
    if (!byId.has(board.parentBoardId)) {
      issues.push({ boardId: board.id, kind: 'missing-parent' })
      return { ...board, parentBoardId: undefined }
    }
    const visited = new Set([board.id])
    let cursor = byId.get(board.parentBoardId)
    while (cursor) {
      if (visited.has(cursor.id)) {
        issues.push({ boardId: board.id, kind: 'cycle' })
        return { ...board, parentBoardId: undefined }
      }
      visited.add(cursor.id)
      cursor = cursor.parentBoardId ? byId.get(cursor.parentBoardId) : undefined
    }
    return board
  })
  return { boards: normalized, issues }
}

export function createNestedBoard(parent: BoardModel, title: string): NestedBoardCreation {
  const id = `board-${crypto.randomUUID()}`
  return {
    board: {
      id,
      title,
      parentBoardId: parent.id,
      viewport: { x: 28, y: 28, scale: .82 },
      nodes: [],
      connectors: [],
    },
  }
}

export function insertNestedBoard(project: ProjectModel, parentBoardId: string, title: string, position: { x: number; y: number } = { x: 120, y: 120 }): { project: ProjectModel; boardId: string; portalId: string } | null {
  const parent = project.boards.find((board) => board.id === parentBoardId)
  if (!parent) return null
  const created = createNestedBoard(parent, title)
  const portal: BoardNode = { id: `board-portal-${crypto.randomUUID()}`, kind: 'board-link', boardLinkRole: 'child', boardPortal: true, targetBoardId: created.board.id, x: Math.round(position.x), y: Math.round(position.y), width: 140, height: 128, title, color: '#5778c9' }
  return {
    boardId: created.board.id,
    portalId: portal.id,
    project: {
      ...project,
      boards: [...project.boards.map((board) => board.id === parentBoardId ? { ...board, nodes: [...board.nodes, portal] } : board), created.board],
    },
  }
}

/** Keep subboard portals at their compact tile size. Earlier previews saved
 * oversized card bounds that made selection handles surround empty canvas. */
export function normalizeBoardPortalBounds(boards: readonly BoardModel[]): BoardModel[] {
  return boards.map((board) => {
    let changed = false
    const nodes = board.nodes.map((node) => {
      // Portals laid out inside a column keep their grid cell bounds; the
      // 140x128 fallback only repairs free-floating tiles.
      if (node.kind !== 'board-link' || node.boardLinkRole !== 'child' || !node.boardPortal || node.parentColumnId || node.groupId || (node.width === 140 && node.height === 128)) return node
      changed = true
      return { ...node, width: 140, height: 128 }
    })
    return changed ? { ...board, nodes } : board
  })
}

/** Remove legacy auto-inserted child cards while retaining their real boards.
 * Explicit shortcut cards remain visible. */
export function withoutLegacyChildTiles(boards: readonly BoardModel[]): BoardModel[] {
  return boards.map((board) => {
    const removed = new Set(board.nodes.filter((node) => node.kind === 'board-link' && node.boardLinkRole === 'child' && !node.boardPortal).map((node) => node.id))
    if (!removed.size) return board
    const removedNodes = board.nodes.filter((node) => removed.has(node.id))
    const removedConnectors = board.connectors.filter((connector) => removed.has(connector.sourceId || '') || removed.has(connector.targetId || ''))
    return {
      ...board,
      legacyHiddenChildTiles: {
        nodes: [...(board.legacyHiddenChildTiles?.nodes || []), ...removedNodes],
        connectors: [...(board.legacyHiddenChildTiles?.connectors || []), ...removedConnectors],
      },
      nodes: board.nodes.filter((node) => !removed.has(node.id)),
      connectors: board.connectors.filter((connector) => !removed.has(connector.sourceId || '') && !removed.has(connector.targetId || '')),
    }
  })
}
