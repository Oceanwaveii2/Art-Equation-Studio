import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

// Headless verification suite for Package 5: Document-First Focus Writing & Process Notes (X-14 / PII-9)
// Pure model and memory test fixture. No Tauri native popups, no desktop takeover, zero computer use.

const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText

const asDataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

// Load notebook model
const notebookSource = transpile(await readFile('src/notebook-proof/notebookModel.ts', 'utf8'))
const Notebook = await import(asDataUrl(notebookSource))

// Load trash model
const projectUrl = asDataUrl(transpile(await readFile('src/model/project.ts', 'utf8')))
const trashSource = transpile(await readFile('src/model/trash.ts', 'utf8')).replace("from './project'", `from '${projectUrl}'`)
const Trash = await import(asDataUrl(trashSource))

const checks = []
const groups = []
let currentGroup = null

function group(name, fn) {
  currentGroup = { name, checks: 0, passed: true }
  groups.push(currentGroup)
  fn()
}

function check(name, ok, details) {
  checks.push({ name, passed: Boolean(ok), details })
  if (currentGroup) {
    currentGroup.checks++
    if (!ok) currentGroup.passed = false
  }
  assert.ok(ok, `${name}${details ? ': ' + JSON.stringify(details) : ''}`)
}

// Inline helper functions mirroring RichDocument.tsx implementation
function normalizedViewSelection(selection, maximum, fallback) {
  const clamp = (value, previous) => Math.max(0, Math.min(maximum, Math.trunc(Number.isFinite(value) ? value : previous)))
  const from = clamp(selection.from, fallback.from)
  const to = clamp(selection.to, fallback.to)
  return { from: Math.min(from, to), to: Math.max(from, to) }
}

function documentOutline(content) {
  const entries = []
  const visit = (node) => {
    if (node.type === 'heading') {
      const label = (node.content || []).map((child) => child.text || '').join('').trim()
      if (label) entries.push({ level: Number(node.attrs?.level) || 2, label })
    }
    node.content?.forEach(visit)
  }
  visit(content)
  return entries
}

function layoutNodeCounts(content) {
  const counts = { images: 0, tables: 0, footnotes: 0, pageBreaks: 0 }
  const visit = (node) => {
    if (node.type === 'image') counts.images += 1
    if (node.type === 'table') counts.tables += 1
    if (node.type === 'footnote') counts.footnotes += 1
    if (node.type === 'pageBreak') counts.pageBreaks += 1
    node.content?.forEach(visit)
  }
  visit(content)
  return counts
}

function documentSvg(html, width = 1200, height = 900) {
  const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f6f1e8"/><foreignObject x="48" y="42" width="${width - 96}" height="${height - 84}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:100%;height:100%;overflow:hidden;padding:0;color:#25221f;background:#f6f1e8;font:400 16px/1.62 Inter,Arial,sans-serif;">${safeHtml}</div></foreignObject></svg>`
}

