import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const projectUrl = dataUrl(await source('../src/model/project.ts'))
const transactions = await import(dataUrl((await source('../src/board/boardTransactions.ts')).replace("from '../model/project'", `from '${projectUrl}'`)))
const trash = await import(dataUrl((await source('../src/model/trash.ts')).replace("from './project'", `from '${projectUrl}'`)))
const canonical = (value) => JSON.parse(JSON.stringify(value))
const node = (id, kind = 'note', extra = {}) => ({ id, kind, title: id, x: 20, y: 30, width: 140, height: 120, ...extra })
const connector = (id, sourceId, targetId, extra = {}) => ({ id, sourceId, targetId, sourcePort: 'right', targetPort: 'left', style: 'curve', color: '#abcdef', width: 2, dashed: false, startArrow: true, endArrow: true, animated: false, label: id, ...extra })
const board = (id, extra = {}) => ({ id, title: id, viewport: { x: 10, y: 30, scale: .9 }, nodes: [], connectors: [], ...extra })
const asset = { id: 'source-art', relativePath: 'projects/fixture/assets/unchanged.png', managedRelativePath: 'projects/fixture/assets/unchanged.png', thumbnailRelativePath: 'projects/fixture/thumbs/unchanged.png', originalName: 'unchanged.png', byteLength: 42, extension: 'png', deduplicated: false, kind: 'image', importedAt: '2026-09-29T00:00:00Z', displayName: 'Source artwork', virtualFolder: '', aliases: [], status: 'available' }
const fixture = () => ({ id: 'fixture', title: 'Recovery fixture', documents: [{ id: 'document', title: 'Rich notes', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original rich text', marks: [{ type: 'bold' }] }] }] }, layout: { pageSize: 'a4', orientation: 'portrait', marginTop: 20, marginBottom: 20 } }], assets: [structuredClone(asset)], boards: [
  board('root', { linkedFolderPath: 'projects/fixture/boards/root', coverAssetId: asset.id, nodes: [node('first'), node('column', 'column'), node('image', 'image', { assetId: asset.id, parentColumnId: 'column', columnOrder: 0, imageTransform: { opacity: 1, flipX: true } }), node('portal', 'board-link', { targetBoardId: 'child', boardLinkRole: 'child', boardPortal: true, parentColumnId: 'column', columnOrder: 1 }), node('group', 'group'), node('shape', 'shape', { groupId: 'group', shapeType: 'path', vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0, handleOut: { x: 12, y: 0 } }, { x: 30, y: 20 }, { x: 0, y: 20 }] } }), node('internal-alias', 'board-link', { targetBoardId: 'grandchild', boardLinkRole: 'shortcut' }), node('external-alias', 'board-link', { targetBoardId: 'other', boardLinkRole: 'shortcut' }), node('last')], connectors: [connector('root-edge', 'image', 'portal'), connector('shape-edge', 'shape', 'image')] }),
  board('other', { linkedFolderPath: 'projects/fixture/boards/other', nodes: [node('other-note'), node('child-alias', 'board-link', { targetBoardId: 'child', boardLinkRole: 'shortcut' })], connectors: [connector('alias-edge', 'other-note', 'child-alias')], legacyHiddenChildTiles: { nodes: [node('legacy-shortcut', 'board-link', { targetBoardId: 'child', boardLinkRole: 'shortcut' })], connectors: [] } }),
  board('child', { parentBoardId: 'root', linkedFolderPath: 'C:/user/custom-original-child-folder', nodes: [node('child-note'), node('grand-portal', 'board-link', { targetBoardId: 'grandchild', boardLinkRole: 'child', boardPortal: true })], connectors: [connector('child-edge', 'child-note', 'grand-portal')] }),
  board('grandchild', { parentBoardId: 'child', nodes: [node('grand-image', 'image', { assetId: asset.id })] }),
] })

let passed = 0
const check = (label, run) => { run(); passed++; console.log(`PASS ${label}`) }
const newIds = () => { let count = 0; return (kind) => `copied-${kind}-${++count}` }

