import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const asDataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

const hierarchyUrl = asDataUrl(transpile(await readFile('src/board/boardHierarchy.ts', 'utf8')))
const searchModelSource = transpile(await readFile('src/search/projectSearchModel.ts', 'utf8'))
  .replace("from '../board/boardHierarchy'", `from '${hierarchyUrl}'`)
const { searchProject } = await import(asDataUrl(searchModelSource))

console.log('Testing Package D: Search Return & Transient View Restoration...')

// 1. Fixture setup
const testProject = {
  id: 'proj-001',
  title: 'Art Equation Showcase',
  boards: [
    {
      id: 'board-main',
      title: 'Main Canvas',
      parentBoardId: null,
      viewport: { x: 100, y: 50, scale: 1.2 },
      nodes: [
        { id: 'node-char', kind: 'text', x: 200, y: 300, width: 150, height: 80, title: 'Character Sheet', body: 'Rainee protagonist design' },
        { id: 'node-env', kind: 'card', x: 500, y: 400, width: 200, height: 120, title: 'Environment Blockout', body: 'Club scene cyberpunk vibe' },
      ],
      connectors: [],
    },
    {
      id: 'board-secondary',
      title: 'Color Palette Board',
      parentBoardId: null,
      viewport: { x: 0, y: 0, scale: 1.0 },
      nodes: [
        { id: 'node-swatches', kind: 'swatches', x: 50, y: 50, width: 100, height: 100, title: 'Neon Swatches', body: 'Electric blue and amber' },
      ],
      connectors: [],
    },
  ],
  documents: [
    {
      id: 'project-brief',
      title: 'Project brief',
      content: { type: 'doc', content: [{ type: 'paragraph', text: 'Core game direction' }] },
      locked: true,
      system: true,
    },
    {
      id: 'doc-narrative',
      title: 'Narrative Storyboard',
      content: { type: 'doc', content: [{ type: 'paragraph', text: 'Act 1 introduction scene script' }] },
    },
  ],
  assets: [
    { id: 'asset-rainee', displayName: 'Rainee Render', extension: 'png', aliases: ['hero'], tags: ['character'] },
  ],
  worksheets: [
    { date: '2026-09-30', notesHtml: '<p>Sprint tasks</p>', tasks: [{ id: 'task-1', text: 'Fix canvas overlay', completed: true }] },
  ],
  recipeSnapshots: [
    { id: 'rec-1', title: 'Cyberpunk Shader Workflow' },
  ],
  promptHistory: [
    { id: 'prompt-1', prompt: 'Atmospheric rain lighting prompt', mode: 'image', targetModel: 'imagen' },
  ],
  referenceLibraries: [
    { id: 'lib-1', name: 'Tokyo Night References' },
  ],
  referenceCrops: [
    { id: 'crop-1', title: 'Alleyway Crop' },
  ],
}

// 2. Test searchProject queries
const searchHits = searchProject(testProject, 'Rainee')
assert(searchHits.length >= 2, 'Finds matches across nodes and assets')
assert(searchHits.some((h) => h.kind === 'board' && h.nodeId === 'node-char'), 'Finds character node match')
assert(searchHits.some((h) => h.kind === 'assets' && h.id === 'asset-rainee'), 'Finds character asset match')

const docHits = searchProject(testProject, 'narrative')
assert.equal(docHits.length, 1, 'Finds narrative document match')
assert.equal(docHits[0].kind, 'document')
assert.equal(docHits[0].id, 'doc-narrative')

const recipeHits = searchProject(testProject, 'cyberpunk')
assert(recipeHits.some((h) => h.kind === 'recipes' && h.id === 'rec-1'), 'Finds recipe match')

console.log('Search queries validation: PASS')

// 3. Transient View Origin Simulation & Restoration Harness
class StudioViewSimulator {
  constructor(initialProject) {
    this.project = structuredClone(initialProject)
    this.mode = 'document'
    this.activeBoardId = 'board-main'
    this.activeDocumentId = 'doc-narrative'
    this.activeNavigatorItem = 'document:doc-narrative'
    this.activeEditor = 'document'
    this.historyOwner = 'document'
    this.showNavigatorPanel = true
    this.showInspectorPanel = false
    this.canvasSelection = null
    this.documentView = {
      showOutline: true,
      showInspector: false,
      focusMode: false,
      selection: { from: 10, to: 25 },
    }
    this.searchOrigin = null
    this.historyEntries = []
    this.status = ''
  }

