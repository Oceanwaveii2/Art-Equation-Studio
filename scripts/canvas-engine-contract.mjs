import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5173/?catalog=demo'
const browser = await chromium.launch({ executablePath, headless: true })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  const stage = page.locator('.canvas-stage').first()
  const gpu = page.locator('.gpu-board').first()
  await gpu.waitFor()

  const initial = await page.evaluate(() => {
    const stageElement = document.querySelector('.canvas-stage')
    const gpuElement = document.querySelector('.gpu-board')
    return {
      stageRevision: stageElement?.getAttribute('data-engine-scene-revision'),
      gpuRevision: gpuElement?.getAttribute('data-scene-revision'),
      sceneId: gpuElement?.getAttribute('data-scene-id'),
      totalNodes: Number(stageElement?.getAttribute('data-total-nodes') || 0),
    }
  })
  assert(initial.sceneId, 'GPU backdrop should receive a renderer-neutral scene id')
  assert.equal(initial.stageRevision, initial.gpuRevision, 'host and renderer should observe the same scene revision')
  assert(initial.totalNodes > 0, 'adapted scene should contain the current board objects')

  const node = page.locator('.board-node:not(.node-column)').first()
  await node.click({ force: true })
  await stage.press('ArrowRight')
  await page.waitForTimeout(100)
  const changed = await page.evaluate(() => ({
    stageRevision: document.querySelector('.canvas-stage')?.getAttribute('data-engine-scene-revision'),
    gpuRevision: document.querySelector('.gpu-board')?.getAttribute('data-scene-revision'),
  }))
  assert.notEqual(changed.stageRevision, initial.stageRevision, 'board mutation should produce a new scene revision')
  assert.equal(changed.stageRevision, changed.gpuRevision, 'GPU backdrop should receive the changed scene revision')
  assert.equal(await page.locator('.board-node.selected').count(), 1, 'existing board selection should remain functional through the adapter')

  console.log('canvas engine contract: PASS')
} finally {
  await browser.close()
}