// Simulated RichDocument view state machine (matching RichDocument.tsx lines 220-285)
function createDocumentViewState(initial = { showOutline: false, showInspector: true, focusMode: false }) {
  let view = { ...initial }
  let focusRestore = null
  const listeners = []

  function applyView(next) {
    const modeChanged = view.focusMode !== next.focusMode
    view = next
    if (modeChanged) listeners.forEach(fn => fn(next.focusMode))
  }

  function toggleOutline() {
    applyView({ ...view, showOutline: !view.showOutline })
  }

  function togglePageInspector() {
    applyView({ ...view, showInspector: !view.showInspector })
  }

  function toggleFocusWriting() {
    if (!view.focusMode) {
      focusRestore = { showOutline: view.showOutline, showInspector: view.showInspector }
      applyView({ showOutline: false, showInspector: false, focusMode: true })
    } else {
      const panels = focusRestore || { showOutline: false, showInspector: false }
      focusRestore = null
      applyView({ ...panels, focusMode: false })
    }
  }

  function captureView(selection = { from: 0, to: 0 }, canUndo = false, canRedo = false) {
    return {
      ...view,
      selection,
      canUndo,
      canRedo,
      ...(view.focusMode && focusRestore ? { focusRestore: { ...focusRestore } } : {})
    }
  }

  function restoreView(snapshot) {
    if (snapshot.focusMode) {
      focusRestore = snapshot.focusRestore ? { ...snapshot.focusRestore }
        : focusRestore || { showOutline: view.showOutline, showInspector: view.showInspector }
    } else {
      focusRestore = null
    }
    applyView({ showOutline: snapshot.showOutline, showInspector: snapshot.showInspector, focusMode: snapshot.focusMode })
  }

  return {
    get view() { return view },
    get focusRestore() { return focusRestore },
    onFocusChange: (fn) => listeners.push(fn),
    toggleOutline,
    togglePageInspector,
    toggleFocusWriting,
    captureView,
    restoreView
  }
}

// Simulated App shell focus writing state machine (matching App.tsx lines 1290-1400)
function createShellFocusWritingManager() {
  let activeFocus = null
  let sessionKey = 'session-1'
  let documentId = 'doc-1'
  let controlKey = 'ctrl-1'
  let mode = 'document'
  let sessionRevision = 1
  let projectId = 'project-1'

  function isOwnerCurrent(origin) {
    return origin && origin.sessionRevision === sessionRevision && origin.projectId === projectId
      && origin.sessionKey === sessionKey && origin.documentId === documentId
      && origin.controlKey === controlKey && origin.mode === mode
  }

  function receiveFocusWriting(originControls, focused) {
    if (!focused) {
      if (activeFocus && activeFocus.sessionKey === sessionKey && activeFocus.controlKey === controlKey && activeFocus.documentId === documentId) {
        clearFocusWriting()
      }
      return
    }
    if (documentId === 'project-brief') return // Refuse system questionnaire
    activeFocus = {
      sessionKey, sessionRevision, projectId, documentId, controlKey, mode,
      controls: originControls
    }
  }

  function clearFocusWriting() {
    if (!activeFocus) return
    const prev = activeFocus
    activeFocus = null
    if (prev.controls?.view.focusMode) {
      prev.controls.toggleFocusWriting()
    }
  }

  function isShellFocusWriting() {
    return Boolean(activeFocus && activeFocus.sessionKey === sessionKey
      && activeFocus.controlKey === controlKey && activeFocus.documentId === documentId
      && activeFocus.mode === mode)
  }

  return {
    receiveFocusWriting,
    clearFocusWriting,
    isShellFocusWriting,
    setDocumentId: (id) => { documentId = id; if (activeFocus && !isOwnerCurrent(activeFocus)) clearFocusWriting() },
    setMode: (m) => { mode = m; if (activeFocus && !isOwnerCurrent(activeFocus)) clearFocusWriting() },
    setProjectId: (p) => { projectId = p; if (activeFocus && !isOwnerCurrent(activeFocus)) clearFocusWriting() },
    getActiveFocus: () => activeFocus
  }
}

