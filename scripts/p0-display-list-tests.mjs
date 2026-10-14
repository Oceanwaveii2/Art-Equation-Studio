import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const contractSource = await readFile(new URL('../src/canvas-engine/paintDisplayList.ts', import.meta.url), 'utf8')
const { compileVectorPaintList } = await import(url(compile(contractSource)))
const engine = await import(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm.js', import.meta.url))
const wasm = await readFile(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm', import.meta.url))
await engine.default({ module_or_path: wasm })
const rect = (x,y,w,h) => [['M',x,y],['L',x+w,y],['L',x+w,y+h],['L',x,y+h],['Z']]
const vector = (id,color,commands,extra={}) => ({id,kind:'vector',order:0,transform:[1,0,0,1,0,0],payload:{commands,fill:color,strokeWidth:0},...extra})
const draw = object => ({type:'vector',object})
const scope = (id,commands,extra={}) => ({type:'pushComposite',scopeId:id,commands,transform:[1,0,0,1,0,0],fillRule:'nonzero',isolation:'isolated',opacity:1,blendMode:'normal',...extra})
const clip = (id,commands,extra={}) => ({type:'pushClip',scopeId:id,commands,transform:[1,0,0,1,0,0],fillRule:'nonzero',isolation:'isolated',...extra})
const pop = id => ({type:'pop',scopeId:id})
const list = operations => ({schema:'art-equation.display-list',schemaVersion:2,sceneId:'disposable-display-list',revision:'1',environment:{background:'#00000000',colorSpace:'srgb'},resources:[],operations})
const render = (value, scale=1, backing=1) => engine.render_cpu_snapshot(512*backing,224*backing,JSON.stringify(value),scale*backing,0,0)
const pixel = (image,x,y,width=512) => [...image.slice((y*width+x)*4,(y*width+x)*4+4)]
const cases=[], check=(name,fn)=>{fn();cases.push(name)}
check('canonical batch compiler keeps primitive references and sorts stable authored order without mutating arrays',()=>{
  const objects=[vector('top','#ff0000',rect(0,0,64,64),{order:2}),vector('bottom','#0000ff',rect(0,0,64,64),{order:0}),vector('tie','#00ff00',rect(0,0,64,64),{order:2})]
  const before=JSON.stringify(objects), result=compileVectorPaintList({sceneId:'s',revision:'1',objects})
  assert.deepEqual(result.operations.map(op=>op.object.id),['bottom','top','tie']);assert.equal(result.operations[1].object,objects[0]);assert.equal(JSON.stringify(objects),before)
  assert.deepEqual(pixel(render(result),16,16),[0,255,0,255])
})
check('bad primitive identities or ordering are refused at compilation',()=>{
  for(const objects of [[vector('a','red',[]) ,vector('a','blue',[])],[vector('','red',[])],[vector('a','red',[],{order:NaN})]])assert.throws(()=>compileVectorPaintList({sceneId:'s',revision:'1',objects}))
})
check('V1 and V2 paint agree byte for byte for compiled fill/stroke/alpha/transform paths',()=>{
  const objects=[vector('a','#ff0000',rect(8,8,32,32),{opacity:.5}),vector('b','#0000ff',rect(24,24,32,32),{order:2,transform:[1,0,0,1,5,0]})]
  objects[0].payload.stroke='#ffffff';objects[0].payload.strokeWidth=4
  const v1={schema:'art-equation.scene',schemaVersion:1,sceneId:'s',revision:'1',environment:{background:'#00000000'},objects,connections:[]}
  const v2=compileVectorPaintList(v1)
  assert.deepEqual(render(v2),render(v1))
})
const ops=[
  scope('alpha',rect(0,0,88,80),{opacity:.5}),draw(vector('alpha-red','#ff0000',rect(8,8,40,40))),draw(vector('alpha-blue','#0000ff',rect(32,8,40,40))),pop('alpha'),
  clip('translated',rect(0,0,80,80),{transform:[1,0,0,1,112,0]}),clip('hole',[...rect(120,8,64,64),...rect(140,28,24,24)],{fillRule:'evenodd'}),draw(vector('hole-red','#ff0000',rect(0,0,512,80))),pop('hole'),pop('translated'),
  clip('rotated',rect(0,0,32,48),{transform:[0,1,-1,0,280,4]}),draw(vector('rot-blue','#0000ff',rect(208,0,96,80))),pop('rotated'),
  draw(vector('multiply-bg','#ff0000',rect(320,0,80,80))),scope('multiply',rect(328,8,64,64),{blendMode:'multiply'}),draw(vector('multiply-blue','#0000ff',rect(320,0,80,80))),pop('multiply'),
  draw(vector('screen-bg','#ff0000',rect(416,0,80,80))),scope('screen',rect(424,8,64,64),{blendMode:'screen'}),draw(vector('screen-blue','#0000ff',rect(416,0,80,80))),pop('screen'),
  draw(vector('isolated-bg','#ff0000',rect(8,100,80,80))),clip('isolated-clip',rect(16,108,64,64)),scope('isolated-multiply',rect(8,100,80,80),{blendMode:'multiply'}),draw(vector('isolated-blue','#0000ff',rect(8,100,80,80))),pop('isolated-multiply'),pop('isolated-clip'),
  scope('zero',rect(112,100,80,80),{opacity:0}),draw(vector('zero-green','#00ff00',rect(112,100,80,80))),pop('zero'),
  clip('empty',[]),draw(vector('empty-green','#00ff00',rect(208,100,80,80))),pop('empty'),
  scope('nested-alpha',rect(304,100,80,80),{opacity:.5}),scope('nested-alpha-child',rect(304,100,80,80),{opacity:.5}),draw(vector('nested-red','#ff0000',rect(312,108,64,64))),pop('nested-alpha-child'),pop('nested-alpha'),
]
const fixture=list(ops)
const samples=[
  {name:'single group red',x:16,y:16,rgba:[255,0,0,128]}, {name:'overlap alpha applies once',x:40,y:16,rgba:[0,0,255,128]},
  {name:'translated nested clip',x:128,y:16,rgba:[255,0,0,255]}, {name:'evenodd hole',x:152,y:40,rgba:[0,0,0,0]},
  {name:'outside clip',x:112,y:16,rgba:[0,0,0,0]}, {name:'rotated clip',x:250,y:20,rgba:[0,0,255,255]},
  {name:'outside rotated clip',x:290,y:20,rgba:[0,0,0,0]}, {name:'multiply',x:344,y:24,rgba:[0,0,0,255]},
  {name:'screen',x:440,y:24,rgba:[255,0,255,255]}, {name:'isolated nested blend',x:40,y:140,rgba:[0,0,255,255]},
  {name:'outside isolated blend clip',x:12,y:104,rgba:[255,0,0,255]}, {name:'zero opacity',x:152,y:140,rgba:[0,0,0,0]},
  {name:'empty clip',x:250,y:140,rgba:[0,0,0,0]}, {name:'nested opacity quarter',x:344,y:140,rgba:[255,0,0,64]},
]
check('analytical ordered-scope fixture matches genuine CPU samples',()=>{
  const pixels=render(fixture);for(const s of samples)assert.deepEqual(pixel(pixels,s.x,s.y),s.rgba,s.name)
})
check('shared camera/backing scaling preserves analytical interior samples',()=>{
  for(const scale of [.5,1,2])for(const backing of [1,2]){
    const pixels=render(fixture,scale,backing)
    for(const s of samples){const x=Math.floor(s.x*scale*backing),y=Math.floor(s.y*scale*backing);if(x>=512*backing||y>=224*backing)continue;assert.deepEqual(pixel(pixels,x,y,512*backing),s.rgba,`${s.name}/${scale}/${backing}`)}
  }
})
check('unclosed/wrong pop/unsupported resource or operation cannot return a partial CPU frame',()=>{
  for(const bad of [list([pop('x')]),list([scope('x',rect(0,0,4,4))]),list([scope('x',rect(0,0,4,4)),pop('y')]),{...fixture,resources:[{id:'missing'}]},list([{type:'image',resource:'missing'}]),list([scope('x',rect(0,0,4,4),{blendMode:'overlay'}),pop('x')])])assert.throws(()=>render(bad))
})
const backdropSource=await readFile(new URL('../src/board/VelloBoardBackdrop.tsx',import.meta.url),'utf8')
check('actual production transport invokes the ordered wrapper while existing eligibility stays intact',()=>{
  const source=ts.createSourceFile('backdrop.tsx',backdropSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const names=[];const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='encoded')names.push(n.initializer?.expression?.getText(source));ts.forEachChild(n,visit)};visit(source)
  assert(names.includes('velloDisplayListSnapshot'));assert(backdropSource.includes('const legacy = velloBoardSnapshot(scene, selectedIds, cameraScale, liveEdits)'))
})
const evidence=new URL('../../docs/engine-p0/2026-10-03/display-list/',import.meta.url);await mkdir(evidence,{recursive:true})
await writeFile(new URL('scope-fixture.json',evidence),JSON.stringify({fixture,samples},null,2))
await writeFile(new URL('display-list-tests.json',evidence),JSON.stringify({checkedAt:new Date().toISOString(),passed:true,checks:cases.length,cases,wasmSha256:createHash('sha256').update(wasm).digest('hex'),sourceHashes:{paintDisplayList:createHash('sha256').update(contractSource).digest('hex'),backdrop:createHash('sha256').update(backdropSource).digest('hex')},limits:['GenuineCPU/contract checks; actual GPU pixels and native runtime require separate acceptance.','No image/text/card paint ownership expansion; scope isolation is explicit, not passthrough CSS parity.']},null,2))
console.log(JSON.stringify({passed:true,checks:cases.length,samples:samples.length}))
