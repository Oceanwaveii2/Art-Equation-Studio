/**
 * Trash lifecycle for canvas nodes and assets (Adutt scope v2, Phase 1 data layer).
 *
 * Deleting a canvas object never destroys data: the node (or asset plus its board
 * placements) is snapshotted into a TrashEntry, the entry is recorded in the
 * per-project trash index. Managed source files remain on disk; restoring an
 * asset recreates its catalog entry and every board placement.
 */
import { isDeletableDocument, type BoardConnector, type BoardModel, type BoardNode, type ProjectAsset, type ProjectDocument, type ProjectModel } from './project'

export type TrashEntryKind = 'canvas-node' | 'asset' | 'board' | 'document'

/** Where a node sat on a board, so a restore can put it back exactly. */
export type TrashPlacement = { boardId: string; node: BoardNode }
export type TrashIndexedIds = { id: string; index: number }[]

export type TrashEntry = {
  id: string
  kind: TrashEntryKind
  title: string
  deletedAtUnixMs: number
  /** For canvas-node entries: the board the node was deleted from. */
  boardId?: string
  /** Snapshot of the deleted node (canvas-node entries). */
  node?: BoardNode
  /** A selection/container is one recovery transaction, not independent records
   * that can strand children or consume connectors during partial restores. */
  nodes?: BoardNode[]
  nodeOrder?: TrashIndexedIds
  nodeConnectors?: BoardConnector[]
  connectorOrder?: TrashIndexedIds
  /** Deleting a freeform group removes its container only; kept cards detach
   * and regain membership when that same group is restored. */
  groupMembers?: { nodeId: string; groupId: string }[]
  /** Snapshot of the deleted asset record (asset entries). */
  asset?: ProjectAsset
  assetIndex?: number
  assetGroupMembers?: { boardId: string; nodeId: string; groupId: string }[]
  /** Snapshot of the deleted board (board entries). */
  board?: BoardModel
  /** Whole nested subtree, retained with a board or mixed canvas selection for
   * one-step recovery. */
  boards?: BoardModel[]
  boardOrder?: TrashIndexedIds
  /** Board-link cards and connectors removed from surviving boards. */
  boardLinks?: { boardId: string; nodes: BoardNode[]; connectors: BoardConnector[]; nodeOrder?: TrashIndexedIds; connectorOrder?: TrashIndexedIds; hiddenNodes?: BoardNode[]; hiddenConnectors?: BoardConnector[]; hiddenNodeOrder?: TrashIndexedIds; hiddenConnectorOrder?: TrashIndexedIds }[]
  /** Snapshot of a user document, including rich content and page layout. */
  document?: ProjectDocument
  documentIndex?: number
  /** Every board placement of the asset at delete time (asset entries). */
  placements?: TrashPlacement[]
  placementOrder?: { boardId: string; nodeOrder: TrashIndexedIds; connectorOrder: TrashIndexedIds }[]
  placementConnectors?: { boardId: string; connectors: BoardConnector[] }[]
  coverReferences?: { project: boolean; inspector: boolean; boardIds: string[]; nodeIds: { boardId: string; nodeId: string }[] }
  /** Disk file locations, relative to the project root, once files are moved. */
  originalRelativePath?: string
  trashFilePath?: string
  thumbnailRelativePath?: string
  trashThumbnailPath?: string
}

export function newTrashEntryId(): string {
  return `trash-${crypto.randomUUID()}`
}

function savedOrder(items: readonly { id: string }[], selected: ReadonlySet<string>): TrashIndexedIds {
  return items.flatMap((item, index) => selected.has(item.id) ? [{ id: item.id, index }] : [])
}

function insertSaved<T extends { id: string }>(current: readonly T[], saved: readonly T[], order?: TrashIndexedIds): T[] {
  const result = [...current]
  const indices = new Map(order?.map((item) => [item.id, item.index]) || [])
  for (const item of [...saved].sort((a, b) => (indices.get(a.id) ?? Infinity) - (indices.get(b.id) ?? Infinity))) {
    const index = indices.get(item.id)
    result.splice(index === undefined ? result.length : Math.max(0, Math.min(result.length, index)), 0, structuredClone(item))
  }
  return result
}

function uniqueIds(items: readonly { id: string }[]): boolean {
  return items.every((item) => Boolean(item.id)) && new Set(items.map((item) => item.id)).size === items.length
}

