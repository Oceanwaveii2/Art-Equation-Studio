import type { BoardConnector, BoardModel, BoardNode, ProjectAsset, ProjectModel } from '../model/project'
import { containerPaintOrder, diagramProjectionStates, validateMindMapConnectors, type StructureResult } from './diagramStructureCore'

export type ResearchExportScope = 'board' | 'owned-subtree'
export type ResearchExportWarning = { code: string; detail: string; boardId?: string; nodeId?: string; assetId?: string }
export type ResearchAssetReference = {
  key: string; boardId: string; nodeId: string; role: 'content' | 'cover'; assetId?: string
  record?: ProjectAsset; source: 'catalog' | 'embedded' | 'unresolved'; embeddedSource?: string
  requiresPreview: boolean
}
export type ResearchExportItem = {
  nodeId: string; kind: BoardNode['kind']; title: string; node: BoardNode; depth: number
  containerPath: Array<{ id: string; title: string; kind: 'group' | 'column' }>
  assetKeys: string[]; visualTreatment: 'image-preview' | 'vector' | 'formatted-text' | 'container' | 'summary-card'
}
export type ResearchExportBoard = {
  boardId: string; title: string; path: Array<{ id: string; title: string }>
  items: ResearchExportItem[]; connectors: BoardConnector[]; excludedNodeIds: string[]; excludedConnectorIds: string[]
}
export type ResearchExportInventory = {
  version: 1; projectId: string; rootBoardId: string; scope: ResearchExportScope
  visibility: 'visible-only'; traversal: 'parent-board-ownership-only'
  boardIds: string[]; boards: ResearchExportBoard[]; assetReferences: ResearchAssetReference[]
  warnings: ResearchExportWarning[]; skippedBoardIds: string[]
  support: {
    visualBoardFormats: readonly ['png', 'jpeg']; visualBoardTargets: readonly ['viewport', 'full', 'selection', 'frame']
    visualScope: 'current-board'; orderedText: 'format-decision-pending'; ownedSubtreeArtifact: 'format-decision-pending'
    originalAssetsIncluded: false
  }
}
export type ResearchMediaResolution = { key: string; status: 'resolved' | 'missing' | 'omitted'; detail?: string }
export type ResearchMediaPreflight = {
  warnings: ResearchExportWarning[]; resolvedKeys: string[]; missingKeys: string[]; omittedKeys: string[]
  unresolvedKeys: string[]; hasBlockingMissing: boolean
}
const failure = <T = never>(code: string, detail: string, nodeId?: string): StructureResult<T> =>
  ({ ok: false, issues: [{ code, detail, ...(nodeId ? { nodeId } : {}) }] })
const copy = <T>(value: T): T => structuredClone(value)
const owner = (node: BoardNode) => node.groupId || node.parentColumnId

function checkedBoards(boards: readonly BoardModel[]): StructureResult<Map<string, BoardModel>> {
  const byId = new Map<string, BoardModel>()
  for (const board of boards) {
    if (!board.id || byId.has(board.id)) return failure('duplicate-board', 'Board identities must be nonempty and unique before preparing an export.')
    byId.set(board.id, board)
  }
  const finished = new Set<string>()
  for (const board of boards) {
    const visited = new Set<string>(), chain: string[] = []
    let current: BoardModel | undefined = board
    while (current && !finished.has(current.id)) {
      if (visited.has(current.id)) return failure('board-cycle', 'Board ownership contains a cycle; export preparation was cancelled.')
      visited.add(current.id); chain.push(current.id)
      if (current.parentBoardId && !byId.has(current.parentBoardId)) return failure('missing-board-parent', 'A board has a missing parent; export preparation was cancelled.')
      current = current.parentBoardId ? byId.get(current.parentBoardId) : undefined
    }
    chain.forEach((id) => finished.add(id))
  }
  return { ok: true, value: byId }
}

/** Container depth follows canonical paint order; direct column siblings follow
 * the same columnOrder/y rule as columnChildren. Saved rows/layers are not rewritten. */
