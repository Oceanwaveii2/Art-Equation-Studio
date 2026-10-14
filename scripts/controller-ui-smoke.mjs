import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

// Disposable mounted components, without opening or changing a user's project.
const fixture = path.resolve('output/controller-ui-fixture.html')
const out = path.resolve('output/playwright/controller-ui-smoke')
await fs.mkdir(out, { recursive: true })
await fs.writeFile(fixture, `<!doctype html><html><head><style>
body{margin:0;font:16px sans-serif}#scroller{height:360px;overflow:auto;width:420px;border:1px solid} .row{height:42px;box-sizing:border-box;display:flex;gap:8px}button,select{min-height:32px}
</style></head><body><div id="app"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {VirtualList} from '/src/ui/VirtualList.tsx';
import {createSelectorStore} from '/src/state/selectorStore.ts';
import {useStoreField,useBoardSelectionStore} from '/src/state/controllerStores.ts';
const h=React.createElement;
const store=createSelectorStore({document:{title:'Stable document'},tool:'select',selection:[]});
window.fixture={store,renders:{document:0,tool:0,selection:0},large:false};
function Document(){const [doc]=useStoreField(store,'document');window.fixture.renders.document++;return h('p',{id:'document'},doc.title)}
function Tool(){const [tool]=useStoreField(store,'tool');window.fixture.renders.tool++;return h('p',{id:'tool'},tool)}
function Selection(){const [ids]=useStoreField(store,'selection');window.fixture.renders.selection++;return h('p',{id:'selection'},ids.join(','))}
function App(){const [tall,setTall]=React.useState(false),[session,setSession]=React.useState('a');
 const board=session==='a'?{nodes:[{id:'a'}]}:{nodes:[{id:'b'}]};
 const selection=useBoardSelectionStore(session,board,['a','b']),[ids,setIds]=useStoreField(selection,'selectedIds');
 window.fixture.setTall=setTall;window.fixture.setSession=setSession;window.fixture.setIds=setIds;
 const rows=React.useMemo(()=>Array.from({length:1000},(_,i)=>({id:String(i)})),[]);
 return h(React.Fragment,null,h(Document),h(Tool),h(Selection),h('p',{id:'board-selection'},ids.join(',')),
 h('div',{id:'scroller'},h(VirtualList,{items:rows,itemKey:r=>r.id,label:'Large test list',renderItem:r=>h('div',{className:'row',style:{height:tall&&Number(r.id)<12?90:42}},h('button',{'aria-label':'Row '+r.id},'Row '+r.id),h('select',{'aria-label':'Select '+r.id},h('option',{value:'a'},'A'),h('option',{value:'b'},'B')))})));
}
createRoot(document.querySelector('#app')).render(h(App));
</script></body></html>`)
const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const page = await browser.newPage({viewport:{width:900,height:800}})
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message))
const check=(name,detail)=>{checks.push({name,pass:true,detail});console.log('PASS',name)}
try {
 await page.goto((process.env.AE_DEV_URL||'http://127.0.0.1:5311')+'/output/controller-ui-fixture.html')
 await page.getByRole('button',{name:'Row 0',exact:true}).waitFor()
 const mounted=()=>page.getByRole('list',{name:'Large test list'}).getAttribute('data-virtual-mounted').then(Number)
 assert.ok(await mounted()<40);check('1000 records mount a bounded visible window',await mounted())
 const before=await page.evaluate(()=>({...window.fixture.renders}))
 await page.evaluate(()=>window.fixture.store.field('tool','hand'))
 await page.locator('#tool').filter({hasText:'hand'}).waitFor()
 const after=await page.evaluate(()=>({...window.fixture.renders}))
 assert.equal(after.document,before.document);assert.equal(after.selection,before.selection);assert.equal(after.tool,before.tool+1)
 check('mounted document and selection ignore tool changes',{before,after})
 await page.evaluate(()=>window.fixture.store.field('selection',['a']))
 await page.locator('#selection').filter({hasText:'a'}).waitFor()
 const sameBefore=await page.evaluate(()=>window.fixture.renders.selection)
 await page.evaluate(()=>window.fixture.store.field('selection',['a']))
 await page.waitForTimeout(80)
 assert.equal(await page.evaluate(()=>window.fixture.renders.selection),sameBefore)
 check('identical selection values do not rerender their subscriber')
 await page.evaluate(()=>window.fixture.setSession('b'))
 await page.locator('#board-selection').filter({hasText:'b'}).waitFor()
 assert.equal(await page.locator('#board-selection').textContent(),'b')
 check('board switch validates selection against destination IDs')
 await page.getByRole('button',{name:'Row 0',exact:true}).focus()
 await page.keyboard.press('End')
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Row 999')
 assert.ok(await mounted()<40);check('End reveals and focuses the final virtual row',await mounted())
 await page.keyboard.press('Home')
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Row 0')
 await page.keyboard.press('Tab')
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Select 0')
 await page.keyboard.press('ArrowDown')
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Select 0')
 await page.keyboard.press('Tab')
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Row 1')
 await page.keyboard.press('Shift+Tab')
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Select 0')
 check('Tab crosses virtual rows; native select arrows remain native')
 await page.evaluate(()=>window.fixture.setTall(true))
 await page.waitForFunction(()=>document.querySelector('[data-virtual-index="0"]').getBoundingClientRect().height===90)
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 await page.getByRole('button',{name:'Row 0',exact:true}).focus()
 await page.keyboard.press('ArrowDown')
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Row 1')
 const offset=await page.locator('#scroller').evaluate(el=>el.scrollTop)
 assert.ok(Math.abs(offset-90)<3, `resized row scroll offset is ${offset}, expected 90px`)
 check('ResizeObserver updates variable row offsets',offset)
 // User scrolling can unmount ordinary rows; the focused row is pinned.
 await page.locator('#scroller').evaluate(el=>{el.scrollTop=21000})
 await page.waitForFunction(()=>document.querySelector('[data-virtual-mounted]')?.querySelectorAll('[data-virtual-index]').length<40)
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Row 1')
 assert.ok(await mounted()<40)
 check('focused controls stay mounted while the list is scrolled')
 await page.screenshot({path:path.join(out,'windowed-list.png')})
 assert.deepEqual(errors,[])
} finally {
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({scope:'Mounted browser components and keyboard/scroll behavior only; no native or 4K performance claim.',checks,errors},null,2))
 await browser.close();await fs.rm(fixture,{force:true})
}
