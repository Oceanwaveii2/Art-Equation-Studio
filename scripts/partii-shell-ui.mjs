import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const source = ts.transpileModule(await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { createBlankProject } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const fixture = createBlankProject('Part II isolated shell QA')
fixture.id = 'partii-shell-isolated'
fixture.assets = []
fixture.boards = [{ id: 'shell-root', title: 'Shell root', linkedFolderPath: `projects/${fixture.id}/boards/shell-root`, viewport: { x: 0, y: 0, scale: 1 }, connectors: [], nodes: [{ id: 'shell-column', kind: 'column', title: 'Canvas behind menu', x: 0, y: 130, width: 380, height: 500 }, { id: 'shell-note', kind: 'note', title: 'Shell reference', body: 'Isolated fixture — never a live project.', x: 410, y: 190, width: 260, height: 160 }] }]
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-shell')
await mkdir(artifacts, { recursive: true })
const report = { generatedAt: new Date().toISOString(), baseUrl, passed: false, checks: [], screenshots: [], browserErrors: [], themeSamples: {}, limitation: 'Fresh headless Edge browser; mocked in-memory persistence only. Does not establish native WebView stacking, physical Windows DPI, full accessibility or Vello pixels.' }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.on('pageerror', (error) => report.browserErrors.push(error.message))
await page.addInitScript((initial) => {
  const backend = { project: structuredClone(initial), settings: { schemaVersion: 5, theme: 'dark', viewMode: 'canvas', activeProjectId: initial.id, projectNavigation: { [initial.id]: { activeBoardId: 'shell-root', activeDocumentId: initial.documents[0].id, activeNavigatorItem: 'board:shell-root', viewMode: 'canvas' } } }, calls: [] }
  window.__shellBackend = backend
  localStorage.setItem('art-equation.navigator', '1')
  localStorage.setItem('art-equation.inspector', '0')
  localStorage.setItem('art-equation.view-mode', 'canvas')
  localStorage.setItem('art-equation.canvas-tools', '1')
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, convertFileSrc: (value) => value,
    invoke: async (command, args = {}) => {
      backend.calls.push({ command, args: structuredClone(args) })
      if (command === 'workspace_info') return { root: 'MEMORY-ONLY-NO-DISK', workspaceId: 'isolated-shell', readOnly: false, lockOwned: true }
      if (command === 'list_projects') return [{ id: backend.project.id, title: backend.project.title, updatedAt: backend.project.updatedAt, boardCount: backend.project.boards.length, assetCount: 0, status: backend.project.status }]
      if (command === 'load_json') return structuredClone(args.relativePath === 'settings.json' ? backend.settings : backend.project)
      if (command === 'save_json') { if (args.relativePath === 'settings.json') backend.settings = structuredClone(args.value); else if (args.relativePath.endsWith('/project.json')) backend.project = structuredClone(args.value); return }
      if (['ensure_managed_board_folders', 'ensure_project_workspace', 'plugin:event|unlisten'].includes(command)) return
      if (['list_project_trash', 'list_trashed_projects', 'audit_assets'].includes(command)) return []
      if (command === 'plugin:event|listen' || command === 'plugin:window|scale_factor') return 1
      if (command === 'plugin:window|inner_size') return { width: innerWidth, height: innerHeight }
      if (command === 'mini_bridge_launch') return null
      throw new Error(`Isolated shell mock does not permit ${command}`)
    } }
}, fixture)
const check = (name, passed, detail) => report.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) })
const settled = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
const screenshot = async (name) => { await page.screenshot({ path: resolve(artifacts, `${name}.png`), fullPage: true }); report.screenshots.push(`${name}.png`) }
const menu = () => page.getByRole('menu', { name: 'Actions for Shell root', exact: true })
const trigger = () => page.getByRole('complementary', { name: 'Project navigator', exact: true }).getByRole('button', { name: 'Actions for Shell root', exact: true })
async function openMenu() { await trigger().focus(); await page.keyboard.press('Enter'); await menu().waitFor(); await settled() }
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('.board-node[data-node-id="shell-column"]').waitFor()
  await settled()
  const select = page.getByRole('button', { name: 'Select and move', exact: true })
  const pointer = await select.locator('svg path').evaluate((item) => ({ d: item.getAttribute('d'), fill: item.getAttribute('fill'), width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height }))
  check('selection tool renders a filled conventional pointer silhouette', pointer.d === 'M5 2v17l4-5 4 7 3-1-4-7 7-1Z' && pointer.fill === 'currentColor' && pointer.width > 0 && pointer.height > 0, pointer)
  await select.click(); check('pointer button selects the move tool', await select.getAttribute('aria-pressed') === 'true')
  const fish = page.getByRole('button', { name: 'Art Equation aquarium artwork', exact: true })
  await page.waitForFunction(() => document.querySelector('.project-identity img')?.naturalWidth > 0)
  await fish.focus(); await page.keyboard.press('Enter'); await settled()
  check('keyboard Enter sends fish away', await fish.getAttribute('aria-pressed') === 'false' && await fish.evaluate((item) => item.classList.contains('fish-away')))
  await page.keyboard.press('Enter'); await settled()
  check('keyboard Enter brings fish near again', await fish.getAttribute('aria-pressed') === 'true' && await fish.evaluate((item) => item.classList.contains('fish-near')))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.keyboard.press('Enter'); await settled()
  const motion = await fish.evaluate((item) => ({ imageTransition: getComputedStyle(item.querySelector('img')).transitionDuration, rippleAnimation: getComputedStyle(item.querySelector('.fish-ripple')).animationName, pressed: item.getAttribute('aria-pressed') }))
  check('reduced motion eliminates perceptible image tween and disables ripple without blocking toggle', motion.imageTransition.split(',').every((part) => parseFloat(part) <= 0.00001) && motion.rippleAnimation === 'none' && motion.pressed === 'false', motion)
  await screenshot('01-reduced-motion-keyboard-fish')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  for (const theme of ['dark', 'light']) {
    if (theme === 'light') { await page.getByRole('button', { name: 'Use light theme', exact: true }).click(); await settled() }
    for (const width of [1440, 1040]) {
      await page.setViewportSize({ width, height: 1000 }); await settled()
      await openMenu()
      const bounds = await menu().evaluate((item) => {
        const rect = item.getBoundingClientRect(), points = []
        for (const x of [rect.left + 12, rect.left + rect.width / 2, rect.right - 12]) for (const y of [rect.top + 16, rect.top + rect.height / 2, rect.bottom - 16]) points.push({ x, y, topmost: document.elementFromPoint(x, y)?.closest('.navigator-item-menu') === item })
        return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, parent: item.parentElement.className, points, background: getComputedStyle(item).backgroundColor, color: getComputedStyle(item).color }
      })
      check(`${theme} ${width}: navigator menu is portaled above canvas and topmost at all sampled points`, bounds.parent.includes('studio-shell') && bounds.points.every((point) => point.topmost), bounds)
      check(`${theme} ${width}: complete navigator menu is inside viewport`, bounds.rect.left >= 0 && bounds.rect.top >= 0 && bounds.rect.right <= width && bounds.rect.bottom <= 1000, bounds.rect)
      check(`${theme} ${width}: keyboard-open menu focuses first action`, await menu().getByRole('menuitem', { name: 'Open', exact: true }).evaluate((item) => item === document.activeElement))
      report.themeSamples[`${theme}-${width}`] = { menuBackground: bounds.background, menuColor: bounds.color, canvasBackground: await page.locator('.canvas-stage').evaluate((item) => getComputedStyle(item).backgroundColor) }
      await screenshot(`02-menu-${theme}-${width}`)
      await page.keyboard.press('Escape'); await settled()
      check(`${theme} ${width}: Escape dismisses menu and returns focus to its trigger`, await menu().count() === 0 && await trigger().evaluate((item) => item === document.activeElement))
      await openMenu()
      const canvas = await page.locator('.canvas-stage').boundingBox()
      await page.mouse.click(canvas.x + canvas.width - 140, canvas.y + 85); await settled()
      check(`${theme} ${width}: outside canvas click dismisses menu`, await menu().count() === 0)
    }
  }
  check('light and dark canvas/menu surfaces change coherently', report.themeSamples['light-1440'].menuBackground !== report.themeSamples['dark-1440'].menuBackground && report.themeSamples['light-1440'].canvasBackground !== report.themeSamples['dark-1440'].canvasBackground, report.themeSamples)
  check('browser raised no unhandled errors', report.browserErrors.length === 0, report.browserErrors)
  report.passed = report.checks.every((item) => item.passed)
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