function orderedBoardNodes(board: BoardModel): StructureResult<BoardNode[]> {
  const paint = containerPaintOrder(board.nodes)
  if (!paint.ok) return paint
  const rank = new Map(paint.value.orderedIds.map((id, index) => [id, index]))
  const byId = new Map(board.nodes.map((node) => [node.id, node]))
  const children = new Map<string | undefined, BoardNode[]>()
  for (const node of board.nodes) {
    if (![node.x, node.y, node.width, node.height, node.rotation ?? 0].every(Number.isFinite) || node.width <= 0 || node.height <= 0)
      return failure('invalid-export-geometry', 'Objects need finite geometry and positive dimensions before export preparation.', node.id)
    if (node.columnOrder !== undefined && !Number.isFinite(node.columnOrder)) return failure('invalid-column-order', 'Column order must be finite.', node.id)
    const siblings = children.get(owner(node)) || []
    siblings.push(node); children.set(owner(node), siblings)
  }
  for (const [parentId, siblings] of children) {
    if (parentId && byId.get(parentId)?.kind === 'column')
      siblings.sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0) || a.y - b.y || rank.get(a.id)! - rank.get(b.id)!)
    else siblings.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  }
  const result: BoardNode[] = [], stack = [...(children.get(undefined) || [])].reverse()
  while (stack.length) {
    const node = stack.pop()!; result.push(node)
    const nested = children.get(node.id) || []
    for (let index = nested.length - 1; index >= 0; index--) stack.push(nested[index])
  }
  return { ok: true, value: result }
}

/** Read-only inventory/preflight bridge for the existing visual exporter.
 * It emits no document, performs no file/network IO and invents no original.
 * An owned-subtree inventory does not establish a supported subtree format. */
