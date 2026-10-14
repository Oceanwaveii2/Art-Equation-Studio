import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
const cache = new Map()
async function moduleUrl(file) {
  file=resolve(file); if(cache.has(file))return cache.get(file)
  let code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  for(const match of [...code.matchAll(/from ['"](.+?)['"]/g)]) {
    if(!match[1].startsWith('.'))continue
    code=code.replace(match[0], "from '"+await moduleUrl(resolve(dirname(file),match[1]+'.ts'))+"'")
  }
  const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');cache.set(file,url);return url
}
const {transferBoardSelection}=await import(await moduleUrl('src/board/boardTransfer.ts'))
const {searchProject}=await import(await moduleUrl('src/search/projectSearchModel.ts'))
const {validateBoardMutation}=await import(await moduleUrl('src/board/boardMutationSafety.ts'))
const {createMindMapTemplate}=await import(await moduleUrl('src/board/diagramStructureCore.ts'))
const node=(id,kind,extra={})=>({id,kind,title:id,x:10,y:20,width:100,height:80,...extra})
const edge=(id,extra={})=>({id,sourcePort:'right',targetPort:'left',style:'elbow',color:'#ee942f',width:2,startArrow:true,endArrow:true,dashed:false,animated:false,label:id,linePattern:'dash-dot',relationshipStyle:'dependency',labelPosition:{t:.4,offsetX:8,offsetY:12},...extra})
const fixture=()=>({id:'organization',assets:[{id:'asset',kind:'image',displayName:'Moon reference',tags:['astronomy'],aliases:['lunar'],extension:'png',relativePath:'original.png',status:'available'}],documents:[],boards:[
{id:'source',title:'Research',viewport:{x:17,y:35,scale:.8},nodes:[node('frame','group',{containerRole:'frame'}),node('image','image',{groupId:'frame',assetId:'asset',x:40,rotation:30,imageTransform:{fit:'cover',zoom:1.3}}),node('note','note',{groupId:'frame',x:150,body:'Production question'}),node('portal','board-link',{groupId:'frame',targetBoardId:'child',boardLinkRole:'child',boardPortal:true}),node('outside','shape',{x:900})],connectors:[edge('internal',{sourceId:'image',targetId:'note',bendPoints:[{x:110,y:130}],metadata:{v:1}}),edge('boundary',{sourceId:'note',targetId:'outside',bendPoints:[{x:850,y:140}]}),edge('free',{sourceId:'image',targetPoint:{x:360,y:420},bendPoints:[{x:160,y:240}]})]},
{id:'destination',title:'Production',viewport:{x:4,y:5,scale:1},linkedFolderPath:'original/destination',nodes:[],connectors:[]},
{id:'child',title:'Chapter',parentBoardId:'source',linkedFolderPath:'external/stays',viewport:{x:1,y:2,scale:.5},nodes:[],connectors:[]},
{id:'grandchild',title:'Detail',parentBoardId:'child',viewport:{x:9,y:4,scale:.7},nodes:[node('deep-image','image',{assetId:'asset',title:'Named image'}),node('deep-note','note',{title:'Named note',body:'Find exactly this question'})],connectors:[]}
]})
const checks=[],check=(name,run)=>{run();checks.push(name)}
check('Full owned region moves once, same identities, source links and hierarchy preserved',()=>{
 const before=fixture(),json=JSON.stringify(before),result=transferBoardSelection(before,'source','destination',['frame','image'])
 assert(result.ok); const {project,movedIds,transportedConnectorIds,detachedConnectorIds}=result.value
 assert.deepEqual(movedIds,['frame','image','note','portal']);assert.deepEqual(transportedConnectorIds,['internal','free']);assert.deepEqual(detachedConnectorIds,['boundary'])
 assert.deepEqual(project.boards[1].nodes,before.boards[0].nodes.slice(0,4));assert.deepEqual(project.boards[1].connectors,[before.boards[0].connectors[0],before.boards[0].connectors[2]])
 assert.deepEqual(project.assets,before.assets);assert.equal(project.boards[2].parentBoardId,'destination');assert.equal(project.boards[2].linkedFolderPath,'external/stays');assert.deepEqual(project.boards[3],before.boards[3])
 assert.equal(JSON.stringify(before),json);assert.deepEqual(project.boards.map(b=>b.viewport),before.boards.map(b=>b.viewport))
 assert(!project.boards[0].connectors[0].sourceId);assert.equal(project.boards[0].connectors[0].targetId,'outside');assert(project.boards[0].connectors[0].sourcePoint)
 assert.deepEqual(project.boards[0].connectors[0].bendPoints,before.boards[0].connectors[1].bendPoints)
})
check('Detaching one member drops old visual owner without changing world geometry',()=>{
 const before=fixture(),result=transferBoardSelection(before,'source','destination',['image'])
 assert(result.ok);const moved=result.value.project.boards[1].nodes[0]
 assert(!moved.groupId);assert.equal(moved.x,40);assert.equal(moved.rotation,30);assert.deepEqual(moved.imageTransform,before.boards[0].nodes[1].imageTransform);assert.equal(result.value.project.boards[0].nodes.length,4)
})
check('Explicit translation changes subtree and internal route exactly once',()=>{
 const before=fixture(),result=transferBoardSelection(before,'source','destination',['frame'],{position:{x:410,y:520}});assert(result.ok)
 for(const original of before.boards[0].nodes.slice(0,4)){const moved=result.value.project.boards[1].nodes.find(n=>n.id===original.id);assert.equal(moved.x,original.x+400);assert.equal(moved.y,original.y+500)}
 assert.deepEqual(result.value.project.boards[1].connectors[0].bendPoints,[{x:510,y:630}]);assert.deepEqual(result.value.project.boards[1].connectors[1].targetPoint,{x:760,y:920});assert.deepEqual(result.value.project.boards[1].connectors[0].labelPosition,before.boards[0].connectors[0].labelPosition)
})
check('Readonly, same board, missing IDs and nonfinite coordinates refuse without mutation',()=>{
 for(const [source,dest,ids,opts]of[['source','destination',['image'],{readOnly:true}],['source','source',['image'],{}],['source','destination',['missing'],{}],['source','destination',[],{}],['source','destination',['frame'],{position:{x:Infinity,y:1}}]]){const p=fixture(),snapshot=JSON.stringify(p);assert(!transferBoardSelection(p,source,dest,ids,opts).ok);assert.equal(JSON.stringify(p),snapshot)}
})
check('Locked or hidden descendants and ancestors cancel whole command',()=>{
 for(const [index,key]of[[0,'locked'],[1,'locked'],[0,'hidden'],[2,'hidden'],[0,'collapsed']]){const p=fixture();p.boards[0].nodes[index][key]=true;const snapshot=JSON.stringify(p);assert(!transferBoardSelection(p,'source','destination',['frame']).ok);assert.equal(JSON.stringify(p),snapshot)}
})
check('Own portal self/descendant destination cycles refuse atomically',()=>{
 for(const target of ['child','grandchild']){const p=fixture(),snapshot=JSON.stringify(p);assert(!transferBoardSelection(p,'source',target,['frame']).ok);assert.equal(JSON.stringify(p),snapshot)}
})
check('Shortcut move preserves target ownership',()=>{
 const p=fixture();p.boards[0].nodes[3].boardLinkRole='shortcut';delete p.boards[0].nodes[3].boardPortal
 const result=transferBoardSelection(p,'source','destination',['portal']);assert(result.ok);assert.equal(result.value.project.boards[2].parentBoardId,'source')
})
check('Destination node/connector collisions never overwrite',()=>{
 for(const kind of ['node','edge']){const p=fixture();if(kind==='node')p.boards[1].nodes.push(node('image','shape'));else p.boards[1].connectors.push(edge('internal',{sourcePoint:{x:0,y:0},targetPoint:{x:1,y:1}}));const snapshot=JSON.stringify(p);assert(!transferBoardSelection(p,'source','destination',['frame']).ok);assert.equal(JSON.stringify(p),snapshot)}
})
check('Boundary connection locked outsider cancels the move',()=>{
 const p=fixture();p.boards[0].nodes[4].locked=true;const snapshot=JSON.stringify(p);assert(!transferBoardSelection(p,'source','destination',['note']).ok);assert.equal(JSON.stringify(p),snapshot)
})
check('Whole mind-map transfer expands semantic branch; partial branch refused',()=>{
 const p=fixture(),tree=createMindMapTemplate('transfer-tree',{x:0,y:0});assert(tree.ok)
 p.boards[0].nodes.push(...tree.value.nodes);p.boards[0].connectors.push(...tree.value.connectors)
 const root=tree.value.nodes.find(n=>!n.mindMap.parentId),leaf=tree.value.nodes.find(n=>n.mindMap.parentId)
 assert(!transferBoardSelection(p,'source','destination',[leaf.id]).ok)
 const result=transferBoardSelection(p,'source','destination',[root.id,leaf.id]);assert(result.ok);assert.equal(result.value.movedIds.length,tree.value.nodes.length);assert.equal(result.value.transportedConnectorIds.length,tree.value.connectors.length)
})
check('Nested search returns exact placement identity and full ancestor path',()=>{
 const p=fixture(),before=JSON.stringify(p),result=searchProject(p,'Named note');assert.equal(result.length,1);assert.equal(result[0].id,'grandchild');assert.equal(result[0].nodeId,'deep-note');assert.equal(result[0].context,'Research / Chapter / Detail · note');assert.equal(JSON.stringify(p),before)
})
check('Existing asset aliases/tags find board placements without new metadata',()=>{
 const p=fixture(),results=searchProject(p,'astronomy');assert(results.some(r=>r.kind==='board'&&r.nodeId==='image'));assert(results.some(r=>r.kind==='board'&&r.nodeId==='deep-image'));assert(results.some(r=>r.kind==='assets'));assert.equal(searchProject(p,'').length,0);assert.equal(searchProject(p,'e',2).length,2)
})
check('Own hide/show is reversible; inherited hidden/locked remains protected',()=>{
 const board=fixture().boards[0],hidden={...board,nodes:board.nodes.map(n=>n.id==='image'?{...n,hidden:true}:n)};assert(validateBoardMutation(board,hidden).ok)
 const shown={...hidden,nodes:hidden.nodes.map(n=>n.id==='image'?{...n,hidden:false}:n)};assert(validateBoardMutation(hidden,shown).ok)
 const inherited={...hidden,nodes:hidden.nodes.map(n=>n.id==='frame'?{...n,hidden:true}:n)};assert(!validateBoardMutation(inherited,{...inherited,nodes:inherited.nodes.map(n=>n.id==='image'?{...n,hidden:false}:n)}).ok)
 const locked={...hidden,nodes:hidden.nodes.map(n=>n.id==='frame'?{...n,locked:true}:n)};assert(!validateBoardMutation(locked,{...locked,nodes:locked.nodes.map(n=>n.id==='image'?{...n,hidden:false}:n)}).ok)
})
check('Invalid future mind-map cycles cannot publish through safety boundary',()=>{
 const before=fixture().boards[1],after={...before,nodes:[node('a','text',{mindMap:{version:1,treeId:'t',parentId:'b',order:0}}),node('b','text',{mindMap:{version:1,treeId:'t',parentId:'a',order:0}})]};assert(!validateBoardMutation(before,after).ok)
})
const report={passed:true,generatedAt:new Date().toISOString(),checks,sourceHashes:{},limitation:'Production pure model commands and search; actual native disk/process/GPU accessibility remain separate acceptance gates.'}
for(const file of ['src/board/boardTransfer.ts','src/search/projectSearchModel.ts','src/board/boardMutationSafety.ts','src/model/project.ts'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex')
const out=resolve('output/partii-organization-resume');await mkdir(out,{recursive:true});await writeFile(resolve(out,'model-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks:checks.length,report:resolve(out,'model-report.json')}))
