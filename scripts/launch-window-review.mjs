import { chromium } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
const out=path.resolve('output/playwright/launch-window-'+Date.now());await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:process.env.AE_UI_SOFTWARE_ONLY==='1'?['--disable-gpu','--disable-webgpu']:[]})
const checks=[],fonts=[];const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name)}
try {
 for(const language of ['en','zh-CN','ja','pt-BR','pt-PT','es']) {
  const context=await browser.newContext({viewport:{width:1440,height:900}})
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(process.env.AE_UI_URL||'http://127.0.0.1:5324/?catalog=demo')
  const boot=page.locator('.boot-loader');await boot.waitFor()
  await boot.locator('.boot-selectors select').first().selectOption(language)
  check(`${language}: launch language and document lang agree`,await boot.getAttribute('lang')===language&&await boot.locator('.boot-selectors select').first().inputValue()===language)
  await boot.locator('.boot-hardware > summary').click()
  await boot.locator('.launch-hardware-settings select').first().selectOption('vulkan')
  await page.reload();await boot.waitFor();await boot.locator('.boot-hardware > summary').click()
  check(`${language}: language and native backend survive reopen`,await boot.getAttribute('lang')===language&&await boot.locator('.launch-hardware-settings select').first().inputValue()==='vulkan')
  await boot.locator('.boot-selectors select').first().focus()
  await boot.locator('.launch-hardware-settings summary').click()
  check(`${language}: unavailable native accelerators stay disabled`,await boot.locator('.launch-hardware-settings select').nth(1).inputValue()==='standard'&&await boot.locator('option[value="cuda-dx12"]').evaluate(o=>o.disabled)&&await boot.locator('option[value="cuda-dx12-upload"]').evaluate(o=>o.disabled))
  await boot.locator('.launch-hardware-settings select').nth(1).focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter')
  check(`${language}: keyboard skips unavailable acceleration choices`,await boot.locator('.launch-hardware-settings select').nth(1).inputValue()==='standard')
  await page.waitForTimeout(10500)
  check(`${language}: editing controls pauses automatic entry`,await boot.isVisible())
  const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable')
  const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.launch-hardware-settings h2'})
  fonts.push({language,...await cdp.send('CSS.getPlatformFontsForNode',{nodeId})})
  await page.screenshot({path:path.join(out,language+'.png')})
  const bounds=await boot.locator('.boot-loader-card').evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})
  check(`${language}: launch card fits viewport`,bounds.left>=0&&bounds.right<=bounds.width&&bounds.top>=0&&bounds.bottom<=bounds.height,bounds)
  await boot.locator('.boot-loader-skip').click();check(`${language}: explicit entry works`,await boot.count()===0)
  check(`${language}: no runtime errors`,errors.length===0,errors);await context.close()
 }
} catch(error) {check("Launch review completes",false,String(error));throw error} finally {await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify({scope:'Browser launch controls only; hardware and native glyph coverage require native evidence',checks,fonts},null,2));console.log(JSON.stringify({out,passed:checks.length===48&&checks.every(c=>c.pass)}))}
if(checks.some(c=>!c.pass))process.exitCode=1
