import { chromium } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import sharp from 'sharp'
import http from 'node:http'

const args = process.argv.slice(2), stylesOnly = args.includes('--styles-only'), coverageOnly = args.includes('--coverage-only'), initialStateOnly=args.includes('--initial-state'), debugOnly = args.includes('--debug')||initialStateOnly, imageBoundsOnly = args.includes('--image-bounds'), columnSizingOnly = args.includes('--column-sizing')
if(imageBoundsOnly&&columnSizingOnly)throw new Error('Run image bounds and column sizing as separate review receipts')
if (!stylesOnly && !args.includes('--full') && !args.includes('--range-self-test')) throw new Error('Choose --styles-only, --range-self-test or explicitly approved --full after a fresh production build')
const target = process.env.NODE_COLUMN_REVIEW_URL || 'http://127.0.0.1:5194'
const output = path.resolve(process.env.NODE_COLUMN_REVIEW_OUT || `../output/playwright/node-column-provider-${Date.now()}`)

// Read-only audit transport must expose genuine HTTP byte seeking. Returning
// an untyped whole-file200 for a Range request makes Chromium report0..0
// seekable time and can falsely blame working native video controls.
async function mediaResponse(file, rangeHeader) {
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('Audit media file exceeds the bounded64MiB fixture transport')
  const headers = { 'accept-ranges': 'bytes', 'content-type': ({ '.webm': 'video/webm', '.mov': 'video/quicktime' })[path.extname(file).toLowerCase()] || 'video/mp4' }
  if (!rangeHeader) return { status: 200, headers: { ...headers, 'content-length': String(stat.size) }, path: file }
  const fail = () => ({ status: 416, headers: { ...headers, 'content-range': `bytes */${stat.size}`, 'content-length': '0' }, body: Buffer.alloc(0) })
  if (typeof rangeHeader !== 'string' || rangeHeader.length > 80) return fail()
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
  if (!match || (!match[1] && !match[2]) || !stat.size) return fail()
  let start, end
  if (!match[1]) {
    const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return fail()
    start = Math.max(0, stat.size - suffix); end = stat.size - 1
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : stat.size - 1
    if (![start,end].every(Number.isSafeInteger) || start >= stat.size || end < start) return fail()
    end = Math.min(end, stat.size - 1)
  }
  const length = end - start + 1, body = Buffer.alloc(length), handle = await fs.open(file, 'r')
  try { let copied = 0; while (copied < length) { const read = await handle.read(body, copied, length - copied, start + copied); if (!read.bytesRead) throw new Error('Audit media changed during ranged read'); copied += read.bytesRead } }
  finally { await handle.close() }
  return { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': String(length) }, body }
}

async function rangeSelfTest() {
  await fs.mkdir(output, {recursive:true}); const file = path.join(output, 'range-probe.mp4'), bytes = Buffer.from('0123456789')
  await fs.writeFile(file, bytes)
  const server = http.createServer(async (request,response) => {
    try { const result = await mediaResponse(file, request.headers.range); response.writeHead(result.status, result.headers); response.end(result.body || await fs.readFile(result.path)) }
    catch (error) { response.writeHead(500);response.end(String(error)) }
  })
  await new Promise(accept => server.listen(0, '127.0.0.1', accept))
  const cases = [{name:'full typed media',status:200,body:'0123456789'}, {name:'satisfiable range',range:'bytes=2-5',status:206,body:'2345',contentRange:'bytes 2-5/10'},
    {name:'open range',range:'bytes=7-',status:206,body:'789',contentRange:'bytes 7-9/10'}, {name:'suffix range',range:'bytes=-3',status:206,body:'789',contentRange:'bytes 7-9/10'},
    {name:'clamped terminal range',range:'bytes=8-99',status:206,body:'89',contentRange:'bytes 8-9/10'},
    ...['bytes=10-','bytes=5-2','bytes=-0','bytes=0-1,4-5','garbage','bytes=9007199254740993-'].map(range=>({name:`refused ${range}`,range,status:416,body:'',contentRange:'bytes */10'}))]
  const results = []
  try {
    for (const test of cases) { const response = await fetch(`http://127.0.0.1:${server.address().port}/media`, {headers:test.range?{Range:test.range}:{}}), body = await response.text()
      const actual = {status:response.status,body,contentRange:response.headers.get('content-range'),acceptRanges:response.headers.get('accept-ranges'),contentLength:response.headers.get('content-length'),contentType:response.headers.get('content-type')}
      results.push({name:test.name,pass:actual.status===test.status&&body===test.body&&actual.contentRange===(test.contentRange||null)&&actual.acceptRanges==='bytes'&&Number(actual.contentLength)===Buffer.byteLength(body)&&actual.contentType==='video/mp4',actual}) }
  } finally { await new Promise((accept,reject)=>server.close(error=>error?reject(error):accept())) }
  const report = {at:new Date().toISOString(),scope:'Actual localhost HTTP requests through the same bounded read-only media response used by the browser adapter.',results,serverClosed:true,browserStarted:false,nativeQualified:false}
  await fs.writeFile(path.join(output,'range-http-review.json'),`${JSON.stringify(report,null,2)}\n`)
  console.log(JSON.stringify({output,checks:results.length,failed:results.filter(test=>!test.pass).length,serverClosed:true}))
  if(results.some(test=>!test.pass))process.exitCode=1
}
if (args.includes('--range-self-test')) { await rangeSelfTest(); process.exit(process.exitCode || 0) }
const corpusRoot = path.resolve('../fixtures/workspace'), projectPath = path.join(corpusRoot, 'projects/p1-v2-studies/project.json')
const corpusBytes = await fs.readFile(projectPath), corpus = JSON.parse(corpusBytes)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fontHelper = process.env.NATIVE_FONT_RESOLVER || 'D:/0/AE2Target-20261007/release/examples/audit-font-resolver.exe'
const fontCache = new Map(), fontReceipts = []
const font = (command, requestArgs) => {
  const key = JSON.stringify({ command, ...requestArgs })
  if (!fontCache.has(key)) fontCache.set(key, new Promise((accept, reject) => {
    const proc = execFile(fontHelper, [], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(stderr || String(error))); return }
      try { const receipt = JSON.parse(stdout); fontReceipts.push({ command, request: requestArgs.request,
        ...Object.fromEntries(Object.entries(receipt).filter(([name]) => name !== 'bytesBase64')), byteCount: receipt.bytesBase64 ? Buffer.from(receipt.bytesBase64, 'base64').length : 0 }); accept(receipt) }
      catch (error) { reject(error) }
    })
    proc.stdin.end(key)
  }))
  return fontCache.get(key)
}
const checks = [], errors = [], boards = [], calls = [], instrumentedModules = []
const check = (name, pass, details) => { checks.push({ name, pass: Boolean(pass), details }); console.log(JSON.stringify({ name, pass: Boolean(pass), ...(!pass ? { details } : {}) })) }
await fs.mkdir(output, { recursive: true })
let browser, browserClosed = false
const sourcePaths = ['src/App.tsx', 'src/App.css', 'src/index.css', 'src/board/VideoReview.tsx', 'src/board/VideoReview.css', 'src/board/VelloBoardBackdrop.tsx', 'src/board/VelloBoardBackdrop.css',
  'src/model/naturalImageBounds.ts', 'src/board/imageDimensions.ts', 'src/board/FormatImagePreview.tsx', 'src/board/FormatImagePreview.css', 'src/board/columns.ts',
  'src/board/completeMeasuredCardPaint.ts', 'src/board/completeMeasuredCardPaint.css', 'src/board/measuredBackgroundPaint.ts', 'src/project-b/p0-surface/cardProviders.ts',
  'src/project-b/p0-surface/liveVideoPaint.ts', 'src/project-b/p0-surface/backgroundImagePaint.ts', 'src/project-b/p0-surface/captureScenePaint.ts',
  'src/project-b/p0-surface/mixedPaint.ts', 'src/board/velloEligibility.ts', 'src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm', 'scripts/node-column-provider-review.mjs']
