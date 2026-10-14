import { chromium } from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs/promises'
import path from 'node:path'

const out=path.resolve('output/playwright/ui-four-passes-'+Date.now())
const reviewUrl=new URL(process.env.AE_UI_URL||'http://127.0.0.1:5276')
reviewUrl.searchParams.set('catalog','demo')
await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:process.env.AE_UI_SOFTWARE_ONLY==='1'?['--disable-gpu','--disable-webgpu']:[]})
const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'no-preference'})
const page=await context.newPage()
const report={url:reviewUrl.href,scope:'Prototype 2.5 shell using the canonical production controller in a fresh, disposable browser context, built-in demo boards and real retained rich documents. UI workflow/layout/keyboard reachability review only; not native font, GPU pixel, persistence or Retina qualification.',checks:[],matrix:[],formattingReachability:[],accessibility:[],documentFlow:{},errors:[]}
page.on('pageerror',error=>report.errors.push(error.message))
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name)}
const shot=async name=>page.screenshot({path:path.join(out,name+'.png')})
const geometry=async()=>page.locator('.board-node').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.nodeId,style:node.getAttribute('style')})))
const paneState=async()=>page.evaluate(()=>{
  const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.closest('[hidden],[inert]')&&getComputedStyle(el).visibility!=='hidden'}
  const pane=[...document.querySelectorAll('.retained-document-session .document-pane')].find(visible)
  const stage=document.querySelector('.canvas-stage')
  return {documentVisible:!!pane,canvasVisible:!!stage&&visible(stage),documentId:pane?.closest('[data-document-id]')?.dataset.documentId,fields:pane?[...pane.querySelectorAll('input,textarea,select')].map(el=>({name:el.getAttribute('aria-label')||el.name,value:el.value})):[]}
})
const reviewAccessibility=async(scope)=>{
  const axe=await new AxeBuilder({page}).include('.studio-shell').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
  const violations=axe.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,help:v.help,nodes:v.nodes.map(n=>({target:n.target,html:n.html,failureSummary:n.failureSummary,any:n.any,all:n.all,none:n.none}))}))
  report.accessibility.push({scope,violations})
  check(`${scope}: no serious/critical accessibility findings`,!axe.violations.some(v=>v.impact==='serious'||v.impact==='critical'),violations)
}
const reviewChromeReachability=async(scope)=>{
  const controls=await page.evaluate(()=>{
    const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.closest('[hidden],[inert]')&&getComputedStyle(el).visibility!=='hidden'}
    return [...document.querySelectorAll('.app-header-actions button:enabled,.p25-windowbar button,.p25-workspace-heading button,.p25-document-chooser summary,.compact-split-tabs button:enabled,.canvas-tool-rail button:enabled,.canvas-tool-rail summary,.canvas-zoom-control button:enabled,.production-studio-title button,.production-studio-title select,.production-studio-tabs button,.production-studio-footer button')].filter(visible).map(el=>{
      const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2
      const scrollTrack=el.closest('.canvas-tool-rail,.p25-document-tabs-track'),clip=scrollTrack?.getBoundingClientRect()
      const centreVisible=x>=0&&y>=0&&x<=innerWidth&&y<=innerHeight&&(!clip||x>=clip.left&&x<=clip.right&&y>=clip.top&&y<=clip.bottom)
      const hit=centreVisible?document.elementFromPoint(x,y):null
      return{name:el.getAttribute('aria-label')||el.textContent?.trim(),centreVisible,scrollTrack:!!scrollTrack,clickable:!!hit&&(hit===el||el.contains(hit)),coveredBy:hit?.closest('.production-studio')?'Color and Layers utility':hit?.getAttribute('class'),width:r.width,height:r.height}
    })
  })
  const blocked=controls.filter(item=>(!item.scrollTrack||item.centreVisible)&&!item.clickable)
  check(`${scope}: required chrome has unobstructed pointer targets`,blocked.length===0,{blocked,controls})
}
const reviewFormattingReachability=async(prefix,screenshot)=>{
  const pane=page.locator('.retained-document-session .document-pane:visible')
  const editor=pane.locator('.tiptap'),controls=pane.locator('.document-formatting-controls')
  await controls.waitFor({state:'visible'})
  const before=await editor.innerHTML()
  const history=()=>pane.locator('button[aria-label="Undo text change"],button[aria-label="Redo text change"]').evaluateAll(buttons=>buttons.map(button=>({name:button.getAttribute('aria-label'),disabled:button.disabled})))
  const historyBefore=await history()
  const names=['Paragraph style','Font family','Font size','Font weight','Letter spacing']
  const inventory=await controls.evaluate((el,names)=>{
    const fontControls=names.map(name=>{
      const target=el.querySelector(`select[aria-label="${name}"]`)
      if(!target)return{name,missing:true}
      const rect=target.getBoundingClientRect(),style=getComputedStyle(target)
      return{name,display:style.display,visibility:style.visibility,width:rect.width,height:rect.height,disabled:target.disabled,value:target.value}
    })
    return{fontControls,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,scrollbarWidth:getComputedStyle(el).scrollbarWidth}
  },names)
  check(`${prefix}: formatting selectors remain rendered at full target size`,inventory.fontControls.every(item=>!item.missing&&item.display!=='none'&&item.visibility==='visible'&&item.width>=32&&item.height>=32),inventory)
  check(`${prefix}: overflowing formatting has a visible scroll affordance`,inventory.scrollWidth<=inventory.clientWidth+1||inventory.scrollbarWidth!=='none',inventory)
  // Tab through the actual native controls. Locator visibility alone does not
  // prove a clipped control is reachable, or that it scrolls into view on focus.
  await controls.locator('button').first().focus()
  const visited=[]
  for(let step=0;step<64;step++){
    const focused=await controls.evaluate(el=>{
      const active=document.activeElement
      if(!active||!el.contains(active))return null
      const target=active instanceof HTMLInputElement&&active.type==='color'?active.closest('label')||active:active
      const rect=target.getBoundingClientRect(),viewport=el.getBoundingClientRect(),style=getComputedStyle(target)
      return{name:active.getAttribute('aria-label')||active.textContent?.trim()||active.tagName,tag:active.tagName,display:style.display,visibility:style.visibility,width:rect.width,height:rect.height,inside:rect.left>=viewport.left-1&&rect.right<=viewport.right+1&&rect.top>=viewport.top-1&&rect.bottom<=viewport.bottom+1,scrollLeft:el.scrollLeft}
    })
    if(!focused)break
    visited.push(focused)
    await page.keyboard.press('Tab')
  }
  const reached=names.every(name=>visited.some(item=>item.name===name))
  check(`${prefix}: keyboard reaches every font control inside the scrolling viewport`,reached&&visited.every(item=>item.inside&&item.display!=='none'&&item.visibility==='visible'&&item.width>=32&&item.height>=32),visited)
  const more=pane.getByRole('button',{name:'More formatting',exact:true})
  const moreReachable=await more.evaluate(el=>{
    const rect=el.getBoundingClientRect(),pane=el.closest('.document-pane').getBoundingClientRect()
    return{visible:getComputedStyle(el).display!=='none'&&rect.width>0&&rect.height>0,inside:rect.left>=pane.left-1&&rect.right<=pane.right+1&&rect.top>=pane.top-1&&rect.bottom<=pane.bottom+1,focused:document.activeElement===el}
  })
  check(`${prefix}: More stays reachable after keyboard overflow traversal`,moreReachable.visible&&moreReachable.inside&&moreReachable.focused,moreReachable)
  // Leave the family choice in view for the saved screenshot. This only moves
  // native control focus/scroll position; it never changes a selector value.
  await controls.getByRole('combobox',{name:'Font family',exact:true}).focus()
  const focusUnchanged=before===await editor.innerHTML()&&JSON.stringify(historyBefore)===JSON.stringify(await history())
  check(`${prefix}: formatting inspection and focus do not edit text or history`,focusUnchanged)
  report.formattingReachability.push({scope:prefix,inventory,visited,moreReachable,contentAndHistoryUnchanged:focusUnchanged})
  if(screenshot)await shot(screenshot)
}
try{
  await page.goto(reviewUrl.href,{waitUntil:'domcontentloaded'})
  await page.locator('[data-ui-shell="prototype-2.5"][data-engine-integration="canonical-production-controller"]').waitFor()
  await page.getByRole('group',{name:'Workspace theme',exact:true}).waitFor()
  // Pass 1: shell type/surface hierarchy and preserved aquarium identity.
  check('Pass 1: aquarium and water band preserved',await page.locator('.aquarium-scene').count()===1&&await page.locator('.aquarium-water-band').count()===1)
  const type=await page.locator('.app-header-actions').evaluate(el=>getComputedStyle(el).fontFamily)
  check('Pass 1: installed shell font stack',type.includes('Segoe'),type)
  for(const theme of ['navy','dark','light']){
    const button=page.getByRole('button',{name:`Use ${theme} theme`})
    check(`Pass 1: ${theme} named vector symbol`,await button.locator(`svg[data-theme-icon="${theme}"]`).count()===1)
    await button.click()
    check(`Pass 1: ${theme} selected state`,await button.getAttribute('aria-pressed')==='true')
    await shot(`pass-1-${theme}-shell`)
  }
  const moon=await page.locator('[data-theme-icon="dark"] path').evaluate(el=>getComputedStyle(el).fill)
  check('Pass 1: crescent remains white',moon==='rgb(255, 255, 255)',moon)
  await page.getByRole('button',{name:'Use navy theme'}).click()
  await shot('pass-1-navy-shell')

  // Pass 2: document-only views retain editors; board navigation stays separate.
  const views=page.getByRole('group',{name:'Workspace view',exact:true})
  await views.getByRole('button',{name:'Document',exact:true}).click()
  const tabs=page.locator('.p25-document-tabs-track')
  const visiblePane=()=>page.locator('.retained-document-session .document-pane:visible')
  const visibleEditor=()=>visiblePane().locator('.tiptap')
  const createDocument=async()=>{
    await page.getByLabel('Open or create a document',{exact:true}).click()
    await page.locator('.p25-document-chooser-panel').getByRole('button',{name:'＋ New document',exact:true}).click()
    await visibleEditor().waitFor()
    return (await tabs.getByRole('tab',{selected:true}).innerText()).replace(/^¶\s*/,'').trim()
  }
  const caret=editor=>editor.evaluate(el=>{
    const selection=getSelection();let node=selection?.anchorNode;const path=[]
    while(node&&node!==el){path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes,node));node=node.parentNode}
    return{path,offset:selection?.anchorOffset,text:selection?.anchorNode?.textContent,inEditor:node===el}
  })
  const canonicalDocuments=async()=>{
    await page.getByLabel('Open or create a document',{exact:true}).click()
    const names=await page.locator('.p25-document-chooser-list>button>span').allTextContents()
    await page.keyboard.press('Escape')
    return names
  }
  const first=await createDocument(),alpha=await visibleEditor().elementHandle()
  await visibleEditor().focus();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.insertText('QA_ALPHA_MARKER')
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft')
  const alphaCaret=await caret(visibleEditor()),alphaText=await visibleEditor().textContent()
  const second=await createDocument(),beta=await visibleEditor().elementHandle()
  await visibleEditor().focus();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.insertText('QA_BETA_MARKER')
  const betaText=await visibleEditor().textContent(),canonicalBefore=await canonicalDocuments()
  check('Pass 2: document chooser contains both rich documents and questionnaire',canonicalBefore.length===3,canonicalBefore)
  await tabs.getByRole('tab',{name:first,exact:true}).click();await visibleEditor().focus()
  check('Pass 2: switching restores the same Alpha editor and content',await visibleEditor().evaluate((el,original)=>el===original,alpha)&&await visibleEditor().textContent()===alphaText)
  await page.waitForFunction(expected=>{
    const el=document.querySelector('.retained-document-session:not([hidden]) .tiptap')
    if(!el)return false
    const selection=getSelection();let node=selection?.anchorNode;const path=[]
    while(node&&node!==el){path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes,node));node=node.parentNode}
    return JSON.stringify({path,offset:selection?.anchorOffset,text:selection?.anchorNode?.textContent,inEditor:node===el})===JSON.stringify(expected)
  },alphaCaret,{timeout:2000}).catch(()=>{})
  const restoredCaret=await caret(visibleEditor())
  check('Pass 2: switching preserves exact Alpha caret',JSON.stringify(alphaCaret)===JSON.stringify(restoredCaret),{alphaCaret,restoredCaret})
  await visiblePane().getByRole('button',{name:'Undo text change',exact:true}).click()
  check('Pass 2: Alpha undo is independent of Beta',!(await visibleEditor().textContent()).includes('QA_ALPHA_MARKER')&&await beta.evaluate(el=>el.textContent)===betaText)
  await visiblePane().getByRole('button',{name:'Redo text change',exact:true}).click()
  check('Pass 2: retained Alpha redo restores text',(await visibleEditor().textContent()).includes('QA_ALPHA_MARKER'))
  const tabsBeforeBoard=await tabs.getByRole('tab').allTextContents()
  await page.locator('.navigator button.tree-row').filter({hasText:'Character development'}).click()
  await views.getByRole('button',{name:'Document',exact:true}).click()
  check('Pass 2: board navigation never adds document tabs',JSON.stringify(await tabs.getByRole('tab').allTextContents())===JSON.stringify(tabsBeforeBoard))
  await page.getByRole('button',{name:'Close document tab: Project questionnaire',exact:true}).click()
  check('Pass 2: closing inactive questionnaire preserves Alpha',await tabs.getByRole('tab',{name:first,exact:true}).getAttribute('aria-selected')==='true')
  await page.getByRole('button',{name:'Close document tab: '+first,exact:true}).click()
  check('Pass 2: closing active Alpha chooses the same retained Beta editor',await tabs.getByRole('tab',{name:second,exact:true}).getAttribute('aria-selected')==='true'&&await visibleEditor().evaluate((el,original)=>el===original,beta))
  await page.getByRole('button',{name:'Close document tab: '+second,exact:true}).click()
  check('Pass 2: final close leaves an empty writing surface',await page.getByRole('heading',{name:'No open documents',exact:true}).isVisible()&&await visibleEditor().count()===0)
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open or create a document',undefined,{timeout:2000}).catch(()=>{})
  check('Pass 2: final close keeps chooser keyboard focus' ,await page.getByLabel('Open or create a document',{exact:true}).evaluate(el=>document.activeElement===el))
  await shot('pass-2-empty-document-views')
  const canonicalAfter=await canonicalDocuments()
  check('Pass 2: all tab closes preserve canonical documents',JSON.stringify(canonicalBefore)===JSON.stringify(canonicalAfter),{canonicalBefore,canonicalAfter})
  await page.getByLabel('Open or create a document',{exact:true}).click()
  await page.locator('.p25-document-chooser-list').getByRole('button',{name:first,exact:true}).click()
  check('Pass 2: chooser reopens the same Alpha editor, content and history',await visibleEditor().evaluate((el,original)=>el===original,alpha)&&(await visibleEditor().textContent()).includes('QA_ALPHA_MARKER')&&!await visiblePane().getByRole('button',{name:'Undo text change',exact:true}).isDisabled())
  await visibleEditor().focus();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.insertText('Alpha scroll verification. '.repeat(300))
  const stage=visiblePane().locator('.document-stage')
  const scrollBefore=await stage.evaluate(el=>{el.scrollTop=280;return{scrollTop:el.scrollTop,height:el.clientHeight,scrollHeight:el.scrollHeight}})
  await page.getByLabel('Open or create a document',{exact:true}).click()
  await page.locator('.p25-document-chooser-list').getByRole('button',{name:second,exact:true}).click()
  await tabs.getByRole('tab',{name:first,exact:true}).click()
  const scrollAfter=await stage.evaluate(el=>({scrollTop:el.scrollTop,height:el.clientHeight,scrollHeight:el.scrollHeight}))
  check('Pass 2: real scroll position survives switching',scrollBefore.scrollHeight>scrollBefore.height&&scrollBefore.scrollTop===280&&Math.abs(scrollAfter.scrollTop-scrollBefore.scrollTop)<=1,{scrollBefore,scrollAfter})
  await tabs.getByRole('tab',{name:first,exact:true}).focus();await page.keyboard.press('End')
  // Tab focus deliberately follows activation on the presentation frame.
  // Wait for the actual aria/focus outcome rather than racing that frame.
  await page.waitForFunction(id=>{const tab=document.getElementById(id);return tab?.getAttribute('aria-selected')==='true'&&document.activeElement===tab},await tabs.getByRole('tab',{name:second,exact:true}).getAttribute('id'),{timeout:2000})
  check('Pass 2: End activates and focuses final document tab',await tabs.getByRole('tab',{name:second,exact:true}).getAttribute('aria-selected')==='true'&&await tabs.getByRole('tab',{name:second,exact:true}).evaluate(el=>document.activeElement===el))
  await page.keyboard.press('Home')
  await page.waitForFunction(id=>{const tab=document.getElementById(id);return tab?.getAttribute('aria-selected')==='true'&&document.activeElement===tab},await tabs.getByRole('tab',{name:first,exact:true}).getAttribute('id'),{timeout:2000})
  check('Pass 2: Home activates first document tab',await tabs.getByRole('tab',{name:first,exact:true}).getAttribute('aria-selected')==='true')
  await page.keyboard.press('Delete')
  check('Pass 2: keyboard Delete closes a view only',await tabs.getByRole('tab').count()===1&&(await canonicalDocuments()).length===3)
  await page.getByLabel('Open or create a document',{exact:true}).click()
  await page.getByRole('textbox',{name:'Open document',exact:true}).fill(first)
  const searchResults=await page.locator('.p25-document-chooser-list>button').allTextContents()
  check('Pass 2: chooser search finds existing canonical document',searchResults.length===1&&searchResults[0].includes(first),searchResults)
  await page.locator('.p25-document-chooser-list').getByTitle(first,{exact:true}).click()
  report.documentFlow={first,second,canonicalBefore,canonicalAfter,alphaCaret,restoredCaret,scrollBefore,scrollAfter}
  const documentPane=visiblePane(),fontMenu=documentPane.getByRole('combobox',{name:'Font family',exact:true})
  const pageInspector=documentPane.getByRole('complementary',{name:'Page layout and document statistics',exact:true})
  check('Pass 2: actual rich editor starts without a crowded page inspector',await pageInspector.count()===0)
  const documentHtml=await visibleEditor().innerHTML()
  await documentPane.getByRole('button',{name:'Toggle page layout inspector',exact:true}).click();await pageInspector.waitFor()
  await shot('pass-2-page-inspector')
  await pageInspector.getByRole('button',{name:'Close page layout inspector',exact:true}).click()
  check('Pass 2: page inspector inspection leaves text unchanged',await pageInspector.count()===0&&await visibleEditor().innerHTML()===documentHtml)
  const fontChoices=await fontMenu.locator('option').evaluateAll(options=>options.map(option=>({value:option.value,label:option.textContent,title:option.title})))
  check('Pass 2: font menu exposes paragraph default',fontChoices.some(option=>option.value===''&&option.label==='Default (paragraph style)'),fontChoices)
  check('Pass 2: browser font choices disclose unverified availability',fontChoices.filter(option=>option.value).length>0&&fontChoices.filter(option=>option.value).every(option=>/\((Unverified|Font stack|Generic family)\)$/.test(option.label)),fontChoices)
  check('Pass 2: current font choice explains its rendering scope',Boolean(await fontMenu.getAttribute('title')))
  await views.getByRole('button',{name:'Split',exact:true}).click()
  const documentBefore=await paneState()
  await page.setViewportSize({width:1040,height:720})
  const paneSwitch=page.getByRole('group',{name:'Split workspace pane',exact:true})
  await paneSwitch.waitFor({state:'visible'})
  check('Pass 2: narrow Split exposes both pane choices',await paneSwitch.getByRole('button').count()===2)
  await paneSwitch.getByRole('button',{name:'Document',exact:true}).click()
  const compactDocument=await paneState()
  check('Pass 2: compact document pane remains usable',compactDocument.documentVisible&&!compactDocument.canvasVisible&&compactDocument.documentId===documentBefore.documentId,compactDocument)
  await reviewFormattingReachability('Pass 2: compact 1040px Split document','pass-2-compact-document-fonts')
  await page.setViewportSize({width:1920,height:1080});await paneSwitch.waitFor({state:'hidden'})
  const wideDocument=await paneState()
  check('Pass 2: expanding Split preserves document and fields',wideDocument.documentVisible&&wideDocument.canvasVisible&&wideDocument.documentId===documentBefore.documentId&&JSON.stringify(wideDocument.fields)===JSON.stringify(documentBefore.fields),wideDocument)
  await page.setViewportSize({width:1040,height:720});await paneSwitch.waitFor({state:'visible'})
  check('Pass 2: compact Split remembers its document pane',await paneSwitch.getByRole('button',{name:'Document',exact:true}).getAttribute('aria-pressed')==='true')
  await paneSwitch.getByRole('button',{name:'Canvas',exact:true}).click()
  const compactCanvas=await paneState()
  check('Pass 2: compact canvas pane remains usable',compactCanvas.canvasVisible&&!compactCanvas.documentVisible,compactCanvas)
  await shot('pass-2-compact-canvas')
  await page.setViewportSize({width:1920,height:1080})
  // Pass 3: the floating utility exposes canonical selection, layers and paint.
  await views.getByRole('button',{name:'Canvas',exact:true}).click()
  await page.locator('.navigator button.tree-row').filter({hasText:'Master reference board'}).click()
  await page.getByRole('button',{name:'Show Color and Layers',exact:true}).click()
  const studio=page.getByRole('complementary',{name:'Color and Layers utility',exact:true})
  await studio.waitFor()
  check('Pass 3: Color and Layers is a visible utility, not a hidden Appearance popover',await studio.isVisible()&&await page.locator('.appearance-popover').count()===0)
  check('Pass 3: one Color and Layers entry with Object inside the utility',await page.getByRole('button',{name:'Show Color and Layers',exact:true}).count()===1&&await page.getByRole('button',{name:'Toggle object color controls',exact:true}).count()===0&&await page.getByRole('button',{name:'Open selected object properties',exact:true}).count()===0&&await studio.getByRole('tab',{name:'Object',exact:true}).count()===1)
  check('Pass 3: embedded paint has one utility close control',await studio.getByRole('button',{name:'Close color controls',exact:true}).count()===0&&await studio.getByRole('button',{name:'Hide Color and Layers',exact:true}).count()===1)
  check('Pass 3: paint and Layers have separate bounded scrolling',await studio.evaluate(n=>{const paint=n.querySelector('.production-studio-paint'),layers=n.querySelector('.production-studio-layers'),footer=n.querySelector('.production-studio-footer');const p=paint.getBoundingClientRect(),l=layers.getBoundingClientRect(),f=footer.getBoundingClientRect();return getComputedStyle(paint).overflowY==='auto'&&p.bottom<=l.top+1&&l.bottom<=f.top+1&&l.height>=90}))

  const initialGeometry=await geometry(),studioTabs=studio.getByRole('tablist',{name:'Studio controls',exact:true})
  check('Pass 3: utility stays floating with no docking control',await studio.getByRole('combobox',{name:'Panel position',exact:true}).count()===0&&await page.locator('.studio-shell').getAttribute('data-production-studio-dock')==='floating')
  const title=studio.getByLabel('Move Color and Layers; arrow keys move, Home resets position',{exact:true})
  await title.focus();await page.keyboard.press('Home');await page.waitForTimeout(150)
  const positionBefore=await studio.boundingBox()
  await title.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(100)
  const positionAfter=await studio.boundingBox()
  check('Pass 3: utility has keyboard movement without moving objects',Math.abs(positionBefore.x-positionAfter.x-8)<=1&&positionAfter.y>=positionBefore.y&&positionAfter.y<=positionBefore.y+8&&JSON.stringify(await geometry())===JSON.stringify(initialGeometry),{positionBefore,positionAfter})
  await page.keyboard.press('Home')
  const before=await geometry(),card=page.locator('.board-node.node-note').first()
  if(await card.count()){
    await card.click({position:{x:35,y:35}})
    const selectedId=await card.getAttribute('data-node-id')
    check('Pass 3: canvas selection appears in utility and Layers',await studio.locator('.production-studio-context').innerText().then(text=>text.includes('1 selected'))&&await studio.getByRole('treeitem',{selected:true}).count()===1)
    check('Pass 3: selecting leaves object geometry intact',JSON.stringify(await geometry())===JSON.stringify(before))
    await studioTabs.getByRole('tab',{name:'Object',exact:true}).click()
    const object=studio.locator('.production-studio-object')
    check('Pass 3: actual geometry controls are exposed in Object',await object.getByRole('spinbutton',{name:'Object x',exact:true}).isVisible()&&await object.getByRole('spinbutton',{name:'Object width',exact:true}).isVisible())
    check('Pass 3: opening Object does not mutate geometry',JSON.stringify(await geometry())===JSON.stringify(before))
    await shot('pass-3-selected-object')
    await studioTabs.getByRole('tab',{name:'Color & Layers',exact:true}).click()
    const selectedLayer=studio.getByRole('treeitem',{selected:true})
    await selectedLayer.locator('.hierarchy-select').click()
    check('Pass 3: tree selection matches canonical canvas selection',await page.locator('.board-node.selected').count()===1&&await page.locator('.board-node.selected').getAttribute('data-node-id')===selectedId)
    const layerTitle=await selectedLayer.locator('.hierarchy-select').getAttribute('title')
    await selectedLayer.getByRole('button',{name:'Lock '+layerTitle,exact:true}).click()
    await studioTabs.getByRole('tab',{name:'Object',exact:true}).click()
    check('Pass 3: Layers lock disables object editing',await studio.getByRole('spinbutton',{name:'Object x',exact:true}).isDisabled())
    await studioTabs.getByRole('tab',{name:'Color & Layers',exact:true}).click()
    await studio.getByRole('button',{name:'Unlock '+layerTitle,exact:true}).click()
    const visibleNodes=await page.locator('.board-node').count()
    await studio.getByRole('button',{name:'Hide '+layerTitle,exact:true}).click()
    check('Pass 3: Layers visibility updates canonical canvas',await page.locator('.board-node').count()===visibleNodes-1)
    await studio.getByRole('button',{name:'Show '+layerTitle,exact:true}).click()
    await studio.locator('.production-layer-tree').getByTitle(layerTitle,{exact:true}).click()
    check('Pass 3: restored Layer remains at original geometry',JSON.stringify(await geometry())===JSON.stringify(before))
    const paint=studio.getByRole('group',{name:'Paint controls',exact:true})
    await paint.getByRole('button',{name:'Swatches',exact:true}).click()
    check('Pass 3: Swatches opens actual canonical palettes',await studio.locator('.production-studio-paint').getAttribute('data-paint-view')==='swatches'&&await studio.locator('.color-palette').isVisible())
    await shot('pass-3-swatches-and-layers')
    await paint.getByRole('button',{name:'Color',exact:true}).click()
    const colors=studio.getByRole('complementary',{name:'Color controls',exact:true}),hex=colors.getByRole('textbox',{name:'Hex color',exact:true})
    await hex.waitFor();await colors.getByRole('button',{name:'Fill',exact:true}).click()
    const originalHex=await hex.inputValue(),colorBefore=await geometry()
    await hex.fill('#12')
    check('Pass 3: partial Hex editing remains a local draft',await hex.inputValue()==='#12'&&JSON.stringify(await geometry())===JSON.stringify(colorBefore))
    await hex.press('Escape')
    check('Pass 3: Hex Escape restores draft and preserves selected object',await hex.inputValue()===originalHex&&await page.locator('.board-node.selected').getAttribute('data-node-id')===selectedId&&JSON.stringify(await geometry())===JSON.stringify(colorBefore))
    await hex.fill('#12');await colors.getByRole('button',{name:'Text',exact:true}).click()
    check('Pass 3: changing paint target discards invalid draft',/^#[0-9A-F]{6}$/.test(await hex.inputValue())&&JSON.stringify(await geometry())===JSON.stringify(colorBefore))
    await colors.getByRole('button',{name:'Fill',exact:true}).click()
    const replacementHex=originalHex.toLowerCase()==='#237fa4'?'#a46f23':'#237fa4'
    await hex.fill(replacementHex)
    check('Pass 3: valid Hex draft waits for commit',await hex.inputValue()===replacementHex&&JSON.stringify(await geometry())===JSON.stringify(colorBefore))
    await hex.press('Enter')
    await page.waitForFunction(value=>document.querySelector('input[aria-label="Hex color"]')?.value===value,replacementHex.toUpperCase())
    check('Pass 3: Hex Enter updates canonical paint',JSON.stringify(await geometry())!==JSON.stringify(colorBefore))
    await page.getByRole('button',{name:'Undo board change',exact:true}).click()
    check('Pass 3: canonical paint undo restores object',JSON.stringify(await geometry())===JSON.stringify(colorBefore)&&await hex.inputValue()===originalHex)
    await studioTabs.getByRole('tab',{name:'Object',exact:true}).click()
    await studio.getByRole('button',{name:'Clear selection',exact:true}).click()
    check('Pass 3: clearing selection returns Board and project context',await studio.locator('.production-studio-context').innerText().then(text=>text.includes('Board & project'))&&await page.locator('.board-node.selected').count()===0)
  }else check('Pass 3: canonical selection fixture mounted',false)
  await studio.getByRole('button',{name:'▦ Grid settings',exact:true}).click()
  check('Pass 3: Grid settings is directly reachable from visible utility',await studio.getByRole('slider',{name:'Grid spacing',exact:true}).isVisible()&&await studio.getByRole('region',{name:'Grid and canvas settings',exact:true}).isVisible())
  check('Pass 3: opening Grid leaves all object geometry intact',JSON.stringify(await geometry())===JSON.stringify(initialGeometry))
  await shot('pass-3-grid-controls')
  await studioTabs.getByRole('tab',{name:'Effects',exact:true}).click()
  const workspaceControls=await studio.locator('.production-studio-scroll button').allTextContents()
  check('Pass 3: preserved Appearance actions remain reachable in Effects',workspaceControls.some(text=>text.includes('Grid settings'))&&workspaceControls.some(text=>text.includes('Drawing tools'))&&workspaceControls.some(text=>text.includes('Layout tools')),workspaceControls)
  await studioTabs.getByRole('tab',{name:'Color & Layers',exact:true}).focus();await page.keyboard.press('End')
  check('Pass 3: utility tabs support keyboard End',await studioTabs.getByRole('tab',{name:'Effects',exact:true}).getAttribute('aria-selected')==='true'&&await studioTabs.getByRole('tab',{name:'Effects',exact:true}).evaluate(el=>document.activeElement===el))
  await page.keyboard.press('Home')
  check('Pass 3: utility tabs support keyboard Home',await studioTabs.getByRole('tab',{name:'Color & Layers',exact:true}).getAttribute('aria-selected')==='true')
  await studio.getByRole('button',{name:'Hide Color and Layers',exact:true}).click()
  check('Pass 3: utility hides and has a visible reopening control',await studio.count()===0&&await page.getByRole('button',{name:'Show Color and Layers',exact:true}).isVisible())
  await page.getByRole('button',{name:'Show Color and Layers',exact:true}).click()
  check('Pass 3: utility reopens with canonical Layers',await studio.getByRole('tree',{name:'Board objects',exact:true}).isVisible())
  // Project details retains full canonical inspector behind a readable drawer.
  await studio.getByRole('button',{name:'Hide Color and Layers',exact:true}).click()
  await page.getByRole('button',{name:'Toggle project inspector',exact:true}).click()
  const details=page.getByRole('dialog',{name:'Project details',exact:true})
  await details.waitFor()
  check('Pass 3: Project details opens canonical Project/Document/Selection inspection',await details.getByRole('tab',{name:'Project',exact:true}).count()===1&&await details.getByRole('tab',{name:'Document',exact:true}).count()===1&&await details.getByRole('tab',{name:/Selection/}).count()===1)
  await details.getByRole('tab',{name:'Project',exact:true}).click()
  await shot('pass-3-project-details')
  await details.getByRole('button',{name:'Close project details',exact:true}).click()
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Toggle project inspector',undefined,{timeout:2000}).catch(()=>{})
  check('Pass 3: closing Project details restores trigger focus' ,await page.getByRole('button',{name:'Toggle project inspector',exact:true}).evaluate(el=>document.activeElement===el))
  await page.getByRole('button',{name:'Open application settings'}).click()
  await page.getByRole('tab',{name:'Rendering',exact:true}).click()
  check('Pass 3: settings exposes appearance and renderer scope',await page.getByRole('dialog',{name:'Application settings'}).isVisible()&&await page.getByRole('dialog',{name:'Application settings'}).getByText('wgpu · Vello GPU / Vello CPU').count()===1)
  const inspection = page.getByRole('region',{name:'Codex app inspection'})
  await page.getByRole('tab',{name:'Codex',exact:true}).click()
  check('Pass 3: Codex inspection stays in Settings with explicit desktop availability',await inspection.isVisible()&&await inspection.getByText('Available in the desktop app.',{exact:true}).count()===1)
  check('Pass 3: browser does not claim a native Codex connection',await inspection.getByRole('button',{name:'Connect Codex'}).count()===0)
  await page.getByRole('tab',{name:'Saving and recovery',exact:true}).click()
  check('Pass 3: both save modes and 5/10/30/custom intervals are offered',await page.getByRole('combobox',{name:'Automatic saving mode'}).locator('option').count()===2&&(await page.getByRole('combobox',{name:'Save interval'}).locator('option').allTextContents()).join('|')==='5 minutes|10 minutes|30 minutes|Custom')
  await page.getByRole('combobox',{name:'Automatic saving mode'}).selectOption('interval')
  check('Pass 3: interval-only saving explains pending edits',await page.getByText('Edits remain pending until the next automatic save.',{exact:false}).isVisible())
  await page.getByRole('combobox',{name:'Save interval'}).selectOption('custom')
  await page.getByRole('spinbutton',{name:'Custom save minutes'}).fill('0')
  check('Pass 3: invalid custom interval cannot be applied',await page.getByRole('button',{name:'Apply interval',exact:true}).isDisabled())
  await page.getByRole('spinbutton',{name:'Custom save minutes'}).fill('17')
  await page.getByRole('button',{name:'Apply interval',exact:true}).click()
  await page.getByRole('combobox',{name:'Save interval'}).selectOption('10')
  await page.getByRole('combobox',{name:'Automatic saving mode'}).selectOption('continuous')
  await shot('pass-3-centered-saving-settings')
  await page.getByRole('button',{name:'Close settings'}).click()
  await page.getByRole('button',{name:'Show Color and Layers',exact:true}).click()
  await studio.getByRole('button',{name:'Reset position',exact:true}).click()

  // Pass 4: all theme/mode/width combinations, no required control outside shell.
  const geometryBeforeMatrix=await geometry()
  for(const theme of ['navy','dark','light']){
    await page.getByRole('button',{name:`Use ${theme} theme`}).click()
    for(const width of [1040,1440,1920]){
      await page.setViewportSize({width,height:width===1040?720:width===1440?900:1080})
      for(const mode of ['Document','Split','Canvas']){
        await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:mode,exact:true}).click()
        if(mode==='Split'){
          const compactSwitch=page.getByRole('group',{name:'Split workspace pane',exact:true})
          if(await compactSwitch.isVisible())await compactSwitch.getByRole('button',{name:'Document',exact:true}).click()
        }
        await page.waitForTimeout(150)
        // Inspect the utility's restored default for each viewport, separate
        // from the deliberate floating movement/docking tests in Pass 3.
        if(await studio.isVisible())await studio.getByRole('button',{name:'Reset position',exact:true}).click()
        const layout=await page.evaluate(()=>{
          const visible=el=>{const rect=el.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('[hidden],[inert]')}
          const controls=[...document.querySelectorAll('.app-header-actions button,.p25-workspace-actions button,.p25-document-tabs [role=tab],.p25-document-chooser summary,.compact-split-tabs button,.canvas-tool-rail button,.canvas-tool-rail summary,.production-studio-title button,.production-studio-title select,.production-studio-tabs button,.production-studio-footer button')].filter(visible)
          // Document-tab and canvas-tool tracks deliberately scroll; their
          // keyboard visibility is tested separately from viewport bounds.
          const outside=controls.filter(el=>{const r=el.getBoundingClientRect();return !el.closest('.p25-document-tabs-track,.canvas-tool-rail')&&(r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1)}).map(el=>el.getAttribute('aria-label')||el.textContent)
          const rail=document.querySelector('.canvas-tool-rail'),stage=document.querySelector('.canvas-stage')
          const r=rail&&visible(rail)?rail.getBoundingClientRect():null,s=stage?.getBoundingClientRect()
          const zoom=document.querySelector('.canvas-zoom-control'),z=zoom&&visible(zoom)?zoom.getBoundingClientRect():null
          const railZoomCollision=!!r&&!!z&&r.left<z.right&&r.right>z.left&&r.top<z.bottom&&r.bottom>z.top
          // Retained session wrappers use display:contents and have no box.
          // Check the actual pane so a missing document cannot look like a pass.
          const documents=[...document.querySelectorAll('.retained-document-session .document-pane')].filter(visible)
          const utility=document.querySelector('.production-studio'),u=utility&&visible(utility)?utility.getBoundingClientRect():null
          const shell=document.querySelector('.studio-shell'),style=getComputedStyle(shell)
          const tokens=Object.fromEntries(['--surface-nav','--surface-appbar','--surface-input','--surface-control','--surface-active','--text','--text-strong','--text-subtle','--gold','--teal','--border-control'].map(name=>[name,style.getPropertyValue(name).trim()]))
          return{actualViewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},outside,tokens,compact:!!document.querySelector('.compact-split'),utilityVisible:!!u,utilityInside:!u||u.left>=0&&u.top>=0&&u.right<=innerWidth+1&&u.bottom<=innerHeight+1,railZoomCollision,railCentered:!r||!s||Math.abs((r.left+r.width/2)-(s.left+s.width/2))<2,railInside:!r||!s||r.left>=s.left&&r.right<=s.right+1&&r.bottom<=s.bottom+1,canvasVisible:!!stage&&visible(stage),documentVisible:documents.length===1,documentId:documents[0]?.closest('[data-document-id]')?.dataset.documentId,paneSwitchVisible:[...document.querySelectorAll('.compact-split-tabs button')].filter(visible).length===2}
        })
        report.matrix.push({theme,width,mode,...layout})
        check(`Pass 4: ${theme}/${width}/${mode} controls bounded`,!layout.outside.length&&layout.utilityInside&&layout.railCentered&&layout.railInside&&!layout.railZoomCollision,layout)
        const panes=mode==='Document'?layout.documentVisible&&!layout.canvasVisible:mode==='Canvas'?layout.canvasVisible&&!layout.documentVisible:layout.compact?layout.paneSwitchVisible&&layout.documentVisible!==layout.canvasVisible:layout.documentVisible&&layout.canvasVisible
        check(`Pass 4: ${theme}/${width}/${mode} requested panes present`,panes,layout)
        if(mode!=='Canvas')await reviewFormattingReachability(`Pass 4: ${theme}/${width}/${mode} rich document`)
        check(`Pass 4: ${theme}/${width}/${mode} tabs remain inside writing pane`,await page.locator('.canvas-pane .p25-document-tabs').count()===0&&await page.locator('.prototype-document-workspace .p25-document-tabs').count()===1)
        await reviewChromeReachability(`Pass 4: ${theme}/${width}/${mode}`)
        await shot(`pass-4-${theme}-${width}-${mode.toLowerCase()}`)
        if(width===1920)await reviewAccessibility(`Pass 4: ${theme}/${mode}`)
      }
    }
    const headers=await page.locator('.board-node:not(.node-column)>.node-drag-handle>strong').evaluateAll(nodes=>nodes.map(el=>({color:getComputedStyle(el).color,expected:getComputedStyle(el.closest('.studio-shell')).getPropertyValue('--text-strong').trim()})))
    const ink=await page.locator('.studio-shell').evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--text-strong)';el.append(probe);const value=getComputedStyle(probe).color;probe.remove();return value})
    check(`Pass 4: ${theme} card heading ink follows shell`,headers.length>0&&headers.every(h=>h.color===ink),headers)

  }
  // Resize the real panel, not a synthetic style override. Narrow navigation
  // must reflow headings and asset actions independently of viewport size.
  await page.setViewportSize({width:1440,height:900})
  const navHandle=page.getByRole('button',{name:'Resize projects panel; press Home to hide',exact:true})
  const navigation=page.locator('.p25-navigation-slot'),shelf=page.getByRole('region',{name:'Assignable project assets',exact:true})
  const originalNavWidth=await navigation.evaluate(el=>el.getBoundingClientRect().width)
  for(const theme of ['navy','dark','light']) {
    await page.getByRole('button',{name:`Use ${theme} theme`,exact:true}).click()
    await navHandle.focus()
    for(let i=0;i<20;i++)await page.keyboard.press('ArrowLeft')
    for(const width of [176,224,272,360]) {
      let current=await navigation.evaluate(el=>el.getBoundingClientRect().width)
      while(current<width-1){await navHandle.focus();await page.keyboard.press('ArrowRight');current=await navigation.evaluate(el=>el.getBoundingClientRect().width)}
      for(const mode of ['Split','Canvas']) {
        await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:mode,exact:true}).click()
        const metrics=await navigation.evaluate(root=>{
          const nav=root.querySelector('.navigator'),scroll=nav.querySelector('nav'),list=nav.querySelector('.p25-asset-shelf-list'),bounds=nav.getBoundingClientRect()
          const headings=[...nav.querySelectorAll('.p25-tree-section,.p25-asset-shelf>header')].map(el=>({text:el.textContent,width:el.clientWidth,contentWidth:el.scrollWidth}))
          const actions=[...nav.querySelectorAll('.p25-shelf-actions button')].map(el=>{const r=el.getBoundingClientRect();return{text:el.textContent,left:r.left,right:r.right,width:r.width,height:r.height}})
          return {width:root.getBoundingClientRect().width,navOverflow:nav.scrollWidth-nav.clientWidth,treeOverflow:scroll.scrollWidth-scroll.clientWidth,shelfOverflow:list.scrollWidth-list.clientWidth,bounds:{left:bounds.left,right:bounds.right},headings,actions}
        })
        check(`Pass 4: ${theme}/${mode}/${width} navigation reflows without horizontal clipping`,metrics.navOverflow<=1&&metrics.treeOverflow<=1&&metrics.shelfOverflow<=1&&metrics.headings.every(h=>h.contentWidth<=h.width+1),metrics)
        check(`Pass 4: ${theme}/${mode}/${width} every asset action stays readable and full size`,metrics.actions.length>0&&metrics.actions.every(b=>b.left>=metrics.bounds.left&&b.right<=metrics.bounds.right&&b.height>=32&&b.width>=32),metrics.actions)
      }
      if(width===176||width===360)await shot(`pass-4-sidebar-${theme}-${width}`)
    }
  }
  await navHandle.focus();for(let i=0;i<20;i++)await page.keyboard.press('ArrowLeft')
  const enabledShelfActions=shelf.locator('.p25-shelf-actions button:enabled')
  await enabledShelfActions.first().focus()
  for(let i=0;i<await enabledShelfActions.count();i++) {
    const target=enabledShelfActions.nth(i)
    const reachable=await target.evaluate(el=>{const r=el.getBoundingClientRect(),clip=el.closest('.p25-asset-shelf-list').getBoundingClientRect(),nav=el.closest('nav').getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return document.activeElement===el&&r.left>=nav.left&&r.right<=nav.right&&r.top>=clip.top-1&&r.bottom<=clip.bottom+1&&!!hit&&(hit===el||el.contains(hit))})
    check(`Pass 4: compressed sidebar Tab reaches asset action ${i+1}`,reachable)
    if(i+1<await enabledShelfActions.count())await page.keyboard.press('Tab')
  }
  const shelfToggle=shelf.locator('header button')
  await shelfToggle.click();check('Pass 4: compressed shelf collapses without dropping its assets',await shelf.locator('.p25-asset-shelf-list').count()===0)
  await shelfToggle.click();check('Pass 4: compressed shelf reopens with all asset actions',await shelf.locator('.p25-shelf-actions button').count()>0)
  const handleBox=await navHandle.boundingBox(),currentNavWidth=await navigation.evaluate(el=>el.getBoundingClientRect().width)
  await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);await page.mouse.down();await page.mouse.move(handleBox.x+handleBox.width/2+originalNavWidth-currentNavWidth,handleBox.y+handleBox.height/2);await page.mouse.up()
  check('Pass 4: theme/mode/viewport inspection preserves canonical geometry',JSON.stringify(await geometry())===JSON.stringify(geometryBeforeMatrix))
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.waitForTimeout(100)
  check('Pass 4: reduced motion keeps aquarium still',await page.locator('.aquarium-scene').getAttribute('data-motion')==='reduced')
  await page.setViewportSize({width:1440,height:900})
  await page.getByRole('button',{name:'Add a document or board',exact:true}).click()
  await page.getByRole('button',{name:'▧ New board',exact:true}).click()
  await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Canvas',exact:true}).click()
  const rail=page.locator('.canvas-tool-rail')
  await rail.waitFor({state:'visible'})
  const railSize=await rail.evaluate(el=>({width:el.clientWidth,contentWidth:el.scrollWidth,overflow:getComputedStyle(el).overflowX}))
  check('Pass 4: compact toolbar has no horizontal overflow',railSize.contentWidth<=railSize.width+1&&railSize.overflow==='visible',railSize)
  for(const label of ['Selection tools','Drawing tools','Board tools','Navigation and view tools']){
    const trigger=page.locator(`.canvas-tool-stack summary[aria-label="${label}"]`)
    await trigger.click()
    check(`Pass 4: ${label} flyout exposes labelled tools`,await page.locator('.canvas-tool-stack[open] .canvas-tool-stack-menu button:visible').count()>1)
    await page.keyboard.press('Escape')
    check(`Pass 4: ${label} Escape restores trigger focus`,await trigger.evaluate(el=>document.activeElement===el)&&await page.locator('.canvas-tool-stack[open]').count()===0)
  }
  await page.locator('.canvas-tool-stack summary[aria-label="Drawing tools"]').click()
  await page.getByRole('button',{name:'Type tool',exact:true}).click()
  check('Pass 4: choosing stacked Type closes its flyout',await page.locator('.canvas-tool-stack[open]').count()===0)
  const drawingUtilityClose=page.getByRole('button',{name:'Hide Color and Layers',exact:true});if(await drawingUtilityClose.isVisible())await drawingUtilityClose.click()
  await page.locator('.canvas-stage').click({position:{x:140,y:140}})
  const newText=page.locator('.canvas-stage .board-text-editor[contenteditable=true]')
  await newText.waitFor()
  await newText.click()
  await page.keyboard.press('Control+A')
  // Exercise physical typing: CDP insertText has a separate replacement-input failure.
  await page.keyboard.type('Reachable canvas text', {delay:2})
  check('Pass 4: selected canvas text accepts a real centre click and typing',(await newText.innerText()).includes('Reachable canvas text'))
  check('Pass 4: transform frame lets editor hits through',await page.locator('.node-transform-box').evaluate(el=>getComputedStyle(el).pointerEvents)==='none')
  check('Pass 4: resize handles remain interactive',await page.getByRole('button',{name:'Resize Type from se',exact:true}).evaluate(el=>getComputedStyle(el).pointerEvents)==='auto')
  await shot('pass-4-text-editing')
  // Final interactions on disposable data: bounded regions, real raster download,
  // floating-only utility and recovery theme parity. No stress-board qualification.
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'More canvas tools',exact:true}).click()
  await page.getByRole('button',{name:'Group or frame',exact:true}).click()
  const frame=page.locator('.canvas-stage .node-frame').last()
  await frame.waitFor()
  const frameId=await frame.getAttribute('data-node-id')
  const frameBox=await frame.evaluate(el=>({width:parseFloat(el.style.width),height:parseFloat(el.style.height)}))
  check('Pass 4: Frame wraps selected artwork as a distinct region',await frame.locator('.node-drag-handle').innerText().then(text=>text.includes('Frame')))
  await page.getByRole('button',{name:'Open board export',exact:true}).click()
  const exportDialog=page.getByRole('dialog',{name:'Export board',exact:true})
  check('Pass 4: export detects the selected frame',await exportDialog.getByRole('combobox',{name:'Board export source'}).inputValue()==='frame')
  await exportDialog.getByRole('combobox',{name:'Board export scale'}).selectOption('4')
  const [download]=await Promise.all([page.waitForEvent('download'),exportDialog.getByRole('button',{name:'Export PNG',exact:true}).click()])
  const outputPng=path.join(out,'frame-4x.png');await download.saveAs(outputPng)
  const png=await fs.readFile(outputPng)
  check('Pass 4: frame writes a high-resolution PNG with exact region dimensions',png.readUInt32BE(16)===Math.round(frameBox.width*4)&&png.readUInt32BE(20)===Math.round(frameBox.height*4),{frameBox,pixels:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)}})
  await page.getByRole('button',{name:'More canvas tools',exact:true}).click()
  await page.getByRole('button',{name:'Create drawing Canvas Object',exact:true}).click()
  check('Pass 4: separate drawing Canvas Object is created',await page.locator('.node-drawing-canvas').count()===1)
  // Disk-backed trash mutations are verified in the native EXE, where the storage bridge exists.
  await page.getByRole('button',{name:/Open project trash/}).click()
  const trash=page.getByRole('dialog',{name:'Project trash',exact:true})
  for(const theme of ['navy','dark','light']) {
    await trash.getByRole('button',{name:'Close',exact:true}).click()
    await page.getByRole('button',{name:`Use ${theme} theme`}).click()
    await page.getByRole('button',{name:/Open project trash/}).click()
    check(`Pass 4: ${theme} trash follows shell surface`,await trash.evaluate(el=>{const probe=document.createElement('i');probe.style.background='var(--surface-overlay)';el.appendChild(probe);const match=getComputedStyle(el).backgroundColor===getComputedStyle(probe).backgroundColor;probe.remove();return match}))
    await shot(`pass-4-${theme}-trash`)
    await reviewAccessibility(`Pass 4: ${theme}/Trash`)
  }
  await trash.getByRole('button',{name:'Close',exact:true}).click()
  check('Pass 4: no browser runtime errors',report.errors.length===0,report.errors)
}catch(error){report.errors.push(error.stack);check('Review execution completed',false,error.message);await shot('execution-failure').catch(()=>{});report.failureSnapshot=await page.locator('body').innerText().catch(()=>null)}
finally{
  report.decision=report.checks.every(item=>item.pass)&&!report.errors.length?'UI_SMOKE_PASS_ONLY':'REJECT'
  await fs.writeFile(path.join(out,'review.json'),JSON.stringify(report,null,2))
  await browser.close()
  console.log(JSON.stringify({decision:report.decision,output:out}))
  if(report.decision==='REJECT')process.exitCode=1
}