function nodeReferencesExist(nodes: readonly BoardNode[], connectors: readonly BoardConnector[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return nodes.every((node) => (!node.parentColumnId || byId.get(node.parentColumnId)?.kind === 'column')
    && (!node.groupId || byId.get(node.groupId)?.kind === 'group'))
    && connectors.every((connector) => (!connector.sourceId || byId.has(connector.sourceId)) && (!connector.targetId || byId.has(connector.targetId)))
}

export type NodeTrashResult = { entry: TrashEntry; boards: BoardModel[] }

/** Build one atomic node/column selection record for the production canvas
 * deletion path. Owning subboard portals must use applyBoardTrash instead.
 * A locked column child prevents deleting its container, avoiding orphaned
 * locked records. Freeform group cards remain and detach from the removed group. */
export function createNodeTrashEntries(board: BoardModel, nodeIds: readonly string[], nowMs = Date.now()): { entries: TrashEntry[]; board: BoardModel } | null {
  if (!nodeIds.length || nodeIds.some((id) => !board.nodes.some((node) => node.id === id))) return null
  const removedIds = new Set(board.nodes.filter((node) => nodeIds.includes(node.id) && !node.locked).map((node) => node.id))
  let changed = true
  while (changed) {
    changed = false
    for (const node of board.nodes) if (node.parentColumnId && removedIds.has(node.parentColumnId) && !removedIds.has(node.id)) {
      if (node.locked) return null
      removedIds.add(node.id)
      changed = true
    }
  }
  const nodes = board.nodes.filter((node) => removedIds.has(node.id))
  if (!nodes.length || nodes.some((node) => node.kind === 'board-link' && node.boardLinkRole === 'child')) return null
  const node = nodes[0]
  const connectors = board.connectors.filter((connector) => removedIds.has(connector.sourceId || '') || removedIds.has(connector.targetId || ''))
  const groupMembers = board.nodes.filter((item) => !removedIds.has(item.id) && item.groupId && removedIds.has(item.groupId)).map((item) => ({ nodeId: item.id, groupId: item.groupId! }))
  const entry: TrashEntry = {
    id: newTrashEntryId(),
    kind: 'canvas-node',
    title: nodes.length === 1 ? node.title || node.kind : `${node.title || node.kind} and ${nodes.length - 1} related object${nodes.length === 2 ? '' : 's'}`,
    deletedAtUnixMs: nowMs,
    boardId: board.id,
    node: structuredClone(node),
    nodes: structuredClone(nodes),
    nodeOrder: savedOrder(board.nodes, removedIds),
    nodeConnectors: structuredClone(connectors),
    connectorOrder: savedOrder(board.connectors, new Set(connectors.map((connector) => connector.id))),
    groupMembers,
  }
  return { entries: [entry], board: { ...board,
    nodes: board.nodes.filter((item) => !removedIds.has(item.id)).map((item) => item.groupId && removedIds.has(item.groupId) ? { ...item, groupId: undefined } : item),
    connectors: board.connectors.filter((connector) => !connectors.includes(connector)),
  } }
}

export function applyNodeTrash(project: ProjectModel, boardId: string, nodeId: string, nowMs = Date.now()): NodeTrashResult | null {
  const board = project.boards.find((candidate) => candidate.id === boardId)
  if (!board) return null
  const result = createNodeTrashEntries(board, [nodeId], nowMs)
  return result ? { entry: result.entries[0], boards: project.boards.map((candidate) => candidate.id === boardId ? result.board : candidate) } : null
}

/** Project-level canvas deletion: a mixed selection, column contents and every
 * owning portal's complete subtree become one persisted recovery record. The
 * caller must save the record before committing project, then retain its before
 * snapshot for one-step Undo. Removing shortcut-only selections never deletes
 * a target board. Source folders/assets remain untouched. */
export function applyCanvasSelectionTrash(project: ProjectModel, boardId: string, nodeIds: readonly string[], nowMs = Date.now()): { entry: TrashEntry; project: ProjectModel } | null {
  const source = project.boards.find((board) => board.id === boardId)
  if (!source) return null
  // The basic container builder intentionally refuses owning portals. Temporarily
  // classify them as aliases only for expansion; snapshot their real records
  // below and handle canonical ownership separately in this transaction.
  const expandable = { ...source, nodes: source.nodes.map((node) => node.kind === 'board-link' && node.boardLinkRole === 'child' ? { ...node, boardLinkRole: 'shortcut' as const } : node) }
  const selection = createNodeTrashEntries(expandable, nodeIds, nowMs)
  if (!selection) return null
  const entry = selection.entries[0]
  const selectedIds = new Set(entry.nodes!.map((node) => node.id))
  const snapshots = source.nodes.filter((node) => selectedIds.has(node.id))
  entry.nodes = structuredClone(snapshots)
  entry.node = structuredClone(snapshots[0])
  const targets = new Set(snapshots.filter((node) => node.kind === 'board-link' && node.boardLinkRole === 'child').map((node) => node.targetBoardId))
  let working = project
  const removedBoards = new Map<string, BoardModel>()
  const linkSnapshots = new Map<string, NonNullable<TrashEntry['boardLinks']>[number]>()
  for (const targetId of targets) {
    const target = project.boards.find((board) => board.id === targetId)
    if (!target || target.parentBoardId !== boardId) return null
    const removed = applyBoardTrash(working, target.id, nowMs)
    if (!removed || removed.entry.boards?.some((board) => board.id === boardId)) return null
    working = removed.project
    for (const board of removed.entry.boards || []) removedBoards.set(board.id, board)
    for (const link of removed.entry.boardLinks || []) {
      const previous = linkSnapshots.get(link.boardId)
      linkSnapshots.set(link.boardId, previous ? { ...previous,
        nodes: [...previous.nodes, ...link.nodes], connectors: [...previous.connectors, ...link.connectors],
        hiddenNodes: [...(previous.hiddenNodes || []), ...(link.hiddenNodes || [])], hiddenConnectors: [...(previous.hiddenConnectors || []), ...(link.hiddenConnectors || [])],
      } : link)
    }
  }
  // Rebuild ordering from the original board arrays; sequential subtree removal
  // would otherwise save shifted indexes for the second owning portal.
  const links = [...linkSnapshots.values()].map((link) => {
    const original = project.boards.find((board) => board.id === link.boardId)!
    const nodes = link.nodes.filter((node) => link.boardId !== boardId || !selectedIds.has(node.id))
    const connectors = link.connectors.filter((connector, index, all) => all.findIndex((item) => item.id === connector.id) === index)
      .filter((connector) => link.boardId !== boardId || !entry.nodeConnectors!.some((item) => item.id === connector.id))
    const hiddenNodes = link.hiddenNodes || [], hiddenConnectors = link.hiddenConnectors || []
    return { ...link, nodes, connectors, nodeOrder: savedOrder(original.nodes, new Set(nodes.map((node) => node.id))), connectorOrder: savedOrder(original.connectors, new Set(connectors.map((connector) => connector.id))),
      hiddenNodeOrder: savedOrder(original.legacyHiddenChildTiles?.nodes || [], new Set(hiddenNodes.map((node) => node.id))), hiddenConnectorOrder: savedOrder(original.legacyHiddenChildTiles?.connectors || [], new Set(hiddenConnectors.map((connector) => connector.id))),
    }
  }).filter((link) => link.nodes.length || link.connectors.length || link.hiddenNodes?.length || link.hiddenConnectors?.length)
  if (removedBoards.size) {
    entry.boards = structuredClone(project.boards.filter((board) => removedBoards.has(board.id)))
    entry.boardOrder = savedOrder(project.boards, new Set(removedBoards.keys()))
    entry.boardLinks = links
  }
  const current = working.boards.find((board) => board.id === boardId)
  if (!current) return null
  const detachedGroups = new Set(entry.groupMembers?.map((member) => member.nodeId) || [])
  const nextBoard: BoardModel = { ...current,
    nodes: current.nodes.filter((node) => !selectedIds.has(node.id)).map((node) => detachedGroups.has(node.id) ? { ...node, groupId: undefined } : node),
    connectors: current.connectors.filter((connector) => !selectedIds.has(connector.sourceId || '') && !selectedIds.has(connector.targetId || '')),
  }
  return { entry, project: { ...working, boards: working.boards.map((board) => board.id === boardId ? nextBoard : board) } }
}

/** Restore the complete recorded transaction or leave the recovery copy intact.
 * Legacy single-node records still work, but missing required parents/endpoints
 * and ID conflicts never silently consume a recovery record. */
export function applyNodeRestore(project: ProjectModel, entry: TrashEntry): ProjectModel | null {
  if (entry.kind !== 'canvas-node' || !entry.node || !entry.boardId) return null
  if (entry.boards?.length) {
    const sourceLinks = entry.boardLinks?.find((link) => link.boardId === entry.boardId)
    const nodes = [...(entry.nodes?.length ? entry.nodes : [entry.node]), ...(sourceLinks?.nodes || [])]
    const connectors = [...(entry.nodeConnectors || []), ...(sourceLinks?.connectors || [])]
    const restoredNodes = applyNodeRestore(project, { ...entry, boards: undefined, boardLinks: undefined, nodes, nodeConnectors: connectors,
      nodeOrder: [...(entry.nodeOrder || []), ...(sourceLinks?.nodeOrder || [])], connectorOrder: [...(entry.connectorOrder || []), ...(sourceLinks?.connectorOrder || [])],
    })
    if (!restoredNodes) return null
    const externalLinks = (entry.boardLinks || []).flatMap((link) => link.boardId !== entry.boardId ? [link] : link.hiddenNodes?.length || link.hiddenConnectors?.length ? [{ ...link, nodes: [], connectors: [] }] : [])
    return applyBoardRestore(restoredNodes, { ...entry, kind: 'board', board: entry.boards[0], boardLinks: externalLinks })
  }
  const board = project.boards.find((candidate) => candidate.id === entry.boardId)
  if (!board) return null
  const savedNodes = entry.nodes?.length ? entry.nodes : [entry.node]
  const savedConnectors = entry.nodeConnectors || []
  if (!uniqueIds(savedNodes) || !uniqueIds(savedConnectors)) return null
  const nodeIds = new Set(savedNodes.map((node) => node.id))
  const connectorIds = new Set(savedConnectors.map((connector) => connector.id))
  if (project.boards.some((candidate) => [...candidate.nodes, ...(candidate.legacyHiddenChildTiles?.nodes || [])].some((node) => nodeIds.has(node.id)) || [...candidate.connectors, ...(candidate.legacyHiddenChildTiles?.connectors || [])].some((connector) => connectorIds.has(connector.id)))) return null
  if ((entry.groupMembers || []).some((member) => !board.nodes.some((node) => node.id === member.nodeId && (!node.groupId || node.groupId === member.groupId)) || !savedNodes.some((node) => node.id === member.groupId && node.kind === 'group'))) return null
  const memberships = new Map(entry.groupMembers?.map((member) => [member.nodeId, member.groupId]) || [])
  const nodes = insertSaved(board.nodes.map((node) => memberships.has(node.id) ? { ...node, groupId: memberships.get(node.id) } : node), savedNodes, entry.nodeOrder)
  const connectors = insertSaved(board.connectors, savedConnectors, entry.connectorOrder)
  if (!nodeReferencesExist(nodes, connectors)) return null
  const assets = new Set(project.assets.map((asset) => asset.id))
  if (savedNodes.some((node) => (node.assetId && !assets.has(node.assetId)) || (node.coverAssetId && !assets.has(node.coverAssetId)))) return null
  return { ...project, boards: project.boards.map((candidate) => candidate.id === board.id ? { ...board, nodes, connectors } : candidate) }
}

/** Restore a trashed board: back into the project's board list. */
export function applyBoardRestore(project: ProjectModel, entry: TrashEntry): ProjectModel | null {
  if (entry.kind !== 'board' || !entry.board) return null
  const restoredBoards = structuredClone(entry.boards?.length ? entry.boards : [entry.board])
  const ids = new Set(restoredBoards.map((board) => board.id))
  if (!uniqueIds(restoredBoards) || !ids.has(entry.board.id) || project.boards.some((existing) => ids.has(existing.id))) return null
  const nodes = restoredBoards.flatMap((board) => [...board.nodes, ...(board.legacyHiddenChildTiles?.nodes || [])])
  const connectors = restoredBoards.flatMap((board) => [...board.connectors, ...(board.legacyHiddenChildTiles?.connectors || [])])
  const nodeIds = new Set(nodes.map((node) => node.id)), connectorIds = new Set(connectors.map((connector) => connector.id))
  if (!uniqueIds(nodes) || !uniqueIds(connectors) || project.boards.some((board) => [...board.nodes, ...(board.legacyHiddenChildTiles?.nodes || [])].some((node) => nodeIds.has(node.id)) || [...board.connectors, ...(board.legacyHiddenChildTiles?.connectors || [])].some((connector) => connectorIds.has(connector.id)))) return null
  if ((entry.boardLinks || []).some((link) => {
    const target = project.boards.find((board) => board.id === link.boardId)
    const savedNodes = [...link.nodes, ...(link.hiddenNodes || [])], savedConnectors = [...link.connectors, ...(link.hiddenConnectors || [])]
    return !target || !uniqueIds(savedNodes) || !uniqueIds(savedConnectors)
      || project.boards.some((board) => [...board.nodes, ...(board.legacyHiddenChildTiles?.nodes || [])].some((existing) => savedNodes.some((node) => node.id === existing.id)) || [...board.connectors, ...(board.legacyHiddenChildTiles?.connectors || [])].some((existing) => savedConnectors.some((connector) => connector.id === existing.id)))
  })) return null
  const availableIds = new Set([...project.boards.map((board) => board.id), ...ids])
  if (restoredBoards.some((board) => board.parentBoardId && !availableIds.has(board.parentBoardId))) return null
  const boards = insertSaved(project.boards, restoredBoards, entry.boardOrder).map((board) => {
    const saved = entry.boardLinks?.find((link) => link.boardId === board.id)
    if (!saved) return board
    return { ...board, nodes: insertSaved(board.nodes, saved.nodes, saved.nodeOrder), connectors: insertSaved(board.connectors, saved.connectors, saved.connectorOrder),
      ...(saved.hiddenNodes?.length || saved.hiddenConnectors?.length ? { legacyHiddenChildTiles: { nodes: insertSaved(board.legacyHiddenChildTiles?.nodes || [], saved.hiddenNodes || [], saved.hiddenNodeOrder), connectors: insertSaved(board.legacyHiddenChildTiles?.connectors || [], saved.hiddenConnectors || [], saved.hiddenConnectorOrder) } } : {}),
    }
  })
  const byId = new Map(boards.map((board) => [board.id, board]))
  if (!uniqueIds(boards.flatMap((board) => [...board.nodes, ...(board.legacyHiddenChildTiles?.nodes || [])])) || !uniqueIds(boards.flatMap((board) => [...board.connectors, ...(board.legacyHiddenChildTiles?.connectors || [])]))) return null
  for (const board of boards) {
    const seen = new Set([board.id])
    let parent = board.parentBoardId
    while (parent) { if (seen.has(parent)) return null; seen.add(parent); parent = byId.get(parent)?.parentBoardId }
    if (!nodeReferencesExist(board.nodes, board.connectors)) return null
    if (board.nodes.some((node) => node.kind === 'board-link' && node.boardLinkRole === 'child' && (!node.targetBoardId || byId.get(node.targetBoardId)?.parentBoardId !== board.id))) return null
    const owningTargets = board.nodes.filter((node) => node.kind === 'board-link' && node.boardLinkRole === 'child' && node.boardPortal).map((node) => ({ id: node.targetBoardId || '' }))
    if (!uniqueIds(owningTargets)) return null
  }
  const assets = new Set(project.assets.map((asset) => asset.id))
  if (restoredBoards.some((board) => (board.coverAssetId && !assets.has(board.coverAssetId)) || board.nodes.some((node) => (node.assetId && !assets.has(node.assetId)) || (node.coverAssetId && !assets.has(node.coverAssetId))))) return null
  return { ...project, boards }
}

/** Keep user documents recoverable without changing the questionnaire's system role. */
export function applyDocumentTrash(project: ProjectModel, documentId: string, nowMs = Date.now()): { entry: TrashEntry; project: ProjectModel } | null {
  const document = project.documents.find((candidate) => candidate.id === documentId)
  if (!document || !isDeletableDocument(document)) return null
  return {
    entry: { id: newTrashEntryId(), kind: 'document', title: document.title, deletedAtUnixMs: nowMs, document: structuredClone(document), documentIndex: project.documents.findIndex((candidate) => candidate.id === documentId) },
    project: { ...project, documents: project.documents.filter((candidate) => candidate.id !== documentId) },
  }
}

export function applyDocumentRestore(project: ProjectModel, entry: TrashEntry): ProjectModel | null {
  if (entry.kind !== 'document' || !entry.document) return null
  // Keep the Trash copy intact if another document now occupies its ID.
  if (project.documents.some((document) => document.id === entry.document!.id)) return null
  return { ...project, documents: insertSaved(project.documents, [entry.document], entry.documentIndex === undefined ? undefined : [{ id: entry.document.id, index: entry.documentIndex }]) }
}

/** Build the trash entry for a board deletion and return the project without it.
 * Board-link cards on other boards that pointed at the deleted board are removed,
 * same as the pre-existing board delete behavior. Pure. */
export function applyBoardTrash(project: ProjectModel, boardId: string, nowMs = Date.now()): { entry: TrashEntry; project: ProjectModel } | null {
  const board = project.boards.find((candidate) => candidate.id === boardId)
  if (!board) return null
  const removedIds = new Set([boardId])
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of project.boards) if (candidate.parentBoardId && removedIds.has(candidate.parentBoardId) && !removedIds.has(candidate.id)) { removedIds.add(candidate.id); changed = true }
  }
  const subtree = project.boards.filter((candidate) => removedIds.has(candidate.id))
  const boardLinks = project.boards.filter((candidate) => !removedIds.has(candidate.id)).map((candidate) => {
    const nodes = candidate.nodes.filter((node) => node.kind === 'board-link' && node.targetBoardId && removedIds.has(node.targetBoardId))
    const nodeIds = new Set(nodes.map((node) => node.id))
    const connectors = candidate.connectors.filter((connector) => nodeIds.has(connector.sourceId || '') || nodeIds.has(connector.targetId || ''))
    const hiddenNodes = (candidate.legacyHiddenChildTiles?.nodes || []).filter((node) => node.kind === 'board-link' && node.targetBoardId && removedIds.has(node.targetBoardId))
    const hiddenIds = new Set(hiddenNodes.map((node) => node.id))
    const hiddenConnectors = (candidate.legacyHiddenChildTiles?.connectors || []).filter((connector) => hiddenIds.has(connector.sourceId || '') || hiddenIds.has(connector.targetId || ''))
    return { boardId: candidate.id, nodes: structuredClone(nodes), connectors: structuredClone(connectors), nodeOrder: savedOrder(candidate.nodes, nodeIds), connectorOrder: savedOrder(candidate.connectors, new Set(connectors.map((connector) => connector.id))),
      hiddenNodes: structuredClone(hiddenNodes), hiddenConnectors: structuredClone(hiddenConnectors), hiddenNodeOrder: savedOrder(candidate.legacyHiddenChildTiles?.nodes || [], hiddenIds), hiddenConnectorOrder: savedOrder(candidate.legacyHiddenChildTiles?.connectors || [], new Set(hiddenConnectors.map((connector) => connector.id))),
    }
  }).filter((entry) => entry.nodes.length || entry.hiddenNodes.length)
  const entry: TrashEntry = {
    id: newTrashEntryId(),
    kind: 'board',
    title: board.title,
    deletedAtUnixMs: nowMs,
    board: structuredClone(board),
    boards: structuredClone(subtree),
    boardOrder: savedOrder(project.boards, removedIds),
    boardLinks,
  }
  const next: ProjectModel = { ...project, boards: project.boards.filter((candidate) => !removedIds.has(candidate.id)) }
  const removedLinks = new Set(boardLinks.flatMap((link) => [...link.nodes, ...link.hiddenNodes].map((node) => node.id)))
  next.boards = next.boards.map((candidate) => ({
    ...candidate,
    nodes: candidate.nodes.filter((node) => !removedLinks.has(node.id)),
    connectors: candidate.connectors.filter((connector) => !(connector.sourceId && removedLinks.has(connector.sourceId)) && !(connector.targetId && removedLinks.has(connector.targetId))),
    ...(candidate.legacyHiddenChildTiles ? { legacyHiddenChildTiles: {
      nodes: candidate.legacyHiddenChildTiles.nodes.filter((node) => !removedLinks.has(node.id)),
      connectors: candidate.legacyHiddenChildTiles.connectors.filter((connector) => !removedLinks.has(connector.sourceId || '') && !removedLinks.has(connector.targetId || '')),
    } } : {}),
  }))
  return { entry, project: next }
}

