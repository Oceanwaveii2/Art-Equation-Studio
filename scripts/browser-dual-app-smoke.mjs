import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {chromium} from 'playwright-core'

const exe=path.resolve(process.argv[2]),out='D:/0/ArtEquation-Tests/2026-10-11-browser-dual/app-'+Date.now(),workspace=out+'/workspace'
await fs.mkdir(out,{recursive:true})
async function copy(source,target){await fs.mkdir(target,{recursive:true});for(const entry of await fs.readdir(source,{withFileTypes:true})){const from=path.join(source,entry.name),to=path.join(target,entry.name);if(entry.isDirectory())await copy(from,to);else if(/\.(png|jpe?g|webp)$/i.test(entry.name))await fs.link(from,to);else await fs.copyFile(from,to)}}
await copy('D:/0/ArtEquation-Tests/2026-10-11-mixed-baseline/workspace-500',workspace)
const projectPath=workspace+'/projects/mixed-baseline-500/project.json',fixture=JSON.parse(await fs.readFile(projectPath,'utf8'))
fixture.boards=fixture.boards.slice(0,1);fixture.boards[0].nodes=fixture.boards[0].nodes.filter(n=>['n-0','n-1','n-2'].includes(n.id)).map((n,i)=>({...n,parentColumnId:undefined,x:40+i*210,y:70,width:180,height:150}));fixture.boards[0].connectors=[];fixture.boards[0].viewport={x:0,y:0,scale:1}
await fs.writeFile(projectPath,JSON.stringify(fixture));const manifest=JSON.parse(await fs.readFile(workspace+'/workspace.json','utf8'));manifest.workspaceId=randomUUID();await fs.writeFile(workspace+'/workspace.json',JSON.stringify(manifest))
const discovery=path.join(process.env.LOCALAPPDATA,'studio.artequation.p1v21/codex-live-discovery.json'),prior=await fs.readFile(discovery).catch(()=>undefined)
const report={scope:'Small private WebView2 EXE workflow smoke, not card benchmark or 4K performance acceptance',exe,exeSha256:createHash('sha256').update(await fs.readFile(exe)).digest('hex'),workspace,checks:[],errors:[]}
const child=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,ART_EQUATION_WORKSPACE_ROOT:workspace,WEBVIEW2_USER_DATA_FOLDER:out+'/profile',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9368'}})
let browser,page
try{
 for(let i=0;i<100&&!browser;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9368')}catch{await new Promise(r=>setTimeout(r,300))}}
 assert(browser,'Owned EXE inspection connection')
 for(let i=0;i<100&&!page;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));if(!page)await new Promise(r=>setTimeout(r,250))}
 report.startupPages=browser.contexts().flatMap(c=>c.pages()).map(p=>p.url())
 assert(page,'Workspace webview page: '+JSON.stringify(report.startupPages));page.on('pageerror',error=>report.errors.push(error.message))
 const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args})
 const ready=()=>page.waitForFunction(()=>document.querySelector('.vello-board')?.dataset.acceptedScene==='mixed-500'&&document.querySelector('.vello-board')?.dataset.pending==='false'&&document.querySelector('.vello-board')?.dataset.acceptedBackend==='gpu',null,{timeout:90000})
 await page.waitForSelector('.boot-loader-skip',{timeout:120000});await page.locator('.boot-loader-skip').click();await ready()
 report.initial=await page.locator('.vello-board').evaluate(e=>({...e.dataset}));report.initialMetadata=JSON.parse(report.initial.frameMetadata)
 assert(await page.locator('.vello-board .vello-board-canvas').count());assert.equal(report.initial.gridVisible,'true')
 report.windowLabels=await invoke('plugin:window|get_all_windows');assert(!report.windowLabels.some(label=>String(label).startsWith('native-canvas')))
 report.checks.push('Existing browser canvas, grid and WebView shell; no native child pane')
 await page.keyboard.press('v');await page.waitForFunction(()=>document.querySelector('.canvas-stage')?.classList.contains('tool-select'))
 await page.waitForTimeout(250)
 const shape=page.locator('article[data-node-id="n-2"]');await shape.click({button:'right'});await page.locator('.canvas-context-menu').getByRole('button',{name:'Duplicate',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('article[data-node-id]').length===4);await ready()
 report.staticMetadata=JSON.parse(await page.locator('.vello-board').getAttribute('data-frame-metadata'))
 assert.equal(report.staticMetadata.renderEngine,'hybrid-0.2');report.checks.push('Static object duplication paints through Hybrid')
 await page.keyboard.press('Delete');await page.waitForFunction(()=>document.querySelectorAll('article[data-node-id]').length===3);await ready();report.checks.push('Deletion remains functional')
 const stage=page.locator('.canvas-stage'),box=await stage.boundingBox();assert(box)
 await page.mouse.move(box.x+box.width*.7,box.y+box.height*.65);await page.mouse.wheel(0,-120);await page.waitForTimeout(400);await ready()
 report.cameraMetadata=JSON.parse(await page.locator('.vello-board').getAttribute('data-frame-metadata'));assert.equal(report.cameraMetadata.renderEngine,'classic-0.10');report.checks.push('Zoom returns to retained Classic in the same browser surface')
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForTimeout(700)
 const saved=await invoke('load_json',{relativePath:'projects/mixed-baseline-500/project.json'});assert.equal(saved.boards[0].nodes.length,3)
 await page.reload();await page.waitForSelector('.boot-loader-skip',{timeout:120000});await page.locator('.boot-loader-skip').click();await ready()
 assert.equal(await page.locator('article[data-node-id]').count(),3);report.checks.push('Save/reload preserves canonical nodes')
 await page.screenshot({path:out+'/workspace.png'});report.final=await page.locator('.vello-board').evaluate(e=>({...e.dataset}))
 assert.deepEqual(report.errors,[]);report.status='SMALL_WEBVIEW_APP_PASS; STRESS_AND_4K_PENDING'
}catch(error){report.errors.push(String(error));report.status='FAILED_OR_INCOMPLETE';process.exitCode=1;if(page){report.failure=await page.locator('.vello-board').evaluate(e=>({...e.dataset})).catch(()=>null);await page.screenshot({path:out+'/failure.png'}).catch(()=>{})}}
finally{
 if(page)await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})).catch(()=>{})
 await browser?.close();if(child.exitCode===null)child.kill()
 const current=await fs.readFile(discovery,'utf8').then(JSON.parse).catch(()=>null);if(current?.pid===child.pid&&prior)await fs.writeFile(discovery,prior)
 await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,status:report.status,checks:report.checks,errors:report.errors}))
}
