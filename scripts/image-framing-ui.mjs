import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { imageDrawRect } from '../src/model/imageFraming.ts'

// Existing disposable P10 fixtures, not production projects or newly extracted
// media. Independent CSS object-fit/object-position/scale is the pixel oracle.
const output='output/playwright/image-framing', original='tmp/pyramid-fixtures/projects/test-project/assets/originals/small.png'
await mkdir(output,{recursive:true})
const sourceHash=createHash('sha256').update(await readFile(original)).digest('hex')
const server=await createServer({cacheDir:'node_modules/.vite-image-framing',optimizeDeps:{entries:['scripts/fixtures/image-framing-harness.html']},server:{watch:null,host:'127.0.0.1',port:5183,strictPort:true}})
await server.listen()
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const report={passed:false,checks:[],cases:[],errors:[],limitations:['Isolated component rendering parity, not a native GPU pixel test or complete app-control workflow certification.']}
const check=(name,condition,detail)=>{report.checks.push({name,passed:Boolean(condition),detail});assert.ok(condition,`${name}: ${JSON.stringify(detail||'')}`)}
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
async function settle(page,renderer) {
 await frames(page)
 if(renderer==='tiles') {
  await page.waitForFunction(()=>document.querySelector('.tile-poster')?.complete&&document.querySelector('.tile-poster')?.naturalWidth>0)
  await frames(page)
  if(await page.locator('.tile-surface').count()) await page.waitForFunction(()=>{const c=document.querySelector('.tile-surface');return c?.dataset.pending==='0'&&Number(c.dataset.uploads)>0})
 } else await page.waitForFunction(()=>{const image=document.querySelector('.fixture-frame img');return image?.complete&&image.naturalWidth>0})
 await frames(page);await page.waitForTimeout(80)
}
async function capture(page) {
 const box=await page.locator('.fixture-frame').boundingBox()
 // Source-limit/status badges are intentional UI, not image pixels; exclude
 // their bottom strip equally from every independent pixel comparison.
 return page.screenshot({clip:{x:box.x,y:box.y,width:box.width,height:box.height-45}})
}
async function difference(page,a,b) {
 return page.evaluate(async({a,b})=>{
  const pixels=async(encoded)=>{const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+encoded)).blob());const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data}
  const x=await pixels(a),y=await pixels(b);if(x.length!==y.length)throw new Error('Pixel comparison dimensions changed')
  let sum=0,bad=0;for(let i=0;i<x.length;i+=4){let maximum=0;for(let c=0;c<3;c++){const delta=Math.abs(x[i+c]-y[i+c]);sum+=delta;maximum=Math.max(maximum,delta)}if(maximum>12)bad++}
  return{mean:sum/(x.length/4*3),badFraction:bad/(x.length/4)}
 },{a:a.toString('base64'),b:b.toString('base64')})
}
try {
 for(const dpr of [1,2]) {
  const page=await browser.newPage({viewport:{width:1100,height:850},deviceScaleFactor:dpr})
  page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto('http://127.0.0.1:5183/scripts/fixtures/image-framing-harness.html',{waitUntil:'domcontentloaded',timeout:60000})
  await page.waitForFunction(()=>window.renderFixture&&window.fixturePyramid,{},{timeout:60000})
  for(const fixture of [
   {fit:'contain',positionX:50,positionY:50,zoom:1,angle:0,flipX:false},
   {fit:'cover',positionX:0,positionY:50,zoom:1,angle:0,flipX:false},
   {fit:'cover',positionX:100,positionY:0,zoom:4,angle:0,flipX:false},
   {fit:'fill',positionX:25,positionY:100,zoom:2,angle:0,flipX:false},
   {fit:'cover',positionX:25,positionY:50,zoom:4,angle:17,flipX:true},
   {fit:'contain',positionX:100,positionY:0,zoom:4,angle:90,flipX:true},
  ]) {
   await page.evaluate(options=>window.renderFixture({...options,renderer:'reference'}),fixture)
   await settle(page,'reference');const reference=await capture(page)
   for(const renderer of ['format','tiles']) {
    await page.getByLabel('Renderer').selectOption(renderer)
    await settle(page,renderer)
    const result=await capture(page),diff=await difference(page,result,reference)
    const geometry=await page.evaluate(()=>{const img=document.querySelector('.fixture-frame img'),host=img.parentElement;return{left:parseFloat(img.style.left),top:parseFloat(img.style.top),width:parseFloat(img.style.width),height:parseFloat(img.style.height),frameWidth:host.clientWidth,frameHeight:host.clientHeight,pyramid:window.fixturePyramid,tiles:document.querySelector('.tile-surface')?{...document.querySelector('.tile-surface').dataset}:null}})
    const expected=imageDrawRect(geometry.pyramid,{width:geometry.frameWidth,height:geometry.frameHeight},fixture)
    const maximum=Math.max(...['x','y','width','height'].map(key=>Math.abs(expected[key]-geometry[{x:'left',y:'top',width:'width',height:'height'}[key]])))
    check(`${renderer} canonical rectangle at DPR ${dpr}`,maximum<.02,{fixture,geometry,expected,maximum})
    check(`${renderer} matches independent CSS crop/fit pixels at DPR ${dpr}`,diff.mean<2&&diff.badFraction<.03,{fixture,diff})
    if(geometry.tiles){check('Tile count remains bounded',Number(geometry.tiles.resident)<=49,geometry.tiles);check('Tile backing store stays bounded',Number(geometry.tiles.surfaceBytes)<=8_388_608*4,geometry.tiles)}
    report.cases.push({renderer,dpr,fixture,diff,tiles:geometry.tiles})
    if(fixture.zoom===4&&fixture.angle===17)await writeFile(`${output}/${renderer}-framed-${dpr}.png`,result)
   }
  }
  // Actual select controls change framing without replacing the source.
  await page.getByLabel('Renderer').selectOption('format');await page.getByLabel('Fit',{exact:true}).selectOption('fill');await page.getByLabel('Image zoom').selectOption('1');await settle(page,'format')
  check(`Real framing controls update preview at DPR ${dpr}`,await page.locator('.format-image-preview').getAttribute('data-image-fit')==='fill')
  await page.close()
 }
 check('Source bytes remain unchanged',createHash('sha256').update(await readFile(original)).digest('hex')===sourceHash)
 check('No component browser exceptions',report.errors.length===0,report.errors)
 report.passed=true
 console.log(`Part II framing DOM/tile parity: PASS (${report.checks.length} checks, ${report.cases.length} rendered comparisons)`)
} catch(error){report.failure=String(error);console.error(error);process.exitCode=1}
finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();await server.close()}
