import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5173/?catalog=demo'
const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const artifactDir = resolve('artifacts', 'media-preview')
const report = { passed: false, generatedAt: new Date().toISOString(), checks: [], screenshots: [], browserErrors: [] }
const failures = []

await mkdir(artifactDir, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((context) => context.newPage())
page.on('pageerror', (error) => report.browserErrors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') report.browserErrors.push(message.text()) })

function check(name, condition, detail = '') {
  report.checks.push({ name, passed: Boolean(condition), detail: condition ? undefined : detail })
  if (!condition) failures.push(detail || name)
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await page.getByLabel('Search project', { exact: true }).waitFor()
await page.getByRole('button', { name: 'Canvas', exact: true }).click()
await page.locator('.canvas-stage').first().waitFor()
await page.getByRole('button', { name: 'Toggle Appearance panel' }).click()
await page.getByRole('dialog', { name: 'Appearance' }).getByLabel('Fit board').click()
await page.keyboard.press('Escape')
const overlay = page.locator('.asset-preview-overlay')
const overlayHeader = page.locator('.asset-preview-overlay header')
const stage = page.locator('.asset-preview-stage')
const readout = page.locator('.preview-zoom-readout')

// Image preview keeps its fit/1:1 behavior and gains continuous zoom.
await page.locator('.board-node.node-image').filter({ hasText: 'Rainee silhouette reference' }).first().dblclick()
await overlay.waitFor()
check('Image double-click opens the media preview overlay', await overlay.isVisible())
check('Image preview renders the raster stage', await stage.getAttribute('class').then((value) => value?.includes('kind-image') ?? false))
check('Image preview still offers the 1:1 click toggle', await stage.getAttribute('class').then((value) => value?.includes('zoomed') === false))
check('Image preview shows zoom controls', await overlayHeader.getByTitle('Zoom in').isVisible())
check('Image preview starts at 100%', (await readout.textContent()) === '100%')
await overlayHeader.getByTitle('Zoom in').click()
check('Zoom-in button raises the readout', (await readout.textContent()) === '125%')
await overlayHeader.getByTitle('Reset zoom and pan to fit').click()
check('Fit button restores 100%', (await readout.textContent()) === '100%')
await stage.hover()
await page.mouse.wheel(0, -240)
check('Mouse wheel zooms the stage', Number.parseInt(await readout.textContent() ?? '0') > 100)
const zoomed = await readout.textContent()
await page.screenshot({ path: resolve(artifactDir, '01-image-zoomed.png') })
await page.keyboard.press('Escape')
check('Escape closes the preview', !(await overlay.isVisible()))

// Video preview plays inside the overlay.
await page.locator('.board-node.node-video:not(.column-child)').first().dblclick()
await overlay.waitFor()
check('Video double-click opens the media preview overlay', await overlay.isVisible())
check('Video preview renders a video element', await page.locator('.asset-preview-stage video').isVisible())
check('Video preview shows native controls', await page.locator('.asset-preview-stage video').evaluate((element) => element.controls))
check('Video preview labels the kind', (await overlay.locator('header small').textContent())?.includes('VIDEO'))
await page.screenshot({ path: resolve(artifactDir, '02-video-preview.png') })
const videoTransformBefore = await page.locator('.asset-preview-stage video').evaluate((element) => getComputedStyle(element).transform)
await page.mouse.wheel(0, -240)
await page.locator('.asset-preview-stage').first().hover()
await page.mouse.down()
await page.mouse.move(900, 600)
await page.mouse.up()
const videoTransformAfter = await page.locator('.asset-preview-stage video').evaluate((element) => getComputedStyle(element).transform)
check('Zoomed video pans by dragging', videoTransformBefore !== videoTransformAfter)
await page.keyboard.press('Escape')

// 3D model preview mounts the orbit viewer.
await page.locator('.board-node.node-model').first().dblclick()
await overlay.waitFor()
check('Model double-click opens the media preview overlay', await overlay.isVisible())
check('Model preview mounts the 3D viewer', await page.locator('.asset-preview-stage .model-viewer').waitFor({ timeout: 15000 }).then(() => true, () => false))
check('Model preview labels the kind', (await overlay.locator('header small').textContent())?.includes('3D MODEL'))
check('Model preview omits raster zoom controls', !(await overlayHeader.getByTitle('Zoom in').isVisible().catch(() => false)))
await page.screenshot({ path: resolve(artifactDir, '03-model-preview.png') })

// Arrow keys walk the combined media list across kinds.
await page.keyboard.press('ArrowRight')
await overlay.locator('.asset-preview-stage').waitFor()
const afterArrowKind = await stage.getAttribute('class')
check('Arrow navigation moves across media kinds', Boolean(afterArrowKind?.match(/kind-(image|video|model)/)))
await page.keyboard.press('Escape')
check('Escape closes the model preview', !(await overlay.isVisible()))

check('No browser errors during media preview checks', report.browserErrors.length === 0, report.browserErrors.join('; '))

report.screenshots = ['01-image-zoomed.png', '02-video-preview.png', '03-model-preview.png']
report.passed = failures.length === 0
await writeFile(resolve(artifactDir, 'report.json'), JSON.stringify(report, null, 2))
await browser.close()
console.log(report.passed ? `media preview: PASS (${report.checks.length} checks, zoom ${zoomed})` : `media preview: FAIL\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
process.exit(report.passed ? 0 : 1)