const sourceReceipts = []
for (const file of sourcePaths) {
  try { const bytes = await fs.readFile(file); sourceReceipts.push({ path: file, absolutePath: path.resolve(file), sha256: hash(bytes), bytes: bytes.length }) }
  catch (error) { if (!stylesOnly) errors.push(`Missing provenance source ${file}: ${error.message}`) }
}
const servedReceipts = []
if (!stylesOnly) {
  const indexResponse = await fetch(target), index = await indexResponse.text()
  servedReceipts.push({ url: target, sha256: hash(index), bytes: Buffer.byteLength(index) })
  for (const match of index.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)) {
    const url = new URL(match[1], target).href, response = await fetch(url), bytes = Buffer.from(await response.arrayBuffer())
    const local = path.resolve('dist', match[1].replace(/^\//, ''))
    let localHash = null
    try { localHash = hash(await fs.readFile(local)) } catch {}
    servedReceipts.push({ url, sha256: hash(bytes), bytes: bytes.length, localPath: local, localSha256: localHash, matchesLocalBuild: response.ok && localHash === hash(bytes) })
  }
  check('served main production assets match the local dist build', servedReceipts.length > 1 && servedReceipts.slice(1).every(receipt => receipt.matchesLocalBuild), servedReceipts)
}
const compilerSource = await fs.readFile('src/board/completeMeasuredCardPaint.ts', 'utf8')
const compilerAst = ts.createSourceFile('completeMeasuredCardPaint.ts', compilerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const canonicalFunction = compilerAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'withCanonicalCardPaint')
if (!canonicalFunction) throw new Error('Actual canonical card reader unavailable')
const canonicalReaderCode = ts.transpileModule(canonicalFunction.getText(compilerAst), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export /m, '')

async function openBoard(boardId, options = {}) {
  const board = corpus.boards.find(board => board.id === boardId)
  if (!board) throw new Error(`Missing corpus board ${boardId}`)
  const project = structuredClone(corpus), memory = new Map(), localErrors = []
  if (options.nodeOverrides) for (const node of project.boards.find(board => board.id === boardId).nodes) if (options.nodeOverrides[node.id]) Object.assign(node, structuredClone(options.nodeOverrides[node.id]))
  const settings = { schemaVersion: 5, theme: 'navy', glassStrength: 0, viewMode: 'canvas', splitRatio: 54, activeProjectId: project.id,
    projectNavigation: { [project.id]: { activeBoardId: boardId, activeDocumentId: project.documents[0]?.id || '', activeNavigatorItem: `board:${boardId}`, viewMode: 'canvas' } } }
  memory.set('settings.json', settings); memory.set(`projects/${project.id}/project.json`, project)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'no-preference', acceptDownloads: true })
  const page = await context.newPage()
  await page.exposeFunction('__auditInvoke', async (command, requestArgs = {}) => {
    calls.push({ boardId, command })
    if (command.startsWith('resolve_system_font')) return font(command, requestArgs)
    if (command === 'workspace_info') return { root: 'audit', workspaceId: 'audit', readOnly: Boolean(options.readOnly), lockOwned: !options.readOnly }
    if (command === 'list_projects') return [{ id: project.id, title: project.title, updatedAt: project.updatedAt, boardCount: project.boards.length, assetCount: project.assets.length }]
    if (command === 'load_json') return structuredClone(memory.get(requestArgs.relativePath) || null)
    if (command === 'save_json') {
      if (options.readOnly && requestArgs.relativePath.startsWith('projects/')) throw new Error('Disposable read-only workspace refuses project writes')
      memory.set(requestArgs.relativePath, structuredClone(requestArgs.value)); return { relativePath: requestArgs.relativePath, bytesWritten: JSON.stringify(requestArgs.value).length }
    }
    if (command === 'audit_assets') return project.assets.map(asset => ({ id: asset.id, status: asset.status }))
    if (['list_project_trash', 'list_trashed_projects', 'list_recovery_entries'].includes(command)) return []
    if (command === 'project_b_preflight_context') return { enabled: false }
    if (command === 'plugin:event|listen') return 1
    if (command === 'plugin:window|scale_factor') return 1
    if (['mini_bridge_launch', 'ensure_managed_board_folders', 'record_performance_batch', 'record_frontend_diagnostic', 'plugin:event|unlisten'].includes(command)) return null
    throw new Error(`Disposable review adapter unsupported: ${command}`)
  })
  await context.route('**/__audit_assets/**', async route => {
    const relative = decodeURIComponent(route.request().url().split('/__audit_assets/')[1]).replace(/^audit[\\/]/, '')
    const file = path.resolve(corpusRoot, relative)
    if (!file.startsWith(corpusRoot + path.sep)) return route.abort()
    try { await route.fulfill(/\.(?:mp4|webm|mov)$/i.test(file) ? await mediaResponse(file, route.request().headers().range) : { path: file }) }
    catch { await route.fulfill({ status: 404, body: '' }) }
  })
  if (debugOnly) await context.route(/\/assets\/p0_engine_wasm-[^/]+\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch(), original = await response.text()
    const ast = ts.createSourceFile('served-engine.js', original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const exported = ast.statements.filter(ts.isExportDeclaration).flatMap(statement => statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements : [])
      .find(element => element.name.text === 'B4SurfaceRenderer')
    if (!exported) throw new Error('Actual served B4SurfaceRenderer export unavailable for disclosed debug hook')
    const local = exported.propertyName?.text || exported.name.text
    const hook = `\n;(() => {
      if (typeof window === 'undefined') return;
      window.__reviewEngineFrames = []; window.__reviewEngineFirstFrames = []; window.__reviewEngineFirstNonemptyFrames = []; window.__reviewEnginePresentations = []; window.__reviewEngineImages = new Map(); window.__reviewEngineImageBytes = 0;
      const proto = ${local}.prototype, prepare = proto.prepare_snapshot, register = proto.register_image, present = proto.present_prepared;
      proto.prepare_snapshot = function(width,height,snapshot,scale,panX,panY) {
        const frame={at:performance.now(),width,height,snapshot,scale,panX,panY};
        window.__reviewEngineFrames.push(frame);
        if(window.__reviewEngineFirstFrames.length<8)window.__reviewEngineFirstFrames.push(frame);
        if(window.__reviewEngineFirstNonemptyFrames.length<8&&JSON.parse(snapshot).operations.length)window.__reviewEngineFirstNonemptyFrames.push(frame);
        if(window.__reviewEngineFrames.length>16)window.__reviewEngineFrames.shift();
        return prepare.apply(this,arguments);
      };
      proto.register_image = function(referenceJson,pixels) {
        const reference = JSON.parse(referenceJson), identity = JSON.stringify(reference), existing = window.__reviewEngineImages.get(identity);
        if(!existing && pixels.byteLength<=32*1024*1024) {
          while(window.__reviewEngineImageBytes+pixels.byteLength>32*1024*1024 && window.__reviewEngineImages.size) {
            const oldest=window.__reviewEngineImages.keys().next().value, value=window.__reviewEngineImages.get(oldest);
            window.__reviewEngineImages.delete(oldest);window.__reviewEngineImageBytes-=value.pixels.byteLength;
          }
          window.__reviewEngineImages.set(identity,{reference,pixels:pixels.slice()});window.__reviewEngineImageBytes+=pixels.byteLength;
        }
        return register.apply(this,arguments);
      };
      proto.present_prepared = function() {
        const result = present.apply(this,arguments);
        window.__reviewEnginePresentations.push({at:performance.now(),metadata:JSON.parse(result)});
        if(window.__reviewEnginePresentations.length>32)window.__reviewEnginePresentations.shift();
        return result;
      };
    })();\n`
    instrumentedModules.push({ boardId, url: route.request().url(), originalSha256: hash(original), instrumentedSha256: hash(original + hook),
      scope: 'Disclosed debug-only class wrappers preserve original methods/arguments/returns; retain actual submitted snapshot and bounded upload copies; no timing claim.' })
    await route.fulfill({ response, body: original + hook, contentType: 'text/javascript' })
  })
  await page.addInitScript(() => {
    let callback = 0
    window.__TAURI_INTERNALS__ = { invoke: (command, args) => window.__auditInvoke(command, args), convertFileSrc: source => location.origin + '/__audit_assets/' + encodeURIComponent(source.replace(/^audit[\\/]/, '')),
      transformCallback: () => ++callback, unregisterCallback: () => {}, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } } }
    window.__reviewDecodedFrames = []
    window.__reviewVideoReadbacks = 0
    window.__reviewNativeEvents = []
    window.__reviewTransitions = []
    for (const type of ['transitionrun','transitionstart','transitionend','transitioncancel']) document.addEventListener(type, event => {
      const element = event.target, article = element instanceof Element && element.closest('article[data-node-id]')
      if (!article) return
      const style = getComputedStyle(element)
      window.__reviewTransitions.push({ type, at: performance.now(), nodeId: article.dataset.nodeId, owner: article.dataset.velloCardPaint || null,
        tag: element.tagName, class: element.className?.baseVal ?? element.className, property: event.propertyName, elapsedTime: event.elapsedTime,
        transitionProperty: style.transitionProperty, transitionDuration: style.transitionDuration, opacity: style.opacity, backgroundColor: style.backgroundColor, color: style.color })
      if (window.__reviewTransitions.length > 300) window.__reviewTransitions.shift()
    }, true)
    for (const type of ['keydown','keyup','click','input','change','seeking','seeked','durationchange','loadedmetadata']) document.addEventListener(type, event => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('article:has(video),.video-controls-dialog')) return
      const record = { type, at: performance.now(), nodeId: target.closest('article')?.dataset.nodeId || window.__reviewDebugVideoId,
        tag: target.tagName, label: target.getAttribute('aria-label'), key: event.key, value: target.value, defaultPrevented: event.defaultPrevented }
      if (target instanceof HTMLVideoElement) Object.assign(record, { time: target.currentTime, duration: target.duration, seeking: target.seeking })
      window.__reviewNativeEvents.push(record); if (window.__reviewNativeEvents.length > 300) window.__reviewNativeEvents.shift()
      queueMicrotask(() => { record.afterDefaultPrevented = event.defaultPrevented; record.activeLabel = document.activeElement?.getAttribute('aria-label') })
    }, true)
    const videoContexts = new WeakSet(), draw = CanvasRenderingContext2D.prototype.drawImage, read = CanvasRenderingContext2D.prototype.getImageData
    CanvasRenderingContext2D.prototype.drawImage = function (...args) { if (args[0] instanceof HTMLVideoElement) videoContexts.add(this); return draw.apply(this, args) }
    CanvasRenderingContext2D.prototype.getImageData = function (...args) { if (videoContexts.has(this)) window.__reviewVideoReadbacks++; return read.apply(this, args) }
    const original = HTMLVideoElement.prototype.requestVideoFrameCallback
    if (original) HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
      return original.call(this, (now, metadata) => {
        window.__reviewDecodedFrames.push({ source: this.currentSrc, currentTime: this.currentTime, mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames,
          nodeId: this.closest('article[data-node-id]')?.dataset.nodeId, at: now })
        if (window.__reviewDecodedFrames.length > 1024) window.__reviewDecodedFrames.shift()
        callback(now, metadata)
      })
    }
  })
  page.on('pageerror', error => localErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') localErrors.push(message.text()) })
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.locator('.canvas-stage').first().waitFor({ timeout: 60000 })
  const canvasMode = page.getByRole('button', { name: 'Canvas', exact: true }); if (await canvasMode.isVisible()) await canvasMode.click()
  await page.locator('.vello-board').first().waitFor({ timeout: 60000 })
  await page.waitForTimeout(1500)
  for (let attempt = 0; attempt < 5; attempt++) {
    const size = await page.locator('.vello-board').first().evaluate(host => ({ width: host.clientWidth, height: host.clientHeight })), viewport = page.viewportSize()
    if (size.width === 1920 && size.height === 1080) break
    await page.setViewportSize({ width: viewport.width + 1920 - size.width, height: viewport.height + 1080 - size.height })
    await page.waitForTimeout(500)
  }
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(code => { window.__nodeColumnCanonicalRead = new Function(`${code};return withCanonicalCardPaint`)() }, canonicalReaderCode)
  await page.evaluate(() => {
    window.__reviewGpuCommits = []
    const host = document.querySelector('.vello-board')
    const observer = new MutationObserver(records => {
      if (!records.some(record => record.attributeName === 'data-accepted-generation')) return
      const metadata = JSON.parse(host.dataset.frameMetadata || '{}')
      window.__reviewGpuCommits.push({ at: performance.now(), generation: host.dataset.acceptedGeneration, backend: host.dataset.acceptedBackend,
        painted: host.dataset.paintedObjects, images: metadata.images, resources: metadata.imageResources?.references ?? [],
        ownedVideoIds: [...document.querySelectorAll('article:has(video)')].filter(article => article.dataset.velloCardPaint === 'complete').map(article => article.dataset.nodeId) })
      if (window.__reviewGpuCommits.length > 1024) window.__reviewGpuCommits.shift()
    })
    observer.observe(host, { attributes: true, attributeFilter: ['data-accepted-generation'] })
    window.__reviewGpuCommitObserver = observer
  })
  return { page, context, board, memory, localErrors }
}

async function settle(page, label) {
  try { await page.waitForFunction(debugOnly => {
    const host = document.querySelector('.vello-board')
    const cardAnimations = [...document.querySelectorAll('article[data-node-id]')].flatMap(article => article.getAnimations({subtree:true}))
    return host?.dataset.pending === 'false' && host.dataset.generation === host.dataset.acceptedGeneration && host.dataset.acceptedBackend === 'gpu'
      && (debugOnly || !cardAnimations.some(animation => animation.playState === 'running' || animation.pending))
  }, debugOnly, { timeout: 20000 }); return true }
  catch (error) { errors.push(`${label}: current GPU generation did not settle: ${error.message}`); return false }
}

async function receipt(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.vello-board'), stage = document.querySelector('.canvas-stage')
    return { host: host ? { ...host.dataset } : null, stage: stage ? { ...stage.dataset } : null,
      canvases: [...(host?.querySelectorAll('canvas') || [])].map(canvas => ({ width: canvas.width, height: canvas.height, hidden: canvas.hidden })),
      ownership: [...document.querySelectorAll('article[data-node-id]')].map(article => ({ id: article.dataset.nodeId, card: article.dataset.velloCardPaint ?? null, vector: article.dataset.velloPaint ?? null })),
      videos: [...document.querySelectorAll('article video')].map(video => ({ id: video.closest('article').dataset.nodeId, source: video.currentSrc, readyState: video.readyState, paused: video.paused, seeking: video.seeking,
        time: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight, muted: video.muted, volume: video.volume })),
      decodedFrames: window.__reviewDecodedFrames, videoReadbacks: window.__reviewVideoReadbacks,
      gpuCommits: window.__reviewGpuCommits, nativeEvents: window.__reviewNativeEvents, transitions: window.__reviewTransitions,
      animations: [...document.querySelectorAll('article[data-node-id]')].flatMap(article => article.getAnimations({subtree:true}).map(animation => ({
        nodeId: article.dataset.nodeId, owner: article.dataset.velloCardPaint || null, kind: animation.constructor.name, name: animation.animationName,
        property: animation.transitionProperty, pending: animation.pending, playState: animation.playState, currentTime: animation.currentTime,
        tag: animation.effect?.target?.tagName, class: animation.effect?.target?.className?.baseVal ?? animation.effect?.target?.className,
        timing: animation.effect?.getComputedTiming(), keyframes: animation.effect?.getKeyframes() }))), diagnostics: window.__AE_DIAGNOSTICS__?.snapshot() }
  })
}

