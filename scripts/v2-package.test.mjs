import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
const root=path.resolve('src'), out=path.resolve('.v2-test/modules'), built=new Map()
async function compile(file) {
  if(built.has(file)) return built.get(file)
  const target=path.join(out,path.relative(root,file)).replace(/\.tsx?$/,'.js');built.set(file,target)
  let code=ts.transpileModule(await fs.readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
  for(const match of [...code.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)]) {
    const source=path.resolve(path.dirname(file),match[1]);const resolved=/\.tsx?$/.test(source)?source:source+'.ts'
    const dependency=await compile(resolved);code=code.replaceAll(`'${match[1]}'`,`'${pathToFileURL(dependency).href}'`).replaceAll(`"${match[1]}"`,`"${pathToFileURL(dependency).href}"`)
  }
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,code);return target
}
const columns=await import(pathToFileURL(await compile(path.join(root,'board/columns.ts'))))
const structure=await import(pathToFileURL(await compile(path.join(root,'board/diagramStructureCore.ts'))))
const hierarchy=await import(pathToFileURL(await compile(path.join(root,'board/boardHierarchy.ts'))))
const release=path.resolve('../release')
const project=JSON.parse(await fs.readFile(path.join(release,'projects/p1-v2-studies/project.json'),'utf8'))
const roots=project.boards.filter(b=>!b.parentBoardId)
assert.equal(roots.length,8);assert.equal(project.boards.length,32)
assert.equal(hierarchy.normalizeBoardHierarchy(project.boards).issues.length,0)
const boardIds=new Set(project.boards.map(b=>b.id)),assets=new Map(project.assets.map(a=>[a.id,a]))
let objects=0,connectors=0,vectors=0,textures=0
for(const board of project.boards) {
  assert.equal(structure.validateContainerOwnership(board.nodes).ok,true,`Ownership: ${board.id}`)
  assert.deepEqual(columns.layoutBoardColumns(board),board,`Opening must preserve authored layout: ${board.id}`)
  const ids=new Set(board.nodes.map(n=>n.id));assert.equal(ids.size,board.nodes.length)
  for(const node of board.nodes) {
    assert.ok([node.x,node.y,node.width,node.height].every(Number.isFinite))
    assert.ok(node.width>0 && node.height>0)
    if(node.assetId) assert.ok(assets.has(node.assetId))
    if(node.targetBoardId) assert.ok(boardIds.has(node.targetBoardId))
    vectors+=Number(Boolean(node.vectorPath));textures+=Number(Boolean(node.vectorTexture))
  }
  for(const edge of board.connectors) {
    if(edge.sourceId)assert.ok(ids.has(edge.sourceId));if(edge.targetId)assert.ok(ids.has(edge.targetId))
  }
  objects+=board.nodes.length;connectors+=board.connectors.length
}
const inventory=JSON.parse(await fs.readFile('../board-packaging-report.json','utf8'))
for(const item of inventory.assets) {
  assert.ok(!path.isAbsolute(item.relativePath));assert.ok(!item.relativePath.includes('..'))
  const bytes=await fs.readFile(path.join(release,item.relativePath));assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256)
}
assert.equal(vectors,674);assert.equal(textures,23)
const report={passed:true,mainBoards:8,childBoards:24,objects,connectors,vectors,textures,verifiedManagedMedia:inventory.assets.length,checks:['canonical ownership','source geometry survives opening','portal targets','connector endpoints','editable vector paths and textures','managed original SHA256']}
await fs.writeFile('../package-verification.json',JSON.stringify(report,null,2));console.log(report)
