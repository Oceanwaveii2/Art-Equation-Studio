import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
registerHooks({resolve(s,c,next){try{return next(s,c)}catch(e){if(s.startsWith('.'))return next(s+'.ts',c);throw e}}})
const {solveLayoutSnap}=await import('../src/board/layoutSnap.ts')
const {GraphColumnRuntime,createGraphColumnItem,bindGraphColumnInputs,editGraphColumn,projectGraphColumns,migrateLegacyGraphColumns}=await import('../src/board/graphColumnV2.ts')
const {createArtEquationCanvasScene}=await import('../src/board/artEquationCanvasAdapter.ts')
const {containerPaintOrder}=await import('../src/board/diagramStructureCore.ts')
const {planTightImageBounds}=await import('../src/model/naturalImageBounds.ts')
const {createManualGuide,moveLayoutGuide,reconcileLayoutGuides}=await import('../src/board/layoutResearch.ts')
const {duplicateBoardSubtree}=await import('../src/board/boardTransactions.ts')
const {transferBoardSelection}=await import('../src/board/boardTransfer.ts')
const {connectorGeometry}=await import('../src/board/connectors.ts')
const {graphColumnSvg}=await import('../src/board/graphColumnSvg.ts')
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name)}
const node=(id,x,y,width=100,height=100)=>({id,kind:'image',title:id,x,y,width,height})
const options={zoom:1,gridEnabled:false,objectEnabled:true,guideEnabled:true,gridSize:24}
check('object snap works independently with grid disabled',()=>{assert.equal(solveLayoutSnap({x:104,y:201,width:100,height:100},[node('other',100,0)],options).x,100)})
check('CSS pixel acquire zone is invariant over zoom and DPR',()=>{for(const zoom of [.1,.25,.5,1,2,4]){const o={...options,zoom,objectEnabled:false,guides:[{id:'manual',axis:'x',position:100}]};const x=100+5/zoom;assert.equal(solveLayoutSnap({x,y:1000,width:30,height:30},[],o).x,100);const outside=100+7/zoom;assert.equal(solveLayoutSnap({x:outside,y:1000,width:30,height:30},[],o).x,outside)}})
check('fractional position remains exact outside snap zone',()=>{const r={x:23.125,y:38.875,width:52.4,height:63.6};assert.deepEqual(solveLayoutSnap(r,[],options),{...r,guides:[]})})
check('explicit guide wins equal-distance ties and only winner is displayed',()=>{const r=solveLayoutSnap({x:104,y:400,width:20,height:20},[node('other',100,0)],{...options,guides:[{id:'manual',axis:'x',position:100}]});assert.equal(r.x,100);assert.equal(r.guides.filter(g=>g.axis==='x').length,1);assert.equal(r.guides[0].kind,'guide')})
check('locked decorative black backgrounds do not attract snapping',()=>{assert.equal(solveLayoutSnap({x:104,y:200,width:30,height:30},[{...node('black',100,0),locked:true,layoutBackground:true}],options).x,104)})
check('entire moving family is excluded from candidate geometry',()=>{assert.equal(solveLayoutSnap({x:104,y:200,width:30,height:30},[node('child',100,0)],{...options,ignoredIds:['child']}).x,104)})
check('equal gap places third object without altering sizes',()=>{const r=solveLayoutSnap({x:243,y:0,width:100,height:100},[node('a',0,0),node('b',120,0)],options);assert.equal(r.x,240);assert(r.guides.some(g=>g.kind==='gap'));assert.equal(r.width,100)})
check('tight image bounds follow source ratio without cropping or distortion',()=>{const n={...node('art',20,30,800,800),imagePresentation:'artwork',imageTransform:{fit:'contain'}};const r=planTightImageBounds(n,{width:1600,height:900});assert(r.ok);assert.equal(r.bounds.width/r.bounds.height,1600/900);assert.equal(r.bounds.height,450);assert.equal(r.bounds.y,205)})
check('east resize snaps only the moving edge and keeps opposite anchor exact',()=>{const r=solveLayoutSnap({x:10.25,y:20.5,width:186,height:80},[],{...options,objectEnabled:false,guides:[{id:'edge',axis:'x',position:200}],resizeHandle:'e'});assert.equal(r.x,10.25);assert.equal(r.width,189.75);assert.equal(r.y,20.5);assert.equal(r.height,80)})
check('west resize keeps the opposite edge and minimum size rejects a snap',()=>{const r=solveLayoutSnap({x:14,y:20,width:86,height:80},[],{...options,guides:[{id:'edge',axis:'x',position:10}],resizeHandle:'w'});assert.equal(r.x,10);assert.equal(r.x+r.width,100);const rejected=solveLayoutSnap({x:90,y:20,width:10,height:80},[],{...options,guides:[{id:'edge',axis:'x',position:95}],resizeHandle:'w',minWidth:8});assert.equal(rejected.x,90);assert.equal(rejected.width,10)})
const source={...node('source',0,0),kind:'text',body:'<p>Original authored prose</p>'}
const graph=createGraphColumnItem('graph',{x:100,y:100},['source'])
const board={id:'b',nodes:[source,graph],connectors:[],viewport:{x:0,y:0,scale:1}}
check('new graph item reads original structured data without changing its source',()=>{const snapshot=JSON.stringify(board);const r=new GraphColumnRuntime().evaluate(board,'graph');assert.equal(r.type,'records');assert.equal(r.value[0].html,source.body);assert.equal(JSON.stringify(board),snapshot)})
check('pan, zoom and object movement do not invalidate computation',()=>{const runtime=new GraphColumnRuntime();runtime.evaluate(board,'graph');runtime.evaluate({...board,viewport:{x:500,y:200,scale:.2},nodes:[{...source,x:300},graph]},'graph');assert.equal(runtime.evaluations,1)})
check('changed text invalidates only its dependent computation',()=>{const runtime=new GraphColumnRuntime();runtime.evaluate(board,'graph');runtime.evaluate({...board,nodes:[{...source,body:'<p>Edited</p>'},graph]},'graph');assert.equal(runtime.evaluations,2)})
check('collect output connects to a count node through typed record data',()=>{const count={...createGraphColumnItem('count',{x:0,y:0},['graph']),graphColumn:{version:2,operation:'count',inputs:[{id:'records',sourceId:'graph'}]}};assert.deepEqual(new GraphColumnRuntime().evaluate({...board,nodes:[...board.nodes,count]},'count'),{type:'number',value:1})})
check('incompatible typed values are rejected',()=>{const count={...graph,id:'count',graphColumn:{version:2,operation:'count',inputs:[{id:'input',sourceId:'source'}]}};const collector=createGraphColumnItem('collector',{x:0,y:0},['count']);assert.throws(()=>new GraphColumnRuntime().evaluate({...board,nodes:[source,count,collector]},'collector'),/incompatible/)})
check('missing references and cycles reject instead of silently dropping data',()=>{assert.throws(()=>new GraphColumnRuntime().evaluate({...board,nodes:[graph]},'graph'),/Missing/);assert.throws(()=>bindGraphColumnInputs(board,'graph',['graph']),/itself/);const cycle={...graph,graphColumn:{...graph.graphColumn,inputs:[{id:'self',sourceId:'graph'}]}};assert.throws(()=>new GraphColumnRuntime().evaluate({...board,nodes:[cycle]},'graph'),/cycle/)})
check('graph metadata and stable input IDs survive save roundtrip',()=>{assert.deepEqual(JSON.parse(JSON.stringify(graph)),graph);const rebound=bindGraphColumnInputs(board,'graph',['source']);assert.equal(rebound.nodes[1].graphColumn.inputs[0].id,graph.graphColumn.inputs[0].id)})
check('computed values are immutable and deep graph cache keys do not grow exponentially',()=>{const nodes=[source];let parent='source';for(let i=0;i<60;i++){const g=createGraphColumnItem('g'+i,{x:0,y:0},[parent]);nodes.push(g);parent=g.id}const runtime=new GraphColumnRuntime();const value=runtime.evaluate({nodes},parent);assert.equal(runtime.evaluations,60);assert.throws(()=>value.value.push({}));runtime.evaluate({nodes},parent);assert.equal(runtime.evaluations,60)})
check('graph ports and edge paths are disposable world-space projections',()=>{const p=projectGraphColumns(board);assert.equal(p.ports.length,2);assert.equal(p.connections.length,1);assert.equal(p.connections[0].targetId,'graph');assert.equal(p.ports[0].width,8);assert.equal(projectGraphColumns({...board,viewport:{scale:.1,x:0,y:0}}).ports[0].width,8);assert(!board.nodes.some(n=>n.id===p.ports[0].id))})
check('legacy migration preserves every asset and original prose on a new board only',()=>{const legacy={...graph,id:'old',kind:'column',graphColumn:undefined,columnMode:'node'};const child={...source,parentColumnId:'old',assetId:'same-file'};const ordinary={...legacy,id:'ordinary',columnMode:undefined};const b={...board,nodes:[legacy,child,ordinary]};const saved=JSON.stringify(b);assert.throws(()=>migrateLegacyGraphColumns(b,b.id),/distinct/);const migrated=migrateLegacyGraphColumns(b,'copy');assert.equal(JSON.stringify(b),saved);assert.equal(migrated.nodes[0].kind,'group');assert.equal(migrated.nodes[1].groupId,'old');assert.equal(migrated.nodes[1].parentColumnId,undefined);assert.equal(migrated.nodes[1].body,child.body);assert.equal(migrated.nodes[1].assetId,'same-file');assert.equal(migrated.nodes[2].kind,'column');assert.equal(new GraphColumnRuntime().evaluate(migrated,'old').value[0].html,child.body)})
check('independent ruler guides preserve fractional positions without moving content',()=>{const guide=createManualGuide('x',122.125),b={...board,layoutGuides:[guide]};const next=moveLayoutGuide(b,guide.id,133.375);assert.equal(next.layoutGuides[0].position,133.375);assert.deepEqual(next.nodes,b.nodes);assert.equal(reconcileLayoutGuides(b,next).layoutGuides.length,1);assert.throws(()=>createManualGuide('y',NaN),/finite/)})
check('graph input editing refuses a locked graph or locked ancestor',()=>{assert.throws(()=>bindGraphColumnInputs({...board,nodes:[source,{...graph,locked:true}]},'graph',['source']),/Unlock/);const parent={...graph,id:'parent',graphColumn:undefined,locked:true};assert.throws(()=>bindGraphColumnInputs({...board,nodes:[source,parent,{...graph,groupId:'parent'}]},'graph',['source']),/Unlock/)})
check('whole-board duplication remaps data references to copied source identities',()=>{const project={id:'project',boards:[{...board,title:'Source'}],assets:[]};const result=duplicateBoardSubtree(project,'b');assert(result);const copy=result.project.boards.find(b=>b.id===result.boardId);assert.equal(copy.nodes.find(n=>n.graphColumn).graphColumn.inputs[0].sourceId,result.nodeIds.get('source'));assert.equal(new GraphColumnRuntime().evaluate(copy,result.nodeIds.get('graph')).value[0].html,source.body)})
check('cross-board transfer refuses a partial data graph and accepts the complete graph',()=>{const destination={...board,id:'destination',nodes:[]},project={id:'project',boards:[board,destination],assets:[]};assert.equal(transferBoardSelection(project,'b','destination',['source']).ok,false);assert.equal(transferBoardSelection(project,'b','destination',['source','graph']).ok,true)})
check('graph routes terminate at individual input rows instead of one midpoint',()=>{const second={...source,id:'second'},g={...graph,graphColumn:{...graph.graphColumn,inputs:[{id:'a',sourceId:'source'},{id:'b',sourceId:'second'}]}};const b={nodes:[source,second,g]};const p=projectGraphColumns(b);const geometry=connectorGeometry(p.connections[0],b.nodes);assert.deepEqual(geometry.target,p.connections[0].targetPoint);assert.notEqual(geometry.target.y,g.y+g.height/2);assert.notEqual(p.connections[0].targetPoint.y,p.connections[1].targetPoint.y)})
check('reconnect retains port identity; disconnect and order changes are atomic',()=>{
 const second={...source,id:'second',title:'second'},g=createGraphColumnItem('edit',{x:400,y:0},['source'])
 const b={...board,nodes:[source,second,g]};const port=g.graphColumn.inputs[0].id
 const reconnect=editGraphColumn(b,'edit',{inputs:[{id:port,sourceId:'second'}]})
 assert.equal(reconnect.nodes[2].graphColumn.inputs[0].id,port)
 assert.equal(new GraphColumnRuntime().evaluate(reconnect,'edit').value[0].objectId,'second')
 const clear=editGraphColumn(reconnect,'edit',{inputs:[]});assert.deepEqual(new GraphColumnRuntime().evaluate(clear,'edit').value,[])
 assert.equal(b.nodes[2].graphColumn.inputs[0].sourceId,'source')
})
check('changing upstream output rejects incompatible downstream without mutation',()=>{
 const a=createGraphColumnItem('a',{x:0,y:0},['source']),b=createGraphColumnItem('b',{x:400,y:0},['a']),scene={...board,nodes:[source,a,b]},before=JSON.stringify(scene)
 assert.throws(()=>editGraphColumn(scene,'a',{operation:'count'}),/incompatible/);assert.equal(JSON.stringify(scene),before)
 assert.throws(()=>editGraphColumn(scene,'a',{inputs:[{id:'1',sourceId:'source'},{id:'2',sourceId:'source'}]}),/Duplicate source/)
})
check('graph item paints above older ordinary cards while ordinary groups retain their layer',()=>{
 const g=createGraphColumnItem('last',{x:0,y:0},[]),n={...source,id:'card'},group={...g,id:'group',graphColumn:undefined}
 assert.deepEqual(containerPaintOrder([n,group,g]).value.orderedIds,['group','card','last'])
})
check('canonical graph labels, glyph descriptor and edges follow source revisions without media bytes',()=>{
 const g={...createGraphColumnItem('paint',{x:400,y:0},['source']),graphColumn:{version:2,operation:'text',inputs:[{id:'stable',sourceId:'source'}]}}
 const b={...board,id:'paint-test',nodes:[source,g]},colors={background:'#000',grid:'#fff'}
 const first=createArtEquationCanvasScene(b,[],colors),object=first.objects.find(o=>o.id==='paint')
 assert(object.structuredCard.result.includes('Original authored prose'));assert.equal(object.structuredCard.ports.length,2)
 const next=createArtEquationCanvasScene({...b,nodes:[{...source,body:'Changed prose'},g]},[],colors),changed=next.objects.find(o=>o.id==='paint')
 assert.equal(changed.structuredCard.result,'Changed prose');assert.notEqual(changed.revision,object.revision)
 assert(first.objects.some(o=>o.id==='paint:edge:stable'&&o.preparedVectorGeometry.status==='ready'))
 assert(!first.objects.some(o=>o.id==='paint:output'));assert.equal(first.connections[0].id,next.connections[0].id)
})
check('attached graph endpoint follows moved and rotated source without changing data references',()=>{
 const first=projectGraphColumns(board).connections[0],moved={...source,x:source.x+123,y:source.y+47,rotation:90}
 const next=projectGraphColumns({...board,nodes:[moved,graph]}).connections[0]
 assert.equal(next.sourceId,first.sourceId);assert.equal(next.id,first.id)
 assert.notDeepEqual(next.sourcePoint,first.sourcePoint)
 assert.deepEqual(connectorGeometry(next,[moved,graph]).source,next.sourcePoint)
 assert.equal(board.nodes[1].graphColumn.inputs[0].sourceId,'source')
})
check('graph SVG contains computed labels and ports rather than an ordinary group title',()=>{
 const g={...graph,graphColumn:{...graph.graphColumn,operation:'count'}},markup=graphColumnSvg({...board,nodes:[source,g]},g)
 assert(markup.includes('Count records'));assert(markup.includes('<circle'));assert(markup.includes('Segoe UI'));assert(!markup.includes('[object Object]'))
})