async function canonicalStyles(page) {
  return page.evaluate(() => [...document.querySelectorAll('article[data-node-id]')].filter(article => ['left', 'middle', 'right', 'source-video-6', 'source-video-7'].includes(article.dataset.nodeId)).map(article => {
    return window.__nodeColumnCanonicalRead(article, () => {
      return { id: article.dataset.nodeId, class: article.className, rect: article.getBoundingClientRect().toJSON(), styles: [article, ...article.querySelectorAll('*')].map(element => {
        const style = getComputedStyle(element)
        const selector = []; for (let current = element; current && current !== article; current = current.parentElement) selector.unshift(`${current.localName}:nth-child(${[...current.parentElement.children].indexOf(current) + 1})`)
        return { tag: element.tagName, path: [article.dataset.nodeId, ...selector].join('>'), class: element.getAttribute('class'), text: element.textContent?.slice(0, 80), backgroundImage: style.backgroundImage,
          backgroundColor: style.backgroundColor, backgroundOrigin: style.backgroundOrigin, backgroundClip: style.backgroundClip, backgroundRepeat: style.backgroundRepeat,
          backgroundPosition: style.backgroundPosition, backgroundSize: style.backgroundSize, backgroundAttachment: style.backgroundAttachment,
          width: style.width, height: style.height, border: style.borderWidth, borderRadius: style.borderRadius, opacity: style.opacity, boxShadow: style.boxShadow, objectFit: style.objectFit, objectPosition: style.objectPosition,
          overflowX: style.overflowX, overflowY: style.overflowY, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
          display: style.display, boxSizing: style.boxSizing, minWidth: style.minWidth, minHeight: style.minHeight, maxWidth: style.maxWidth, maxHeight: style.maxHeight,
          gridTemplateRows: style.gridTemplateRows, gridTemplateColumns: style.gridTemplateColumns, gridAutoRows: style.gridAutoRows, gridAutoColumns: style.gridAutoColumns,
          gap: style.gap, lineHeight: style.lineHeight, whiteSpace: style.whiteSpace, textOverflow: style.textOverflow,
          overflowWrap: style.overflowWrap, wordBreak: style.wordBreak, fontFamily: style.fontFamily, fontSize: style.fontSize, padding: style.padding, margin: style.margin,
          actualRect: element.getBoundingClientRect().toJSON() }
      }) }
    })
  }))
}

async function compareCanonicalPixels(page, boardId, diagnostic = false) {
  const host = page.locator('.vello-board').first(), gpuFile = path.join(output, `${boardId}-gpu.png`), domFile = path.join(output, `${boardId}-canonical-dom.png`)
  await page.mouse.move(1, 1); await settle(page, `${boardId} before pixel comparison`)
  const before = await receipt(page)
  const complete = Number(before.host.paintedObjects) > 0 && before.ownership.length > 0 && before.ownership.every(node => node.card === 'complete')
  check(`${boardId} pixel proof requires complete stable actual GPU ownership`, complete, { host: before.host, ownership: before.ownership })
  if (!complete && !diagnostic) return { status: 'NOT_RUN_OWNERSHIP_PREREQUISITE', scope: 'A DOM-visible screenshot cannot establish GPU parity.', before }
  const canvas = host.locator('canvas:not([hidden])').first(), clip = await canvas.boundingBox()
  if (!clip) throw new Error('Actual visible GPU canvas rectangle unavailable')
  const gpu = await page.screenshot({ path: gpuFile, clip })
  // Reference capture uses the actual synchronous canonical style reader.
  // Ownership datasets and accepted frame stay intact. Only this disclosed
  // debug stylesheet restores measured semantic skin and hides the GPU canvas
  // for one screenshot; it is removed before any ownership/workflow check.
  const preparation = await page.evaluate(clip => {
    const properties = ['background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', 'outline-color', 'color', 'opacity', 'fill', 'stroke', 'text-shadow']
    const records = [], rules = [], articles = [...document.querySelectorAll('article[data-node-id]')]
    const originalHtml = articles.map(article => [article.dataset.nodeId, article.outerHTML])
    for (const article of articles) window.__nodeColumnCanonicalRead(article, () => {
      for (const element of [article, ...article.querySelectorAll('*')]) {
        const index = records.length, previous = element.getAttribute('data-node-column-review-element'), style = getComputedStyle(element)
        records.push({ element, previous }); element.setAttribute('data-node-column-review-element', String(index))
        rules.push(`#root [data-node-column-review-element="${index}"]{${properties.map(property => `${property}:${style.getPropertyValue(property)} !important`).join(';')}}`)
      }
    })
    rules.push('#root .vello-board>.vello-board-canvas{visibility:hidden!important}')
    const style = document.createElement('style'); style.dataset.nodeColumnReviewReference = 'true'; style.textContent = rules.join('\n'); document.head.append(style)
    window.__reviewDomReference = { records, style, originalHtml }
    const expectedImages=articles.flatMap(article=>[...article.querySelectorAll('img')].filter(img=>img.naturalWidth>0&&img.naturalHeight>0).map(img=>({id:article.dataset.nodeId,rect:img.getBoundingClientRect().toJSON()})))
      .filter(image=>image.rect.right>clip.x&&image.rect.left<clip.x+clip.width&&image.rect.bottom>clip.y&&image.rect.top<clip.y+clip.height)
    return { elements: records.length, source: 'actual withCanonicalCardPaint from frozen compiler', ownershipMarkersUnmodified: true,expectedImages }
  },clip)
  let dom, restoration
  try { dom = await page.screenshot({ path: domFile, clip }) }
  finally {
    restoration = await page.evaluate(() => {
      const { records, style, originalHtml } = window.__reviewDomReference
      style.remove()
      for (const { element, previous } of records) previous === null ? element.removeAttribute('data-node-column-review-element') : element.setAttribute('data-node-column-review-element', previous)
      delete window.__reviewDomReference
      return { sourceHtmlRestored: originalHtml.every(([id, html]) => document.querySelector(`article[data-node-id="${CSS.escape(id)}"]`)?.outerHTML === html) }
    })
  }
  const after = await receipt(page)
  const left = await sharp(gpu).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), right = await sharp(dom).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let differingPixels = 0, maxChannelDelta = 0
  const dimensionsMatch = left.info.width === right.info.width && left.info.height === right.info.height
  if (dimensionsMatch) for (let i = 0; i < left.data.length; i += 4) {
    let different = false
    for (let channel = 0; channel < 4; channel++) { const delta = Math.abs(left.data[i + channel] - right.data[i + channel]); if (delta) different = true; maxChannelDelta = Math.max(maxChannelDelta, delta) }
    if (different) differingPixels++
  }
  const referenceImageContent=preparation.expectedImages.map(image=>{
    const colors=new Set(),rect=image.rect,x0=Math.max(0,Math.floor((rect.x-clip.x)*right.info.width/clip.width)),x1=Math.min(right.info.width,Math.ceil((rect.right-clip.x)*right.info.width/clip.width)),
      y0=Math.max(0,Math.floor((rect.y-clip.y)*right.info.height/clip.height)),y1=Math.min(right.info.height,Math.ceil((rect.bottom-clip.y)*right.info.height/clip.height))
    for(let y=y0;y<y1&&colors.size<=32;y++)for(let x=x0;x<x1&&colors.size<=32;x++){const i=(y*right.info.width+x)*4;colors.add(`${right.data[i]},${right.data[i+1]},${right.data[i+2]}`)}
    return{id:image.id,distinctReferenceRgbAtLeast:colors.size,physicalImageRect:{x:x0,y:y0,width:x1-x0,height:y1-y0}}
  })
  const referenceContentPresent=referenceImageContent.some(image=>image.distinctReferenceRgbAtLeast>32)
  const result = { status: complete ? 'COMPLETE_OWNERSHIP_PIXEL_SAMPLE' : 'DIAGNOSTIC_INCOMPLETE_OWNERSHIP_PIXEL_SAMPLE',
    scope: 'All RGBA bytes in exact physical canvas, no masks/tolerance; browser screenshot of actual GPU ownership versus debug canonical DOM skin.',
    files: { gpu: gpuFile, canonicalDom: domFile }, width: left.info.width, height: left.info.height, exactPhysical4k: left.info.width === 3840 && left.info.height === 2160,
    dimensionsMatch, differingPixels, maxChannelDelta, preparation, restoration, before,referenceImageContent,referenceContentPresent,
    ownershipUnchanged: JSON.stringify(before.ownership) === JSON.stringify(after.ownership), generationUnchanged: before.host.acceptedGeneration === after.host.acceptedGeneration }
  check(`${boardId} canonical reference restores DOM/source and preserves accepted ownership`, restoration.sourceHtmlRestored && result.ownershipUnchanged && result.generationUnchanged, result)
  check(`${boardId} exact canonical DOM/GPU full-canvas pixel parity`, complete && referenceContentPresent && result.exactPhysical4k && dimensionsMatch && differingPixels === 0, result)
  return result
}

