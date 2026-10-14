import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const out = 'output/playwright/video-review-controls'
await fs.mkdir(out, { recursive: true })

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } })
await server.listen()

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true
})

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(server.resolvedUrls.local[0] + 'src/board/VideoReview.tsx')
  await page.evaluate(async () => {
    document.body.replaceChildren()
    const host = document.createElement('div')
    host.style.cssText = 'width:600px;height:450px'
    document.body.append(host)

    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const RefreshRuntime = (await import('/@react-refresh')).default
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true

    const { VideoReview } = await import('/src/board/VideoReview.tsx')

    // Dummy base64 video or minimal canvas stream
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#112233'
    ctx.fillRect(0, 0, 320, 240)
    const stream = canvas.captureStream(30)
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks = []
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
    
    window.__root = createRoot(host)
    window.__annotations = []
    window.__setAnnotations = (val) => { window.__annotations = val }

    window.__mountVideoReview = (src) => {
      window.__root.render(
        React.createElement(VideoReview, {
          source: src,
          title: 'Review Test Video',
          annotations: window.__annotations,
          frameRate: 30,
          onChange: ({ videoAnnotations }) => { window.__annotations = videoAnnotations }
        })
      )
    }

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      window.__mountVideoReview(url)
    }

    mediaRecorder.start()
    setTimeout(() => mediaRecorder.stop(), 100)
  })

  // Wait for video element
  await page.waitForSelector('.video-review video', { timeout: 15000 })
  await page.waitForTimeout(500)

  // Verify Loop control exists and works
  const loopBtn = page.getByRole('button', { name: /loop playback/i })
  assert.equal(await loopBtn.count() > 0, true, 'Loop toggle button must be present')
  await loopBtn.click()
  await page.waitForTimeout(100)
  
  const isLooping = await page.evaluate(() => {
    const v = document.querySelector('video')
    return v?.loop
  })
  assert.equal(isLooping, true, 'Video element loop attribute must be true after toggle')

  // Verify playback speed selector exists
  const rateSelect = page.getByRole('combobox', { name: /playback speed/i })
  assert.equal(await rateSelect.count() > 0, true, 'Playback speed selector must be present')
  await rateSelect.selectOption('1.5')
  await page.waitForTimeout(100)

  const currentRate = await page.evaluate(() => {
    const v = document.querySelector('video')
    return v?.playbackRate
  })
  assert.equal(currentRate, 1.5, 'Video element playbackRate must be 1.5')

  // Verify keyboard navigation
  const reviewContainer = page.locator('.video-review')
  await reviewContainer.focus()
  
  // Press 'm' to mute
  await page.keyboard.press('m')
  await page.waitForTimeout(100)
  const isMuted = await page.evaluate(() => {
    const v = document.querySelector('video')
    return v?.muted
  })
  assert.equal(isMuted, true, 'Mute key shortcut must mute video')

  // Press 'l' to toggle loop back off
  await page.keyboard.press('l')
  await page.waitForTimeout(100)
  const isLoopOff = await page.evaluate(() => {
    const v = document.querySelector('video')
    return v?.loop
  })
  assert.equal(isLoopOff, false, 'Loop key shortcut must toggle loop off')

  await page.screenshot({ path: out + '/video-review.png' })
  assert.deepEqual(errors, [], 'No uncaught page errors')

  await fs.writeFile(
    out + '/report.json',
    JSON.stringify({ passed: true, isLooping, currentRate, errors }, null, 2)
  )
  console.log('Video review controls: PASS')
} finally {
  await browser.close()
  await server.close()
}
