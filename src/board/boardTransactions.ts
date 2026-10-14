import { managedBoardFolderPath, type BoardConnector, type BoardModel, type BoardNode, type ProjectModel } from '../model/project'

export type BoardTransactionIdFactory = (kind: 'board' | 'node' | 'connector') => string

/** Ownership follows parentBoardId, never a shortcut target or disk path. */
export function ownedBoardSubtree(boards: readonly BoardModel[], boardId: string): BoardModel[] {
  const ids = new Set([boardId])
  let changed = true
  while (changed) {
    changed = false
    for (const board of boards) if (board.parentBoardId && ids.has(board.parentBoardId) && !ids.has(board.id)) {
      ids.add(board.id)
      changed = true
    }
  }
  return boards.filter((board) => ids.has(board.id))
}

/** Expand visual containers without confusing them with nested board ownership. */
export function containerNodeIds(board: BoardModel, selectedIds: readonly string[]): Set<string> {
  const ids = new Set(selectedIds)
  let changed = true
  while (changed) {
    changed = false
    for (const node of board.nodes) if (!ids.has(node.id)
      && ((node.parentColumnId && ids.has(node.parentColumnId)) || (node.groupId && ids.has(node.groupId)))) {
      ids.add(node.id)
      changed = true
    }
  }
  return ids
}

function allBoardNodes(board: BoardModel): BoardNode[] {
  return [...board.nodes, ...(board.legacyHiddenChildTiles?.nodes || [])]
}

function allBoardConnectors(board: BoardModel): BoardConnector[] {
  return [...board.connectors, ...(board.legacyHiddenChildTiles?.connectors || [])]
}

function hasUniqueIds(items: readonly { id: string }[]): boolean {
  return items.every((item) => Boolean(item.id)) && new Set(items.map((item) => item.id)).size === items.length
}

/** A bounded source validation: reject ambiguous IDs/references instead of
 * cloning them into apparently independent records. Missing asset files remain
 * a catalog-health concern; immutable catalog/source references are retained. */
function validDuplicationSource(project: ProjectModel, subtree: readonly BoardModel[]): boolean {
  if (!hasUniqueIds(project.boards) || !hasUniqueIds(project.boards.flatMap(allBoardNodes)) || !hasUniqueIds(project.boards.flatMap(allBoardConnectors))) return false
  const boards = new Map(project.boards.map((board) => [board.id, board]))
  for (const board of subtree) {
    if (board.parentBoardId && !boards.has(board.parentBoardId)) return false
    const ancestors = new Set([board.id])
    let parent = board.parentBoardId
    while (parent) {
      if (ancestors.has(parent)) return false
      ancestors.add(parent)
      parent = boards.get(parent)?.parentBoardId
    }
    const nodes = new Map(allBoardNodes(board).map((node) => [node.id, node]))
    const owners = new Set<string>()
    for (const node of nodes.values()) {
      if (node.parentColumnId && nodes.get(node.parentColumnId)?.kind !== 'column') return false
      if (node.groupId && nodes.get(node.groupId)?.kind !== 'group') return false
      if (node.kind === 'board-link' && node.boardLinkRole === 'child' && node.boardPortal) {
        if (!node.targetBoardId || boards.get(node.targetBoardId)?.parentBoardId !== board.id || owners.has(node.targetBoardId)) return false
        owners.add(node.targetBoardId)
      }
    }
    if (allBoardConnectors(board).some((connector) => (connector.sourceId && !nodes.has(connector.sourceId)) || (connector.targetId && !nodes.has(connector.targetId)))) return false
  }
  return true
}

function idAllocator(project: ProjectModel, factory: BoardTransactionIdFactory) {
  const taken = new Set([...project.boards.map((board) => board.id), ...project.boards.flatMap(allBoardNodes).map((node) => node.id), ...project.boards.flatMap(allBoardConnectors).map((connector) => connector.id)])
  return (kind: 'board' | 'node' | 'connector') => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const id = factory(kind)
      if (id && !taken.has(id)) { taken.add(id); return id }
    }
    throw new Error('Could not allocate an independent board object ID')
  }
}

export type BoardDuplicateResult = {
  project: ProjectModel
  boardId: string
  boardIds: Map<string, string>
  nodeIds: Map<string, string>
  connectorIds: Map<string, string>
  /** Folders to prepare before committing the project transaction. No source
   * folder is moved or copied by this pure helper. */
  folderPaths: string[]
  portalId?: string
}