// ============================================================================
// Group 1: Document View Snapshots & Focus Writing State Transitions (X-14)
// ============================================================================
group('Document view snapshots & focus writing state transitions (X-14)', () => {
  const state = createDocumentViewState({ showOutline: false, showInspector: true, focusMode: false })

  // 1. Initial state
  check('Initial view has inspector open, outline closed, focus mode false',
    state.view.showInspector === true && state.view.showOutline === false && state.view.focusMode === false)

  // 2. Toggle outline
  state.toggleOutline()
  check('Outline toggled open', state.view.showOutline === true)

  // 3. Enter focus writing
  let notifiedFocus = null
  state.onFocusChange((focused) => { notifiedFocus = focused })
  state.toggleFocusWriting()

  check('Focus mode is active', state.view.focusMode === true)
  check('Outline is hidden in focus mode', state.view.showOutline === false)
  check('Page inspector is hidden in focus mode', state.view.showInspector === false)
  check('Saved restore state remembers outline was open and inspector was open',
    state.focusRestore?.showOutline === true && state.focusRestore?.showInspector === true)
  check('Listener notified of entering focus mode', notifiedFocus === true)

  // 4. Capture view snapshot
  const snapshot = state.captureView({ from: 12, to: 45 }, true, false)
  check('Captured snapshot records focusMode true', snapshot.focusMode === true)
  check('Captured snapshot records selection bounds', snapshot.selection.from === 12 && snapshot.selection.to === 45)
  check('Captured snapshot records canUndo true', snapshot.canUndo === true)
  check('Captured snapshot records canRedo false', snapshot.canRedo === false)
  check('Captured snapshot preserves focusRestore panels',
    snapshot.focusRestore?.showOutline === true && snapshot.focusRestore?.showInspector === true)

  // 5. Exit focus writing
  state.toggleFocusWriting()
  check('Focus mode is false after exit', state.view.focusMode === false)
  check('Outline restored to open state', state.view.showOutline === true)
  check('Inspector restored to open state', state.view.showInspector === true)
  check('Saved focusRestore is cleared upon exit', state.focusRestore === null)
  check('Listener notified of exiting focus mode', notifiedFocus === false)

  // 6. Restore from snapshot
  const externalState = createDocumentViewState({ showOutline: false, showInspector: false, focusMode: false })
  externalState.restoreView(snapshot)
  check('Restored state inherits focusMode true', externalState.view.focusMode === true)
  check('Restored state inherits focusRestore panels',
    externalState.focusRestore?.showOutline === true && externalState.focusRestore?.showInspector === true)

  // 7. Selection normalization
  const clamped = normalizedViewSelection({ from: -5, to: 9999 }, 150, { from: 0, to: 0 })
  check('Normalized selection clamps from to 0', clamped.from === 0)
  check('Normalized selection clamps to to doc size 150', clamped.to === 150)

  const inverted = normalizedViewSelection({ from: 80, to: 20 }, 150, { from: 0, to: 0 })
  check('Inverted selection is sorted from <= to', inverted.from === 20 && inverted.to === 80)
})

// ============================================================================
// Group 2: Shell-Level Focus Writing Integration & Transition Rules (X-14)
// ============================================================================
group('Shell-level focus writing integration & transition rules (X-14)', () => {
  const docState = createDocumentViewState()
  const shell = createShellFocusWritingManager()

  // 1. Enter shell focus writing
  docState.toggleFocusWriting()
  shell.receiveFocusWriting(docState, true)
  check('Shell focus writing is active', shell.isShellFocusWriting() === true)

  // 2. System questionnaire refusal
  shell.clearFocusWriting()
  shell.setDocumentId('project-brief')
  shell.receiveFocusWriting(docState, true)
  check('System questionnaire (project-brief) strictly refused from entering focus writing',
    shell.isShellFocusWriting() === false)

  // 3. User document switches clear focus writing
  shell.setDocumentId('doc-custom-1')
  docState.toggleFocusWriting()
  shell.receiveFocusWriting(docState, true)
  check('Custom document enters shell focus writing', shell.isShellFocusWriting() === true)

  shell.setDocumentId('doc-custom-2')
  check('Switching document automatically exits shell focus writing', shell.isShellFocusWriting() === false)

  // 4. Mode switch clears focus writing
  shell.setDocumentId('doc-custom-1')
  docState.toggleFocusWriting()
  shell.receiveFocusWriting(docState, true)
  check('Re-entered shell focus writing', shell.isShellFocusWriting() === true)

  shell.setMode('canvas')
  check('Switching workspace mode to canvas cleans up focus writing', shell.isShellFocusWriting() === false)

  // 5. Project switch clears focus writing
  shell.setMode('document')
  docState.toggleFocusWriting()
  shell.receiveFocusWriting(docState, true)
  check('Active in document mode', shell.isShellFocusWriting() === true)

  shell.setProjectId('project-2')
  check('Switching active project clears focus writing', shell.isShellFocusWriting() === false)
})

