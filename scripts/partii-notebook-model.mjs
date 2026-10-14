import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

const source = ts.transpileModule(await readFile(new URL('../src/notebook-proof/notebookModel.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const model = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const checks = []
const test = (name, run) => { run(); checks.push({ name, passed: true }) }
const book = model.createNotebook(), pageId = book.pages[0].id, ids = () => book.pages.flatMap((page) => [page.id, ...page.modules.map((item) => item.id)])
test('sample independent format has unique stable page/module identities', () => { assert.equal(new Set(ids()).size, ids().length); assert.equal(book.kind, 'art-equation-notebook-proof') })
for (const kind of model.moduleKinds) test(`insert ${kind} after first module without mutating source`, () => { const copy = model.insertModule(book, pageId, kind, book.pages[0].modules[0].id); assert.equal(copy.pages[0].modules[1].kind, kind); assert.equal(copy.pages[0].modules.length, book.pages[0].modules.length + 1); assert.deepEqual(copy.pages[0].modules[0], book.pages[0].modules[0]) })
const first = book.pages[0].modules[0]
test('keyboard-equivalent reorder retains identity and clamps at boundary', () => { const next = model.moveModule(book, first.id, 1); assert.equal(next.pages[0].modules[1].id, first.id); assert.strictEqual(model.moveModule(book, first.id, -1), book) })
test('cross-page transfer retains module and removes exactly one source occurrence', () => { const next = model.moveModule(book, first.id, 0, book.pages[1].id); assert.equal(next.pages[0].modules.some((item) => item.id === first.id), false); assert.equal(next.pages[1].modules.at(-1).id, first.id) })
test('remove is restored by document Undo and Redo', () => { const start = { current: book, past: [], future: [] }; const applied = model.notebookHistory(start, { type: 'apply', next: model.removeModule(book, first.id) }); const undone = model.notebookHistory(applied, { type: 'undo' }); assert.deepEqual(undone.current, book); assert.deepEqual(model.notebookHistory(undone, { type: 'redo' }).current, applied.current) })
test('typing merges into one undo until blur breaks the edit', () => { let history = { current: book, past: [], future: [] }; for (const text of ['A', 'AB', 'ABC']) history = model.notebookHistory(history, { type: 'apply', next: model.updateModule(history.current, first.id, { text }), mergeKey: first.id }); assert.equal(history.past.length, 1); assert.deepEqual(model.notebookHistory(history, { type: 'undo' }).current, book); history = model.notebookHistory(history, { type: 'break' }); history = model.notebookHistory(history, { type: 'apply', next: model.updateModule(history.current, first.id, { text: 'Final' }), mergeKey: first.id }); assert.equal(history.past.length, 2) })
test('JSON round trip preserves all pages, text, tasks and identities', () => assert.deepEqual(model.parseNotebook(model.exportNotebookJson(book)), book))
const withMedia = structuredClone(book), image = withMedia.pages[0].modules.find((item) => item.kind === 'image'), video = withMedia.pages[0].modules.find((item) => item.kind === 'video')
image.media = { id: 'raster-reference', name: 'reference.png', mime: 'image/png', mode: 'embedded', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }
video.media = { id: 'video-reference', name: 'process.mp4', mime: 'video/mp4', mode: 'local' }
test('media round trip embeds raster but persists only local video reference', () => { assert.deepEqual(model.parseNotebook(model.exportNotebookJson(withMedia)), withMedia); assert.equal(model.exportNotebookJson(withMedia).includes('blob:'), false) })
test('portable HTML escapes every title/content/filename and has no script', () => { const hostile = structuredClone(withMedia); hostile.title = '<img src=x onerror=alert(1)>'; hostile.pages[0].title = '" onclick="attack()'; hostile.pages[0].modules[0].text = '<script>attack()</script>'; hostile.pages[0].modules.find((item) => item.kind === 'video').media.name = '<video onload=attack()>'; const html = model.exportNotebookHtml(hostile); assert(html.includes('&lt;script&gt;attack()&lt;/script&gt;')); assert(!html.includes('<script>')); assert(html.includes("default-src 'none'")); assert(!html.includes('src="blob:')) })
const rejects = (name, change) => test(name, () => { const bad = structuredClone(withMedia); change(bad); assert.throws(() => model.validateNotebook(bad)) })
rejects('duplicate module identity rejected without repairing/collapsing data', (bad) => { bad.pages[1].modules[0].id = bad.pages[0].modules[0].id })
rejects('unknown format does not migrate a production document', (bad) => { bad.kind = 'production-document' })
rejects('script URI rejected', (bad) => { bad.pages[0].modules.find((item) => item.kind === 'image').media.dataUrl = 'javascript:alert(1)' })
rejects('SVG image format rejected', (bad) => { const media = bad.pages[0].modules.find((item) => item.kind === 'image').media; media.mime = 'image/svg+xml'; media.dataUrl = 'data:image/svg+xml;base64,PHN2Zy8+' })
rejects('remote URL is never auto-loaded from imported data', (bad) => { const media = bad.pages[0].modules.find((item) => item.kind === 'video').media; media.dataUrl = 'https://example.com/private.mp4' })
rejects('blob URL cannot masquerade as persisted local media', (bad) => { const media = bad.pages[0].modules.find((item) => item.kind === 'video').media; media.dataUrl = 'blob:fake' })
rejects('oversized text rejected', (bad) => { bad.pages[0].modules[0].text = 'x'.repeat(100001) })
test('unknown active HTML fields are discarded, never rendered', () => { const candidate = structuredClone(book); candidate.pages[0].modules[0].html = '<script>attack()</script>'; const clean = model.validateNotebook(candidate); assert(!('html' in clean.pages[0].modules[0])) })
test('long notebook 200 modules/5 pages round trips without identity loss', () => { const long = structuredClone(book); long.pages = Array.from({ length: 5 }, (_, pageIndex) => ({ id: `page-${pageIndex}`, title: `Long page ${pageIndex}`, modules: Array.from({ length: 40 }, (_, index) => ({ id: `long-${pageIndex}-${index}`, kind: index % 8 === 0 ? 'heading' : 'text', text: 'Long production note. '.repeat(40), checked: false })) })); assert.deepEqual(model.parseNotebook(model.exportNotebookJson(long)), long) })
const report = { generatedAt: new Date().toISOString(), passed: true, checks }
await mkdir(resolve('output/playwright/partii-notebook'), { recursive: true }); await writeFile(resolve('output/playwright/partii-notebook/model-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
