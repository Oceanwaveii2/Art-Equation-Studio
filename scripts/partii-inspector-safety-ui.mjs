import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import ts from 'typescript'

// Isolated real React UI; only fixture memory is persisted between reloads.
// Host clipboard, live projects, actual Tauri filesystem and existing EXEs are untouched.
const compile = async (relative) => ts.transpileModule(await readFile(new URL(relative, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const load = (code) => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const { createBlankProject } = await load(await compile('../src/model/project.ts'))
const coreUrl = `data:text/javascript;base64,${Buffer.from(await compile('../src/board/diagramStructureCore.ts')).toString('base64')}`
const vectorUrl = `data:text/javascript;base64,${Buffer.from(await compile('../src/model/vector.ts')).toString('base64')}`
const { layoutBoardColumns } = await load((await compile('../src/board/columns.ts')).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../model/vector'", `from '${vectorUrl}'`))
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-inspector-safety-2026-09-30')
await mkdir(artifacts, { recursive: true })
const report = { passed: false, generatedAt: new Date().toISOString(), baseUrl, sourceHashes: {}, checks: [], scenarios: [], screenshots: [], browserErrors: [], limitation: 'Actual headless Edge React pointer/keyboard/menu and memory save/reload. No production disk, native Vello pixel, Windows physical DPI, stylus or real clipboard claim.' }
for (const name of ['src/App.tsx','src/App.css','src/model/project.ts','src/model/vector.ts','src/model/vectorComposition.ts','src/model/vectorBooleanGeometry.ts','src/board/vectorSvg.ts','src/board/columns.ts','src/board/diagramStructureCore.ts','src/board/boardMutationSafety.ts','src/board/artEquationCanvasAdapter.ts','src/board/nativeSceneAdapter.ts','src/board/GesturePresenter.ts','src/board/OverlayPresenter.ts']) report.sourceHashes[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
report.browserVersion = browser.version()
report.nodeVersion = process.version
report.platform = process.platform
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } })
const page = await context.newPage()
page.on('pageerror', (error) => report.browserErrors.push(error.message))
const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 50; c.height = 80; const ctx = c.getContext('2d'); ctx.fillStyle = '#129abc'; ctx.fillRect(0,0,50,80); return c.toDataURL('image/png') })
const node = (id, kind, x,y,width,height,extra = {}) => ({ id, title: id, kind, x,y,width,height, color: '#465c70', strokeColor: '#94aeca', opacity: 1, ...extra })
const fixture = createBlankProject('Part II inspector safety isolated QA')
fixture.id = 'partii-inspector-safety-2026-09-30-memory'
fixture.assets = []
const connector = (id, extra) => ({ id, sourcePort:'right', targetPort:'left', style:'elbow', color:'#ee942f', width:2, dashed:false, startArrow:true, endArrow:true, animated:false, label:id, ...extra })
const root = layoutBoardColumns({ id:'subtree-root', title:'Subtree root', linkedFolderPath:`projects/${fixture.id}/boards/subtree-root`, viewport:{x:0,y:0,scale:1}, backgroundColor:'#151a20', backgroundFollowsTheme:false, gridVisible:true,
  nodes:[
    node('outer','group',150,70,730,730,{containerRole:'group'}),
    node('inner','group',175,145,270,350,{groupId:'outer',containerRole:'frame'}),
    node('deep','group',200,210,205,230,{groupId:'inner',containerRole:'group'}),
    node('leaf','shape',235,280,120,100,{groupId:'deep',shapeType:'rectangle',strokeWidth:3,rotation:15,color:'#00ff00'}),
    node('column','column',520,145,260,300,{groupId:'outer'}),
    node('column-image','image',530,213,240,240,{parentColumnId:'column',columnOrder:0,freeWidth:120,freeHeight:180,body:image,imagePresentation:'artwork',imageTransform:{fit:'cover',positionX:27,positionY:63,zoom:1.3}}),
    node('owning-portal','board-link',220,545,132,132,{groupId:'outer',targetBoardId:'owned-child',boardLinkRole:'child',boardPortal:true}),
    node('outside','shape',1080,200,120,100,{shapeType:'ellipse'}),
  ], connectors:[
    connector('internal-manual',{sourceId:'leaf',targetId:'column-image',sourcePortMode:'adaptive',targetPortMode:'fixed',bendPoints:[{x:420,y:325},{x:420,y:405}],labelPosition:{t:.43,offsetX:13,offsetY:-26,note:'preserve'},linePattern:'dash-dot',relationshipStyle:'dependency',fixtureMetadata:{version:1}}),
    connector('internal-free',{sourceId:'leaf',targetPoint:{x:380,y:505},bendPoints:[{x:380,y:370}],labelPosition:{t:.7,offsetX:6,offsetY:11},linePattern:'dot',relationshipStyle:'alternative'}),
    connector('external',{sourceId:'leaf',targetId:'outside',bendPoints:[{x:1020,y:480}]}),
    connector('unowned-free',{sourcePoint:{x:940,y:650},targetPoint:{x:1110,y:650}}),
  ] })
