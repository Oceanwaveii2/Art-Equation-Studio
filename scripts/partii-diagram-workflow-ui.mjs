import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import ts from 'typescript'

// Real application interactions, isolated in a memory-only Tauri backend. No
// production projects, clipboard, native workspace or existing EXEs are written.
const compile = async name => ts.transpileModule(await readFile(name,'utf8'),{fileName:name,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const load = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const {createBlankProject}=await load(await compile('src/model/project.ts'))
const core=await load(await compile('src/board/diagramStructureCore.ts'))
const fixture=createBlankProject('Part II diagram workflow memory QA')
fixture.id='partii-diagram-workflow-memory';fixture.assets=[]
const starter=core.createMindMapTemplate('fixture',{x:140,y:120});assert(starter.ok)
fixture.boards=[{id:'diagram-root',title:'Diagram board',viewport:{x:0,y:0,scale:1},nodes:[...starter.value.nodes,{id:'owner',kind:'group',containerRole:'frame',title:'Locked owner',x:20,y:900,width:480,height:240,locked:true},{id:'owned',kind:'note',groupId:'owner',title:'Inherited item',x:50,y:960,width:180,height:90}],connectors:starter.value.connectors}]
const baseUrl=process.env.UI_TEST_BASE_URL||'http://127.0.0.1:5174/?catalog=demo'
const out=resolve('output/playwright/partii-diagram-workflow-2026-09-30');await mkdir(out,{recursive:true})
const names=['src/App.tsx','src/App.css','src/model/project.ts','src/board/diagramWorkflow.ts','src/board/DiagramStructurePanel.tsx','src/board/diagramStructureCore.ts','src/board/boardMutationSafety.ts','src/board/vectorSvg.ts','src/board/columns.ts','src/board/nativeCommandJournal.ts']
const hashes={};for(const name of names)hashes[name]=createHash('sha256').update(await readFile(name)).digest('hex')
const report={generatedAt:new Date().toISOString(),passed:false,sourceHashes:hashes,checks:[],browserErrors:[],screenshots:[],limits:'Actual integrated React keyboard/button/focus actions and memory-only save/reload. No native Vello pixels, disk/restart, physical screen reader or hardware input claim.'}
const check=(name,passed,detail)=>{report.checks.push({name,passed:Boolean(passed),detail});assert(passed,`${name}: ${JSON.stringify(detail)}`)}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true})
const context=await browser.newContext({viewport:{width:1600,height:1100}});const page=await context.newPage();page.on('pageerror',error=>report.browserErrors.push(error.message))
await page.addInitScript(initial=>{
  if(!['http:','https:'].includes(location.protocol))return
  const backend={project:JSON.parse(sessionStorage.getItem('workflow-project')||'null')||structuredClone(initial),calls:[]};window.__workflowBackend=backend
  localStorage.setItem('art-equation.navigator','0');localStorage.setItem('art-equation.inspector','0');localStorage.setItem('art-equation.canvas-tools','1');localStorage.setItem('art-equation.view-mode','canvas')
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}}
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},convertFileSrc:value=>value,invoke:async(command,args={})=>{
    backend.calls.push({command,args:structuredClone(args)})
    if(command==='workspace_info')return{root:'MEMORY-ONLY-NO-DISK',workspaceId:'isolated-diagram',readOnly:false,lockOwned:true}
    if(command==='list_projects')return[{id:backend.project.id,title:backend.project.title,updatedAt:backend.project.updatedAt,boardCount:backend.project.boards.length,assetCount:0,status:backend.project.status}]
    if(command==='load_json')return structuredClone(args.relativePath==='settings.json'?{schemaVersion:5,theme:'dark',viewMode:'canvas',activeProjectId:initial.id,projectNavigation:{[initial.id]:{activeBoardId:'diagram-root',activeDocumentId:initial.documents[0].id,activeNavigatorItem:'board:diagram-root',viewMode:'canvas'}}}:backend.project)
    if(command==='save_json'){if(args.relativePath.endsWith('/project.json')){backend.project=structuredClone(args.value);sessionStorage.setItem('workflow-project',JSON.stringify(backend.project))}return}
    if(['ensure_managed_board_folders','ensure_project_workspace','plugin:event|unlisten'].includes(command))return
    if(['list_project_trash','list_trashed_projects','audit_assets'].includes(command))return[]
    if(['plugin:event|listen','plugin:window|scale_factor'].includes(command))return 1
    if(command==='plugin:window|inner_size')return{width:innerWidth,height:innerHeight}
    if(command==='mini_bridge_launch')return null
    throw new Error(`Workflow mock refuses ${command}`)
  }}
},fixture)
const panel=page.getByRole('complementary',{name:'Diagram structure',exact:true})
const settled=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
const byId=id=>page.locator(`.board-node[data-node-id="${id}"]`)
const board=project=>project.boards.find(entry=>entry.id==='diagram-root')
const semantic=project=>JSON.stringify({boards:project.boards,templates:project.diagramTemplates||[]})
async function save(){const before=await page.evaluate(()=>window.__workflowBackend.calls.length);await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(before=>window.__workflowBackend.calls.slice(before).some(call=>call.command==='save_json'&&call.args.relativePath.endsWith('/project.json')),before);return page.evaluate(()=>structuredClone(window.__workflowBackend.project))}
async function openPanel(){await page.getByLabel('More canvas tools',{exact:true}).click();await page.getByLabel('Show diagram structure',{exact:true}).click();await panel.waitFor();await settled()}
async function select(title){await panel.getByLabel(`Select diagram object ${title}`,{exact:true}).click();await settled()}
async function undo(){await page.getByLabel('Undo board change',{exact:true}).click();await settled()}
async function redo(){await page.getByLabel('Redo board change',{exact:true}).click();await settled()}
async function shot(name){await page.screenshot({path:resolve(out,`${name}.png`),fullPage:true});report.screenshots.push(`${name}.png`)}
try{
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'});const enter=page.getByRole('button',{name:'Enter now',exact:true});if(await enter.count())await enter.click()
  await byId('fixture:node:0').waitFor();await page.getByRole('button',{name:'Canvas',exact:true}).click();await openPanel()
  const baseline=await save();await select('Research')
  const label=panel.getByLabel('New diagram label',{exact:true});await label.fill('Entered child');await label.press('Enter');await settled()
  check('Entry keeps focus in the label field',await label.evaluate(node=>document.activeElement===node))
  const child=await save()
  const childNode=board(child).nodes.find(node=>node.title==='Entered child');check('Enter adds one selected child and one branch edge',childNode?.mindMap.parentId==='fixture:node:1'&&board(child).nodes.length===23&&board(child).connectors.length===20)
  await label.fill('Entered sibling');await label.press('Shift+Enter');await settled();const siblings=await save();const siblingNode=board(siblings).nodes.find(node=>node.title==='Entered sibling')
  check('Shift+Enter adds same-parent ordered sibling exactly once',siblingNode?.mindMap.parentId==='fixture:node:1'&&siblingNode.mindMap.order===4&&board(siblings).nodes.length===24&&board(siblings).connectors.length===21)
  await undo();check('One Undo removes only sibling command',semantic(await save())===semantic(child));await undo();check('Second Undo restores exact pre-entry graph',semantic(await save())===semantic(baseline))
  await redo();await redo();check('Two Redo steps restore exact child/sibling graph',semantic(await save())===semantic(siblings))
  await select('Build');check('Collapse fixture descendant has a real render surface before collapse',await byId('fixture:node:11').count()===1)
  await panel.getByRole('button',{name:'Collapse branch',exact:true}).click();const collapsed=await save()
  check('Collapse keeps all records and19original edge identities',board(collapsed).nodes.length===24&&board(collapsed).connectors.length===21&&board(collapsed).nodes.find(node=>node.id==='fixture:node:3').mindMap.collapsed)
  check('Collapse removes transitive branch DOM and hidden endpoint connectors',await byId('fixture:node:11').count()===0&&await page.locator('[data-connector-id="fixture:edge:11"]').count()===0)
  check('Collapsed descendant row disables own Show override',await panel.getByLabel('Show diagram object Inputs',{exact:true}).nth(2).isDisabled())
  await panel.getByRole('button',{name:'Expand branch',exact:true}).click();await settled();check('Expand restores branch render surface',await byId('fixture:node:11').count()===1)
  await select('Research');const beforeReparent=await save();await panel.getByLabel('Branch parent',{exact:true}).selectOption('fixture:node:2');await panel.getByRole('button',{name:'Reparent branch',exact:true}).click();const reparented=await save()
  check('Actual reparent preserves IDs labels and world coordinates',board(reparented).nodes.every(node=>{const old=board(beforeReparent).nodes.find(entry=>entry.id===node.id);return old.title===node.title&&old.x===node.x&&old.y===node.y})&&board(reparented).nodes.find(node=>node.id==='fixture:node:1').mindMap.parentId==='fixture:node:2')
  check('Reparent updates only existing branch connector endpoint',board(reparented).connectors.find(edge=>edge.id==='fixture:edge:1').sourceId==='fixture:node:2')
  await undo();check('Reparent Undo restores exact source graph',semantic(await save())===semantic(beforeReparent))
  await select('Inherited item');check('Inherited lock disables selected label and both own-state overrides',await panel.getByLabel('Object label',{exact:true}).isDisabled()&&await panel.getByLabel('Show diagram object Inherited item',{exact:true}).isDisabled()&&await panel.getByLabel('Lock diagram object Inherited item',{exact:true}).isDisabled())
  const locked=await save();await label.focus();await label.press('ArrowRight');await label.press('Tab');check('Panel Tab uses normal focus traversal',await panel.evaluate(node=>node.contains(document.activeElement))&&!(await label.evaluate(node=>document.activeElement===node)))
  check('Panel arrow key does not move canvas selection',semantic(await save())===semantic(locked))
  await panel.getByRole('button',{name:'Add process map',exact:true}).click();const process=await save();const added=board(process).nodes.filter(node=>node.diagramShape)
  check('Integrated process starter creates10editable captioned nodes and9edges',added.length===10&&board(process).connectors.length===30&&added.every(node=>node.vectorPath?.closed&&node.title===node.body))
  check('Process caption is actual shared SVG text',await byId(added[0].id).locator('text').allTextContents().then(values=>values.includes('Start')))
  await panel.getByLabel('Template name',{exact:true}).fill('Local process');await panel.getByRole('button',{name:'Save selected diagram as template',exact:true}).click();const savedTemplate=await save()
  check('Template save adds one local library item with10objects9connections',savedTemplate.diagramTemplates?.length===1&&savedTemplate.diagramTemplates[0].nodes.length===10&&savedTemplate.diagramTemplates[0].connectors.length===9)
  await undo();const undoneTemplate=await save();check('Template save Undo removes library item and preserves board exactly',!undoneTemplate.diagramTemplates?.length&&JSON.stringify(undoneTemplate.boards)===JSON.stringify(process.boards))
  await redo();check('Template save Redo restores exact library and board',semantic(await save())===semantic(savedTemplate))
  await panel.getByLabel('Insert diagram template Local process',{exact:true}).click();const once=await save();await panel.getByLabel('Insert diagram template Local process',{exact:true}).click();const twice=await save()
  const paths=board(twice).nodes.filter(node=>node.diagramShape);check('Two template insertions use30unique path IDs and27attached internal edges',paths.length===30&&new Set(paths.map(node=>node.id)).size===30&&board(twice).connectors.filter(edge=>paths.some(node=>node.id===edge.sourceId)&&paths.some(node=>node.id===edge.targetId)).length===27)
  await undo();check('One insert Undo removes only latest10node instance',semantic(await save())===semantic(once));await redo();check('Insert Redo preserves original fresh IDs exactly',semantic(await save())===semantic(twice))
  await shot('01-wide-diagram-templates')
  await panel.getByLabel('Close diagram structure',{exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});await byId('fixture:node:0').waitFor();await openPanel();check('Memory save/reload retains complete board and local template IDs',semantic(await save())===semantic(twice))
  await panel.getByLabel('New diagram label',{exact:true}).fill('Production workflow');await panel.getByRole('button',{name:'Add named swimlane',exact:true}).click();const swimlane=await save()
  const swimRoot=board(swimlane).nodes.find(node=>node.diagramRole==='swimlane'),lanes=board(swimlane).nodes.filter(node=>node.diagramRole==='lane')
  check('Named swimlane creates ordinary unclipped owned lane frames',swimRoot?.title==='Production workflow'&&lanes.length===3&&lanes.every(node=>node.groupId===swimRoot.id&&node.containerRole==='frame'))
  check('Swimlane stays on same board without folder/portal creation',swimlane.boards.length===1&&!board(swimlane).nodes.some(node=>node.kind==='board-link'))
  await undo();check('Swimlane Undo restores exact precreate graph',semantic(await save())===semantic(twice))
  await page.setViewportSize({width:900,height:700});await settled();await panel.getByLabel('New diagram label',{exact:true}).focus();check('Compact panel stays inside viewport without horizontal content overflow',await panel.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&node.scrollWidth<=node.clientWidth+1}))
  check('Compact keyboard focus has visible outline',await panel.getByLabel('New diagram label',{exact:true}).evaluate(node=>getComputedStyle(node).outlineStyle!=='none'))
  await shot('02-compact-diagram-focus');await page.keyboard.press('Escape');await settled();check('Escape closes nonmodal panel',await panel.count()===0)
  check('Close returns focus to persistent canvas tools opener',await page.getByLabel('More canvas tools',{exact:true}).evaluate(node=>document.activeElement===node))
  check('No browser exception occurred',report.browserErrors.length===0,report.browserErrors)
  const changed=[];for(const [name,hash]of Object.entries(hashes))if(hash!==createHash('sha256').update(await readFile(name)).digest('hex'))changed.push(name)
  check('Complete source manifest is unchanged across run',changed.length===0,changed);report.sourcesUnchanged=changed.length===0;report.passed=true
}catch(error){report.error=error.stack;report.panelSnapshot=await panel.count()?await panel.ariaSnapshot():null;await shot('failure-state')}finally{await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,report:resolve(out,'report.json')},null,2));if(!report.passed)process.exitCode=1