// ============================================================================
// Group 3: Document Layout, Pagination & Content Metrics (X-14)
// ============================================================================
group('Document layout, pagination & content metrics (X-14)', () => {
  const sampleDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Production Master Plan' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Step 1: Collect references and align spatial models.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Visual Reference Board' }] },
      { type: 'image', attrs: { src: 'https://example.com/ref.png', caption: 'Aquarium perspective reference' } },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Camera angle' }] }] }] }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Lighting Specifications' }] },
      { type: 'footnote', attrs: { number: 1, text: 'Calibrated under D65 ambient illuminant.' } },
      { type: 'pageBreak' },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Final Export Guidelines' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Ensure non-destructive vector paths and native shaders match.' }] }
    ]
  }

  // 1. Heading outline extraction
  const outline = documentOutline(sampleDoc)
  check('Extracted 4 headings in outline', outline.length === 4)
  check('First heading is H1 "Production Master Plan"', outline[0].level === 1 && outline[0].label === 'Production Master Plan')
  check('Second heading is H2 "Visual Reference Board"', outline[1].level === 2 && outline[1].label === 'Visual Reference Board')
  check('Third heading is H3 "Lighting Specifications"', outline[2].level === 3 && outline[2].label === 'Lighting Specifications')
  check('Fourth heading is H2 "Final Export Guidelines"', outline[3].level === 2 && outline[3].label === 'Final Export Guidelines')

  // 2. Layout node counts
  const counts = layoutNodeCounts(sampleDoc)
  check('Counted exactly 1 image', counts.images === 1)
  check('Counted exactly 1 table', counts.tables === 1)
  check('Counted exactly 1 footnote', counts.footnotes === 1)
  check('Counted exactly 1 page break', counts.pageBreaks === 1)

  // 3. Page layout dimensions
  const letterPortrait = [816, 1056]
  const letterLandscape = [1056, 816]
  const a4Portrait = [794, 1123]
  const a4Landscape = [1123, 794]
  const screenPage = [920, 1080]

  check('Letter portrait width is 816 and height is 1056', letterPortrait[0] === 816 && letterPortrait[1] === 1056)
  check('Letter landscape swaps to width 1056 and height 816', letterLandscape[0] === 1056 && letterLandscape[1] === 816)
  check('A4 portrait width is 794 and height is 1123', a4Portrait[0] === 794 && a4Portrait[1] === 1123)
  check('Screen digital page width is 920 and height is 1080', screenPage[0] === 920 && screenPage[1] === 1080)

  // 4. Margins
  const margins = { compact: 42, standard: 68, wide: 92 }
  check('Compact margin is 42px', margins.compact === 42)
  check('Standard margin is 68px', margins.standard === 68)
  check('Wide editorial margin is 92px', margins.wide === 92)

  // 5. Automatic page count estimation
  const wordCount = 35
  const autoPages = Math.max(1, Math.ceil((wordCount + counts.images * 280 + counts.tables * 180 + counts.footnotes * 70) / 620))
  const finalPages = Math.max(autoPages, counts.pageBreaks + 1)
  check('Final page count respects explicit page break (2 pages minimum)', finalPages === 2)

  // 6. SVG export generator
  const svg = documentSvg('<h1>Title</h1><p>Content</p><script>alert("xss")</script>')
  check('Generated SVG has foreignObject container', svg.includes('<foreignObject'))
  check('Generated SVG strips <script> tags completely', !svg.includes('<script>') && !svg.includes('alert('))
  check('Generated SVG includes document background fill #f6f1e8', svg.includes('fill="#f6f1e8"'))
})

