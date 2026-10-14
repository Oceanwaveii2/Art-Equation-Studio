import {createServer} from 'vite'
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const root='D:/0/ArtEquation-Tests/2026-10-11-mixed-baseline'
const manifest=JSON.parse(await fs.readFile(root+'/fixture-manifest.json','utf8'))
const server=await createServer({server:{host:'127.0.0.1',port:0}})
const report={scope:'Fixture structure and production scene projection in Node; no renderer, GPU benchmark or FPS measurements.',status:'CHECKING',results:[]}
try{
 const {createArtEquationCanvasScene}=await server.ssrLoadModule('/src/board/artEquationCanvasAdapter.ts')
 for(const fixture of manifest.fixtures){
  const text=await fs.readFile(fixture.project,'utf8');assert.equal(createHash('sha256').update(text).digest('hex'),fixture.projectSha256)
  const p=JSON.parse(text),b=p.boards[0],ids=new Set(b.nodes.map(n=>n.id));assert.equal(ids.size,fixture.count)
  for(const n of b.nodes){if(n.kind==='shape')assert.ok(['rectangle','ellipse','line','arrow','path'].includes(n.shapeType),'Unsupported shape type '+n.shapeType);if(n.parentColumnId)assert.ok(ids.has(n.parentColumnId));if(n.targetBoardId)assert.ok(p.boards.some(b=>b.id===n.targetBoardId));for(const input of n.graphColumn?.inputs||[])assert.ok(ids.has(input.sourceId))}
  for(const a of p.assets){const bytes=await fs.readFile(fixture.workspace+'/'+a.relativePath);assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256)}
  const sources=new Map(p.assets.map(a=>[a.id,'file:///'+(fixture.workspace+'/'+a.relativePath).replaceAll('\\','/')]))
  const scene=createArtEquationCanvasScene(b,p.assets,{background:'#102131',grid:'#254052'},sources)
  assert.ok(scene.objects.length>=fixture.count);assert.ok(scene.objects.every(o=>[o.bounds.x,o.bounds.y,o.bounds.width,o.bounds.height].every(Number.isFinite)))
  assert.equal(scene.objects.filter(o=>o.modelArtwork?.kind==='image').length,fixture.count/4)
  assert.ok(scene.objects.filter(o=>o.structuredCard).every(o=>o.structuredCard.result==='2 records'))
  report.results.push({count:fixture.count,authoredNodes:b.nodes.length,projectedObjects:scene.objects.length,connectors:b.connectors.length,imagesVerified:p.assets.length,linksAndParentsValid:true})
 }
 report.status='FIXTURE_VALIDATION_PASS; GPU_BASELINE_DEFERRED'
}catch(error){report.status='FAIL';report.error=String(error);throw error}
finally{await fs.writeFile(root+'/validation.json',JSON.stringify(report,null,2));await server.close();console.log(JSON.stringify(report))}
