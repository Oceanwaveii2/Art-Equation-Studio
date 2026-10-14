import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const base = process.env.PERF_TEST_BASE_URL || 'http://127.0.0.1:5173'
const report = { cases: [], errors: [] }
await mkdir('output/playwright/retained', { recursive: true })

async function setup(mode, dpr = 1, rotated = false) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(`${base}/?canvas-renderer=${mode}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await page.getByRole('button', { name: '＋ Board', exact: true }).first().click()
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await page.evaluate(() => document.fonts.ready)
  // Let the new board's split-to-canvas resize commit before centering a paste.
  await page.waitForTimeout(650)
  await page.evaluate(rotated => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ee9966'; ctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#226688'; ctx.fillRect(256, 0, 256, 256)
    ctx.fillStyle = '#eeeeee'; ctx.fillRect(30, 30, 50, 50)
    const image = canvas.toDataURL('image/png')
    const nodes = [
      { id: 'a', kind: 'image', x: 0, y: 0, width: 270, height: 220, title: 'Raster A', body: image },
      { id: 'b', kind: 'image', x: 340, y: 0, width: 270, height: 220, title: 'Raster B', body: image, imageTransform: { flipX: true, rotation: rotated ? 90 : 0 } },
      { id: 'c', kind: 'shape', shapeType: 'ellipse', x: 0, y: 300, width: 270, height: 180, title: 'Ellipse', color: '#668877', strokeColor: '#cda36a', strokeWidth: 3, body: 'Shape' },
      { id: 'd', kind: 'shape', shapeType: 'rectangle', x: 340, y: 300, width: 270, height: 180, title: 'Rectangle', color: '#885544', strokeColor: '#cda36a', strokeWidth: 3, body: 'Rectangle' },
    ]
    localStorage.setItem('art-equation-board-clipboard', JSON.stringify({ nodes }))
    window.dispatchEvent(new ClipboardEvent('paste'))
  }, rotated)
  await page.waitForFunction(() => document.querySelectorAll('.board-node').length === 4)
  await page.getByLabel('Fit selection', { exact: true }).click()
  await deselect(page)
  await page.waitForFunction(() => [...document.querySelectorAll('.format-image-preview img')].length === 2 && [...document.querySelectorAll('.format-image-preview img')].every(img => img.complete && img.naturalWidth > 0))
  if (mode !== 'dom') await page.waitForFunction(() => document.querySelectorAll('[data-retained-paint="image"]').length === 2)
  await page.mouse.move(10, 10)
  await page.waitForTimeout(300)
  return page
}
async function deselect(page) {
  await page.locator('.canvas-stage').dispatchEvent('contextmenu', { clientX: 280, clientY: 180 })
  await page.keyboard.press('Escape')
}
async function compare(page, before, after) {
  return page.evaluate(async ({ before, after }) => {
    const decode = async value => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${value}`)).blob())
      const c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext('2d')
      ctx.drawImage(bitmap, 0, 0); bitmap.close(); return ctx.getImageData(0, 0, c.width, c.height)
    }
    const a = await decode(before), b = await decode(after)
    if (a.width !== b.width || a.height !== b.height) throw Error('Different screenshot dimensions')
    let changed = 0, unmatched = 0, totalError = 0, max = 0
    for (let i = 0; i < a.data.length; i += 4) {
      let pixelMax = 0
      for (let c = 0; c < 3; c++) { const delta = Math.abs(a.data[i+c] - b.data[i+c]); totalError += delta; pixelMax = Math.max(pixelMax, delta) }
      if (pixelMax > 12) {
        changed++
        const x = (i / 4) % a.width, y = Math.floor(i / 4 / a.width)
        const minimum = [255, 255, 255], maximum = [0, 0, 0]
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= a.width || y + dy < 0 || y + dy >= a.height) continue
          const j = ((y + dy) * a.width + x + dx) * 4
          for (let c = 0; c < 3; c++) { minimum[c] = Math.min(minimum[c], a.data[j+c]); maximum[c] = Math.max(maximum[c], a.data[j+c]) }
        }
        // Fractional edge coverage blends adjacent colors. Accept only colors
        // within the baseline's one-pixel neighborhood envelope, not arbitrary
        // color differences elsewhere. Solid regions still have a 12/255 limit.
        if (![0, 1, 2].every(c => b.data[i+c] >= minimum[c] - 12 && b.data[i+c] <= maximum[c] + 12)) unmatched++
      }
      max = Math.max(max, pixelMax)
    }
    return { changedFraction: changed / (a.width * a.height), unmatchedFraction: unmatched / (a.width * a.height), meanChannelError: totalError / (a.width * a.height * 3), maxChannelError: max }
  }, { before: before.toString('base64'), after: after.toString('base64') })
}
try {
  const dom = await setup('dom'), raster = await setup('raster'), retained = await setup('retained')
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') for (const page of [dom, raster, retained]) await page.getByRole('button', { name: 'Use light theme' }).click()
    await dom.waitForTimeout(200)
    const baseline = await dom.locator('.canvas-stage').screenshot()
    const baselineWorld = await dom.locator('.board-world').getAttribute('style')
    await writeFile(`output/playwright/retained/${theme}-dom.png`, baseline)
    for (const [mode, page] of [['raster', raster], ['retained', retained]]) {
      const candidate = await page.locator('.canvas-stage').screenshot()
      await writeFile(`output/playwright/retained/${theme}-${mode}.png`, candidate)
      const difference = await compare(page, baseline, candidate)
      const metrics = await page.locator('.gpu-board').evaluate(el => ({ metrics: JSON.parse(el.dataset.retainedMetrics || '{}'), fallback: el.dataset.retainedFallback, world: document.querySelector('.board-world').getAttribute('style'), nodes: [...document.querySelectorAll('.board-node')].map(n => ({left:n.style.left,top:n.style.top,width:n.style.width,height:n.style.height,box:n.getBoundingClientRect().toJSON()})) }))
      report.cases.push({ theme, mode, difference, ...metrics })
      console.log(JSON.stringify(report.cases.at(-1)))
      assert(!metrics.fallback, metrics.fallback)
      assert.equal(metrics.world, baselineWorld, 'fixtures must use the same world/grid coordinates')
      // DOM and GPU rasterize fractional edges differently. Keep the raw error
      // visible, allow one physical-pixel edge coverage, and gate the unmatched
      // pixels and overall channel error independently.
      assert(difference.unmatchedFraction < .005 && difference.meanChannelError < 1.5, `${theme} ${mode} pixel parity failed`)
    }
  }
  assert.equal(await retained.locator('[data-retained-paint]').count(), 4)
  const before = await retained.locator('.gpu-board').evaluate(el => JSON.parse(el.dataset.retainedMetrics))
  await retained.locator('.canvas-stage').dispatchEvent('wheel', { deltaY: 20 })
  await retained.waitForTimeout(250)
  const after = await retained.locator('.gpu-board').evaluate(el => JSON.parse(el.dataset.retainedMetrics))
  assert.equal(after.builds, before.builds, 'pan must not rebuild skins')
  assert.equal(after.uploads, before.uploads, 'pan must not upload images')
  await retained.locator('.node-image').first().click({ force: true })
  assert.equal(await retained.locator('.node-image.selected').getAttribute('data-retained-paint'), null)
  await retained.keyboard.press('ArrowRight')
  await retained.getByLabel('Undo board change', { exact: true }).click()
  await deselect(retained)
  await retained.waitForFunction(() => document.querySelectorAll('[data-retained-paint="image"]').length === 2)
  await retained.evaluate(() => {
    const canvas = document.querySelector('.gpu-board-canvas')
    window.loss = (canvas.getContext('webgl2') || canvas.getContext('webgl')).getExtension('WEBGL_lose_context')
    window.loss.loseContext()
  })
  await retained.waitForFunction(() => document.querySelector('.gpu-board').dataset.renderState === 'context-lost')
  assert.equal(await retained.locator('[data-retained-paint]').count(), 0, 'context loss must immediately reveal DOM')
  await retained.waitForTimeout(150)
  await retained.evaluate(() => window.loss.restoreContext())
  await retained.waitForFunction(() => document.querySelectorAll('[data-retained-paint="image"]').length === 2)
  // Removing the final owners must release image and skin resources, while
  // undo restores the original scene using freshly owned GPU resources.
  await retained.locator('.canvas-stage').focus()
  for (let i = 0; i < 4; i++) await retained.locator('.board-node').nth(i).click({ force: true, modifiers: ['Shift'] })
  await retained.keyboard.press('Delete')
  await retained.waitForFunction(() => document.querySelectorAll('.board-node').length === 0)
  const empty = await retained.locator('.gpu-board').evaluate(el => JSON.parse(el.dataset.retainedMetrics))
  assert.equal(empty.bytes, 0); assert.equal(empty.images, 0); assert.equal(empty.skins, 0)
  await retained.getByLabel('Undo board change', { exact: true }).click()
  await deselect(retained)
  await retained.waitForFunction(() => document.querySelectorAll('[data-retained-paint="image"]').length === 2)
  report.lifecycle = { panReuse: true, selectionUndo: true, contextRecovery: true, removalBytes: empty.bytes }
  for (const page of [dom, raster, retained]) await page.context().close()
  // Exercise the clipped rotation path, physical-pixel backing store, and
  // non-scaling ellipse strokes at more than one zoom within a LOD bucket.
  const highDom = await setup('dom', 2, true), highGpu = await setup('retained', 2, true)
  for (const zoom of ['fit', '100', 'in']) {
    if (zoom !== 'fit') for (const page of [highDom, highGpu]) {
      await page.getByLabel(zoom === '100' ? 'Zoom to 100 percent' : 'Zoom in', { exact: true }).click()
    }
    await highGpu.waitForTimeout(200)
    const a = await highDom.locator('.canvas-stage').screenshot(), b = await highGpu.locator('.canvas-stage').screenshot()
    const difference = await compare(highGpu, a, b)
    report.cases.push({ mode: 'retained', dpr: 2, rotated: true, zoom, difference })
    await writeFile(`output/playwright/retained/dpr2-${zoom}-dom.png`, a); await writeFile(`output/playwright/retained/dpr2-${zoom}-retained.png`, b)
    assert(difference.unmatchedFraction < .005 && difference.meanChannelError < 1.5, `DPR2 ${zoom} rotated parity failed: ${JSON.stringify(difference)}`)
  }
  report.gpu = await highGpu.evaluate(() => {
    const canvas = document.querySelector('.gpu-board-canvas'), gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return { vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) }
  })
  const replacement = await highGpu.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512
    const ctx = c.getContext('2d'); ctx.fillStyle = '#33aa66'; ctx.fillRect(0,0,256,512); ctx.fillStyle = '#bb6633'; ctx.fillRect(0,256,256,256)
    return c.toDataURL('image/png')
  })
  for (let index = 0; index < 2; index++) {
    for (const page of [highDom, highGpu]) await page.locator('.format-image-preview img').nth(index).evaluate((img, source) => { img.src = source }, replacement)
    await highGpu.waitForFunction(expected => {
      const gpu = document.querySelector('.gpu-board'), m = JSON.parse(gpu.dataset.retainedMetrics)
      return m.images === expected && document.querySelectorAll('[data-retained-paint="image"]').length === 2
    }, index === 0 ? 2 : 1)
  }
  await highGpu.waitForTimeout(200)
  const sourceDifference = await compare(highGpu, await highDom.locator('.canvas-stage').screenshot(), await highGpu.locator('.canvas-stage').screenshot())
  assert(sourceDifference.unmatchedFraction < .005 && sourceDifference.meanChannelError < 1.5, `source replacement parity: ${JSON.stringify(sourceDifference)}`)
  // A real two-frame APNG must keep its live DOM image, even with a .png suffix.
  const apng = `data:image/png;base64,${(await readFile('scripts/fixtures/retained-animated.png')).toString('base64')}`
  await highGpu.locator('.format-image-preview img').first().evaluate((img, source) => { img.src = source }, apng)
  await highGpu.waitForFunction(() => {
    const node = document.querySelector('.node-image'), img = node.querySelector('img')
    return img.complete && img.naturalWidth === 32 && !node.dataset.retainedPaint && getComputedStyle(img).opacity === '1'
  })
  report.lifecycle.sourceReplacement = true; report.lifecycle.apngFallback = true
  assert.equal(report.errors.length, 0, report.errors.join('\n'))
  report.passed = true
  console.log('Retained raster/board parity and interaction checks: PASS')
} finally {
  await writeFile('output/playwright/retained/report.json', JSON.stringify(report, null, 2))
  await browser.close()
}