export type AssetTrashResult = { entry: TrashEntry; project: ProjectModel }

/** Build the trash entry for an asset deletion: the asset record leaves the
 * catalog and every board placement is snapshotted then removed. Pure. */
export function applyAssetTrash(project: ProjectModel, assetId: string, nowMs = Date.now()): AssetTrashResult | null {
  const asset = project.assets.find((candidate) => candidate.id === assetId)
  if (!asset) return null
  if (asset.locked) return null
  const placements: TrashPlacement[] = []
  const placementConnectors: NonNullable<TrashEntry['placementConnectors']> = []
  const placementOrder: NonNullable<TrashEntry['placementOrder']> = []
  const assetGroupMembers: NonNullable<TrashEntry['assetGroupMembers']> = []
  for (const board of project.boards) {
    const nodeIds = new Set(board.nodes.filter((node) => node.assetId === assetId).map((node) => node.id))
    // Container assets can own children. Save the children with their parent
    // rather than removing them without a recovery record.
    const removedIds = new Set(nodeIds)
    let expanded = true
    while (expanded) {
      expanded = false
      for (const node of board.nodes) if (node.parentColumnId && removedIds.has(node.parentColumnId) && !removedIds.has(node.id)) { removedIds.add(node.id); expanded = true }
    }
    if (board.nodes.some((node) => removedIds.has(node.id) && (node.locked || (node.kind === 'board-link' && node.boardLinkRole === 'child')))) return null
    for (const node of board.nodes) if (!removedIds.has(node.id) && node.groupId && removedIds.has(node.groupId)) assetGroupMembers.push({ boardId: board.id, nodeId: node.id, groupId: node.groupId })
    if (removedIds.size) {
      const connectors = board.connectors.filter((connector) => removedIds.has(connector.sourceId || '') || removedIds.has(connector.targetId || ''))
      placementConnectors.push({ boardId: board.id, connectors: structuredClone(connectors) })
      placementOrder.push({ boardId: board.id, nodeOrder: savedOrder(board.nodes, removedIds), connectorOrder: savedOrder(board.connectors, new Set(connectors.map((connector) => connector.id))) })
    }
    for (const node of board.nodes) if (removedIds.has(node.id)) placements.push({ boardId: board.id, node: structuredClone(node) })
  }
  const placementNodeIds = new Set(placements.map((placement) => placement.node.id))
  const entry: TrashEntry = {
    id: newTrashEntryId(),
    kind: 'asset',
    title: asset.displayName || asset.originalName,
    deletedAtUnixMs: nowMs,
    asset: structuredClone(asset),
    assetIndex: project.assets.findIndex((candidate) => candidate.id === assetId),
    assetGroupMembers,
    placements,
    placementConnectors,
    placementOrder,
    coverReferences: { project: project.projectCoverAssetId === assetId, inspector: project.inspectorImageAssetId === assetId, boardIds: project.boards.filter((board) => board.coverAssetId === assetId).map((board) => board.id), nodeIds: project.boards.flatMap((board) => board.nodes.filter((node) => node.coverAssetId === assetId && !placementNodeIds.has(node.id)).map((node) => ({ boardId: board.id, nodeId: node.id }))) },
    originalRelativePath: asset.managedRelativePath,
    thumbnailRelativePath: asset.thumbnailRelativePath,
  }
  const next: ProjectModel = {
    ...project,
    assets: project.assets.filter((candidate) => candidate.id !== assetId),
    projectCoverAssetId: project.projectCoverAssetId === assetId ? undefined : project.projectCoverAssetId,
    inspectorImageAssetId: project.inspectorImageAssetId === assetId ? undefined : project.inspectorImageAssetId,
    boards: project.boards.map((board) => {
      const removedIds = new Set(placements.filter((placement) => placement.boardId === board.id).map((placement) => placement.node.id))
      const stripped: BoardModel = { ...board, coverAssetId: board.coverAssetId === assetId ? undefined : board.coverAssetId, nodes: board.nodes.filter((node) => !removedIds.has(node.id)).map((node) => ({ ...node, ...(node.coverAssetId === assetId ? { coverAssetId: undefined } : {}), ...(node.groupId && removedIds.has(node.groupId) ? { groupId: undefined } : {}) })) }
      return { ...stripped, connectors: stripped.connectors.filter((connector) => !placementNodeIds.has(connector.sourceId || '') && !placementNodeIds.has(connector.targetId || '')) }
    }),
  }
  return { entry, project: next }
}

