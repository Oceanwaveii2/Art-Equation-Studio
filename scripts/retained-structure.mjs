import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const report={checks:[],errors:[]}
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}})
  page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto('http://127.0.0.1:5173/?canvas-renderer=retained',{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Canvas',exact:true}).click(); await page.getByRole('button',{name:'＋ Board',exact:true}).first().click(); await page.getByRole('button',{name:'Canvas',exact:true}).click(); await page.waitForTimeout(650)
  await page.evaluate(()=>{
    const c=document.createElement('canvas'); c.width=128;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#886644';ctx.fillRect(0,0,128,64)
    const image=c.toDataURL('image/png')
    const nodes=[
      {id:'group',kind:'group',title:'Container',x:0,y:0,width:350,height:350},
      {id:'child',kind:'image',title:'Contained image',x:30,y:80,width:270,height:220,groupId:'group',body:image},
      {id:'under',kind:'image',title:'Under overlap',x:440,y:0,width:270,height:220,body:image},
      {id:'over',kind:'shape',shapeType:'rectangle',title:'Overlapping rectangle',x:500,y:30,width:270,height:180,color:'#668877',body:'Overlap'},
      {id:'note',kind:'note',title:'Editable note',x:440,y:300,width:270,height:180,body:'This text stays accessible.'},
    ]
    localStorage.setItem('art-equation-board-clipboard',JSON.stringify({nodes}));window.dispatchEvent(new ClipboardEvent('paste'))
  })
  await page.getByLabel('Fit selection',{exact:true}).click()
  await page.locator('.canvas-stage').dispatchEvent('contextmenu',{clientX:280,clientY:180});await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const nodes=await page.locator('.board-node').evaluateAll(elements=>elements.map(el=>({label:el.getAttribute('aria-label'),paint:el.dataset.retainedPaint})))
  report.nodes=nodes
  const metrics=await page.locator('.gpu-board').evaluate(el=>JSON.parse(el.dataset.retainedMetrics));report.metrics=metrics
  const resourceBudget=await page.locator('.gpu-board').evaluate(el=>JSON.parse(el.dataset.resourceBudget));report.resourceBudget=resourceBudget
  assert(resourceBudget.pools.retained.bytes===metrics.bytes&&resourceBudget.bytes<=resourceBudget.limit)
  assert.equal(metrics.objects,3,'container, contained image and note should migrate')
  assert.equal(metrics.fallbacks.overlap,2,'overlapping peers must retain DOM ordering')
  assert.equal(await page.locator('.node-image[data-retained-paint="image"]').count(),1)
  assert.equal(await page.getByText('This text stays accessible.',{exact:true}).count(),1)
  report.checks.push('group containment','overlap fallback','semantic note text','shared retained resource budget')
  const buildsBeforeReuse=metrics.builds
  const cachedNode=page.getByLabel('group card: Container'),cachedId=await cachedNode.getAttribute('data-node-id')
  await page.getByLabel('Toggle Appearance panel').click()
  await page.getByLabel('Show board hierarchy').click()
  await page.locator('.hierarchy-select').filter({hasText:'Container'}).click()
  await page.waitForFunction(id=>!document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.dataset.retainedPaint,cachedId)
  const stageBounds=await page.locator('.canvas-stage').boundingBox()
  await page.locator('.canvas-stage').dispatchEvent('contextmenu',{clientX:stageBounds.x+stageBounds.width-40,clientY:stageBounds.y+stageBounds.height-40});await page.keyboard.press('Escape')
  await page.waitForFunction(id=>document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.dataset.retainedPaint==='skin',cachedId)
  const reused=await page.locator('.gpu-board').evaluate(el=>JSON.parse(el.dataset.retainedMetrics));assert.equal(reused.builds,buildsBeforeReuse)
  report.checks.push('idle retained cache reuse avoids rebuild')
  await page.getByLabel('Toggle Appearance panel').click()
  await page.getByLabel('Show canvas diagnostics').click()
  assert(await page.getByText('Managed resources',{exact:true}).isVisible());assert(await page.getByText('Unavailable',{exact:true}).isVisible())
  report.checks.push('budget estimates are visible and exact GPU memory remains unavailable')
  await page.getByLabel('Close canvas diagnostics').click({force:true})
  // Create a free connector in the blank top margin, then disable its dynamic
  // effects through real controls to qualify the static retained connection.
  const stage=await page.locator('.canvas-stage').boundingBox()
  await page.getByLabel('Draw connector',{exact:true}).click()
  await page.mouse.move(stage.x+250,stage.y+30);await page.mouse.down();await page.mouse.move(stage.x+550,stage.y+35,{steps:8});await page.mouse.up()
  await page.getByLabel('Toggle end arrow',{exact:true}).click()
  const animate=page.getByRole('button',{name:'Flow',exact:true})
  await animate.click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(()=>document.querySelectorAll('[data-retained-connection]').length===1)
  const path=page.locator('[data-retained-connection] .connector-path')
  assert.equal(await path.evaluate(el=>getComputedStyle(el).opacity),'0')
  assert.equal(await page.locator('[data-retained-connection] .connector-hit').count(),1)
  report.checks.push('static connector migration and DOM hit target')
  await page.locator('.canvas-stage').screenshot({path:'output/playwright/retained/structure.png'})
  assert.equal(report.errors.length,0,report.errors.join('\n'));report.passed=true
  console.log(JSON.stringify(report))
}finally{await writeFile('output/playwright/retained/structure.json',JSON.stringify(report,null,2));await browser.close()}
