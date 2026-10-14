import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
const source=ts.transpileModule(await fs.readFile('src/canvas-engine/frameHandoff.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {canRetainModelFrame}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const image={id:'image',kind:'image',modelArtwork:{kind:'image'},bounds:{x:0,y:0,width:100,height:60}}
const scene={id:'board-a',revision:1,objects:[image]};const owned=new Set(['image'])
assert.equal(canRetainModelFrame(scene,{...scene,revision:2,objects:[{...image,bounds:{...image.bounds,x:20}}]},owned,false),true)
assert.equal(canRetainModelFrame(scene,{...scene,id:'board-b'},owned,false),false)
assert.equal(canRetainModelFrame(scene,{...scene,objects:[]},owned,false),false)
assert.equal(canRetainModelFrame(scene,{...scene,objects:[{...image,hidden:true}]},owned,false),false)
assert.equal(canRetainModelFrame(scene,{...scene,objects:[image,{id:'movie',kind:'video'}]},owned,false),false)
assert.equal(canRetainModelFrame(scene,scene,owned,true),false)
assert.equal(canRetainModelFrame(scene,scene,new Set(),false),false)
console.log('Frame handoff: native artwork retains last pixels during model updates; board changes, removals, hidden content, mixed media and active editing refuse retention')