  captureSearchOrigin() {
    const activeDoc = this.project.documents.find((d) => d.id === this.activeDocumentId)
    const activeBoard = this.project.boards.find((b) => b.id === this.activeBoardId)
    let originTitle = 'Workspace'
    if (this.mode === 'document') {
      originTitle = activeDoc?.title || 'Document'
    } else if (this.mode === 'canvas') {
      originTitle = activeBoard?.title || 'Board'
    } else {
      originTitle = this.activeEditor === 'document' ? (activeDoc?.title || 'Document') : (activeBoard?.title || 'Board')
    }

    return {
      projectId: this.project.id,
      mode: this.mode,
      activeBoardId: this.activeBoardId,
      activeDocumentId: this.activeDocumentId,
      activeNavigatorItem: this.activeNavigatorItem,
      activeEditor: this.activeEditor,
      historyOwner: this.historyOwner,
      showNavigatorPanel: this.showNavigatorPanel,
      showInspectorPanel: this.showInspectorPanel,
      canvasSelection: this.canvasSelection ? structuredClone(this.canvasSelection) : null,
      documentView: this.documentView ? structuredClone(this.documentView) : undefined,
      originTitle,
    }
  }

  onNavigateFromSearch(kind, id, nodeId) {
    // Repeated search policy: Retain FIRST origin
    if (!this.searchOrigin) {
      this.searchOrigin = this.captureSearchOrigin()
    }

    if (kind === 'board') {
      this.activeBoardId = id
      this.activeNavigatorItem = `board:${id}`
      this.activeEditor = 'canvas'
      this.historyOwner = 'canvas'
      this.mode = 'split'
      if (nodeId) {
        this.canvasSelection = { boardId: id, ids: [nodeId] }
      }
    } else if (kind === 'document') {
      this.activeDocumentId = id
      this.activeNavigatorItem = `document:${id}`
      this.activeEditor = 'document'
      this.historyOwner = id === 'project-brief' ? 'none' : 'document'
      this.mode = 'document'
    }
  }

  returnFromSearch() {
    if (!this.searchOrigin) return
    const snapshot = this.searchOrigin
    if (snapshot.projectId !== this.project.id) {
      this.searchOrigin = null
      return
    }

    const targetBoard = this.project.boards.find((b) => b.id === snapshot.activeBoardId)
    const targetDoc = this.project.documents.find((d) => d.id === snapshot.activeDocumentId)

    if (snapshot.mode === 'canvas' && !targetBoard) {
      this.searchOrigin = null
      this.status = `Cannot return: "${snapshot.originTitle}" board is no longer available`
      return
    }
    if (snapshot.mode === 'document' && !targetDoc) {
      this.searchOrigin = null
      this.status = `Cannot return: "${snapshot.originTitle}" document is no longer available`
      return
    }
    if (snapshot.mode === 'split' && !targetBoard && !targetDoc) {
      this.searchOrigin = null
      this.status = 'Cannot return: origin workspace targets are no longer available'
      return
    }

    if (targetBoard) {
      this.activeBoardId = snapshot.activeBoardId
      if (snapshot.canvasSelection && snapshot.canvasSelection.boardId === snapshot.activeBoardId) {
        const validIds = snapshot.canvasSelection.ids.filter((id) => targetBoard.nodes.some((node) => node.id === id))
        this.canvasSelection = { boardId: snapshot.activeBoardId, ids: validIds }
      }
    }

    if (targetDoc) {
      this.activeDocumentId = snapshot.activeDocumentId
      if (snapshot.documentView) {
        this.documentView = structuredClone(snapshot.documentView)
      }
    }

    this.mode = snapshot.mode
    this.activeEditor = snapshot.activeEditor
    this.historyOwner = snapshot.historyOwner
    this.showNavigatorPanel = snapshot.showNavigatorPanel
    this.showInspectorPanel = snapshot.showInspectorPanel

    if (snapshot.activeNavigatorItem.startsWith('board:') && targetBoard) {
      this.activeNavigatorItem = snapshot.activeNavigatorItem
    } else if (snapshot.activeNavigatorItem.startsWith('document:') && targetDoc) {
      this.activeNavigatorItem = snapshot.activeNavigatorItem
    }

    this.searchOrigin = null
    this.status = `Returned to ${snapshot.originTitle}`
  }
}