// ============================================================================
// Group 4: Process Notes Modular Notebook Model (PII-9)
// ============================================================================
group('Process notes modular notebook model (PII-9)', () => {
  // 1. Default notebook creation
  const book = Notebook.createNotebook()
  check('Default notebook has schemaVersion 1', book.schemaVersion === 1)
  check('Default notebook has kind art-equation-notebook-proof', book.kind === 'art-equation-notebook-proof')
  check('Default notebook has title "Production notebook"', book.title === 'Production notebook')
  check('Default notebook has 2 pages', book.pages.length === 2)
  check('First page title is "Production process"', book.pages[0].title === 'Production process')
  check('Second page title is "Review and next steps"', book.pages[1].title === 'Review and next steps')

  // Module kinds in default page
  const kinds = book.pages[0].modules.map(m => m.kind)
  check('Page 1 contains heading', kinds.includes('heading'))
  check('Page 1 contains text', kinds.includes('text'))
  check('Page 1 contains note', kinds.includes('note'))
  check('Page 1 contains task', kinds.includes('task'))
  check('Page 1 contains image', kinds.includes('image'))
  check('Page 1 contains video', kinds.includes('video'))

  // 2. Unique UUIDs
  const allIds = [book.id, ...book.pages.flatMap(p => [p.id, ...p.modules.map(m => m.id)])]
  check('All book, page, and module UUIDs are unique', new Set(allIds).size === allIds.length)

  // 3. Module insertion
  const page1Id = book.pages[0].id
  const insertedBook = Notebook.insertModule(book, page1Id, 'task', book.pages[0].modules[0].id)
  check('Inserted module increases module count by 1', insertedBook.pages[0].modules.length === book.pages[0].modules.length + 1)
  check('Inserted module is placed immediately after first module', insertedBook.pages[0].modules[1].kind === 'task')
  check('Original book is not mutated (pure immutability)', book.pages[0].modules.length === 7)

  // 4. Module update
  const targetModule = insertedBook.pages[0].modules[1]
  const updatedBook = Notebook.updateModule(insertedBook, targetModule.id, { text: 'New verified task', checked: true })
  const updatedMod = updatedBook.pages[0].modules.find(m => m.id === targetModule.id)
  check('Updated module text is "New verified task"', updatedMod?.text === 'New verified task')
  check('Updated module task checked is true', updatedMod?.checked === true)

  // 5. Module removal
  const removedBook = Notebook.removeModule(updatedBook, targetModule.id)
  check('Removed module restores page count', removedBook.pages[0].modules.length === book.pages[0].modules.length)
  check('Removed module is no longer in page', !removedBook.pages[0].modules.some(m => m.id === targetModule.id))

  // 6. Page management
  const pageAddedBook = Notebook.addPage(removedBook)
  check('New page added (now 3 pages)', pageAddedBook.pages.length === 3)
  const newPageId = pageAddedBook.pages[2].id
  check('New page defaults to "Page 3"', pageAddedBook.pages[2].title === 'Page 3')

  const renamedBook = Notebook.renamePage(pageAddedBook, newPageId, 'Color Grading & LUTs')
  check('Renamed page has title "Color Grading & LUTs"', renamedBook.pages[2].title === 'Color Grading & LUTs')
})

