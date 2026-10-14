import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:4173/?catalog=demo'
const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({ executablePath, headless: true })
const results = []
try {
  for (const [scale, width, height] of [[1, 1920, 1080], [1.5, 1280, 720], [2, 960, 540]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale })
    const page = await context.newPage()
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.locator('.studio-shell').waitFor()
    const geometry = await page.evaluate(() => ({
      dpr: window.devicePixelRatio,
      viewport: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      appBar: Boolean(document.querySelector('.app-bar')?.getBoundingClientRect().height),
    }))
    assert.equal(geometry.dpr, scale)
    assert.ok(geometry.overflow <= 1, `horizontal page overflow at ${scale}x: ${geometry.overflow}`)
    assert.ok(geometry.appBar)
    await page.getByRole('button', { name: 'Canvas', exact: true }).first().click()
    await page.getByLabel('Visual board').waitFor()
    const canvas = await page.getByLabel('Visual board').boundingBox()
    assert.ok(canvas && canvas.width > 180 && canvas.height > 180, `canvas unusable at ${scale}x`)
    const tool = page.getByRole('button', { name: 'Select and move' })
    assert.ok(await tool.isVisible(), `selection tool hidden at ${scale}x`)
    if (scale === 1) {
      await page.getByRole('button', { name: 'Split', exact: true }).click()
      await page.getByRole('button', { name: 'Toggle Appearance panel' }).click()
      await page.getByRole('dialog', { name: 'Appearance' }).getByRole('button', { name: 'Toggle board filmstrip' }).click()
      assert.ok(await page.getByRole('region', { name: 'Board filmstrip' }).isVisible())
      await page.getByRole('region', { name: 'Project boards' }).waitFor({ state: 'detached' })
      assert.equal(await page.getByRole('region', { name: 'Project boards' }).count(), 0, 'Split mode should not show two root-board strips')
    }
    results.push({ scale, width, height, geometry, canvas: { width: canvas.width, height: canvas.height } })
    await context.close()
  }
} finally {
  await browser.close()
}
console.log('Effective Windows scaling geometry: PASS', JSON.stringify(results))