/** Duplicate the canonical owned subtree. Source assets stay shared immutable
 * catalog records; instance styles/crops/vector geometry are deep copies.
 * Child folder links are intentionally cleared rather than making the copy
 * appear to own the original child folder. New root boards use new managed
 * folders. The caller prepares folders and commits this result once. */
export function duplicateBoardSubtree(project: ProjectModel, boardId: string, options: { title?: string; idFactory?: BoardTransactionIdFactory } = {}): BoardDuplicateResult | null {
  const source = project.boards.find((board) => board.id === boardId)
  if (!source) return null
  const subtree = ownedBoardSubtree(project.boards, boardId)
  if (!validDuplicationSource(project, subtree)) return null
  const allocate = idAllocator(project, options.idFactory || ((kind) => `${kind}-${crypto.randomUUID()}`))
  const boardIds = new Map(subtree.map((board) => [board.id, allocate('board')]))
  const nodeIds = new Map(subtree.flatMap(allBoardNodes).map((node) => [node.id, allocate('node')]))
  const connectorIds = new Map(subtree.flatMap(allBoardConnectors).map((connector) => [connector.id, allocate('connector')]))
  const copyNode = (node: BoardNode, ownerId: string): BoardNode => {
    const copy = { ...structuredClone(node), id: nodeIds.get(node.id)!, parentColumnId: node.parentColumnId ? nodeIds.get(node.parentColumnId) : undefined, groupId: node.groupId ? nodeIds.get(node.groupId) : undefined }
    if (node.graphColumn) copy.graphColumn = { ...structuredClone(node.graphColumn), inputs: node.graphColumn.inputs.map(input => ({ ...input, sourceId: nodeIds.get(input.sourceId) || input.sourceId })) }
    if (node.kind === 'board-link' && node.targetBoardId) {
      copy.targetBoardId = boardIds.get(node.targetBoardId) || node.targetBoardId
      const owned = project.boards.find((board) => board.id === node.targetBoardId)?.parentBoardId === ownerId
      if (node.boardLinkRole === 'child' && !owned) { copy.boardLinkRole = 'shortcut'; copy.boardPortal = undefined }
    }
    return copy
  }
  const copyConnector = (connector: BoardConnector): BoardConnector => ({ ...structuredClone(connector), id: connectorIds.get(connector.id)!, sourceId: connector.sourceId ? nodeIds.get(connector.sourceId) : undefined, targetId: connector.targetId ? nodeIds.get(connector.targetId) : undefined })
  const copies = subtree.map((board): BoardModel => {
    const id = boardIds.get(board.id)!
    const parentBoardId = board.parentBoardId ? boardIds.get(board.parentBoardId) || board.parentBoardId : undefined
    return {
      ...structuredClone(board), id, parentBoardId,
      title: board.id === boardId ? options.title?.trim() || `${board.title} copy` : board.title,
      linkedFolderPath: parentBoardId ? undefined : managedBoardFolderPath(project.id, id),
      nodes: board.nodes.map((node) => copyNode(node, board.id)),
      connectors: board.connectors.map(copyConnector),
      ...(board.legacyHiddenChildTiles ? { legacyHiddenChildTiles: { nodes: board.legacyHiddenChildTiles.nodes.map((node) => copyNode(node, board.id)), connectors: board.legacyHiddenChildTiles.connectors.map(copyConnector) } } : {}),
    }
  })
  const newRoot = copies.find((board) => board.id === boardIds.get(boardId))!
  let portalId: string | undefined
  let originals = project.boards
  if (source.parentBoardId) {
    const parent = originals.find((board) => board.id === source.parentBoardId)!
    const sourcePortal = parent.nodes.find((node) => node.kind === 'board-link' && node.boardLinkRole === 'child' && node.targetBoardId === boardId && node.boardPortal)
    portalId = allocate('node')
    const portal: BoardNode = sourcePortal
      ? { ...structuredClone(sourcePortal), id: portalId, targetBoardId: newRoot.id, title: newRoot.title, x: sourcePortal.x + 28, y: sourcePortal.y + 28, columnOrder: sourcePortal.columnOrder === undefined ? undefined : sourcePortal.columnOrder + .5 }
      : { id: portalId, kind: 'board-link', boardLinkRole: 'child', boardPortal: true, targetBoardId: newRoot.id, title: newRoot.title, x: 120, y: 120, width: 140, height: 128, color: newRoot.tileAccentColor || '#5778c9' }
    originals = originals.map((board) => board.id === parent.id ? { ...board, nodes: [...board.nodes, portal] } : board)
  }
  return { project: { ...project, boards: [...originals, ...copies] }, boardId: newRoot.id, boardIds, nodeIds, connectorIds, folderPaths: copies.filter((board) => !board.parentBoardId).map((board) => board.linkedFolderPath!), portalId }
}