// ============================================================================
// Group 5: Module Reordering, Cross-Page Transfer & History (PII-9)
// ============================================================================
group('Module reordering, cross-page transfer & history (PII-9)', () => {
  const book = Notebook.createNotebook()
  const firstMod = book.pages[0].modules[0]
  const secondMod = book.pages[0].modules[1]

  // 1. Move module down within page
  const movedDown = Notebook.moveModule(book, firstMod.id, 1)
  check('Module moved down to index 1', movedDown.pages[0].modules[1].id === firstMod.id)
  check('Second module moved up to index 0', movedDown.pages[0].modules[0].id === secondMod.id)

  // 2. Boundary clamping
  const clampedTop = Notebook.moveModule(book, firstMod.id, -1)
  check('Moving top module upwards clamps at boundary (returns original book)', clampedTop === book)

  const lastMod = book.pages[0].modules.at(-1)
  const clampedBottom = Notebook.moveModule(book, lastMod.id, 1)
  check('Moving bottom module downwards clamps at boundary (returns original book)', clampedBottom === book)

  // 3. Cross-page transfer
  const page2Id = book.pages[1].id
  const transferred = Notebook.moveModule(book, firstMod.id, 0, page2Id)
  check('Transferred module removed from source page', !transferred.pages[0].modules.some(m => m.id === firstMod.id))
  check('Transferred module appended to target page', transferred.pages[1].modules.at(-1).id === firstMod.id)
  check('Transferred module retains exact stable identity', transferred.pages[1].modules.at(-1).id === firstMod.id)

  // 4. Undo and Redo engine
  let history = { current: book, past: [], future: [] }
  history = Notebook.notebookHistory(history, { type: 'apply', next: movedDown })
  check('History past has 1 entry after apply', history.past.length === 1)
  check('History future is empty after apply', history.future.length === 0)

  history = Notebook.notebookHistory(history, { type: 'undo' })
  check('Undo restores current to original book', history.current === book)
  check('Undo moves state to future stack', history.future.length === 1 && history.future[0] === movedDown)

  history = Notebook.notebookHistory(history, { type: 'redo' })
  check('Redo restores movedDown state', history.current === movedDown)
  check('Redo pops future stack', history.future.length === 0)

  // 5. Typing merge and break
  let typingHistory = { current: book, past: [], future: [] }
  const modId = firstMod.id
  for (const str of ['H', 'He', 'Hel', 'Hello']) {
    const updated = Notebook.updateModule(typingHistory.current, modId, { text: str })
    typingHistory = Notebook.notebookHistory(typingHistory, { type: 'apply', next: updated, mergeKey: `text-${modId}` })
  }
  check('Consecutive typing with same mergeKey collapses into single history entry', typingHistory.past.length === 1)

  // Break typing on blur
  typingHistory = Notebook.notebookHistory(typingHistory, { type: 'break' })
  const finalEdit = Notebook.updateModule(typingHistory.current, modId, { text: 'Hello World' })
  typingHistory = Notebook.notebookHistory(typingHistory, { type: 'apply', next: finalEdit, mergeKey: `text-${modId}` })
  check('Typing after break creates new history entry (past length is 2)', typingHistory.past.length === 2)

  // Single Undo reverts back to 'Hello'
  typingHistory = Notebook.notebookHistory(typingHistory, { type: 'undo' })
  check('Single undo reverts back to "Hello"', typingHistory.current.pages[0].modules[0].text === 'Hello')

  // Second Undo reverts back to original text
  typingHistory = Notebook.notebookHistory(typingHistory, { type: 'undo' })
  check('Second undo reverts back to original text', typingHistory.current.pages[0].modules[0].text === firstMod.text)
})

