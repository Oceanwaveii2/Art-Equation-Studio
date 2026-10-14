import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

await page.goto(process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5173/?catalog=demo', { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'Canvas', exact: true }).click()
await page.locator('.gpu-board-canvas').waitFor()

const metrics = await page.evaluate(() => {
  const gpu = document.querySelector('.gpu-board')
  const gpuCanvas = document.querySelector('.gpu-board-canvas')
  const minimap = document.querySelector('.board-minimap canvas')
  return {
    dpr: window.devicePixelRatio,
    gpuWidth: gpuCanvas?.width || 0,
    gpuCssWidth: gpuCanvas?.clientWidth || 0,
    minimapWidth: minimap?.width || 0,
    minimapCssWidth: minimap?.clientWidth || 0,
    renderScale: Number(gpu?.dataset.renderScale || 0),
    renderPixels: Number(gpu?.dataset.renderPixels || 0),
  }
})

assert(metrics.dpr >= 2, 'test browser should expose a HiDPI device-pixel ratio')
assert(metrics.gpuWidth >= metrics.gpuCssWidth * 1.9, 'GPU backing store should scale with DPR')
assert(metrics.minimapWidth >= metrics.minimapCssWidth * 1.9, 'minimap backing store should scale with DPR')
assert(metrics.renderScale >= 1.9 && metrics.renderScale <= 2, 'render scale should retain 2× detail within the pixel budget')
assert(metrics.renderPixels > 0 && metrics.renderPixels <= 16_777_216, 'GPU backing store should report a bounded render-pixel budget')

await browser.close()
console.log('HiDPI rendering: PASS', metrics)
