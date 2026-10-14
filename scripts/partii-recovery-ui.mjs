import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const source = ts.transpileModule(await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-recovery')
await mkdir(artifacts, { recursive: true })
const report = { passed: false, generatedAt: new Date().toISOString(), baseUrl, checks: [], screenshots: [], browserErrors: [], limitation: 'Actual React/browser interactions with isolated in-memory Tauri persistence. This does not prove native disk, Vello pixels, physical scaling or source-file hashes.' }
const node = (id, kind = 'note', extra = {}) => ({ id, kind, title: id, x: 500, y: 120, width: 180, height: 110, ...extra })
const edge = (id, sourceId, targetId) => ({ id, sourceId, targetId, sourcePort: 'right', targetPort: 'left', style: 'curve', color: '#c69860', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false, label: id })
const board = (id, title, extra = {}) => ({ id, title, viewport: { x: 0, y: 0, scale: 1 }, nodes: [], connectors: [], ...extra })
const fixture = createBlankProject('Part II recovery UI fixture')
fixture.id = 'partii-recovery-isolated'
fixture.assets = []
fixture.boards = [
  board('fixture-root', 'Fixture root', { linkedFolderPath: `projects/${fixture.id}/boards/fixture-root`, nodes: [node('before-note'), node('fixture-column', 'column', { x: 80, y: 100, width: 300, height: 420, title: 'Fixture column' }), node('column-note', 'note', { x: 90, y: 168, width: 280, height: 100, parentColumnId: 'fixture-column', columnOrder: 0, freeWidth: 180, freeHeight: 100, body: 'Column note body' }), node('child-portal', 'board-link', { title: 'Owned child', x: 90, y: 278, width: 135, height: 135, parentColumnId: 'fixture-column', columnOrder: 1, targetBoardId: 'fixture-child', boardLinkRole: 'child', boardPortal: true }), node('fixture-shape', 'shape', { title: 'Fixture vector', x: 500, y: 380, width: 180, height: 100, color: '#d24545', opacity: 1, shapeType: 'path', vectorPath: { version: 1, closed: true, points: [{ x: 0, y: 100 }, { x: 90, y: 0 }, { x: 180, y: 100 }] } }), node('after-note', 'note', { x: 800, y: 100 })], connectors: [edge('column-shape-link', 'column-note', 'fixture-shape')] }),
  board('fixture-other', 'Other root', { linkedFolderPath: `projects/${fixture.id}/boards/fixture-other`, nodes: [node('external-alias', 'board-link', { targetBoardId: 'fixture-child', boardLinkRole: 'shortcut', title: 'Child shortcut' })] }),
  board('fixture-child', 'Owned child', { parentBoardId: 'fixture-root', nodes: [node('child-note', 'note', { body: 'Child content survives' }), node('grandchild-portal', 'board-link', { targetBoardId: 'fixture-grandchild', boardLinkRole: 'child', boardPortal: true, title: 'Grandchild', x: 100, y: 280, width: 140, height: 128 })] }),
  board('fixture-grandchild', 'Grandchild', { parentBoardId: 'fixture-child', nodes: [node('grandchild-note', 'note', { body: 'Grandchild content survives' })] }),
]
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
page.on('pageerror', (error) => report.browserErrors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())
await page.addInitScript((initial) => {
  const key = '__partii_recovery_backend'
  const path = `projects/${initial.id}/project.json`
  const backend = JSON.parse(sessionStorage.getItem(key) || 'null') || { projects: { [path]: initial }, entries: [], calls: [], failNextProjectSave: false }
  window.__recoveryBackend = backend
  const persist = () => sessionStorage.setItem(key, JSON.stringify(backend))
  persist()
  localStorage.setItem('art-equation.navigator', '1')
  localStorage.setItem('art-equation.inspector', '0')
  localStorage.setItem('art-equation.canvas-tools', '1')
  localStorage.setItem('art-equation.view-mode', 'canvas')
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => 1, unregisterCallback: () => {},
    convertFileSrc: (value) => value,
    invoke: async (command, args = {}) => {
      backend.calls.push({ command, args: structuredClone(args) }); persist()
      if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'isolated-ui', readOnly: false, lockOwned: true }
      if (command === 'list_projects') return Object.values(backend.projects).map((project) => ({ id: project.id, title: project.title, updatedAt: project.updatedAt, boardCount: project.boards.length, assetCount: project.assets.length, status: project.status }))
      if (command === 'load_json') return args.relativePath === 'settings.json' ? { schemaVersion: 5, viewMode: 'canvas', splitRatio: 54, activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'fixture-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:fixture-root', viewMode: 'canvas' } } } : structuredClone(backend.projects[args.relativePath] || null)
      if (command === 'save_json') {
        if (args.relativePath.endsWith('/project.json')) {
          if (backend.failNextProjectSave) { backend.failNextProjectSave = false; persist(); throw new Error('Injected in-memory project save failure') }
          backend.projects[args.relativePath] = structuredClone(args.value); persist()
        }
        return
      }
      if (command === 'record_trash_entry') { backend.entries = backend.entries.filter((item) => item.id !== args.entry.id); backend.entries.push(structuredClone(args.entry)); persist(); return }
      if (command === 'list_project_trash') return structuredClone(backend.entries)
      if (command === 'remove_trash_entry') { backend.entries = backend.entries.filter((item) => item.id !== args.entryId); persist(); return }
      if (command === 'ensure_managed_board_folders' || command === 'ensure_project_workspace' || command === 'plugin:event|unlisten') return
      if (command === 'list_trashed_projects') return []
      if (command === 'audit_assets') return []
      if (command === 'plugin:event|listen') return 1
      if (command === 'plugin:window|scale_factor') return 1
      if (command === 'plugin:window|inner_size') return { width: 1600, height: 1000 }
      if (command === 'mini_bridge_launch') return null
      throw new Error(`Isolated browser mock does not permit ${command}`)
    },
  }
}, fixture)
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
const check = (name, passed, detail) => { report.checks.push({ name, passed: Boolean(passed), detail }); assert(passed, `${name}${detail ? `: ${detail}` : ''}`) }
const snapshot = () => page.evaluate((id) => structuredClone(window.__recoveryBackend.projects[`projects/${id}/project.json`]), fixture.id)
const entries = () => page.evaluate(() => structuredClone(window.__recoveryBackend.entries))
const byId = (id) => page.locator(`.board-node[data-node-id="${id}"]`)
const screenshot = async (name) => { await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true }); report.screenshots.push(`${name}.png`) }
async function save() {
  const before = await page.evaluate(() => window.__recoveryBackend.calls.filter((item) => item.command === 'save_json' && item.args.relativePath?.endsWith('/project.json')).length)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction((count) => window.__recoveryBackend.calls.filter((item) => item.command === 'save_json' && item.args.relativePath?.endsWith('/project.json')).length > count, before)
  await settled()
  return snapshot()
}
async function trashSelection() {
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => window.__recoveryBackend.entries.length > 0)
  await settled()
}
async function openTrash() { await page.getByTestId('trash-button').click(); await page.getByTestId('trash-viewer').waitFor(); await settled() }
async function closeTrash() { await page.getByTestId('trash-viewer').getByRole('button', { name: 'Close', exact: true }).click(); await settled() }
const stable = (project) => project.boards.map((item) => ({ id: item.id, parentBoardId: item.parentBoardId, title: item.title, nodes: item.nodes, connectors: item.connectors, linkedFolderPath: item.linkedFolderPath }))
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await byId('fixture-column').waitFor()
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await settled()
  const original = await save()
  check('fixture loads into actual canvas with four owned/root boards', original.boards.length === 4 && await byId('child-portal').count() === 1)
  await byId('fixture-column').locator('.column-header').click({ force: true })
  await byId('fixture-shape').locator('.shape-hit-area').click({ force: true, modifiers: ['Shift'] })
  check('mixed column/vector selection is visible', await byId('fixture-column').evaluate((item) => item.classList.contains('selected')) && await byId('fixture-shape').evaluate((item) => item.classList.contains('selected')))
  await trashSelection()
  const removed = await save(), records = await entries()
  check('one mixed selection creates one Trash record including full child tree', records.length === 1 && records[0].nodes.length === 4 && records[0].boards.length === 2)
  check('mixed deletion removes both owned boards and external shortcut', removed.boards.length === 2 && !removed.boards.find((item) => item.id === 'fixture-other').nodes.length)
  await screenshot('01-mixed-selection-in-trash')
  await page.locator('.canvas-tool-rail').getByLabel('Undo board change').click(); await settled()
  check('Undo restores complete board ownership and exact array ordering', JSON.stringify(stable(await save())) === JSON.stringify(stable(original)))
  await page.locator('.canvas-tool-rail').getByLabel('Redo board change').click(); await settled()
  check('Redo removes the complete graph again', JSON.stringify(stable(await save())) === JSON.stringify(stable(removed)))
  await openTrash()
  const restoreCallStart = await page.evaluate(() => window.__recoveryBackend.calls.length)
  await page.getByTestId('trash-viewer').getByRole('button', { name: /Restore/ }).click()
  await page.waitForFunction(() => window.__recoveryBackend.entries.length === 0)
  await settled()
  check('Restore restores original nodes, connectors and ordering', JSON.stringify(stable(await snapshot())) === JSON.stringify(stable(original)))
  const restoreCalls = (await page.evaluate(() => window.__recoveryBackend.calls)).slice(restoreCallStart)
  const savedAt = restoreCalls.findIndex((item) => item.command === 'save_json' && item.args.relativePath?.endsWith('/project.json'))
  const clearedAt = restoreCalls.findIndex((item) => item.command === 'remove_trash_entry')
  check('restored project saves before its recovery record clears', savedAt >= 0 && clearedAt > savedAt && JSON.stringify(stable(restoreCalls[savedAt].args.value)) === JSON.stringify(stable(original)))
  await closeTrash()
  await page.reload({ waitUntil: 'domcontentloaded' }); await byId('fixture-column').waitFor(); await settled()
  check('in-memory restart preserves restored child content and ownership', JSON.stringify(stable(await save())) === JSON.stringify(stable(original)))
  await screenshot('02-restored-tree-after-restart')

  const rootRow = page.locator('.tree-row-wrap').filter({ has: page.getByRole('button', { name: /Fixture root/ }) }).first()
  await rootRow.click({ button: 'right' })
  await page.getByRole('menu', { name: 'Actions for Fixture root' }).getByRole('menuitem', { name: 'Duplicate board', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.canvas-stage') && [...document.querySelectorAll('.tree-row')].some((item) => item.textContent.includes('Fixture root copy')))
  await settled()
  const duplicated = await save()
  const newBoards = duplicated.boards.filter((item) => !original.boards.some((old) => old.id === item.id))
  const copiedRoot = newBoards.find((item) => item.title === 'Fixture root copy')
  check('actual Duplicate action creates root plus independent owned subtree', newBoards.length === 3 && copiedRoot && newBoards.find((item) => item.title === 'Owned child').parentBoardId === copiedRoot.id)
  const copiedColumn = copiedRoot.nodes.find((item) => item.title === 'Fixture column')
  const copiedNote = copiedRoot.nodes.find((item) => item.title === 'column-note')
  const copiedPortal = copiedRoot.nodes.find((item) => item.targetBoardId === newBoards.find((board) => board.title === 'Owned child').id)
  check('actual Duplicate remaps column memberships, portal targets and connectors', copiedNote.parentColumnId === copiedColumn.id && copiedPortal.parentColumnId === copiedColumn.id && copiedRoot.connectors.every((item) => copiedRoot.nodes.some((node) => node.id === item.sourceId) && copiedRoot.nodes.some((node) => node.id === item.targetId)))
  check('duplicate IDs and managed folders differ from original', newBoards.every((item) => !original.boards.some((old) => old.id === item.id)) && copiedRoot.linkedFolderPath !== original.boards[0].linkedFolderPath && newBoards.filter((item) => item.parentBoardId).every((item) => !item.linkedFolderPath))
  check('original graph remains unchanged by Duplicate', JSON.stringify(stable({ boards: duplicated.boards.filter((item) => original.boards.some((old) => old.id === item.id)) })) === JSON.stringify(stable(original)))
  await screenshot('03-deep-duplicate-membership')

  await byId(copiedRoot.nodes.find((item) => item.kind === 'shape').id).locator('.shape-hit-area').click({ force: true })
  const beforeOrdinary = await save()
  await trashSelection(); const ordinaryRemoved = await save()
  await page.locator('.canvas-tool-rail').getByLabel('Undo board change').click(); await settled()
  check('ordinary Trash Undo restores the selected vector', JSON.stringify(stable(await save())) === JSON.stringify(stable(beforeOrdinary)))
  await page.locator('.canvas-tool-rail').getByLabel('Redo board change').click(); await settled()
  const afterOrdinary = await save()
  check('ordinary Trash Redo removes the selected vector again', JSON.stringify(stable(afterOrdinary)) === JSON.stringify(stable(ordinaryRemoved)))
  const record = (await entries())[0]
  // Inject a missing endpoint into the persisted recovery record, never app state.
  // It exercises actual Restore rejection rather than a pure helper invocation.
  await page.evaluate(() => { const record = window.__recoveryBackend.entries[0]; record.nodeConnectors[0].sourceId = 'missing-endpoint'; sessionStorage.setItem('__partii_recovery_backend', JSON.stringify(window.__recoveryBackend)) })
  // Reload/refetch so the visible recovery item is the fault-injected snapshot.
  await page.reload({ waitUntil: 'domcontentloaded' }); await byId('fixture-column').waitFor(); await settled()
  await openTrash()
  await page.getByTestId('trash-viewer').getByRole('button', { name: /Restore/ }).click()
  await page.getByRole('contentinfo').getByText('Recovery was not applied:', { exact: false }).waitFor()
  await screenshot('04-invalid-restore-retained')
  check('invalid restore leaves current project and recovery record unchanged', JSON.stringify(stable(await save())) === JSON.stringify(stable(afterOrdinary)) && (await entries()).length === 1)
  await page.evaluate((originalRecord) => { window.__recoveryBackend.entries[0] = originalRecord; sessionStorage.setItem('__partii_recovery_backend', JSON.stringify(window.__recoveryBackend)) }, record)
  await page.reload({ waitUntil: 'domcontentloaded' }); await byId('fixture-column').waitFor(); await settled()
  await openTrash()
  await page.evaluate(() => { window.__recoveryBackend.failNextProjectSave = true })
  await page.getByTestId('trash-viewer').getByRole('button', { name: /Restore/ }).click()
  await page.getByRole('contentinfo').getByText('Recovery could not finish', { exact: false }).waitFor()
  check('project-save failure retains recovery copy and visible current graph', (await entries()).length === 1 && JSON.stringify(stable(await save())) === JSON.stringify(stable(afterOrdinary)))
  await openTrash()
  await page.getByTestId('trash-viewer').getByRole('button', { name: /Restore/ }).click()
  await page.waitForFunction(() => window.__recoveryBackend.entries.length === 0)
  await settled()
  check('retry after failed save restores vector successfully', JSON.stringify(stable(await snapshot())) === JSON.stringify(stable(beforeOrdinary)))
  check('browser raised no unhandled errors', report.browserErrors.length === 0, JSON.stringify(report.browserErrors))
  report.passed = true
} catch (error) {
  report.error = String(error)
  await screenshot('failure').catch(() => undefined)
  console.error(error)
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