async function videoWorkflows(session) {
  const { page, board, memory } = session, results = []
  for (const nodeId of ['source-video-6', 'source-video-7']) {
    const article = page.locator(`article[data-node-id="${nodeId}"]`), video = article.locator('video')
    const state = () => video.evaluate(video => ({ time: video.currentTime, paused: video.paused, readyState: video.readyState, seeking: video.seeking, muted: video.muted, volume: video.volume }))
    const before = await state(), old = await receipt(page)
    await article.getByRole('button', { name: 'Play or pause', exact: true }).click()
    await page.waitForTimeout(1400)
    const playing = await state(), liveReceipt = await receipt(page), liveGpu = await page.evaluate(() => window.__reviewGpuCommits)
    check(`${nodeId} actual MP4 plays with progressing media time`, !playing.paused && playing.time > before.time + .2, { before, playing })
    const decoded = liveReceipt.decodedFrames.filter(frame => frame.nodeId === nodeId)
    const commits = liveGpu.filter(commit => Number(commit.generation) > Number(old.host.acceptedGeneration) && commit.ownedVideoIds.includes(nodeId))
    const versions = new Set(commits.flatMap(commit => commit.resources.filter(resource => resource.key.startsWith(`${nodeId}:`)).map(resource => `${resource.key}:${resource.revision}`)))
    check(`${nodeId} live decoded frames reach accepted GPU card/image revisions`, decoded.length >= 2 && commits.length >= 2 && versions.size >= 2, { decodedFrames: decoded.slice(-8), acceptedCommits: commits.slice(-8), imageVersions: [...versions] })
    await article.getByRole('button', { name: 'Play or pause', exact: true }).click()
    await page.waitForFunction(id => { const video = document.querySelector(`article[data-node-id="${id}"] video`); return video?.paused && !video.seeking }, nodeId)
    await settle(page, `${nodeId} pause`)
    const paused = await state(), decodedBeforePauseWait = (await receipt(page)).decodedFrames.length
    await page.waitForTimeout(350)
    check(`${nodeId} pause holds time and stops decoded-frame scheduling`, (await state()).time === paused.time && (await receipt(page)).decodedFrames.length === decodedBeforePauseWait, paused)

    await article.getByRole('button', { name: 'Mute video', exact: true }).click(); check(`${nodeId} mute changes the real media element`, (await state()).muted, await state())
    await article.getByRole('button', { name: 'Unmute video', exact: true }).click(); check(`${nodeId} unmute restores real media audio state`, !(await state()).muted, await state())
    const title = await video.getAttribute('aria-label'), trigger = article.getByRole('button', { name: 'Video controls', exact: true })
    await page.evaluate(id => { window.__reviewOriginalVideos ??= {}; window.__reviewOriginalVideos[id] = document.querySelector(`article[data-node-id="${id}"] video`) }, nodeId)
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: `Video controls: ${title}`, exact: true }); await dialog.waitFor({ state: 'visible' })
    const portal = await dialog.evaluate(dialog => ({ insideShell: Boolean(dialog.closest('.studio-shell')), insideCanvas: Boolean(dialog.closest('.canvas-stage')), modal: dialog.getAttribute('aria-modal') }))
    check(`${nodeId} full native controls open in reachable modeless shell dialog`, portal.insideShell && !portal.insideCanvas && portal.modal !== 'true', portal)
    const volume = dialog.getByRole('slider', { name: 'Video volume', exact: true })
    await volume.focus(); await volume.press('Home'); await volume.press('ArrowUp')
    await settle(page, `${nodeId} volume keyboard`)
    const volumeState = await state(), focusedReceipt = await receipt(page)
    check(`${nodeId} dialog native volume keyboard works while GPU ownership remains`, volumeState.volume > 0 && volumeState.volume <= .02 && !volumeState.muted && focusedReceipt.ownership.find(node => node.id === nodeId)?.card === 'complete', { volumeState, owner: focusedReceipt.ownership.find(node => node.id === nodeId), blockers: focusedReceipt.host.completePaintBlockers })
    const scrubber = article.getByRole('slider', { name: 'Video position', exact: true })
    await scrubber.focus(); await scrubber.press('Home'); await page.waitForTimeout(200); await scrubber.press('PageUp')
    await page.waitForFunction(id => { const video = document.querySelector(`article[data-node-id="${id}"] video`); return !video.seeking && video.currentTime > .1 }, nodeId, {timeout:5000})
    check(`${nodeId} keyboard seek updates actual decoded media time`, (await state()).time > .1, await state())
    const rate = dialog.getByRole('combobox', { name: 'Frame rate', exact: true }); await rate.selectOption('30')
    const stepBefore = (await state()).time
    await dialog.getByRole('button', { name: 'Next frame', exact: true }).focus(); await page.keyboard.press('Enter')
    await page.waitForFunction(({id,target}) => { const video = document.querySelector(`article[data-node-id="${id}"] video`); return !video.seeking && Math.abs(video.currentTime-target) < .002 }, {id:nodeId,target:stepBefore+1/30}, {timeout:5000})
    const stepAfter = (await state()).time
    await dialog.getByRole('button', { name: 'Previous frame', exact: true }).focus(); await page.keyboard.press('Enter')
    await page.waitForFunction(({id,target}) => { const video = document.querySelector(`article[data-node-id="${id}"] video`); return !video.seeking && Math.abs(video.currentTime-target) < .002 }, {id:nodeId,target:stepBefore}, {timeout:5000})
    check(`${nodeId} keyboard frame stepping honors the selected 30fps rate`, Math.abs(stepAfter - stepBefore - 1 / 30) < .002 && Math.abs((await state()).time - stepBefore) < .002, { stepBefore, stepAfter, restored: (await state()).time })

    const note = dialog.getByRole('textbox', { name: 'Annotation note', exact: true }), noteText = `GPU review ${nodeId.slice(-1)}`
    await note.focus(); await note.fill(noteText); await page.waitForTimeout(250)
    await settle(page, `${nodeId} dialog note edit`)
    const editing = await receipt(page), blockers = JSON.parse(editing.host.completePaintBlockers || '{}')
    const sameVideo = await page.evaluate(id => window.__reviewOriginalVideos[id] === document.querySelector(`article[data-node-id="${id}"] video`), nodeId)
    check(`${nodeId} focused dialog note keeps original decoder and GPU card ownership`, sameVideo && editing.ownership.find(node => node.id === nodeId)?.card === 'complete' && !blockers[nodeId]?.includes('CARD_EDITING_ACTIVE'), { sameVideo, owner: editing.ownership.find(node => node.id === nodeId), blockers: blockers[nodeId] })
    await note.press('Enter'); await dialog.locator('.video-annotation-list').getByText(noteText, { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Canvas', exact: true }).focus(); await settle(page, `${nodeId} annotation added`)
    const search = dialog.getByRole('searchbox', { name: 'Search video annotations', exact: true })
    await search.fill('not-present-review'); check(`${nodeId} annotation search filters visible notes`, await dialog.getByText('No matching notes.', { exact: true }).isVisible(), null)
    await search.fill(noteText); check(`${nodeId} annotation search restores matching note`, await dialog.locator('.video-annotation-list').getByText(noteText, { exact: true }).isVisible(), null)
    const downloadPromise = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Export video annotations', exact: true }).click()
    const download = await downloadPromise, exportPath = path.join(output, `${nodeId}-annotation-export.json`); await download.saveAs(exportPath)
    const exported = JSON.parse(await fs.readFile(exportPath, 'utf8')), record = exported.annotations.find(annotation => annotation.text === noteText)
    check(`${nodeId} exported annotation contains actual note/timecode/frame rate`, exported.frameRate === 30 && record && Number.isFinite(record.seconds) && typeof record.timecode === 'string', { exportPath, exported })
    await dialog.getByRole('button', { name: `Delete annotation ${noteText}`, exact: true }).click()
    check(`${nodeId} annotation delete removes the disposable record`, await dialog.locator('.video-annotation-list').getByText(noteText, { exact: true }).count() === 0, null)
    const controlTargets = await dialog.evaluate(dialog => [...dialog.querySelectorAll('button,input,select')].map(element => { const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return {
      label: element.getAttribute('aria-label') || element.textContent, width: rect.width, height: rect.height, reachable: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && style.visibility !== 'hidden' && style.display !== 'none' } }))
    check(`${nodeId} dialog native controls have reachable targets`, controlTargets.every(target => target.reachable && target.height >= 24), controlTargets)
    await page.screenshot({ path: path.join(output, `${nodeId}-controls-dialog.png`) })
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(id => document.activeElement === document.querySelector(`article[data-node-id="${id}"] button[aria-label="Video controls"]`), nodeId)
    check(`${nodeId} Escape closes dialog and restores original trigger focus`, await trigger.evaluate(trigger => document.activeElement === trigger), null)
    await trigger.click(); await dialog.waitFor({ state: 'visible' }); await dialog.getByRole('button', { name: 'Close video controls', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(id => document.activeElement === document.querySelector(`article[data-node-id="${id}"] button[aria-label="Video controls"]`), nodeId)
    check(`${nodeId} close button restores original trigger focus`, await trigger.evaluate(trigger => document.activeElement === trigger), null)
    await page.getByRole('button', { name: 'Canvas', exact: true }).focus(); await page.mouse.move(1, 1); await settle(page, `${nodeId} editing cleared`)
    const final = await receipt(page)
    check(`${nodeId} clearing editor focus restores accepted GPU card paint`, final.ownership.find(node => node.id === nodeId)?.card === 'complete', { owner: final.ownership.find(node => node.id === nodeId), blockers: final.host.completePaintBlockers })
    results.push({ nodeId, before, playing, paused, final, exported })
  }
  await page.waitForTimeout(1600)
  const saved = memory.get(`projects/${corpus.id}/project.json`), savedBoard = saved.boards.find(entry => entry.id === board.id)
  check('video workflow persists only into the disposable project adapter', ['source-video-6', 'source-video-7'].every(id => savedBoard.nodes.find(node => node.id === id)?.videoFrameRate === 30), { projectId: saved.id, boardId: savedBoard.id })
  return results
}

async function persistEngineDebug(page, boardId) {
  const frames = await page.evaluate(() => ({ frames: window.__reviewEngineFrames || [], firstFrames:window.__reviewEngineFirstFrames||[],firstNonemptyFrames:window.__reviewEngineFirstNonemptyFrames||[],presentations: window.__reviewEnginePresentations || [] }))
  await fs.writeFile(path.join(output, `${boardId}-engine-submissions.json`), `${JSON.stringify(frames, null, 2)}\n`)
  const references = await page.evaluate(() => [...(window.__reviewEngineImages?.values() || [])].map(value => value.reference)), uploads = []
  for (const [index, reference] of references.entries()) {
    const base64 = await page.evaluate(reference => {
      const value = window.__reviewEngineImages.get(JSON.stringify(reference)); let binary = ''
      for (let offset = 0; offset < value.pixels.length; offset += 8192) binary += String.fromCharCode(...value.pixels.subarray(offset, offset + 8192))
      return btoa(binary)
    }, reference)
    const pixels = Buffer.from(base64, 'base64'), file = `${boardId}-engine-image-${index}.rgba`
    await fs.writeFile(path.join(output, file), pixels)
    uploads.push({ reference, file, bytes: pixels.length, sha256: hash(pixels), format: 'canonical premultiplied sRGB RGBA8, exact original register_image bytes' })
  }
  await fs.writeFile(path.join(output, `${boardId}-engine-uploads.json`), `${JSON.stringify(uploads, null, 2)}\n`)
  const actual = await receipt(page), diagnostics = actual.diagnostics?.rows || []
  const summary = { boardId, submissions: frames.frames.length, presentations: frames.presentations.length, uploads, host: actual.host,
    paintDiagnosticTail: diagnostics.filter(row => /^paint\.|^gpu\./.test(row.kind)).slice(-100),
    diagnosticCounts: Object.fromEntries([...new Set(diagnostics.map(row => row.kind))].filter(kind => /^paint\.|^gpu\./.test(kind)).map(kind => [kind, diagnostics.filter(row => row.kind === kind).length])) }
  await fs.writeFile(path.join(output, `${boardId}-debug-summary.json`), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify({ debugCapture: boardId, submissions: summary.submissions, presentations: summary.presentations, uploadCount: uploads.length, output }))
  return summary
}

// Read the accepted DOM skin and raw GPU canvas together before canonical
// readers temporarily remove ownership markers or any authored UI interaction.
// A valid engine frame must not disappear behind an opaque accepted DOM skin.
async function captureInitialOwnership(page, boardId) {
  const observed = await page.evaluate(() => {
    const canvas = document.querySelector('.vello-board > .vello-board-canvas:not([hidden])'), host = canvas?.closest('.vello-board')
    if (!canvas || !host) throw new Error('Initial actual GPU canvas unavailable')
    const describe = element => { const style = getComputedStyle(element); return {
      tag: element.tagName, class: element.getAttribute('class'), rect: element.getBoundingClientRect().toJSON(),
      position: style.position, zIndex: style.zIndex, opacity: style.opacity, visibility: style.visibility, display: style.display,
      backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, filter: style.filter, transform: style.transform,
      clipPath: style.clipPath, overflowX: style.overflowX, overflowY: style.overflowY,
    } }
    const ancestors = []; for (let element = canvas; element; element = element.parentElement) ancestors.push(describe(element))
    const columns = [...document.querySelectorAll('article.node-column')].map(element => {
      const rendererStage = element.closest('.canvas-stage[data-canvas-renderer="vello"]'), style = getComputedStyle(element)
      return { id: element.dataset.nodeId, owner: element.dataset.velloCardPaint ?? null, renderer: rendererStage?.dataset.canvasRenderer ?? null,
        observed: describe(element), transparent: style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent',
        backgroundImageAbsent: style.backgroundImage === 'none' }
    })
    return { host: { ...host.dataset }, columns, ancestors, backing: { width: canvas.width, height: canvas.height },
      png: canvas.toDataURL('image/png') }
  })
  // Keep the composited page before canonicalStyles temporarily releases paint.
  const pageFile = path.join(output, `${boardId}-initial-owned-page.png`)
  await page.screenshot({ path: pageFile })
  const pageHost = await page.evaluate(() => ({ ...document.querySelector('.vello-board')?.dataset }))
  const rawFile = path.join(output, `${boardId}-initial-owned-raw-canvas.png`)
  await fs.writeFile(rawFile, Buffer.from(observed.png.slice(observed.png.indexOf(',') + 1), 'base64'))
  delete observed.png
  const raw = await sharp(rawFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), colors = new Set()
  let nonzeroAlpha = 0, opaque = 0
  for (let offset = 0; offset < raw.data.length; offset += 4) {
    nonzeroAlpha += raw.data[offset + 3] > 0; opaque += raw.data[offset + 3] === 255
    if (raw.data[offset + 3] > 0 && colors.size < 4096) colors.add(`${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]}`)
  }
  const owned = observed.columns.filter(column => column.owner === 'complete')
  const result = { scope: 'Untouched initial actual DOM styles and GPU pixels read together before canonical capture or selection. Raw canvas content is diagnostic evidence, not canonical parity or timing acceptance.',
    ...observed, rawCanvas: { file: rawFile, width: raw.info.width, height: raw.info.height, nonzeroAlpha, opaque, distinctRgbAtLeast: colors.size },
    completeOwnedColumns: owned.length, untouchedPage: { file: pageFile, hostAfterScreenshot: pageHost } }
  await fs.writeFile(path.join(output, `${boardId}-initial-owned-skin.json`), `${JSON.stringify(result, null, 2)}\n`)
  if (observed.columns.length) check(`${boardId} initial accepted column DOM skins cannot cover GPU artwork`,
    owned.length > 0 && owned.every(column => column.renderer === 'vello' && column.transparent && column.backgroundImageAbsent),
    { completeOwnedColumns: owned.length, columns: observed.columns, acceptedGeneration: observed.host.acceptedGeneration })
  return result
}

async function diagnoseInitialCanvas(session,boardId) {
  const {page,memory}=session,before=await receipt(page),projectBefore=JSON.stringify(memory.get(`projects/${corpus.id}/project.json`)),
    canvas=page.locator('.vello-board>.vello-board-canvas:not([hidden])').first(),clip=await canvas.boundingBox()
  if(!clip)throw new Error('Initial actual GPU canvas rectangle unavailable')
  const styles=await canvas.evaluate(canvas=>{
    const describe=element=>{const style=getComputedStyle(element);return{tag:element.tagName,class:element.className,rect:element.getBoundingClientRect().toJSON(),
      inlineStyle:element.getAttribute('style'),position:style.position,zIndex:style.zIndex,opacity:style.opacity,visibility:style.visibility,display:style.display,
      backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,overflowX:style.overflowX,overflowY:style.overflowY,transform:style.transform,
      filter:style.filter,isolation:style.isolation,mixBlendMode:style.mixBlendMode,clipPath:style.clipPath,pointerEvents:style.pointerEvents}}
    const ancestors=[];for(let element=canvas;element;element=element.parentElement)ancestors.push(describe(element))
    return{ancestors,stageChildren:[...canvas.closest('.canvas-stage').children].map(describe),
      columns:[...document.querySelectorAll('article.node-column')].map(element=>({id:element.dataset.nodeId,owner:element.dataset.velloCardPaint,observed:describe(element),
        canonical:window.__nodeColumnCanonicalRead(element,()=>describe(element))})),articleHtml:[...document.querySelectorAll('article[data-node-id]')].map(element=>[element.dataset.nodeId,element.outerHTML])}
  })
  const png=await canvas.evaluate(canvas=>canvas.toDataURL('image/png'))
  const rawFile=path.join(output,`${boardId}-initial-raw-canvas.png`);await fs.writeFile(rawFile,Buffer.from(png.slice(png.indexOf(',')+1),'base64'))
  const raw=await sharp(rawFile).ensureAlpha().raw().toBuffer({resolveWithObject:true}),colors=new Set();let nonzeroAlpha=0,opaque=0
  for(let offset=0;offset<raw.data.length;offset+=4){nonzeroAlpha+=raw.data[offset+3]>0;opaque+=raw.data[offset+3]===255;if(raw.data[offset+3]>0&&colors.size<4096)colors.add(`${raw.data[offset]},${raw.data[offset+1]},${raw.data[offset+2]}`)}
  const originalFile=path.join(output,`${boardId}-initial-original-canvas.png`),original=await page.screenshot({path:originalFile,clip}),samples=[]
  for(const [name,rule] of [
    ['world-hidden','#root .canvas-stage .board-world,#root .canvas-stage .board-world *{visibility:hidden!important}'],
    ['owned-column-background-transparent','#root .canvas-stage .board-node.node-column.has-body-color[data-vello-card-paint="complete"]{background-color:transparent!important;background-image:none!important}'],
  ]){
    await page.evaluate(rule=>{const style=document.createElement('style');style.dataset.nodeColumnInitialDiagnostic='true';style.textContent=rule;document.head.append(style);window.__reviewInitialDiagnosticStyle=style},rule)
    const file=path.join(output,`${boardId}-initial-${name}.png`);let pixels,sampled
    try{pixels=await page.screenshot({path:file,clip});sampled=await receipt(page)}finally{await page.evaluate(()=>{window.__reviewInitialDiagnosticStyle.remove();delete window.__reviewInitialDiagnosticStyle})}
    const left=await sharp(original).ensureAlpha().raw().toBuffer({resolveWithObject:true}),right=await sharp(pixels).ensureAlpha().raw().toBuffer({resolveWithObject:true});let differingPixels=0,maxChannelDelta=0
    for(let offset=0;offset<left.data.length;offset+=4){let changed=false;for(let channel=0;channel<4;channel++){const delta=Math.abs(left.data[offset+channel]-right.data[offset+channel]);changed ||= delta>0;maxChannelDelta=Math.max(maxChannelDelta,delta)}differingPixels+=changed}
    samples.push({name,rule,file,differingPixels,maxChannelDelta,generationUnchanged:before.host.acceptedGeneration===sampled.host.acceptedGeneration,
      ownershipUnchanged:JSON.stringify(before.ownership)===JSON.stringify(sampled.ownership),host:sampled.host})
  }
  const restoredFile=path.join(output,`${boardId}-initial-restored-canvas.png`),restored=await page.screenshot({path:restoredFile,clip}),after=await receipt(page)
  const restoration=await page.evaluate(original=>original.every(([id,html])=>document.querySelector(`article[data-node-id="${CSS.escape(id)}"]`)?.outerHTML===html),styles.articleHtml)
  const restoreLeft=await sharp(original).ensureAlpha().raw().toBuffer(),restoreRight=await sharp(restored).ensureAlpha().raw().toBuffer()
  const result={scope:'Read-only initial state diagnosis before any canvas pointer/selection/reflow. Original prepared payload/uploads retained first. Raw actual canvas PNG plus disclosed temporary head-only CSS visibility/background samples; original model/DOM/ownership restored. No rendering acceptance or timing claim.',
    before,styles:{...styles,articleHtml:undefined},rawCanvas:{file:rawFile,width:raw.info.width,height:raw.info.height,nonzeroAlpha,opaque,distinctRgbAtLeast:colors.size},originalFile,samples,restoredFile,
    restoredPixelsExact:restoreLeft.equals(restoreRight),articleHtmlRestored:restoration,modelUnchanged:projectBefore===JSON.stringify(memory.get(`projects/${corpus.id}/project.json`)),
    generationUnchanged:before.host.acceptedGeneration===after.host.acceptedGeneration,ownershipUnchanged:JSON.stringify(before.ownership)===JSON.stringify(after.ownership),after}
  await fs.writeFile(path.join(output,`${boardId}-initial-canvas-diagnosis.json`),JSON.stringify(result,null,2)+'\n')
  check(`${boardId} read-only initial diagnostics restore model/DOM/ownership`,result.articleHtmlRestored&&result.modelUnchanged&&result.generationUnchanged&&result.ownershipUnchanged&&samples.every(sample=>sample.generationUnchanged&&sample.ownershipUnchanged),{...result,styles:undefined,before:undefined,after:undefined})
  console.log(JSON.stringify({initialCanvasDiagnosis:boardId,rawCanvas:result.rawCanvas,columns:styles.columns.map(column=>({id:column.id,owner:column.owner,background:column.observed.backgroundColor,canonicalBackground:column.canonical.backgroundColor})),samples:samples.map(sample=>({name:sample.name,differingPixels:sample.differingPixels,maxChannelDelta:sample.maxChannelDelta})),restoredPixelsExact:result.restoredPixelsExact,output}))
  return result
}

async function debugVideoControls(session) {
  const { page } = session, observations = []
  for (const nodeId of ['source-video-6', 'source-video-7']) {
    const article = page.locator(`article[data-node-id="${nodeId}"]`), video = article.locator('video')
    await page.evaluate(id => { window.__reviewDebugVideoId = id }, nodeId)
    const state = () => video.evaluate(video => ({ time: video.currentTime, duration: video.duration, paused: video.paused, seeking: video.seeking, readyState: video.readyState,
      buffered: Array.from({length:video.buffered.length}, (_,index) => [video.buffered.start(index),video.buffered.end(index)]),
      seekable: Array.from({length:video.seekable.length}, (_,index) => [video.seekable.start(index),video.seekable.end(index)]),
      activeLabel: document.activeElement?.getAttribute('aria-label'),
      ranges: [...video.closest('article').querySelectorAll('input[type="range"]'), ...document.querySelectorAll('.video-controls-dialog input[type="range"]')].map(input => ({label:input.getAttribute('aria-label'),min:input.min,max:input.max,step:input.step,value:input.value})) }))
    const initial = await state(), old = await receipt(page)
    await article.getByRole('button', { name: 'Play or pause', exact: true }).click()
    await page.waitForTimeout(1400)
    const short = { state: await state(), receipt: await receipt(page) }
    await page.waitForTimeout(3600)
    const extended = { state: await state(), receipt: await receipt(page) }
    const progression = sample => {
      const commits = sample.receipt.gpuCommits.filter(commit => Number(commit.generation) > Number(old.host.acceptedGeneration) && commit.ownedVideoIds.includes(nodeId))
      return { decodedFrames: sample.receipt.decodedFrames.filter(frame => frame.nodeId === nodeId).length, acceptedCommits: commits.length,
        imageVersions: [...new Set(commits.flatMap(commit => commit.resources.filter(resource => resource.key.startsWith(`${nodeId}:`)).map(resource => `${resource.key}:${resource.revision}`)))],
        lastCommits: commits.slice(-8).map(commit => ({...commit,resources:commit.resources.filter(resource => resource.key.startsWith(`${nodeId}:`))})) }
    }
    console.log(JSON.stringify({ debugPlayback: nodeId, short: progression(short), extended: progression(extended) }))
    await article.getByRole('button', { name: 'Play or pause', exact: true }).click(); await page.waitForTimeout(500); await settle(page, `${nodeId} debug pause`)
    const title = await video.getAttribute('aria-label'), trigger = article.getByRole('button', { name: 'Video controls', exact: true })
    await trigger.click(); const dialog = page.getByRole('dialog', { name: `Video controls: ${title}`, exact: true }); await dialog.waitFor()
    const beforeRate = await state(); await dialog.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('30'); await page.waitForTimeout(300)
    const afterRate = await state()
    await dialog.getByRole('button', { name: 'Next frame', exact: true }).click(); await page.waitForTimeout(500); const clickNext = await state()
    await dialog.getByRole('button', { name: 'Previous frame', exact: true }).click(); await page.waitForTimeout(500); const clickPrevious = await state()
    await dialog.getByRole('button', { name: 'Next frame', exact: true }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(500); const keyboardNext = await state()
    const scrubber = article.getByRole('slider', { name: 'Video position', exact: true }); await scrubber.focus(); await scrubber.press('Home'); await page.waitForTimeout(500)
    const keyboardHome = await state(); await scrubber.press('ArrowRight'); await page.waitForTimeout(500); const keyboardArrowRight = await state()
    await scrubber.press('End'); await page.waitForTimeout(500); const keyboardEnd = await state()
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await page.mouse.move(1, 1); await page.waitForTimeout(500); await settle(page, `${nodeId} debug closed`)
    const final = await receipt(page)
    observations.push({nodeId,initial,short:progression(short),extended:progression(extended),beforeRate,afterRate,clickNext,clickPrevious,keyboardNext,keyboardHome,keyboardArrowRight,keyboardEnd,
      finalOwner:final.ownership.find(owner=>owner.id===nodeId),finalBlockers:final.host.completePaintBlockers,
      nativeEvents:final.nativeEvents.filter(event=>event.nodeId===nodeId), diagnostics:final.diagnostics?.rows?.filter(row=>/^paint\.|^gpu\./.test(row.kind)).slice(-100)})
    await fs.writeFile(path.join(output, `${nodeId}-native-debug.json`), `${JSON.stringify(observations.at(-1), null, 2)}\n`)
    console.log(JSON.stringify({ debugControls: nodeId, nativeDuration: initial.duration, inputMaxBeforeRate: beforeRate.ranges, inputMaxAfterRate: afterRate.ranges,
      clickNext: clickNext.time, keyboardNext: keyboardNext.time, keyboardArrowRight: keyboardArrowRight.time, keyboardEnd: keyboardEnd.time, finalOwner:observations.at(-1).finalOwner }))
  }
  return observations
}

async function imageBoundsWorkflow(session, variant = 'normal') {
  const {page,memory,board} = session, id = 'foxy-title', article = page.locator(`article[data-node-id="${id}"]`)
  const savedNode = () => memory.get(`projects/${corpus.id}/project.json`).boards.find(item=>item.id===board.id).nodes.find(node=>node.id===id)
  const savedNodes = () => structuredClone(memory.get(`projects/${corpus.id}/project.json`).boards.find(item=>item.id===board.id).nodes)
  const beforeNodes = savedNodes(), modelBefore = structuredClone(savedNode())
  const select = async () => {
    // Undo/Redo keeps the actual selection. Its transform overlay correctly
    // intercepts another center click, so do not invent a second selection
    // action when the card is already selected.
    if(!await article.evaluate(element=>element.classList.contains('selected'))){
      if(variant==='read-only'){await article.click({button:'right'});await page.keyboard.press('Escape')}
      else await article.click()
    }
    await page.locator('#inspector-panel-selection:not([hidden])').waitFor()
  }
  const fields = async () => Object.fromEntries(await Promise.all(['x','y','width','height'].map(async name=>[name,Number(await page.getByRole('spinbutton',{name:`${name} of ${modelBefore.title}`,exact:true}).inputValue())])))
  const clearSelection = async () => { const stage = page.locator('.canvas-stage'), rect = await stage.boundingBox(); await stage.click({position:{x:rect.width-80,y:40}}); await page.mouse.move(1,1); await page.waitForTimeout(250); await settle(page,`${variant} image selection cleared`) }
  const paintRect = () => article.locator('img').first().evaluate(img=>{
    const rect=img.getBoundingClientRect(),style=getComputedStyle(img),scale=Math.min(rect.width/img.naturalWidth,rect.height/img.naturalHeight)
    const width=img.naturalWidth*scale,height=img.naturalHeight*scale
    const ancestorClips=[]
    for(let element=img;element&&!element.classList.contains('canvas-stage');element=element.parentElement){
      const computed=getComputedStyle(element)
      ancestorClips.push({tag:element.tagName,class:element.className,rect:element.getBoundingClientRect().toJSON(),
        overflowX:computed.overflowX,overflowY:computed.overflowY,borderRadius:computed.borderRadius,clipPath:computed.clipPath,
        maskImage:computed.maskImage,transform:computed.transform,transformOrigin:computed.transformOrigin,opacity:computed.opacity,
        backgroundColor:computed.backgroundColor,backgroundImage:computed.backgroundImage,boxShadow:computed.boxShadow,
        offsetLeft:element.offsetLeft,offsetTop:element.offsetTop,offsetWidth:element.offsetWidth,offsetHeight:element.offsetHeight})
    }
    const canonicalAncestorClips=window.__nodeColumnCanonicalRead(img.closest('article'),()=>{
      const records=[]
      for(let element=img;element&&!element.classList.contains('canvas-stage');element=element.parentElement){
        const computed=getComputedStyle(element)
        records.push({tag:element.tagName,class:element.className,rect:element.getBoundingClientRect().toJSON(),
          overflowX:computed.overflowX,overflowY:computed.overflowY,borderRadius:computed.borderRadius,clipPath:computed.clipPath,
          maskImage:computed.maskImage,transform:computed.transform,opacity:computed.opacity,backgroundColor:computed.backgroundColor,
          backgroundImage:computed.backgroundImage,boxShadow:computed.boxShadow})
      }
      return records
    })
    return {x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,width,height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,
      source:img.currentSrc,owner:img.closest('article').dataset.velloCardPaint||null,
      objectFit:style.objectFit,objectPosition:style.objectPosition,transform:style.transform,rect:rect.toJSON(),ancestorClips,canonicalAncestorClips}
  })
  await article.locator('img').first().waitFor(); await article.locator('img').first().evaluate(img=>img.decode())
  await select(); const originalFields = await fields(), fit = page.locator('#inspector-panel-selection').getByRole('button',{name:'Fit bounds to image',exact:true})
  if (variant !== 'normal') {
    if (variant === 'crop') { await fit.click(); await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Contain')); }
    else check(`${variant} actual inspector refuses bounds edit`,await fit.isDisabled(),{variant,fields:originalFields})
    await page.waitForTimeout(1600)
    check(`${variant} refuses bounds fit without changing object records`,JSON.stringify(savedNodes())===JSON.stringify(beforeNodes)&&JSON.stringify(await fields())===JSON.stringify(originalFields),{before:modelBefore,after:savedNode(),status:await page.locator('.status-bar').innerText()})
    if (variant === 'locked' || variant === 'read-only') {
      await clearSelection()
      await article.click({button:'right'}); const contextFit=page.locator('.canvas-context-menu').getByRole('menuitem',{name:'Fit bounds to image',exact:true}); await contextFit.waitFor()
      check(`${variant} actual context command is disabled`,await contextFit.isDisabled(),null); await page.keyboard.press('Escape')
    }
    return {variant,modelBefore,originalFields,after:structuredClone(savedNode()),scope:'Actual UI against explicitly prepared disposable in-memory guard variant.'}
  }
  check('legacy image model is unchanged by selecting it',originalFields.x===1046&&originalFields.y===623&&originalFields.width===392&&originalFields.height===294,{modelBefore,originalFields})
  await clearSelection(); await page.waitForTimeout(1600)
  check('image selection and clearing preserve all authored object records',JSON.stringify(savedNodes())===JSON.stringify(beforeNodes),null)
  const other=corpus.boards.find(item=>item.id==='test-3-nodes')
  await page.locator('.navigator .board-tree-row').filter({hasText:other.title}).click(); await page.waitForFunction(()=>document.querySelector('.vello-board')?.dataset.scene==='test-3-nodes')
  await page.locator('.navigator .board-tree-row').filter({hasText:board.title}).click(); await article.waitFor(); await article.locator('img').first().evaluate(img=>img.decode()); await page.waitForTimeout(1600)
  check('navigation does not silently normalize legacy image records',JSON.stringify(savedNodes())===JSON.stringify(beforeNodes),null)
  await clearSelection(); const beforePaint=await paintRect(), clip={x:beforePaint.x,y:beforePaint.y,width:beforePaint.width,height:beforePaint.height}
  const beforeFile=path.join(output,'natural-image-before.png'),beforePixels=await page.screenshot({path:beforeFile,clip})
  const expectedSquareCss=294*Number((await receipt(page)).stage.liveCamera?JSON.parse((await receipt(page)).stage.liveCamera).scale:1)
  check('legacy392x294 frame paints the actual square source in centered294square bounds',beforePaint.naturalWidth===beforePaint.naturalHeight&&Math.abs(beforePaint.width-expectedSquareCss)<.001&&Math.abs(beforePaint.height-expectedSquareCss)<.001,beforePaint)
  await select(); await fit.click()
  await page.waitForFunction(()=>{
    const panel=document.querySelector('#inspector-panel-selection')
    const field=name=>Number(panel?.querySelector(`input[aria-label^="${name} of "]`)?.value)
    return field('x')===1095&&field('y')===623&&field('width')===294&&field('height')===294
  })
  const fittedFields=await fields()
  check('actual Fit bounds command produces1095,623,294,294',fittedFields.x===1095&&fittedFields.y===623&&fittedFields.width===294&&fittedFields.height===294,fittedFields)
  await clearSelection();const afterPaint=await paintRect(),afterFile=path.join(output,'natural-image-after.png'),afterPixels=await page.screenshot({path:afterFile,clip})
  const left=await sharp(beforePixels).ensureAlpha().raw().toBuffer({resolveWithObject:true}),right=await sharp(afterPixels).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  const dimensionsMatch=left.info.width===right.info.width&&left.info.height===right.info.height&&left.data.length===right.data.length
  const colors=new Set();let differingPixels=0,maxChannelDelta=0
  for(let i=0;i<left.data.length;i+=4){colors.add(`${left.data[i]},${left.data[i+1]},${left.data[i+2]}`);let different=false;for(let channel=0;channel<4;channel++){const delta=Math.abs(left.data[i+channel]-right.data[i+channel]);different ||= delta>0;maxChannelDelta=Math.max(maxChannelDelta,delta)}differingPixels+=different}
  const pixelReview={beforeFile,afterFile,beforePaint,afterPaint,width:left.info.width,height:left.info.height,dimensionsMatch,distinctBeforeRgb:colors.size,differingPixels,maxChannelDelta,
    scope:'Actual nonblank painted image rectangle, entireRGBA, no masks/tolerance; selection cleared in both captures; source and camera unchanged.'}
  check('Fit bounds preserves actual image pixel placement',dimensionsMatch&&colors.size>32&&Math.abs(beforePaint.x-afterPaint.x)<.001&&Math.abs(beforePaint.y-afterPaint.y)<.001&&Math.abs(beforePaint.width-afterPaint.width)<.001&&Math.abs(beforePaint.height-afterPaint.height)<.001&&differingPixels===0,pixelReview)
  await page.getByRole('button',{name:'Canvas',exact:true}).focus();await page.getByRole('button',{name:'Undo board change',exact:true}).click();await select();const undoFields=await fields()
  check('actual Undo restores392x294 legacy image frame',undoFields.x===1046&&undoFields.y===623&&undoFields.width===392&&undoFields.height===294,undoFields)
  await page.getByRole('button',{name:'Redo board change',exact:true}).click();await select();const redoFields=await fields()
  check('actual Redo restores294square image frame',redoFields.x===1095&&redoFields.y===623&&redoFields.width===294&&redoFields.height===294,redoFields)
  await page.waitForTimeout(1600); const finalModel=structuredClone(savedNode())
  check('only the explicit Fit bounds command changes the disposable object',JSON.stringify(finalModel)===JSON.stringify({...modelBefore,x:1095,y:623,width:294,height:294})&&savedNodes().filter(node=>node.id!==id).every(node=>JSON.stringify(node)===JSON.stringify(beforeNodes.find(before=>before.id===node.id))),{finalModel})
  return {variant,modelBefore,originalFields,beforePaint,fittedFields,pixelReview,undoFields,redoFields,finalModel,
    nativeImportFlows:{disk:'NOT_RUN: adapter does not expose faithful native file import/drag IPC.',clipboard:'NOT_RUN: adapter does not expose faithful native clipboard image IPC.'},nativeQualified:false}
}

async function columnSizingWorkflow(session,variant='normal') {
  const {page,memory,board}=session,id='node-1',article=page.locator(`article[data-node-id="${id}"]`)
  // This fixture has an independent caption article above the column header.
  // Read actual hit-testing to find the column's unobstructed header gutter,
  // then use an ordinary pointer action through the production surface.
  const hitReviews=[]
  const headerHit=async(button='left')=>{
    await article.scrollIntoViewIfNeeded()
    const hit=await article.evaluate(element=>{
      const rect=element.getBoundingClientRect(),probes=[]
      for(const point of [{x:3,y:14},{x:5,y:14},{x:3,y:3},{x:5,y:24},{x:rect.width-5,y:14}]){
        if(point.x<0||point.x>=rect.width||point.y<0||point.y>=rect.height)continue
        const target=document.elementFromPoint(rect.x+point.x,rect.y+point.y),owner=target?.closest('article')
        probes.push({point,tag:target?.tagName,class:target?.className,id:owner?.dataset.nodeId})
        if(owner===element)return{point,rect:rect.toJSON(),probes}
      }
      return{point:null,rect:rect.toJSON(),probes}
    })
    hitReviews.push({button,...hit});console.log(JSON.stringify({columnActualHit:variant,button,...hit}))
    if(!hit.point)throw new Error(`No actual unobstructed column header hit point: ${JSON.stringify(hit)}`)
    await article.click({button,position:hit.point})
  }
  const savedBoard=()=>structuredClone(memory.get(`projects/${corpus.id}/project.json`).boards.find(item=>item.id===board.id))
  const before=savedBoard(),columnBefore=before.nodes.find(node=>node.id===id),rowsBefore=before.nodes.filter(node=>node.parentColumnId===id)
  const select=async()=>{
    if(!await article.evaluate(element=>element.classList.contains('selected'))){
      if(variant==='read-only'){await headerHit('right');await page.keyboard.press('Escape')}
      else await headerHit()
    }
    await page.locator('#inspector-panel-selection:not([hidden])').waitFor()
  }
  const sizing=page.getByRole('combobox',{name:'Column image sizing',exact:true})
  const savedWhen=async predicate=>{for(let attempt=0;attempt<60;attempt++){const value=savedBoard();if(predicate(value))return value;await page.waitForTimeout(100)}throw new Error(`${variant} column saved model did not reach the actual UI command result`)}
  const clear=async()=>{const stage=page.locator('.canvas-stage'),rect=await stage.boundingBox();await stage.click({position:{x:rect.width-80,y:40}});await page.mouse.move(1,1);await page.waitForTimeout(250)}
  const undo=async expected=>{await page.getByRole('button',{name:'Undo board change',exact:true}).click();const value=await savedWhen(model=>JSON.stringify(model.nodes)===JSON.stringify(expected.nodes));await select();return value}
  const eligible=node=>node.kind==='image'&&node.imagePresentation==='artwork'&&(node.imageTransform?.fit===undefined||node.imageTransform.fit==='contain')
    &&(node.imageTransform?.zoom===undefined||node.imageTransform.zoom===1)&&(node.imageTransform?.rotation===undefined||node.imageTransform.rotation===0)
    &&!node.imageTransform?.flipX&&!node.imageTransform?.flipY&&(node.imageTransform?.positionX===undefined||node.imageTransform.positionX===50)&&(node.imageTransform?.positionY===undefined||node.imageTransform.positionY===50)
  const ratios=new Map(rowsBefore.filter(eligible).map(row=>[row.id,{width:row.freeWidth>0&&row.freeHeight>0?row.freeWidth:row.width,height:row.freeWidth>0&&row.freeHeight>0?row.freeHeight:row.height}]))
  const contentFields=node=>Object.fromEntries(Object.entries(node).filter(([name])=>!['x','y','width','height','columnOrder','freeWidth','freeHeight'].includes(name)))
  const geometryCheck=(label,model,mode)=>{
    const column=model.nodes.find(node=>node.id===id),inner=column.width-20,details=[]
    for(const old of rowsBefore){const row=model.nodes.find(node=>node.id===old.id),ratio=ratios.get(row.id)
      if(ratio){const proportional=inner*ratio.height/ratio.width,expected=mode==='responsive'?proportional:Math.max(78,Math.round(proportional));details.push({id:row.id,width:row.width,height:row.height,expectedWidth:inner,expectedHeight:expected,basis:[row.freeWidth,row.freeHeight],sourceBasis:ratio,pass:Math.abs(row.width-inner)<1e-9&&Math.abs(row.height-expected)<1e-9&&row.freeWidth===ratio.width&&row.freeHeight===ratio.height&&JSON.stringify(contentFields(row))===JSON.stringify(contentFields(old))})}
      else details.push({id:row.id,pass:row.width===old.width&&row.height===old.height&&JSON.stringify(contentFields(row))===JSON.stringify(contentFields(old)),scope:'Explicit crop/card framing dimensions and content remain intact; authored row placement may reflow.'})
    }
    check(`${variant} ${label} keeps exact artwork proportions/basis and other framing`,column.columnImageSizing===mode&&details.every(row=>row.pass),details)
    const family=new Set([id,...rowsBefore.map(row=>row.id)])
    check(`${variant} ${label} preserves every unrelated authored object`,model.nodes.filter(node=>!family.has(node.id)).every(node=>JSON.stringify(node)===JSON.stringify(before.nodes.find(old=>old.id===node.id))),null)
    check(`${variant} ${label} preserves graph connector identities/endpoints`,model.connectors.length===before.connectors.length&&model.connectors.every(edge=>{const old=before.connectors.find(item=>item.id===edge.id);return old&&JSON.stringify({...edge,bendPoints:undefined})===JSON.stringify({...old,bendPoints:undefined})}),null)
  }
  await select();await sizing.waitFor()
  check(`${variant} existing column exposes Saved layout without choosing a mode`,await sizing.inputValue()===''&&!columnBefore.columnImageSizing,{columnBefore,options:await sizing.locator('option').allTextContents()})
  const target=await sizing.boundingBox(),viewport=page.viewportSize();check(`${variant} column sizing native control is reachable`,target&&target.height>=32&&target.x>=0&&target.y>=0&&target.x+target.width<=viewport.width&&target.y+target.height<=viewport.height,{target,viewport})
  await page.waitForTimeout(1600)
  check(`${variant} inspecting existing column does not rewrite saved object records`,JSON.stringify(savedBoard().nodes)===JSON.stringify(before.nodes),null)
  if(variant==='locked'||variant==='read-only'){
    check(`${variant} actual column sizing inspector refuses changes`,await sizing.isDisabled(),null)
    await clear();await headerHit('right')
    for(const name of ['Responsive','Minimum height']){const option=page.locator('.canvas-context-menu').getByRole('menuitemradio',{name,exact:true});await option.waitFor();check(`${variant} actual ${name} context choice is disabled`,await option.isDisabled(),null)}
    await page.keyboard.press('Escape');await page.waitForTimeout(1600)
    check(`${variant} column sizing refusal preserves saved object records`,JSON.stringify(savedBoard().nodes)===JSON.stringify(before.nodes),null)
    return{variant,before,after:savedBoard(),hitReviews,scope:'Actual UI against disclosed disposable guard variant.',nativeQualified:false}
  }
  await sizing.selectOption('responsive')
  const responsive=await savedWhen(model=>model.nodes.find(node=>node.id===id).columnImageSizing==='responsive')
  geometryCheck('Responsive command',responsive,'responsive')
  await page.screenshot({path:path.join(output,`column-sizing-${variant}-responsive.png`)})
  await undo(before);check(`${variant} actual Undo restores legacy layout and absent mode`,JSON.stringify(savedBoard().nodes)===JSON.stringify(before.nodes)&&await sizing.inputValue()==='',null)
  await page.getByRole('button',{name:'Redo board change',exact:true}).click()
  const redone=await savedWhen(model=>JSON.stringify(model.nodes)===JSON.stringify(responsive.nodes));await select()
  check(`${variant} actual Redo restores Responsive command snapshot`,JSON.stringify(redone.nodes)===JSON.stringify(responsive.nodes)&&await sizing.inputValue()==='responsive',null)
  await sizing.selectOption('minimum-height')
  const minimum=await savedWhen(model=>model.nodes.find(node=>node.id===id).columnImageSizing==='minimum-height')
  geometryCheck('Minimum height command',minimum,'minimum-height')
  if(variant==='wide-artwork'){const row=minimum.nodes.find(node=>node.id==='source-1');check('wide-artwork actual Minimum height applies78-unit floor',row.height===78,{row,sourceBasis:ratios.get(row.id)})}
  await undo(responsive);check(`${variant} Undo Minimum height restores exact Responsive basis/layout`,JSON.stringify(savedBoard().nodes)===JSON.stringify(responsive.nodes),null)
  const width=page.getByRole('spinbutton',{name:`width of ${columnBefore.title}`,exact:true}),newWidth=responsive.nodes.find(node=>node.id===id).width+40
  await width.fill(String(newWidth));await width.press('Enter')
  const widened=await savedWhen(model=>model.nodes.find(node=>node.id===id).width===newWidth)
  geometryCheck('real width field commit',widened,'responsive')
  check(`${variant} Responsive artwork follows the real width commit`,widened.nodes.filter(node=>ratios.has(node.id)).every(node=>node.width===newWidth-20),{columnWidth:newWidth})
  await undo(responsive)
  await clear();await headerHit('right')
  const responsiveItem=page.locator('.canvas-context-menu').getByRole('menuitemradio',{name:'Responsive',exact:true}),minimumItem=page.locator('.canvas-context-menu').getByRole('menuitemradio',{name:'Minimum height',exact:true})
  await minimumItem.waitFor();check(`${variant} real context sizing reflects the current choice`,await responsiveItem.getAttribute('aria-checked')==='true'&&await minimumItem.getAttribute('aria-checked')==='false',null)
  await minimumItem.click()
  const contextMinimum=await savedWhen(model=>model.nodes.find(node=>node.id===id).columnImageSizing==='minimum-height')
  check(`${variant} actual right-click choice matches Inspector command snapshot`,JSON.stringify(contextMinimum.nodes)===JSON.stringify(minimum.nodes),null)
  await undo(responsive);await clear();await headerHit('right');await minimumItem.waitFor()
  await page.screenshot({path:path.join(output,`column-sizing-${variant}-context.png`)});await page.keyboard.press('Escape')
  return{variant,before,responsive,minimum,redone,widened,contextMinimum,hitReviews,sourceRatios:Object.fromEntries(ratios),
    scope:variant==='wide-artwork'?'Actual UI against explicit in-memory source-1 wide artwork paired frame156x7.8 and source-2 cover variant; fixture file unchanged. The authored basis tests proportions/floor, not intrinsic PNG dimensions.':'Actual UI against unmodified saved Node Column fixture.',nativeQualified:false}
}

async function uiScreenshots(page, boardId) {
  const states = [{ theme: 'navy', mode: 'Canvas' }, { theme: 'dark', mode: 'Canvas' }, { theme: 'light', mode: 'Canvas' }, { theme: 'navy', mode: 'Split', viewport: { width: 1280, height: 900 } }], results = []
  for (const [index, state] of states.entries()) {
    await page.getByRole('button', { name: `Use ${state.theme} theme`, exact: true }).click()
    await page.getByRole('button', { name: state.mode, exact: true }).click()
    if (state.viewport) await page.setViewportSize(state.viewport)
    await page.mouse.move(1, 1); await settle(page, `${boardId} UI ${index + 1}`)
    const file = path.join(output, `${boardId}-ui-${index + 1}-${state.theme}-${state.mode.toLowerCase()}.png`)
    await page.screenshot({ path: file })
    const layout = await page.evaluate(() => [...document.querySelectorAll('.app-bar button,.canvas-tool-rail button,.pane-toolbar button,.video-review button,.video-review input,.video-review select')].filter(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }).map(element => { const rect = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.slice(0, 50),
      x: rect.x, y: rect.y, width: rect.width, height: rect.height, clipped: rect.x < -1 || rect.y < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1 } }))
    // Board cards deliberately extend beyond the camera at some Split zooms.
    // Shell controls must remain reachable; card-local clipping is recorded
    // separately, rather than reported as shell crowding.
    const shell = await page.evaluate(() => [...document.querySelectorAll('.app-bar button,.canvas-tool-rail button,.pane-toolbar button')].filter(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }).map(element => { const rect = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') || element.textContent?.slice(0, 50),
      x: rect.x, y: rect.y, width: rect.width, height: rect.height, clipped: rect.x < -1 || rect.y < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1 } }))
    check(`${boardId} ${state.theme}/${state.mode} shell controls remain in viewport`, shell.every(control => !control.clipped), shell.filter(control => control.clipped))
    results.push({ state, file, layout, receipt: await receipt(page) })
  }
  return results
}

