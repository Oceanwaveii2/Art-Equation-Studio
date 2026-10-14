import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {chromium} from 'playwright-core'
import ts from 'typescript'

// Actual production App; only an isolated in-memory Tauri backend is available.
// Forced parent callbacks and synthetic native/DOM drop delivery are separately
// labeled from actual user pointer/keyboard controls. No live project or picker.
const phase=process.env.INSPECTOR_TEST_PHASE||'final'
const before=phase==='before'
const baseUrl=process.env.UI_TEST_BASE_URL||'http://127.0.0.1:56556/?catalog=demo'
const inputs=['src/App.tsx','src/App.css','src/model/project.ts','src/model/vector.ts','src/board/boardMutationSafety.ts','src/document/ProjectQuestionnaire.tsx','scripts/partii-inspector-readonly-ui.mjs']
const hashes={};for(const p of inputs)hashes[p]=createHash('sha256').update(await readFile(p)).digest('hex')
const out=resolve('output/playwright/partii-inspector-readonly-integration',phase+'-'+new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(out,{recursive:true})
await writeFile(resolve(out,'App-source-checkpoint.tsx'),await readFile('src/App.tsx'))
const report={generatedAt:new Date().toISOString(),phase,passed:false,sourceHashes:hashes,checks:[],observations:[],browserErrors:[],screenshots:[],limits:'Actual headless Edge App in disposable memory workspace. Pointer/keyboard UI checks separate from forced existing parent callbacks and synthetic drop/native listener delivery. No actual disk, native file picker, native GPU pixels, screen reader, physical DPI or candidate runtime closure.'}
const check=(name,passed,detail)=>{report.checks.push({name,passed:Boolean(passed),detail});assert(passed,name+': '+JSON.stringify(detail))}
const code=ts.transpileModule(await readFile('src/model/project.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {createBlankProject}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1EAAAAASUVORK5CYII='
const fixture=createBlankProject('Inspector read-only isolated fixture');fixture.id='inspector-readonly-disposable-memory'
fixture.assets=['cover-a','cover-b'].map((id,index)=>({id,originalName:id+'.png',displayName:index?'Blue project image':'Amber board image',relativePath:'projects/'+fixture.id+'/assets/originals/'+id+'.png',thumbnailRelativePath:'projects/'+fixture.id+'/assets/thumbnails/'+id+'.png',kind:'image',status:'available',extension:'png',byteLength:68,deduplicated:false,importedAt:'2026-09-30T00:00:00.000Z',aliases:[],virtualFolder:'Inspector QA'}))
fixture.projectCoverAssetId='cover-b';fixture.projectCoverFraming={positionX:50,positionY:50,zoom:1,aspect:1}
fixture.inspectorImageAssetId='cover-a';fixture.status='planning'
fixture.worksheets=[{date:new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10),tasks:[{id:'today-check',title:'Verify isolated today task',completed:false,links:[]}],notesHtml:'',updatedAt:'2026-09-30T00:00:00.000Z'}]
fixture.boards=[{id:'inspector-board',title:'Inspector fixture board',coverAssetId:'cover-a',viewport:{x:0,y:0,scale:1},nodes:[{id:'cover-node',kind:'image',title:'Amber board image',assetId:'cover-a',x:100,y:100,width:100,height:100,color:'#607080'}],connectors:[]},{id:'other-board',title:'Other fixture board',viewport:{x:0,y:0,scale:1},nodes:[],connectors:[]}]
await writeFile(resolve(out,'fixture.json'),JSON.stringify(fixture,null,2)+'\n')
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true})
report.browserVersion=browser.version()
let page,context
const settled=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
async function boot(readOnly){
  if(context)await context.close()
  context=await browser.newContext({viewport:{width:1920,height:1080}});page=await context.newPage();page.on('pageerror',error=>report.browserErrors.push(error.message))
  await page.addInitScript(({fixture,readOnly,png})=>{
    if(!['http:','https:'].includes(location.protocol))return
    const backend={project:structuredClone(fixture),readOnly,calls:[],callbacks:{},listeners:[],nextCallback:1,pending:{},deferDialog:false,deferImport:false};window.__inspectorBackend=backend
    localStorage.setItem('art-equation.navigator','1');localStorage.setItem('art-equation.inspector','1');localStorage.setItem('art-equation.view-mode','document')
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}}
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:(callback)=>{const id=backend.nextCallback++;backend.callbacks[id]=callback;return id},unregisterCallback:id=>delete backend.callbacks[id],convertFileSrc:()=>png,invoke:async(command,args={})=>{
      backend.calls.push({command,args:structuredClone(args)})
      if(command==='workspace_info')return{root:'MEMORY-ONLY-INSPECTOR',workspaceId:'inspector-fixture',readOnly:backend.readOnly,lockOwned:!backend.readOnly}
      if(command==='list_projects')return[{id:fixture.id,title:fixture.title,updatedAt:fixture.updatedAt,boardCount:2,assetCount:2,status:backend.project.status}]
      if(command==='load_json')return structuredClone(args.relativePath==='settings.json'?{schemaVersion:5,theme:'dark',viewMode:'document',activeProjectId:fixture.id,projectNavigation:{[fixture.id]:{activeBoardId:'inspector-board',activeDocumentId:'project-brief',activeNavigatorItem:'document:project-brief',viewMode:'document'}}}:backend.project)
      if(command==='save_json'){if(backend.readOnly)throw Error('Read-only memory backend rejects persistence');if(args.relativePath.endsWith('/project.json'))backend.project=structuredClone(args.value);return}
      if(command==='plugin:dialog|open')return backend.deferDialog?new Promise(done=>{backend.pending.dialog=done}):null
      if(command==='import_asset'){
        if(backend.readOnly)throw Error('Read-only memory backend rejects import')
        const record={...fixture.assets[1],id:'async-image',originalName:'async-image.png',relativePath:'projects/'+args.projectId+'/assets/originals/async-image.png'}
        return backend.deferImport?new Promise(done=>{backend.pending.import=()=>done(record)}):record
      }
      if(command==='list_system_fonts')return['Arial','Georgia']
      if(command==='plugin:event|listen'){backend.listeners.push(structuredClone(args));return backend.listeners.length}
      if(command==='plugin:window|scale_factor')return 1
      if(command==='plugin:window|inner_size')return{width:innerWidth,height:innerHeight}
      if(['ensure_managed_board_folders','ensure_project_workspace','plugin:event|unlisten','record_frontend_diagnostic'].includes(command))return
      if(['list_project_trash','list_trashed_projects','audit_assets'].includes(command))return[]
      if(command==='mini_bridge_launch')return null
      throw Error('Inspector mock refuses '+command)
    }}
  },{fixture,readOnly,png})
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'})
  const enter=page.getByRole('button',{name:'Enter now',exact:true});if(await enter.count())await enter.click()
  await page.getByRole('complementary',{name:'Project and selection inspector',exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelector('.project-inspector')?.textContent.includes('Verify isolated today task'))
  await settled()
}
const inspector=()=>page.getByRole('complementary',{name:'Project and selection inspector',exact:true})
const state=()=>inspector().evaluate(node=>{
  let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))]
  let project,permission,history=[]
  while(fiber){if(fiber.memoizedProps?.onStatusChange&&fiber.memoizedProps?.project){project=fiber.memoizedProps.project;permission=fiber.memoizedProps.readOnly}
    if(fiber.type?.name==='App'){let hook=fiber.memoizedState,index=0;while(hook){const value=hook.memoizedState;if(value?.current?.id&&Array.isArray(value.current.boards))project=value.current;if(value?.current&&typeof value.current==='object'&&'workspaceRoot' in value.current&&'readOnly' in value.current&&Number.isInteger(value.current.revision))permission=value.current.readOnly;if(value&&typeof value==='object'&&Array.isArray(value.current))history.push({index,array:JSON.parse(JSON.stringify(value.current))});hook=hook.next;index++}}
    fiber=fiber.return}
  return{project:structuredClone(project),readOnly:permission,history}
})
const calls=()=>page.evaluate(()=>structuredClone(window.__inspectorBackend.calls))
const dangerous=all=>all.filter(c=>c.command==='save_json'||c.command==='plugin:dialog|open'||/import|pyramid/.test(c.command))
const snapshot=async name=>{await page.screenshot({path:resolve(out,name+'.png'),fullPage:true});report.screenshots.push(name+'.png')}
async function dropAsset(id){
  await page.locator('.project-inspector-image-slot').evaluate((node,id)=>{const transfer=new DataTransfer();transfer.setData('application/x-art-equation-asset-id',id);node.dispatchEvent(new DragEvent('dragover',{dataTransfer:transfer,bubbles:true,cancelable:true}));node.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}))},id);await settled()
}
async function nativeDrop(){
  return page.locator('.project-inspector-image-slot').evaluate(node=>{const b=node.getBoundingClientRect(),backend=window.__inspectorBackend,matching=backend.listeners.filter(item=>item.event==='tauri://drag-drop');for(const item of matching)backend.callbacks[item.handler]?.({event:item.event,id:1,payload:{paths:['MEMORY-ONLY/drop-source.png'],position:{x:b.x+b.width/2,y:b.y+b.height/2}}});return{count:matching.length,position:{x:b.x+b.width/2,y:b.y+b.height/2}}})
}
async function parentAttempt(method,args=[]){return inspector().evaluate(async(node,{method,args})=>{let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];while(fiber){const props=fiber.memoizedProps;if(props?.onStatusChange&&props?.project){if(typeof props[method]!=='function')throw Error('Missing real Inspector prop '+method);await props[method](...args);return true}fiber=fiber.return}return false},{method,args})}
// These helpers use actual App state queues by value shape; no fixed hook index.
async function setLivePermission(readOnly){
  await inspector().evaluate((node,readOnly)=>{
    window.__inspectorBackend.readOnly=readOnly
    let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))]
    while(fiber){if(fiber.type?.name==='App'){let hook=fiber.memoizedState;while(hook){if(hook.memoizedState?.root==='MEMORY-ONLY-INSPECTOR'&&hook.queue?.dispatch){hook.queue.dispatch({...hook.memoizedState,readOnly,lockOwned:!readOnly});return}hook=hook.next}}fiber=fiber.return}
    throw Error('Actual App workspace state queue not found')
  },readOnly)
  await settled();check('Actual live permission transition to '+readOnly,(await state()).readOnly===readOnly)
}
async function replaceLiveProject(){
  await inspector().evaluate(node=>{
    let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))]
    while(fiber){if(fiber.type?.name==='App'){let hook=fiber.memoizedState;while(hook){const value=hook.memoizedState;if(value?.id&&Array.isArray(value.boards)&&Array.isArray(value.documents)&&hook.queue?.dispatch){hook.queue.dispatch({...value,id:value.id+'-replacement',title:'Disposable replacement project'});return}hook=hook.next}}fiber=fiber.return}
    throw Error('Actual App project state queue not found')
  });await settled()
}
async function deferBackend(kind){await page.evaluate(kind=>{window.__inspectorBackend[kind==='dialog'?'deferDialog':'deferImport']=true},kind)}
async function beginParentAttempt(method,args=[]){
  return inspector().evaluate((node,{method,args})=>{
    let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))]
    while(fiber){const props=fiber.memoizedProps;if(props?.onStatusChange&&props?.project){if(typeof props[method]!=='function')throw Error('Missing real Inspector prop '+method);window.__inspectorAsyncAttempt={done:false};Promise.resolve(props[method](...args)).then(()=>window.__inspectorAsyncAttempt.done=true,error=>{window.__inspectorAsyncAttempt.done=true;window.__inspectorAsyncAttempt.error=String(error)});return true}fiber=fiber.return}return false
  },{method,args})
}
async function pending(kind){await page.waitForFunction(kind=>typeof window.__inspectorBackend.pending[kind]==='function',kind,{timeout:10000})}
async function release(kind){await page.evaluate(kind=>{const backend=window.__inspectorBackend,done=backend.pending[kind];if(typeof done!=='function')throw Error('Missing deferred '+kind);delete backend.pending[kind];done(kind==='dialog'?'MEMORY-ONLY/async-source.png':undefined)},kind);await settled()}
async function raceChecks(){
  for(const method of ['onBrowseInspectorImage','onImportCoverImage'])for(const transition of ['readonly','permission-cycle','project']){
    await boot(false);await deferBackend('dialog');check('Writable callback starts deferred picker: '+method,await beginParentAttempt(method));await pending('dialog')
    if(transition==='project')await replaceLiveProject();else{await setLivePermission(true);if(transition==='permission-cycle')await setLivePermission(false)}
    const initial=await state(),count=(await calls()).filter(c=>c.command==='import_asset').length;await release('dialog')
    await unchanged('Actual pending picker '+method+' cancels '+transition+' without memory/history mutation',initial)
    check('Cancelled '+method+' picker never starts native import: '+transition,(await calls()).filter(c=>c.command==='import_asset').length===count)
  }
  for(const [method,args] of [['onImportInspectorImagePaths',[['MEMORY-ONLY/async-source.png']]],['onBrowseInspectorImage',[]],['onImportCoverImage',[]]])for(const transition of ['readonly','permission-cycle','project']){
    await boot(false);await deferBackend('import');if(method!=='onImportInspectorImagePaths')await deferBackend('dialog');check('Writable callback starts deferred native import: '+method,await beginParentAttempt(method,args));if(method!=='onImportInspectorImagePaths'){await pending('dialog');await release('dialog')}await pending('import')
    if(transition==='project')await replaceLiveProject();else{await setLivePermission(true);if(transition==='permission-cycle')await setLivePermission(false)}
    const initial=await state();await release('import');await unchanged('Actual pending native import '+method+' rejects '+transition+' model/history commit',initial)
    check('Import stays bound to its originating project ID: '+method+'/'+transition,(await calls()).filter(c=>c.command==='import_asset').every(c=>c.args.projectId==='inspector-readonly-disposable-memory'))
  }
  for(const [method,args,field] of [['onBrowseInspectorImage',[],'inspectorImageAssetId'],['onImportInspectorImagePaths',[['MEMORY-ONLY/async-source.png']],'inspectorImageAssetId'],['onImportCoverImage',[],'projectCoverAssetId']]){
    await boot(false);await deferBackend('import');if(method!=='onImportInspectorImagePaths')await deferBackend('dialog');await beginParentAttempt(method,args);if(method!=='onImportInspectorImagePaths'){await pending('dialog');await release('dialog')}await pending('import');await release('import')
    await page.waitForFunction(({field})=>{const node=document.querySelector('.project-inspector');let fiber=node?.[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];while(fiber){if(fiber.type?.name==='App'){let hook=fiber.memoizedState;while(hook){if(hook.memoizedState?.current?.id&&Array.isArray(hook.memoizedState.current.boards)&&hook.memoizedState.current[field]==='async-image')return true;hook=hook.next}}fiber=fiber.return}return false},{field},{timeout:10000})
    const current=await state();check('Editable deferred '+method+' commits only imported image to intended field',current.project[field]==='async-image'&&current.project.assets.some(a=>a.id==='async-image'))
  }
  await boot(false);await inspector().getByRole('button',{name:'Change inspector image',exact:true}).click();await inspector().getByRole('dialog',{name:'Choose inspector image',exact:true}).waitFor();await setLivePermission(true);check('Live readonly closes existing Inspector picker',await inspector().getByRole('dialog',{name:'Choose inspector image',exact:true}).count()===0);const initial=await state();await nativeDrop();await unchanged('Native listener uses latest permission after live readonly transition',initial);check('Live readonly native drop starts no picker/import',(await calls()).every(c=>c.command!=='plugin:dialog|open'&&!/import|pyramid/.test(c.command)));check('Live readonly native drop persists no project data',(await calls()).every(c=>c.command!=='save_json'||!c.args.relativePath?.endsWith('/project.json')))
}
async function unchanged(name,initial){
  await settled();const current=await state();check(name,JSON.stringify(current.project)===JSON.stringify(initial.project)&&JSON.stringify(current.history)===JSON.stringify(initial.history),{projectUnchanged:JSON.stringify(current.project)===JSON.stringify(initial.project),historyUnchanged:JSON.stringify(current.history)===JSON.stringify(initial.history)})
}
try{
  await boot(true);const initial=await state();check('Actual App fixture opens with Inspector readOnly=true',initial.readOnly===true)
  if(before){
    const controls={status:await inspector().getByLabel('Project status').isEnabled(),task:await inspector().getByRole('checkbox',{name:'Verify isolated today task'}).isEnabled(),useBoardCover:await inspector().getByRole('button',{name:'Use board cover',exact:true}).isEnabled(),cover:await inspector().getByRole('button',{name:'Change cover',exact:true}).isEnabled(),image:await inspector().getByRole('button',{name:'Change inspector image',exact:true}).isEnabled()}
    report.observations.push({name:'Before controls remain enabled in read-only workspace',controls})
    await inspector().getByLabel('Project status').selectOption('review');await settled();const statusMutation=(await state()).project.status==='review'
    await inspector().getByRole('checkbox',{name:'Verify isolated today task'}).check();await settled();const taskMutation=(await state()).project.worksheets[0].tasks[0].completed===true
    await inspector().getByRole('button',{name:'Use board cover',exact:true}).click();await settled();const coverMutation=(await state()).project.projectCoverAssetId==='cover-a'
    await dropAsset('cover-b');const imageMutation=(await state()).project.inspectorImageAssetId==='cover-b'
    await parentAttempt('onBrowseInspectorImage');const pickerCalls=(await calls()).filter(c=>c.command==='plugin:dialog|open').length
    await snapshot('before-enabled-readonly-controls')
    report.observations.push({name:'Actual App before permission gap',statusMutation,taskMutation,coverMutation,imageMutation,pickerCalls,projectWrites:(await calls()).filter(c=>c.command==='save_json'&&c.args.relativePath.endsWith('/project.json')).length})
    check('Before source reproduces actual status task cover image mutation and premature picker',statusMutation&&taskMutation&&coverMutation&&imageMutation&&pickerCalls===1)
    check('Before has no project disk/memory persistence call',(await calls()).every(c=>c.command!=='save_json'))
    report.beforeDefectObserved=true
  }else{
    for(const name of ['Project status'])check('Read-only Inspector '+name+' is disabled',await inspector().getByLabel(name).isDisabled())
    check('Read-only today task is disabled',await inspector().getByRole('checkbox',{name:'Verify isolated today task'}).isDisabled())
    for(const name of ['Change cover','Use board cover','Change inspector image'])check('Read-only '+name+' control is disabled',await inspector().getByRole('button',{name,exact:true}).isDisabled())
    await inspector().getByLabel('Project status').evaluate(node=>{node.focus();node.value='complete';node.dispatchEvent(new Event('change',{bubbles:true}))})
    await page.keyboard.press('ArrowDown');await unchanged('Keyboard/event attempts preserve exact read-only project and history',initial)
    await dropAsset('cover-b');await unchanged('Synthetic actual slot asset drop refuses read-only mutation',initial)
    await inspector().locator('.project-inspector-cover').evaluate(node=>{const data=new DataTransfer();data.setData('application/x-art-equation-asset-id','cover-a');node.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}))});await unchanged('Synthetic actual cover asset drop refuses read-only mutation',initial)
    const native=await nativeDrop();check('Actual native slot drop listener is delivered in mock transport',native.count>0,native);await unchanged('Synthetic native slot drop refuses read-only import/model mutation',initial)
    for(const [method,args] of [['onStatusChange',['complete']],['onTaskChange',['today-check',true]],['onUseBoardCover',[]],['onSetProjectCover',['cover-a']],['onSetProjectCover',[undefined]],['onSetInspectorImage',['cover-b']],['onSetInspectorImage',[undefined]],['onBrowseInspectorImage',[]],['onImportInspectorImagePaths',[['MEMORY-ONLY/import-source.png']]],['onImportCoverImage',[]]]){
      check('Existing parent callback reachable: '+method,await parentAttempt(method,args));await unchanged('Forced actual parent '+method+' refuses read-only mutation/history',initial)
    }
    check('No read-only picker/import/persistence commands occur',dangerous(await calls()).length===0,dangerous(await calls()))
    await inspector().getByRole('button',{name:'Today’s tasks: expanded',exact:true}).click();check('Read-only section collapse remains usable',await inspector().getByRole('button',{name:'Today’s tasks: collapsed',exact:true}).count()===1);await inspector().getByRole('button',{name:'Today’s tasks: collapsed',exact:true}).click()
    await inspector().getByRole('button',{name:'▧ Inspector fixture board 1',exact:true}).click();await page.getByRole('navigation',{name:'Board navigation',exact:true}).waitFor();check('Read-only board navigation remains usable',await page.getByRole('navigation',{name:'Board navigation'}).getByRole('button',{name:'Inspector fixture board',exact:true}).getAttribute('aria-current')==='page')
    await page.getByRole('button',{name:'Document',exact:true}).click();await page.getByRole('button',{name:'Save',exact:true}).click();await settled();check('Read-only Save still refuses model persistence',dangerous(await calls()).length===0,dangerous(await calls()))
    await snapshot('readonly-guarded-inspector')
    await boot(false);const editable=await state();check('Editable counterpart opens writable Inspector',editable.readOnly===false)
    await inspector().getByLabel('Project status').selectOption('review');await settled();check('Editable status selection changes actual App memory',(await state()).project.status==='review')
    await inspector().getByRole('checkbox',{name:'Verify isolated today task'}).check();await settled();check('Editable today task checkbox changes actual App memory',(await state()).project.worksheets[0].tasks[0].completed)
    await inspector().getByRole('button',{name:'Use board cover',exact:true}).click();await settled();check('Editable active-board cover action chooses distinct image',(await state()).project.projectCoverAssetId==='cover-a')
    await inspector().getByRole('button',{name:'Change cover',exact:true}).click();const cover=inspector().locator('.project-cover-picker').filter({has:page.getByRole('dialog',{name:'Project image',exact:true})});await cover.getByRole('button',{name:'Blue project image',exact:true}).click();await cover.getByRole('button',{name:'Use image',exact:true}).click();await settled();check('Editable actual cover chooser applies other image',(await state()).project.projectCoverAssetId==='cover-b')
    await inspector().getByRole('button',{name:'Change cover',exact:true}).click();await cover.getByRole('button',{name:'Reset to automatic',exact:true}).click();await settled();check('Editable actual clear-cover action clears stored cover',(await state()).project.projectCoverAssetId===undefined)
    await inspector().getByRole('button',{name:'Change inspector image',exact:true}).click();let picker=inspector().getByRole('dialog',{name:'Choose inspector image',exact:true});await picker.getByRole('button',{name:'Blue project image',exact:true}).click();await settled();check('Editable actual Inspector image picker applies other image',(await state()).project.inspectorImageAssetId==='cover-b')
    await inspector().getByRole('button',{name:'Change inspector image',exact:true}).click();await picker.getByRole('button',{name:'Clear image',exact:true}).click();await settled();check('Editable clear Inspector image works',(await state()).project.inspectorImageAssetId===undefined)
    await dropAsset('cover-a');check('Editable actual Inspector DOM asset drop works',(await state()).project.inspectorImageAssetId==='cover-a')
    await inspector().getByRole('button',{name:'Change inspector image',exact:true}).dblclick();check('Editable native browse reaches isolated picker callback',(await calls()).filter(c=>c.command==='plugin:dialog|open').length===1)
    const priorCalls=(await calls()).length;await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(n=>window.__inspectorBackend.calls.slice(n).some(c=>c.command==='save_json'&&c.args.relativePath.endsWith('/project.json')),priorCalls)
    const persisted=await page.evaluate(()=>structuredClone(window.__inspectorBackend.project));check('Editable explicit Save records changed fields in memory backend',persisted.status==='review'&&persisted.worksheets[0].tasks[0].completed&&persisted.projectCoverAssetId===undefined&&persisted.inspectorImageAssetId==='cover-a')
    check('Editable project identity boards documents questionnaire and originals remain preserved',persisted.id===fixture.id&&JSON.stringify(persisted.boards)===JSON.stringify(editable.project.boards)&&JSON.stringify(persisted.documents)===JSON.stringify(editable.project.documents)&&JSON.stringify(persisted.questionnaire)===JSON.stringify(editable.project.questionnaire)&&persisted.assets.every((a,i)=>a.relativePath===fixture.assets[i].relativePath))
    await snapshot('editable-inspector-counterparts')
    await raceChecks();await snapshot('live-readonly-native-drop-guard')
  }
  check('No actual browser exceptions',report.browserErrors.length===0,report.browserErrors)
  const changed=[];for(const[p,hash]of Object.entries(hashes))if(hash!==createHash('sha256').update(await readFile(p)).digest('hex'))changed.push(p);check('All production and harness fingerprints remain stable',changed.length===0,changed)
  report.sourcesUnchanged=true;report.passed=true
}catch(error){report.error=error.stack;try{report.snapshot=await page.locator('body').ariaSnapshot();report.lastState=await state();report.mockCalls=await calls();await snapshot('failure-state')}catch{}}
finally{await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify({phase,passed:report.passed,checks:report.checks.length,error:report.error,report:resolve(out,'report.json')},null,2));if(!report.passed)process.exitCode=1