check('deep duplication remaps columns, groups, connectors and owned descendants', () => {
  const initial = fixture(), before = structuredClone(initial)
  const result = transactions.duplicateBoardSubtree(initial, 'root', { idFactory: newIds() })
  assert.ok(result)
  assert.equal(result.project.boards.length, 7)
  const copy = result.project.boards.find((item) => item.id === result.boardId)
  assert.equal(copy.nodes.find((item) => item.id === result.nodeIds.get('image')).parentColumnId, result.nodeIds.get('column'))
  assert.equal(copy.nodes.find((item) => item.id === result.nodeIds.get('shape')).groupId, result.nodeIds.get('group'))
  assert.equal(copy.connectors[0].sourceId, result.nodeIds.get('image'))
  assert.equal(copy.connectors[0].targetId, result.nodeIds.get('portal'))
  assert.equal(copy.nodes.find((item) => item.id === result.nodeIds.get('portal')).targetBoardId, result.boardIds.get('child'))
  assert.equal(copy.nodes.find((item) => item.id === result.nodeIds.get('internal-alias')).targetBoardId, result.boardIds.get('grandchild'))
  assert.equal(copy.nodes.find((item) => item.id === result.nodeIds.get('external-alias')).targetBoardId, 'other')
  assert.equal(copy.nodes.find((item) => item.id === result.nodeIds.get('internal-alias')).boardLinkRole, 'shortcut')
  assert.equal(result.project.boards.find((item) => item.id === result.boardIds.get('child')).parentBoardId, copy.id)
  assert.equal(result.project.boards.find((item) => item.id === result.boardIds.get('child')).linkedFolderPath, undefined)
  assert.equal(copy.linkedFolderPath, `projects/fixture/boards/${copy.id}`)
  assert.deepEqual(result.folderPaths, [copy.linkedFolderPath])
  assert.strictEqual(result.project.assets, initial.assets)
  copy.nodes.find((item) => item.id === result.nodeIds.get('shape')).vectorPath.points[0].x = 99
  assert.deepEqual(initial, before, 'editing duplicate must leave original instance geometry and project untouched')
})
check('nested duplicate creates a distinct sibling owning portal without altering source ownership', () => {
  const initial = fixture(), result = transactions.duplicateBoardSubtree(initial, 'child', { idFactory: newIds() })
  assert.ok(result)
  const copy = result.project.boards.find((item) => item.id === result.boardId)
  assert.equal(copy.parentBoardId, 'root')
  assert.equal(copy.linkedFolderPath, undefined)
  assert.deepEqual(result.folderPaths, [])
  const portal = result.project.boards[0].nodes.find((item) => item.id === result.portalId)
  assert.equal(portal.boardLinkRole, 'child')
  assert.equal(portal.targetBoardId, copy.id)
  assert.equal(portal.parentColumnId, 'column')
  assert.equal(initial.boards.find((item) => item.id === 'child').parentBoardId, 'root')
})
check('ambiguous memberships, cycles, duplicate IDs and allocation collisions are refused', () => {
  const missing = fixture(); missing.boards[0].nodes.find((item) => item.id === 'image').parentColumnId = 'absent'
  assert.equal(transactions.duplicateBoardSubtree(missing, 'root'), null)
  const cyclic = fixture(); cyclic.boards[0].parentBoardId = 'grandchild'
  assert.equal(transactions.duplicateBoardSubtree(cyclic, 'root'), null)
  const duplicates = fixture(); duplicates.boards[2].nodes[0].id = 'image'
  assert.equal(transactions.duplicateBoardSubtree(duplicates, 'root'), null)
  assert.throws(() => transactions.duplicateBoardSubtree(fixture(), 'root', { idFactory: () => 'root' }), /independent/)
})
check('subtree Trash/restore survives JSON persistence with board/node order and aliases intact', () => {
  const initial = fixture(), before = structuredClone(initial)
  const removed = trash.applyBoardTrash(initial, 'child', 1234)
  assert.ok(removed)
  assert.deepEqual(removed.entry.boards.map((item) => item.id), ['child', 'grandchild'])
  assert.equal(removed.project.boards[0].nodes.some((item) => item.id === 'portal'), false)
  assert.equal(removed.project.boards[1].legacyHiddenChildTiles.nodes.length, 0)
  const restored = trash.applyBoardRestore(canonical(removed.project), canonical(removed.entry))
  assert.deepEqual(canonical(restored), canonical(initial))
  assert.deepEqual(initial, before)
})
check('board restore refuses missing owner, global node collision, missing source catalog and endpoint conflict atomically', () => {
  const removed = trash.applyBoardTrash(fixture(), 'child')
  const missingOwner = structuredClone(removed.project); missingOwner.boards = missingOwner.boards.filter((item) => item.id !== 'root')
  assert.equal(trash.applyBoardRestore(missingOwner, removed.entry), null)
  const conflict = structuredClone(removed.project); conflict.boards[1].nodes.push(node('child-note'))
  assert.equal(trash.applyBoardRestore(conflict, removed.entry), null)
  const missingSource = structuredClone(removed.project); missingSource.assets = []
  assert.equal(trash.applyBoardRestore(missingSource, removed.entry), null)
  const missingEndpoint = structuredClone(removed.project); missingEndpoint.boards[1].nodes = missingEndpoint.boards[1].nodes.filter((item) => item.id !== 'other-note')
  assert.equal(trash.applyBoardRestore(missingEndpoint, removed.entry), null)
})
check('column contents and all touching connectors are one atomic recovery record', () => {
  const initial = fixture(); initial.boards[0].nodes = initial.boards[0].nodes.filter((item) => item.id !== 'portal'); initial.boards[0].connectors = initial.boards[0].connectors.filter((item) => item.id !== 'root-edge')
  const result = trash.applyNodeTrash(initial, 'root', 'column', 999)
  assert.ok(result)
  assert.deepEqual(result.entry.nodes.map((item) => item.id), ['column', 'image'])
  assert.equal(result.boards[0].connectors.length, 0)
  const restored = trash.applyNodeRestore(canonical({ ...initial, boards: result.boards }), canonical(result.entry))
  assert.deepEqual(canonical(restored), canonical(initial))
})
check('selection restore keeps connectors between jointly deleted endpoints', () => {
  const initial = fixture()
  const result = trash.createNodeTrashEntries(initial.boards[0], ['image', 'shape'])
  assert.ok(result)
  assert.equal(result.entries.length, 1)
  const restored = trash.applyNodeRestore({ ...initial, boards: initial.boards.map((item) => item.id === 'root' ? result.board : item) }, result.entries[0])
  assert.deepEqual(canonical(restored), canonical(initial))
})
check('group container deletion detaches kept cards and restores original membership', () => {
  const initial = fixture(), result = trash.applyNodeTrash(initial, 'root', 'group')
  assert.ok(result)
  assert.equal(result.boards[0].nodes.find((item) => item.id === 'shape').groupId, undefined)
  assert.equal(result.entry.nodes.length, 1)
  assert.deepEqual(canonical(trash.applyNodeRestore({ ...initial, boards: result.boards }, result.entry)), canonical(initial))
})
check('node restore refuses conflicts, missing containers and missing connector endpoint', () => {
  const initial = fixture(), result = trash.applyNodeTrash(initial, 'root', 'image')
  const removed = { ...initial, boards: result.boards }
  assert.equal(trash.applyNodeRestore(initial, result.entry), null)
  const missingParent = structuredClone(removed); missingParent.boards[0].nodes = missingParent.boards[0].nodes.filter((item) => item.id !== 'column')
  assert.equal(trash.applyNodeRestore(missingParent, result.entry), null)
  const missingEndpoint = structuredClone(removed); missingEndpoint.boards[0].nodes = missingEndpoint.boards[0].nodes.filter((item) => item.id !== 'shape')
  assert.equal(trash.applyNodeRestore(missingEndpoint, result.entry), null)
})
check('locked children and owning portals cannot be silently deleted through the node path', () => {
  assert.equal(trash.createNodeTrashEntries(fixture().boards[0], ['column']), null)
  const initial = fixture(); initial.boards[0].nodes = initial.boards[0].nodes.filter((item) => item.id !== 'portal'); initial.boards[0].nodes.find((item) => item.id === 'image').locked = true
  assert.equal(trash.applyNodeTrash(initial, 'root', 'column'), null)
})
check('mixed column and vector selection plus owning subtree restore as one transaction', () => {
  const initial = fixture(), before = structuredClone(initial)
  const result = trash.applyCanvasSelectionTrash(initial, 'root', ['column', 'shape'], 555)
  assert.ok(result)
  assert.deepEqual(result.entry.nodes.map((item) => item.id), ['column', 'image', 'portal', 'shape'])
  assert.deepEqual(result.entry.boards.map((item) => item.id), ['child', 'grandchild'])
  assert.equal(result.project.boards.length, 2)
  assert.equal(result.project.boards[0].nodes.some((item) => item.id === 'portal'), false)
  assert.equal(result.project.boards[1].nodes.some((item) => item.id === 'child-alias'), false)
  assert.deepEqual(canonical(trash.applyNodeRestore(canonical(result.project), canonical(result.entry))), canonical(initial))
  assert.deepEqual(initial, before)
})
check('multiple owning portals and their common external edges restore in original order', () => {
  const initial = fixture()
  initial.boards.push(board('sibling', { parentBoardId: 'root', nodes: [node('sibling-note')] }))
  initial.boards[0].nodes.splice(4, 0, node('sibling-portal', 'board-link', { targetBoardId: 'sibling', boardLinkRole: 'child', boardPortal: true }))
  initial.boards[0].connectors.splice(1, 0, connector('portal-pair-edge', 'portal', 'sibling-portal'))
  initial.boards[1].nodes.push(node('sibling-alias', 'board-link', { targetBoardId: 'sibling', boardLinkRole: 'shortcut' }))
  initial.boards[1].connectors.push(connector('aliases-edge', 'child-alias', 'sibling-alias'))
  const removed = trash.applyCanvasSelectionTrash(initial, 'root', ['portal', 'sibling-portal'])
  assert.ok(removed)
  assert.deepEqual(canonical(trash.applyNodeRestore(canonical(removed.project), canonical(removed.entry))), canonical(initial))
})
check('shortcut-only canvas deletion preserves target subtree and all original disk links', () => {
  const initial = fixture(), result = trash.applyCanvasSelectionTrash(initial, 'other', ['child-alias'])
  assert.ok(result)
  assert.equal(result.entry.boards, undefined)
  assert.equal(result.project.boards.length, initial.boards.length)
  assert.equal(result.project.boards.find((item) => item.id === 'child').linkedFolderPath, 'C:/user/custom-original-child-folder')
  assert.deepEqual(canonical(trash.applyNodeRestore(result.project, result.entry)), canonical(initial))
})
check('asset placements, connector order, covers and immutable paths survive full recovery', () => {
  const initial = fixture(); initial.projectCoverAssetId = asset.id; initial.inspectorImageAssetId = asset.id; initial.boards[1].nodes[0].coverAssetId = asset.id
  const removed = trash.applyAssetTrash(initial, asset.id)
  assert.ok(removed)
  assert.equal(removed.project.assets.length, 0)
  assert.deepEqual(canonical(trash.applyAssetRestore(canonical(removed.project), canonical(removed.entry))), canonical(initial))
  const conflict = structuredClone(removed.project); conflict.projectCoverAssetId = 'chosen-after-delete'
  assert.equal(trash.applyAssetRestore(conflict, removed.entry), null, 'restore must not overwrite newly chosen project artwork')
  const missingBoard = structuredClone(removed.project); missingBoard.boards = missingBoard.boards.filter((item) => item.id !== 'grandchild')
  assert.equal(trash.applyAssetRestore(missingBoard, removed.entry), null)
})
check('rich documents round trip and refuse occupied IDs', () => {
  const initial = fixture()
  initial.documents.unshift({ id: 'prior-doc', title: 'Earlier', content: { type: 'doc' } })
  initial.documents.push({ id: 'later-doc', title: 'Later', content: { type: 'doc' } })
  const removed = trash.applyDocumentTrash(initial, 'document')
  assert.deepEqual(trash.applyDocumentRestore(canonical(removed.project), canonical(removed.entry)), canonical(initial))
  assert.equal(trash.applyDocumentRestore(initial, removed.entry), null)
})
check('asset catalog order and group-container membership survive recovery', () => {
  const initial = fixture()
  initial.assets.unshift({ ...asset, id: 'prior-asset' })
  initial.assets.push({ ...asset, id: 'later-asset' })
  initial.boards[0].nodes.find((item) => item.id === 'group').assetId = asset.id
  const removed = trash.applyAssetTrash(initial, asset.id)
  assert.ok(removed)
  assert.equal(removed.project.boards[0].nodes.find((item) => item.id === 'shape').groupId, undefined)
  assert.deepEqual(canonical(trash.applyAssetRestore(canonical(removed.project), canonical(removed.entry))), canonical(initial))
})
check('cross-board move remaps membership policy, keeps internal links and reports external detachment', () => {
  const initial = fixture(), before = structuredClone(initial)
  const moved = transactions.moveNodesBetweenBoards(initial, 'root', 'other', ['group', 'image'], { x: 100, y: 50 })
  assert.ok(moved)
  assert.deepEqual(new Set(moved.movedNodeIds), new Set(['group', 'shape', 'image']))
  const destination = moved.project.boards.find((item) => item.id === 'other')
  assert.equal(destination.nodes.find((item) => item.id === 'shape').groupId, 'group')
  assert.equal(destination.nodes.find((item) => item.id === 'image').parentColumnId, undefined)
  assert.equal(destination.connectors.some((item) => item.id === 'shape-edge'), true)
  assert.deepEqual(moved.detachedConnectorIds, ['root-edge'])
  assert.deepEqual(initial, before)
})
check('owning portal move reparents only target ownership and refuses cycles', () => {
  const initial = fixture()
  const moved = transactions.moveNodesBetweenBoards(initial, 'root', 'other', ['portal'])
  assert.ok(moved)
  assert.equal(moved.project.boards.find((item) => item.id === 'child').parentBoardId, 'other')
  assert.equal(moved.project.boards.find((item) => item.id === 'child').linkedFolderPath, 'C:/user/custom-original-child-folder')
  assert.equal(transactions.moveNodesBetweenBoards(initial, 'root', 'grandchild', ['portal']), null)
  const locked = fixture(); locked.boards[0].nodes.find((item) => item.id === 'shape').locked = true
  assert.equal(transactions.moveNodesBetweenBoards(locked, 'root', 'other', ['group']), null)
})
check('attached-to-free connectors move with selection and translate the free endpoint', () => {
  const initial = fixture()
  initial.boards[0].connectors.push(connector('free-end', 'shape', undefined, { targetPoint: { x: 400, y: 350 } }))
  const result = transactions.moveNodesBetweenBoards(initial, 'root', 'other', ['group'], { x: 50, y: -10 })
  assert.ok(result)
  const free = result.project.boards.find((item) => item.id === 'other').connectors.find((item) => item.id === 'free-end')
  assert.deepEqual(free.targetPoint, { x: 450, y: 340 })
  assert.equal(result.detachedConnectorIds.includes('free-end'), false)
})
console.log(`Board transaction integrity: ${passed} scenarios passed. Fixtures are in memory; no source media or user project changed.`)
