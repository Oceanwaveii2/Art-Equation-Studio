import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const executablePath = process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const baseUrl = process.env.PERF_TEST_BASE_URL || 'http://127.0.0.1:5173'
const artifactDir = resolve('artifacts', 'performance-baseline')
const requestedSizes = (process.env.PERF_STRESS_SIZES || '100,1000,5000,20000').split(',').map(Number)
const requestedProfiles = (process.env.PERF_STRESS_PROFILES || 'mixed,raster,vector').split(',')
const runLabel = (process.env.PERF_RUN_LABEL || 'generation-0').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
const validSizes = new Set([100, 1_000, 5_000, 20_000])
const validProfiles = new Set(['mixed', 'raster', 'vector'])
const sizes = requestedSizes.filter((value) => validSizes.has(value))
const profiles = requestedProfiles.filter((value) => validProfiles.has(value))

if (!sizes.length || !profiles.length) throw new Error('No valid Generation 0 workload was selected')
await mkdir(artifactDir, { recursive: true })

function percentile(values, fraction) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function summarizeFrames(intervals) {
  return {
    samples: intervals.length,
    meanMs: intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length),
    p50Ms: percentile(intervals, .5),
    p95Ms: percentile(intervals, .95),
    p99Ms: percentile(intervals, .99),
    over25Ms: intervals.filter((value) => value > 25).length,
    over50Ms: intervals.filter((value) => value > 50).length,
  }
}

async function cdpMetrics(session) {
  const { metrics } = await session.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]))
}

function metricDelta(before, after, name) {
  return (after[name] || 0) - (before[name] || 0)
}

