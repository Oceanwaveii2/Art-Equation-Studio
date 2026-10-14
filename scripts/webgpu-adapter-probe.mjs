import { chromium } from 'playwright-core'
import fs from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:process.env.AUDIT_HEADED!=='1'})
try {
 const page=await browser.newPage()
 await page.route('**/adapter-probe',route=>route.fulfill({contentType:'text/html',body:'<title>Adapter capability probe</title>'}))
 await page.goto('http://127.0.0.1:5194/adapter-probe')
 const result=await page.evaluate(async()=>{
  if(!navigator.gpu)return {available:false,reason:'WEBGPU_UNAVAILABLE'}
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance',forceFallbackAdapter:false})
  if(!adapter)return {available:false,reason:'ADAPTER_UNAVAILABLE'}
  const info=adapter.info
  return {available:true,info:{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:info.isFallbackAdapter??adapter.isFallbackAdapter??null},features:[...adapter.features],limits:{maxTextureDimension2D:adapter.limits.maxTextureDimension2D,maxComputeWorkgroupSizeX:adapter.limits.maxComputeWorkgroupSizeX,maxComputeInvocationsPerWorkgroup:adapter.limits.maxComputeInvocationsPerWorkgroup}}
 })
 const report={scope:'Separate browser adapter enumeration; not actual renderer ownership or frame timing.',browser:await browser.version(),headed:process.env.AUDIT_HEADED==='1',...result}
 await fs.writeFile('../evidence/webgpu-adapter-probe.json',JSON.stringify(report,null,2))
 console.log(JSON.stringify(report,null,2))
}finally{await browser.close()}