export type BoardTransferResult = { project: ProjectModel; movedNodeIds: string[]; detachedConnectorIds: string[] }

/** Move local instances (with container contents) to another board. Internal
 * connectors move with them. External connectors are explicitly reported and
 * detached, since this model cannot attach across boards. A UI must disclose
 * this policy and retain the original project for one-step Undo before commit.
 * Owning portals reparent their target but never move any linked disk folder. */
export function moveNodesBetweenBoards(project: ProjectModel, sourceBoardId: string, destinationBoardId: string, nodeIds: readonly string[], offset: { x: number; y: number } = { x: 0, y: 0 }): BoardTransferResult | null {
  const source = project.boards.find((board) => board.id === sourceBoardId)
  const destination = project.boards.find((board) => board.id === destinationBoardId)
  if (!source || !destination || source === destination || !nodeIds.length || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return null
  if (!validDuplicationSource(project, [source, destination])) return null
  if (nodeIds.some((id) => !source.nodes.some((node) => node.id === id))) return null
  const movingIds = containerNodeIds(source, nodeIds)
  const moving = source.nodes.filter((node) => movingIds.has(node.id))
  // Data references are board-local. Refuse a partial graph transfer rather
  // than leaving computations connected to objects in another board.
  if (source.nodes.some(node => node.graphColumn?.inputs.some(input => movingIds.has(node.id) !== movingIds.has(input.sourceId)))) return null
  if (moving.some((node) => node.locked || destination.nodes.some((item) => item.id === node.id))) return null
  const childBoards = new Set<string>()
  for (const portal of moving.filter((node) => node.kind === 'board-link' && node.boardLinkRole === 'child')) {
    const target = project.boards.find((board) => board.id === portal.targetBoardId)
    if (!target || target.parentBoardId !== sourceBoardId || ownedBoardSubtree(project.boards, target.id).some((board) => board.id === destinationBoardId)) return null
    childBoards.add(target.id)
  }
  const internal = source.connectors.filter((connector) => (movingIds.has(connector.sourceId || '') || movingIds.has(connector.targetId || ''))
    && (!connector.sourceId || movingIds.has(connector.sourceId)) && (!connector.targetId || movingIds.has(connector.targetId)))
  if (internal.some((connector) => destination.connectors.some((item) => item.id === connector.id))) return null
  const affected = source.connectors.filter((connector) => movingIds.has(connector.sourceId || '') || movingIds.has(connector.targetId || ''))
  const internalIds = new Set(internal.map((connector) => connector.id))
  const transferred = moving.map((node): BoardNode => ({ ...structuredClone(node), x: node.x + offset.x, y: node.y + offset.y,
    parentColumnId: node.parentColumnId && movingIds.has(node.parentColumnId) ? node.parentColumnId : undefined,
    groupId: node.groupId && movingIds.has(node.groupId) ? node.groupId : undefined,
    columnOrder: node.parentColumnId && movingIds.has(node.parentColumnId) ? node.columnOrder : undefined,
    width: node.parentColumnId && !movingIds.has(node.parentColumnId) ? node.freeWidth || node.width : node.width,
    height: node.parentColumnId && !movingIds.has(node.parentColumnId) ? node.freeHeight || node.height : node.height,
  }))
  return { project: { ...project, boards: project.boards.map((board) => {
    const owned = childBoards.has(board.id) ? { ...board, parentBoardId: destinationBoardId } : board
    if (board.id === sourceBoardId) return { ...owned, nodes: board.nodes.filter((node) => !movingIds.has(node.id)), connectors: board.connectors.filter((connector) => !affected.includes(connector)) }
    if (board.id === destinationBoardId) return { ...owned, nodes: [...board.nodes, ...transferred], connectors: [...board.connectors, ...internal.map((connector) => ({ ...structuredClone(connector),
      ...(connector.sourcePoint ? { sourcePoint: { x: connector.sourcePoint.x + offset.x, y: connector.sourcePoint.y + offset.y } } : {}),
      ...(connector.targetPoint ? { targetPoint: { x: connector.targetPoint.x + offset.x, y: connector.targetPoint.y + offset.y } } : {}),
    }))] }
    return owned
  }) }, movedNodeIds: moving.map((node) => node.id), detachedConnectorIds: affected.filter((connector) => !internalIds.has(connector.id)).map((connector) => connector.id) }
}
