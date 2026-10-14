import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {chromium} from 'playwright-core'
import ts from 'typescript'

// Actual App workspace permission integration. Project backend is disposable
// memory. Forced callback fixtures separately exercise the existing parent guard;
// no production hooks, files, clipboard or native exports are written.
const source=await readFile('src/model/project.ts','utf8')
const code=ts.transpileModule(source,{fileName:'project.ts',compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {createBlankProject,DEFAULT_DOCUMENT_LAYOUT}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const fixture=createBlankProject('Readonly integration title');fixture.id='partii-readonly-integration-memory';fixture.assets=[]
fixture.questionnaire.summary='Original summary remains selectable.';fixture.questionnaire.deliverables='Original deliverables';fixture.questionnaire.tags='original';fixture.questionnaire.difficulty='Medium'
const richContent={type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:'Readonly production brief'}]},{type:'paragraph',content:[{type:'text',text:'Select this original production text without changing the model.'}]},{type:'image',attrs:{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1EAAAAASUVORK5CYII=',caption:'Original caption',alt:'Original caption',placement:'block'}},{type:'paragraph',content:[{type:'text',text:'End of original document.'}]}]}
fixture.documents.push({id:'readonly-rich',title:'Production notes',content:richContent,layout:{...DEFAULT_DOCUMENT_LAYOUT,theme:'paper',headerText:'Original header',footerText:'Original footer'}})
fixture.boards=[{id:'readonly-board',title:'Reference board',viewport:{x:0,y:0,scale:1},nodes:[],connectors:[]}]
const inputs=['src/App.tsx','src/App.css','src/model/project.ts','src/document/ProjectQuestionnaire.tsx','src/document/RichDocument.tsx']
const hashes={};for(const name of inputs)hashes[name]=createHash('sha256').update(await readFile(name)).digest('hex')
const out=resolve('output/playwright/partii-readonly-integration',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(out,{recursive:true})
const report={generatedAt:new Date().toISOString(),passed:false,sourceHashes:hashes,checks:[],browserErrors:[],screenshots:[],limits:'Actual App parent workspace.readOnly integration with isolated memory backend and real keyboard/selection actions. Separate forced existing parent callbacks and TipTap transactions verify permission boundaries. Does not certify real disk, native exports, screen readers or physical hardware.'}
const check=(name,passed,detail)=>{report.checks.push({name,passed:Boolean(passed),detail});assert(passed,`${name}: ${JSON.stringify(detail)}`)}
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true})
const context=await browser.newContext({viewport:{width:1600,height:1050}});const page=await context.newPage();page.on('pageerror',error=>report.browserErrors.push(error.message))
await page.addInitScript(initial=>{
  if(!['http:','https:'].includes(location.protocol))return
  const backend={project:structuredClone(initial),calls:[],prints:0};window.__readonlyBackend=backend;window.print=()=>{backend.prints++}
  localStorage.setItem('art-equation.navigator','1');localStorage.setItem('art-equation.inspector','0');localStorage.setItem('art-equation.view-mode','document')
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}}
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,unregisterCallback:()=>{},convertFileSrc:value=>value,invoke:async(command,args={})=>{
    backend.calls.push({command,args:structuredClone(args)})
    if(command==='workspace_info')return{root:'MEMORY-ONLY-READONLY',workspaceId:'readonly-fixture',readOnly:true,lockOwned:false}
    if(command==='list_projects')return[{id:backend.project.id,title:backend.project.title,updatedAt:backend.project.updatedAt,boardCount:1,assetCount:0,status:backend.project.status}]
    if(command==='load_json')return structuredClone(args.relativePath==='settings.json'?{schemaVersion:5,theme:'dark',viewMode:'document',activeProjectId:initial.id,projectNavigation:{[initial.id]:{activeBoardId:'readonly-board',activeDocumentId:'project-brief',activeNavigatorItem:'document:project-brief',viewMode:'document'}}}:backend.project)
    if(command==='save_json'){if(args.relativePath.endsWith('/project.json'))throw new Error('Read-only fixture rejects project writes');return}
    if(command==='list_system_fonts')return['Arial','Georgia']
    if(['ensure_managed_board_folders','ensure_project_workspace','plugin:event|unlisten'].includes(command))return
    if(['list_project_trash','list_trashed_projects','audit_assets'].includes(command))return[]
    if(['plugin:event|listen','plugin:window|scale_factor'].includes(command))return 1
    if(command==='plugin:window|inner_size')return{width:innerWidth,height:innerHeight}
    if(command==='mini_bridge_launch')return null
    throw new Error(`Read-only mock refuses ${command}`)
  }}
},fixture)
const settled=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
const questionnaire=page.getByRole('region',{name:'Project questionnaire',exact:true})
const qTitle=questionnaire.getByRole('textbox',{name:'Project title',exact:true}),qSummary=questionnaire.getByRole('textbox',{name:'What are we making?',exact:true})
const projectWrites=()=>page.evaluate(()=>window.__readonlyBackend.calls.filter(call=>call.command==='save_json'&&call.args.relativePath.endsWith('/project.json')))
const richSnapshot=()=>page.locator('.document-editor').evaluate(node=>node.editor.getJSON())
async function rich(){await page.locator('.tree-row').filter({hasText:'Production notes'}).click();await page.getByRole('textbox',{name:'Project document text',exact:true}).waitFor();await page.waitForFunction(()=>Boolean(document.querySelector('.document-editor')?.editor));await settled()}
async function brief(){await page.locator('.tree-row').filter({hasText:'Project questionnaire'}).click();await questionnaire.waitFor();await settled()}
async function shot(name){await page.screenshot({path:resolve(out,`${name}.png`),fullPage:true});report.screenshots.push(`${name}.png`)}
try{
  await page.goto(process.env.UI_TEST_BASE_URL||'http://127.0.0.1:5174/?catalog=demo',{waitUntil:'domcontentloaded'});const enter=page.getByRole('button',{name:'Enter now',exact:true});if(await enter.count())await enter.click();await questionnaire.waitFor();await settled()
  check('Actual App passes readonly to every questionnaire text control',await questionnaire.locator('input,textarea').evaluateAll(nodes=>nodes.length===17&&nodes.every(node=>node.readOnly&&!node.disabled)))
  check('Readonly difficulty is disabled while navigation stays available',await questionnaire.getByLabel('Difficulty').isDisabled()&&await questionnaire.getByLabel('Toggle questionnaire outline').isEnabled())
  for(const name of ['What are we making?','Deliverables','Purpose','Audience / taste target','Potential challenges','Planned solution','Tools, labor & cost','Narrative data sources','Visual reference strategy','Stage 1 — Spatial data / sketch','Stage 2 — Conversion & construction','Stage 3 — Finish & verification'])check(`Questionnaire textbox is named by visible heading: ${name}`,await questionnaire.getByRole('textbox',{name,exact:true}).count()===1)
  await qSummary.focus();await page.keyboard.press('Control+a');check('Readonly questionnaire summary remains selectable',await qSummary.evaluate(node=>node.selectionStart===0&&node.selectionEnd===node.value.length&&node.value.length>0))
  await page.keyboard.insertText('REJECTED SUMMARY');await qTitle.focus();await page.keyboard.insertText('REJECTED TITLE');await settled();check('Physical typing preserves questionnaire title and summary',await qTitle.inputValue()===fixture.title&&await qSummary.inputValue()===fixture.questionnaire.summary)
  const dark=await questionnaire.locator('.questionnaire-paper').evaluate(node=>getComputedStyle(node).backgroundColor)
  await questionnaire.getByLabel('Choose questionnaire theme',{exact:true}).click();await page.getByLabel('Use light questionnaire theme',{exact:true}).click();const light=await questionnaire.locator('.questionnaire-paper').evaluate(node=>getComputedStyle(node).backgroundColor)
  check('Questionnaire local theme toggle changes actual paper background',dark!==light&&dark==='rgb(32, 33, 31)'&&light!=='rgba(0, 0, 0, 0)',{dark,light})
  await questionnaire.getByLabel('Choose questionnaire theme',{exact:true}).click();await page.getByLabel('Use dark questionnaire theme',{exact:true}).click()
  const fieldPaint=await qSummary.evaluate(node=>{const style=getComputedStyle(node),paper=getComputedStyle(node.closest('.questionnaire-paper'));const channels=color=>color.match(/[\d.]+/g).slice(0,3).map(Number);const fg=channels(style.color),bg=channels(style.backgroundColor==='rgba(0, 0, 0, 0)'?paper.backgroundColor:style.backgroundColor);const luminance=rgb=>rgb.map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);const a=luminance(fg),b=luminance(bg);return{paper:paper.backgroundColor,background:style.backgroundColor,color:style.color,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),dark:Math.max(...bg)<90}})
  check('Questionnaire returns to actual dark paper with readable readonly-state ink',fieldPaint.paper==='rgb(32, 33, 31)'&&fieldPaint.dark&&fieldPaint.contrast>=4.5,fieldPaint)
  check('Questionnaire print remains available without writes',await questionnaire.getByRole('button',{name:'Print / PDF',exact:true}).isEnabled());await questionnaire.getByRole('button',{name:'Print / PDF',exact:true}).click()
  check('Forced existing Questionnaire parent callbacks refuse title/value mutation',await questionnaire.evaluate(node=>{
    let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];while(fiber){const props=fiber.memoizedProps;if(props?.onProjectTitleChange&&props?.value&&typeof props.projectTitle==='string'){props.onProjectTitleChange('REJECTED PARENT TITLE');props.onChange({...props.value,summary:'REJECTED PARENT SUMMARY'});return props.readOnly===true}fiber=fiber.return}return false
  }))
  await settled();await rich();check('Questionnaire parent refusal keeps project title in header',await page.locator('.active-project-label strong').allTextContents().then(values=>values.includes(fixture.title))||await page.getByText(fixture.title,{exact:true}).count()>0)
  const initial=await richSnapshot();check('Actual App passes readonly to named selectable RichDocument editor',await page.getByRole('textbox',{name:'Project document text'}).getAttribute('aria-readonly')==='true'&&await page.locator('.document-editor').getAttribute('contenteditable')==='false')
  check('Rich formatting and layout mutations are disabled',await page.getByRole('button',{name:'Bold',exact:true}).isDisabled()&&await page.locator('.document-formatting-controls select:not(:disabled),.document-layout-inspector select:not(:disabled),.document-layout-inspector input:not(:disabled)').count()===0)
  check('Rich image caption remains readonly selectable and named',await page.getByRole('textbox',{name:'Image caption',exact:true}).evaluate(node=>node.readOnly&&!node.disabled&&node.value==='Original caption'))
  check('Rich readonly surface inherits paper ink without false white background',await page.locator('.document-editor').evaluate(node=>getComputedStyle(node).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(node).color===getComputedStyle(node.parentElement).color))
  await page.locator('.document-editor').focus();await page.keyboard.press('Control+a');check('Rich readonly text supports actual keyboard selection',await page.evaluate(()=>getSelection()?.toString().includes('original production text')))
  await page.keyboard.insertText('REJECTED RICH TYPING');await page.keyboard.press('Control+b');await page.keyboard.press('Control+z');await page.keyboard.press('Control+y')
  await page.locator('.document-editor').evaluate(node=>{const data=new DataTransfer();data.setData('text/plain','REJECTED PASTE');node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));const editor=node.editor;editor.commands.insertContent('REJECTED COMMAND');editor.commands.selectAll();editor.commands.toggleBold();editor.commands.undo();editor.commands.redo();window.dispatchEvent(new CustomEvent('art-equation:document-history',{detail:'undo'}));window.dispatchEvent(new CustomEvent('art-equation:document-history',{detail:'redo'}))})
  check('Rich typing paste formatting command and both histories keep exact document',JSON.stringify(await richSnapshot())===JSON.stringify(initial))
  const forced=await page.locator('.document-pane').evaluate(node=>{let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];while(fiber){const props=fiber.memoizedProps;if(props?.onLayoutChange&&props?.content&&props?.layout){props.onChange({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'REJECTED PARENT CONTENT'}]}]});props.onLayoutChange({...props.layout,headerText:'REJECTED PARENT HEADER',theme:'night'});return props.readOnly===true}fiber=fiber.return}return false})
  check('Forced existing RichDocument parent callbacks are permission gated',forced);await settled();await brief();check('Questionnaire value/title remain exact after document navigation',await qTitle.inputValue()===fixture.title&&await qSummary.inputValue()===fixture.questionnaire.summary)
  await shot('01-questionnaire-readonly');await rich();check('Rich parent content/layout refusal survives component remount',JSON.stringify(await richSnapshot())===JSON.stringify(initial)&&await page.getByLabel('Running header').inputValue()==='Original header'&&await page.locator('.document-stage').getAttribute('class').then(value=>value.includes('document-theme-paper')))
  await page.getByRole('button',{name:'Flow',exact:true}).click();await page.getByLabel('Toggle document outline',{exact:true}).click();await page.getByRole('navigation',{name:'Document outline'}).getByRole('button',{name:'Readonly production brief',exact:true}).click()
  check('Readonly rich display and outline navigation remain usable',await page.locator('.document-flow').count()===1)
  report.morePointerHit=await page.getByRole('button',{name:'More formatting',exact:true}).evaluate(node=>{const bounds=node.getBoundingClientRect(),tab=document.querySelector('[aria-label="Show the inspector panel"]'),toolbar=node.closest('.pane-toolbar');return{more:bounds.toJSON(),inspector:tab?.getBoundingClientRect().toJSON(),centerOwner:document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)?.outerHTML,toolbar:toolbar?.getBoundingClientRect().toJSON(),padding:getComputedStyle(toolbar).padding}})
  await page.getByRole('button',{name:'More formatting',exact:true}).click({timeout:5000});const menu=page.getByRole('menu',{name:'More document tools'});check('Readonly menu disables mutation and keeps four output actions',await menu.locator('button:not(:disabled)').count()===4&&await menu.getByRole('menuitem',{name:'• Bulleted list',exact:true}).isDisabled())
  check('Readonly menu focus begins at first enabled output',await page.evaluate(()=>document.activeElement?.textContent.includes('Export HTML')));await page.keyboard.press('ArrowDown');check('Menu ArrowDown skips disabled mutation items',await page.evaluate(()=>document.activeElement?.textContent.includes('Export SVG')));await page.keyboard.press('Escape');check('Menu Escape returns focus to named opener',await page.getByRole('button',{name:'More formatting',exact:true}).evaluate(node=>document.activeElement===node))
  await shot('02-rich-readonly-parent-integration');await page.getByRole('button',{name:'Save',exact:true}).click();await settled();check('Readonly App save and all edit attempts make no project model write',(await projectWrites()).length===0,await projectWrites())
  check('Print reads without mutation and no browser errors occurred',await page.evaluate(()=>window.__readonlyBackend.prints===1)&&report.browserErrors.length===0,report.browserErrors)
  const changed=[];for(const [name,hash]of Object.entries(hashes))if(hash!==createHash('sha256').update(await readFile(name)).digest('hex'))changed.push(name);check('All five integrated source hashes are stable',changed.length===0,changed);report.sourcesUnchanged=true;report.passed=true
}catch(error){report.error=error.stack;report.snapshot=await page.locator('body').ariaSnapshot();await shot('failure-state')}finally{await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error,report:resolve(out,'report.json')},null,2));if(!report.passed)process.exitCode=1
