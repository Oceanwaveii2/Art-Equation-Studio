import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const output = resolve(process.argv[2] || `../output/playwright/caption-baseline-${Date.now()}`)
await mkdir(output, { recursive: true })
const projectPath = '../fixtures/workspace/projects/p1-v2-studies/project.json'
const projectText = await readFile(projectPath, 'utf8'), sourceHash = createHash('sha256').update(projectText).digest('hex')
const project = JSON.parse(projectText), caption = project.boards.find(board => board.id === 'test-2-nodes').nodes.find(node => node.id === 'node-6:caption')
assert.equal(caption.title, 'Reservoir A')
assert.equal(caption.body.includes('font-size:20px'), true)
const helper = process.env.NATIVE_FONT_RESOLVER || 'D:/0/AE2Target-20261007/release/examples/audit-font-resolver.exe'
const fontCache = new Map(), nativeReceipts = []
async function nativeFont(command, args) {
  const key = JSON.stringify({ command, ...args })
  if (!fontCache.has(key)) fontCache.set(key, new Promise((accept, reject) => {
    const proc = execFile(helper, [], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(stderr || String(error))); return }
      try {
        const receipt = JSON.parse(stdout)
        nativeReceipts.push({ command, request: args.request, ...Object.fromEntries(Object.entries(receipt).filter(([name]) => name !== 'bytesBase64')), byteCount: receipt.bytesBase64 ? Buffer.from(receipt.bytesBase64, 'base64').length : 0 })
        accept(receipt)
      } catch (error) { reject(error) }
    })
    proc.stdin.end(key)
  }))
  return fontCache.get(key)
}
const markup = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {BoardRichText} from '/src/board/BoardRichText.tsx';
import * as semantic from '/src/canvas-engine/semanticTextPaint.ts';
import {loadVelloEngine} from '/src/project-b/p0-surface/backends.ts';
import '/src/App.css';import '/src/p1V2Shell.css';
const node=${JSON.stringify(caption)};
function App(){return <main className="studio-shell p1-v2-shell approved-layout-port workspace-navy" id="fixture"><div className="canvas-stage" id="stage"><div className="board-world" id="world"><div className="board-object-layer"><article className="board-node node-text node-artwork-text" data-node-id={node.id} style={{left:50,top:50,width:node.width,height:node.height,'--node-accent':node.color,'--node-text':node.textColor}}><header className="node-drag-handle"><strong>{node.title}</strong><span>TEXT</span></header><BoardRichText html={node.body} selected={false} onChange={()=>{}} onRequestText={async()=>null}/></article><div id="guards"/></div></div></div></main>}
createRoot(document.querySelector('#root')).render(<App/>);
window.fixtureReady=(async()=>{const module=await loadVelloEngine();const engine=new module.TextEngine('caption-baseline-native');const calls={register:0,shape:0};const host={register_font(...args){calls.register++;return engine.register_font(...args)},shape(...args){calls.shape++;return engine.shape(...args)},resource_stats:()=>engine.resource_stats(),remove_font:key=>engine.remove_font(key),free:()=>engine.free()};const resolver=semantic.createNativeTextFontResolver((command,args)=>window.__nativeFont(command,args));const session=semantic.createTextPaintSession(host,'caption-baseline-native');window.fixtureApi={semantic,resolver,session,calls,dispose(){session.dispose();resolver.dispose()}};})();
`
const html = '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%}#fixture{display:block;height:100%}#stage{position:relative;width:100%;height:100%}#world{position:absolute;inset:0;transform:scale(1);transform-origin:0 0}.board-object-layer{position:absolute;inset:0}#guards{position:absolute;left:50px;top:130px}.baseline-specimen{margin:0 0 16px;padding:0;border:0;color:#eaf6fa;background:transparent;font:400 20px/1.24 Arial;letter-spacing:normal;word-spacing:normal;white-space:normal;overflow-wrap:normal;word-break:normal;box-sizing:content-box}</style></head><body><div id="root"></div><script type="module" src="/__baseline_mount.tsx"></script></body></html>'
const server = await createServer({ configFile: false, cacheDir: resolve(output, '.vite'), server: { host: '127.0.0.1', port: 0 }, appType: 'custom', plugins: [{ name: 'caption-baseline-provider', enforce: 'pre', resolveId(id) { if (id === '/__baseline_mount.tsx') return '\0caption-baseline-provider.tsx' }, load(id) { if (id === '\0caption-baseline-provider.tsx') return markup }, transform(code, id) { if (id === '\0caption-baseline-provider.tsx') return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText }, configureServer(server) { server.middlewares.use((request, response, next) => { if (request.url?.split('?')[0] === '/__baseline_fixture.html') { response.setHeader('content-type', 'text/html'); response.end(html) } else next() }) } }] })
let browser, page, browserClosed = false
const checks = [], receipts = [], errors = []
const check = (name, condition, details) => { checks.push({ name, pass: Boolean(condition), details }); assert(condition, name + ': ' + JSON.stringify(details)) }
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.UI_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.exposeFunction('__nativeFont', nativeFont)
  await page.goto(server.resolvedUrls.local[0] + '__baseline_fixture.html')
  await page.locator('article[data-node-id="node-6:caption"] .tiptap p').waitFor()
  await page.evaluate(() => window.fixtureReady)
  await page.evaluate(() => document.fonts.ready)
  for (const scale of [1, .5342831949299581]) {
    await page.evaluate(scale => { document.querySelector('#world').style.transform = 'scale(' + scale + ')' }, scale)
    for (const [part, selector] of [['header', 'article header strong'], ['body', 'article .tiptap p']]) {
      const receipt = await page.locator(selector).evaluate(async (element, { part, scale }) => {
        const { semantic, resolver, session, calls } = window.fixtureApi, id = 'node-6:caption:' + part
        const options = { id, revision: '1', transform: [1, 0, 0, 1, 0, 0], resolveFont: resolver, rootBackgroundOwned: true }
        const before = { html: element.innerHTML, text: element.textContent, rect: element.getBoundingClientRect().toJSON(), childCount: document.body.children.length }
        const css = getComputedStyle(element), spanCss = getComputedStyle(element.querySelector('span') || element)
        const capture = await semantic.captureSemanticParagraph(element, { ...options, fontEpoch: 'caption-baseline-native' })
        let oracle, oracleError
        try { oracle = capture.request ? semantic.measureSemanticTextLines(element, capture.measurement) : undefined } catch (error) { oracleError = String(error) }
        const shapeBefore = calls.shape, prepared = await session.prepare(element, options), shapeCount = calls.shape - shapeBefore
        const result = { part, providerId: id, scale, dpr: devicePixelRatio, source: before.text, font: { family: spanCss.fontFamily, size: spanCss.fontSize, weight: spanCss.fontWeight, leading: spanCss.lineHeight }, elementStyle: { width: css.width, height: css.height, display: css.display }, actualScale: before.rect.width / parseFloat(css.width), requestText: capture.request?.text, capturedFonts: capture.fonts.map(font => ({ key: font.key, contentHash: font.contentHash, faceIndex: font.faceIndex, resolvedFamily: font.resolvedFamily, byteCount: font.bytes.length })), oracle, oracleError, shapeCount, prepared: { completePaint: prepared.completePaint, operationCount: prepared.operations.length, blockers: prepared.blockers, qualification: prepared.qualification }, canonicalUnchanged: element.innerHTML === before.html && element.textContent === before.text && JSON.stringify(element.getBoundingClientRect().toJSON()) === JSON.stringify(before.rect) && document.body.children.length === before.childCount }
        prepared.release()
        return result
      }, { part, scale })
      receipts.push(receipt)
      check(`${part} at ${scale} uses the actual authored text and native face`, receipt.source === 'Reservoir A' && receipt.requestText === 'Reservoir A' && receipt.capturedFonts.length > 0 && receipt.capturedFonts.every(font => font.byteCount > 0 && /^[a-f0-9]{64}$/.test(font.contentHash)), receipt)
      check(`${part} at ${scale} passes the actual per-character baseline oracle`, !receipt.oracleError && receipt.oracle?.length === 1 && receipt.oracle[0].sourceStart === 0 && receipt.oracle[0].sourceEnd === 11 && Number.isFinite(receipt.oracle[0].baseline), receipt)
      check(`${part} at ${scale} reaches actual WASM shaping with preserved baseline`, receipt.shapeCount > 0 && receipt.prepared.operationCount > 0 && receipt.prepared.qualification?.lines.length === 1 && receipt.prepared.blockers.every(blocker => blocker === 'TEXT_FONT_PIXEL_ACCEPTANCE_PENDING'), receipt)
      check(`${part} at ${scale} leaves canonical DOM and metrics unchanged`, receipt.canonicalUnchanged && receipt.dpr === 2 && Math.abs(receipt.actualScale - scale) < .00001 && (part !== 'body' || receipt.font.size === '20px'), receipt)
    }
    for (const specimen of [
      { id: 'wrapped-words', html: 'First Second Third', width: 80, whiteSpace: 'normal', partitions: [[0, 5], [6, 12], [13, 18]] },
      { id: 'wrapped-space-guard', html: 'Reservoir A continues into another measured line.', width: 140, whiteSpace: 'normal', minLines: 2, oracleBlocker: 'TEXT_BASELINE_CLONE_LAYOUT_CHANGED' },
      { id: 'hard-break', html: 'First<br>Second', width: 306, whiteSpace: 'normal', partitions: [[0, 5], [5, 11]], blocker: 'TEXT_BLOCK_OR_REPLACED_CONTENT_UNSUPPORTED' },
      { id: 'break-spaces', html: 'Reservoir  A', width: 306, whiteSpace: 'break-spaces', partitions: [[0, 12]] },
      { id: 'wrapped-break-spaces-guard', html: 'Reservoir  A  next  line', width: 140, whiteSpace: 'break-spaces', minLines: 2, oracleBlocker: 'TEXT_BASELINE_CLONE_LAYOUT_CHANGED' },
      { id: 'preserved-newline', html: 'First\nSecond', width: 306, whiteSpace: 'pre-wrap', partitions: [[0, 5], [6, 12]], shapedBlocker: 'TEXT_CONTEXT_LINE_PARTITION_FAILED' },
      { id: 'split-inline', html: '<span>Reservoir </span><span>A</span>', width: 306, whiteSpace: 'normal', partitions: [[0, 11]] },
    ]) {
      const receipt = await page.evaluate(async specimen => {
        const { semantic, resolver, session, calls } = window.fixtureApi, element = document.createElement('p')
        element.className = 'baseline-specimen'; element.style.width = specimen.width + 'px'; element.style.whiteSpace = specimen.whiteSpace; element.innerHTML = specimen.html; document.querySelector('#guards').append(element)
        const original = element.innerHTML, options = { id: specimen.id, revision: '1', transform: [1, 0, 0, 1, 0, 0], resolveFont: resolver, rootBackgroundOwned: true }
        const captured = await semantic.captureSemanticParagraph(element, { ...options, fontEpoch: 'caption-baseline-native' })
        let oracle, oracleError
        try { oracle = semantic.measureSemanticTextLines(element, captured.measurement) } catch (error) { oracleError = String(error) }
        const shapeBefore = calls.shape, prepared = await session.prepare(element, options)
        const result = { id: specimen.id, text: element.textContent, whiteSpace: getComputedStyle(element).whiteSpace, capturedBlockers: captured.measurement.blockers, oracle, oracleError, shapeCount: calls.shape - shapeBefore, prepared: { completePaint: prepared.completePaint, operationCount: prepared.operations.length, blockers: prepared.blockers, qualification: prepared.qualification }, canonicalUnchanged: original === element.innerHTML }
        prepared.release(); element.remove(); return result
      }, specimen)
      receipts.push({ scale, ...receipt })
      if (specimen.oracleBlocker) {
        check(`${specimen.id} at ${scale} retains conservative clone equivalence rejection`, receipt.oracleError?.includes(specimen.oracleBlocker) && !receipt.prepared.completePaint && receipt.prepared.operationCount === 0 && receipt.prepared.blockers.some(blocker => blocker.includes(specimen.oracleBlocker) && blocker.includes(specimen.id)) && receipt.canonicalUnchanged, receipt)
        continue
      }
      check(`${specimen.id} at ${scale} preserves actual DOM line partitions and source`, !receipt.oracleError && JSON.stringify(receipt.oracle?.map(line => [line.sourceStart, line.sourceEnd])) === JSON.stringify(specimen.partitions) && receipt.oracle.every(line => Number.isFinite(line.baseline)) && receipt.canonicalUnchanged, receipt)
      if (specimen.blocker) check(`${specimen.id} at ${scale} retains its typed unsupported provider guard`, !receipt.prepared.completePaint && receipt.prepared.blockers.includes(specimen.blocker) && receipt.shapeCount === 0, receipt)
      else if (specimen.shapedBlocker) check(`${specimen.id} at ${scale} retains its native context partition guard`, !receipt.prepared.completePaint && receipt.prepared.operationCount === 0 && receipt.prepared.blockers.some(blocker => blocker.includes(specimen.shapedBlocker)) && receipt.shapeCount > 0, receipt)
      else check(`${specimen.id} at ${scale} reaches WASM without baseline or source bypass`, receipt.shapeCount > 0 && receipt.prepared.operationCount > 0 && receipt.prepared.blockers.every(blocker => blocker === 'TEXT_FONT_PIXEL_ACCEPTANCE_PENDING'), receipt)
    }
  }
  for (const sabotage of ['height', 'source', 'range', 'baseline']) {
    const receipt = await page.evaluate(async sabotage => {
      const { semantic, resolver, session } = window.fixtureApi, element = document.querySelector('article .tiptap p')
      const options = { id: 'guard:' + sabotage, revision: '1', transform: [1, 0, 0, 1, 0, 0], resolveFont: resolver, rootBackgroundOwned: true }
      const original = element.innerHTML, childCount = document.body.children.length, append = document.body.append
      document.body.append = function (...nodes) {
        for (const clone of nodes) if (clone instanceof HTMLElement && clone.inert) {
          if (sabotage === 'height') clone.style.minHeight = '100px'
          if (sabotage === 'source') clone.appendChild(document.createTextNode('X'))
          if (sabotage === 'range') clone.style.paddingLeft = '4px'
          if (sabotage === 'baseline') for (const probe of clone.querySelectorAll('span')) if (probe.style.display === 'inline-block' && probe.style.width === '0px') probe.style.transform = 'translateY(100px)'
        }
        return append.apply(this, nodes)
      }
      let prepared
      try { prepared = await session.prepare(element, options) } finally { document.body.append = append }
      const result = { sabotage, completePaint: prepared.completePaint, operationCount: prepared.operations.length, blockers: prepared.blockers, canonicalUnchanged: element.innerHTML === original, cloneRemoved: document.body.children.length === childCount }
      prepared.release(); return result
    }, sabotage)
    const expected = sabotage === 'source' ? 'TEXT_BASELINE_CLONE_SOURCE_CHANGED' : sabotage === 'baseline' ? 'TEXT_BASELINE_ORACLE_INVALID' : 'TEXT_BASELINE_CLONE_LAYOUT_CHANGED'
    check(`${sabotage} corruption still rejects and names its provider`, !receipt.completePaint && receipt.operationCount === 0 && receipt.blockers.some(blocker => blocker.includes(expected) && blocker.includes('guard:' + sabotage)) && receipt.canonicalUnchanged && receipt.cloneRemoved, receipt)
    receipts.push(receipt)
  }
  const stats = await page.evaluate(() => ({ calls: window.fixtureApi.calls, stats: window.fixtureApi.session.stats(), resolver: window.fixtureApi.resolver.stats() }))
  check('real native font registration and WASM shaping were exercised', stats.calls.register > 0 && stats.calls.shape >= 4 && nativeReceipts.length > 0, stats)
  check('no browser runtime errors', errors.length === 0, errors)
  check('imported canonical project remains byte-identical', createHash('sha256').update(await readFile(projectPath)).digest('hex') === sourceHash)
  await page.screenshot({ path: resolve(output, 'caption-baseline-fixture.png') })
  await page.evaluate(() => window.fixtureApi.dispose())
  await browser.close(); browserClosed = true
  await writeFile(resolve(output, 'review.json'), JSON.stringify({ scope: 'ACTUAL_MOUNTED_CAPTION_NATIVE_FONT_WASM_BASELINE_ORACLE', checks, receipts, nativeReceipts, stats, sourceHash, browserClosed, productionQualification: false, limitations: ['The actual BoardRichText and imported authored caption are mounted in an isolated React canvas shell at DPR 2 and scales 1 / 0.5342831949299581.', 'The actual installed native face bytes and production WASM TextEngine are used. An unqualified face remains TEXT_FONT_PIXEL_ACCEPTANCE_PENDING.', 'Hard-break BR content remains typed unsupported; the independent baseline oracle is still exercised against its real DOM lines.', 'The existing multiline first-word anchor conservatively rejects wrapped Reservoir A space Range changes and wrapped break-spaces; these separate problems are not relaxed or fixed by this single-line patch.', 'A literal pre-wrap newline has correct measured DOM partitions but retains TEXT_CONTEXT_LINE_PARTITION_FAILED in native shaping.', 'This regression verifies baseline/source/Range invariance and preserved rejection guards; it is not GPU pixel, native EXE, or integrated 4K performance qualification.'] }, null, 2))
  console.log(JSON.stringify({ output, passed: checks.length, browserClosed, productionQualification: false }, null, 2))
} catch (error) {
  await writeFile(resolve(output, 'review.json'), JSON.stringify({ scope: 'ACTUAL_MOUNTED_CAPTION_NATIVE_FONT_WASM_BASELINE_ORACLE', checks, receipts, nativeReceipts, errors, error: String(error.stack || error), sourceHash, productionQualification: false }, null, 2))
  throw error
} finally {
  await browser?.close(); browserClosed = true
  await server.close()
}
