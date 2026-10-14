import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {chromium} from 'playwright-core'
import {createServer} from 'vite'
const out='output/playwright/model-viewer-idle';await fs.mkdir(out,{recursive:true})
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
try{
 const page=await browser.newPage({viewport:{width:640,height:480}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(server.resolvedUrls.local[0]+'src/board/ModelViewer.tsx')
 await page.evaluate(async()=>{
  document.body.replaceChildren();const host=document.createElement('div');host.style.cssText='width:400px;height:300px';document.body.append(host)
  const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default,React=(await import('/node_modules/.vite/deps/react.js')).default
  const RefreshRuntime=(await import('/@react-refresh')).default;RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true
  const {ModelViewer}=await import('/src/board/ModelViewer.tsx')
  const values=new Float32Array([-1,0,0,1,0,0,0,1,0]),bytes=new Uint8Array(values.buffer)
  const buffer='data:application/octet-stream;base64,'+btoa(String.fromCharCode(...bytes))
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:bytes.length,uri:buffer}],bufferViews:[{buffer:0,byteOffset:0,byteLength:bytes.length}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,0],max:[1,1,0]}]}
  const raf=window.requestAnimationFrame.bind(window);window.__frames=0;window.requestAnimationFrame=callback=>{window.__frames++;return raf(callback)}
  window.__root=createRoot(host);window.__root.render(React.createElement(ModelViewer,{source:'data:model/gltf+json;base64,'+btoa(JSON.stringify(json)),extension:'gltf',title:'Idle fixture'}))
 })
 await page.getByText('Orbit · zoom · pan',{exact:true}).waitFor({timeout:15000})
 await page.waitForTimeout(700);const initial=await page.evaluate(()=>window.__frames);await page.waitForTimeout(350)
 assert.equal(await page.evaluate(()=>window.__frames),initial,'Idle 3D viewer must stop requesting frames')
 await page.locator('canvas').hover();await page.mouse.wheel(0,120);await page.waitForTimeout(700)
 const interacted=await page.evaluate(()=>window.__frames);assert(interacted>initial,'Orbit zoom must wake the renderer');await page.waitForTimeout(350)
 assert.equal(await page.evaluate(()=>window.__frames),interacted,'Controls must settle back to idle')
 await page.evaluate(()=>{document.body.firstElementChild.style.width='420px'});await page.waitForTimeout(250)
 const resized=await page.evaluate(()=>window.__frames);assert(resized>interacted,'Resize must wake the renderer')
 await page.screenshot({path:out+'/viewer.png'});await page.evaluate(()=>window.__root.unmount());await page.waitForTimeout(100);const closed=await page.evaluate(()=>window.__frames);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__frames),closed);assert.deepEqual(errors,[])
 await fs.writeFile(out+'/report.json',JSON.stringify({passed:true,scope:'Actual GLTF, Three WebGL viewer and controls; bounded idle/zoom/resize/disposal checks, not app performance qualification.',initial,interacted,resized,errors},null,2));console.log('Model viewer idle: PASS')
}finally{await browser.close();await server.close()}