fixture.boards = [root,{id:'owned-child',title:'Owned child',parentBoardId:'subtree-root',viewport:{x:0,y:0,scale:1},nodes:[node('child-content','note',100,100,180,130,{body:'Do not duplicate or delete me when a portal is copied.'})],connectors:[]}]
const descendants = ['outer','inner','deep','leaf','column','column-image','owning-portal']
root.connectors.push(connector('container-boundary', { sourceId: 'outer', targetId: 'outside', bendPoints: [{ x: 980, y: 410 }], labelPosition: { t: .4, offsetX: 6, offsetY: -14 } }))
await page.addInitScript((initial) => {
  if (!['http:','https:'].includes(location.protocol)) return
  const backend = { project: JSON.parse(sessionStorage.getItem('subtree-fixture-project') || 'null') || structuredClone(initial), calls:[], clipboard:[] }
  window.__subtreeBackend = backend
  localStorage.setItem('art-equation.navigator','0'); localStorage.setItem('art-equation.inspector','0'); localStorage.setItem('art-equation.canvas-tools','1'); localStorage.setItem('art-equation.view-mode','canvas')
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>backend.clipboard.push(text),read:async()=>[]}})
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener:()=>{}}
  window.__TAURI_INTERNALS__ = {metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},convertFileSrc:(value)=>value,
    invoke:async(command,args={})=>{
      backend.calls.push({command,args:structuredClone(args)})
      if(command==='workspace_info') return {root:'MEMORY-ONLY-NO-DISK',workspaceId:'isolated-subtree',readOnly:false,lockOwned:true}
      if(command==='list_projects') return [{id:backend.project.id,title:backend.project.title,updatedAt:backend.project.updatedAt,boardCount:backend.project.boards.length,assetCount:0,status:backend.project.status}]
      if(command==='load_json') return structuredClone(args.relativePath==='settings.json'?{schemaVersion:5,theme:'dark',viewMode:'canvas',activeProjectId:initial.id,projectNavigation:{[initial.id]:{activeBoardId:'subtree-root',activeDocumentId:initial.documents[0].id,activeNavigatorItem:'board:subtree-root',viewMode:'canvas'}}}:backend.project)
      if(command==='save_json'){if(args.relativePath.endsWith('/project.json')){backend.project=structuredClone(args.value);sessionStorage.setItem('subtree-fixture-project',JSON.stringify(backend.project))}return}
      if(['ensure_managed_board_folders','ensure_project_workspace','plugin:event|unlisten'].includes(command)) return
      if(['list_project_trash','list_trashed_projects','audit_assets'].includes(command)) return []
      if(['plugin:event|listen','plugin:window|scale_factor'].includes(command)) return 1
      if(command==='plugin:window|inner_size') return {width:innerWidth,height:innerHeight}
      if(command==='mini_bridge_launch') return null
      throw new Error(`Subtree mock refuses ${command}`)
    }}
},fixture)
const settled = () => page.evaluate(()=>new Promise((done)=>requestAnimationFrame(()=>requestAnimationFrame(done))))
const byId = (id) => page.locator(`.board-node[data-node-id="${id}"]`)
const check = (name,passed,detail) => { report.checks.push({name,passed:Boolean(passed),detail}); assert(passed,`${name}: ${JSON.stringify(detail)}`) }
const screenshot = async(name)=>{await page.screenshot({path:resolve(artifacts,`${name}.png`),fullPage:true});report.screenshots.push(`${name}.png`)}
const save = async()=>{const before=await page.evaluate(()=>window.__subtreeBackend.calls.length);await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction((before)=>window.__subtreeBackend.calls.slice(before).some((call)=>call.command==='save_json'&&call.args.relativePath.endsWith('/project.json')),before);return page.evaluate(()=>structuredClone(window.__subtreeBackend.project))}
const board = (project)=>project.boards.find((entry)=>entry.id==='subtree-root')
async function boot(reset=false){
  if(reset){await page.evaluate(()=>sessionStorage.removeItem('subtree-fixture-project'));await page.reload({waitUntil:'domcontentloaded'})}else await page.goto(baseUrl,{waitUntil:'domcontentloaded'})
  const enter=page.getByRole('button',{name:'Enter now',exact:true});if(await enter.count())await enter.click()
  await byId('outer').waitFor();await page.getByRole('button',{name:'Canvas',exact:true}).click();await page.getByLabel('Select and move',{exact:true}).click();await settled()
}
async function choose(id,additive=false){
  const item=byId(id);await item.waitFor()
  const point=await item.evaluate((item,id)=>{
    const handles=item.querySelectorAll('.node-drag-handle'),paths=item.querySelectorAll('.shape-hit-area')
    for(const handle of handles){const b=handle.getBoundingClientRect();for(const t of [.1,.25,.5,.75,.9]){const p={x:b.x+b.width*t,y:b.y+b.height/2};if(document.elementFromPoint(p.x,p.y)?.closest('.board-node')?.getAttribute('data-node-id')===id)return p}}
    for(const path of paths){for(const t of [.1,.3,.65,.85]){const p=path.getPointAtLength(path.getTotalLength()*t).matrixTransform(path.getScreenCTM());if(document.elementFromPoint(p.x,p.y)?.closest('.board-node')?.getAttribute('data-node-id')===id)return {x:p.x,y:p.y}}}
    const b=item.getBoundingClientRect();for(const f of [.15,.35,.65,.85]){const p={x:b.x+b.width*f,y:b.y+b.height*f};if(document.elementFromPoint(p.x,p.y)?.closest('.board-node')?.getAttribute('data-node-id')===id)return p}
    return null
  },id)
  assert.ok(point,`No actual unobscured hit surface for ${id}`)
  if(additive)await page.keyboard.down('Shift');await page.mouse.click(point.x,point.y);if(additive)await page.keyboard.up('Shift');await settled()
  assert(await item.evaluate((item)=>item.classList.contains('selected')),`Actual pointer did not select ${id}`)
  return point
}
async function copy(id){await choose(id);await page.locator('.canvas-stage').focus();await page.evaluate(()=>localStorage.removeItem('art-equation-board-clipboard'));await page.keyboard.press('Control+c');return page.evaluate(()=>JSON.parse(localStorage.getItem('art-equation-board-clipboard')||'{}'))}
async function undo(){await page.getByLabel('Undo board change',{exact:true}).click();await settled()}
async function reset(){await boot(true);return save()}
async function openHierarchy(){await page.getByLabel('Toggle Appearance panel',{exact:true}).click();await page.getByLabel('Show board hierarchy',{exact:true}).click();await settled()}
const geometry = (project) => board(project).nodes.map(({id,x,y,width,height,locked,groupId,parentColumnId})=>({id,x,y,width,height,locked,groupId,parentColumnId}))
const semantic = (project)=>({boards:project.boards.map(({id,parentBoardId,nodes,connectors})=>({id,parentBoardId,nodes,connectors})),assets:project.assets})

