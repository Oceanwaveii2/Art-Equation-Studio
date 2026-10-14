import {chromium} from 'playwright-core'
import {preview} from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const out=path.resolve('output/playwright/boot-splash-four-pass-'+Date.now());await fs.mkdir(out,{recursive:true})
const server=await preview({preview:{host:'127.0.0.1',port:0}})
const url=server.resolvedUrls.local[0]+'?catalog=demo'
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-gpu','--disable-webgpu']})
const report={url,scope:'Four browser UI passes using built output and software rendering; no GPU benchmark or native qualification.',passes:[],errors:[]}
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message))
const check=(pass,name,value)=>{assert.ok(value,name);pass.checks.push(name)}
const boot=page.locator('.boot-loader'),language=()=>boot.locator('.boot-selectors select').first(),theme=()=>({selectOption:async value=>{const details=boot.locator('.boot-hardware');if(!await details.evaluate(e=>e.open))await details.locator(':scope > summary').click();await boot.locator('.boot-colour-themes button').nth(['navy','dark','light'].indexOf(value)).click();await details.locator(':scope > summary').click()},inputValue:async()=>page.locator('.studio-shell').evaluate(e=>['navy','dark','light'].find(t=>e.classList.contains('workspace-'+t)))})
const shot=name=>page.screenshot({path:out+'/'+name+'.png'})
try{
 await page.goto(url);await boot.waitFor();await language().focus()
 const p1={name:'1. Reference composition and responsive geometry',checks:[]};report.passes.push(p1)
 await boot.locator('img').evaluate(async im=>{await im.decode()})
 for(const [width,height] of [[1440,1000],[1280,720],[1920,1080],[390,640]]){
  await page.setViewportSize({width,height});await shot('pass1-'+width)
  const g=await boot.evaluate(el=>{const r=el.querySelector('.boot-loader-card').getBoundingClientRect(),im=el.querySelector('img'),ir=im.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,vw:innerWidth,vh:innerHeight,natural:[im.naturalWidth,im.naturalHeight],ratio:ir.width/ir.height,overflow:document.documentElement.scrollWidth>innerWidth}})
  check(p1,'card fits '+width,g.left>=0&&g.right<=g.vw&&g.top>=0&&g.bottom<=g.vh&&!g.overflow)
  check(p1,'uncropped supplied artwork '+width,g.natural[0]===4812&&g.natural[1]===3478&&Math.abs(g.ratio-4812/3478)<.002)
 }
 await page.setViewportSize({width:1440,height:1000})
 const p2={name:'2. Language, workspace presets and colour theme selection',checks:[]};report.passes.push(p2)
 for(const lang of ['en','zh-CN','ja','pt-BR','pt-PT','es']){
  await language().selectOption(lang);check(p2,'dialog language '+lang,await boot.getAttribute('lang')===lang)
  await shot('pass2-'+lang)
 }
 await language().selectOption('en')
 const layout=boot.getByRole('combobox',{name:'UI theme',exact:true});await layout.click();await shot('layout-reference-open');check(p2,'three workspace presets',await boot.getByRole('listbox').getByRole('option').count()===3);await boot.getByRole('option',{name:'Graphing',exact:true}).click();check(p2,'Graphing selected',(await layout.innerText()).replace(/\s/g,'')==='Graphing⌄');await layout.click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');check(p2,'Escape closes preset list',await layout.getAttribute('aria-expanded')==='false');await layout.click();await boot.getByRole('option',{name:'Advanced Split',exact:true}).click();await page.reload();await boot.waitFor();await language().focus();check(p2,'workspace preset survives reopen',(await boot.locator('.boot-layout-trigger').innerText()).includes('Advanced Split'));
 for(const value of ['navy','dark','light']){await theme().selectOption(value);check(p2,'workspace receives '+value,await page.locator('.studio-shell.workspace-'+value).count()===1);await shot('pass2-theme-'+value)}
 await page.reload();await boot.waitFor();await language().focus();check(p2,'theme survives reopen',await theme().inputValue()==='light')
 const p3={name:'3. Contextual hardware and acceleration controls',checks:[]};report.passes.push(p3)
 await boot.locator('.boot-hardware > summary').click();const hardware=boot.locator('.launch-hardware-settings')
 check(p3,'browser does not claim detected native hardware',(await hardware.innerText()).includes('native hardware check requires the EXE'))
 await hardware.locator('select').first().selectOption('vulkan');await hardware.locator('summary').click()
 check(p3,'unavailable NVIDIA paths stay disabled',await hardware.locator('option[value="cuda-dx12"]').evaluate(e=>e.disabled)&&await hardware.locator('option[value="cuda-dx12-upload"]').evaluate(e=>e.disabled))
 await shot('pass3-hardware');await hardware.locator('select').first().focus();await page.keyboard.press('Escape');check(p3,'Escape closes hardware without dismissing launch',await boot.count()===1&&!await boot.locator('.boot-hardware').evaluate(e=>e.open))
 const p4={name:'4. Keyboard, persistence and entry',checks:[]};report.passes.push(p4)
 await boot.locator('.boot-loader-skip').focus();await page.keyboard.press('Tab');check(p4,'Tab stays in launcher',await page.evaluate(()=>!!document.activeElement.closest('.boot-loader')))
 await language().selectOption('ja');await theme().selectOption('navy');await page.reload();await boot.waitFor();await language().focus();check(p4,'language and theme survive reopen',await boot.getAttribute('lang')==='ja'&&await theme().inputValue()==='navy')
 await page.waitForTimeout(10500);check(p4,'selection pauses automatic entry',await boot.isVisible())
 await shot('pass4-keyboard');await boot.locator('.boot-loader-skip').click();check(p4,'explicit Enter opens workspace',await boot.count()===0);check(p4,'Advanced Split applied',await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Split',exact:true}).getAttribute('aria-pressed')==='true')
 check(p4,'no runtime errors',report.errors.length===0);report.passed=true
}catch(error){report.passed=false;report.error=String(error);await shot('failure');throw error}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();server.httpServer.close();console.log(JSON.stringify({out,passed:report.passed,passes:report.passes.map(p=>({name:p.name,checks:p.checks.length})),error:report.error}))}
