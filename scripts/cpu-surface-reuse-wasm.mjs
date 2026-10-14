import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import init,{B4CpuRenderer} from '../src/project-b/p0-surface/generated/p0_engine_wasm.js'
const bytes=await fs.readFile(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm',import.meta.url))
await init({module_or_path:bytes})
const renderer=new B4CpuRenderer()
const scene=JSON.stringify({schema:'art-equation.scene',schemaVersion:1,documentId:'cpu-reuse',sceneId:'cpu-reuse',revision:'1',
 coordinateSystem:{units:'document-unit',xAxis:'right',yAxis:'down'},environment:{background:'#00000000',colorSpace:'srgb'},
 objects:[{id:'r',kind:'vector',order:0,visible:true,opacity:1,locked:false,blendMode:'normal',transform:[1,0,0,1,0,0],
  bounds:{x:4,y:4,width:12,height:12},payload:{commands:[['M',4,4],['L',16,4],['L',16,16],['L',4,16],['Z']],fill:'#ff000080',strokeWidth:0}}],connections:[],assetIds:[]})
try {
 const first=renderer.render_snapshot(32,32,scene,1,0,0)
 const second=renderer.render_snapshot(32,32,scene,1,0,0)
 assert.deepEqual(first,second);assert.equal(first.length,4096)
 assert.deepEqual([...first.slice((8*32+8)*4,(8*32+8)*4+4)],[255,0,0,128])
 const clear=JSON.parse(scene);clear.objects=[]
 assert(renderer.render_snapshot(32,32,JSON.stringify(clear),1,0,0).every(v=>v===0))
 renderer.render_snapshot(16,16,scene,0.5,0,0)
 renderer.render_snapshot(32,32,scene,1,0,0)
 const stats=JSON.parse(renderer.resource_stats())
 assert.equal(stats.cpuSurfaceAllocations,1);assert.equal(stats.cpuSurfaceResizes,2)
 assert.equal(stats.cpuSurfaceBytes,4096);assert.equal(stats.cpuAdditionalThreads,0)
 assert.throws(()=>renderer.render_snapshot(32,32,'broken',1,0,0))
 assert.deepEqual(renderer.render_snapshot(32,32,scene,1,0,0),first)
 renderer.dispose();assert.equal(JSON.parse(renderer.resource_stats()).cpuSurfaceBytes,0)
 assert.throws(()=>renderer.render_snapshot(32,32,scene,1,0,0))
 const report={scope:'actual rebuilt WASM CPU pixels and resource reuse in Node; no browser worker/GPU/native-app/4K qualification',
  pass:true,wasmSha256:createHash('sha256').update(bytes).digest('hex'),stats}
 await fs.writeFile('output/cpu-surface-reuse-wasm-20261011.json',JSON.stringify(report,null,2))
 console.log(JSON.stringify(report))
}finally{renderer.free()}
