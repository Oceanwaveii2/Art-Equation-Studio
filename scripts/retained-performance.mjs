import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const base = process.env.PERF_TEST_BASE_URL || 'http://127.0.0.1:5173'
const report = { generatedAt: new Date().toISOString(), browser: await browser.version(), methodology: 'Matched 400-card board with a real shared 512x256 PNG, 1600x1000, DPR 1. Each fresh page settles, then receives 120 alternating pan events at requestAnimationFrame cadence. Four repeats in alternating mode order. CDP CPU counters and frame intervals cover only the warm interaction. Headless browser evidence, not native EXE or GPU timestamps.', results: [] }
const percentile = (values, p) => [...values].sort((a, b) => a-b)[Math.ceil(values.length*p)-1]
const median = values => { const sorted=[...values].sort((a,b)=>a-b); return sorted.length ? (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2 : null }
const metrics = async session => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(v => [v.name, v.value]))
await mkdir('artifacts/retained-performance', { recursive: true })
try {
  for (let repeat = 0; repeat < (process.env.RETAINED_PROFILE ? 1 : 4); repeat++) for (const mode of process.env.RETAINED_PROFILE ? ['retained'] : repeat % 2 ? ['retained', 'raster', 'dom'] : ['dom', 'raster', 'retained']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/?canvas-renderer=${mode}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await page.getByRole('button', { name: '＋ Board', exact: true }).first().click()
    await page.getByRole('button', { name: 'Canvas', exact: true }).click()
    await page.waitForTimeout(650)
    await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width=512; canvas.height=256
      const ctx=canvas.getContext('2d')
      ctx.fillStyle='#ee9966'; ctx.fillRect(0,0,256,256); ctx.fillStyle='#226688'; ctx.fillRect(256,0,256,256)
      ctx.fillStyle='white'; ctx.fillRect(30,30,50,50)
      const body=canvas.toDataURL('image/png')
      const nodes=Array.from({length:400}, (_,i)=>({id:`fixture-${i}`,kind:'image',title:`Image ${i}`,body,x:(i%20)*150,y:Math.floor(i/20)*125,width:128,height:105}))
      localStorage.setItem('art-equation-board-clipboard',JSON.stringify({nodes})); window.dispatchEvent(new ClipboardEvent('paste'))
    })
    await page.getByLabel('Fit selection', { exact: true }).click()
    await page.locator('.canvas-stage').dispatchEvent('contextmenu', { clientX: 280, clientY: 180 }); await page.keyboard.press('Escape')
    await page.waitForFunction(()=>document.querySelectorAll('.format-image-preview img').length===400 && [...document.querySelectorAll('.format-image-preview img')].every(img=>img.complete&&img.naturalWidth>0))
    if(mode!=='dom') await page.waitForFunction(()=>document.querySelectorAll('[data-retained-paint="image"]').length===400)
    await page.mouse.move(10,10); await page.waitForTimeout(500)
    const session=await page.context().newCDPSession(page); await session.send('Performance.enable')
    if (process.env.RETAINED_PROFILE) { await session.send('Profiler.enable'); await session.send('Profiler.start') }
    const before=await metrics(session)
    const sample=await page.evaluate(()=>new Promise(resolve=>{
      const stage=document.querySelector('.canvas-stage'), gpu=document.querySelector('.gpu-board'), box=stage.getBoundingClientRect()
      const frames=[]; let last, index=0
      const initial=JSON.parse(gpu.dataset.retainedMetrics||'{}')
      function frame(now){
        if(last!==undefined) frames.push(now-last); last=now
        if(index++===120){
          const canvas=gpu.querySelector('canvas'), gl=canvas.getContext('webgl2')||canvas.getContext('webgl'), info=gl.getExtension('WEBGL_debug_renderer_info')
          resolve({frames,initial,final:JSON.parse(gpu.dataset.retainedMetrics||'{}'),visible:Number(stage.dataset.visibleNodes),fallback:gpu.dataset.retainedFallback,renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}); return
        }
        stage.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:index%2?6:-6,deltaY:index%2?4:-4,clientX:box.x+box.width/2,clientY:box.y+box.height/2}))
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }))
    const after=await metrics(session)
    if (process.env.RETAINED_PROFILE) {
      const {profile}=await session.send('Profiler.stop'); await writeFile('artifacts/retained-performance/retained.cpuprofile',JSON.stringify(profile))
      console.log(JSON.stringify(profile.nodes.filter(n=>n.hitCount>0).sort((a,b)=>b.hitCount-a.hitCount).slice(0,18).map(n=>({function:n.callFrame.functionName,hits:n.hitCount,url:n.callFrame.url}))))
    }
    assert.equal(sample.visible,400); assert(!sample.fallback); assert.equal(errors.length,0,errors.join('\n'))
    if(mode!=='dom') { assert.equal(sample.initial.uploads,sample.final.uploads); assert.equal(sample.initial.builds,sample.final.builds); assert.equal(sample.final.images,1); assert.equal(sample.final.skins,1) }
    const costs=Object.fromEntries(['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration'].map(key=>[key+'Ms',(after[key]-before[key])*1000]))
    const result={repeat,mode,p50:percentile(sample.frames,.5),p95:percentile(sample.frames,.95),p99:percentile(sample.frames,.99),over25:sample.frames.filter(v=>v>25).length,costs,...sample,errors}
    report.results.push(result); console.log(JSON.stringify({repeat,mode,p95:result.p95,costs,resources:sample.final}))
    await page.context().close()
  }
  report.summary=Object.fromEntries(['dom','raster','retained'].map(mode=>{
    const runs=report.results.filter(r=>r.mode===mode)
    return [mode,{medianP95:median(runs.map(r=>r.p95)),medianTaskMs:median(runs.map(r=>r.costs.TaskDurationMs)),medianScriptMs:median(runs.map(r=>r.costs.ScriptDurationMs))}]
  }))
  report.performanceGate={passed:!process.env.RETAINED_PROFILE && report.summary.raster.medianP95 < report.summary.dom.medianP95*.95 && report.summary.retained.medianP95 < report.summary.dom.medianP95*.95,criterion:'At least 5% lower median p95 in both candidate modes; tiny timing differences are not a qualification win.'}
  // passed records successful workload/correctness assertions. The independent
  // performance gate controls rollout and can remain false on a valid run.
  report.passed=true
} finally {
  await writeFile(`artifacts/retained-performance/${process.env.RETAINED_PROFILE ? 'profile-run' : 'report'}.json`,JSON.stringify(report,null,2)); await browser.close()
}
console.log(JSON.stringify(report.summary))