const {insertNodesIntoColumnResult,releaseNodesFromColumnsResult,columnChildren,findColumnDropTargetResult,setColumnImageSizingResult}=await import('../src/board/columns.ts')
const {moveContainerWithDescendants}=await import('../src/board/diagramStructureCore.ts')
const {writeGraphObjectAttribute}=await import('../src/board/graphObjectCommands.ts')
check('graph container accepts ordered image and text rows, preserves aspect and reference',()=>{
 const g=createGraphColumnItem('container',{x:500.125,y:100.25},[]),image={...node('photo',20,40,1600,900),imagePresentation:'artwork',assetId:'original'},text={...source,id:'prose'}
 const scene={...board,nodes:[g,image,text]},before=JSON.stringify(scene)
 const inserted=insertNodesIntoColumnResult(scene,['photo','prose'],{columnId:g.id,index:0});assert(inserted.ok,JSON.stringify(inserted));assert.equal(JSON.stringify(scene),before)
 const rows=columnChildren(inserted.value,g.id);assert.deepEqual(rows.map(n=>n.id),['photo','prose']);assert.equal(rows[0].groupId,g.id);assert.equal(rows[0].parentColumnId,undefined);assert.equal(rows[0].width/rows[0].height,1600/900);assert.equal(rows[0].assetId,'original')
 assert.deepEqual(new GraphColumnRuntime().evaluate(inserted.value,g.id).value.map(r=>r.objectId),['photo','prose'])
 const reordered=insertNodesIntoColumnResult(inserted.value,['prose'],{columnId:g.id,index:0});assert(reordered.ok);assert.deepEqual(columnChildren(reordered.value,g.id).map(n=>n.id),['prose','photo'])
 const moved=moveContainerWithDescendants(reordered.value.nodes,[],[g.id],{x:13.125,y:-5.25});assert(moved.ok);for(const n of reordered.value.nodes){const m=moved.value.nodes.find(m=>m.id===n.id);assert.equal(m.x,n.x+13.125);assert.equal(m.y,n.y-5.25)}
 const released=releaseNodesFromColumnsResult(reordered.value,['photo']);assert(released.ok);const free=released.value.nodes.find(n=>n.id==='photo');assert.equal(free.groupId,undefined);assert.equal(free.width,1600);assert.equal(free.height,900);assert.equal(new GraphColumnRuntime().evaluate(released.value,g.id).value.length,1)
 assert(findColumnDropTargetResult(scene,g.x+100,g.y+80,new Set(['photo'])).value.columnId===g.id)
 assert(setColumnImageSizingResult(inserted.value,g.id,'minimum-height').ok)
})
check('graph containment rejects locked destinations and data cycles atomically',()=>{
 const g=createGraphColumnItem('host',{x:400,y:0},[]),nested=createGraphColumnItem('nested',{x:0,y:0},['host']),scene={...board,nodes:[g,nested]}
 assert.equal(insertNodesIntoColumnResult(scene,['nested'],{columnId:'host',index:0}).ok,false)
 const locked={...scene,nodes:[{...g,locked:true},source]};assert.equal(insertNodesIntoColumnResult(locked,['source'],{columnId:'host',index:0}).ok,false)
})
check('records expose immutable dimensions, authored fonts and recorded media quality',()=>{
 const image={...source,kind:'image',assetId:'asset',body:'<span style="font-family: Segoe UI;">Authored</span>'},asset={id:'asset',status:'missing',extension:'png',byteLength:500,imageDimensions:{width:4096,height:2160}},scene={...board,nodes:[image,graph]}
 const runtime=new GraphColumnRuntime(),record=runtime.evaluate(scene,'graph',[asset]).value[0];assert.equal(record.attributes.width,image.width);assert.deepEqual(record.attributes.fonts,['Segoe UI']);assert.equal(record.media.status,'missing');assert.equal(record.media.resolution.width,4096);assert.equal(record.media.format,'png');assert.throws(()=>record.media.resolution.width=1)
 runtime.evaluate(scene,'graph',[{...asset,status:'available'}]);assert.equal(runtime.evaluations,2)
 assert.equal(new GraphColumnRuntime().evaluate(scene,'graph').value[0].media.status,'unresolved')
})
check('explicit graph write-back is atomic, validated, locked and read-only guarded',()=>{
 const saved=JSON.stringify(board),next=writeGraphObjectAttribute(board,'graph','source','title','Changed title');assert.equal(JSON.stringify(board),saved);assert.equal(next.nodes[0].title,'Changed title')
 assert.throws(()=>writeGraphObjectAttribute(board,'graph','source','opacity','2'),/Opacity/)
 assert.throws(()=>writeGraphObjectAttribute(board,'graph','source','color','bad'),/hexadecimal/)
 assert.throws(()=>writeGraphObjectAttribute({...board,nodes:[{...source,locked:true},graph]},'graph','source','title','bad'),/locked/i)
 assert.throws(()=>writeGraphObjectAttribute(board,'graph','source','title','bad',true),/Unlock/)
 assert.throws(()=>writeGraphObjectAttribute(board,'graph','graph','title','bad'),/collected/)
})