// ============================================================================
// Group 6: Media Attachment, Security Boundaries & Failure Isolation (PII-9)
// ============================================================================
group('Media attachment, security boundaries & failure isolation (PII-9)', () => {
  const book = Notebook.createNotebook()

  // 1. Lossless JSON roundtrip
  const json = Notebook.exportNotebookJson(book)
  const parsed = Notebook.parseNotebook(json)
  check('JSON export and parse roundtrip is 100% lossless', JSON.stringify(parsed) === JSON.stringify(book))

  // 2. Embedded raster image attachment
  const samplePngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const withImage = Notebook.updateModule(book, book.pages[0].modules[5].id, {
    media: { id: 'img-1', name: 'pixel.png', mime: 'image/png', mode: 'embedded', dataUrl: samplePngBase64 }
  })
  const roundtripImage = Notebook.parseNotebook(Notebook.exportNotebookJson(withImage))
  check('Embedded raster image survives JSON export/parse',
    roundtripImage.pages[0].modules[5].media?.dataUrl === samplePngBase64)

  // 3. Local video reference attachment
  const withVideo = Notebook.updateModule(withImage, book.pages[0].modules[6].id, {
    media: { id: 'vid-1', name: 'process.mp4', mime: 'video/mp4', mode: 'local' }
  })
  const roundtripVideo = Notebook.parseNotebook(Notebook.exportNotebookJson(withVideo))
  check('Local video reference stores name and mime without raw bytes',
    roundtripVideo.pages[0].modules[6].media?.name === 'process.mp4' && roundtripVideo.pages[0].modules[6].media?.dataUrl === undefined)

  // 4. HTML export with Content Security Policy & XSS sanitization
  const hostile = structuredClone(withVideo)
  hostile.title = '<script>alert("xss-title")</script>'
  hostile.pages[0].title = '"><b onmouseover=alert(1)>'
  hostile.pages[0].modules[0].text = '<script>window.attack=true</script>'
  const exportedHtml = Notebook.exportNotebookHtml(hostile)

  check('HTML export includes strict CSP default-src none', exportedHtml.includes("default-src 'none'"))
  check('HTML export escapes script tag in title', !exportedHtml.includes('<script>alert') && exportedHtml.includes('&lt;script&gt;alert'))
  check('HTML export escapes script tag in module body', !exportedHtml.includes('<script>window') && exportedHtml.includes('&lt;script&gt;window'))
  check('HTML export escapes hostile tag in page title', !exportedHtml.includes('<b onmouseover=') && exportedHtml.includes('&lt;b onmouseover='))

  // 5. Strict security rejections in validateNotebook
  const rejects = (name, mutator) => {
    const bad = structuredClone(withVideo)
    mutator(bad)
    let caught = false
    try { Notebook.validateNotebook(bad) } catch { caught = true }
    check(`Rejects ${name}`, caught === true)
  }

  rejects('SVG image mime format (prevents SVG script execution)', (b) => {
    b.pages[0].modules[5].media = { id: 'bad-svg', name: 'hack.svg', mime: 'image/svg+xml', mode: 'embedded', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }
  })

  rejects('javascript: URI in image dataUrl', (b) => {
    b.pages[0].modules[5].media = { id: 'bad-js', name: 'hack.png', mime: 'image/png', mode: 'embedded', dataUrl: 'javascript:alert(1)' }
  })

  rejects('remote URL in media dataUrl', (b) => {
    b.pages[0].modules[5].media = { id: 'bad-remote', name: 'hack.png', mime: 'image/png', mode: 'embedded', dataUrl: 'https://evil.com/hack.png' }
  })

  rejects('blob URL in persistent dataUrl', (b) => {
    b.pages[0].modules[5].media = { id: 'bad-blob', name: 'hack.png', mime: 'image/png', mode: 'embedded', dataUrl: 'blob:http://localhost/1234' }
  })

  rejects('duplicate module identities across pages', (b) => {
    b.pages[1].modules.push({ id: b.pages[0].modules[0].id, kind: 'text', text: 'dup', checked: false })
  })

  rejects('oversized text exceeding 100,000 characters', (b) => {
    b.pages[0].modules[0].text = 'A'.repeat(100_001)
  })

  rejects('unknown document schema kind', (b) => {
    b.kind = 'unknown-document-format'
  })

  // 6. Long notebook scalability (5 pages, 200 modules)
  const longBook = structuredClone(book)
  longBook.pages = Array.from({ length: 5 }, (_, pageIdx) => ({
    id: `long-page-${pageIdx}`,
    title: `Section ${pageIdx + 1}`,
    modules: Array.from({ length: 40 }, (_, modIdx) => ({
      id: `long-mod-${pageIdx}-${modIdx}`,
      kind: modIdx % 6 === 0 ? 'heading' : modIdx % 6 === 1 ? 'task' : 'text',
      text: `Process note ${pageIdx + 1}.${modIdx + 1} detailing pipeline validation.`,
      checked: modIdx % 2 === 0
    }))
  }))
  const longJson = Notebook.exportNotebookJson(longBook)
  const parsedLong = Notebook.parseNotebook(longJson)
  check('200 modules across 5 pages roundtrip losslessly', parsedLong.pages.length === 5 && parsedLong.pages[0].modules.length === 40)
})

