import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import ts from 'typescript'

// Real save/load/journal helpers and board history with controlled IPC. Native
// atomic IO and full App UI remain separate runtime gates; no live disk writes.
const paths = ['src/storage/workspace.ts', 'src/model/project.ts', 'src/board/nativeCommandJournal.ts']
const sources = await Promise.all(paths.map(path => readFile(path, 'utf8')))
const hashes = Object.fromEntries(paths.map((path, i) => [path, createHash('sha256').update(sources[i]).digest('hex')]))
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = i => ts.transpileModule(sources[i], { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const modelUrl = url(compile(1)), ipcUrl = url('export const invoke=(...args)=>globalThis.__p0AcceptanceInvoke(...args)')
const storageUrl = url(compile(0).replace(/from ['"]@tauri-apps\/api\/core['"]/g, `from '${ipcUrl}'`).replace(/from ['"]\.\.\/model\/project['"]/g, `from '${modelUrl}'`))
const storage = await import(storageUrl), history = await import(url(compile(2))), model = await import(modelUrl)
const report = { schema: 'art-equation.workspace-acceptance', generatedAt: new Date().toISOString(), passed: false, sourceHashes: hashes, checks: [], limitations: ['Actual TypeScript storage/history helpers run against a controlled in-memory IPC transport. This does not certify Rust atomic writes, full App gestures, WebView2 origin/storage/profile, native undo/save/reopen or accessibility.'] }
const check = async (name, run) => { await run(); report.checks.push(name); console.log('PASS ' + name) }
const prior = Object.getOwnPropertyDescriptor(globalThis, '__p0AcceptanceInvoke')
const files = new Map(), events = []; let failFolders = false, failSave = false
Object.defineProperty(globalThis, '__p0AcceptanceInvoke', { configurable: true, value: async (command, args) => {
  events.push({ command, args: structuredClone(args) })
  if (command === 'ensure_managed_board_folders') { if (failFolders) throw new Error('managed folders denied'); return }
  if (command === 'save_json') { if (failSave) throw new Error('storage full'); files.set(args.relativePath, JSON.stringify(args.value)); return }
  if (command === 'load_json') { if (!files.has(args.relativePath)) throw new Error('not found'); return JSON.parse(files.get(args.relativePath)) }
  throw new Error('Unaccepted IPC command: ' + command)
} })
const deepFreeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value) } return value }
let project = model.createBlankProject('P0 disposable storage oracle')
project.id = 'p0-storage-oracle'
project.boards = [{ id: 'root', title: 'Artwork', nodes: [{ id: 'path', kind: 'shape', shapeType: 'path', title: 'Curve', x: 12.5, y: -20, width: 120, height: 80, color: '#aabbcc80', strokeColor: '#123456', opacity: .75, rotation: 30, vectorFillRule: 'evenodd', vectorStrokeJoin: 'round', vectorStrokeCap: 'square', vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 0, handleIn: { x: -20, y: 2 } }, { x: 100, y: 0, handleOut: { x: 10, y: 40 } }, { x: 60, y: 80 }] } }], connectors: [], viewport: { x: 22, y: 18, scale: 1.25 } }, { id: 'child', title: 'Child', parentBoardId: 'root', nodes: [], connectors: [], viewport: { x: 0, y: 0, scale: 1 } }]
project.documents = [{ id: 'doc', title: 'Rich document', layout: { ...model.DEFAULT_DOCUMENT_LAYOUT, columns: 2 }, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '日本語 café العربية', marks: [{ type: 'bold' }] }] }] } }]
project = deepFreeze(project)
const original = JSON.stringify(project), expected = model.withRequiredBoardFolderLinks(project)
try {
  await check('save creates managed root folder before publishing project JSON', async () => { await storage.saveProject(project); assert.equal(events[0].command, 'ensure_managed_board_folders'); assert.deepEqual(events[0].args, { projectId: project.id, boardIds: ['root'] }); assert.equal(events[1].command, 'save_json'); assert.equal(events[1].args.relativePath, 'projects/p0-storage-oracle/project.json') })
  await check('save leaves canonical project immutable and stores only linked canonical data', async () => { assert.equal(JSON.stringify(project), original); assert.deepEqual(events[1].args.value, expected); assert(!files.get('projects/p0-storage-oracle/project.json').includes('completePaint')); assert(!files.get('projects/p0-storage-oracle/project.json').includes('resourceEpoch')) })
  await check('load returns exact saved vectors, styled text and hierarchy', async () => { const loaded = await storage.loadProject(project.id); assert.deepEqual(loaded, expected); assert.equal(loaded.boards[0].nodes[0].vectorPath.points[0].handleIn.x, -20); assert.deepEqual(loaded.documents[0], project.documents[0]) })
  await check('missing project returns null through storage helper', async () => assert.equal(await storage.loadProject('missing-disposable'), null))
  await check('managed-folder failure prevents project write and retains canonical input', async () => { const start = events.length; failFolders = true; try { await assert.rejects(storage.saveProject(project), /managed folders denied/); assert.equal(events.slice(start).filter(e => e.command === 'save_json').length, 0); assert.equal(JSON.stringify(project), original) } finally { failFolders = false } })
  await check('save failure rejects rather than reporting success or mutating canonical data', async () => { failSave = true; try { await assert.rejects(storage.saveProject(project), /storage full/); assert.equal(JSON.stringify(project), original); assert.equal(files.get('projects/p0-storage-oracle/project.json'), JSON.stringify(expected)) } finally { failSave = false } })
  await check('journal names remain inside project journal folder', async () => { await storage.saveProjectJournal(project.id, '../unexpected:/name', { event: 'completed-gesture' }); const event = events.at(-1); assert.equal(event.args.relativePath, 'projects/p0-storage-oracle/journal/.._unexpected__name.json'); assert.equal(event.command, 'save_json') })
  await check('completed gesture history survives complete undo and redo without altering authored path', async () => { const undo = [], redo = [], initial = project.boards[0], moved = { ...initial, nodes: initial.nodes.map(n => ({ ...n, x: n.x + 60, y: n.y + 40 })) }; history.recordNativeCommand(undo, redo, initial, moved); assert.deepEqual(history.undoNativeCommand(undo, redo), initial); assert.deepEqual(history.redoNativeCommand(undo, redo), moved); const after = { ...project, boards: [moved, project.boards[1]] }; await storage.saveProject(after); const reopened = await storage.loadProject(project.id); assert.deepEqual(reopened.boards[0].nodes, moved.nodes); assert.deepEqual(reopened.boards[0].nodes[0].vectorPath, initial.nodes[0].vectorPath); assert.equal(JSON.stringify(project), original) })
  await check('new edit after undo invalidates redo and history retention stays bounded', async () => { const undo = [], redo = [], board = project.boards[0]; for (let i = 0; i < 100; i++) history.recordNativeCommand(undo, redo, board, { ...board, title: String(i) }); assert.equal(undo.length, 50); history.undoNativeCommand(undo, redo); assert.equal(redo.length, 1); history.recordNativeCommand(undo, redo, board, board); assert.equal(redo.length, 0); assert.equal(undo.length, 50) })
  const after = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
  await check('accepted source hashes remain unchanged throughout run', async () => assert.deepEqual(after, hashes))
  report.passed = true
} catch (error) { report.error = error.message; process.exitCode = 1 }
finally { if (prior) Object.defineProperty(globalThis, '__p0AcceptanceInvoke', prior); else delete globalThis.__p0AcceptanceInvoke }
if (process.argv[2]) { const output = resolve(process.argv[2]); await mkdir(output, { recursive: true }); await writeFile(resolve(output, 'WORKSPACE_SOURCE_ACCEPTANCE.json'), JSON.stringify(report, null, 2)) }
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, ...(report.error ? { error: report.error } : {}) }))