async function sampleInteraction(page, canvas) {
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas bounds unavailable')
  const frames = page.evaluate(() => new Promise((resolveFrames) => {
    const intervals = []
    let previous = performance.now()
    function sample(now) {
      intervals.push(now - previous)
      previous = now
      if (intervals.length >= 120) resolveFrames(intervals.slice(1))
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .55)
  for (let index = 0; index < 60; index += 1) {
    await page.mouse.wheel(index % 2 ? 42 : -36, index % 3 ? 18 : -12)
    if (index % 10 === 0) {
      await page.keyboard.down('Control')
      await page.mouse.wheel(0, index % 20 ? 24 : -24)
      await page.keyboard.up('Control')
    }
    await page.waitForTimeout(8)
  }
  return frames
}

const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-precise-memory-info'] })
const browserVersion = await browser.version()
const results = []
try {
  for (const profile of profiles) {
    for (const size of sizes) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      await page.addInitScript(() => {
        window.__generation0LongTasks = []
        if ('PerformanceObserver' in window) {
          try {
            const observer = new PerformanceObserver((list) => {
              window.__generation0LongTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })))
            })
            observer.observe({ type: 'longtask', buffered: true })
          } catch { /* Long Tasks is not exposed by every WebView/browser. */ }
        }
      })
      const session = await context.newCDPSession(page)
      await session.send('Performance.enable')
      const startedAt = performance.now()
      await page.goto(`${baseUrl}/?benchmark=generation-0&stress=${size}&stress-profile=${profile}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.getByRole('button', { name: 'Canvas', exact: true }).click()
      const canvas = page.locator('.canvas-stage').first()
      await canvas.waitFor()
      await page.waitForTimeout(500)
      const readyMs = performance.now() - startedAt
      const before = await cdpMetrics(session)
      const frameIntervals = await sampleInteraction(page, canvas)
      await page.waitForTimeout(250)
      const after = await cdpMetrics(session)
      const app = await page.evaluate(() => {
        const stage = document.querySelector('.canvas-stage')
        const gpu = document.querySelector('.gpu-board')
        const memory = performance.memory
        return {
          totalNodes: Number(stage?.dataset.totalNodes || 0),
          visibleNodes: Number(stage?.dataset.visibleNodes || 0),
          visibleMedia: Number(stage?.dataset.visibleMedia || 0),
          spatialIndexSize: Number(stage?.dataset.spatialIndexSize || 0),
          spatialCellCount: Number(stage?.dataset.spatialCellCount || 0),
          spatialVisibleCandidates: Number(stage?.dataset.spatialVisibleCandidates || 0),
          inputMetrics: JSON.parse(stage?.dataset.inputMetrics || '{}'),
          renderMetrics: JSON.parse(gpu?.dataset.renderMetrics || '{}'),
          tickerRunning: gpu?.dataset.tickerRunning,
          renderedDomNodes: document.querySelectorAll('.board-node').length,
          domElements: document.getElementsByTagName('*').length,
          dpr: window.devicePixelRatio,
          renderScale: Number(gpu?.dataset.renderScale || 0),
          renderPixels: Number(gpu?.dataset.renderPixels || 0),
          jsHeapUsedBytes: memory?.usedJSHeapSize,
          jsHeapLimitBytes: memory?.jsHeapSizeLimit,
          longTasks: window.__generation0LongTasks || [],
        }
      })
      if (app.spatialIndexSize !== size) errors.push(`spatial index contains ${app.spatialIndexSize} of ${size} objects`)
      if (app.spatialVisibleCandidates > app.totalNodes) errors.push('spatial query returned more candidates than scene objects')
      if (app.tickerRunning !== 'false') errors.push('backdrop ticker did not remain asleep')
      console.log(`${profile} ${size}: p95=${summarizeFrames(frameIntervals).p95Ms.toFixed(1)} ms, errors=${errors.length}`)
      results.push({
        profile, size, readyMs, frames: summarizeFrames(frameIntervals), app,
        browserCosts: {
          scriptMs: metricDelta(before, after, 'ScriptDuration') * 1000,
          taskMs: metricDelta(before, after, 'TaskDuration') * 1000,
          layoutMs: metricDelta(before, after, 'LayoutDuration') * 1000,
          styleMs: metricDelta(before, after, 'RecalcStyleDuration') * 1000,
          layoutCount: metricDelta(before, after, 'LayoutCount'),
          styleCount: metricDelta(before, after, 'RecalcStyleCount'),
          heapDeltaBytes: metricDelta(before, after, 'JSHeapUsedSize'),
        },
        errors,
      })
      await context.close()
    }
  }
} finally {
  await browser.close()
}

const report = {
  schemaVersion: 1,
  generation: runLabel,
  generatedAt: new Date().toISOString(),
  environment: { browser: browserVersion, viewport: '1440x900', deviceScaleFactor: 1, baseUrl },
  methodology: 'One warm-up, 120 requestAnimationFrame intervals while 60 pan events and periodic zoom events are issued. CDP counters cover the interaction window.',
  results,
}
const stamp = report.generatedAt.replaceAll(':', '-').replaceAll('.', '-')
await writeFile(resolve(artifactDir, `${runLabel}-${stamp}.json`), JSON.stringify(report, null, 2))
await writeFile(resolve(artifactDir, 'latest.json'), JSON.stringify(report, null, 2))

const rows = results.map((result) => `<tr><td>${result.profile}</td><td>${result.size.toLocaleString()}</td><td>${result.app.visibleNodes}</td><td>${result.readyMs.toFixed(1)}</td><td>${result.frames.p50Ms.toFixed(2)}</td><td>${result.frames.p95Ms.toFixed(2)}</td><td>${result.frames.p99Ms.toFixed(2)}</td><td>${result.browserCosts.scriptMs.toFixed(1)}</td><td>${result.browserCosts.layoutMs.toFixed(1)}</td><td>${((result.app.jsHeapUsedBytes || 0) / 1048576).toFixed(1)}</td><td>${result.app.longTasks.length}</td><td>${result.errors.length}</td></tr>`).join('')
const html = `<!doctype html><html><head><meta charset="utf-8"><title>${runLabel} performance report</title><style>body{font:14px/1.45 Segoe UI,sans-serif;background:#10151d;color:#dce5ef;padding:32px}table{border-collapse:collapse;width:100%}th,td{padding:9px;border:1px solid #334155;text-align:right}th{background:#1e293b}td:first-child,th:first-child{text-align:left}.note{color:#9fb0c4}</style></head><body><h1>Art Equation Studio — ${runLabel} performance report</h1><p class="note">${report.generatedAt} · ${browserVersion} · ${report.methodology}</p><table><thead><tr><th>Profile</th><th>Objects</th><th>Visible</th><th>Ready ms</th><th>Frame p50</th><th>Frame p95</th><th>Frame p99</th><th>Script ms</th><th>Layout ms</th><th>Heap MiB</th><th>Long tasks</th><th>Errors</th></tr></thead><tbody>${rows}</tbody></table><p class="note">Headless-browser results are a repeatable engineering baseline, not perceived-latency or native-EXE measurements. Run the same corpus in the packaged app before release gates are frozen.</p></body></html>`
await writeFile(resolve(artifactDir, 'latest.html'), html)
await writeFile(resolve(artifactDir, `${runLabel}-latest.html`), html)
await writeFile(resolve(artifactDir, `${runLabel}-latest.json`), JSON.stringify(report, null, 2))
console.log(`${runLabel}: ${results.length} workloads written to ${artifactDir}`)
if (results.some((result) => result.errors.length)) process.exitCode = 1
