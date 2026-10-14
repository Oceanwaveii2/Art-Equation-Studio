import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const out='output/playwright/pyramid';await mkdir(out,{recursive:true})
const server=await createServer({cacheDir:'node_modules/.vite-pyramid-harness',optimizeDeps:{entries:['scripts/fixtures/pyramid-harness.html']},server:{watch:null,host:'127.0.0.1',port:5176,strictPort:true}});await server.listen()
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const report={cases:[],errors:[]}
async function settle(page) {await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>{const c=document.querySelector('.tile-surface');return c&&c.dataset.pending==='0'&&c.dataset.wanted!=='0'&&c.dataset.uploads!=='0'},{},{timeout:30000});await page.waitForTimeout(100)}
async function difference(page,a,b) {return page.evaluate(async({a,b})=>{
 const read=async b64=>{const image=await createImageBitmap(await(await fetch('data:image/png;base64,'+b64)).blob());const c=new OffscreenCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height).data};
 const x=await read(a),y=await read(b);let sum=0,bad=0;for(let i=0;i<x.length;i+=4){let max=0;for(let j=0;j<3;j++){const d=Math.abs(x[i+j]-y[i+j]);sum+=d;max=Math.max(max,d)}if(max>12)bad++}return{mean:sum/(x.length/4*3),badFraction:bad/(x.length/4)}
},{a:a.toString('base64'),b:b.toString('base64')})}
try {
 for(const dpr of [1,2]) {
  const page=await browser.newPage({viewport:{width:900,height:650},deviceScaleFactor:dpr});page.on('pageerror',e=>report.errors.push(e.message))
  console.log('Tile comparison DPR',dpr)
  await page.goto('http://127.0.0.1:5176/scripts/fixtures/pyramid-harness.html',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.renderFixture,{},{timeout:60000})
  for(const [angle,flipX,panX,panY] of [[0,false,0,0],[0,false,401,119],[90,true,190,35],[17,false,170,25],[270,false,390,70]]) {
   await page.evaluate(o=>window.renderFixture({...o,reference:false}),{angle,flipX,panX,panY});await settle(page)
   const tiled=await page.screenshot();const metrics=await page.locator('.tile-surface').evaluate(c=>({...c.dataset}));
   await page.evaluate(()=>window.renderFixture({reference:true}));await page.waitForFunction(()=>document.querySelector('.test-body>img')?.complete);await page.waitForTimeout(150)
   const reference=await page.screenshot(),diff=await difference(page,tiled,reference)
   await writeFile(`${out}/small-${dpr}-${angle}-${panX}.png`,tiled)
   report.cases.push({test:'source comparison / alpha / seams / transforms',dpr,angle,flipX,panX,diff,metrics})
   assert(diff.mean<2&&diff.badFraction<.03,JSON.stringify(report.cases.at(-1)))
  }
  await page.close()
 }
 const page=await browser.newPage({viewport:{width:1100,height:720}});page.on('pageerror',e=>report.errors.push(e.message))
 const requests=[];await page.route('**/originals/giant.png',route=>{requests.push('ORIGINAL');return route.abort()})
 page.on('request',request=>{if(request.url().includes('image_files/'))requests.push(request.url())})
 await page.goto('http://127.0.0.1:5176/scripts/fixtures/pyramid-harness.html');await page.waitForFunction(()=>window.renderFixture)
 await page.evaluate(()=>window.renderFixture({name:'giant',panX:19000,panY:0,scale:1}));await settle(page)
 const limit=await page.locator('.tile-surface').evaluate(c=>c.getContext('webgl').getParameter(c.getContext('webgl').MAX_TEXTURE_SIZE));assert(40001>limit)
 for(let i=0;i<24;i++){await page.evaluate(x=>window.renderFixture({panX:x}),i*1500);await settle(page)}
 const metrics=await page.locator('.tile-surface').evaluate(c=>({...c.dataset}));assert(Number(metrics.resident)<=49);assert(Number(metrics.evictions)>0);assert(Number(metrics.surfaceBytes)<=8_388_608*4);assert(!requests.includes('ORIGINAL'))
 assert(Number(metrics.resourceBytes)<=Number(metrics.resourceLimit),'shared renderer resource estimate must stay within its limit')
 await page.screenshot({path:out+'/giant-detail.png'});report.cases.push({test:'40001 x 1025, pan/eviction, never decode original',limit,metrics,requests:requests.length})
 // Outdated requests must not repopulate a new viewport. Slow one tile and move.
 await page.route('**/image_files/**/*.png',async route=>{await new Promise(r=>setTimeout(r,80));try{await route.continue()}catch{}})
 for(let i=0;i<15;i++)await page.evaluate(i=>window.renderFixture({panX:i%2?20000:0,scale:i%3?1:2}),i)
 await settle(page);assert(Number(await page.locator('.tile-surface').getAttribute('data-pending'))===0)
 await page.unroute('**/image_files/**/*.png')
 // A lost context reveals the poster and can be restarted without a reload.
 await page.locator('.tile-surface').evaluate(c=>c.getContext('webgl').getExtension('WEBGL_lose_context').loseContext())
 await page.waitForFunction(()=>document.querySelector('.tiled-image-preview').dataset.tileState==='poster')
 await page.getByRole('button',{name:'Retry tiles',exact:true}).click();await settle(page)
 report.cases.push({test:'obsolete requests and WebGL context loss/retry',result:'pass'})
 // A missing tile preserves the preview; retry fills it after the file returns.
 await page.evaluate(()=>window.renderFixture({reference:true,name:'small'}))
 await page.route('**/image_files/11/0_0.png',route=>route.fulfill({status:404,body:''}))
 await page.evaluate(()=>window.renderFixture({reference:false,name:'small',scale:1,panX:0,panY:0}));await settle(page)
 assert(Number(await page.locator('.tile-surface').getAttribute('data-failed'))>0)
 await page.unroute('**/image_files/11/0_0.png');await page.getByRole('button',{name:'Retry tiles',exact:true}).click();await settle(page)
 assert.equal(await page.locator('.tile-surface').getAttribute('data-failed'),'0');report.cases.push({test:'missing tile poster fallback and retry',result:'pass'})
 await page.evaluate(()=>window.renderFixture({count:6}));await page.waitForTimeout(1500)
 assert.equal(await page.locator('.tile-surface').count(),4);assert.equal(await page.locator('[data-tile-state="budget-preview"]').count(),2)
 await page.evaluate(()=>window.renderFixture({count:1,scale:.5}));await page.waitForTimeout(250);assert.equal(await page.locator('.tile-surface').count(),0)
 await page.evaluate(()=>window.renderFixture({scale:1}));await settle(page);assert.equal(await page.locator('.tile-surface').getAttribute('data-contexts'),'1');report.cases.push({test:'global context budget / release / reacquire',result:'pass'})
 const recovery=await browser.newPage({viewport:{width:900,height:650}})
 recovery.on('pageerror',e=>report.errors.push(e.message))
 await recovery.route('**/poster.png',route=>route.fulfill({status:404,body:''}))
 await recovery.goto('http://127.0.0.1:5176/scripts/fixtures/pyramid-harness.html',{waitUntil:'domcontentloaded'})
 await recovery.getByText(/Preview unavailable/).waitFor();await recovery.unroute('**/poster.png')
 await recovery.getByRole('button',{name:'Retry tiles',exact:true}).click();await settle(recovery)
 await recovery.close()
 report.cases.push({test:'missing poster recovery without original decode',result:'pass'})
 await page.close();assert.deepEqual(report.errors,[])
 console.log('P10/P11 browser checks PASS',JSON.stringify(report,null,2))
} catch(error) {console.error(error);throw error} finally {await writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();await server.close()}
