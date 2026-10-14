import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createServer} from 'vite'
import {chromium} from 'playwright-core'

const out=path.resolve('output/playwright/grid-layer-smoke')
await fs.mkdir(out,{recursive:true})
const harness=path.join(out,'harness.js')
await fs.writeFile(harness,`import React from 'react';import {createRoot} from 'react-dom/client';import {VelloBoardBackdrop} from '../../../src/board/VelloBoardBackdrop';
const host=document.createElement('div');host.className='canvas-stage';host.style.cssText='position:relative;width:640px;height:420px';document.body.append(host);
const style=document.createElement('style');style.textContent='.gpu-board{position:absolute;inset:0}';document.head.append(style);
const root=createRoot(host),scene={id:'grid-smoke',revision:1,objects:[],connections:[],environment:{background:'#112233',grid:{visible:true,color:'#00ffff',opacity:1,spacing:16}}};
window.setGridView=(scale,x=3.2,y=4.4)=>root.render(React.createElement(VelloBoardBackdrop,{scene,viewport:{scale,x,y}}));window.setGridView(1);
`)
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false}})
await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const report={scope:'Small actual Vello presentation check; no stress or performance qualification',samples:[],errors:[]}
try{
 const page=await browser.newPage({viewport:{width:700,height:480}})
 page.on('pageerror',error=>report.errors.push(error.message))
 await page.goto(server.resolvedUrls.local[0])
 await page.evaluate(()=>{document.body.innerHTML='';const script=document.createElement('script');script.type='module';script.src='/output/playwright/grid-layer-smoke/harness.js';document.head.append(script)})
 await page.waitForFunction(()=>typeof window.setGridView==='function')
 for(const scale of [1,.75,.375,.1,.01,1]){
  await page.evaluate(scale=>window.setGridView(scale),scale)
  await page.waitForFunction(scale=>{
   const main=document.querySelector('.vello-board'),grid=main?.querySelector('.vello-environment')
   return main?.dataset.acceptedScale===String(scale)&&grid?.dataset.acceptedGeneration&&main.dataset.pending==='false'
  },scale,{timeout:30000})
  const png=await page.locator('.vello-board').screenshot({path:path.join(out,`zoom-${scale}.png`)})
  const pixels=await page.evaluate(async base64=>{
   const blob=await(await fetch('data:image/png;base64,'+base64)).blob(),bitmap=await createImageBitmap(blob),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let lit=0;for(let i=0;i<data.length;i+=4)if(data[i+1]>80&&data[i+2]>80&&data[i]<40)lit++;return {lit,width:canvas.width,height:canvas.height,gridTransform:document.querySelector('.vello-environment canvas').style.transform}
  },png.toString('base64'))
  assert.ok(pixels.lit>1000,`actual composited grid visible at ${scale}`)
  assert.equal(pixels.gridTransform,'','environment never scales retained raster')
  report.samples.push({scale,...pixels})
 }
 assert.deepEqual(report.errors,[])
 report.pass=true
 console.log(JSON.stringify(report))
}finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await server.close()}
