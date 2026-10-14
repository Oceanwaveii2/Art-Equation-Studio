import {chromium} from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
const out=path.resolve('output/playwright/toolbar-six-passes-'+Date.now());await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce'})
const page=await context.newPage()
await page.addInitScript(()=>{
 window.__toolbarWindowErrors=[]
 window.addEventListener('error',event=>window.__toolbarWindowErrors.push(event.message))
})
const report={scope:'Six toolbar visual and interaction passes on disposable demo data. Browser UI only; not native renderer or performance acceptance.',checks:[],errors:[],screenshots:[]}
page.on('pageerror',e=>report.errors.push(e.message))
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name)}
const shot=async name=>{const p=path.join(out,name+'.png');await page.screenshot({path:p});report.screenshots.push(p);await page.locator('.ocean-toolbar').screenshot({path:path.join(out,name+'-toolbar.png')})}
const bounds=()=>page.locator('.ocean-toolbar').evaluate(el=>{
 const r=el.getBoundingClientRect(),stage=el.parentElement.getBoundingClientRect(),controls=[...el.querySelectorAll('button,summary'),...el.parentElement.querySelectorAll('.canvas-zoom-control button')].filter(c=>c.getClientRects().length)
 const blocked=controls.filter(c=>{const q=c.getBoundingClientRect(),hit=document.elementFromPoint(q.x+q.width/2,q.y+q.height/2);return !hit||!c.contains(hit)}).map(c=>c.getAttribute('aria-label'))
 return{layout:el.dataset.toolbarLayout,width:r.width,scrollWidth:el.scrollWidth,height:r.height,inside:r.left>=stage.left&&r.right<=stage.right&&r.bottom<=stage.bottom,centered:Math.abs((r.left+r.right-stage.left-stage.right)/2)<2,blocked,small:controls.filter(c=>{const q=c.getBoundingClientRect();return q.width<30||q.height<30}).map(c=>c.getAttribute('aria-label'))}
})
const choose=async name=>{
 const button=page.locator(`.ocean-toolbar button[aria-label="${name}"]`)
 const details=button.locator('xpath=ancestor::details')
 if(await details.count()&&!await details.evaluate(el=>el.open))await details.locator('summary').click()
 await button.click()
}
try{
 await page.goto((process.env.AE_UI_URL||'http://127.0.0.1:5311')+'/?catalog=demo')
 await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Canvas',exact:true}).click()
 await page.locator('.ocean-toolbar[data-toolbar-layout=expanded]').waitFor()
 const rail=page.locator('.ocean-toolbar')
 // 1: Reference structure and actual tool inventory.
 check('1: two distinct command rows',await rail.locator(':scope > .canvas-command-row').count()===2)
 const inventory=await rail.locator('button').evaluateAll(items=>items.map(el=>el.getAttribute('aria-label')))
 check('1: all original actions retained', ['Select and move','Node tool','Pen tool','Pencil tool','Vector Eraser','Draw line','Draw arrow','Draw connector','Draw rectangle','Draw ellipse','Type tool','Create subboard','Add card column','Add Node Column','Create Graph Column','Insert image','Diagram shapes','Drawing canvas','Group or frame','Hand tool','Zoom tool','Fit board','Actual size 1:1','Fit selection','Previous zoom','Minimap','Show diagram structure','More canvas tools','Undo board change','Redo board change','Hide canvas tool rail'].every(n=>inventory.includes(n)),inventory)
 let b=await bounds();check('1: centered and no clipping/scrollbar',b.inside&&b.centered&&b.scrollWidth<=b.width+1&&b.blocked.length===0,b)
 await shot('pass-1-navy-structure')
 // 2: Typography, coherent line icons and truthful shortcut badges.
 const missing=await rail.locator('.canvas-command-row > .canvas-command-group > button').evaluateAll(items=>items.filter(el=>!el.querySelector('svg,.spectrum-workflow-icon')||!el.querySelector('.canvas-command-caption')).map(el=>el.getAttribute('aria-label')))
 check('2: every command uses a line icon and visible caption',missing.length===0,missing)
 await rail.locator('summary[aria-label="Drawing tools"]').click()
 check('2: real shortcuts shown without former collisions',await rail.getByRole('button',{name:'Vector Eraser',exact:true}).locator('kbd').innerText()==='Shift+E')
 check('2: Type retained in drawing menu',await rail.getByRole('button',{name:'Type tool',exact:true}).isVisible())
 await shot('pass-2-navy-draw-flyout');await page.keyboard.press('Escape')
 // 3: Themes and contrast on the command surface and its flyouts.
 for(const theme of ['navy','dark','light']){
  await page.getByRole('button',{name:`Use ${theme} theme`,exact:true}).click()
  await rail.locator('summary[aria-label="Drawing tools"]').click()
  const axe=await new AxeBuilder({page}).include('.ocean-toolbar').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  check(`3: ${theme} toolbar accessibility`,!axe.violations.some(v=>['serious','critical'].includes(v.impact)),axe.violations)
  const accents=await rail.evaluate(el=>{const button=el.querySelector('button[aria-label="Show grid"]');const probe=document.createElement('i');probe.style.color='var(--command-accent)';el.appendChild(probe);const expected=getComputedStyle(probe).color;probe.remove();return{expected,actual:getComputedStyle(button).borderColor}})
  check(`3: ${theme} pressed commands use their theme accent`,accents.actual===accents.expected,accents)
  await shot('pass-3-'+theme);await page.keyboard.press('Escape')
 }
 // 4: Each group at real Split and Canvas pane widths, in all themes.
 for(const theme of ['navy','dark','light'])for(const width of [1040,1280,1440,1920])for(const mode of ['Canvas','Split']){
  await page.setViewportSize({width,height:width<=1280?720:width===1920?1080:900});await page.getByRole('button',{name:`Use ${theme} theme`,exact:true}).click()
  await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:mode,exact:true}).click()
  // At narrow Split widths the shell intentionally switches to one pane.
  if(!await rail.isVisible()){check(`4: ${theme}/${width}/${mode} compact pane switch`,await page.locator('.compact-split-tabs').isVisible());continue}
  await page.waitForTimeout(100);b=await bounds();check(`4: ${theme}/${width}/${mode} reachable without overlap`,b.inside&&b.centered&&b.scrollWidth<=b.width+1&&b.blocked.length===0&&b.small.length===0,b)
  if(width===1280&&mode==='Split'||theme==='navy'&&width===1440&&mode==='Canvas')await shot(`pass-4-${theme}-${width}-${mode}`)
 }
 // 5: Flyout placement and keyboard operation, closed without altering board.
 await page.setViewportSize({width:1920,height:1080});await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Canvas',exact:true}).click();await page.getByRole('button',{name:'Use navy theme',exact:true}).click()
 for(const label of ['Selection tools','Drawing tools','Board tools','Navigation and view tools']){
  const trigger=rail.locator(`summary[aria-label="${label}"]`);await trigger.focus();await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(50)
  const menu=rail.locator('.canvas-tool-stack[open] .canvas-tool-stack-menu')
  const box=await menu.boundingBox(),stage=await page.locator('.canvas-stage').boundingBox(),toolbar=await rail.boundingBox()
  check(`5: ${label} opens above toolbar within canvas`,!!box&&box.x>=stage.x&&box.x+box.width<=stage.x+stage.width+1&&box.y>=stage.y&&box.y+box.height<=toolbar.y,box)
  check(`5: ${label} arrow reaches actual action`,await menu.evaluate(el=>el.contains(document.activeElement)))
  await page.keyboard.press('End');await page.keyboard.press('Home');await page.keyboard.press('Escape')
  check(`5: ${label} Escape restores focus`,await trigger.evaluate(el=>document.activeElement===el)&&await rail.locator('details[open]').count()===0)
 }
 await shot('pass-5-keyboard-focus')
 // 6: Real board changes and history, hide/restore, unaffected shell functions.
 const utilityClose=page.getByRole('button',{name:'Hide Color and Layers',exact:true});if(await utilityClose.isVisible())await utilityClose.click()
 await page.getByRole('button',{name:'Add a document or board',exact:true}).click();await page.getByRole('button',{name:'▧ New board',exact:true}).click()
 await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Canvas',exact:true}).click()
 const grid=rail.locator('button[aria-label="Show grid"]'),was=await grid.getAttribute('aria-pressed')
 await choose('Show grid');check('6: grid command changes board setting',await grid.getAttribute('aria-pressed')!==was)
 await rail.getByRole('button',{name:'Undo board change',exact:true}).click();check('6: grid undo restores setting',await grid.getAttribute('aria-pressed')===was)
 await rail.getByRole('button',{name:'Redo board change',exact:true}).click();check('6: grid redo replays setting',await grid.getAttribute('aria-pressed')!==was)
 await choose('Draw rectangle')
 const stage=await page.locator('.canvas-stage').boundingBox();await page.mouse.move(stage.x+100,stage.y+120);await page.mouse.down();await page.mouse.move(stage.x+230,stage.y+220,{steps:8});await page.mouse.up()
 check('6: rectangle command draws actual editable object',await page.locator('.board-node').count()===1)
 await rail.getByRole('button',{name:'Export canvas artwork',exact:true}).click();check('6: selection-aware export opens',await page.getByRole('dialog',{name:'Export board',exact:true}).isVisible());await page.getByRole('button',{name:'Close board export',exact:true}).click()
 await rail.getByRole('button',{name:'Hide canvas tool rail',exact:true}).click();check('6: hide releases canvas space',!await rail.isVisible());await page.getByRole('button',{name:'Show canvas tool rail',exact:true}).click();check('6: restore returns both rows',await rail.isVisible())
 await shot('pass-6-interactions')
 const windowErrors=await page.evaluate(()=>window.__toolbarWindowErrors)
 check('6: no runtime or resize-observer errors',report.errors.length===0&&windowErrors.length===0,{page:report.errors,window:windowErrors})
}catch(error){report.errors.push(error.stack);check('review completed',false,error.message);await page.screenshot({path:path.join(out,'failure.png')})}
finally{report.decision=report.checks.every(c=>c.pass)&&!report.errors.length?'BROWSER_TOOLBAR_PASS_ONLY':'REJECT';await fs.writeFile(path.join(out,'review.json'),JSON.stringify(report,null,2));await browser.close();console.log(out);if(report.decision==='REJECT')process.exitCode=1}
