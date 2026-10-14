import fs from 'node:fs/promises'
import path from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright-core'
const root='D:/0/ArtEquation-Tests/2026-10-11-mixed-baseline'
const manifest=JSON.parse(await fs.readFile(root+'/fixture-manifest.json','utf8'))
const pins=JSON.parse(await fs.readFile(root+'/baseline-provenance.json','utf8'))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
if(sha(await fs.readFile(root+'/fixture-manifest.json'))!==pins.fixtureManifestSha256)throw Error('Frozen image/fixture manifest changed')
for(const f of manifest.fixtures)if(sha(await fs.readFile(f.project))!==f.projectSha256)throw Error('Frozen fixture changed: '+f.count)
if(!process.argv.includes('--gpu-ready')){console.log(JSON.stringify({status:'GPU_TEST_DEFERRED',fixtures:manifest.fixtures.map(f=>f.count),images:manifest.images.length,scope:'Input validation only. Use --gpu-ready only after the user releases GPU testing.'}));process.exit(0)}
const phase=process.argv.includes('--after')?'after':'before',exe=path.resolve(process.env.AE_BASELINE_EXE||pins.exe)
if(phase==='before'&&sha(await fs.readFile(exe))!==pins.exeSha256)throw Error('Pre-optimization EXE changed')
const requested=process.env.AE_BASELINE_COUNTS?.split(',').map(Number)||[500,1000,5000,10000]
const runRoot=root+'/runs/'+phase+'-'+Date.now();await fs.mkdir(runRoot,{recursive:true})
const result={scope:'Native interaction diagnostics. Actual viewport/DPR and accepted GPU frames recorded; no automatic exact-4K or FPS qualification.',phase,exe,exeSha256:sha(await fs.readFile(exe)),fixtureManifestSha256:sha(await fs.readFile(root+'/fixture-manifest.json')),startedAt:new Date().toISOString(),cases:[]}
for(const fixture of manifest.fixtures.filter(f=>requested.includes(f.count))){
 const out=runRoot+'/'+fixture.count,workspace=out+'/workspace';await fs.mkdir(workspace,{recursive:true})
 // Mutable files are copied; only originals/posters are linked from frozen D data.
 async function copyTree(source,target){await fs.mkdir(target,{recursive:true});for(const e of await fs.readdir(source,{withFileTypes:true})){const a=path.join(source,e.name),b=path.join(target,e.name);if(e.isDirectory())await copyTree(a,b);else if(/\.(png|jpe?g|webp)$/i.test(e.name))await fs.link(a,b);else await fs.copyFile(a,b)}}
 await copyTree(fixture.workspace,workspace)
 const report={count:fixture.count,fixtureSha256:fixture.projectSha256,measurements:[],errors:[],coverage:'PENDING'},start=performance.now()
 const child=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,ART_EQUATION_WORKSPACE_ROOT:workspace,WEBVIEW2_USER_DATA_FOLDER:out+'/profile',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9350'}})
 child.on('exit',(code,signal)=>{report.processExit={code,signal,at:performance.now()-start}});let browser,page
 try{
  for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9350');break}catch{await new Promise(r=>setTimeout(r,300))}}
  if(!browser)throw Error('No native debug connection')
  for(let i=0;i<200;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));if(page)break;await new Promise(r=>setTimeout(r,300))}if(!page)throw Error('No app page after native startup wait');await page.waitForSelector('.boot-loader, .canvas-stage',{timeout:120000})
  page.on('pageerror',e=>report.errors.push(e.message))
  const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args})
  const boot=page.locator('.boot-loader');if(await boot.count()){await boot.locator('.boot-selectors select').first().focus();await boot.locator('.boot-loader-skip').click()}
  await page.waitForFunction(()=>document.querySelector('.vello-board')?.dataset.acceptedBackend==='gpu',null,{timeout:180000})
  report.coldFirstGpuCommitMs=performance.now()-start
  async function snapshot(label){
   const data=await page.evaluate(()=>{const host=document.querySelector('.vello-board'),stage=document.querySelector('.canvas-stage');return{at:performance.now(),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},surface:host?{...host.dataset}:null,stage:stage?{...stage.dataset}:null,diagnostics:window.__AE_DIAGNOSTICS__?.snapshot()}})
   if(data.surface?.frameMetadata)data.frameMetadata=JSON.parse(data.surface.frameMetadata)
   try{const ps=`$rows=Get-CimInstance Win32_Process;$ids=@(${child.pid});for($i=0;$i -lt 6;$i++){$ids+=@($rows|Where-Object{$ids -contains $_.ParentProcessId}|ForEach-Object{$_.ProcessId});$ids=@($ids|Select-Object -Unique)};$rows|Where-Object{$ids -contains $_.ProcessId}|Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime|ConvertTo-Json -Compress`;data.processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024}));data.memoryScope='App-owned process working sets; not GPU VRAM or unique/private memory.'}catch(e){data.memoryError=String(e)}
   report.measurements.push({label,...data});await fs.writeFile(out+'/'+label+'.json',JSON.stringify(data,null,2));return data
  }
  const cold=await snapshot('cold-subset');if(Number(cold.surface?.paintedObjects)===0)report.errors.push('GPU committed an empty scene despite visible authored objects; timings do not qualify rendering performance');await page.waitForFunction(()=>document.querySelector('.vello-board')?.dataset.imageSharp==='true',null,{timeout:180000});await snapshot('subset-sharp')
  async function tool(name){const b=page.getByRole('button',{name,exact:true});if(!await b.isVisible())await page.locator('summary[aria-label="'+(name==='Select and move'?'Selection tools':'Navigation and view tools')+'"]').click();await b.click()}
  const stage=page.locator('.canvas-stage'),box=await stage.boundingBox();if(!box)throw Error('Missing canvas bounds')
  await tool('Hand tool');await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.down();for(let i=0;i<24;i++){await page.mouse.move(box.x+box.width*.55+i*4,box.y+box.height*.5+i*2);await page.waitForTimeout(16)}await page.mouse.up();await snapshot('subset-pan')
  for(let i=0;i<12;i++){await page.keyboard.down('Control');await page.mouse.wheel(0,i<6?-35:35);await page.keyboard.up('Control');await page.waitForTimeout(32)}await snapshot('subset-zoom')
  async function drag(id){const article=page.locator('article[data-node-id="'+id+'"]'),r=await article.boundingBox();if(!r)throw Error('Drag target unavailable: '+id);await tool('Select and move');await page.mouse.move(r.x+r.width*.5,r.y+8);await page.mouse.down();for(let i=1;i<=12;i++){await page.mouse.move(r.x+r.width*.5+i*2,r.y+8+i);await page.waitForTimeout(16)}await page.mouse.up();await snapshot('drag-'+id)}
  await drag('n-0')
  await tool('Hand tool');for(let j=0;j<7;j++){await page.mouse.move(box.x+box.width*.8,box.y+box.height*.65);await page.mouse.down();for(let i=1;i<=14;i++){await page.mouse.move(box.x+box.width*.8-i*40,box.y+box.height*.65);await page.waitForTimeout(16)}await page.mouse.up()}
  await drag('n-16');await drag('n-17')
  const note=page.locator('article[data-node-id="n-3"] [contenteditable="true"]');if(await note.count()){await note.focus();await page.keyboard.press('End');await page.keyboard.type(' note baseline edit');await stage.focus();await snapshot('note-edit')}else report.errors.push('Column note editor was unavailable')
  const boardButton=title=>page.locator('.board-tree-row').filter({has:page.getByText(title,{exact:true})})
  const warmStart=performance.now();await boardButton('Subboard 1').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.vello-board')?.dataset.acceptedScene==='child-0',null,{timeout:120000});await snapshot('subboard');await boardButton(`${fixture.count.toLocaleString('en-US')} mixed objects`).focus();await page.keyboard.press('Enter');await page.waitForFunction(id=>document.querySelector('.vello-board')?.dataset.acceptedScene===id,'mixed-'+fixture.count,{timeout:180000});report.warmReturnElapsedMs=performance.now()-warmStart;await snapshot('warm-return')
  // Normal Fit behavior is retained, including its existing lower zoom limit.
  await tool('Fit board');await page.waitForTimeout(1000);const fitted=await snapshot('normal-fit');report.normalFitShowsAll=Number(fitted.stage?.visibleNodes)>=fixture.count
  const project=JSON.parse(await fs.readFile(fixture.project,'utf8')),b=project.boards[0]
  const extents={left:Math.min(...b.nodes.map(n=>n.x)),top:Math.min(...b.nodes.map(n=>n.y)),right:Math.max(...b.nodes.map(n=>n.x+n.width)),bottom:Math.max(...b.nodes.map(n=>n.y+n.height))}
  const dimensions=await stage.evaluate(e=>({width:e.clientWidth,height:e.clientHeight})),scale=Math.min((dimensions.width-80)/(extents.right-extents.left),(dimensions.height-80)/(extents.bottom-extents.top))
  b.viewport={scale,x:40-extents.left*scale,y:40-extents.top*scale};report.overviewRequested=b.viewport
  // Disclosed saved-camera case, not a claim that normal Fit achieves this view.
  await invoke('save_json',{relativePath:`projects/${project.id}/project.json`,value:project});await page.reload();await page.waitForSelector('.boot-loader, .canvas-stage',{timeout:120000});const reloadBoot=page.locator('.boot-loader-skip');if(await reloadBoot.count())await reloadBoot.click();await page.waitForFunction(()=>document.querySelector('.vello-board')?.dataset.acceptedBackend==='gpu',null,{timeout:180000});await page.waitForTimeout(1000)
  const overview=await snapshot('saved-overview');report.overviewShowsAll=Number(overview.stage?.visibleNodes)>=fixture.count;await page.screenshot({path:out+'/overview.png'})
  if(!report.overviewShowsAll)report.errors.push('Saved overview did not expose every authored object; do not interpret it as whole-board FPS.')
  // Return to the original readable camera for editing; overview text is intentionally tiny.
  b.viewport={scale:.82,x:28,y:28};await invoke('save_json',{relativePath:`projects/${project.id}/project.json`,value:project});await page.reload();await page.waitForSelector('.boot-loader, .canvas-stage',{timeout:120000});const editBoot=page.locator('.boot-loader-skip');if(await editBoot.count())await editBoot.click();await page.waitForFunction(()=>document.querySelector('.vello-board')?.dataset.acceptedBackend==='gpu',null,{timeout:180000});
  // Interaction readiness is measured separately from full render completeness.
  const editable=page.locator('article[data-node-id="n-1"] [contenteditable="true"]');if(await editable.count()){await editable.focus();await page.keyboard.press('End');await page.keyboard.type(' baseline edit');await stage.focus();await snapshot('type-edit');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForTimeout(1200);report.savedType=(await invoke('load_json',{relativePath:`projects/${project.id}/project.json`})).boards[0].nodes.find(n=>n.id==='n-1')?.body;report.editSaved=report.savedType?.includes('baseline edit')||false}else report.errors.push('Type editor unavailable in overview')
  if(report.editSaved){await page.reload();const launch=page.locator('.boot-loader-skip');if(await launch.count())await launch.click();await page.waitForFunction(()=>document.querySelector('.vello-board')?.dataset.acceptedBackend==='gpu',null,{timeout:180000});const reopened=await invoke('load_json',{relativePath:`projects/${project.id}/project.json`});report.reopenedEdit=reopened.boards[0].nodes.find(n=>n.id==='n-1')?.body===report.savedType;await snapshot('reopened-edit')}
  const crash=await fs.readFile(workspace+'/logs/frontend-crash.log','utf8').catch(()=>null);if(crash?.trim())report.errors.push('Native frontend crash/error log is nonempty')
  report.coverage=report.errors.length||!report.editSaved||!report.reopenedEdit?'INCOMPLETE_OR_CORRECTNESS_FAILURE':'INTERACTION_TRACE_COMPLETED; inspect paint completeness and telemetry loss before interpreting timings'
 }catch(e){report.errors.push(String(e));report.coverage='FAILED_OR_INCOMPLETE';if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{})}
 finally{if(page)try{await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}))}catch{}await browser?.close();if(child.exitCode===null)child.kill();const durable=await fs.readFile(workspace+'/logs/performance.jsonl').catch(()=>null);if(durable){await fs.writeFile(out+'/native-performance.jsonl',durable);report.durableTelemetryBytes=durable.length}await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));result.cases.push(report)}
}
result.finishedAt=new Date().toISOString();result.status='DIAGNOSTIC_PILOT_ONLY; CHECK COVERAGE AND COMPLETENESS';await fs.writeFile(runRoot+'/report.json',JSON.stringify(result,null,2));console.log(JSON.stringify({runRoot,status:result.status,cases:result.cases.map(c=>({count:c.count,coverage:c.coverage,errors:c.errors}))}))

if(result.cases.some(c=>c.coverage==='FAILED_OR_INCOMPLETE'||c.coverage==='INCOMPLETE_OR_CORRECTNESS_FAILURE'))process.exitCode=1
