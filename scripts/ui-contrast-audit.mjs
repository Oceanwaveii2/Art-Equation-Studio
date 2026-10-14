import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright-core'

const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:4173/?catalog=demo'
const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const output = resolve('artifacts', 'ui-validation', 'contrast-audit.json')
await mkdir(resolve('artifacts', 'ui-validation'), { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const report = []
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('.studio-shell').waitFor()
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Use light theme' }).click()
    await page.waitForTimeout(350)
    for (const scope of ['.app-bar', '.navigator', '.project-inspector', '.board-navigation', '.pane-toolbar', '.project-board-strip', '.studio-shell']) {
      if (!await page.locator(scope).first().isVisible()) continue
      const results = await new AxeBuilder({ page }).include(scope).withRules(['color-contrast']).analyze()
      report.push({ theme, scope, violations: results.violations.flatMap((violation) => violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary, html: node.html.slice(0, 220) }))) })
    }
    await page.getByRole('button', { name: 'Manage files' }).click()
    await page.getByRole('region', { name: 'Project Mini Bridge' }).waitFor()
    const results = await new AxeBuilder({ page }).include('.asset-manager.mini-bridge').withRules(['color-contrast']).analyze()
    report.push({ theme, scope: 'Mini Bridge', violations: results.violations.flatMap((violation) => violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary, html: node.html.slice(0, 220) }))) })
    await page.getByRole('region', { name: 'Project Mini Bridge' }).getByRole('button', { name: 'Done' }).click()
  }
} finally {
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  await context.close()
  await browser.close()
}
console.log(JSON.stringify(report.map(({ theme, scope, violations }) => ({ theme, scope, count: violations.length }))))
assert.equal(report.reduce((total, entry) => total + entry.violations.length, 0), 0, 'visible Vello shell and Mini Bridge must not have text contrast violations')
