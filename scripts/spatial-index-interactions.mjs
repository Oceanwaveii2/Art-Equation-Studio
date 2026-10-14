import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const baseUrl = process.env.PERF_TEST_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

try {
  await page.goto(`${baseUrl}/?benchmark=generation-0&stress=1000&stress-profile=mixed&canvas-renderer=${process.env.CANVAS_RENDERER || 'dom'}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  const canvas = page.locator('.canvas-stage').first()
  await canvas.waitFor()

  const indexed = Number(await canvas.getAttribute('data-spatial-index-size'))
  const candidates = Number(await canvas.getAttribute('data-spatial-visible-candidates'))
  assert.equal(indexed, 1000, 'the index should contain every scene object')
  assert(candidates > 0 && candidates < indexed, 'the viewport query should cull offscreen objects')

  const stageBounds = await canvas.boundingBox()
  assert(stageBounds, 'canvas bounds should be available')
  const targets = page.locator('.board-node:not(.node-column)')
  let target
  for (let index = 0; index < await targets.count(); index += 1) {
    const candidate = targets.nth(index)
    const bounds = await candidate.boundingBox()
    if (bounds && bounds.x > stageBounds.x + 12 && bounds.y > stageBounds.y + 12 && bounds.x + bounds.width < stageBounds.x + stageBounds.width - 12 && bounds.y + bounds.height < stageBounds.y + stageBounds.height - 12) {
      target = { element: candidate, bounds, id: await candidate.getAttribute('data-node-id') }
      break
    }
  }
  assert(target?.id, 'a fully visible board object should be available for marquee validation')

  await page.keyboard.press('Escape')
  await page.mouse.move(target.bounds.x - 6, target.bounds.y - 6)
  await page.mouse.down()
  await page.mouse.move(target.bounds.x + target.bounds.width + 6, target.bounds.y + target.bounds.height + 6, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(80)
  const selectedIds = await page.locator('.board-node.selected').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-node-id')))
  assert(selectedIds.includes(target.id), 'indexed marquee selection should select the enclosed object')

  console.log(`spatial index interactions: PASS (${candidates}/${indexed} viewport candidates)`)
} finally {
  await browser.close()
}
