import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright-core'

const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5173/?catalog=demo'
const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const artifactDir = resolve('artifacts', 'ui-validation')
const expectedTools = [
  'Select and move', 'Node tool', 'Type tool', 'Pen tool', 'Draw rectangle',
  'Draw ellipse', 'Create subboard', 'Add card column', 'Hand tool', 'Zoom tool',
  'More canvas tools',
  'Undo board change', 'Redo board change',
]
const expectedSubtools = ['Draw line', 'Draw arrow', 'Draw connector', 'Group or frame', 'Import assets', 'Zoom to 100 percent', 'Fit selection', 'Previous zoom', 'Export board']
const report = { passed: false, generatedAt: new Date().toISOString(), checks: [], screenshots: [], accessibility: [], browserErrors: [] }
const failures = []

await mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
page.on('pageerror', (error) => report.browserErrors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') report.browserErrors.push(message.text())
})

function check(name, condition, detail = '') {
  report.checks.push({ name, passed: Boolean(condition), detail: condition ? undefined : detail })
  if (!condition) failures.push(detail || name)
}

async function screenshot(name) {
  const filename = `${name}.png`
  await page.screenshot({ path: resolve(artifactDir, filename), fullPage: true })
  report.screenshots.push(filename)
}

async function audit(name) {
  const results = await new AxeBuilder({ page })
    .include('.studio-shell')
    // Colour contrast is enforced separately by ui-contrast-audit.mjs, which
    // includes the full visible shell and Mini Bridge in both UI themes.
    .disableRules(['color-contrast'])
    .analyze()
  const violations = results.violations.map(({ id, impact, help, nodes }) => ({
    id,
    impact,
    help,
    count: nodes.length,
    targets: nodes.slice(0, 3).flatMap((node) => node.target),
  }))
  report.accessibility.push({ name, violations })
  const critical = violations.filter((violation) => violation.impact === 'critical')
  check(`${name}: no critical accessibility violations`, critical.length === 0, JSON.stringify(critical))
}

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Search project', { exact: true }).waitFor()
  check('workspace loads', await page.locator('.studio-shell').isVisible())
  await page.evaluate(() => localStorage.setItem('art-equation.canvas-tools', '0'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByLabel('Search project', { exact: true }).waitFor()
  await screenshot('01-wide-dark-workspace')

  await page.getByRole('button', { name: 'Use light theme' }).click()
  check('light theme applies to full shell', await page.locator('.studio-shell.workspace-light').count() === 1)
  await screenshot('02-wide-light-workspace')
  await audit('light theme workspace')
  await page.getByRole('button', { name: 'Use dark theme' }).click()
  check('dark theme restores', await page.locator('.studio-shell.workspace-dark').count() === 1)

  await page.getByRole('button', { name: 'Manage files' }).click()
  const miniBridge = page.getByRole('dialog', { name: 'Project Mini Bridge' })
  await miniBridge.waitFor()
  check('Mini Bridge exposes its three-pane shell', await miniBridge.locator('.mini-bridge-sidebar, .mini-bridge-center, .mini-bridge-inspector').count() === 3)
  check('Mini Bridge keeps the project root visible', await miniBridge.getByText('Project root', { exact: true }).first().isVisible())
  await miniBridge.getByRole('button', { name: /All project assets/ }).click()
  const firstAssetSelection = miniBridge.locator('.asset-row input[type="checkbox"]').first()
  if (await firstAssetSelection.count()) {
    await firstAssetSelection.check()
    check('Mini Bridge exposes disk-to-canvas identity', await miniBridge.getByText('Disk ↔ canvas identity').isVisible())
  } else check('Mini Bridge exposes an actionable empty state', await miniBridge.getByText('No matching files', { exact: true }).isVisible())
  check('Mini Bridge exposes recovery state', await miniBridge.getByText('Recovery journal: ready').isVisible())
  await screenshot('02b-mini-bridge-wide')
  await page.setViewportSize({ width: 1024, height: 680 })
  await page.waitForTimeout(150)
  check('Mini Bridge remains inside compact viewport', await miniBridge.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth + 1))
  await screenshot('02c-mini-bridge-compact')
  await page.setViewportSize({ width: 1440, height: 900 })
  await miniBridge.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  const canvas = page.locator('.canvas-stage').first()
  const rail = page.locator('.canvas-tool-rail')
  await canvas.waitFor()
  const noteContrast = await page.locator('.node-copy').first().evaluate((element) => {
    const channels = (color) => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
    const luminance = (color) => channels(color).map((value) => {
      const channel = value / 255
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)
    const style = getComputedStyle(element)
    const foreground = luminance(style.color), background = luminance(style.backgroundColor)
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
  })
  check('paper note body text has readable contrast', noteContrast >= 4.5, `contrast ${noteContrast.toFixed(2)}:1`)
  check('Assets remains visible on the main canvas toolbar', await page.getByRole('button', { name: 'Show board assets' }).isVisible())
  check('fisheye controls are removed', await page.getByLabel('Toggle fisheye magnifier').count() === 0)
  await page.getByRole('button', { name: 'Toggle Appearance panel' }).click()
  const appearancePanel = page.getByRole('dialog', { name: 'Appearance' })
  check('Appearance panel opens', await appearancePanel.isVisible())
  for (const label of ['Grid and canvas settings', 'Toggle black and white preview', 'Toggle board filmstrip', 'Paste copied cards on this board', 'Arrange free cards into a compact grid', 'Match image widths without enlarging any image', 'Show unsorted cards', 'Show canvas diagnostics', 'Fit board']) check(`Appearance: ${label}`, await appearancePanel.getByLabel(label).isVisible())
  check('persistent canvas toolbar is visible', await rail.isVisible())
  check('legacy hidden-toolbar preference cannot hide the rail on startup', await rail.isVisible())
  for (const name of expectedTools) check(`toolbar: ${name}`, await rail.getByLabel(name).isVisible())
  check('subtools collapsed by default', await rail.getByLabel('Draw arrow').count() === 0)
  await rail.getByLabel('More canvas tools').click()
  for (const name of expectedSubtools) check(`subtool: ${name}`, await page.locator('#canvas-subtools').getByLabel(name).isVisible())
  await rail.getByLabel('Select and move').click()
  check('clicking away dismisses subtools', await page.locator('#canvas-subtools').count() === 0)
  await rail.getByLabel('More canvas tools').click()
  await page.keyboard.press('Escape')
  check('Escape dismisses subtools', await page.locator('#canvas-subtools').count() === 0)
  await screenshot('03-canvas-toolbar')

  // Cursor and state parity: tool state is not allowed to masquerade as selection.
  for (const [label, className, cursor] of [
    ['Select and move', 'tool-select', 'default'], ['Node tool', 'tool-node', 'default'],
    ['Type tool', 'tool-type', 'text'], ['Pen tool', 'tool-pen', 'crosshair'],
    ['Draw rectangle', 'tool-draw', 'crosshair'], ['Hand tool', 'viewport-hand', 'grab'],
    ['Zoom tool', 'viewport-zoom', 'zoom-in'],
  ]) {
    await rail.getByLabel(label).click()
    check(`${label} exposes its canvas state`, await canvas.evaluate((node, expected) => node.classList.contains(expected), className))
    if (cursor !== 'default') check(`${label} cursor`, await canvas.evaluate((node) => getComputedStyle(node).cursor) === cursor)
    await page.keyboard.press('Escape')
    check(`${label} Escape returns to object selection`, await canvas.evaluate((node) => node.classList.contains('tool-select')))
  }

  const bounds = await canvas.boundingBox()
  assert(bounds, 'canvas bounds should be available')
  // Empty-canvas actions are tested at a reliably empty edge, after clearing selection.
  const emptyPoint = { x: bounds.x + bounds.width - 28, y: bounds.y + 28 }
  await page.mouse.click(emptyPoint.x, emptyPoint.y)
  check('clicking canvas clears selected objects', await page.locator('.board-node.selected').count() === 0)
  await page.mouse.click(emptyPoint.x, emptyPoint.y, { button: 'right' })
  const emptyMenu = page.locator('.canvas-context-menu')
  await emptyMenu.waitFor()
  for (const label of ['Paste', 'Import image…', 'Import video…', 'Import 3D model…', 'Import document…', 'Add note', 'Add text', 'Add frame', 'Add column', 'Fit board']) {
    check(`empty canvas menu: ${label}`, await emptyMenu.getByText(label, { exact: true }).isVisible())
  }
  check('empty canvas menu: combined grid settings', await emptyMenu.getByText('Grid & canvas settings…', { exact: true }).isVisible())
  check('empty canvas menu: truthful pack label', await emptyMenu.getByText('Pack into grid', { exact: true }).isVisible())
  const emptyMenuBounds = await emptyMenu.evaluate((element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } })
  check('empty canvas menu stays inside viewport', emptyMenuBounds.left >= 9 && emptyMenuBounds.top >= 9 && emptyMenuBounds.right <= 1431 && emptyMenuBounds.bottom <= 891, JSON.stringify(emptyMenuBounds))
  await emptyMenu.getByText('Grid & canvas settings…', { exact: true }).click()
  const gridPanel = page.getByRole('complementary', { name: 'Color controls' })
  await gridPanel.waitFor()
  check('grid settings expose visibility', await gridPanel.getByText('Show grid', { exact: true }).isVisible())
  check('grid settings expose snapping', await gridPanel.getByText('Snap to grid', { exact: true }).isVisible())
  check('grid settings expose background', await gridPanel.getByRole('button', { name: 'Background', exact: true }).isVisible())
  await gridPanel.getByLabel('Close color controls').click()
  await page.mouse.click(emptyPoint.x, emptyPoint.y, { button: 'right' })
  await page.keyboard.press('ArrowDown')
  check('context menu supports arrow-key navigation', await emptyMenu.evaluate((element) => element.contains(document.activeElement) && document.activeElement?.getAttribute('role') === 'menuitem'))
  await screenshot('04-empty-canvas-menu')
  await page.keyboard.press('Escape')

  await page.getByLabel('Toggle Appearance panel').click()
  await page.getByLabel('Show board hierarchy').click()
  const hierarchy = page.getByRole('complementary', { name: 'Board hierarchy' })
  await hierarchy.waitFor()
  const hierarchyItems = hierarchy.getByRole('treeitem')
  check('hierarchy lists every board object once', await hierarchyItems.count() === await page.locator('.board-node').count())
  const firstHierarchyItem = hierarchyItems.first()
  await firstHierarchyItem.locator('.hierarchy-select').click()
  check('hierarchy selection synchronizes with canvas', await firstHierarchyItem.getAttribute('aria-selected') === 'true' && await page.locator('.board-node.selected').count() === 1)
  const hierarchyLock = firstHierarchyItem.locator('.hierarchy-lock')
  const lockBefore = await hierarchyLock.getAttribute('aria-pressed')
  await hierarchyLock.click()
  check('hierarchy lock toggles existing node lock state', await hierarchyLock.getAttribute('aria-pressed') !== lockBefore)
  await rail.getByLabel('Undo board change').click()
  check('hierarchy lock participates in undo', await hierarchyLock.getAttribute('aria-pressed') === lockBefore)
  await screenshot('04b-board-hierarchy')
  await hierarchy.getByLabel('Close board hierarchy').click()

  // Milanote-style color controls live in the shared toolbar/panel, not on the
  // column surface where they can intercept card dragging.
  const columnControls = page.locator('.column-header-controls-overlay').first()
  if (await columnControls.count()) {
    check('column collapse control stays above child cards', await columnControls.isVisible())
    check('column surface has no embedded color palette', await page.locator('.node-column .column-header-swatches').count() === 0)
    const column = page.locator('.node-column').first()
    if (await column.count()) {
      await column.dispatchEvent('click')
      const colorTool = page.getByLabel('Toggle object color controls')
      await colorTool.click()
      const colorPanel = page.getByRole('complementary', { name: 'Color controls' })
      await colorPanel.waitFor({ state: 'visible' })
      check('column color opens standard color panel', await colorPanel.isVisible())
      check('standard color panel exposes full palette', await colorPanel.getByLabel(/Use palette color/).count() >= 8)
      await colorPanel.getByLabel(/Use palette color/).last().click()
      await colorPanel.getByLabel('Close color controls').click()
    }
  }

  // Draw a real shape, then validate its selection-aware menu and Escape behavior.
  const shapesBeforeRectangle = await page.locator('.board-node.node-shape').count()
  await rail.getByLabel('Draw rectangle').click()
  await page.mouse.move(bounds.x + 650, bounds.y + 500)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 750, bounds.y + 590)
  await page.mouse.up()
  await page.waitForTimeout(80)
  check('rectangle tool adds a shape node', await page.locator('.board-node.node-shape').count() === shapesBeforeRectangle + 1)
  const shape = page.locator('.board-node.node-shape').last()
  await shape.waitFor()
  await shape.click({ button: 'right' })
  const shapeMenu = page.locator('.canvas-context-menu')
  for (const label of ['Edit', 'Copy SVG', 'Copy PNG', 'Duplicate', 'Layer', 'Move to Trash']) {
    check(`shape menu: ${label}`, await shapeMenu.getByText(label, { exact: true }).isVisible())
  }
  const shapeMenuBounds = await shapeMenu.boundingBox()
  check('shape context menu stays inside the viewport', Boolean(shapeMenuBounds && shapeMenuBounds.x >= 9 && shapeMenuBounds.y >= 9 && shapeMenuBounds.x + shapeMenuBounds.width <= 1431 && shapeMenuBounds.y + shapeMenuBounds.height <= 891), JSON.stringify(shapeMenuBounds))
  await screenshot('05-shape-context-menu')
  await page.keyboard.press('Escape')
  check('closing a context menu returns focus to its card', await shape.evaluate((element) => document.activeElement === element))
  // The browser catalog has no Tauri disk backend. Mock only its Trash journal
  // commands so this exercises the actual UI flow without relaxing fail-closed
  // deletion in the application.
  await page.evaluate(() => {
    const entries = []
    const recoveryCommands = []
    window.__testTrashEntries = entries
    window.__testRecoveryCommands = recoveryCommands
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: async (command, args) => {
      if (command === 'record_trash_entry') { entries.push({ projectId: args.projectId, ...args.entry }); return }
      if (command === 'list_project_trash') return entries.filter((entry) => entry.projectId === args.projectId)
      if (command === 'save_json' && args.relativePath === `projects/${args.value?.id}/project.json`) { recoveryCommands.push({ command, project: structuredClone(args.value) }); return }
      if (command === 'remove_trash_entry') { recoveryCommands.push({ command, entryId: args.entryId }); const index = entries.findIndex((entry) => entry.projectId === args.projectId && entry.id === args.entryId); if (index >= 0) entries.splice(index, 1); return }
      if (command === 'ensure_managed_board_folders') return
      if (command === 'plugin:window|scale_factor') return 1
      if (command === 'plugin:window|inner_size') return { width: 1440, height: 900 }
      throw new Error(`UI catalog does not mock ${command}`)
    } }
  })
  await shape.click({ button: 'right' })
  await shapeMenu.getByText('Move to Trash', { exact: true }).click()
  const shapeMovedToTrash = await page.waitForFunction((expected) => document.querySelectorAll('.board-node.node-shape').length === expected, shapesBeforeRectangle, { timeout: 2000 }).then(() => true, () => false)
  check('shape moves off the board after its Trash snapshot saves', shapeMovedToTrash && await page.locator('.board-node.node-shape').count() === shapesBeforeRectangle)
  await page.getByTestId('trash-button').click()
  const trashViewer = page.getByTestId('trash-viewer')
  await trashViewer.waitFor()
  const trashedRectangle = trashViewer.locator('.trash-entry').filter({ hasText: 'Rectangle' }).first()
  check('Trash previews the recoverable rectangle', await trashedRectangle.isVisible() && await trashedRectangle.locator('.trash-entry-preview').count() > 0)
  const rectangleRestoreStart = await page.evaluate(() => window.__testRecoveryCommands.length)
  await trashedRectangle.getByRole('button', { name: /Restore/ }).click()
  check('restoring the rectangle returns it to the board', await page.waitForFunction((expected) => document.querySelectorAll('.board-node.node-shape').length === expected, shapesBeforeRectangle + 1, { timeout: 2000 }).then(() => true, () => false))
  check('restored rectangle leaves Trash', await trashedRectangle.waitFor({ state: 'detached', timeout: 2000 }).then(() => true, () => false))
  check('rectangle recovery commits restored project before removing its recovery record', await page.evaluate((start) => {
    const events = window.__testRecoveryCommands.slice(start)
    const saved = events.findIndex((event) => event.command === 'save_json' && event.project.boards.some((board) => board.nodes.some((node) => node.title === 'Rectangle')))
    const removed = events.findIndex((event) => event.command === 'remove_trash_entry')
    return saved >= 0 && removed > saved
  }, rectangleRestoreStart))
  await trashViewer.getByRole('button', { name: 'Close' }).click()

  // Exercise the navigator's user-document recovery path end-to-end. The
  // model-level test separately verifies the exact rich-content/layout copy.
  await page.locator('.tree-row.child.muted').getByText('New document or board').click()
  await page.getByRole('menu', { name: 'New project item' }).getByRole('button', { name: /New document/ }).click()
  const userDocument = page.locator('.tree-row.child').filter({ hasText: 'Untitled document' }).last()
  await userDocument.waitFor()
  const userDocumentTitle = (await userDocument.innerText()).trim().replace(/^¶\s*/, '')
  await userDocument.click({ button: 'right' })
  const documentMenu = page.getByRole('menu', { name: new RegExp(userDocumentTitle) })
  const moveDocumentToTrash = documentMenu.getByRole('menuitem', { name: 'Move to Trash…' })
  await moveDocumentToTrash.waitFor()
  await moveDocumentToTrash.click()
  const documentTrashConfirmation = page.getByRole('alertdialog', { name: 'Move document to Trash' })
  await documentTrashConfirmation.waitFor()
  check('document Trash uses an app-styled confirmation with safe Cancel focus', await documentTrashConfirmation.getByRole('button', { name: 'Cancel', exact: true }).evaluate((button) => document.activeElement === button))
  await documentTrashConfirmation.getByRole('button', { name: 'Move to Trash', exact: true }).click()
  await page.getByTestId('trash-button').click()
  const trashedDocument = page.locator('.trash-entry').filter({ hasText: userDocumentTitle })
  await trashedDocument.waitFor()
  const documentSnapshot = await page.evaluate((title) => window.__testTrashEntries.find((entry) => entry.title === title), userDocumentTitle)
  check('document deletion writes a restorable content-and-layout Trash snapshot', Boolean(documentSnapshot?.kind === 'document' && documentSnapshot.document?.content && documentSnapshot.document?.layout))
  const documentRestoreStart = await page.evaluate(() => window.__testRecoveryCommands.length)
  await trashedDocument.getByRole('button', { name: /Restore/ }).click()
  check('restoring a user document returns it to the navigator', await page.locator('.tree-row.child').filter({ hasText: userDocumentTitle }).waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false))
  check('restored document is removed from Trash after restore succeeds', await trashedDocument.waitFor({ state: 'detached', timeout: 2000 }).then(() => true, () => false))
  check('document recovery commits restored project before removing its recovery record', await page.evaluate(({ start, documentId }) => {
    const events = window.__testRecoveryCommands.slice(start)
    const saved = events.findIndex((event) => event.command === 'save_json' && event.project.documents.some((document) => document.id === documentId))
    const removed = events.findIndex((event) => event.command === 'remove_trash_entry')
    return saved >= 0 && removed > saved
  }, { start: documentRestoreStart, documentId: documentSnapshot.document.id }))
  await page.getByTestId('trash-viewer').getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await canvas.waitFor({ state: 'visible' })
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__ })
  const ellipsesBefore = await page.locator('.node-shape-ellipse').count()
  await rail.getByLabel('Draw ellipse').click()
  await page.mouse.move(bounds.x + 650, bounds.y + 150)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 750, bounds.y + 260)
  await page.mouse.up()
  await page.waitForTimeout(80)
  const ellipse = page.locator('.node-shape-ellipse').last()
  check('ellipse tool creates ellipse geometry', await page.locator('.node-shape-ellipse').count() === ellipsesBefore + 1 && await ellipse.locator('ellipse:not(.shape-hit-area)').count() === 1)
  await screenshot('05b-ellipse-draw-result')
  await page.keyboard.press('Escape')

  const arrowsBefore = await page.locator('.animated-arrow').count()
  await rail.getByLabel('More canvas tools').click()
  await page.locator('#canvas-subtools').getByLabel('Draw arrow').click()
  check('choosing a flyout tool closes the flyout', await page.locator('#canvas-subtools').count() === 0)
  await page.mouse.move(bounds.x + 820, bounds.y + 180)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 980, bounds.y + 300)
  await page.mouse.up()
  await page.waitForTimeout(80)
  const animatedArrow = page.locator('.animated-arrow').last()
  check('Arrow tool creates the moving-arrow presentation', await page.locator('.animated-arrow').count() === arrowsBefore + 1 && await animatedArrow.locator('.shape-arrow-flow').count() === 1)
  check('animated arrow exposes persisted motion controls', await page.getByLabel('Toggle arrow motion').getAttribute('aria-pressed') === 'true' && await page.getByLabel('Arrow motion speed').isVisible())
  await page.getByLabel('Arrow motion speed').selectOption('fast')
  check('arrow speed changes the presentation class', await animatedArrow.evaluate((node) => node.classList.contains('motion-fast')))
  await page.getByLabel('Reverse arrow motion').click()
  check('arrow direction changes without changing geometry', await animatedArrow.evaluate((node) => node.classList.contains('direction-reverse')))
  await page.keyboard.press('Escape')

  // Author a closed vector path through the same Pen/Node interactions a user performs.
  await page.getByRole('button', { name: 'Toggle Appearance panel' }).click()
  await page.getByLabel('Toggle board filmstrip').click()
  const filmstrip = page.getByLabel('Board filmstrip')
  report.vectorFixtureBefore = await page.evaluate(() => ({
    activeBoard: document.querySelector('.board-navigation [aria-current="page"]')?.textContent,
    nodes: document.querySelectorAll('.board-node').length,
    nativeBackend: Boolean(window.__TAURI_INTERNALS__),
  }))
  // Top-level boards must have managed disk folders. This isolated browser
  // fixture acknowledges only that native command; it cannot create disk data.
  await page.evaluate(() => {
    window.__testVectorFolderCalls = []
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: async (command, args) => {
      if (command === 'ensure_managed_board_folders') { window.__testVectorFolderCalls.push(args); return }
      if (command === 'plugin:window|scale_factor') return 1
      if (command === 'plugin:window|inner_size') return { width: 1440, height: 900 }
      throw new Error(`Empty vector-board fixture does not mock ${command}`)
    } }
  })
  await filmstrip.getByRole('button', { name: '＋ Root board' }).click()
  await page.waitForFunction(() => document.querySelector('.canvas-stage') && document.querySelectorAll('.board-node').length === 0)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  report.vectorFixtureAfter = await page.evaluate(() => ({
    activeBoard: document.querySelector('.board-navigation [aria-current="page"]')?.textContent,
    nodes: document.querySelectorAll('.board-node').length,
    nativeBackend: Boolean(window.__TAURI_INTERNALS__),
    folderCalls: window.__testVectorFolderCalls,
  }))
  assert.notEqual(report.vectorFixtureAfter.activeBoard, report.vectorFixtureBefore.activeBoard, 'vector test must navigate into the new disposable root board')
  assert.equal(report.vectorFixtureAfter.nodes, 0, 'vector test must start on a genuinely empty board, not among unrelated cards')
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__ })
  // Activating a root board intentionally opens Split view; author this fixture
  // in full Canvas view so all anchors and its empty marquee margins are on-screen.
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const pathsBefore = await page.locator('.board-node.node-shape').filter({ has: page.locator('.node-vector-shape') }).count()
  await rail.getByLabel('Pen tool').click()
  const penSurface = page.getByLabel('Place pen path anchors')
  await penSurface.waitFor()
  const pathCanvasBounds = await penSurface.boundingBox()
  assert(pathCanvasBounds, 'Pen drawing surface bounds should be available')
  const penAnchors = [
    { x: pathCanvasBounds.x + 300, y: pathCanvasBounds.y + 190 },
    { x: pathCanvasBounds.x + 440, y: pathCanvasBounds.y + 220 },
    { x: pathCanvasBounds.x + 370, y: pathCanvasBounds.y + 360 },
  ]
  for (const [index, point] of penAnchors.entries()) {
    await penSurface.dispatchEvent('pointerdown', { button: 0, clientX: point.x, clientY: point.y, detail: 1, pointerId: 7 })
    if (index === 1) await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 38, clientY: y - 24, pointerId: 7 })), point)
    await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 7 })), index === 1 ? { x: point.x + 38, y: point.y - 24 } : point)
  }
  await penSurface.dispatchEvent('pointerdown', { button: 0, clientX: penAnchors[0].x, clientY: penAnchors[0].y, detail: 1 })
  await page.waitForTimeout(80)
  const vectorPaths = page.locator('.board-node.node-shape').filter({ has: page.locator('.node-vector-shape') })
  check('Pen tool creates a path node', await vectorPaths.count() === pathsBefore + 1)
  const vectorPath = vectorPaths.last()
  check('vector paths use cached hit proxies', await vectorPath.locator('[data-vector-hit-proxy="cached"]').count() === 1)
  check('Node editing keeps canonical vector geometry exact', await vectorPath.locator('.node-vector-shape').getAttribute('data-vector-lod') === 'exact')
  check('clicking the first Pen anchor closes the path', await page.getByRole('button', { name: 'Toggle path closure' }).getAttribute('aria-pressed') === 'true')
  check('Node tool exposes every authored anchor', await vectorPath.locator('.vector-anchor').count() === 3)
  check('Pen drag creates Bézier handles on the placed anchor', await vectorPath.locator('.vector-handle').count() === 2)
  await rail.getByLabel('Select and move').click()
  await page.mouse.click(pathCanvasBounds.x + 40, pathCanvasBounds.y + 40)
  await rail.getByLabel('Node tool').click()
  await vectorPath.locator('.shape-hit-area').click({ force: true })
  check('Node tool directly activates an existing path', await vectorPath.locator('.vector-anchor').count() === 3 && await vectorPath.evaluate((node) => node.classList.contains('selected')))
  const vectorBounds = await vectorPath.boundingBox()
  assert(vectorBounds, 'vector path bounds should be available for anchor marquee selection')
  const marqueeDrag = await page.evaluate((rect) => {
    const stageElement = document.querySelector('.canvas-stage')
    const stage = stageElement?.getBoundingClientRect()
    if (!stage || !stageElement) return null
    for (const margin of [14, 24, 40, 60, 80, 110]) {
      const x = rect.x - margin
      const oppositeX = rect.x + rect.width + margin
      if (x < stage.left + 4 || oppositeX > stage.right - 4) continue
      for (const [y, oppositeY] of [[rect.y - margin, rect.y + rect.height + margin], [rect.y + rect.height + margin, rect.y - margin]]) {
        if (y < stage.top + 4 || y > stage.bottom - 4 || oppositeY < stage.top + 4 || oppositeY > stage.bottom - 4) continue
        const hit = document.elementFromPoint(x, y)
        if (hit && stageElement.contains(hit) && !hit.closest('.board-node, .canvas-tool-rail, .board-minimap, .canvas-zoom-control')) return { start: { x, y }, end: { x: oppositeX, y: oppositeY } }
      }
    }
    return null
  }, vectorBounds)
  if (!marqueeDrag) {
    report.marqueeUnavailable = await page.evaluate((rect) => {
      const stage = document.querySelector('.canvas-stage')?.getBoundingClientRect()
      return { vectorBounds: rect, stage: stage?.toJSON(), nodes: [...document.querySelectorAll('.board-node')].map((node) => ({ id: node.dataset.nodeId, className: node.className, box: node.getBoundingClientRect().toJSON() })) }
    }, vectorBounds)
    await screenshot('05c-vector-marquee-unavailable')
  }
  assert(marqueeDrag, 'an empty canvas corner must be available around the vector path')
  await page.mouse.move(marqueeDrag.start.x, marqueeDrag.start.y)
  await page.mouse.down()
  await page.mouse.move(marqueeDrag.end.x, marqueeDrag.end.y, { steps: 4 })
  check('Node marquee previews enclosed anchors before release', await vectorPath.locator('.vector-anchor.marquee-preview').nth(2).waitFor({ state: 'attached', timeout: 1500 }).then(() => true, () => false) && await vectorPath.locator('.vector-anchor.marquee-preview').count() === 3)
  check('Node marquee previews crossed path segments before release', await vectorPath.locator('.vector-segment-selected.preview').nth(2).waitFor({ state: 'attached', timeout: 1500 }).then(() => true, () => false))
  await page.mouse.up()
  check('Node marquee selects all enclosed anchors', await vectorPath.locator('.vector-anchor.selected').nth(2).waitFor({ state: 'attached', timeout: 1500 }).then(() => true, () => false) && await vectorPath.locator('.vector-anchor.selected').count() === 3)
  check('Node marquee selects enclosed path segments', await vectorPath.locator('.vector-segment-selected:not(.preview)').nth(2).waitFor({ state: 'attached', timeout: 1500 }).then(() => true, () => false))
  await vectorPath.locator('.vector-segment-hit').first().dispatchEvent('pointerdown', { button: 0, pointerId: 17 })
  check('Node tool selects an individual path segment', await vectorPath.locator('.vector-segment-selected').count() === 1)
  const firstAnchor = vectorPath.locator('.vector-anchor').first()
  await firstAnchor.click({ force: true })
  check('Node selection is visually independent from card selection', await firstAnchor.evaluate((node) => node.classList.contains('selected')) && await vectorPath.evaluate((node) => node.classList.contains('selected')))
  await page.getByLabel('Insert point after selected point').click()
  check('Node tool inserts a point after the selected anchor', await vectorPath.locator('.vector-anchor').count() === 4)
  check('curve insertion preserves editable Bézier controls', await vectorPath.locator('.vector-handle').count() >= 4 && await vectorPath.locator('.node-vector-shape > g > path:not(.shape-hit-area):not(.vector-segment-hit):not(.vector-segment-selected)').first().getAttribute('d').then((value) => Boolean(value?.includes('C'))))
  await page.getByLabel('Delete selected point').click()
  check('Node tool deletes the selected point without deleting its card', await vectorPath.locator('.vector-anchor').count() === 3 && await vectorPath.count() === 1)
  await firstAnchor.dblclick({ force: true })
  await page.waitForTimeout(50)
  check('double-clicking an anchor adds Bézier handles', await vectorPath.getByLabel('Adjust incoming curve handle 1').count() === 1 && await vectorPath.getByLabel('Adjust outgoing curve handle 1').count() === 1)
  await page.getByLabel('Make selected point a corner').click()
  check('corner conversion keeps a separately editable handle pair', await vectorPath.locator('.vector-handle').count() >= 4)
  await page.getByLabel('Join selected point handles').click()
  check('join handles converts the selected point to smooth', await vectorPath.locator('.vector-handle').count() >= 4)
  await page.getByLabel('Break selected point handles').click()
  check('break handles keeps the selected point editable', await vectorPath.locator('.vector-handle').count() >= 4)
  await page.getByLabel('Make selected point smooth').click()
  const outgoingHandle = vectorPath.getByLabel('Adjust outgoing curve handle 1')
  const handleBounds = await outgoingHandle.boundingBox()
  assert(handleBounds, 'Bézier handle bounds should be available')
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBounds.x + 28, handleBounds.y + 18)
  await page.mouse.up()
  check('Bézier handles remain editable after pointer drag', await vectorPath.locator('.vector-handle').count() >= 4)
  await page.getByRole('button', { name: 'Toggle path closure' }).click()
  check('closed paths can be reopened', await page.getByRole('button', { name: 'Toggle path closure' }).getAttribute('aria-pressed') === 'false')
  check('open paths expose endpoint editing anchors', await vectorPath.getByLabel('Edit open endpoint 1').count() === 1 && await vectorPath.getByLabel(/Edit open endpoint 3/).count() === 1)
  await vectorPath.getByLabel('Edit open endpoint 1').click({ force: true })
  check('open endpoints can be node-selected without leaving Node mode', await vectorPath.getByLabel('Edit open endpoint 1').evaluate((node) => node.classList.contains('selected')))
  await page.getByRole('button', { name: 'Toggle path closure' }).click()
  check('open paths can be closed again', await page.getByRole('button', { name: 'Toggle path closure' }).getAttribute('aria-pressed') === 'true')
  await page.getByLabel('Path fill rule').selectOption('evenodd')
  await page.getByLabel('Path stroke join').selectOption('round')
  await page.getByLabel('Path stroke cap').selectOption('square')
  const renderedPath = vectorPath.locator('.node-vector-shape > g > path:not(.shape-hit-area):not(.vector-segment-hit):not(.vector-segment-selected)').first()
  check('even–odd fill rule reaches SVG geometry', await renderedPath.getAttribute('fill-rule') === 'evenodd')
  check('round stroke join reaches SVG geometry', await renderedPath.getAttribute('stroke-linejoin') === 'round')
  check('square stroke cap reaches SVG geometry', await renderedPath.getAttribute('stroke-linecap') === 'square')
  await page.getByLabel('Flip path horizontally').click()
  await page.getByLabel('Path horizontal skew').fill('18')
  await page.getByLabel('Path horizontal skew').press('Enter')
  const vectorTransform = await vectorPath.locator('.node-vector-shape > g').getAttribute('transform')
  check('path transforms remain non-destructive SVG transforms', Boolean(vectorTransform?.includes('scale(-1 1)') && vectorTransform.includes('skewX(18)')), vectorTransform || 'missing transform')
  await page.getByLabel('Reset path transform').click()
  check('path transform can be reset without changing anchors', await vectorPath.locator('.vector-anchor').count() === 3 && await vectorPath.locator('.node-vector-shape > g').getAttribute('transform') === null)
  await firstAnchor.dblclick({ force: true })
  await page.waitForTimeout(50)
  check('double-clicking a curved anchor removes its handles', await vectorPath.getByLabel('Adjust incoming curve handle 1').count() === 0 && await vectorPath.getByLabel('Adjust outgoing curve handle 1').count() === 0)
  await page.keyboard.press('Control+c')
  const clipboardPath = await page.evaluate(() => JSON.parse(localStorage.getItem('art-equation-board-clipboard') || '{}').nodes?.[0])
  check('board clipboard serializes vector geometry and styles', clipboardPath?.vectorPath?.points?.length === 3 && clipboardPath.vectorFillRule === 'evenodd' && clipboardPath.vectorStrokeJoin === 'round' && clipboardPath.vectorStrokeCap === 'square')
  await page.getByLabel('Path fill rule').selectOption('nonzero')
  await page.getByLabel('Undo board change').click()
  check('vector style change participates in undo', await page.getByLabel('Path fill rule').inputValue() === 'evenodd')
  await page.getByLabel('Redo board change').click()
  check('vector style change participates in redo', await page.getByLabel('Path fill rule').inputValue() === 'nonzero')
  await page.getByLabel('Path fill rule').selectOption('evenodd')
  const pathsBeforePaste = await vectorPaths.count()
  await page.evaluate(() => window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer() })))
  await page.waitForTimeout(60)
  check('board clipboard pastes an editable vector path', await vectorPaths.count() === pathsBeforePaste + 1)
  const pastedPath = vectorPaths.last()
  check('pasted path retains fill, join, and cap metadata', await pastedPath.locator('.node-vector-shape > g > path:not(.shape-hit-area):not(.vector-segment-hit):not(.vector-segment-selected)').first().getAttribute('fill-rule') === 'evenodd' && await pastedPath.locator('.node-vector-shape > g > path:not(.shape-hit-area):not(.vector-segment-hit):not(.vector-segment-selected)').first().getAttribute('stroke-linejoin') === 'round' && await pastedPath.locator('.node-vector-shape > g > path:not(.shape-hit-area):not(.vector-segment-hit):not(.vector-segment-selected)').first().getAttribute('stroke-linecap') === 'square')
  await pastedPath.locator('.shape-hit-area').evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 500, clientY: 400 })))
  await page.locator('.canvas-context-menu').getByText('Copy SVG', { exact: true }).click()
  const copiedSvg = await page.evaluate(() => navigator.clipboard.readText())
  check('SVG clipboard export preserves vector semantics', copiedSvg.includes('fill-rule="evenodd"') && copiedSvg.includes('stroke-linejoin="round"') && copiedSvg.includes('stroke-linecap="square"'))
  check('minimap remains available after vector geometry changes', await page.getByLabel('Board minimap. Click to navigate.').isVisible())
  await screenshot('05c-vector-path-authoring')

  // Pen completion/cancellation must be safe without depending on a double-click.
  await rail.getByLabel('Pen tool').click()
  const enterPenSurface = page.getByLabel('Place pen path anchors')
  const enterBounds = await enterPenSurface.boundingBox()
  assert(enterBounds, 'Pen surface should remain available')
  const enterPoints = [{ x: enterBounds.x + 520, y: enterBounds.y + 170 }, { x: enterBounds.x + 610, y: enterBounds.y + 250 }]
  const pathsBeforeEnter = await vectorPaths.count()
  for (const point of enterPoints) {
    await enterPenSurface.dispatchEvent('pointerdown', { button: 0, clientX: point.x, clientY: point.y, pointerId: 9 })
    await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 9 })), point)
  }
  await enterPenSurface.dispatchEvent('pointermove', { clientX: enterBounds.x + 670, clientY: enterBounds.y + 300, pointerId: 9 })
  await page.locator('.pen-draft path[stroke-dasharray]').waitFor({ state: 'attached', timeout: 1000 })
  check('Pen preview draws the next segment as a curve', await page.locator('.pen-draft path[stroke-dasharray]').count() === 1 && (await page.locator('.pen-draft path[stroke-dasharray]').first().getAttribute('d') || '').includes('C'))
  check('Pen draft appends only new authored segments', Number(await page.locator('.pen-draft').getAttribute('data-pen-preview-appends')) >= 2)
  await page.keyboard.press('Enter')
  check('Enter completes an open Pen path', await vectorPaths.count() === pathsBeforeEnter + 1 && await canvas.evaluate((node) => node.classList.contains('tool-node')))
  await rail.getByLabel('Pen tool').click()
  const pathsBeforeCancel = await vectorPaths.count()
  await enterPenSurface.dispatchEvent('pointerdown', { button: 0, clientX: enterBounds.x + 650, clientY: enterBounds.y + 320, pointerId: 10 })
  await page.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 10 })), { x: enterBounds.x + 650, y: enterBounds.y + 320 })
  await page.keyboard.press('Escape')
  check('Escape abandons the draft but keeps the Pen tool active', await vectorPaths.count() === pathsBeforeCancel && await canvas.evaluate((node) => node.classList.contains('tool-pen')))
  await page.keyboard.press('Escape')
  check('a second Escape returns to the Select tool', await canvas.evaluate((node) => node.classList.contains('tool-select')))

  // Viewport regression captures: no horizontal document overflow and toolbar remains reachable.
  for (const [width, height, name] of [[1280, 800, '06-standard-width'], [1180, 760, '07-laptop-width'], [1024, 680, '08-compressed-width'], [760, 720, '09-compact-width']]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(150)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`${width}px workspace avoids page-level horizontal overflow`, overflow <= 1, `overflow: ${overflow}px`)
    check(`${width}px toolbar remains visible`, await rail.isVisible())
    const strip = page.locator('.project-board-strip')
    if (await strip.isVisible()) {
      const stripBounds = await strip.boundingBox()
      check(`${width}px board strip fits viewport`, Boolean(stripBounds && stripBounds.x >= -1 && stripBounds.x + stripBounds.width <= width + 1))
    }
    await screenshot(name)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedMotionDuration = await page.locator('.canvas-tool-rail button').first().evaluate((element) => getComputedStyle(element).transitionDuration)
  check('reduced motion removes tool transitions', reducedMotionDuration.split(',').every((value) => parseFloat(value) <= 0.001), reducedMotionDuration)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  // Responsive refinement: keyboard focus, selected state, tooltip content,
  // and the minimum readable type scale must survive compact layouts.
  const selectTool = rail.getByLabel('Select and move')
  await selectTool.click()
  const focusRule = await page.evaluate(() => Array.from(document.styleSheets).some((sheet) => {
    try { return Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('focus-visible') && rule.cssText.includes('outline')) } catch { return false }
  }))
  check('keyboard focus ring remains defined', focusRule)
  check('selected tool has a distinct active state', await selectTool.evaluate((element) => element.classList.contains('active')))
  await selectTool.hover()
  const tooltipContent = await selectTool.evaluate((element) => getComputedStyle(element, '::after').content)
  check('canvas tooltips expose readable labels', tooltipContent.includes('Select and move'))
  const compactToolbarSizes = await page.locator('.canvas-toolbar :is(button, select, input)').evaluateAll((elements) => elements.filter((element) => element.offsetParent !== null).map((element) => parseFloat(getComputedStyle(element).fontSize)))
  check('compact toolbar controls stay at or above 10px', compactToolbarSizes.length > 0 && Math.min(...compactToolbarSizes) >= 10, JSON.stringify(compactToolbarSizes))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(100)
  await audit('dark canvas workspace')

  const boardNavigation = page.getByRole('navigation', { name: 'Board navigation' })
  // Return from the isolated vector fixture to the original populated demo
  // board before testing portals alongside its columns/media.
  await page.locator('.navigator .board-tree-row').filter({ hasText: 'Master reference board' }).click()
  await page.waitForFunction(() => document.querySelector('.board-navigation [aria-current="page"]')?.textContent?.includes('Master reference board'))
  const boardActions = boardNavigation.getByRole('button', { name: /^Actions for / })
  await boardActions.click()
  const boardActionsMenu = boardNavigation.getByRole('menu', { name: /^Actions for / })
  check('subboard actions are grouped beside the breadcrumb', await boardActionsMenu.getByRole('menuitem', { name: 'Create subboard inside…' }).isVisible() && await boardActionsMenu.getByRole('menuitem', { name: 'Change board icon or image…' }).isVisible())
  await boardActionsMenu.getByRole('menuitem', { name: 'Change board icon or image…' }).click()
  check('board icon picker remains available from board actions', await boardNavigation.locator('.board-cover-picker').isVisible())
  await boardNavigation.locator('.board-cover-picker').getByRole('button', { name: 'Close image chooser' }).click()
  await rail.getByRole('button', { name: 'Create subboard' }).click()
  const createSubboardDialog = page.getByRole('dialog', { name: 'Create subboard' })
  await createSubboardDialog.getByLabel('Subboard title').fill('UI QA subboard')
  await createSubboardDialog.getByRole('button', { name: 'Save' }).click()
  const portal = page.locator('.node-child-board').filter({ hasText: 'UI QA subboard' })
  await portal.waitFor()
  check('creating a subboard places a portal tile without navigating', await portal.isVisible() && await boardNavigation.getByRole('button', { name: 'Master reference board', exact: true }).getAttribute('aria-current') === 'page')
  await portal.click({ button: 'right' })
  const portalMenu = page.locator('.canvas-context-menu')
  check('portal exposes title, color, appearance and subtree Trash actions', await portalMenu.getByText('Rename board…').isVisible() && await portalMenu.getByLabel('Subboard tile color').isVisible() && await portalMenu.getByText('Tile appearance…').isVisible() && await portalMenu.getByText('Move board and contents to Trash…').isVisible())
  await portalMenu.getByText('Tile appearance…').click()
  const appearancePicker = page.locator('.tile-appearance-picker')
  await appearancePicker.waitFor()
  check('appearance picker opens with a searchable recommended icon grid', await appearancePicker.getByLabel('Search tile icons').isVisible() && await appearancePicker.locator('.tile-appearance-grid:not(.compact) button').count() >= 8)
  await appearancePicker.getByLabel('Search tile icons').fill('star')
  await appearancePicker.getByLabel('Icon category').selectOption('All')
  await appearancePicker.locator('.tile-appearance-grid:not(.compact) button').first().click()
  check('subboard icon updates on the portal from the picker', await portal.locator('.board-link-icon').getByText('✦').isVisible() && await appearancePicker.locator('.tile-appearance-grid button.selected').count() >= 1)
  await appearancePicker.getByRole('tab', { name: 'Image' }).click()
  check('appearance picker image mode offers choose and status', await appearancePicker.locator('.tile-appearance-image strong').isVisible() && (await appearancePicker.locator('.tile-appearance-actions .primary-button').innerText()).includes('Choose image'))
  await page.keyboard.press('Escape')
  check('appearance picker closes on Escape', await appearancePicker.count() === 0)
  await portal.locator('.child-board-card').dblclick()
  await boardNavigation.getByRole('button', { name: 'UI QA subboard', exact: true }).waitFor()
  check('double-click opens the portal as a breadcrumb destination', await boardNavigation.getByRole('button', { name: 'UI QA subboard', exact: true }).getAttribute('aria-current') === 'page')
  const nestedStage = page.locator('.canvas-stage').first()
  const nestedBounds = await nestedStage.boundingBox()
  assert(nestedBounds, 'nested board canvas needs bounds')
  const nestedShapesBefore = await page.locator('.board-node.node-shape').count()
  await page.locator('.canvas-tool-rail').getByLabel('Draw rectangle').click()
  await page.mouse.move(nestedBounds.x + 330, nestedBounds.y + 220)
  await page.mouse.down()
  await page.mouse.move(nestedBounds.x + 450, nestedBounds.y + 300)
  await page.mouse.up()
  check('subboard retains its own canvas content', await page.locator('.board-node.node-shape').count() === nestedShapesBefore + 1)
  await boardNavigation.getByRole('button', { name: 'Open parent board' }).click()
  check('subboard tile remains on the parent beside other cards', await portal.isVisible() && await page.locator('.node-column').count() > 0)
  await portal.click({ button: 'right' })
  check('portal Trash action names the owned board and its contents', await page.locator('.canvas-context-menu').getByText('Move board and contents to Trash…').isVisible())
  await page.keyboard.press('Escape')

  // The floating presenter route must be a clean, non-editable board surface.
  await page.goto(`${baseUrl}&view-board=master-reference-board`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Visual board').waitFor()
  check('floating view-only route uses presentation shell', await page.locator('.studio-shell.view-only-shell').count() === 1)
  check('floating view-only route hides project navigation', await page.locator('.view-only-shell .navigator').isHidden())
  check('floating view-only route hides editing toolbar', await page.locator('.view-only-shell .canvas-toolbar').isHidden())
  check('floating view-only route keeps the board visible', await page.locator('.view-only-shell .canvas-stage').isVisible())

  check('no frontend errors during validation', report.browserErrors.length === 0, report.browserErrors.join('\n'))
  if (failures.length) throw new Error(`UI validation failures:\n${failures.join('\n')}`)
  report.passed = true
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  await writeFile(resolve(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await context.close()
  await browser.close()
}

console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, report: resolve(artifactDir, 'report.json') }))