/** Restore the catalog record, all placements, connectors and cover references
 * atomically. Missing boards and conflicts leave the Trash entry intact. */
export function applyAssetRestore(project: ProjectModel, entry: TrashEntry): ProjectModel | null {
  if (entry.kind !== 'asset' || !entry.asset) return null
  if (project.assets.some((candidate) => candidate.id === entry.asset!.id)) return null
  if ((entry.placements || []).some((placement) => !project.boards.some((board) => board.id === placement.boardId) || project.boards.some((board) => board.nodes.some((node) => node.id === placement.node.id)))) return null
  if ((entry.coverReferences?.boardIds || []).some((id) => !project.boards.some((board) => board.id === id))) return null
  if ((entry.coverReferences?.nodeIds || []).some((item) => !project.boards.some((board) => board.id === item.boardId && board.nodes.some((node) => node.id === item.nodeId)))) return null
  if ((entry.assetGroupMembers || []).some((member) => !project.boards.some((board) => board.id === member.boardId && board.nodes.some((node) => node.id === member.nodeId && (!node.groupId || node.groupId === member.groupId))) || !entry.placements?.some((placement) => placement.boardId === member.boardId && placement.node.id === member.groupId && placement.node.kind === 'group'))) return null
  if ((entry.coverReferences?.project && project.projectCoverAssetId) || (entry.coverReferences?.inspector && project.inspectorImageAssetId)) return null
  if ((entry.coverReferences?.boardIds || []).some((id) => project.boards.find((board) => board.id === id)?.coverAssetId)) return null
  if ((entry.coverReferences?.nodeIds || []).some((item) => project.boards.find((board) => board.id === item.boardId)?.nodes.find((node) => node.id === item.nodeId)?.coverAssetId)) return null
  const placements = entry.placements || []
  const savedConnectorEntries = entry.placementConnectors || []
  if (!uniqueIds(placements.map((placement) => placement.node)) || !uniqueIds(savedConnectorEntries.flatMap((item) => item.connectors))) return null
  const savedConnectorIds = new Set(savedConnectorEntries.flatMap((item) => item.connectors.map((connector) => connector.id)))
  if (project.boards.some((board) => board.connectors.some((connector) => savedConnectorIds.has(connector.id)))) return null
  const asset = structuredClone(entry.asset)
  const restored: ProjectModel = {
    ...project,
    assets: insertSaved(project.assets, [asset], entry.assetIndex === undefined ? undefined : [{ id: asset.id, index: entry.assetIndex }]),
    projectCoverAssetId: entry.coverReferences?.project ? asset.id : project.projectCoverAssetId,
    inspectorImageAssetId: entry.coverReferences?.inspector ? asset.id : project.inspectorImageAssetId,
  }
  const result: ProjectModel = {
    ...restored,
    boards: restored.boards.map((board) => {
      const placements = (entry.placements || []).filter((placement) => placement.boardId === board.id)
      const coverNodeIds = new Set(entry.coverReferences?.nodeIds.filter((item) => item.boardId === board.id).map((item) => item.nodeId) || [])
      const coverAssetId = entry.coverReferences?.boardIds.includes(board.id) ? asset.id : board.coverAssetId
      const memberships = new Map(entry.assetGroupMembers?.filter((member) => member.boardId === board.id).map((member) => [member.nodeId, member.groupId]) || [])
      if (!placements.length && !coverNodeIds.size && !memberships.size && coverAssetId === board.coverAssetId) return board
      const savedConnectors = entry.placementConnectors?.find((item) => item.boardId === board.id)?.connectors || []
      const order = entry.placementOrder?.find((item) => item.boardId === board.id)
      return { ...board, coverAssetId, nodes: insertSaved(board.nodes.map((node) => ({ ...node, ...(coverNodeIds.has(node.id) ? { coverAssetId: asset.id } : {}), ...(memberships.has(node.id) ? { groupId: memberships.get(node.id) } : {}) })), placements.map((placement) => placement.node), order?.nodeOrder), connectors: insertSaved(board.connectors, savedConnectors, order?.connectorOrder) }
    }),
  }
  if (result.boards.some((board) => !nodeReferencesExist(board.nodes, board.connectors))) return null
  return result
}
