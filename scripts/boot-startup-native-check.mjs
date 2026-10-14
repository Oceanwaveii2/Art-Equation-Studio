import {chromium} from 'playwright-core'
import fs from 'node:fs/promises'
const out='D:/0/ArtEquation-Tests/2026-10-11-reference-reconstruction/reports/boot-splash'
const browser=await chromium.connectOverCDP('http://127.0.0.1:9345')
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'))
if(!page)throw Error('Native application page missing')
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const workspace=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('workspace_info'))
if(workspace.readOnly||!workspace.root.includes('2026-10-11-boot-splash-alpha'))throw Error('Wrong or read-only workspace')
await page.reload();const boot=page.locator('.boot-loader');await boot.waitFor({timeout:20000});await boot.locator('.boot-selectors select').first().focus()
await boot.locator('img').evaluate(im=>im.decode())
await page.screenshot({path:out+'/native-launch.png'})
const receipt={scope:'Actual packaged native boot and writer verification only; no GPU performance benchmark.',passed:true,workspace,url:page.url(),errors,image:await boot.locator('img').evaluate(im=>({src:im.currentSrc,width:im.naturalWidth,height:im.naturalHeight}))}
if(errors.length)throw Error(errors.join('\n'))
await fs.writeFile(out+'/native-startup.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify({passed:true,workspace:workspace.root,image:receipt.image}))
// Disconnect diagnostics while leaving the user's native application open.
await browser.close()
