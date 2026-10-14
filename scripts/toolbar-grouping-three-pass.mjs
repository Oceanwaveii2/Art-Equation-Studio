import {chromium} from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
const out=path.resolve('output/playwright/toolbar-grouping-'+Date.now());await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce'})
const page=await context.newPage(),report={scope:'Three task-grouping UX passes, panel resizing and minimap browser regression. Disposable data; not native/4K acceptance.',checks:[],errors:[],screenshots:[]}
page.on('pageerror',error=>report.errors.push(error.message))
await page.addInitScript(()=>{window.__uiWindowErrors=[];window.addEventListener('error',event=>window.__uiWindowErrors.push(event.message))})
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name)}
const rail=page.locator('.ocean-toolbar'),panel=page.getByRole('complementary',{name:'Color and Layers utility',exact:true})
const choose=async name=>{const button=rail.locator(`button[aria-label="${name}"]`),details=button.locator('xpath=ancestor::details');if(await details.count()&&!await details.evaluate(el=>el.open))await details.locator('summary').click();await button.click()}
const shot=async name=>{const file=path.join(out,name+'.png');await page.screenshot({path:file});report.screenshots.push(file)}
const newBoard=async()=>{await page.getByRole('button',{name:'Add a document or board',exact:true}).click();await page.getByRole('button',{name:'▧ New board',exact:true}).click();await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Canvas',exact:true}).click()}
try{
 await page.goto((process.env.AE_UI_URL||'http://127.0.0.1:5312')+'/?catalog=demo');await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Canvas',exact:true}).click()
 await rail.waitFor()
 await page.locator('.ocean-toolbar[data-toolbar-layout="expanded"]').waitFor()
 // Pass 1: task taxonomy and no duplicated/misplaced primary actions.
 const domains={
  'Selection tools':['Select and move','Node tool'],
  'Drawing tools':['Pen tool','Pencil tool','Vector Eraser','Type tool'],
  'Shape tools':['Draw rectangle','Draw ellipse','Diagram shapes'],
  'Board tools':['Create subboard','Add card column','Insert image','Group or frame'],
  'Graphing tools':['Create Graph Column','Add Node Column','Draw connector','Draw arrow'],
  'Navigation and view tools':['Hand tool','Zoom tool','Fit board','Actual size 1:1','Fit selection','Previous zoom','Minimap'],
  'Canvas options':['Show grid','Snap to grid','Show diagram structure','Canvas board information']
 }
 for(const [label,expected]of Object.entries(domains)){
  const details=rail.locator('details').filter({has:page.locator(`summary[aria-label="${label}"]`)})
  const actual=await details.locator('button').evaluateAll(items=>items.map(el=>el.getAttribute('aria-label')))
  check(`1: ${label} has the appropriate actions`,expected.every(name=>actual.includes(name))&&actual.every(name=>expected.includes(name)||label==='Drawing tools'&&name==='Draw line'),actual)
 }
 const inventory=await rail.locator('button').evaluateAll(items=>items.map(el=>el.getAttribute('aria-label')))
 check('1: every action has one primary toolbar location',new Set(inventory).size===inventory.length,inventory)
 check('1: Minimap lives only in View',await rail.locator('button[aria-label="Minimap"]').locator('xpath=ancestor::details').locator('summary').getAttribute('aria-label')==='Navigation and view tools')
 check('1: Graph column is the graph family trigger',await rail.locator('summary[aria-label="Graphing tools"]').innerText()==='Graph column')
 check('1: distinct draw/create and navigate/configure rows',await rail.locator(':scope > .canvas-command-row').count()===2)
 await rail.locator('summary[aria-label="Graphing tools"]').click();await shot('pass-1-graph-family');await page.keyboard.press('Escape')
 // Pass 2: real workflows after regrouping, not label-only checks.
 await newBoard();await page.getByRole('button',{name:'Hide Color and Layers',exact:true}).click()
 await choose('Create Graph Column');const created=await page.locator('.board-node').count()
 check('2: Graph family creates a real editable graph object',created===1)
 await choose('Undo board change');check('2: graph creation undo',await page.locator('.board-node').count()===0)
 await choose('Redo board change');check('2: graph creation redo',await page.locator('.board-node').count()===created)
 await choose('Draw connector');check('2: connector tool activates and closes graph flyout',await rail.locator('button[aria-label="Draw connector"]').getAttribute('aria-pressed')==='true'&&await rail.locator('details[open]').count()===0)
 await choose('Select and move')
 const before=await page.locator('.board-minimap').count();await choose('Minimap');check('2: View toggles actual minimap visibility',await page.locator('.board-minimap').count()!==before);await choose('Minimap')
 const grid=rail.locator('button[aria-label="Show grid"]'),was=await grid.getAttribute('aria-pressed');await choose('Show grid');check('2: Canvas options changes actual grid state',await grid.getAttribute('aria-pressed')!==was);await choose('Undo board change');check('2: grid change undo',await grid.getAttribute('aria-pressed')===was)
 for(const label of Object.keys(domains)){
  const trigger=rail.locator(`summary[aria-label="${label}"]`);await trigger.focus();await page.keyboard.press('ArrowDown');const menu=rail.locator('details[open] .canvas-tool-stack-menu');check(`2: ${label} keyboard enters actions`,await menu.evaluate(el=>el.contains(document.activeElement)));await page.keyboard.press('Escape');check(`2: ${label} Escape returns focus`,await trigger.evaluate(el=>document.activeElement===el))
 }
 await shot('pass-2-workflow')
 // Pass 3: themes, constrained workspace, resizing and layer access.
 await page.getByRole('button',{name:'Show Color and Layers',exact:true}).click()
 const height=page.getByRole('separator',{name:'Resize Color and Layers height',exact:true}),width=page.getByRole('separator',{name:'Resize Color and Layers width',exact:true})
 await height.focus();for(let i=0;i<6;i++)await page.keyboard.press('ArrowUp');await page.waitForTimeout(100)
 let p=await panel.boundingBox(),h=await height.boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2,h.y+70,{steps:8});await page.mouse.up();await page.waitForTimeout(100);let q=await panel.boundingBox();check('3: bottom edge increases panel height',q.height>p.height+40,{before:p,after:q})
 await width.focus();await page.keyboard.press('ArrowLeft');check('3: width keeps its minimum',Number(await width.getAttribute('aria-valuenow'))>=282)
 await height.focus();await page.keyboard.press('ArrowUp');check('3: keyboard can adjust height',Number(await height.getAttribute('aria-valuenow'))<q.height)
 await page.waitForTimeout(150)
 const beforeCancel=await panel.boundingBox(),savedHeight=Number(await height.getAttribute('aria-valuenow'));h=await height.boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2,h.y-45,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(150)
 const afterCancel=await panel.boundingBox(),restoredHeight=Number(await height.getAttribute('aria-valuenow'))
 check('3: Escape restores an interrupted resize',restoredHeight===savedHeight&&Math.abs(afterCancel.height-beforeCancel.height)<1,{before:beforeCancel,after:afterCancel,savedHeight,restoredHeight})
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('art-equation.production-studio-layout.2.5')));await page.reload();await panel.waitFor();check('3: saved panel dimensions restore',Number(await height.getAttribute('aria-valuenow'))===saved.height&&Number(await width.getAttribute('aria-valuenow'))===saved.width,saved)
 for(const theme of ['navy','dark','light'])for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:1040,height:720}]){
  await page.setViewportSize(viewport);await page.getByRole('button',{name:`Use ${theme} theme`,exact:true}).click();await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:viewport.width===1280?'Split':'Canvas',exact:true}).click();await page.waitForTimeout(120)
  await panel.getByRole('tab',{name:'Layers',exact:true}).click()
  const layer=panel.getByRole('tabpanel');check(`3: ${theme}/${viewport.width} Layers has its own visible scrolling panel`,await layer.isVisible()&&(await layer.boundingBox()).height>=40)
  const row=layer.locator('.hierarchy-select').first();await row.scrollIntoViewIfNeeded()
  check(`3: ${theme}/${viewport.width} layer row can be reached`,await row.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&el.contains(hit)}))
  const targets=await rail.locator('button,summary').evaluateAll(items=>items.filter(el=>el.getClientRects().length).filter(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !hit||!el.contains(hit)}).map(el=>el.getAttribute('aria-label')))
  check(`3: ${theme}/${viewport.width} toolbar groups unobstructed`,targets.length===0,targets)
  await rail.locator('summary[aria-label="Graphing tools"]').click();await page.waitForTimeout(60)
  const menu=await rail.locator('details[open] .canvas-tool-stack-menu').boundingBox(),stage=await page.locator('.canvas-stage').boundingBox()
  check(`3: ${theme}/${viewport.width} graph menu stays within canvas`,menu.x>=stage.x&&menu.x+menu.width<=stage.x+stage.width+1&&menu.y>=stage.y,{menu,stage})
  const labels=await rail.locator('details[open] .canvas-tool-item-label').evaluateAll(items=>items.map(el=>({text:el.textContent,width:el.getBoundingClientRect().width,needed:el.scrollWidth,available:el.clientWidth})))
  check(`3: ${theme}/${viewport.width} flyout action names remain readable`,labels.every(label=>label.width>100&&label.needed<=label.available),labels)
  await shot(`pass-3-${theme}-${viewport.width}`);await page.keyboard.press('Escape')
  if(viewport.width===1920){const result=await new AxeBuilder({page}).include('.ocean-toolbar').include('.production-studio').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();check(`3: ${theme} controls accessible`,!result.violations.some(v=>['serious','critical'].includes(v.impact)),result.violations)}
 }
 check('3: no runtime/resize errors',report.errors.length===0&&(await page.evaluate(()=>window.__uiWindowErrors)).length===0,report.errors)
}catch(error){report.errors.push(error.stack);check('review completed',false,error.message);await shot('failure')}
finally{report.decision=report.checks.every(c=>c.pass)&&!report.errors.length?'BROWSER_GROUPING_PASS_ONLY':'REJECT';await fs.writeFile(path.join(out,'review.json'),JSON.stringify(report,null,2));await browser.close();console.log(out);if(report.decision==='REJECT')process.exitCode=1}
