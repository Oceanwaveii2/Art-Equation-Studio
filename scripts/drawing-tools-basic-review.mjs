import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright-core'

const out=path.resolve('output/playwright/drawing-tools-basic-'+Date.now());await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'})
const report={scope:'Disposable browser Pencil, Pen, Eraser, cancellation and history interactions. Does not verify native rasterization, stylus pressure or sustained performance.',checks:[],errors:[]}
page.on('pageerror',error=>report.errors.push(error.message))
const check=(name,condition,detail)=>{report.checks.push({name,pass:!!condition,detail});console.log(condition?'PASS':'FAIL',name);assert(condition,name)}
const rail=page.locator('.ocean-toolbar')
const choose=async name=>{const button=rail.locator(`button[aria-label="${name}"]`),details=button.locator('xpath=ancestor::details');if(await details.count()&&!await details.evaluate(el=>el.open))await details.locator('summary').click();await button.click()}
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const model=async()=>{
 await choose('Select and move');await page.getByRole('button',{name:'Show Color and Layers',exact:true}).click()
 const panel=page.getByRole('complementary',{name:'Color and Layers utility',exact:true});await panel.getByRole('tab',{name:'Layers',exact:true}).click()
 const rows=panel.locator('.hierarchy-select');for(let index=0;index<await rows.count();index++)await rows.nth(index).click({modifiers:index?['Shift']:[]})
 await page.getByRole('button',{name:'Hide Color and Layers',exact:true}).click()
 await page.evaluate(()=>localStorage.removeItem('art-equation-board-clipboard'));await page.keyboard.press('Control+c')
 return page.evaluate(()=>JSON.parse(localStorage.getItem('art-equation-board-clipboard')||'{}').nodes||[])
}
try{
 await page.goto((process.env.AE_UI_URL||'http://127.0.0.1:5312')+'/?catalog=demo')
 const close=page.getByRole('button',{name:'Hide Color and Layers',exact:true});if(await close.isVisible())await close.click()
 await page.getByRole('button',{name:'Add a document or board',exact:true}).click();await page.getByRole('button',{name:'▧ New board',exact:true}).click()
 await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Canvas',exact:true}).click()
 const stage=await page.locator('.canvas-stage').boundingBox()
 const point=(x,y)=>({x:stage.x+x,y:stage.y+y})
 const drag=async(a,b)=>{await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();await settle()}
 await choose('Pencil tool');await page.mouse.move(stage.x+100,stage.y+130);await page.mouse.down();await settle()
 const beforePreview=await page.locator('.canvas-stage').getAttribute('data-react-commits')
 for(let i=1;i<=12;i++){await page.mouse.move(stage.x+100+i*20,stage.y+130+i*50/12);await settle()}
 const preview=await page.evaluate(()=>{
  const stage=document.querySelector('.canvas-stage');return {path:document.querySelector('.freehand-draft path')?.getAttribute('d'),
   reactCommits:stage.dataset.reactCommits,input:JSON.parse(stage.dataset.inputMetrics||'{}'),nodes:document.querySelectorAll('.board-node').length}
 })
 check('Stroke preview is visible without document objects or React canvas commits',!!preview.path&&preview.nodes===0&&preview.reactCommits===beforePreview,preview)
 check('Stroke preview telemetry credits ordered samples and frame publications',preview.input.strokeSamples>=2&&preview.input.strokePreviewFrames>=1,preview.input)
 await page.screenshot({path:path.join(out,'stroke-preview.png')})
 await page.mouse.up();await settle()
 check('Pointer-up clears the transient path',await page.locator('.freehand-draft path').getAttribute('d')==='')
 let nodes=await model();const pencil=nodes[0]
 check('Pencil commits an editable vector path',nodes.length===1&&pencil.shapeType==='path'&&pencil.vectorPath.points.length>=2)
 await choose('Undo board change');check('Pencil undo removes the completed stroke',await page.locator('.board-node').count()===0)
 await choose('Redo board change');nodes=await model();check('Pencil redo restores exact geometry',JSON.stringify(nodes[0]?.vectorPath)===JSON.stringify(pencil.vectorPath))
 await choose('Pencil tool');await page.mouse.move(stage.x+120,stage.y+250);await page.mouse.down();await page.mouse.move(stage.x+230,stage.y+280,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();await settle()
 check('Escape cancels a live stroke without adding an object',await page.locator('.board-node').count()===1)
 check('Escape leaves no transient stroke path',await page.locator('.freehand-draft path').getAttribute('d')==='')
 await choose('Vector Eraser');await drag(point(220,100),point(220,220));nodes=await model()
 check('Eraser edits actual vector geometry',nodes.length!==1||JSON.stringify(nodes[0]?.vectorPath)!==JSON.stringify(pencil.vectorPath))
 await choose('Undo board change');nodes=await model();check('Eraser undo restores original geometry',nodes.length===1&&JSON.stringify(nodes[0]?.vectorPath)===JSON.stringify(pencil.vectorPath))
 await choose('Pen tool');for(const p of [point(420,130),point(520,220),point(640,130)]){await page.mouse.click(p.x,p.y);await settle()}
 await page.keyboard.press('Enter');await settle();nodes=await model();const pen=nodes.find(node=>node.title==='Pen path')
 check('Pen anchors finish into an editable path',nodes.length===2&&pen?.vectorPath.points.length===3)
 await choose('Node tool');check('Direct selection tool activates',await rail.locator('button[aria-label="Node tool"]').getAttribute('aria-pressed')==='true')
 await choose('Undo board change');check('Pen path undo preserves the Pencil path',await page.locator('.board-node').count()===1)
 await choose('Redo board change');check('Pen path redo restores both objects',await page.locator('.board-node').count()===2)
 check('No browser runtime errors',!report.errors.length,report.errors)
 await page.screenshot({path:path.join(out,'drawing-tools.png')})
}catch(error){report.errors.push(error.stack);await page.screenshot({path:path.join(out,'failure.png')})}
finally{report.decision=report.checks.every(c=>c.pass)&&!report.errors.length?'BROWSER_DRAWING_PASS_ONLY':'REJECT';await fs.writeFile(path.join(out,'review.json'),JSON.stringify(report,null,2));await browser.close();console.log(out);if(report.decision==='REJECT')process.exitCode=1}