check('graph header and body colours survive canonical scene and SVG export',()=>{
 const graph={...createGraphColumnItem('colours',{x:100,y:100},[]),color:'#713a24',columnBodyColor:'#152839',textColor:'#e7dfcc'}
 const board={id:'colours-board',title:'Colours',nodes:[graph],connectors:[]}
 const scene=createArtEquationCanvasScene(board,[],{background:'#000',grid:'#fff'})
 const card=scene.objects.find(o=>o.id===graph.id).structuredCard
 assert.equal(card.fill,'#152839');assert.equal(card.headerFill,'#713a24');assert.equal(card.text,'#e7dfcc')
 const svg=graphColumnSvg(board,graph)
 for(const colour of ['#152839','#713a24','#e7dfcc'])assert.ok(svg.includes(colour))
})


check('drag projection preserves stationary paint and connection identities',()=>{
 const a={...source,id:'dragging'},b={...source,id:'stationary',x:300},edge={id:'stationary-edge',sourceId:'stationary',targetId:'dragging',color:'#fff',width:1}
 const before={id:'drag-projection',nodes:[a,b],connectors:[edge]},assets=[],colors={background:'#000',grid:'#fff'}
 const first=createArtEquationCanvasScene(before,assets,colors),next=createArtEquationCanvasScene({...before,nodes:[{...a,x:a.x+.25},b]},assets,colors)
 assert.notEqual(next.objects.find(o=>o.id===a.id),first.objects.find(o=>o.id===a.id))
 assert.equal(next.objects.find(o=>o.id===b.id),first.objects.find(o=>o.id===b.id))
 assert.equal(next.connections[0],first.connections[0])
 const edited=createArtEquationCanvasScene({...before,nodes:[a,{...b,body:'Changed actual prose'}]},assets,colors)
 assert.notEqual(edited.objects.find(o=>o.id===b.id),first.objects.find(o=>o.id===b.id))
})
check('retained node projection invalidates inherited locks visibility order and asset metadata',()=>{
 const parent={id:'projection-parent',kind:'group',title:'Parent',x:0,y:0,width:500,height:500},child={...source,id:'projection-child',groupId:parent.id,assetId:'projection-asset'},asset={id:'projection-asset',kind:'image'},assets=[asset],colors={background:'#000',grid:'#fff'}
 const before={id:'projection-states',nodes:[parent,child],connectors:[]},base=createArtEquationCanvasScene(before,assets,colors).objects.find(o=>o.id===child.id)
 const locked=createArtEquationCanvasScene({...before,nodes:[{...parent,locked:true},child]},assets,colors).objects.find(o=>o.id===child.id)
 assert.notEqual(locked,base);assert.equal(locked.locked,true)
 const hidden=createArtEquationCanvasScene({...before,nodes:[{...parent,hidden:true},child]},assets,colors).objects.find(o=>o.id===child.id)
 assert.notEqual(hidden,locked);assert.equal(hidden.hidden,true)
 const changedAsset=createArtEquationCanvasScene(before,[{...asset,status:'missing'}],colors).objects.find(o=>o.id===child.id)
 assert.notEqual(changedAsset,base);assert.notEqual(changedAsset.asset.revision,base.asset.revision)
 const ordered=createArtEquationCanvasScene({...before,nodes:[{...parent,id:'earlier',zIndex:-1},parent,child]},assets,colors).objects.find(o=>o.id===child.id)
 assert.notEqual(ordered,base);assert.notEqual(ordered.order,base.order)
})
check('graph paint identity changes when connected data changes despite unchanged graph record',()=>{
 const a={...source,id:'projection-source'},g=createGraphColumnItem('projection-graph',{x:400,y:0},[a.id]),assets=[],colors={background:'#000',grid:'#fff'},before={id:'projection-data',nodes:[a,g],connectors:[]}
 const first=createArtEquationCanvasScene(before,assets,colors).objects.find(o=>o.id===g.id)
 const next=createArtEquationCanvasScene({...before,nodes:[{...a,title:'Updated source'},g]},assets,colors).objects.find(o=>o.id===g.id)
 assert.notEqual(first,next);assert.notEqual(first.revision,next.revision)
})
console.log(JSON.stringify({checks,decision:'PASS',scope:'Actual snap geometry, ruler guides and headless graph commands. Not visual/native/4K qualification.'}))
