import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import ts from 'typescript'

// Real mounted CSSOM and the production capture/compiler; bounded provider
// barriers isolate stale geometry. This is not native renderer/performance QA.
const baseline = process.argv.includes('--baseline')
const dpr = Number(process.argv.find(arg => arg.startsWith('--dpr='))?.slice(6) || 1)
assert(dpr > 0 && Number.isFinite(dpr))
const reportName = baseline ? 'baseline' : dpr === 1 ? 'candidate' : `candidate-dpr-${dpr}`
const output = resolve('output/playwright/measured-card-camera-capture')
await mkdir(output, { recursive: true })
const files = ['src/board/measuredCardPaint.ts', 'src/board/measuredBackgroundPaint.ts', 'src/board/completeMeasuredCardPaint.ts']
const sources = await Promise.all(files.map(file => readFile(file, 'utf8')))
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const measured = url(compile(sources[0]))
const background = url(compile(sources[1]).replace(/from ['"]\.\/measuredCardPaint(?:\.ts)?['"]/g, `from '${measured}'`))
const complete = url(compile(sources[2]).replace(/from ['"]\.\/measuredCardPaint(?:\.ts)?['"]/g, `from '${measured}'`).replace(/from ['"]\.\/measuredBackgroundPaint(?:\.ts)?['"]/g, `from '${background}'`))
const checks = [], errors = []
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.UI_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--disable-background-networking'] })
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr })
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(`<style>
    body{margin:0}#stage{position:relative;margin:20px;width:740px;height:540px;overflow:hidden}
    .board-world{position:absolute;inset:0;transform-origin:0 0;transform:translate(17.25px,11.5px) scale(1.25)}
    .board-object-layer{position:absolute;inset:0}article{position:absolute;left:30px;top:40px;width:200px;height:140px;box-sizing:border-box;background:#123456;border:1px solid #456789;overflow:hidden}
    p{margin:8px;width:180px;height:35px;color:white;font:16px Arial}img{display:block;width:80px;height:50px;margin:8px}
    .title{height:25px}.body{height:65px}@keyframes fade{from{opacity:1}to{opacity:.2}}
    </style><div id="stage"><div class="board-world"><div class="board-object-layer"><article class="board-node" data-node-id="card"><p>Original text</p><img alt="fixture" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Crect width='8' height='5' fill='green'/%3E%3C/svg%3E"></article></div></div></div>`)
  await page.evaluate(async () => { await document.querySelector('img').decode(); await document.fonts.ready })
  await page.evaluate(async moduleUrl => { window.captureModule = await import(moduleUrl) }, complete)
  const run = async (name, mutation, expected, extra = {}) => {
    const result = await page.evaluate(async ({ mutation, extra }) => {
      const stage = document.querySelector('#stage'), world = stage.querySelector('.board-world')
      if (!stage.querySelector('article')) world.querySelector('.board-object-layer').innerHTML = '<article class="board-node" data-node-id="card"></article>'
      const article = stage.querySelector('article')
      article.style.cssText = ''
      article.innerHTML = `<p>Original text</p><img alt="fixture" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Crect width='8' height='5' fill='green'/%3E%3C/svg%3E">`
      stage.style.cssText = ''; world.style.cssText = ''
      world.querySelector('.board-object-layer').style.cssText = ''
      if (extra.rotation) article.style.transform = 'rotate(13deg)'
      if (extra.identity) world.style.transform = 'none'
      if (extra.graph) article.innerHTML = '<p class="title">Graph column</p><div class="body"><p>Record one</p></div>'
      if (extra.scroll) { article.style.overflow = 'hidden'; article.querySelector('p').style.height = '250px' }
      const image = article.querySelector('img'); if (image) await image.decode()
      const object = { id: 'card', kind: 'container', revision: 1, order: 0, zIndex: 0, locked: false, hidden: false, bounds: { x: 30, y: 40, width: 200, height: 140 }, appearance: { rotation: extra.rotation ? 13 : 0 } }
      object.localBounds = object.bounds
      const scene = { id: 'fixture', revision: 1, objects: [object] }
      const camera = extra.identity ? { x: 0, y: 0, scale: 1 } : { x: 17.25, y: 11.5, scale: 1.25 }
      const originalDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
      let release, entered, calls = 0
      const gate = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { entered = resolve })
      const provider = async (element, options) => {
        calls++; entered(); await gate
        return { completePaint: true, sourceFingerprint: options.sourceFingerprint, operations: [], visualBounds: { x: 30, y: 40, width: 200, height: 140 }, blockers: [] }
      }
      const capture = window.captureModule.captureCompleteMeasuredCardPaint(stage, scene, object, camera, { text: provider, image: provider }, 1)
      // An unsupported preflight must return evidence rather than hang on the barrier.
      const preflight = await Promise.race([waiting.then(() => null), capture])
      if (preflight) return { status: preflight.status, blockers: preflight.blockers, calls }
      const beforeRect = article.getBoundingClientRect().toJSON()
      switch (mutation) {
        case 'pan': world.style.transform = 'translate(127.875px,-19.125px) scale(1.25)'; break
        case 'fractional-pan': world.style.transform = 'translate(127.875123px,-19.125789px) scale(1.25)'; break
        case 'stage-move': stage.style.marginLeft = '47.75px'; break
        case 'zoom': world.style.transform = 'translate(17.25px,11.5px) scale(1.5)'; break
        case 'skew': world.style.transform = 'matrix(1.25,0,.1,1.25,17.25,11.5)'; break
        case 'text': article.querySelector('p').textContent = 'Changed text'; break
        case 'style': article.querySelector('p').style.color = 'red'; break
        case 'external-style': document.querySelector('style').textContent += 'p{font-size:17px}'; break
        case 'move': article.style.left = '31px'; break
        case 'resize': article.style.width = '201px'; break
        case 'scroll': article.scrollTop = 20; break
        case 'focus': article.querySelector('p').setAttribute('contenteditable', 'true'); article.querySelector('p').focus(); break
        case 'animation': article.querySelector('p').animate([{opacity:1},{opacity:.3}], {duration:5000}); break
        case 'detach': article.remove(); break
        case 'media': image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="9" height="5"/%3E'; break
        case 'replace-child': article.querySelector('p').replaceWith(article.querySelector('p').cloneNode(true)); break
        case 'replace-object': scene.objects = [{ ...object }]; break
        case 'viewport': stage.style.width = '720px'; break
        case 'dpr': Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: devicePixelRatio + 1 }); break
        case 'font-set': document.fonts.add(new FontFace('LateFixture', 'local(Arial)')); break
        case 'parent-opacity': article.parentElement.style.opacity = '.5'; break
        case 'parent-transform': article.parentElement.style.transform = 'translate(1px,0)'; break
        case 'font-axis': article.querySelector('p').style.fontVariationSettings = '"wght" 600'; break
        case 'focus-style': article.tabIndex = 0; document.querySelector('style').textContent += 'article:focus{background:red}'; article.focus(); break
      }
      release()
      const result = await capture
      const afterRect = article.getBoundingClientRect().toJSON()
      article.querySelectorAll('*').forEach(element => element.getAnimations().forEach(animation => animation.cancel()))
      document.activeElement?.blur()
      if (mutation === 'dpr') { if (originalDpr) Object.defineProperty(window, 'devicePixelRatio', originalDpr); else delete window.devicePixelRatio }
      if (mutation === 'font-set') for (const face of document.fonts) if (face.family === 'LateFixture') document.fonts.delete(face)
      return { status: result.status, blockers: result.blockers, calls, beforeRect, afterRect, operations: result.operations, sourceFingerprint: result.sourceFingerprint }
    }, { mutation, extra })
    checks.push({ name, expected, observed: result.status, pass: result.status === expected, evidence: result })
    assert.equal(result.status, expected, name + ': ' + JSON.stringify(result.blockers))
    console.log('PASS ' + name)
    return result
  }
  const stationary = await run('unchanged mounted note and decoded image', 'none', 'ready')
  const pan = await run('camera translation during provider wait', 'pan', baseline ? 'stale' : 'ready')
  if (!baseline) assert.deepEqual(pan.operations, stationary.operations, 'retained paint must remain in the captured world coordinates')
  await run('fractional camera translation', 'fractional-pan', baseline ? 'stale' : 'ready')
  await run('rotated card camera translation', 'pan', baseline ? 'stale' : 'ready', { rotation: true })
  await run('measured graph skin camera translation', 'pan', baseline ? 'stale' : 'ready', { graph: true })
  if (!baseline) {
    await run('identity world transform remains capturable', 'none', 'ready', { identity: true })
    await run('canvas moves in the shell without changing world paint', 'stage-move', 'ready')
    for (const mutation of ['zoom', 'skew', 'text', 'style', 'move', 'resize', 'scroll', 'focus', 'animation', 'detach', 'media', 'replace-child', 'replace-object', 'viewport', 'dpr', 'font-set', 'parent-opacity', 'parent-transform', 'font-axis', 'focus-style', 'external-style']) {
      await run('reject changed ' + mutation, mutation, 'stale', { scroll: mutation === 'scroll' })
    }
  }
  assert.deepEqual(errors, [])
  await page.screenshot({ path: resolve(output, reportName + '.png') })
} finally {
  await browser?.close()
  await writeFile(resolve(output, reportName + '.json'), JSON.stringify({ scope: 'MOUNTED_CAPTURE_VALIDATION_WITH_BOUNDED_STUB_PROVIDERS', baseline, dpr, checks, errors, sourceHashes: Object.fromEntries(files.map((file, index) => [file, createHash('sha256').update(sources[index]).digest('hex')])), nativePerformanceQualification: false, limitations: ['Actual browser geometry and production capture/compiler; provider barriers return qualified empty contributions to isolate layout validation.', 'No native GPU pixels, real glyph shaping or media rendering claim. Graph fixture exercises measured fallback skin, not structured graph paint.', 'Camera-obsolete frame presentation remains forbidden by presenter generations; this fixture checks reusable content only.'] }, null, 2))
}
