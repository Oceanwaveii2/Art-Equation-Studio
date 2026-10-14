import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
const root=path.resolve('src'), out=path.resolve('.layout-test/modules-'+Date.now()); const built=new Map()
async function compile(file){
 const target=path.join(out,path.relative(root,file)).replace(/\.tsx?$/,'.js');if(built.has(file))return target;built.set(file,target)
 let code=ts.transpileModule(await fs.readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 for(const match of [...code.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)]){const source=path.resolve(path.dirname(file),match[1]);const resolved=/\.tsx?$/.test(source) ? source : await fs.stat(source+'.ts').then(()=>source+'.ts').catch(()=>source+'.tsx');const dependency=await compile(resolved);code=code.replaceAll(`'${match[1]}'`,`'${pathToFileURL(dependency).href}'`).replaceAll(`"${match[1]}"`,`"${pathToFileURL(dependency).href}"`)}
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,code);return target
}
const tools=await import(pathToFileURL(await compile(path.join(root,'board/layoutResearch.ts'))))
const safety=await import(pathToFileURL(await compile(path.join(root,'board/boardMutationSafety.ts'))))
const history=await import(pathToFileURL(await compile(path.join(root,'board/nativeCommandJournal.ts'))))
const node=(id,x,y,width=100,height=80,extra={})=>({id,kind:'image',title:id,x,y,width,height,...extra})
const board={id:'root',title:'Research',viewport:{x:0,y:0,scale:1},nodes:[node('column',0,0,240,300,{kind:'column'}),node('child',10,68,200,80,{parentColumnId:'column',columnOrder:0}),node('portal',10,160,100,100,{kind:'board-link',parentColumnId:'column',columnOrder:1,targetBoardId:'sub',boardPortal:true}),node('free',500,60),node('lock',350,0,100,400,{locked:true})],connectors:[]}
const guide=tools.createLayoutGuide(board,['column','free'],'x','start');assert.ok(guide)
const guided={...board,layoutGuides:[guide]};const moved=tools.moveLayoutGuide(guided,guide.id,100)
assert.equal(moved.nodes.find(n=>n.id==='child').x,110);assert.equal(moved.nodes.find(n=>n.id==='portal').targetBoardId,'sub');assert.equal(moved.nodes.find(n=>n.id==='lock').x,350)
assert.equal(safety.validateBoardMutation(guided,moved).ok,true)
const manual={...moved,nodes:moved.nodes.map(n=>n.id==='free'?{...n,x:n.x+17}:n)}
const tweaked=tools.reconcileLayoutGuides(moved,manual);assert.equal(tweaked.layoutGuides[0].members[1].offset,517)
const movedAgain=tools.moveLayoutGuide(tweaked,guide.id,200);assert.equal(movedAgain.nodes.find(n=>n.id==='free').x,717)
assert.deepEqual(JSON.parse(JSON.stringify(movedAgain)).layoutGuides,movedAgain.layoutGuides)
const lockedChild={...guided,nodes:guided.nodes.map(n=>n.id==='child'?{...n,locked:true}:n)};assert.equal(tools.moveLayoutGuide(lockedChild,guide.id,100),lockedChild)
const plan=tools.proposeLayout(board,['column','free','lock'],'rows');assert.ok(plan.warnings.length);assert.equal(plan.board.nodes.find(n=>n.id==='lock').x,350)
for(const old of board.nodes){const next=plan.board.nodes.find(n=>n.id===old.id);assert.equal(next.width,old.width);assert.equal(next.height,old.height)}
assert.equal(safety.validateBoardMutation(board,plan.board).ok,true);assert.ok(tools.acceptLayoutProposal(board,plan));assert.equal(tools.acceptLayoutProposal(manual,plan),null)
const undo=[],redo=[];history.recordNativeCommand(undo,redo,board,plan.board);assert.equal(history.undoNativeCommand(undo,redo),board);assert.equal(history.redoNativeCommand(undo,redo),plan.board)
const assets=[{id:'a',displayName:'Landscape',tags:['Landscape']},{id:'b',displayName:'Forest',tags:['Landscape']}]
const images={...board,nodes:[node('a1',0,0,350,170,{assetId:'a'}),node('a2',0,220,150,300,{assetId:'a'}),node('locked',500,0,100,100,{assetId:'b',locked:true})]}
for(const target of ['groups','columns']){const organized=tools.organizeSemanticClusters(images,[{title:'Landscape',assetIds:['a','b']}],target,assets);assert.equal(organized.moved,2);assert.equal(organized.board.nodes.filter(n=>n.assetId==='a').length,2);assert.deepEqual(organized.board.nodes.find(n=>n.id==='locked'),images.nodes[2]);for(const old of images.nodes){const next=organized.board.nodes.find(n=>n.id===old.id);assert.equal(next.width,old.width);assert.equal(next.height,old.height)};assert.equal(safety.validateBoardMutation(images,organized.board).ok,true)}
assert.equal(tools.semanticClusterLabel(['a','b'],assets,0),'Landscape')
const captionBoard={...board,nodes:[node('media',0,0,300,200),node('caption',0,215,300,40,{kind:'text'})]};assert.equal(tools.suggestLayoutHierarchy(captionBoard).length,1)
const relationship=tools.suggestLayoutHierarchy(captionBoard)[0];const grouped=tools.groupHierarchySuggestion(captionBoard,relationship);assert.equal(grouped.nodes.filter(n=>n.kind==='group').length,1);assert.equal(safety.validateBoardMutation(captionBoard,grouped).ok,true);assert.equal(tools.suggestLayoutHierarchy({...captionBoard,nodes:captionBoard.nodes.map(n=>n.id==='caption'?{...n,y:-55}:n)}).length,1);
console.log('Layout research: guide offsets, lock/ownership/portal retention, size preservation, stale preview, single-command undo, duplicate assets, columns, labels and captions passed')




// Fractional source artwork must move without tripping ownership safeguards.
for (const name of ['sample-miami-by-giordano-poloni','BasketballMohawks','sample-vision-by-nastka-drabot']) {
 const original=JSON.parse(await fs.readFile(path.resolve('../evidence/vector-samples/'+name+'.board.json'),'utf8'));
 const delta={x:68.67080000000001,y:47.668200000000006};
 const translated={...original,nodes:original.nodes.map(n=>({...n,x:n.x+delta.x,y:n.y+delta.y}))};
 assert.equal(safety.validateBoardMutation(original,translated).ok,true,name+' fractional layer move');
 const child=original.nodes.find(n=>n.groupId);
 assert.ok(child);
 const drifted={...translated,nodes:translated.nodes.map(n=>n.id===child.id?{...n,x:n.x+.0001}:n)};
 assert.equal(safety.validateBoardMutation(original,drifted).ok,false,name+' rejects inconsistent child move');
 const locked={...original,nodes:original.nodes.map(n=>n.id===child.id?{...n,locked:true}:n)};
 assert.equal(safety.validateBoardMutation(locked,translated).ok,false,name+' protects locked child');
}
console.log('Fractional imported artwork: whole-layer movement passes; child drift and locked descendants rejected')

