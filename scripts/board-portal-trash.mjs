import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const projectUrl = dataUrl(await source('../src/model/project.ts'))
const hierarchy = await import(dataUrl(await source('../src/board/boardHierarchy.ts')))
const trash = await import(dataUrl((await source('../src/model/trash.ts')).replace("from './project'", `from '${projectUrl}'`)))

const root = { id: 'root', title: 'Main board', viewport: { x: 0, y: 0, scale: 1 }, nodes: [], connectors: [] }
const initial = { id: 'test', boards: [root], documents: [], assets: [] }
const first = hierarchy.insertNestedBoard(initial, root.id, 'Illustrations')
assert.ok(first)
assert.equal(first.project.boards.length, 2)
assert.equal(first.project.boards[0].nodes[0].boardPortal, true)
assert.equal(first.project.boards[0].nodes[0].targetBoardId, first.boardId)
assert.equal(hierarchy.withoutLegacyChildTiles(first.project.boards)[0].nodes.length, 1, 'owning portal survives legacy cleanup')

const withContent = { ...first.project, boards: first.project.boards.map((board) => board.id === first.boardId
  ? { ...board, nodes: [{ id: 'image', kind: 'image', title: 'Reference', x: 8, y: 9, width: 200, height: 120 }] }
  : board) }
const second = hierarchy.insertNestedBoard(withContent, first.boardId, 'Fonts')
assert.ok(second)
const trashed = trash.applyBoardTrash(second.project, first.boardId)
assert.ok(trashed)
assert.equal(trashed.entry.boards.length, 2, 'child and grandchild are snapshotted together')
assert.equal(trashed.project.boards.length, 1)
assert.equal(trashed.project.boards[0].nodes.length, 0, 'owning portal leaves parent canvas')
assert.equal(trashed.entry.boardLinks[0].nodes[0].id, first.portalId)

const restored = trash.applyBoardRestore(trashed.project, trashed.entry)
assert.ok(restored)
assert.equal(restored.boards.length, 3)
assert.equal(restored.boards[0].nodes[0].id, first.portalId, 'same portal is restored')
assert.equal(restored.boards.find((board) => board.id === first.boardId).nodes.some((node) => node.id === 'image'), true, 'child content survives')
assert.equal(restored.boards.find((board) => board.id === second.boardId).parentBoardId, first.boardId)
console.log('Board portal subtree Trash/restore: passed')
