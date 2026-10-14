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
const vectorUrl = 'data:text/javascript;base64,' + Buffer.from(await compile('../src/model/vector.ts')).toString('base64')
const { layoutBoardColumns } = await load((await compile('../src/board/columns.ts')).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../model/vector'", `from '${vectorUrl}'`))
const baseUrl = process.env.UI_TEST_BASE_URL || 'http://127.0.0.1:5174/?catalog=demo'
const artifacts = resolve('output/playwright/partii-organization-resume')
await mkdir(artifacts, { recursive: true })
const report = { passed: false, generatedAt: new Date().toISOString(), baseUrl, sourceHashes: {}, checks: [], scenarios: [], screenshots: [], browserErrors: [], limitation: 'Actual headless Edge React pointer/keyboard/menu and memory save/reload. No production disk, native Vello pixel, Windows physical DPI, stylus or real clipboard claim.' }
for (const name of ['src/App.tsx','src/App.css','src/model/project.ts','src/board/boardTransfer.ts','src/board/BoardTransferDialog.tsx','src/board/boardMutationSafety.ts','src/board/columns.ts','src/search/ProjectSearch.tsx','src/search/projectSearchModel.ts']) report.sourceHashes[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
report.browserVersion = browser.version()
report.nodeVersion = process.version
report.platform = process.platform
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } })
const page = await context.newPage()
page.on('pageerror', (error) => report.browserErrors.push(error.message))
const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 50; c.height = 80; const ctx = c.getContext('2d'); ctx.fillStyle = '#129abc'; ctx.fillRect(0,0,50,80); return c.toDataURL('image/png') })
const node = (id, kind, x,y,width,height,extra = {}) => ({ id, title: id, kind, x,y,width,height, color: '#465c70', strokeColor: '#94aeca', opacity: 1, ...extra })
const fixture = createBlankProject('Part II subtree continuation isolated QA')
fixture.id = 'partii-subtree-continuation-memory'
fixture.assets = []
const connector = (id, extra) => ({ id, sourcePort:'right', targetPort:'left', style:'elbow', color:'#ee942f', width:2, dashed:false, startArrow:true, endArrow:true, animated:false, label:id, ...extra })
const root = layoutBoardColumns({ id:'subtree-root', title:'Subtree root', linkedFolderPath:`projects/${fixture.id}/boards/subtree-root`, viewport:{x:0,y:0,scale:1}, backgroundColor:'#151a20', backgroundFollowsTheme:false, gridVisible:true,
  nodes:[
    node('outer','group',150,70,730,730,{containerRole:'group'}),
    node('inner','group',175,145,270,350,{groupId:'outer',containerRole:'frame'}),
    node('deep','group',200,210,205,230,{groupId:'inner',containerRole:'group'}),
    node('leaf','shape',235,280,120,100,{groupId:'deep',shapeType:'rectangle',strokeWidth:3,rotation:15}),
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

fixture.boards.push({id:'organization-destination',title:'Organization destination',nodes:[],connectors:[],viewport:{x:0,y:0,scale:1}})
fixture.boards.find(b=>b.id==='owned-child').nodes.push(node('grandchild-portal','board-link',340,110,132,132,{targetBoardId:'nested-search',boardLinkRole:'child',boardPortal:true}))
fixture.boards.push({id:'nested-search',title:'Nested search',parentBoardId:'owned-child',nodes:[
  node('nested-note','note',1900,1700,180,130,{title:'Cedar review',body:'Unique cedar planning text'}),
  node('nested-image','image',2200,1950,120,180,{title:'Cedar artwork',body:image,imagePresentation:'artwork'})
],connectors:[],viewport:{x:23,y:-31,scale:.75}})

await page.addInitScript((initial) => {
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

async function scenario(name,run){const first=report.checks.length;try{await run();report.scenarios.push({name,passed:true,checks:report.checks.length-first})}catch(error){report.scenarios.push({name,passed:false,error:error.message,stack:error.stack});await screenshot('failure-'+name)}}
async function openMove(){await page.locator('.canvas-stage').focus();await page.keyboard.press('Control+Shift+m');await page.getByRole('dialog',{name:'Move to board',exact:true}).waitFor();await settled()}
const destination=p=>p.boards.find(b=>b.id==='organization-destination')
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
async function redo(){await page.getByLabel('Redo board change',{exact:true}).click();await settled()}
async function search(query){const input=page.getByRole('textbox',{name:'Search project',exact:true});await input.fill(query);await page.getByRole('region',{name:'Project search results',exact:true}).waitFor();return input}
try{
 await boot()
 await scenario('move-keyboard-cancel-focus',async()=>{
  const before=await save();await choose('outer');await openMove()
  check('Keyboard opens named modal with destination select focused',await page.getByLabel('Destination board',{exact:true}).evaluate(e=>e===document.activeElement))
  const trapped=await page.getByRole('dialog',{name:'Move to board',exact:true}).evaluate(el=>el.parentElement.closest('.studio-shell')!==null)
  check('Move modal inherits app theme',trapped)
  for(let i=0;i<6;i++){await page.keyboard.press('Tab');check('Tab remains inside transfer modal '+i,await page.getByRole('dialog',{name:'Move to board',exact:true}).evaluate(e=>e.contains(document.activeElement)))}
  await page.keyboard.press('Escape');await settled()
  check('Keyboard Escape returns focus to opening canvas stage',await page.locator('.canvas-stage').evaluate(e=>e===document.activeElement))
  check('Escape cancels with exact board graph and assets',equal(semantic(await save()),semantic(before)))
  await page.getByLabel('Move selected objects to board',{exact:true}).click();await page.getByRole('dialog',{name:'Move to board',exact:true}).waitFor();await page.keyboard.press('Escape');await settled()
  check('Button Escape returns focus to persistent move button',await page.getByLabel('Move selected objects to board',{exact:true}).evaluate(e=>e===document.activeElement))
 })
 await scenario('move-graph-undo-redo-reload',async()=>{
  const before=await reset();await choose('outer');await openMove();await page.getByLabel('Destination board',{exact:true}).selectOption('organization-destination');await page.getByRole('button',{name:'Move objects',exact:true}).click();await settled()
  const moved=await save(),a=board(before),b=destination(moved)
  check('All seven transitive members move once with same identities',equal(b.nodes.map(n=>n.id).sort(),[...descendants].sort()))
  check('Members preserve geometry and all source metadata',equal(b.nodes,a.nodes.filter(n=>descendants.includes(n.id))))
  check('Source retains only selected subtree outsiders',equal(board(moved).nodes,a.nodes.filter(n=>!descendants.includes(n.id))))
  check('Internal attached and attached-free connectors move unchanged',equal(b.connectors,a.connectors.filter(e=>e.id.startsWith('internal'))))
  const boundary=board(moved).connectors.find(e=>e.id==='external')
  check('Boundary edge retains source identity, route and outsider; moved endpoint detached',boundary.id==='external'&&!boundary.sourceId&&boundary.targetId==='outside'&&Number.isFinite(boundary.sourcePoint?.x)&&equal(boundary.bendPoints,a.connectors.find(e=>e.id==='external').bendPoints))
  check('Owned child changes parent; child content and folder links survive',moved.boards.find(b=>b.id==='owned-child').parentBoardId==='organization-destination'&&equal(moved.boards.find(b=>b.id==='owned-child').nodes,before.boards.find(b=>b.id==='owned-child').nodes)&&equal(moved.boards.map(b=>b.linkedFolderPath),before.boards.map(b=>b.linkedFolderPath)))
  check('Assets preserved without import, relocation or delete filesystem calls',equal(moved.assets,before.assets)&&!(await page.evaluate(()=>window.__subtreeBackend.calls)).some(c=>/move_|rename_|delete_|trash_|import_/.test(c.command)))
  await screenshot('01-graph-moved')
  await undo();check('One Undo restores entire graph, edges and parent metadata',equal(semantic(await save()),semantic(before)))
  await redo();check('One Redo restores graph transfer',equal(semantic(await save()),semantic(moved)))
  await page.reload({waitUntil:'domcontentloaded'});const enter=page.getByRole('button',{name:'Enter now',exact:true});if(await enter.count())await enter.click();await byId('outside').waitFor();await settled()
  check('Saved move survives full React reload',equal(semantic(await save()),semantic(moved)))
 })
 await scenario('descendant-cycle-refuses-atomically',async()=>{
  const before=await reset();await choose('outer');await openMove()
  for(const target of ['owned-child','nested-search']){
   await page.getByLabel('Destination board',{exact:true}).selectOption(target);await page.getByRole('button',{name:'Move objects',exact:true}).click();await settled()
   check('Cycle '+target+' leaves dialog open',await page.getByRole('dialog',{name:'Move to board',exact:true}).isVisible())
   // Modal intentionally disables the rest of the app; inspect the model already persisted before the refused command.
   await page.getByRole('button',{name:'Cancel',exact:true}).click();check('Cycle '+target+' publishes no graph change',equal(semantic(await save()),semantic(before)))
   if(target==='owned-child')await openMove()
  }
 })
 await scenario('nested-item-search-camera-history',async()=>{
  const before=await reset(),sourceViewport=board(before).viewport,nestedViewport=before.boards.find(b=>b.id==='nested-search').viewport
  const input=await search('Unique cedar planning');const region=page.getByRole('region',{name:'Project search results',exact:true})
  check('Nested search result names full board ancestry',await region.getByRole('button').first().evaluate(e=>e.textContent.includes('Subtree root / Owned child / Nested search')))
  check('Search results use region and ordinary buttons with no invalid listbox',await page.getByRole('listbox').count()===0&&await region.getByRole('button').count()===1)
  await input.press('ArrowDown');check('ArrowDown focuses exact search result',await region.getByRole('button').first().evaluate(e=>e===document.activeElement))
  await page.keyboard.press('Enter');await byId('nested-note').waitFor();await settled()
  check('Keyboard search opens exact item and selects it',await byId('nested-note').evaluate(e=>e.classList.contains('selected')))
  const frame=await byId('nested-note').boundingBox(),stage=await page.locator('.canvas-stage').boundingBox()
  check('Search reveals distant item within canvas',frame.x>=stage.x&&frame.y>=stage.y&&frame.x+frame.width<=stage.x+stage.width&&frame.y+frame.height<=stage.y+stage.height,{frame,stage})
  const focused=await save()
  check('Search does not mutate the board we left',equal(board(focused).viewport,sourceViewport)&&equal(board(focused).nodes,board(before).nodes))
  await page.getByLabel('More canvas tools',{exact:true}).click();await page.getByLabel('Previous zoom',{exact:true}).click();await settled()
  check('Previous zoom restores searched board prior viewport',equal((await save()).boards.find(b=>b.id==='nested-search').viewport,nestedViewport))
  const second=await search('Cedar artwork');await second.press('ArrowDown');await page.keyboard.press('Enter');await byId('nested-image').waitFor();await settled()
  check('Image search selects its exact nested placement',await byId('nested-image').evaluate(e=>e.classList.contains('selected')))
  await screenshot('02-nested-image-search')
 })
 await scenario('freeform-filter-and-search-escape',async()=>{
  await reset();await page.getByLabel('Toggle Appearance panel',{exact:true}).click();await page.getByLabel('Show freeform items',{exact:true}).click();await settled()
  const panel=page.getByRole('complementary',{name:'Freeform items',exact:true})
  check('Freeform opening closes overlapping Appearance controls',await page.getByRole('dialog',{name:'Appearance',exact:true}).count()===0)
  check('Freeform filter explains already placed items without inbox claims',(await panel.textContent()).includes('Items may already be deliberately placed.'))
  check('Freeform excludes transitive group and column members',await panel.locator('div > button').count()===1&&(await panel.locator('div > button').first().textContent()).includes('outside'))
  await page.getByLabel('Close freeform items',{exact:true}).click()
  const input=await search('leaf');await input.press('ArrowDown');await page.keyboard.press('Escape');await settled()
  check('Search Escape clears results and returns input focus',await input.inputValue()===''&&await input.evaluate(e=>e===document.activeElement)&&await page.getByRole('region',{name:'Project search results',exact:true}).count()===0)
 })
}catch(error){report.startupFailure={message:error.message,stack:error.stack};await screenshot('failure-startup')}
finally{
 report.sourceHashesAtEnd={};for(const name of Object.keys(report.sourceHashes))report.sourceHashesAtEnd[name]=createHash('sha256').update(await readFile(resolve(name))).digest('hex')
 report.sourceChangedDuringRun=!equal(report.sourceHashes,report.sourceHashesAtEnd)
 report.passed=report.scenarios.length===5&&report.scenarios.every(s=>s.passed)&&report.browserErrors.length===0&&!report.sourceChangedDuringRun
 await writeFile(resolve(artifacts,'report.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,passedChecks:report.checks.filter(c=>c.passed).length,scenarios:report.scenarios.map(({name,passed,error})=>({name,passed,error})),browserErrors:report.browserErrors,sourceChangedDuringRun:report.sourceChangedDuringRun,report:resolve(artifacts,'report.json')},null,2))
 await context.close();await browser.close();if(!report.passed)process.exitCode=1
}
