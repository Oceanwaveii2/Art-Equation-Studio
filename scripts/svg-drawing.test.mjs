import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
const root=path.resolve('src'),out=path.resolve('.layout-test/svg-'+Date.now()),built=new Map()
async function compile(file){
 const target=path.join(out,path.relative(root,file)).replace(/\.tsx?$/,'.js');if(built.has(file))return target;built.set(file,target)
 let code=ts.transpileModule(await fs.readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 for(const match of [...code.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)]){const source=path.resolve(path.dirname(file),match[1]),resolved=/\.tsx?$/.test(source)?source:source+'.ts',dependency=await compile(resolved);code=code.replaceAll(`'${match[1]}'`,`'${pathToFileURL(dependency).href}'`).replaceAll(`"${match[1]}"`,`"${pathToFileURL(dependency).href}"`)}
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,code);return target
}
const load=async name=>import(pathToFileURL(await compile(path.join(root,name))))
const importer=await load('board/svgDrawingImport.ts'),safety=await load('board/boardMutationSafety.ts'),svg=await load('board/vectorSvg.ts'),vector=await load('model/vector.ts')
const structure=await load('board/diagramStructureCore.ts')
const evidence=path.resolve('../evidence/vector-samples'),reports=[]
for(const name of ['sample-vision-by-nastka-drabot','sample-miami-by-giordano-poloni','BasketballMohawks']){
 const tree=JSON.parse(await fs.readFile(path.join(evidence,name+'.tree.json'),'utf8'))
 const result=importer.importSvgTree(tree,name,name),warnings=result.warnings
 console.log(name,{shapes:result.sourceShapes,objects:result.nodes.length,layers:result.layers.length,warnings})
 const board={id:name,title:name,nodes:[],connectors:[],viewport:{x:0,y:0,scale:1}}
 assert.deepEqual(warnings,[],name+' complete import')
 const paintOrder=structure.containerPaintOrder(result.nodes);assert.equal(paintOrder.ok,true);const shapeIds=new Set(result.nodes.filter(n=>n.kind==='shape').map(n=>n.id));assert.deepEqual(paintOrder.value.orderedIds.filter(id=>shapeIds.has(id)),[...shapeIds],name+' canvas source stacking order');
 const imported=importer.appendSvgDrawing(board,result);assert.equal(safety.validateBoardMutation(board,imported).ok,true)
 const finite=value=>{if(typeof value==='number')assert.ok(Number.isFinite(value),name+' finite model number');else if(value&&typeof value==='object')for(const v of Object.values(value))finite(v)};finite(imported);assert.deepEqual(JSON.parse(JSON.stringify(imported)),imported);assert.ok(imported.nodes.every(n=>Number.isFinite(n.strokeWidth??0)),name+" finite stroke widths")
 for(const n of result.nodes.filter(n=>n.kind==='shape')){
  assert.equal(n.shapeType,'path');assert.ok(n.vectorPath.points.length>=2)
  const resized=vector.resizeVectorNodeFrame(n,{x:n.x,y:n.y,width:n.width*2,height:n.height*3})
  if(n.vectorFillGradient)assert.equal(resized.vectorFillGradient.transform[4],n.vectorFillGradient.transform[4]*2)
  if(n.vectorStrokeGeometry&&n.vectorStrokeGradient)assert.deepEqual(resized.vectorStrokeGradient,n.vectorStrokeGradient,"stroke gradient remains in original stroke space");
  if(n.vectorTexture)assert.ok(Math.abs(resized.vectorTexture.transform[5]-n.vectorTexture.transform[5]*3)<1e-8)
 }
 const markup=`<svg xmlns="http://www.w3.org/2000/svg" width="${result.width}" height="${result.height}" viewBox="0 0 ${result.width} ${result.height}">${result.nodes.filter(n=>n.kind==='shape').map(n=>svg.vectorNodeSvgMarkup(n)).join('')}</svg>`
 await fs.writeFile(path.join(evidence,name+'.recreated.svg'),markup)
 await fs.writeFile(path.join(evidence,name+'.board.json'),JSON.stringify(imported))
 reports.push({name,sourceShapes:result.sourceShapes,editablePaths:result.nodes.filter(n=>n.vectorPath&&!n.vectorTexture).length,textures:result.nodes.filter(n=>n.vectorTexture).length,gradients:result.nodes.filter(n=>n.vectorFillGradient||n.vectorStrokeGradient).length,layers:result.layers.length,width:result.width,height:result.height})
}
const valid={version:1,kind:'linear',transform:[1,0,0,1,0,0],start:{x:0,y:0},end:{x:1,y:0},spread:'pad',stops:[{offset:0,color:'#000000',opacity:1},{offset:1,color:'#ffffff',opacity:0}]}
const b={id:'paint',nodes:[{id:'p',kind:'shape',shapeType:'path',x:0,y:0,width:100,height:100,vectorFillGradient:valid}],connectors:[],viewport:{x:0,y:0,scale:1}}
assert.equal(safety.validateBoardMutation({...b,nodes:[]},b).ok,true)
assert.equal(safety.validateBoardMutation(b,{...b,nodes:[{...b.nodes[0],fillOpacity:NaN}]}).ok,false)
assert.equal(safety.validateBoardMutation(b,{...b,nodes:[{...b.nodes[0],vectorFillGradient:{...valid,transform:[NaN,0,0,1,0,0]}}]}).ok,false)
await fs.writeFile(path.join(evidence,'drawing-import-report.json'),JSON.stringify(reports,null,2))
const pathNode={id:'edit',kind:'shape',shapeType:'path',x:0,y:0,width:100,height:100,vectorPath:{version:1,closed:true,points:[{x:10,y:20},{x:70,y:20},{x:70,y:80}]},vectorFillGradient:valid,vectorStrokeGradient:valid,vectorStrokeGeometry:{paths:[{version:1,closed:true,points:[{x:0,y:0},{x:30,y:0},{x:30,y:20}]}],transform:[2,0,0,3,10,20]}}
const edited=vector.synchronizeVectorStroke({...pathNode,vectorPath:{...pathNode.vectorPath,points:[{x:12,y:24},{x:75,y:20},{x:70,y:80}]}})
const g=edited.vectorStrokeGeometry,[a,c,d,e,f,h]=g.transform
const baked=vector.transformVectorPath(g.paths[0],{a,b:c,c:d,d:e,e:f,f:h})
for(let i=0;i<baked.points.length;i++){assert.ok(Math.abs(baked.points[i].x-edited.vectorPath.points[i].x)<1e-8);assert.ok(Math.abs(baked.points[i].y-edited.vectorPath.points[i].y)<1e-8)}
const transformed=vector.resizeVectorNodeFrame({...pathNode,vectorTransform:{translateX:7,translateY:9}},{x:0,y:0,width:200,height:300})
assert.equal(transformed.vectorFillGradient.transform[4],14);assert.equal(transformed.vectorFillGradient.transform[5],27)
assert.deepEqual(pathNode.vectorStrokeGeometry.transform,[2,0,0,3,10,20],'Undo baseline immutable')
console.log('PASS: sample geometry, paint, clipping, serialization, resize and mutation guards')