async function inspector() {
  const panel = page.locator('.project-inspector')
  if (!await panel.isVisible()) {
    const edge = page.getByLabel('Show the inspector panel', { exact: true })
    if (await edge.isVisible()) await edge.click()
    else await page.getByLabel('Toggle project inspector', { exact: true }).click()
  }
  await panel.waitFor({ state: 'visible' }); await settled()
}
async function editInspector(id, field, value) { await choose(id); await inspector(); const input = page.getByLabel(`${field} of ${id}`, { exact: true }); await input.fill(String(value)); await input.press('Enter'); await settled() }
async function contextAction(id, label) { const point = await choose(id); await page.mouse.click(point.x, point.y, { button: 'right' }); await settled(); await page.getByRole('menuitem', { name: label, exact: true }).click(); await settled() }
const equalSnapshot = (a, b) => JSON.stringify(semantic(a)) === JSON.stringify(semantic(b))
function shifted(before, after, dx, dy) {
  const original = board(before), current = board(after)
  check(`All owned members translate by ${dx},${dy} exactly once`, descendants.every((id) => { const a = current.nodes.find((n) => n.id === id), b = original.nodes.find((n) => n.id === id); return a.x === b.x + dx && a.y === b.y + dy && a.width === b.width && a.height === b.height }), current.nodes.map(({ id,x,y,width,height }) => ({ id,x,y,width,height })))
  check('Outsider world geometry is unchanged', JSON.stringify(current.nodes.find((n) => n.id === 'outside')) === JSON.stringify(original.nodes.find((n) => n.id === 'outside')))
  for (const id of ['internal-manual', 'internal-free']) {
    const old = original.connectors.find((edge) => edge.id === id), next = current.connectors.find((edge) => edge.id === id)
    check(`${id} owned route translates with inspector movement`, JSON.stringify(next.bendPoints) === JSON.stringify(old.bendPoints.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }))))
    if (old.targetPoint) check(`${id} free endpoint translates with subtree`, next.targetPoint.x === old.targetPoint.x + dx && next.targetPoint.y === old.targetPoint.y + dy)
    check(`${id} relationship/label/style metadata remains exact`, JSON.stringify(next.labelPosition) === JSON.stringify(old.labelPosition) && next.relationshipStyle === old.relationshipStyle && next.linePattern === old.linePattern)
  }
  for (const id of ['external','unowned-free','container-boundary']) check(`${id} boundary or unowned waypoint remains fixed-world`, JSON.stringify(current.connectors.find((edge) => edge.id === id)) === JSON.stringify(original.connectors.find((edge) => edge.id === id)))
}
const greenCount = () => page.locator('.board-minimap canvas').first().evaluate((canvas) => { const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 1] > 220 && data[i] < 40 && data[i + 2] < 40) count++; return count })
async function waitGreen(expected) { await page.waitForFunction((expected) => { const canvas = document.querySelector('.board-minimap canvas'); if (!canvas) return false; const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let count = 0; for (let i=0;i<data.length;i+=4) if(data[i+1]>220&&data[i]<40&&data[i+2]<40)count++; return expected ? count > 0 : count === 0 }, expected) }
async function scenario(name, run) { const first = report.checks.length; console.log(`Inspector safety: ${name}`); try { await run(); report.scenarios.push({ name, passed: true, checks: report.checks.length-first }) } catch (error) { report.scenarios.push({ name, passed: false, error: error.message, stack: error.stack }); await screenshot(`failure-${name}`) } }
try {
  await boot()
  await scenario('inspector-position-atomic', async () => {
    for (const [field, delta] of [['x',37],['y',23]]) {
      const baseline = await reset(), old = board(baseline).nodes.find((node) => node.id === 'outer')
      await editInspector('outer', field, old[field] + delta)
      const next = await save(); shifted(baseline, next, field === 'x' ? delta : 0, field === 'y' ? delta : 0)
      await undo(); check(`Inspector ${field.toUpperCase()} edit is a single exact Undo`, equalSnapshot(await save(), baseline))
    }
    await screenshot('01-inspector-atomic-position')
  })
  await scenario('inherited-lock-disabled', async () => {
    await reset(); await openHierarchy(); await page.getByLabel('Lock outer',{exact:true}).click(); await page.getByLabel('Close board hierarchy',{exact:true}).click(); const locked = await save()
    await choose('leaf'); await inspector()
    for (const field of ['x','y','width','height']) check(`Inherited ancestor lock disables inspector ${field}`, await page.getByLabel(`${field} of leaf`,{exact:true}).isDisabled())
    for (const input of await page.locator('.inspector-appearance input').all()) check('Inherited ancestor lock disables inspector appearance', await input.isDisabled())
    await page.locator('.canvas-stage').focus(); await page.keyboard.press('ArrowRight'); await settled(); check('Inherited inspector selection and keyboard input cannot alter saved records', equalSnapshot(await save(), locked))
    await screenshot('02-inherited-lock-inspector')
  })
  await scenario('locked-descendant-inspector-refusal', async () => {
    await reset(); await openHierarchy(); await page.getByLabel('Lock leaf',{exact:true}).click(); await page.getByLabel('Close board hierarchy',{exact:true}).click(); const locked = await save(), old = board(locked).nodes.find((n) => n.id === 'outer')
    await choose('outer'); await inspector(); const input = page.getByLabel('x of outer',{exact:true})
    if (!await input.isDisabled()) { await input.fill(String(old.x + 41)); await input.press('Enter'); await settled() }
    const refusal = await page.locator('.status-bar, .drawing-notice').allTextContents().then((text) => text.join(' '))
    check('Refused inspector field displays the saved coordinate', Number(await input.inputValue()) === old.x, { saved: old.x, shown: await input.inputValue() })
    check('Inspector parent movement refuses locked descendant atomically', equalSnapshot(await save(), locked))
    check('Refused inspector parent movement reports reason or disables input', await input.isDisabled() || /locked|cancel|refus/i.test(refusal), refusal)
  })
  await scenario('deep-collapse-dom-connectors-minimap', async () => {
    const baseline = await reset(); await waitGreen(true); const greenBefore = await greenCount()
    check('Visible deep vector paints measurable green minimap pixels before collapse', greenBefore > 0, greenBefore)
    await contextAction('outer','Collapse'); await waitGreen(false)
    for (const id of descendants.filter((id) => id !== 'outer')) check(`Collapse hides transitive DOM object ${id}`, await byId(id).count() === 0)
    check('Collapsed root and outside stay visible', await byId('outer').isVisible() && await byId('outside').isVisible())
    for (const id of ['internal-manual','internal-free','external']) check(`Collapse removes hidden-endpoint connector hit/render surface ${id}`, await page.locator(`[data-connector-id="${id}"]`).count() === 0)
    for (const id of ['container-boundary','unowned-free']) check(`Collapse retains visible/free connector ${id}`, await page.locator(`[data-connector-id="${id}"]`).count() > 0)
    check('Collapsed minimap contains no deep-leaf green pixels', await greenCount() === 0)
    const after = await save(), expected = structuredClone(baseline); board(expected).nodes.find((n) => n.id === 'outer').collapsed = true
    check('Collapse preserves exact content/connector graph and only saves root flag', equalSnapshot(after, expected))
    await screenshot('03-deep-collapse-and-minimap'); await undo(); await waitGreen(true)
    check('Collapse Undo restores exact source records and deep vector minimap', equalSnapshot(await save(), baseline) && await byId('leaf').isVisible() && await greenCount() > 0)
  })
  await scenario('dissolve-container-endpoint-and-undo', async () => {
    const baseline = await reset(), original = board(baseline), edge = original.connectors.find((n) => n.id === 'container-boundary'), owner = original.nodes.find((n) => n.id === 'outer'), endpoint = { x: owner.x + owner.width, y: owner.y + owner.height / 2 }
    await contextAction('outer','Dissolve'); const next = await save(), current = board(next), detached = current.connectors.find((n) => n.id === 'container-boundary')
    check('Dissolve removes only selected container and preserves descendants', !current.nodes.some((n) => n.id === 'outer') && current.nodes.length === original.nodes.length - 1)
    check('Dissolve releases direct members into world space without disturbing nested owners', current.nodes.filter((n) => ['inner','column','owning-portal'].includes(n.id)).every((n) => !n.groupId && !n.parentColumnId) && current.nodes.find((n) => n.id === 'deep').groupId === 'inner' && current.nodes.find((n) => n.id === 'leaf').groupId === 'deep' && current.nodes.find((n) => n.id === 'column-image').parentColumnId === 'column')
    check('Dissolve preserves every surviving object world frame', current.nodes.every((n) => { const old = original.nodes.find((v) => v.id === n.id); return n.x === old.x && n.y === old.y && n.width === old.width && n.height === old.height }))
    check('Container boundary connection becomes detached at exact prior visible port', detached.sourceId === undefined && detached.sourcePoint.x === endpoint.x && detached.sourcePoint.y === endpoint.y && detached.targetId === edge.targetId)
    check('Boundary route and style/label metadata survive Dissolve', JSON.stringify(detached.bendPoints) === JSON.stringify(edge.bendPoints) && JSON.stringify(detached.labelPosition) === JSON.stringify(edge.labelPosition))
    check('No connector retains removed object attachment', current.connectors.every((n) => n.sourceId !== 'outer' && n.targetId !== 'outer'))
    check('Other connector records remain exact', JSON.stringify(current.connectors.filter((n) => n.id !== edge.id)) === JSON.stringify(original.connectors.filter((n) => n.id !== edge.id)))
    await screenshot('04-dissolved-container-detached-route'); await undo(); check('Dissolve is one exact Undo including endpoint ownership', equalSnapshot(await save(), baseline))
  })
  await scenario('locked-dissolve-refusal', async () => {
    for (const id of ['outer','leaf']) {
      await reset(); await openHierarchy(); await page.getByLabel(`Lock ${id}`,{exact:true}).click(); await page.getByLabel('Close board hierarchy',{exact:true}).click(); const baseline = await save()
      await contextAction('outer','Dissolve'); check(`Dissolve refuses ${id === 'outer' ? 'own' : 'descendant'} lock with complete graph unchanged`, equalSnapshot(await save(), baseline))
    }
  })
} catch (error) { report.startupFailure = { message:error.message, stack:error.stack }; await screenshot('failure-startup') }
finally {
  report.sourceHashesAtEnd = {}; for (const name of Object.keys(report.sourceHashes)) report.sourceHashesAtEnd[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
  report.sourceChangedDuringRun = JSON.stringify(report.sourceHashes) !== JSON.stringify(report.sourceHashesAtEnd)
  report.passed = !report.startupFailure && report.scenarios.length > 0 && report.scenarios.every((s) => s.passed) && report.browserErrors.length === 0 && !report.sourceChangedDuringRun
  await writeFile(resolve(artifacts,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,passedChecks:report.checks.filter((c)=>c.passed).length,scenarios:report.scenarios.map(({name,passed,error})=>({name,passed,error})),browserErrors:report.browserErrors,sourceChangedDuringRun:report.sourceChangedDuringRun,report:resolve(artifacts,'report.json')},null,2))
  await context.close(); await browser.close(); if (!report.passed) process.exitCode = 1
}

