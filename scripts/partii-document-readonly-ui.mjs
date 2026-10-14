import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'

const generatedAt = new Date().toISOString(), output = resolve('output/playwright/partii-document-readonly', generatedAt.replace(/[:.]/g, '-'))
await mkdir(output, { recursive: true })
const inputs = ['src/document/RichDocument.tsx', 'src/App.css', 'scripts/fixtures/partii-document-readonly-harness.html', 'scripts/partii-document-readonly-ui.mjs']
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
const report = { generatedAt, passed: false, checks: [], browserErrors: [], sourceHashes: await hashes(), limitations: ['Actual isolated RichDocument component with production TipTap and CSS. Native export dialogs/disk, full App read-only callback integration, physical scaling and screen-reader acceptance remain separate. Mock exports are retained in memory only.'] }
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-document-readonly', optimizeDeps: { entries: ['scripts/fixtures/partii-document-readonly-harness.html'] }, server: { watch: null, host: '127.0.0.1', port: 5197, strictPort: true } })
let browser
const check = (name, condition, details) => { report.checks.push({ name, passed: Boolean(condition), ...(details ? { details } : {}) }); assert.ok(condition, name) }
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 930 } })
  page.on('pageerror', error => report.browserErrors.push(String(error)))
  await page.goto('http://127.0.0.1:5197/scripts/fixtures/partii-document-readonly-harness.html', { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('.document-editor')?.editor && window.fixtureControl)
  const snapshot = () => page.evaluate(() => ({ document: document.querySelector('.document-editor').editor.getJSON(), model: window.fixtureControl.snapshot(), contentWrites: window.fixtureWrites.content.length, layoutWrites: window.fixtureWrites.layout.length }))
  const initial = await snapshot()
  check('Editor exposes selectable named read-only text', await page.getByRole('textbox', { name: 'Project document text' }).getAttribute('aria-readonly') === 'true' && await page.locator('.document-editor').getAttribute('contenteditable') === 'false')
  check('Formatting and page layout controls are disabled', await page.locator('.document-formatting-controls select:not(:disabled),.document-layout-inspector select:not(:disabled),.document-layout-inspector input:not(:disabled)').count() === 0 && await page.getByRole('button', { name: 'Bold', exact: true }).isDisabled())
  check('Caption remains copyable and read-only', await page.getByRole('textbox', { name: 'Image caption' }).evaluate(input => input.readOnly && !input.disabled))
  check('Read-only text retains transparent paper surface and inherited ink', await page.locator('.document-editor').evaluate(item => getComputedStyle(item).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(item).color === getComputedStyle(item.parentElement).color))
  await page.evaluate(() => {
    const select = document.querySelector('.document-layout-inspector select'); select.value = 'a4'; select.dispatchEvent(new Event('change', { bubbles: true }));
    const input = document.querySelector('.document-running-copy input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'REJECTED HEADER'); input.dispatchEvent(new Event('input', { bubbles: true }));
  })
  check('Forced layout events cannot bypass the permission callback guard', JSON.stringify(await snapshot()) === JSON.stringify(initial))
  await page.locator('.document-editor').focus()
  await page.keyboard.press('Control+End'); await page.keyboard.insertText('REJECTED TYPING'); await page.keyboard.press('Control+b'); await page.keyboard.press('Control+z')
  await page.evaluate(() => { const target = document.querySelector('.document-editor'), data = new DataTransfer(); data.setData('text/plain', 'REJECTED PASTE'); target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); const editor = target.editor; editor.commands.insertContent('REJECTED COMMAND'); editor.commands.selectAll(); editor.commands.toggleBold(); window.dispatchEvent(new CustomEvent('art-equation:document-history', { detail: 'undo' })); window.dispatchEvent(new CustomEvent('art-equation:document-history', { detail: 'redo' })); })
  check('Typing, paste, shortcut, command and custom history leave content and callbacks exact', JSON.stringify(await snapshot()) === JSON.stringify(initial))
  await page.getByRole('button', { name: 'Flow', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle document outline' }).click()
  await page.getByRole('navigation', { name: 'Document outline' }).getByRole('button', { name: 'Read-only production brief' }).click()
  check('Flow and outline navigation remain available without model writes', (await snapshot()).contentWrites === 0 && (await snapshot()).layoutWrites === 0 && await page.locator('.document-flow').count() === 1)
  await page.getByRole('button', { name: 'More formatting' }).click()
  const menu = page.getByRole('menu', { name: 'More document tools' })
  check('All mutation menu entries disabled; four export/print actions enabled', await menu.locator('button:not(:disabled)').count() === 4 && await menu.getByRole('menuitem', { name: '• Bulleted list', exact: true }).isDisabled())
  check('Read-only menu initially focuses first available export', await page.evaluate(() => document.activeElement?.textContent.includes('Export HTML')))
  await page.keyboard.press('ArrowDown')
  check('Menu keyboard navigation skips disabled mutation entries', await page.evaluate(() => document.activeElement?.textContent.includes('Export SVG')))
  await page.keyboard.press('Escape')
  check('Escape returns focus to More opener', await page.getByRole('button', { name: 'More formatting' }).evaluate(button => button === document.activeElement))
  for (const [name, command] of [['⇩ Export HTML', 'export_html'], ['⇩ Export SVG', 'export_binary']]) {
    await page.getByRole('button', { name: 'More formatting' }).click(); await page.getByRole('menuitem', { name, exact: true }).click()
    await page.waitForFunction(command => window.fixtureWrites.exports.some(item => item.command === command), command)
  }
  check('Read-only HTML/SVG exports read current document without changing it', await page.evaluate(() => window.fixtureWrites.exports[0].args.contents.includes('Read-only production brief')) && (await snapshot()).contentWrites === 0)
  await page.getByRole('button', { name: 'More formatting' }).click(); await page.getByRole('menuitem', { name: '▣ Print / PDF', exact: true }).click()
  check('Print remains available in read-only mode without mutation', await page.evaluate(() => window.fixtureWrites.prints === 1 && window.fixtureWrites.content.length === 0))
  await page.screenshot({ path: resolve(output, 'readonly.png'), fullPage: true })
  await page.evaluate(() => window.fixtureControl.setReadOnly(false))
  await page.waitForFunction(() => document.querySelector('.document-editor').isContentEditable && !document.querySelector('.editable-image-caption').readOnly)
  await page.locator('.document-editor').focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' Writable edit')
  await page.getByRole('textbox', { name: 'Image caption' }).fill('Writable caption')
  await page.getByLabel('Running header').fill('Writable header')
  check('Writable transition restores text, caption and layout mutation', await page.evaluate(() => window.fixtureWrites.content.length >= 2 && window.fixtureWrites.layout.length > 0 && JSON.stringify(window.fixtureControl.snapshot().content).includes('Writable caption') && window.fixtureControl.snapshot().layout.headerText === 'Writable header'))
  await page.evaluate(() => document.querySelector('.document-editor').editor.commands.selectAll())
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  check('Writable formatting toolbar still changes actual document marks', await page.evaluate(() => JSON.stringify(window.fixtureControl.snapshot().content).includes('"type":"bold"')))
  const writable = await snapshot()
  await page.evaluate(() => window.fixtureControl.setReadOnly(true))
  await page.waitForFunction(() => !document.querySelector('.document-editor').isContentEditable && document.querySelector('.editable-image-caption').readOnly)
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('art-equation:document-history', { detail: 'undo' })); window.dispatchEvent(new CustomEvent('art-equation:document-history', { detail: 'redo' })); document.querySelector('.document-editor').editor.commands.undo(); document.querySelector('.document-editor').editor.commands.redo(); })
  const afterLock = await snapshot()
  check('Mounted lock change blocks populated Undo/Redo history with unchanged writes', JSON.stringify(afterLock.document) === JSON.stringify(writable.document) && afterLock.contentWrites === writable.contentWrites && afterLock.layoutWrites === writable.layoutWrites)
  await page.evaluate(() => window.fixtureControl.setReadOnly(false))
  await page.waitForFunction(() => document.querySelector('.document-editor').isContentEditable)
  await page.evaluate(() => { const editor = document.querySelector('.document-editor').editor; editor.commands.focus('end'); editor.commands.insertContent(' Unique history change'); })
  const historyAdded = await snapshot()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('art-equation:document-history', { detail: 'undo' })))
  const historyUndone = await snapshot()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('art-equation:document-history', { detail: 'redo' })))
  check('Writable custom history still performs Undo and Redo', JSON.stringify(historyUndone.document) !== JSON.stringify(historyAdded.document) && JSON.stringify((await snapshot()).document) === JSON.stringify(historyAdded.document))
  await page.getByRole('button', { name: 'More formatting' }).click(); await page.getByRole('menuitem', { name: '▧ Insert image', exact: true }).click()
  await page.waitForFunction(() => window.fixturePending)
  const beforePendingLock = await snapshot()
  await page.evaluate(() => window.fixtureControl.setReadOnly(true))
  await page.waitForFunction(() => !document.querySelector('.document-editor').isContentEditable)
  await page.evaluate(() => window.fixtureControl.resolveRequest('https://example.invalid/rejected.png'))
  await page.waitForTimeout(50)
  check('Async image insertion begun before lock cannot continue or open caption prompt', (await snapshot()).contentWrites === beforePendingLock.contentWrites && await page.evaluate(() => window.fixtureWrites.requests.length === 1 && !window.fixturePending))
  const beforeReplace = await snapshot()
  await page.evaluate(() => window.fixtureControl.replaceContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Different authoritative read-only document' }] }] }))
  await page.waitForFunction(() => document.querySelector('.document-editor').textContent.includes('Different authoritative read-only document'))
  check('Parent can open different read-only content without editor write callback', (await snapshot()).contentWrites === beforeReplace.contentWrites && !await page.locator('.document-editor').evaluate(item => item.isContentEditable))
  report.sourceHashesAtEnd = await hashes(); assert.deepEqual(report.sourceHashesAtEnd, report.sourceHashes)
  check('No browser exceptions', report.browserErrors.length === 0, report.browserErrors)
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally { await browser?.close(); await server.close(); await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)) }
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, error: report.error?.split('\n')[0], output }))
