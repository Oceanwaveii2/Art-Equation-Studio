import fs from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
import assert from 'node:assert/strict'
const root='D:/0/ArtEquation-Tests/2026-10-11-reference-reconstruction',build=root+'/builds/2026-10-11-launch-layout-alpha',out=root+'/reports/launch-layout'
const child=spawn(build+'/Art-Equation-alpha.exe',[],{windowsHide:true,stdio:'ignore',env:{...process.env,ART_EQUATION_WORKSPACE_ROOT:build,WEBVIEW2_USER_DATA_FOLDER:out+'/native-profile',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9347'}})
let browser,page
const receipt={scope:'Packaged EXE launch controls and workspace layout only; no performance or release qualification.',passed:false,errors:[]}
try{
 for(let i=0;i<150;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9347');break}catch{await new Promise(r=>setTimeout(r,200))}}
 assert.ok(browser,'Native debug connection')
 for(let i=0;i<150;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));if(page)break;await new Promise(r=>setTimeout(r,200))}
 assert.ok(page,'Native app page');page.on('pageerror',e=>receipt.errors.push(e.message))
 const boot=page.locator('.boot-loader');await boot.waitFor({timeout:20000});await boot.locator('.boot-selectors select').focus()
 const workspace=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('workspace_info'));assert.ok(!workspace.readOnly&&workspace.root.includes('launch-layout-alpha'));receipt.workspace=workspace
 await boot.locator('img').evaluate(im=>im.decode());await boot.locator('.boot-layout-trigger').click();assert.equal(await boot.getByRole('listbox').getByRole('option').count(),3)
 await page.screenshot({path:out+'/native-launch.png'});await boot.getByRole('option',{name:'Advanced Split',exact:true}).click();await boot.locator('.boot-loader-skip').click();await boot.waitFor({state:'detached'})
 const split=page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Split',exact:true});assert.equal(await split.getAttribute('aria-pressed'),'true');assert.equal(receipt.errors.length,0);receipt.passed=true
 const info=JSON.parse(await fs.readFile(build+'/BUILD-INFO.json','utf8'));info.status='FOUR_UI_PASSES_AND_NATIVE_LAUNCH_VERIFIED; NOT_RELEASE_QUALIFIED';info.nativeReview=out+'/native-launch.json';await fs.writeFile(build+'/BUILD-INFO.json',JSON.stringify(info,null,2))
}catch(e){receipt.errors.push(String(e));if(page)await page.screenshot({path:out+'/native-failure.png'}).catch(()=>{});process.exitCode=1}
finally{await fs.writeFile(out+'/native-launch.json',JSON.stringify(receipt,null,2));if(page)await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})).catch(()=>{});await browser?.close();if(child.exitCode===null)child.kill();console.log(JSON.stringify(receipt))}
