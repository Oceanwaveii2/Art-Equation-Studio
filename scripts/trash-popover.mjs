import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5173/?catalog=demo')
  const button = page.getByTestId('trash-button')
  const viewer = page.getByTestId('trash-viewer')
  await button.waitFor()
  for (const [width, height] of [[1440, 900], [700, 700], [360, 640]]) {
    await page.setViewportSize({ width, height })
    await button.click()
    await viewer.waitFor({ state: 'visible' })
    const trigger = await button.boundingBox()
    const panel = await viewer.boundingBox()
    assert(trigger && panel)
    assert(panel.x >= 0 && panel.x + panel.width <= width, `${width}px: Trash panel must fit horizontally`)
    assert(panel.y >= 0 && panel.y + panel.height <= height, `${width}px: Trash panel must fit vertically`)
    const alignedBesideTrigger = Math.abs((panel.y + panel.height) - (trigger.y + trigger.height)) < 3
    const safelyAboveTrigger = panel.y + panel.height <= trigger.y && trigger.y - (panel.y + panel.height) <= 16
    assert(alignedBesideTrigger || safelyAboveTrigger, `${width}px: Trash panel should open beside the trigger when space allows, otherwise just above it`)
    await page.keyboard.press('Escape')
    assert.equal(await viewer.count(), 0, 'Escape dismisses Trash')
    assert.equal(await button.evaluate((element) => document.activeElement === element), true, 'Escape restores trigger focus')
  }
  await button.click()
  await page.locator('.studio-shell header').first().click({ position: { x: 2, y: 2 } })
  assert.equal(await viewer.count(), 0, 'outside click dismisses Trash')
  console.log('Trash popover placement at wide/narrow widths and dismissal: PASS')
} finally {
  await browser.close()
}