export function prepareResearchExport(project: Pick<ProjectModel, 'id' | 'boards' | 'assets'>, rootBoardId: string, scope: ResearchExportScope): StructureResult<ResearchExportInventory> {
  if (scope !== 'board' && scope !== 'owned-subtree') return failure('invalid-export-scope', 'Choose the current board or its owned subtree.')
  const checked = checkedBoards(project.boards)
  if (!checked.ok) return checked
  const byId = checked.value, root = byId.get(rootBoardId)
  if (!root) return failure('missing-export-board', 'The export source board is missing.')
  const assets = new Map<string, ProjectAsset>()
  for (const asset of project.assets) {
    if (!asset.id || assets.has(asset.id)) return failure('duplicate-asset', 'Asset identities must be nonempty and unique before export preparation.')
    assets.set(asset.id, asset)
  }
  const children = new Map<string, BoardModel[]>()
  for (const board of project.boards) if (board.parentBoardId) {
    const siblings = children.get(board.parentBoardId) || []
    siblings.push(board); children.set(board.parentBoardId, siblings)
  }
  const candidateIds: string[] = [], queue = [root.id]
  for (let index = 0; index < queue.length; index++) {
    candidateIds.push(queue[index])
    if (scope === 'owned-subtree') queue.push(...(children.get(queue[index]) || []).map((board) => board.id))
  }
  const ordered = new Map<string, BoardNode[]>(), visible = new Map<string, Set<string>>()
  for (const boardId of candidateIds) {
    const board = byId.get(boardId)!, order = orderedBoardNodes(board), projection = diagramProjectionStates(board.nodes)
    if (!order.ok) return order
    if (!projection.ok) return projection
    const nodeIds = new Set(board.nodes.map((node) => node.id)), edgeIds = new Set<string>()
    for (const edge of board.connectors) {
      if (!edge.id || edgeIds.has(edge.id)) return failure('duplicate-export-connector', 'Connection identities must be nonempty and unique.')
      edgeIds.add(edge.id)
      if ((edge.sourceId && !nodeIds.has(edge.sourceId)) || (edge.targetId && !nodeIds.has(edge.targetId)))
        return failure('missing-export-endpoint', 'A connection points to a missing object; export preparation was cancelled.')
      if ((!edge.sourceId && !edge.sourcePoint) || (!edge.targetId && !edge.targetPoint))
        return failure('missing-export-anchor', 'A detached connection endpoint has no anchor; export preparation was cancelled.')
      if ([...(edge.bendPoints || []), ...(edge.sourcePoint ? [edge.sourcePoint] : []), ...(edge.targetPoint ? [edge.targetPoint] : [])].some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
        return failure('invalid-export-route', 'Connection routes must use finite coordinates.')
    }
    const treeIds = new Set([...board.nodes.flatMap((node) => node.mindMap ? [node.mindMap.treeId] : []), ...board.connectors.flatMap((edge) => edge.mindMap ? [edge.mindMap.treeId] : [])])
    for (const treeId of treeIds) {
      const tree = validateMindMapConnectors(board.nodes, board.connectors, treeId)
      if (!tree.ok) return tree
    }
    const ownedTargets = new Set<string>()
    for (const node of board.nodes) if (node.kind === 'board-link' && node.boardLinkRole === 'child') {
      if (!node.targetBoardId || byId.get(node.targetBoardId)?.parentBoardId !== board.id)
        return failure('invalid-owning-portal', 'An owning portal does not match canonical board ownership.', node.id)
      if (ownedTargets.has(node.targetBoardId)) return failure('duplicate-owning-portal', 'A child board has multiple owning portals.', node.id)
      ownedTargets.add(node.targetBoardId)
    }
    ordered.set(boardId, order.value)
    visible.set(boardId, new Set(order.value.filter((node) => !projection.value.get(node.id)!.hidden).map((node) => node.id)))
  }
  const warnings: ResearchExportWarning[] = [], output: ResearchExportBoard[] = [], assetReferences: ResearchAssetReference[] = [], skippedBoardIds: string[] = []
  const pending = [root.id]
  function warning(code: string, detail: string, boardId?: string, nodeId?: string, assetId?: string) {
    warnings.push({ code, detail, ...(boardId ? { boardId } : {}), ...(nodeId ? { nodeId } : {}), ...(assetId ? { assetId } : {}) })
  }
  function boardPath(board: BoardModel) {
    const path: Array<{ id: string; title: string }> = []
    let current: BoardModel | undefined = board
    while (current) { path.unshift({ id: current.id, title: current.title }); current = current.parentBoardId ? byId.get(current.parentBoardId) : undefined }
    return path
  }
  function addAsset(boardId: string, node: BoardNode, role: 'content' | 'cover', assetId?: string) {
    const key = boardId + ':' + node.id + ':' + role
    const record = assetId ? assets.get(assetId) : undefined
    const embedded = role === 'content' && node.kind === 'image' && !assetId && /^data:image\//i.test(node.body || '') ? node.body : undefined
    const requiresPreview = role === 'cover' || node.kind === 'image'
    assetReferences.push({ key, boardId, nodeId: node.id, role, ...(assetId ? { assetId } : {}), ...(record ? { record: copy(record) } : {}), source: record ? 'catalog' : embedded ? 'embedded' : 'unresolved', ...(embedded ? { embeddedSource: embedded } : {}), requiresPreview })
    if (assetId && !record) warning('missing-asset-record', 'The asset record for “' + node.title + '” is missing; locate the original or retain a named placeholder.', boardId, node.id, assetId)
    else if (record?.status === 'missing' || record?.status === 'moved') warning('catalog-source-unavailable', 'The catalog marks “' + (record.displayName || record.originalName) + '” as ' + record.status + '; verify its linked source before export.', boardId, node.id, assetId)
    else if (!record && !embedded) warning('missing-image-source', '“' + node.title + '” has no catalog or embedded image source; locate the original or retain a named placeholder.', boardId, node.id)
    if (requiresPreview && record && !record.relativePath && !record.managedRelativePath && !record.thumbnailRelativePath)
      warning('missing-asset-path', '“' + (record.displayName || record.originalName) + '” has no linked source or preview path.', boardId, node.id, assetId)
    return key
  }
  while (pending.length) {
    const boardId = pending.pop()!, board = byId.get(boardId)!, order = ordered.get(boardId)!, visibility = visible.get(boardId)!, nodesById = new Map(board.nodes.map((node) => [node.id, node]))
    const items: ResearchExportItem[] = []
    for (const node of order) {
      if (!visibility.has(node.id)) continue
      const containerPath: ResearchExportItem['containerPath'] = []
      let current = node
      while (owner(current)) {
        current = nodesById.get(owner(current)!)!
        containerPath.unshift({ id: current.id, title: current.title, kind: current.kind as 'group' | 'column' })
      }
      const assetKeys: string[] = []
      if (node.assetId || node.kind === 'image') assetKeys.push(addAsset(boardId, node, 'content', node.assetId))
      if (node.coverAssetId) assetKeys.push(addAsset(boardId, node, 'cover', node.coverAssetId))
      const visualTreatment: ResearchExportItem['visualTreatment'] = node.kind === 'image' ? 'image-preview' : node.kind === 'shape' ? 'vector' : node.kind === 'text' ? 'formatted-text' : node.kind === 'group' || node.kind === 'column' ? 'container' : 'summary-card'
      items.push({ nodeId: node.id, kind: node.kind, title: node.title, node: copy(node), depth: containerPath.length, containerPath, assetKeys, visualTreatment })
      if (node.kind === 'board-link') {
        if (!node.targetBoardId || !byId.has(node.targetBoardId)) warning('missing-board-reference', 'The target of “' + node.title + '” is missing; the shortcut remains a reference and is never followed.', boardId, node.id)
        else if (node.boardLinkRole !== 'child') warning('shortcut-reference-only', '“' + node.title + '” is a shortcut reference; its target content is not traversed through this link.', boardId, node.id)
      }
      if (node.kind === 'video' || node.kind === 'model' || node.kind === 'document' || node.kind === 'clip')
        warning('visual-summary-only', '“' + node.title + '” exports as a summary card; ' + node.kind + ' content and original files are not embedded.', boardId, node.id, node.assetId)
      if (node.captured?.sourceUrl || /<a\s[^>]*href\s*=/i.test(node.body || ''))
        warning('visual-link-reference', 'Links in “' + node.title + '” are rendered text or summaries in PNG/JPEG; interactive links are not retained.', boardId, node.id)
      if (node.captured || (visualTreatment === 'summary-card' && (node.body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length > 180))
        warning('visual-text-summary', '“' + node.title + '” may be shortened in visual export; complete research text is not a supported ordered-text handoff.', boardId, node.id)
    }
    const connectors = board.connectors.filter((edge) => (!edge.sourceId || visibility.has(edge.sourceId)) && (!edge.targetId || visibility.has(edge.targetId)))
    const excludedNodeIds = order.filter((node) => !visibility.has(node.id)).map((node) => node.id), excludedConnectorIds = board.connectors.filter((edge) => !connectors.includes(edge)).map((edge) => edge.id)
    if (excludedNodeIds.length || excludedConnectorIds.length) warning('visible-content-only', excludedNodeIds.length + ' hidden/collapsed objects and ' + excludedConnectorIds.length + ' connections are excluded from visible content.', boardId)
    output.push({ boardId, title: board.title, path: boardPath(board), items, connectors: copy(connectors), excludedNodeIds, excludedConnectorIds })
    if (scope !== 'owned-subtree') continue
    const index = new Map(order.map((node, ordinal) => [node.id, ordinal]))
    const childBoards = [...(children.get(boardId) || [])].sort((a, b) => {
      const aPortal = board.nodes.find((node) => node.kind === 'board-link' && node.boardLinkRole === 'child' && node.targetBoardId === a.id)
      const bPortal = board.nodes.find((node) => node.kind === 'board-link' && node.boardLinkRole === 'child' && node.targetBoardId === b.id)
      return (aPortal ? index.get(aPortal.id)! : Number.MAX_SAFE_INTEGER) - (bPortal ? index.get(bPortal.id)! : Number.MAX_SAFE_INTEGER)
    })
    const next: string[] = []
    for (const child of childBoards) {
      const portal = board.nodes.find((node) => node.kind === 'board-link' && node.boardLinkRole === 'child' && node.targetBoardId === child.id)
      if (portal && !visibility.has(portal.id)) {
        const skipped = [child.id]
        for (let cursor = 0; cursor < skipped.length; cursor++) skipped.push(...(children.get(skipped[cursor]) || []).map((nested) => nested.id))
        skippedBoardIds.push(...skipped)
        warning('hidden-board-branch', skipped.length + ' owned boards are excluded beneath a hidden/collapsed owning portal.', boardId, portal.id)
        continue
      }
      if (!portal) warning('owning-portal-absent', 'An owned child board has no current owning portal; inventory follows canonical parentBoardId without recreating a tile.', boardId)
      next.push(child.id)
    }
    pending.push(...next.reverse())
  }
  if (scope === 'owned-subtree') warning('subtree-format-pending', 'This inventory covers owned boards once. A combined subtree or ordered-text artifact format remains a product decision; current visual export writes one board.')
  warning('originals-not-packaged', 'Visual exports contain rendered previews and summaries. Original source files are not packaged, renamed or moved.')
  return { ok: true, value: {
    version: 1, projectId: project.id, rootBoardId, scope, visibility: 'visible-only', traversal: 'parent-board-ownership-only',
    boardIds: output.map((board) => board.boardId), boards: output, assetReferences, warnings, skippedBoardIds,
    support: { visualBoardFormats: ['png', 'jpeg'], visualBoardTargets: ['viewport', 'full', 'selection', 'frame'], visualScope: 'current-board', orderedText: 'format-decision-pending', ownedSubtreeArtifact: 'format-decision-pending', originalAssetsIncluded: false },
  } }
}

/** Host/browser resolver reports actual source checks. Metadata alone never
 * proves an original exists. Missing/omitted images must be visibly disclosed;
 * the existing visual exporter may refuse them rather than save an incomplete file. */
export function researchExportMediaPreflight(inventory: ResearchExportInventory, resolutions: readonly ResearchMediaResolution[]): StructureResult<ResearchMediaPreflight> {
  const refs = new Map(inventory.assetReferences.map((reference) => [reference.key, reference])), resolved = new Map<string, ResearchMediaResolution>()
  for (const entry of resolutions) {
    if (!refs.has(entry.key)) return failure('unknown-preview-resolution', 'A preview result does not match this export inventory.')
    if (resolved.has(entry.key)) return failure('duplicate-preview-resolution', 'A preview was resolved more than once.')
    if (!['resolved', 'missing', 'omitted'].includes(entry.status)) return failure('invalid-preview-resolution', 'A preview resolution has an unsupported status.')
    resolved.set(entry.key, entry)
  }
  const warnings = copy(inventory.warnings), resolvedKeys: string[] = [], missingKeys: string[] = [], omittedKeys: string[] = [], unresolvedKeys: string[] = []
  for (const reference of inventory.assetReferences) {
    if (!reference.requiresPreview) continue
    const entry = resolved.get(reference.key)
    if (entry?.status === 'resolved') { resolvedKeys.push(reference.key); continue }
    const list = entry?.status === 'missing' ? missingKeys : entry?.status === 'omitted' ? omittedKeys : unresolvedKeys
    list.push(reference.key)
    warnings.push({ code: entry?.status === 'missing' ? 'preview-source-missing' : entry?.status === 'omitted' ? 'preview-omitted' : 'preview-source-unverified',
      detail: entry?.detail || (entry?.status === 'omitted' ? 'This image preview was explicitly omitted; the original is not packaged.' : 'Verify this image source before saving a complete visual export.'),
      boardId: reference.boardId, nodeId: reference.nodeId, ...(reference.assetId ? { assetId: reference.assetId } : {}) })
  }
  return { ok: true, value: { warnings, resolvedKeys, missingKeys, omittedKeys, unresolvedKeys, hasBlockingMissing: Boolean(missingKeys.length || unresolvedKeys.length) } }
}