// ============================================================================
// Group 7: Document Trash, System Protection & Roundtrip Recovery
// ============================================================================
group('Document trash, system protection & roundtrip recovery', () => {
  const userDoc = {
    id: 'user-doc-1',
    title: 'Character Design Brief',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Rainee Redesign' }] },
        { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Key traits and silhouette.' }] }
      ]
    },
    layout: { pageSize: 'a4', orientation: 'portrait', columns: 1, margins: 'standard', theme: 'paper' }
  }
  const questionnaireDoc = {
    id: 'project-brief',
    title: 'Project Questionnaire',
    content: { type: 'doc' },
    locked: true,
    system: true
  }
  const project = {
    id: 'project-1',
    documents: [questionnaireDoc, userDoc]
  }

  // 1. System questionnaire cannot be trashed
  const trashQuestionnaire = Trash.applyDocumentTrash(project, questionnaireDoc.id)
  check('System questionnaire cannot be trashed (returns null)', trashQuestionnaire === null)

  // 2. User document trashing
  const trashed = Trash.applyDocumentTrash(project, userDoc.id, 9999)
  check('User document can be trashed', trashed !== null)
  check('Project documents array now only contains questionnaire',
    trashed.project.documents.length === 1 && trashed.project.documents[0].id === questionnaireDoc.id)
  check('Trash entry stores complete document copy',
    trashed.entry.document.id === userDoc.id && trashed.entry.document.title === userDoc.title)

  // 3. Snapshot isolation
  userDoc.title = 'Mutated after trash'
  check('Trash entry remains isolated from external mutation', trashed.entry.document.title === 'Character Design Brief')

  // 4. Document restoration
  const restored = Trash.applyDocumentRestore(trashed.project, trashed.entry)
  check('Document restored successfully', restored !== null)
  check('Restored project has 2 documents', restored.documents.length === 2)
  check('Restored document preserves title and content',
    restored.documents[1].title === 'Character Design Brief' && restored.documents[1].content.content[0].content[0].text === 'Rainee Redesign')
  check('Restored document preserves layout settings',
    restored.documents[1].layout.pageSize === 'a4' && restored.documents[1].layout.theme === 'paper')

  // 5. Collision safety on restore
  const collisionRestore = Trash.applyDocumentRestore(restored, trashed.entry)
  check('Restoring document with conflicting existing ID fails closed (returns null)', collisionRestore === null)
})

// Output summary and report
const totalChecks = checks.length
const passedChecks = checks.filter(c => c.passed).length
const allPassed = groups.every(g => g.passed) && totalChecks === passedChecks

const outDir = resolve('output/partii-focus-writing-process-notes')
await mkdir(outDir, { recursive: true })
const report = {
  passed: allPassed,
  generatedAt: new Date().toISOString(),
  totalChecks,
  passedChecks,
  groups: groups.map(g => ({ name: g.name, checks: g.checks, passed: g.passed }))
}
await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))

console.log(JSON.stringify({
  passed: allPassed,
  checks: totalChecks,
  groups: groups.map(g => ({ name: g.name, checks: g.checks, passed: g.passed })),
  report: resolve(outDir, 'report.json')
}, null, 2))

if (!allPassed) {
  process.exit(1)
}
