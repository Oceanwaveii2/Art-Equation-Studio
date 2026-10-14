import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
const exe=path.resolve(process.argv[2]),out=path.resolve('output/playwright/grid-native-smoke')
await fs.mkdir(out,{recursive:true})
const port=9361,app=spawn(exe,[],{stdio:'ignore',windowsHide:false,env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(out,'profile'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}})
const report={exe,pid:app.pid,scope:'Small copied-workspace native grid, camera, tools and save smoke; no performance qualification',samples:[],errors:[]}
let browser
try{
 for(let i=0;i<80&&!browser;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)}catch{await new Promise(r=>setTimeout(r,250))}}
 assert.ok(browser,'Native inspection connection')
 let page
 for(let i=0;i<80&&!page;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));if(!page)await new Promise(r=>setTimeout(r,250))}
 assert.ok(page,'Native application page')
 page.on('pageerror',e=>report.errors.push(e.message))
 const splash=page.getByRole('button',{name:'Enter now',exact:true});if(await splash.isVisible())await splash.click()
 await page.getByRole('button',{name:'Open application settings',exact:true}).waitFor({timeout:45000})
 report.workspace=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('workspace_info'))
 assert.equal(report.workspace.readOnly,false);assert.equal(report.workspace.lockOwned,true)
 await page.getByRole('group',{name:'Workspace view',exact:true}).getByRole('button',{name:'Canvas',exact:true}).click()
 for(const [label,names] of [['Selection tools',['Select and move']],['Navigation and view tools',['Hand tool']],['Drawing tools',['Draw rectangle','Draw ellipse']]]){
  await page.locator(`.canvas-tool-stack summary[aria-label="${label}"]`).click()
  for(const name of names)assert.equal(await page.getByRole('button',{name,exact:true}).isEnabled(),true)
  await page.keyboard.press('Escape')
 }
 const stage=page.locator('.canvas-stage'),box=await stage.boundingBox();assert.ok(box)
 await page.mouse.move(box.x+box.width*.55,box.y+box.height*.45)
 for(const delta of [0,500,500,-500,-500]){
  if(delta)await page.mouse.wheel(0,delta)
  await page.waitForFunction(()=>{
   const board=document.querySelector('.vello-board'),grid=board?.querySelector('.vello-environment');return board?.dataset.pending==='false'&&grid?.dataset.acceptedGeneration
  },{},{timeout:30000})
  report.samples.push(await page.locator('.vello-board').evaluate(el=>({scale:el.dataset.acceptedScale,ownership:el.dataset.paintOwnership,gridVisible:el.dataset.gridVisible,gridGeneration:el.querySelector('.vello-environment').dataset.acceptedGeneration,gridTransform:el.querySelector('.vello-environment canvas').style.transform})))
  assert.equal(report.samples.at(-1).gridTransform,'')
 }
 await page.locator('.canvas-tool-stack summary[aria-label="Navigation and view tools"]').click()
 await page.getByRole('button',{name:'Hand tool',exact:true}).click()
 await page.mouse.move(box.x+box.width*.65,box.y+box.height*.6);await page.mouse.down();await page.mouse.move(box.x+box.width*.65+40,box.y+box.height*.6+25,{steps:4});await page.mouse.up()
 await page.locator('.canvas-tool-stack summary[aria-label="Selection tools"]').click()
 await page.getByRole('button',{name:'Select and move',exact:true}).click()
 await page.getByRole('button',{name:'Save',exact:true}).click()
 await page.getByRole('contentinfo').getByText('Project saved with recovery backup',{exact:true}).waitFor({timeout:20000})
 await page.screenshot({path:path.join(out,'native-grid.png')})
 assert.deepEqual(report.errors,[]);report.pass=true
}catch(error){report.error=String(error);process.exitCode=1}
finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.unref();await browser?.close()}
