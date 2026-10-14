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
const artifacts = resolve('output/playwright/partii-subtree-continuation')
await mkdir(artifacts, { recursive: true })
const report = { passed: false, generatedAt: new Date().toISOString(), baseUrl, sourceHashes: {}, checks: [], scenarios: [], screenshots: [], browserErrors: [], limitation: 'Actual headless Edge React pointer/keyboard/menu and memory save/reload. No production disk, native Vello pixel, Windows physical DPI, stylus or real clipboard claim.' }
for (const name of ['src/App.tsx','src/App.css','src/model/project.ts']) report.sourceHashes[name] = createHash('sha256').update(await readFile(resolve(name))).digest('hex')
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
function clonesMatch(source,after,verb){
  const original=board(source),current=board(after),oldIds=new Set(original.nodes.map((n)=>n.id)),added=current.nodes.filter((n)=>!oldIds.has(n.id))
  check(`${verb}: all seven transitive members clone once; no outsider`,added.length===descendants.length,added.map((n)=>({id:n.id,title:n.title})))
  const map=new Map();for(const id of descendants){const old=original.nodes.find((n)=>n.id===id),matches=added.filter((n)=>n.title===old.title||n.title===`${old.title} copy`);check(`${verb}: unique fresh identity for ${id}`,matches.length===1&&!oldIds.has(matches[0]?.id));map.set(id,matches[0])}
  const delta={x:map.get('outer').x-original.nodes.find((n)=>n.id==='outer').x,y:map.get('outer').y-original.nodes.find((n)=>n.id==='outer').y}
  for(const id of descendants){const old=original.nodes.find((n)=>n.id===id),next=map.get(id);check(`${verb}: ${id} owner is remapped exclusively`,next.groupId===(old.groupId?map.get(old.groupId)?.id:undefined)&&next.parentColumnId===(old.parentColumnId?map.get(old.parentColumnId)?.id:undefined)&&!(next.groupId&&next.parentColumnId));check(`${verb}: ${id} world geometry moves as one subtree`,next.x===old.x+delta.x&&next.y===old.y+delta.y&&next.width===old.width&&next.height===old.height,{old,next,delta})}
  check(`${verb}: source objects and all original edges untouched`,JSON.stringify(current.nodes.filter((n)=>oldIds.has(n.id)))===JSON.stringify(original.nodes)&&JSON.stringify(current.connectors.filter((n)=>original.connectors.some((old)=>old.id===n.id)))===JSON.stringify(original.connectors))
  const addedEdges=current.connectors.filter((n)=>!original.connectors.some((old)=>old.id===n.id))
  check(`${verb}: exactly attached internal and attached/free edges clone; outsiders excluded`,addedEdges.length===2,addedEdges)
  for(const old of original.connectors.filter((edge)=>edge.id.startsWith('internal'))){const next=addedEdges.find((edge)=>edge.label===old.label);check(`${verb}: ${old.id} endpoint IDs and free coordinates remap`,next?.sourceId===(old.sourceId?map.get(old.sourceId)?.id:undefined)&&next?.targetId===(old.targetId?map.get(old.targetId)?.id:undefined)&&JSON.stringify(next?.targetPoint)===JSON.stringify(old.targetPoint?{x:old.targetPoint.x+delta.x,y:old.targetPoint.y+delta.y}:undefined));check(`${verb}: ${old.id} manual bends translate and style/label metadata preserve`,JSON.stringify(next?.bendPoints)===JSON.stringify(old.bendPoints?.map((p)=>({...p,x:p.x+delta.x,y:p.y+delta.y})))&&JSON.stringify(next?.labelPosition)===JSON.stringify(old.labelPosition)&&next?.linePattern===old.linePattern&&next?.relationshipStyle===old.relationshipStyle&&next?.sourcePortMode===old.sourcePortMode&&next?.startArrow===old.startArrow&&next?.endArrow===old.endArrow)}
  const portal=map.get('owning-portal');check(`${verb}: cloned owning portal is only a shortcut to untouched child`,portal.boardLinkRole==='shortcut'&&!portal.boardPortal&&portal.targetBoardId==='owned-child'&&after.boards.length===source.boards.length&&JSON.stringify(after.boards.find((b)=>b.id==='owned-child'))===JSON.stringify(source.boards.find((b)=>b.id==='owned-child')))
  check(`${verb}: source image data and reversible framing remain intact`,map.get('column-image').body===image&&JSON.stringify(map.get('column-image').imageTransform)===JSON.stringify(original.nodes.find((n)=>n.id==='column-image').imageTransform))
  return {map,delta}
}
async function scenario(name,run){const first=report.checks.length;try{await run();report.scenarios.push({name,passed:true,checks:report.checks.length-first})}catch(error){report.scenarios.push({name,passed:false,error:error.message,stack:error.stack});await screenshot(`failure-${name}`)}}
try{
  await boot()
  await scenario('copy-and-duplicate',async()=>{
    const baseline=await save(),clip=await copy('outer')
    check('clipboard contains exactly transitive group/column descendants',JSON.stringify(clip.nodes.map((n)=>n.id).sort())===JSON.stringify([...descendants].sort()),clip.nodes.map((n)=>n.id))
    check('clipboard excludes external and completely unowned free links',JSON.stringify(clip.connectors.map((n)=>n.id).sort())==='["internal-free","internal-manual"]')
    check('advanced source connector metadata survives initial load',JSON.stringify(clip.connectors.find((n)=>n.id==='internal-manual')?.bendPoints)===JSON.stringify(root.connectors[0].bendPoints)&&clip.connectors.find((n)=>n.id==='internal-manual')?.labelPosition?.note==='preserve')
    await screenshot('01-selected-transitive-source')
    await page.keyboard.press('Control+d');await settled();const duplicated=await save();clonesMatch(baseline,duplicated,'Duplicate');await screenshot('02-nested-duplicate')
    await undo();const restored=await save();check('Duplicate Undo restores exact nodes, edges, child content in one step',JSON.stringify(semantic(restored))===JSON.stringify(semantic(baseline)))
  })
  await scenario('paste-and-reload',async()=>{
    const baseline=await reset();await copy('outer');await page.locator('.canvas-stage').focus();await page.keyboard.press('Control+v');await settled();const pasted=await save();clonesMatch(baseline,pasted,'Paste');await screenshot('03-transitive-paste')
    await page.reload({waitUntil:'domcontentloaded'});const enter=page.getByRole('button',{name:'Enter now',exact:true});if(await enter.count())await enter.click();await byId('outer').waitFor();await settled();const reopened=await save();check('Saved pasted subtree survives full React reload with exact metadata',JSON.stringify(semantic(reopened))===JSON.stringify(semantic(pasted)))
    const undoBaseline=await reset()
    await page.evaluate(()=>{window.__pasteHistoryAudit=[];for(const type of ['paste','click'])document.addEventListener(type,(event)=>{if(type==='click'&&event.target?.closest('button')?.getAttribute('aria-label')!=='Undo board change')return;window.__pasteHistoryAudit.push({type,time:performance.now(),nodeIds:[...document.querySelectorAll('.board-node[data-node-id]')].map((node)=>node.getAttribute('data-node-id'))})},true)})
    await copy('outer');await page.locator('.canvas-stage').focus();await page.keyboard.press('Control+v');await settled()
    // Native browser clipboard dispatch can outlive two RAFs. Confirm the actual
    // pasted DOM committed before Undo; an earlier Undo must not race that event.
    await page.waitForFunction((count)=>document.querySelectorAll('.board-node[data-node-id]').length===count,board(undoBaseline).nodes.length+descendants.length)
    const pastedBeforeUndo=await save(),beforeUndo={...(await page.evaluate(()=>({domIds:[...document.querySelectorAll('.board-node[data-node-id]')].map((node)=>node.getAttribute('data-node-id')).sort(),events:structuredClone(window.__pasteHistoryAudit)}))),board:board(pastedBeforeUndo)}
    await undo();const undone=await save(),events=await page.evaluate(()=>structuredClone(window.__pasteHistoryAudit))
    report.pasteUndoAudit={earlierBaseline:semantic(baseline),sameResetBaseline:semantic(undoBaseline),beforeUndo,afterUndo:semantic(undone),events}
    check('Paste Undo restores exact source in one command',JSON.stringify(semantic(undone))===JSON.stringify(semantic(baseline)),report.pasteUndoAudit)
  })
  await scenario('keyboard-subtree-nudge',async()=>{
    const baseline=await reset();await choose('outer');await page.locator('.canvas-stage').focus();await page.keyboard.press('ArrowRight');await settled();const after=board(await save()),before=board(baseline)
    check('Keyboard group nudge moves all descendants together',descendants.every((id)=>{const a=after.nodes.find((n)=>n.id===id),b=before.nodes.find((n)=>n.id===id);return a.x===b.x+1&&a.y===b.y}),after.nodes.map((n)=>({id:n.id,x:n.x,y:n.y})))
    check('Keyboard subtree nudge translates internal manual route but leaves boundary route fixed',JSON.stringify(after.connectors.find((n)=>n.id==='internal-manual').bendPoints)===JSON.stringify(before.connectors.find((n)=>n.id==='internal-manual').bendPoints.map((p)=>({...p,x:p.x+1})))&&JSON.stringify(after.connectors.find((n)=>n.id==='external').bendPoints)===JSON.stringify(before.connectors.find((n)=>n.id==='external').bendPoints))
    await undo();check('Keyboard subtree nudge Undo restores all geometry and routes',JSON.stringify(semantic(await save()))===JSON.stringify(semantic(baseline)))
  })
  await scenario('pointer-subtree-routes',async()=>{
    const baseline=await reset(),point=await choose('outer');await page.keyboard.down('Alt');await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+40,point.y+20,{steps:8});await page.mouse.up();await page.keyboard.up('Alt');await settled();const after=board(await save()),before=board(baseline)
    check('Pointer container drag moves every descendant exactly once',descendants.every((id)=>{const a=after.nodes.find((n)=>n.id===id),b=before.nodes.find((n)=>n.id===id);return a.x===b.x+40&&a.y===b.y+20}),after.nodes.map(({id,x,y})=>({id,x,y})))
    check('Pointer cluster drag translates internal manual routes/free end but not external waypoints',JSON.stringify(after.connectors.find((n)=>n.id==='internal-manual').bendPoints)===JSON.stringify(before.connectors.find((n)=>n.id==='internal-manual').bendPoints.map((p)=>({...p,x:p.x+40,y:p.y+20})))&&JSON.stringify(after.connectors.find((n)=>n.id==='internal-free').targetPoint)===JSON.stringify({x:420,y:525})&&JSON.stringify(after.connectors.find((n)=>n.id==='external').bendPoints)===JSON.stringify(before.connectors.find((n)=>n.id==='external').bendPoints),after.connectors)
    await screenshot('04-pointer-container-and-routes');await undo();check('Pointer cluster Undo restores nodes and routes in one command',JSON.stringify(semantic(await save()))===JSON.stringify(semantic(baseline)))
    const cancelPoint=await choose('outer');await page.keyboard.down('Alt');await page.mouse.move(cancelPoint.x,cancelPoint.y);await page.mouse.down();await page.mouse.move(cancelPoint.x+30,cancelPoint.y+30,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.up('Alt');await settled();check('Escape cancels complete subtree and connector preview without persistence',JSON.stringify(semantic(await save()))===JSON.stringify(semantic(baseline)))
  })
  await scenario('group-reparent-exclusive-owner',async()=>{
    const baseline=await reset();await choose('column-image');await choose('outside',true);check('Normal additive clicks select two eligible objects',await page.locator('.board-node.selected').count()===2);await page.getByLabel('More canvas tools',{exact:true}).click();await page.getByLabel('Group or frame',{exact:true}).click();await settled();const after=board(await save()),before=board(baseline),groups=after.nodes.filter((n)=>!before.nodes.some((old)=>old.id===n.id)&&n.kind==='group');check('Group action creates one freeform group',groups.length===1)
    const moved=after.nodes.find((n)=>n.id==='column-image'),original=before.nodes.find((n)=>n.id==='column-image');check('Grouping a column child clears column ownership/order while preserving world frame',moved.groupId===groups[0].id&&!moved.parentColumnId&&moved.columnOrder===undefined&&moved.x===original.x&&moved.y===original.y&&moved.width===original.width&&moved.height===original.height,moved)
    check('Grouped outsider shares the exclusive new owner',after.nodes.find((n)=>n.id==='outside').groupId===groups[0].id);await undo();check('Grouping Undo restores exact prior column ownership and frame',JSON.stringify(semantic(await save()))===JSON.stringify(semantic(baseline)))
  })
  await scenario('malformed-clipboard',async()=>{
    const baseline=await reset();await copy('outer');const originalClip=await page.evaluate(()=>JSON.parse(localStorage.getItem('art-equation-board-clipboard')))
    for(const [name,clip] of [['duplicate IDs',{...originalClip,nodes:[originalClip.nodes[0],originalClip.nodes[0]]}],['invalid geometry',{...originalClip,nodes:[{...originalClip.nodes[0],x:null}]}]]){await page.evaluate((clip)=>localStorage.setItem('art-equation-board-clipboard',JSON.stringify(clip)),clip);await page.locator('.canvas-stage').focus();await page.keyboard.press('Control+v');await settled();check(`Malformed ${name} clipboard is rejected atomically`,JSON.stringify(semantic(await save()))===JSON.stringify(semantic(baseline)))}
  })
  await scenario('mixed-selection-nudge',async()=>{
    const baseline=await reset();await choose('outer');await choose('leaf',true);await page.locator('.canvas-stage').focus();await page.keyboard.press('Shift+ArrowDown');await settled();const before=board(baseline),after=board(await save());check('Overlapping parent and child selection moves descendants once, not twice',descendants.every((id)=>{const a=after.nodes.find((n)=>n.id===id),b=before.nodes.find((n)=>n.id===id);return a.x===b.x&&a.y===b.y+10}),after.nodes.map(({id,x,y})=>({id,x,y})));await undo();check('Mixed parent-child nudge Undo is atomic',JSON.stringify(semantic(await save()))===JSON.stringify(semantic(baseline)))
    await choose('outer');await choose('outside',true);await page.locator('.canvas-stage').focus();await page.keyboard.press('ArrowRight');await settled();const union=board(await save());check('Explicit selection of both boundary endpoints translates that manual route',JSON.stringify(union.connectors.find((n)=>n.id==='external').bendPoints)===JSON.stringify(before.connectors.find((n)=>n.id==='external').bendPoints.map((p)=>({...p,x:p.x+1}))))
  })
  await scenario('locked-keyboard',async()=>{
    await reset();await openHierarchy();await page.getByLabel('Lock outer',{exact:true}).click();await page.getByLabel('Close board hierarchy',{exact:true}).click();const locked=await save();await choose('leaf');await page.locator('.canvas-stage').focus();await page.keyboard.press('ArrowRight');await settled();const after = await save();check('Keyboard nudge cannot modify descendant of locked ancestor',JSON.stringify(semantic(after))===JSON.stringify(semantic(locked)),{before:geometry(locked),after:geometry(after)})
    await choose('outer');await page.locator('.canvas-stage').focus();await page.keyboard.press('Shift+ArrowDown');await settled();check('Keyboard nudge cannot modify locked container or its descendants',JSON.stringify(semantic(await save()))===JSON.stringify(semantic(locked)))
  })
  await scenario('locked-descendant-keyboard',async()=>{
    await reset();await openHierarchy();await page.getByLabel('Lock leaf',{exact:true}).click();await page.getByLabel('Close board hierarchy',{exact:true}).click();const locked=await save();await choose('outer');await page.locator('.canvas-stage').focus();await page.keyboard.press('ArrowRight');await settled();const after = await save();check('Keyboard parent nudge fails atomically when descendant is locked',JSON.stringify(semantic(after))===JSON.stringify(semantic(locked)),{before:geometry(locked),after:geometry(after)})
    await choose('outside',true);await page.locator('.canvas-stage').focus();await page.keyboard.press('ArrowDown');await settled();check('Mixed unlocked outsider and locked-descendant container nudge fails atomically',JSON.stringify(semantic(await save()))===JSON.stringify(semantic(locked)))
  })
  await scenario('locked-group-reparent',async()=>{
    for(const id of ['leaf','outer']){await reset();await openHierarchy();await page.getByLabel(`Lock ${id}`,{exact:true}).click();await page.getByLabel('Close board hierarchy',{exact:true}).click();const locked=await save();await choose('leaf');await choose('outside',true);await page.getByLabel('More canvas tools',{exact:true}).click();await page.getByLabel('Group or frame',{exact:true}).click();await settled();check(`Group reparent refuses mixed selection with ${id==='leaf'?'own lock':'locked ancestor'} without ownership changes`,JSON.stringify(semantic(await save()))===JSON.stringify(semantic(locked)))}
  })
}catch(error){report.startupFailure={message:error.message,stack:error.stack};await screenshot('failure-startup')}
finally{report.sourceHashesAtEnd={};for(const name of Object.keys(report.sourceHashes))report.sourceHashesAtEnd[name]=createHash('sha256').update(await readFile(resolve(name))).digest('hex');report.sourceChangedDuringRun=JSON.stringify(report.sourceHashes)!==JSON.stringify(report.sourceHashesAtEnd);report.passed=report.scenarios.length>0&&report.scenarios.every((s)=>s.passed)&&report.browserErrors.length===0&&!report.sourceChangedDuringRun;await writeFile(resolve(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,passedChecks:report.checks.filter((c)=>c.passed).length,scenarios:report.scenarios.map(({name,passed,error})=>({name,passed,error})),browserErrors:report.browserErrors,sourceChangedDuringRun:report.sourceChangedDuringRun,report:resolve(artifacts,'report.json')},null,2));await context.close();await browser.close();if(!report.passed)process.exitCode=1}
