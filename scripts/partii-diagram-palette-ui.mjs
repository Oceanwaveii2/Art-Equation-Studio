import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'

const generatedAt = new Date().toISOString()
const output = resolve('output/playwright/partii-diagram-palette', generatedAt.replace(/[:.]/g, '-'))
await mkdir(output, { recursive: true })
const inputs = ['src/board/DiagramPalette.tsx', 'src/board/DiagramPalette.css', 'src/board/diagramPaletteCommands.ts', 'scripts/partii-diagram-palette-ui.mjs']
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
const appCss = await readFile('src/App.css', 'utf8')
const themeTokens = [appCss.match(/:root\s*\{[^}]+\}/)?.[0], appCss.match(/\.workspace-light\s*\{[^}]*--surface-overlay[^}]+\}/)?.[0]].filter(Boolean).join('\n')
assert.equal(themeTokens.includes('--focus-ring:#236f9e'), true, 'actual light theme token fixture')
const report = { generatedAt, passed: false, checks: [], browserErrors: [], sourceHashes: await hashes(), themeTokenHash: createHash('sha256').update(themeTokens).digest('hex'), limitations: ['Actual production DiagramPalette component with production creation catalog in an isolated React harness. Normal input covers keyboard/search/cancel/disabled/contrast/viewport behavior. App placement, board command commits, screen-reader speech and native acceptance remain separate; harness callbacks retain only in-memory events. Theme declarations are captured from App.css at fixture creation.'] }
const harnessPath = resolve(output, 'harness.html')
await writeFile(harnessPath, `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Diagram palette accessibility fixture</title><style>${themeTokens}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text-strong);font:14px Arial,sans-serif}#root{min-height:100vh} .fixture-controls{display:flex;flex-wrap:wrap;gap:12px;padding:12px} .fixture-controls button{min-height:36px} .fixture-controls label{display:flex;gap:6px;align-items:center} .fixture-status{padding:12px}</style></head><body><div id="root"></div><script type="module">
import React,{useRef,useState} from 'react'; import{createRoot}from'react-dom/client';
import{DiagramPalette}from'/src/board/DiagramPalette.tsx';
window.fixtureEvents=[];
function Harness(){const[open,setOpen]=useState(false),[mode,setMode]=useState('create'),[blocked,setBlocked]=useState(false),[refuse,setRefuse]=useState(false),[light,setLight]=useState(false);const opener=useRef(null);
const close=reason=>{window.fixtureEvents.push({type:'close',reason});setOpen(false);if(reason!=='outside')opener.current?.focus();};
return React.createElement('div',{className:light?'workspace-light':'workspace-dark'},
React.createElement('div',{className:'fixture-controls'},
React.createElement('button',{ref:opener,onClick:()=>setOpen(true)},'Open diagram palette'),
...['create','successor','insert'].map(value=>React.createElement('button',{key:value,onClick:()=>setMode(value)},'Fixture mode '+value)),
React.createElement('label',null,React.createElement('input',{type:'checkbox',checked:blocked,onChange:event=>setBlocked(event.target.checked)}),'Fixture read-only'),
React.createElement('label',null,React.createElement('input',{type:'checkbox',checked:refuse,onChange:event=>setRefuse(event.target.checked)}),'Fixture refuse command'),
React.createElement('button',{onClick:()=>setLight(!light)},'Switch fixture theme'),
React.createElement('button',null,'Outside focus target')),
React.createElement('div',{className:'fixture-status'},'Disposable component fixture; board actions remain in memory.'),
open&&React.createElement(DiagramPalette,{mode,disabled:blocked,disabledReason:blocked?'This fixture workspace is read-only.':undefined,style:{left:12,top:80},onClose:close,onChoose:shape=>{window.fixtureEvents.push({type:'choose',shape,refused:refuse});return!refuse;}}));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`)
const fixtureUrl = `http://127.0.0.1:5199/${relative(process.cwd(), harnessPath).replaceAll('\\', '/')}`
const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-diagram-palette', optimizeDeps: { entries: [harnessPath] }, server: { watch: null, host: '127.0.0.1', port: 5199, strictPort: true } })
let browser
const check = (name, condition, details) => { report.checks.push({ name, passed: Boolean(condition), ...(details !== undefined ? { details } : {}) }); assert.ok(condition, name) }
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  page.on('pageerror', error => report.browserErrors.push(String(error)))
  await page.goto(fixtureUrl, { waitUntil: 'networkidle', timeout: 60000 })
  const opener = page.getByRole('button', { name: 'Open diagram palette', exact: true }), search = page.getByRole('searchbox', { name: 'Find a diagram shape' })
  const shape = label => page.getByRole('button', { name: label, exact: true })
  const events = () => page.evaluate(() => structuredClone(window.fixtureEvents))
  const activeIs = locator => locator.evaluate(element => document.activeElement === element)
  const open = async () => { await opener.click(); await search.waitFor({ state: 'visible' }); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Find a diagram shape') }
  const closeWait = async () => page.getByRole('dialog').waitFor({ state: 'hidden' })
  await open()
  check('Labeled nonmodal palette autofocuses search', await page.getByRole('dialog', { name: 'Diagram shapes' }).getAttribute('aria-modal') === 'false' && await activeIs(search))
  check('All seven shape names expose native labeled buttons and decorative icons', await page.locator('.diagram-palette-options button').count() === 7 && await page.locator('.diagram-palette-options svg[aria-hidden="true"][focusable="false"]').count() === 7)
  check('One roving option is in Tab order with usable button targets', await page.locator('.diagram-palette-options button[tabindex="0"]').count() === 1 && await shape('Process').evaluate(button => button.getBoundingClientRect().height >= 76))
  await search.fill('BRANCH diamond')
  check('Multiword search filters accessible options by name and keywords', await page.locator('.diagram-palette-options button').count() === 1 && await shape('Decision').isVisible())
  await search.fill('unfindable example')
  check('No-results state is visible and announced as status', await page.getByRole('status').innerText() === 'No matching shapes. Try another name.' && await page.locator('.diagram-palette-options button').count() === 0)
  await page.keyboard.press('ArrowDown')
  check('No-results arrow navigation retains search focus safely', await activeIs(search))
  await search.fill('')
  await page.keyboard.press('Tab')
  check('Tab moves from search to the first available shape', await activeIs(shape('Process')))
  await page.keyboard.press('ArrowRight')
  check('Right arrow moves to the next visible shape', await activeIs(shape('Decision')))
  await page.keyboard.press('ArrowDown')
  check('Down arrow moves one two-column row', await activeIs(shape('Document')))
  await page.keyboard.press('ArrowUp')
  check('Up arrow returns to the prior row', await activeIs(shape('Decision')))
  await page.keyboard.press('Home')
  check('Home moves to the first shape', await activeIs(shape('Process')))
  await page.keyboard.press('ArrowLeft')
  check('Arrow movement wraps at the beginning', await activeIs(shape('Arrow')))
  await page.keyboard.press('End')
  check('End moves to the final shape', await activeIs(shape('Arrow')))
  check('Keyboard focus has a visible theme focus ring', await shape('Arrow').evaluate(button => getComputedStyle(button).outlineStyle === 'solid' && getComputedStyle(button).outlineWidth === '2px'))
  await page.screenshot({ path: resolve(output, 'dark-palette.png') })
  await page.keyboard.press('Enter'); await closeWait()
  check('Enter chooses exactly once and closes with the choose reason', JSON.stringify((await events()).slice(-2)) === JSON.stringify([{ type: 'choose', shape: 'arrow', refused: false }, { type: 'close', reason: 'choose' }]))
  check('Choose dismissal restores parent-owned opener focus', await activeIs(opener))
  await open(); await page.keyboard.press('ArrowUp')
  check('Search Up enters the final available shape', await activeIs(shape('Arrow')))
  await page.keyboard.press('Home'); await page.keyboard.press('Space'); await closeWait()
  check('Native Space activation chooses once', JSON.stringify((await events()).slice(-2)) === JSON.stringify([{ type: 'choose', shape: 'process', refused: false }, { type: 'close', reason: 'choose' }]))
  await open(); await shape('Start / End').click(); await closeWait()
  check('Pointer activation uses the same creation contract', (await events()).at(-2).shape === 'start-end' && (await events()).at(-1).reason === 'choose')
  await open(); const beforeEscape = (await events()).filter(event => event.type === 'choose').length
  await page.keyboard.press('Escape'); await closeWait()
  check('Escape cancels without choosing and restores opener focus', (await events()).at(-1).reason === 'escape' && (await events()).filter(event => event.type === 'choose').length === beforeEscape && await activeIs(opener))
  await open(); await page.getByRole('button', { name: 'Close diagram shapes' }).click(); await closeWait()
  check('Visible Close button reports cancellation', (await events()).at(-1).reason === 'cancel' && await activeIs(opener))
  await open(); const outside = page.getByRole('button', { name: 'Outside focus target' }); await outside.click(); await closeWait()
  check('Outside pointer dismissal retains the clicked control focus', (await events()).at(-1).reason === 'outside' && await activeIs(outside))
  await page.getByRole('button', { name: 'Fixture mode successor' }).click(); await open()
  check('Connected successor mode has a distinct accessible dialog name', await page.getByRole('dialog', { name: 'Add a connected shape' }).count() === 1)
  await page.keyboard.press('Escape'); await closeWait(); await page.getByRole('button', { name: 'Fixture mode insert' }).click(); await open()
  check('Insert mode exposes the label-transfer policy as its description', await page.getByRole('dialog', { name: 'Insert a shape' }).getAttribute('aria-describedby') !== null && await page.locator('.diagram-palette-hint').innerText() === 'The original label stays with the incoming relationship.')
  await page.keyboard.press('Escape'); await closeWait(); await page.getByRole('checkbox', { name: 'Fixture refuse command' }).check(); await open(); await shape('Decision').click()
  check('Command refusal keeps the palette open without a success close', await page.getByRole('dialog').isVisible() && JSON.stringify((await events()).at(-1)) === JSON.stringify({ type: 'choose', shape: 'decision', refused: true }))
  await search.focus(); await page.keyboard.press('Escape'); await closeWait(); await page.getByRole('checkbox', { name: 'Fixture refuse command' }).uncheck(); await page.getByRole('checkbox', { name: 'Fixture read-only' }).check(); await open()
  const beforeDisabled = (await events()).filter(event => event.type === 'choose').length
  check('Read-only disabled reason is announced and every creation option disabled', await page.getByRole('status').innerText() === 'This fixture workspace is read-only.' && await page.locator('.diagram-palette-options button:not(:disabled)').count() === 0)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  check('Read-only keyboard input cannot invoke a creation callback', await activeIs(search) && (await events()).filter(event => event.type === 'choose').length === beforeDisabled)
  await page.screenshot({ path: resolve(output, 'readonly-palette.png') })
  await page.keyboard.press('Escape'); await closeWait(); await page.getByRole('checkbox', { name: 'Fixture read-only' }).uncheck(); await page.getByRole('button', { name: 'Switch fixture theme' }).click(); await open()
  const contrast = await shape('Process').evaluate(button => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number), luminance = color => rgb(color).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    const foreground = luminance(getComputedStyle(button).color), background = luminance(getComputedStyle(button).backgroundColor), secondary = luminance(getComputedStyle(button.querySelector('small')).color)
    const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
    return { primary: ratio(foreground, background), secondary: ratio(secondary, background), paletteBackground: getComputedStyle(button.closest('.diagram-palette')).backgroundColor }
  })
  check('Light theme uses the captured actual light surface and legible primary/secondary text', contrast.paletteBackground === 'rgb(255, 250, 243)' && contrast.primary >= 4.5 && contrast.secondary >= 4.5, contrast)
  await page.keyboard.press('ArrowDown')
  check('Light keyboard focus ring uses the theme token', await shape('Process').evaluate(button => getComputedStyle(button).outlineColor === 'rgb(35, 111, 158)'))
  await page.screenshot({ path: resolve(output, 'light-palette.png') })
  await page.emulateMedia({ forcedColors: 'active' })
  check('Forced colors preserves visible text and keyboard outline', await shape('Process').evaluate(button => { const style = getComputedStyle(button); return style.outlineStyle === 'solid' && style.outlineWidth === '2px' && style.color !== style.backgroundColor }))
  await page.screenshot({ path: resolve(output, 'forced-colors-palette.png') })
  await page.emulateMedia({ forcedColors: 'none' }); await page.keyboard.press('Escape'); await closeWait(); await page.setViewportSize({ width: 320, height: 500 }); await open()
  const viewportGeometry = await page.getByRole('dialog').evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height, width: innerWidth, viewportHeight: innerHeight, client: element.clientHeight, scroll: element.scrollHeight, overflow: getComputedStyle(element).overflowY } })
  check('Palette width stays within a narrow viewport and content scrolls instead of clipping', viewportGeometry.left >= 0 && viewportGeometry.right <= viewportGeometry.width && viewportGeometry.overflow === 'auto' && viewportGeometry.scroll > viewportGeometry.client, viewportGeometry)
  check('Numeric flyout placement leaves every vertical control reachable within the viewport', viewportGeometry.top >= 0 && viewportGeometry.bottom <= viewportGeometry.viewportHeight - 12, viewportGeometry)
  await search.fill('arrow'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await closeWait()
  check('Filtered keyboard selection remains usable on a small viewport', (await events()).at(-2).shape === 'arrow' && (await events()).at(-1).reason === 'choose')
  report.events = await events(); report.sourceHashesAtEnd = await hashes(); assert.deepEqual(report.sourceHashesAtEnd, report.sourceHashes)
  check('All four tested source files stayed unchanged during the run', true)
  check('No browser exceptions', report.browserErrors.length === 0, report.browserErrors)
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally { await browser?.close(); await server.close(); await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)) }
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, error: report.error?.split('\n')[0], output }))