// 4. Test Scenario A: Document Origin -> Search Board Match -> Return
{
  const sim = new StudioViewSimulator(testProject)
  assert.equal(sim.mode, 'document')
  assert.equal(sim.activeDocumentId, 'doc-narrative')
  assert.equal(sim.searchOrigin, null)

  // Navigate to board search result
  sim.onNavigateFromSearch('board', 'board-main', 'node-char')
  assert.equal(sim.mode, 'split')
  assert.equal(sim.activeBoardId, 'board-main')
  assert.deepEqual(sim.canvasSelection, { boardId: 'board-main', ids: ['node-char'] })
  assert.notEqual(sim.searchOrigin, null)
  assert.equal(sim.searchOrigin.originTitle, 'Narrative Storyboard')
  assert.equal(sim.searchOrigin.mode, 'document')

  // Return
  sim.returnFromSearch()
  assert.equal(sim.mode, 'document', 'Restores document mode')
  assert.equal(sim.activeDocumentId, 'doc-narrative', 'Restores active document')
  assert.equal(sim.activeEditor, 'document')
  assert.equal(sim.historyOwner, 'document')
  assert.equal(sim.documentView.selection.from, 10, 'Restores document selection')
  assert.equal(sim.searchOrigin, null, 'Clears searchOrigin')
  assert.equal(sim.status, 'Returned to Narrative Storyboard')
}

// 5. Test Scenario B: Multi-step browsing retains FIRST origin
{
  const sim = new StudioViewSimulator(testProject)
  sim.mode = 'canvas'
  sim.activeBoardId = 'board-secondary'
  sim.activeNavigatorItem = 'board:board-secondary'
  sim.activeEditor = 'canvas'
  sim.historyOwner = 'canvas'
  sim.canvasSelection = { boardId: 'board-secondary', ids: ['node-swatches'] }

  // First search jump -> board-main
  sim.onNavigateFromSearch('board', 'board-main', 'node-char')
  assert.equal(sim.searchOrigin.originTitle, 'Color Palette Board')
  assert.equal(sim.searchOrigin.activeBoardId, 'board-secondary')

  // Second search jump while browsing -> doc-narrative
  sim.onNavigateFromSearch('document', 'doc-narrative')
  assert.equal(sim.searchOrigin.originTitle, 'Color Palette Board', 'Retains original starting work area')
  assert.equal(sim.searchOrigin.activeBoardId, 'board-secondary')

  // Third search jump -> project-brief (questionnaire)
  sim.onNavigateFromSearch('document', 'project-brief')
  assert.equal(sim.searchOrigin.originTitle, 'Color Palette Board', 'Still retains first origin')

  // Return to origin
  sim.returnFromSearch()
  assert.equal(sim.mode, 'canvas', 'Restores canvas mode')
  assert.equal(sim.activeBoardId, 'board-secondary', 'Restores original board')
  assert.deepEqual(sim.canvasSelection, { boardId: 'board-secondary', ids: ['node-swatches'] }, 'Restores original canvas selection')
  assert.equal(sim.searchOrigin, null)
}

// 6. Test Scenario C: Deleted origin fails gracefully without crashing or resurrecting
{
  const sim = new StudioViewSimulator(testProject)
  sim.onNavigateFromSearch('board', 'board-main', 'node-char')
  assert(sim.searchOrigin)

  // Simulate deletion of origin document while browsing
  sim.project.documents = sim.project.documents.filter((d) => d.id !== 'doc-narrative')

  // Attempt return
  assert.doesNotThrow(() => sim.returnFromSearch(), 'Gracefully handles deleted origin')
  assert.equal(sim.searchOrigin, null, 'Clears invalid origin')
  assert(sim.status.includes('no longer available'), 'Provides truthful status notice')
  assert.equal(sim.activeBoardId, 'board-main', 'Remains at safe current location without corrupting state')
}

// 7. Test Scenario D: View return NEVER mutates project content or history
{
  const sim = new StudioViewSimulator(testProject)
  const initialContentBefore = structuredClone(sim.project.documents[1].content)
  const initialNodeGeometryBefore = structuredClone(sim.project.boards[0].nodes[0])

  sim.onNavigateFromSearch('board', 'board-main', 'node-char')
  // Mutate node during session
  sim.project.boards[0].nodes[0].x = 999
  sim.returnFromSearch()

  // Node x remains 999 - Return is strictly transient view restoration, NOT model rewind!
  assert.equal(sim.project.boards[0].nodes[0].x, 999, 'Model edits are preserved, not rewound')
  assert.deepEqual(sim.project.documents[1].content, initialContentBefore, 'Document content intact')
  assert.equal(sim.historyEntries.length, 0, 'No undo history entries created by view return')
}

console.log('Search Return & Transient View Restoration test suite: ALL 4 SCENARIOS PASSED')