try {
  browser = await chromium.launch({ executablePath: process.env.UI_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-precise-memory-info'] })
  for (const boardId of imageBoundsOnly ? ['test-2-layout'] : columnSizingOnly||args.includes('--test-2-only') ? ['test-2-nodes'] : stylesOnly ? ['test-3-nodes'] : ['test-2-nodes', 'test-3-nodes']) {
    const session = await openBoard(boardId), { page, context, localErrors } = session
    try {
      await settle(page, boardId)
      const initialOwnership = !stylesOnly ? await captureInitialOwnership(page, boardId) : null
      const styles = await canonicalStyles(page), initial = await receipt(page)
      await fs.writeFile(path.join(output, `${boardId}-canonical-styles.json`), `${JSON.stringify(styles, null, 2)}\n`)
      await page.screenshot({ path: path.join(output, `${boardId}-initial.png`) })
      const boardResult = { boardId, initial, initialOwnership, canonicalStyles: styles, errors: localErrors }
      boards.push(boardResult)
      await fs.writeFile(path.join(output, `${boardId}-initial-receipt.json`), `${JSON.stringify(initial, null, 2)}\n`)
      if (stylesOnly) continue
      if(initialStateOnly){boardResult.engineDebug=await persistEngineDebug(page,boardId);boardResult.initialCanvas=await diagnoseInitialCanvas(session,boardId);continue}
      if (imageBoundsOnly || columnSizingOnly) {
        try{if(imageBoundsOnly)boardResult.imageBounds=await imageBoundsWorkflow(session);else boardResult.columnSizing=await columnSizingWorkflow(session)}
        catch(error){errors.push(`${boardId} ${imageBoundsOnly?'image bounds':'column sizing'} workflow: ${error.stack||String(error)}`);console.log(JSON.stringify({workflowError:errors.at(-1)}))}
        continue
      }
      check(`${boardId} exact physical GPU canvas`, initial.canvases.some(canvas => canvas.width === 3840 && canvas.height === 2160 && !canvas.hidden), initial.canvases)
      check(`${boardId} current accepted GPU generation`, initial.host?.acceptedBackend === 'gpu' && initial.host.pending === 'false' && initial.host.acceptedGeneration === initial.host.generation, initial.host)
      check(`${boardId} accepted whole-card GPU paint is nonzero`, Number(initial.host?.paintedObjects) > 0 && initial.ownership.some(node => node.card === 'complete'), initial.ownership)
      const blockers = JSON.parse(initial.host?.completePaintBlockers || '{}')
      check(`${boardId} paused mounted cards have no complete-paint blockers`, Object.keys(blockers).length === 0, blockers)
      const metadata = JSON.parse(initial.host?.frameMetadata || '{}')
      check(`${boardId} accepted IDs match the actual whole-card hide markers`, Number(initial.host.measuredCardComplete) === initial.ownership.filter(node => node.card === 'complete').length, initial.ownership)
      if (boardId === 'test-3-nodes') {
        check('Test3 container covers reach the existing GPU image registry', ['left', 'middle', 'right'].every(id => initial.ownership.find(node => node.id === id)?.card === 'complete') && metadata.images >= 12
          && metadata.imageResources?.references?.some(resource => /background/.test(resource.key)), { images: metadata.images, references: metadata.imageResources?.references, ownership: initial.ownership })
      }
      if (coverageOnly) continue
      if (!debugOnly && (Object.keys(blockers).length || Number(initial.host?.paintedObjects) === 0)) {
        errors.push(`${boardId}: full playback/pixel/theme checks NOT RUN because initial complete ownership is blocked`)
        break
      }
      try {
        if (debugOnly) {
          if (boardId === 'test-2-nodes') boardResult.mediaDebug = await debugVideoControls(session)
          boardResult.engineDebug = await persistEngineDebug(page, boardId)
          if (boardId === 'test-3-nodes') boardResult.pixelComparison = await compareCanonicalPixels(page, boardId, true)
          continue
        }
        if (boardId === 'test-2-nodes') boardResult.videoWorkflows = await videoWorkflows(session)
        boardResult.pixelComparison = await compareCanonicalPixels(page, boardId)
        boardResult.uiReviews = await uiScreenshots(page, boardId)
      } catch (error) { errors.push(`${boardId}: ${error.stack || String(error)}`) }
      boardResult.final = await receipt(page)
    } finally {
      if(!stylesOnly)check(`${boardId} has no browser runtime errors`, localErrors.length === 0, localErrors)
      await context.close()
    }
  }
  if(imageBoundsOnly)for(const [variant,options] of [['locked',{nodeOverrides:{'foxy-title':{locked:true}}}],['crop',{nodeOverrides:{'foxy-title':{imageTransform:{fit:'cover'}}}}],['read-only',{readOnly:true}]]){
    const session=await openBoard('test-2-layout',options)
    try{await settle(session.page,`${variant} image board`);boards.push({boardId:'test-2-layout',imageBounds:await imageBoundsWorkflow(session,variant),errors:session.localErrors})}
    catch(error){errors.push(`${variant} image guard: ${error.stack||String(error)}`)}finally{
      check(`${variant} image guard has no browser runtime errors`,session.localErrors.length===0,session.localErrors)
      await session.context.close()
    }
  }
  if(columnSizingOnly)for(const [variant,options] of [
    ['wide-artwork',{nodeOverrides:{'source-1':{width:156,height:7.8},'source-2':{imageTransform:{fit:'cover'}}}}],
    ['locked',{nodeOverrides:{'node-1':{locked:true}}}],['read-only',{readOnly:true}],
  ]){
    const session=await openBoard('test-2-nodes',options)
    try{await settle(session.page,`${variant} column board`);boards.push({boardId:'test-2-nodes',columnSizing:await columnSizingWorkflow(session,variant),errors:session.localErrors})}
    catch(error){errors.push(`${variant} column sizing: ${error.stack||String(error)}`);console.log(JSON.stringify({workflowError:errors.at(-1)}))}finally{
      check(`${variant} column sizing has no browser runtime errors`,session.localErrors.length===0,session.localErrors)
      await session.context.close()
    }
  }
} catch (error) { errors.push(error.stack || String(error)) }
finally {
  if (browser) { await browser.close(); browserClosed = true }
  const unchanged = hash(await fs.readFile(projectPath)) === hash(corpusBytes)
  check('read-only fixture source unchanged', unchanged, { projectPath, sha256: hash(corpusBytes) })
  const changedSources = []
  for (const source of sourceReceipts) if (hash(await fs.readFile(source.absolutePath)) !== source.sha256) changedSources.push(source.path)
  if (!stylesOnly) check('captured source inputs stay frozen throughout correctness review', changedSources.length === 0, changedSources)
  const allPass = checks.every(check => check.pass) && !errors.length
  const report = { at: new Date().toISOString(), status: stylesOnly ? 'COMPUTED_STYLE_PROBE_ONLY' : debugOnly ? 'BROWSER_PROVIDER_DEBUG_RECEIPT' : imageBoundsOnly ? allPass ? 'BROWSER_IMAGE_BOUNDS_PASS' : 'BROWSER_IMAGE_BOUNDS_FAIL' : columnSizingOnly ? allPass ? 'BROWSER_COLUMN_SIZING_PASS' : 'BROWSER_COLUMN_SIZING_FAIL' : coverageOnly ? allPass ? 'BROWSER_PROVIDER_COVERAGE_PASS' : 'BROWSER_PROVIDER_COVERAGE_FAIL' : allPass ? 'BROWSER_PROVIDER_FULL_REVIEW_PASS' : 'BROWSER_PROVIDER_FULL_REVIEW_FAIL',
    scope: stylesOnly ? 'Read-only computed styles from existing preview; no ownership improvement or timing claim.' : 'Correctness/UI browser diagnostics with disposable in-memory workspace; not timing, native EXE or 2.1 qualification.',
    target, output, corpusSha256: hash(corpusBytes), sourceReceipts, servedReceipts, changedSources, checks, errors, boards, nativeFontReceipts: fontReceipts, instrumentedModules, calls, browserClosed, nativeQualified: false }
  await fs.writeFile(path.join(output, 'review.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: report.status, output, checks: checks.length, failed: checks.filter(check => !check.pass).length, errors: errors.length, browserClosed }))
  if (!stylesOnly && (checks.some(check => !check.pass) || errors.length)) process.exitCode = 1
}
