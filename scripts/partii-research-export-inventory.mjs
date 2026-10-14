import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
const stamp = new Date().toISOString().replace(/[:.]/g,'-')
const artifactRoot = resolve('output/partii-research-export-inventory', stamp)
await mkdir(artifactRoot, {recursive:true})
const cache = new Map()
async function moduleUrl(file) {
  file = resolve(file); if(cache.has(file)) return cache.get(file)
  let code = ts.transpileModule(await readFile(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  for(const match of [...code.matchAll(/from ['"](.+?)['"]/g)]) {
    if(!match[1].startsWith('.')) continue
    code = code.replace(match[0], "from '"+await moduleUrl(resolve(dirname(file),match[1]+'.ts'))+"'")
  }
  const url = 'data:text/javascript;base64,'+Buffer.from(code).toString('base64'); cache.set(file,url); return url
}
const tracked = ['src/board/researchExport.ts','src/board/diagramStructureCore.ts','src/board/columns.ts','src/board/boardHierarchy.ts','src/model/project.ts']
const fingerprints = async()=>Object.fromEntries(await Promise.all(tracked.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])))
const beforeHashes = await fingerprints()
const {prepareResearchExport,researchExportMediaPreflight}=await import(await moduleUrl('src/board/researchExport.ts'))
const {createMindMapTemplate}=await import(await moduleUrl('src/board/diagramStructureCore.ts'))
const item=(id,kind,extra={})=>({id,kind,title:id,x:20,y:30,width:150,height:120,...extra})
const edge=(id,extra={})=>({id,sourcePort:'right',targetPort:'left',style:'elbow',color:'#ec7424',width:2,startArrow:true,endArrow:true,dashed:false,animated:false,label:id,...extra})
const asset=(id,kind='image',status='available')=>({id,kind,status,relativePath:'originals/'+id+'.bin',originalName:id+'.bin',displayName:id,extension:'bin',byteLength:12,aliases:[],tags:[],virtualFolder:'unchanged',importedAt:'2026-09-30',deduplicated:false})
const fixture=()=>({id:'research-export-disposable',assets:[asset('photo'),asset('video','video'),asset('model','model'),asset('document','document')],boards:[
  {id:'root',title:'Research <one>',viewport:{x:14,y:29,scale:.75},linkedFolderPath:'original/root/folder',nodes:[
    item('column-a','column',{title:'Column A',width:280,height:900}),
    item('column-b','column',{title:'Column B',x:340,width:280,height:900}),
    ...[
      item('note','note',{body:'<p>Opening research &amp; scope</p>'}),
      item('photo','image',{assetId:'photo',imageTransform:{fit:'cover',zoom:1.5}}),
      item('missing-image','image',{assetId:'missing-asset',title:'Missing named photo'}),
      item('rich-text','text',{body:'<h2>Title</h2><p>Rich text <a href="https://example.org/reference">reference</a></p>'}),
      item('captured-clip','clip',{captured:{kind:'article',sourceUrl:'https://example.org/article',sourceLabel:'Reference',author:'Author',publishedAt:'2026-09-30',capturedAt:'2026-09-30',articleHtml:'<p>Full article kept in source</p>',commentsHtml:'',transcriptHtml:''}}),
      item('video','video',{assetId:'video'}),
      item('model','model',{assetId:'model'}),
      item('document','document',{assetId:'document'}),
      item('shape','shape',{shapeType:'ellipse'}),
      item('child-portal','board-link',{targetBoardId:'child',boardLinkRole:'child',boardPortal:true}),
      item('shortcut-loop','board-link',{targetBoardId:'root',boardLinkRole:'shortcut'}),
      item('shortcut-missing','board-link',{targetBoardId:'gone',boardLinkRole:'shortcut'}),
      item('task-note','note',{body:'<p>[ ] Review framing</p><p>[x] Preserve originals</p>'}),
      item('embedded-image','image',{body:'data:image/png;base64,iVBORw0KGgo='}),
    ].map((node,index)=>({...node,parentColumnId:index%2?'column-b':'column-a',columnOrder:10-Math.floor(index/2),y:60+index*20})),
    item('free-note','note',{title:'Free form outside columns',body:'A'.repeat(240),x:900}),
  ],connectors:[edge('column-relationship',{sourceId:'note',targetId:'photo',bendPoints:[{x:400,y:240}],label:'approved'}),edge('detached-route',{sourcePoint:{x:20,y:900},targetPoint:{x:500,y:900}})]},
  {id:'child',title:'Child board',parentBoardId:'root',linkedFolderPath:'external/child/must-stay',viewport:{x:3,y:4,scale:1},nodes:[
    item('child-note','note',{body:'Nested research body'}),
    item('grandchild-portal','board-link',{targetBoardId:'grandchild',boardLinkRole:'child',boardPortal:true}),
    item('back-shortcut','board-link',{targetBoardId:'root',boardLinkRole:'shortcut'}),
  ],connectors:[]},
  {id:'grandchild',title:'Third level',parentBoardId:'child',viewport:{x:7,y:8,scale:1},nodes:[
    item('deep-photo','image',{assetId:'photo'}),item('deep-note','note',{body:'Three level evidence'}),
  ],connectors:[]},
  {id:'unrelated',title:'Unrelated shortcut target',viewport:{x:0,y:0,scale:1},nodes:[item('not-exported','note',{body:'Must not traverse references'})],connectors:[]},
]})
const checks=[]
function check(name,run){run();checks.push({name,pass:true})}
function value(project=fixture(),scope='owned-subtree',root='root'){
 const result=prepareResearchExport(project,root,scope); assert(result.ok,JSON.stringify(result));return result.value
}
const deepFreeze=(object)=>{if(object&&typeof object==='object'){Object.freeze(object);for(const entry of Object.values(object))deepFreeze(entry)}return object}
const sourceFixture=fixture(),sourceBytes=JSON.stringify(sourceFixture)
const mixed=value(sourceFixture)
await writeFile(resolve(artifactRoot,'mixed-fixture.json'),JSON.stringify(sourceFixture,null,2),{flag:'wx'})
await writeFile(resolve(artifactRoot,'mixed-inventory.json'),JSON.stringify(mixed,null,2),{flag:'wx'})
check('Twenty mixed research items, two columns and three owned levels are inventoried once',()=>{
 assert.deepEqual(mixed.boardIds,['root','child','grandchild']);assert.equal(mixed.boards.flatMap(b=>b.items).filter(n=>n.kind!=='column').length,20)
 assert.equal(mixed.boards.flatMap(b=>b.items).filter(n=>n.kind==='column').length,2)
 assert.deepEqual(mixed.boards[2].path.map(p=>p.title),['Research <one>','Child board','Third level'])
 assert(!mixed.boardIds.includes('unrelated'));assert.equal(new Set(mixed.boardIds).size,3)
})
check('Column rows follow actual columnOrder/y without rewriting source order or layers',()=>{
 const root=mixed.boards[0], ids=root.items.map(n=>n.nodeId)
 const expected=sourceFixture.boards[0].nodes.filter(n=>n.parentColumnId==='column-a').sort((a,b)=>a.columnOrder-b.columnOrder||a.y-b.y).map(n=>n.id)
 assert.deepEqual(root.items.filter(n=>n.containerPath[0]?.id==='column-a').map(n=>n.nodeId),expected)
 assert(ids.indexOf('column-a')<ids.indexOf(expected[0]));assert(root.items.filter(n=>n.parentColumnId===undefined).length>0)
 assert.equal(JSON.stringify(sourceFixture),sourceBytes)
})
check('Current board scope never follows owning portals or shortcut cycles',()=>{
 const one=value(fixture(),'board');assert.deepEqual(one.boardIds,['root'])
 assert(one.warnings.some(w=>w.code==='shortcut-reference-only'&&w.nodeId==='shortcut-loop'))
 assert(!one.boards.flatMap(b=>b.items).some(n=>n.nodeId==='child-note'||n.nodeId==='deep-note'))
})
check('Missing shortcut target and missing asset are explicit named warnings without invented records',()=>{
 const image=mixed.assetReferences.find(r=>r.nodeId==='missing-image')
 assert.equal(image.source,'unresolved');assert(!image.record)
 assert(mixed.warnings.some(w=>w.code==='missing-asset-record'&&w.assetId==='missing-asset'&&w.detail.includes('Missing named photo')))
 assert(mixed.warnings.some(w=>w.code==='missing-board-reference'&&w.nodeId==='shortcut-missing'))
})
check('Visual format and source inclusion contract stays honest for unsupported content',()=>{
 assert.deepEqual(mixed.support.visualBoardFormats,['png','jpeg']);assert.equal(mixed.support.visualScope,'current-board')
 assert.equal(mixed.support.orderedText,'format-decision-pending');assert.equal(mixed.support.ownedSubtreeArtifact,'format-decision-pending')
 assert.equal(mixed.support.originalAssetsIncluded,false)
 for(const id of ['captured-clip','video','model','document'])assert(mixed.warnings.some(w=>w.code==='visual-summary-only'&&w.nodeId===id))
 assert(mixed.warnings.some(w=>w.code==='visual-text-summary'&&w.nodeId==='free-note'))
 assert(mixed.warnings.some(w=>w.code==='visual-link-reference'&&w.nodeId==='rich-text'))
 assert(mixed.warnings.some(w=>w.code==='subtree-format-pending'))
})
check('Catalog availability is metadata; preflight requires actual host resolution',()=>{
 const result=researchExportMediaPreflight(mixed,[]);assert(result.ok);assert(result.value.hasBlockingMissing)
 assert(result.value.unresolvedKeys.includes('root:photo:content'))
 assert(result.value.unresolvedKeys.includes('root:embedded-image:content'))
 assert(!result.value.unresolvedKeys.includes('root:video:content'))
})
check('Resolved and missing media remain keyed to exact visible placement; omitted previews are explicit',()=>{
 const resolutions=mixed.assetReferences.filter(r=>r.requiresPreview).map(r=>({key:r.key,status:r.nodeId==='missing-image'?'missing':r.nodeId==='embedded-image'?'omitted':'resolved'}))
 const result=researchExportMediaPreflight(mixed,resolutions);assert(result.ok)
 assert.deepEqual(result.value.missingKeys,['root:missing-image:content']);assert.deepEqual(result.value.omittedKeys,['root:embedded-image:content'])
 assert(result.value.resolvedKeys.includes('grandchild:deep-photo:content'));assert(result.value.hasBlockingMissing);assert.equal(result.value.unresolvedKeys.length,0)
 assert(result.value.warnings.some(w=>w.code==='preview-omitted'&&w.nodeId==='embedded-image'))
})
check('Foreign, duplicate and invalid resolver answers refuse without changing source inventory',()=>{
 const snapshot=JSON.stringify(mixed)
 for(const answers of [[{key:'foreign',status:'resolved'}],[{key:'root:photo:content',status:'resolved'},{key:'root:photo:content',status:'missing'}],[{key:'root:photo:content',status:'unknown'}]])assert(!researchExportMediaPreflight(mixed,answers).ok)
 assert.equal(JSON.stringify(mixed),snapshot)
})
check('Hidden image and collapsed column descendants never leak media/body/connection content',()=>{
 const p=fixture();p.boards[0].nodes.find(n=>n.id==='column-a').collapsed=true;p.boards[0].nodes.find(n=>n.id==='photo').hidden=true
 const result=value(p),ids=result.boards[0].items.map(n=>n.nodeId)
 assert(ids.includes('column-a'));assert(!ids.includes('note'));assert(!ids.includes('photo'));assert(!ids.includes('missing-image'))
 assert(!result.assetReferences.some(r=>r.nodeId==='photo'||r.nodeId==='missing-image'))
 assert(!result.boards[0].connectors.some(e=>e.id==='column-relationship'))
 assert(result.boards[0].connectors.some(e=>e.id==='detached-route'))
 assert(result.warnings.some(w=>w.code==='visible-content-only'));assert(!JSON.stringify(result).includes('Opening research'))
})
check('Hidden owning portal excludes its complete board branch with an explicit count',()=>{
 const p=fixture();p.boards[0].nodes.find(n=>n.id==='child-portal').hidden=true
 const result=value(p);assert.deepEqual(result.boardIds,['root']);assert.deepEqual(result.skippedBoardIds,['child','grandchild'])
 assert(result.warnings.some(w=>w.code==='hidden-board-branch'));assert(!JSON.stringify(result).includes('Three level evidence'))
 assert(!result.assetReferences.some(r=>r.boardId==='grandchild'))
})
check('Missing owning portal follows canonical parent ownership without recreating a tile',()=>{
 const p=fixture();p.boards[0].nodes=p.boards[0].nodes.filter(n=>n.id!=='child-portal')
 const result=value(p);assert.deepEqual(result.boardIds,['root','child','grandchild']);assert(result.warnings.some(w=>w.code==='owning-portal-absent'))
 assert(!p.boards[0].nodes.some(n=>n.id==='child-portal'))
})
check('Board cycles, duplicate identity, missing parent and invalid root/scope refuse',()=>{
 const cases=[]
 let p=fixture();p.boards[0].parentBoardId='grandchild';cases.push(p)
 p=fixture();p.boards[1].parentBoardId='missing';cases.push(p)
 p=fixture();p.boards.push(structuredClone(p.boards[0]));cases.push(p)
 for(const input of cases){const snapshot=JSON.stringify(input);assert(!prepareResearchExport(input,'root','owned-subtree').ok);assert.equal(JSON.stringify(input),snapshot)}
 assert(!prepareResearchExport(fixture(),'missing','board').ok);assert(!prepareResearchExport(fixture(),'root','unsupported').ok)
})
check('Wrong and duplicated owning portals refuse; shortcut cycles remain valid references',()=>{
 for(const mode of ['wrong','duplicate']){
  const p=fixture();const portal=p.boards[0].nodes.find(n=>n.id==='child-portal')
  if(mode==='wrong')portal.targetBoardId='root';else p.boards[0].nodes.push({...portal,id:'second-owning-portal'})
  const snapshot=JSON.stringify(p);assert(!prepareResearchExport(p,'root','owned-subtree').ok);assert.equal(JSON.stringify(p),snapshot)
 }
 assert(value().warnings.filter(w=>w.code==='shortcut-reference-only').length>=2)
})
check('Ambiguous ownership, hidden invalid graphs and bad finite geometry refuse atomically',()=>{
 for(const mutation of [p=>{p.boards[0].nodes.find(n=>n.id==='note').groupId='column-b'},p=>{const n=p.boards[0].nodes.find(n=>n.id==='note');n.hidden=true;n.parentColumnId='missing'},p=>{p.boards[0].nodes.find(n=>n.id==='note').columnOrder=NaN},p=>{p.boards[0].nodes.find(n=>n.id==='note').width=0},p=>{p.boards[0].nodes.find(n=>n.id==='column-a').groupId='column-b';p.boards[0].nodes.find(n=>n.id==='column-b').groupId='column-a'}]){
  const p=fixture();mutation(p);assert(!prepareResearchExport(p,'root','owned-subtree').ok)
 }
})
check('Missing connector identities/endpoints/anchors/nonfinite routes are never silently dropped',()=>{
 for(const mutation of [p=>{p.boards[0].connectors.push({...p.boards[0].connectors[0]})},p=>{p.boards[0].connectors[0].sourceId='gone'},p=>{delete p.boards[0].connectors[1].sourcePoint},p=>{p.boards[0].connectors[0].bendPoints=[{x:NaN,y:0}]}]){
  const p=fixture();mutation(p);assert(!prepareResearchExport(p,'root','owned-subtree').ok)
 }
})
check('Mind-map collapsed descendants and edges follow the canonical projection; invalid tree edge refuses',()=>{
 const p=fixture(), tree=createMindMapTemplate('export-map');assert(tree.ok)
 tree.value.nodes.find(n=>n.mindMap?.parentId===tree.value.nodes[0].id).mindMap.collapsed=true
 p.boards[0].nodes.push(...tree.value.nodes);p.boards[0].connectors.push(...tree.value.connectors)
 const result=value(p),visibleIds=new Set(result.boards[0].items.map(n=>n.nodeId))
 for(const edge of result.boards[0].connectors)assert((!edge.sourceId||visibleIds.has(edge.sourceId))&&(!edge.targetId||visibleIds.has(edge.targetId)))
 assert(result.boards[0].excludedNodeIds.length>0)
 p.boards[0].connectors=p.boards[0].connectors.filter(e=>e.id!==tree.value.connectors[0].id)
 assert(!prepareResearchExport(p,'root','owned-subtree').ok)
})
check('Locked visible objects export without unlock and cloned inventory cannot mutate originals',()=>{
 const p=deepFreeze(fixture()),snapshot=JSON.stringify(p),result=value(p)
 result.boards[0].items[0].node.title='Changed inventory copy'
 result.assetReferences.find(r=>r.record).record.relativePath='not/the/original'
 assert.equal(JSON.stringify(p),snapshot)
 const p2=fixture();p2.boards[0].nodes.find(n=>n.id==='column-a').locked=true
 assert(value(p2).boards[0].items.some(n=>n.nodeId==='note'))
})
check('Asset missing/moved statuses and absent paths are disclosed without changing source records',()=>{
 const p=fixture();p.assets[0].status='missing';delete p.assets[0].relativePath
 const result=value(p);assert(result.warnings.some(w=>w.code==='catalog-source-unavailable'));assert(result.warnings.some(w=>w.code==='missing-asset-path'))
 assert(!p.assets[0].relativePath)
 p.assets[0].status='moved';assert(value(p).warnings.some(w=>w.code==='catalog-source-unavailable'&&w.detail.includes('moved')))
 p.assets.push({...p.assets[0]});assert(!prepareResearchExport(p,'root','board').ok)
})
check('Deep ownership chain is iterative and each owned board is visited once',()=>{
 const p={id:'deep',assets:[],boards:Array.from({length:200},(_,index)=>({id:'b'+index,title:'Board '+index,...(index?{parentBoardId:'b'+(index-1)}:{}),viewport:{x:0,y:0,scale:1},nodes:[],connectors:[]}))}
 const result=value(p,'owned-subtree','b0');assert.equal(result.boardIds.length,200);assert.equal(result.boards[199].path.length,200)
 assert.equal(new Set(result.boardIds).size,200)
})
const originals = resolve(artifactRoot,'disposable-originals')
await mkdir(originals,{recursive:true})
const files = ['photo.dat','video.dat','model.dat','document.dat']
for(const file of files)await writeFile(resolve(originals,file),'Original bytes '+file+' :: research-export-fixture',{flag:'wx'})
const diskHashes = async()=>Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(resolve(originals,file))).digest('hex')])))
const beforeDisk=await diskHashes()
check('Fixture source asset paths and bytes remain unchanged across repeated preparation/preflight',()=>{
 const p=fixture(),before=JSON.stringify(p)
 for(let index=0;index<3;index++){const inventory=value(p);researchExportMediaPreflight(inventory,inventory.assetReferences.filter(r=>r.requiresPreview).map(r=>({key:r.key,status:'resolved'})))}
 assert.equal(JSON.stringify(p),before)
})
assert.deepEqual(await diskHashes(),beforeDisk)
const afterHashes=await fingerprints();assert.deepEqual(afterHashes,beforeHashes)
const report={timestamp:new Date().toISOString(),passed:checks.length,failed:0,checks,sourceHashes:beforeHashes,sourceStable:true,sourceAssetHashes:beforeDisk,sourceAssetStable:true,artifactRoot,scope:'Production pure inventory and preflight; no exported artifact/new format, GUI/native export or original-media packaging claimed',remaining:['Inspect current supported PNG/JPEG mixed-board output through integrated exporter','Native export/source hash/restart verification on final named executable','Combined subtree and ordered-text artifact format product decision pending']}
await writeFile(resolve(artifactRoot,'report.json'),JSON.stringify(report,null,2),{flag:'wx'})
console.log(JSON.stringify({passed:checks.length,failed:0,artifactRoot,sourceStable:true,sourceAssetStable:true}))
