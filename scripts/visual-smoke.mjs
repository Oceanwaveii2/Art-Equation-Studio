import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const artifacts = resolve('artifacts')
await mkdir(artifacts, { recursive: true })

const browser = await chromium.launch({ executablePath: edge, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Add item' }).click()
await page.getByRole('menu', { name: 'New project item' }).getByRole('button', { name: /New document/ }).click()
await page.getByRole('button', { name: 'Add item' }).click()
await page.getByRole('menu', { name: 'New project item' }).getByRole('button', { name: /New board/ }).click()
await page.getByLabel('Project navigator').getByRole('button', { name: /Master reference board/ }).click()
await page.getByLabel('Project navigator').getByRole('button', { name: /Project brief/ }).click()
await page.getByRole('button', { name: 'Split', exact: true }).click()
const filmstrip = page.getByRole('region', { name: 'Board filmstrip' })
await filmstrip.waitFor()
await filmstrip.getByRole('button', { name: 'Duplicate', exact: true }).click()
page.once('dialog', (dialog) => dialog.accept())
await filmstrip.getByRole('button', { name: 'Delete', exact: true }).click()
await filmstrip.getByRole('button', { name: /Open board Master reference board/ }).click()
await page.screenshot({ path: resolve(artifacts, 'split-workspace.png'), fullPage: true })
await page.getByRole('button', { name: 'Canvas', exact: true }).click()
await page.getByRole('button', { name: 'Add rich text' }).click()
await page.getByRole('button', { name: 'Toggle color controls' }).click()
await page.locator('[aria-label="Color controls"]').waitFor()
await page.getByRole('button', { name: 'Stroke' }).click()
await page.getByLabel('Hex color').fill('#4EA7A1')
await page.getByRole('button', { name: 'Text', exact: true }).click()
await page.getByLabel('Hex color').fill('#F2EBDD')
await page.screenshot({ path: resolve(artifacts, 'professional-color-panel.png'), fullPage: true })
await page.getByRole('button', { name: 'Close color controls' }).click()
await page.getByRole('button', { name: 'Add diagram shape' }).click()
await page.getByRole('button', { name: 'Connect cards' }).click()
await page.getByLabel('shape card: Process step').click()
await page.getByLabel('column card: Environment').getByText('Environment', { exact: true }).click()
await page.getByRole('button', { name: 'Fit', exact: true }).click()
await page.getByRole('button', { name: 'Duplicate selected cards' }).click()
await page.getByRole('button', { name: 'Delete selected cards' }).click()
await page.screenshot({ path: resolve(artifacts, 'canvas-workspace.png'), fullPage: true })
await page.getByRole('button', { name: 'Document', exact: true }).click()
await page.getByRole('button', { name: 'Bold' }).click()
await page.getByRole('button', { name: 'More formatting' }).click()
await page.getByRole('button', { name: /Insert table/ }).click()
await page.getByRole('button', { name: 'Toggle document outline' }).click()
const outline = page.getByRole('navigation', { name: 'Document outline' })
await outline.waitFor()
await outline.getByRole('button').nth(1).click()
await page.screenshot({ path: resolve(artifacts, 'document-workspace.png'), fullPage: true })
await page.getByRole('button', { name: 'Flow', exact: true }).click()
await page.screenshot({ path: resolve(artifacts, 'document-flow-workspace.png'), fullPage: true })
await page.getByRole('button', { name: 'Pages', exact: true }).click()
await page.getByRole('button', { name: 'Toggle document outline' }).click()

const metrics = await page.evaluate(() => ({
  viewportWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  viewportHeight: document.documentElement.clientHeight,
  scrollHeight: document.documentElement.scrollHeight,
}))
await page.setViewportSize({ width: 1040, height: 680 })
await page.getByRole('button', { name: 'Split', exact: true }).click()
await page.screenshot({ path: resolve(artifacts, 'compact-split-workspace.png'), fullPage: true })
await page.getByRole('button', { name: 'Manage' }).click()
await page.getByRole('region', { name: 'Asset manager' }).waitFor()
await page.screenshot({ path: resolve(artifacts, 'asset-manager.png'), fullPage: true })
await page.getByRole('button', { name: 'Done' }).click()
const compactMetrics = await page.evaluate(() => ({
  viewportWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  viewportHeight: document.documentElement.clientHeight,
  scrollHeight: document.documentElement.scrollHeight,
}))
await page.setViewportSize({ width: 1440, height: 900 })
await page.goto('http://127.0.0.1:5173/?catalog=demo', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Manage' }).click()
await page.getByRole('button', { name: 'Auto-organize' }).click()
await page.getByRole('button', { name: 'Undo catalog change' }).click()
await page.screenshot({ path: resolve(artifacts, 'asset-manager-populated.png'), fullPage: true })
await page.setViewportSize({ width: 1440, height: 900 })
await page.goto('http://127.0.0.1:5173/?stress=1000', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Canvas', exact: true }).click()
await page.waitForTimeout(250)
const stressMetrics = await page.evaluate(() => ({
  modelNodeCount: 1000,
  renderedNodeCount: document.querySelectorAll('.board-node').length,
  gpuCanvasCount: document.querySelectorAll('.gpu-board-canvas').length,
}))
await page.screenshot({ path: resolve(artifacts, 'stress-1000-workspace.png'), fullPage: true })
console.log(JSON.stringify({ metrics, compactMetrics, stressMetrics, errors }, null, 2))
await browser.close()
