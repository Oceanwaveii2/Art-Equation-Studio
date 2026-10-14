import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
let captures=0,pins=0,leases=0,animated=false,failCaptures=false,pendingProviders=0,releasedWhilePending=false,retainedProviders=[],canonicalReads=0
const scalePolicies=new Map(),retiredEffects=[],missRows=[],diagnosticRows=[]
const demandSource=ts.transpileModule(await fs.readFile('src/canvas-engine/imageDemand.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*$/gm,'')
const {imageDemand}=await import('data:text/javascript;base64,'+Buffer.from(demandSource).toString('base64'))
globalThis.__retainedProviderBoundary={
 imageDemand,invoke:()=>{},createNativeTextFontResolver:()=>({dispose(){}}),createTextPaintSession:()=>{},loadVelloEngine:()=>{},
 captureSvgPaint:async(_,options,__,effect)=>effect({id:options.id+':filter'}),
 createSvgEffectProvider:()=>({prepare:async()=>({operations:[],uploads:[],visualBounds:{x:0,y:0,width:1,height:1}}),retireExcept:ids=>retiredEffects.push([...ids].sort()),dispose(){}}),
}
const providerSource=ts.transpileModule(await fs.readFile('src/project-b/p0-surface/cardProviders.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*$/gm,'')
const providerPrelude='const {imageDemand,invoke,createNativeTextFontResolver,createTextPaintSession,loadVelloEngine,captureSvgPaint,createSvgEffectProvider}=globalThis.__retainedProviderBoundary;\n'
const {createMeasuredCardProviders,retainedCardSupportsScale}=await import('data:text/javascript;base64,'+Buffer.from(providerPrelude+providerSource).toString('base64'))
const boundary={
 createModelArtworkPainter:()=>({paint:async()=>({status:'ready',completePaint:true,visualBounds:{x:0,y:0,width:10,height:10},operations:[],uploads:[]}),dispose(){}}),
 createStructuredCardPainter:()=>({paint:async()=>({status:'ready',completePaint:true,visualBounds:{x:0,y:0,width:10,height:10},operations:[],uploads:[]}),dispose(){}}),
 metricSpan:()=>()=>{},
 recordMetric:(kind,data)=>{if(kind==='paint.card-miss')missRows.push(data);diagnosticRows.push({kind,data})},
 retainedCardSupportsScale,
 withCanonicalStageCardPaint:(_,read)=>{canonicalReads++;return read()},
 DecodedImageRegistry:class {retain(){pins++;let done=false;return{release(){if(!done){done=true;pins--}}}}stage(){}present(){}discard(){}dispose(){}stats(){return{}}},
 canvasResourceBudget:{acquire(){leases++;let done=false;return{release(){if(!done){done=true;leases--}}}}},
 createMeasuredCardProviders:()=>({forCapture:(retained=new Set())=>{retainedProviders.push([...retained]);return{providers:{},scalePolicyFor:id=>scalePolicies.get(id)??{exactScale:true,images:[]},release(){if(pendingProviders)releasedWhilePending=true}}},dispose(){}}),
 captureCompleteMeasuredCardPaint:async(_,__,object)=>{captures++;if(failCaptures){if(object.id==='a')throw new Error('provider failed');pendingProviders++;await new Promise(resolve=>setTimeout(resolve,20));pendingProviders--}return{status:'ready',completePaint:true,visualBounds:{x:0,y:0,width:10,height:10},operations:[],uploads:[]}},
 assembleCompletePaintList:(scene,contributions)=>({ids:new Set(contributions.map(c=>c.id)),cardIds:new Set(contributions.map(c=>c.id)),images:[],displayList:{resources:[],operations:[]}}),
 maskCompleteRectanglePaint:(_,card)=>card,
}
globalThis.__paintRetentionBoundary=boundary
const compiled=ts.transpileModule(await fs.readFile('src/project-b/p0-surface/captureScenePaint.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const source=compiled.replace(/^import .*$/gm,'')+'\n'
const modelRetentionSource=ts.transpileModule(await fs.readFile('src/project-b/p0-surface/modelPaintRetention.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*$/gm,'')
const modelRetention=await import('data:text/javascript;base64,'+Buffer.from(modelRetentionSource).toString('base64'))
Object.assign(boundary,modelRetention)
const prelude='const {metricSpan,recordMetric,retainedCardSupportsScale,withCanonicalStageCardPaint,DecodedImageRegistry,canvasResourceBudget,createMeasuredCardProviders,createStructuredCardPainter,createModelArtworkPainter,modelPaintKey,moveModelPaint,captureCompleteMeasuredCardPaint,assembleCompletePaintList,maskCompleteRectanglePaint}=globalThis.__paintRetentionBoundary;\n'
const {createMountedScenePaint}=await import('data:text/javascript;base64,'+Buffer.from(prelude+source).toString('base64'))
const stage={querySelectorAll:()=>[{dataset:{nodeId:'a'},contains:()=>false}],ownerDocument:{defaultView:{devicePixelRatio:2}},getAnimations:()=>animated?[{playState:'running'}]:[]}
const controller=createMountedScenePaint(stage),scene={id:'s',revision:1,objects:[{id:'a',kind:'image'}]},vectors={ids:new Set(),json:'{"operations":[],"revision":1}'},view={x:0,y:0,scale:1}
const first=await controller.capture(scene,view,vectors,0,()=>true)
const pan=await controller.capture({...scene,revision:2},{...view,x:100},vectors,0,()=>true)
assert.equal(captures,1,'Same-scale pan reuses complete paint')
assert.equal(pins,1);assert.equal(leases,1)
first.release();first.release();pan.release();assert.equal(pins,1,'Cache retains an independent owner')
const changed=await controller.capture(scene,view,vectors,1,()=>true)
assert.equal(captures,2,'Layout invalidation recaptures');assert.equal(pins,1)
const zoom=await controller.capture(scene,{...view,scale:2},vectors,1,()=>true)
assert.equal(captures,3);assert.equal(pins,2,'Pending consumer keeps its previous pixels pinned')
changed.release();assert.equal(pins,1)
animated=true
const moving=await controller.capture(scene,{...view,scale:2},vectors,1,()=>true)
assert.equal(captures,4,'Running animations must refresh their paint')
assert.equal(await controller.capture(scene,view,vectors,1,()=>false),undefined)
controller.dispose();zoom.release();moving.release();assert.equal(pins,0);assert.equal(leases,0)
failCaptures=true
const failureController=createMountedScenePaint({...stage,querySelectorAll:()=>[{dataset:{nodeId:'a'}},{dataset:{nodeId:'b'}}]})
await assert.rejects(failureController.capture({...scene,objects:[...scene.objects,{id:'b',kind:'image'}]},view,vectors,0,()=>true),/provider failed/)
assert.equal(diagnosticRows.filter(row=>row.kind==='paint.capture-outcome').at(-1).data.disposition,'failed','Provider failure is distinguished from obsolete capture')
assert.equal(pendingProviders,0,'All providers settle before capture releases its transaction')
assert.equal(releasedWhilePending,false,'A rejected sibling must not release live provider resources')
failureController.dispose();assert.equal(pins,0);assert.equal(leases,0)
failCaptures=false;animated=false
const movingIds=new Set(),articles=new Map(['a','b'].map(id=>[id,{dataset:{nodeId:id},getAnimations:()=>movingIds.has(id)?[{playState:'running'}]:[]}]))
const scopedStage={...stage,querySelectorAll:()=>[...articles.values()],getAnimations:()=>[{playState:'running'}]}
const scoped=createMountedScenePaint(scopedStage),twoCards={...scene,objects:[{id:'a',kind:'image',revision:1},{id:'b',kind:'image',revision:1}]}
const dirty={globalRevision:0,objectRevisions:new Map()},held=[]
let before=captures
held.push(await scoped.capture(twoCards,view,vectors,0,()=>true,dirty))
assert.equal(captures-before,2,'Initial visible cards capture once')
const initialCanonicalReads=canonicalReads
held.push(await scoped.capture({...twoCards,revision:2},{...view,x:50},vectors,1,()=>true,dirty))
assert.equal(captures-before,2,'Unrelated stage animation and same-scale pan retain static cards')
assert.equal(canonicalReads,initialCanonicalReads,'Retained pan performs no canonical DOM skin writes')
dirty.objectRevisions.set('a',1)
held.push(await scoped.capture(twoCards,view,vectors,2,()=>true,dirty))
assert.equal(captures-before,3,'Image/source or interaction dirtiness recaptures only its card')
assert.equal(canonicalReads,initialCanonicalReads+1,'Real DOM content changes still read the canonical skin')
assert.equal(missRows.at(-1).local,1,'Diagnostics identify scoped source/interaction invalidation')
assert.deepEqual(retainedProviders.at(-1),['b'],'Partial capture preserves neighboring provider identities')
movingIds.add('a')
held.push(await scoped.capture(twoCards,view,vectors,3,()=>true,dirty))
held.push(await scoped.capture(twoCards,view,vectors,4,()=>true,dirty))
assert.equal(captures-before,5,'An animated card refreshes each frame while its static neighbor remains retained')
assert.deepEqual(retainedProviders.at(-1),['b'])
movingIds.clear();dirty.globalRevision++
held.push(await scoped.capture(twoCards,view,vectors,5,()=>true,dirty))
assert.equal(captures-before,7,'Unknown CSS, font or theme invalidation recaptures every card')
assert.equal(missRows.at(-1).global,1,'Retained neighbor identifies its global invalidation; animated card was uncached')
const editedCards={...twoCards,objects:[{...twoCards.objects[0],revision:2},twoCards.objects[1]]}
held.push(await scoped.capture(editedCards,view,vectors,5,()=>true,dirty))
assert.equal(captures-before,8,'Canonical text/content revision recaptures its card even without a DOM notification')
assert.equal(missRows.at(-1).semantic,1)
articles.set('b',{dataset:{nodeId:'b'},getAnimations:()=>[]})
held.push(await scoped.capture(editedCards,view,vectors,5,()=>true,dirty))
assert.equal(captures-before,9,'Replacing mounted DOM with the same ID rejects the old derivative')
assert.equal(missRows.at(-1).mounted,1)
held.push(await scoped.capture(twoCards,{...view,scale:2},vectors,5,()=>true,dirty))
assert.equal(captures-before,11,'Scale changes recapture both cards at the required sharp resolution')
articles.delete('a')
held.push(await scoped.capture({...twoCards,objects:[twoCards.objects[1]]},{...view,scale:2},vectors,5,()=>true,dirty))
assert.equal(captures-before,11,'Virtualization evicts the removed card and keeps the visible neighbor')
scoped.dispose();for(const paint of held)paint?.release();assert.equal(pins,0);assert.equal(leases,0,'All descriptor and image owners retire after consumers settle')
// Actual capture keys must never walk immutable geometry/source payloads on
// camera requests. The trap also detects a return to whole-object JSON keys.
const payload=Object.freeze({toJSON(){throw new Error('GEOMETRY_PAYLOAD_SERIALIZED_IN_CAPTURE_KEY')}})
const bigObject=Object.freeze({id:'large',kind:'text',revision:1,vectorPath:payload})
const bigScene={...scene,objects:[bigObject]},bigArticle={dataset:{nodeId:'large'},getAnimations:()=>[]}
const bigStage={...stage,querySelectorAll:()=>[bigArticle],ownerDocument:{defaultView:{devicePixelRatio:2}}}
scalePolicies.set('large',{exactScale:false,images:[]})
const keyController=createMountedScenePaint(bigStage),keyHeld=[];before=captures
const keyFirst=await keyController.capture(bigScene,view,vectors,0,()=>true,dirty);keyHeld.push(keyFirst)
keyHeld.push(await keyController.capture({...bigScene,revision:99,objects:[bigObject]},{...view,x:100},vectors,0,()=>true,dirty))
assert.equal(captures-before,1,'Camera wrappers/arrays keep immutable semantic identities without serializing their geometry')
const replacedScene={...bigScene,objects:[Object.freeze({...bigObject,appearance:{fill:'#123456'}})]}
const keyReplacement=await keyController.capture(replacedScene,view,vectors,0,()=>true,dirty);keyHeld.push(keyReplacement)
assert.equal(captures-before,2,'A semantic replacement with the same revision still rejects old paint')
const changedVectors={...vectors,json:'{"operations":[],"revision":2}'}
const keyVectorChange=await keyController.capture(replacedScene,view,changedVectors,0,()=>true,dirty);keyHeld.push(keyVectorChange)
assert.notEqual(keyReplacement.present,keyVectorChange.present,'Exact vector transport changes cannot reuse the prior compiled frame')
assert.equal(captures-before,2,'Transport-only change still retains the unchanged card contribution')
bigStage.ownerDocument.defaultView.devicePixelRatio=3
keyHeld.push(await keyController.capture(replacedScene,view,changedVectors,0,()=>true,dirty))
assert.equal(captures-before,3,'Compact semantic keys preserve DPR invalidation')
keyController.dispose();for(const paint of keyHeld)paint?.release();assert.equal(pins,0);assert.equal(leases,0)
const latin={exactScale:false,images:[]},hinted={exactScale:true,images:[]},mip={exactScale:false,images:[{width:1024,height:1024,transform:[.25,0,0,.25,0,0],acceptedWidth:512,acceptedHeight:512}]}
assert.equal(retainedCardSupportsScale(latin,1,3,2),true,'World-space unhinted outlines retain sharp vector geometry at another zoom')
assert.equal(retainedCardSupportsScale(hinted,1,.5,2),false,'Hinted/SVG actual-scale derivatives require another capture')
assert.equal(retainedCardSupportsScale(mip,1,.5,2),true,'Higher-detail mip remains sufficient while zooming out')
assert.equal(retainedCardSupportsScale(mip,1,.99,2),true,'Rounded mip bucket reuse preserves required physical demand')
assert.equal(retainedCardSupportsScale(mip,1,1.001,2),false,'Crossing the rounded mip threshold requires sharper pixels')
assert.equal(retainedCardSupportsScale(mip,1,1,3),false,'Higher DPR requires a sharper mip even at unchanged CSS zoom')
scalePolicies.set('latin',latin);scalePolicies.set('image',mip);scalePolicies.set('hinted',hinted)
const zoomArticles=['latin','image','hinted'].map(id=>({dataset:{nodeId:id},getAnimations:()=>[]})),zoomScene={...scene,objects:zoomArticles.map(article=>({id:article.dataset.nodeId,kind:'text',revision:1}))}
const zoomController=createMountedScenePaint({...stage,querySelectorAll:()=>zoomArticles}),zoomHeld=[]
before=captures
zoomHeld.push(await zoomController.capture(zoomScene,view,vectors,0,()=>true,dirty))
zoomHeld.push(await zoomController.capture(zoomScene,{...view,scale:.5},vectors,0,()=>true,dirty))
assert.equal(captures-before,4,'Zoom out reuses world outlines and sharper static mip; exact-scale card alone recaptures')
assert.equal(missRows.at(-1).exactScale,1);assert.equal(missRows.at(-1).reused,2)
scalePolicies.set('image',{...mip,images:mip.images.map(image=>({...image,acceptedWidth:1024,acceptedHeight:1024}))})
zoomHeld.push(await zoomController.capture(zoomScene,{...view,scale:1.001},vectors,0,()=>true,dirty))
assert.equal(captures-before,6,'Zoom above the mip threshold recaptures the image and exact-scale card')
assert.equal(missRows.at(-1).physicalDemand,1);assert.equal(missRows.at(-1).exactScale,1)
zoomHeld.push(await zoomController.capture(zoomScene,{...view,scale:1.05},vectors,0,()=>true,dirty))
assert.equal(captures-before,7,'Native-size image mip and scalable outlines remain sharp at the next zoom')
zoomController.dispose();for(const paint of zoomHeld)paint?.release();assert.equal(pins,0);assert.equal(leases,0)
// Exercise the actual provider retirement boundary, rather than assuming the
// complete-paint stub above preserves a skipped SVG effect's provider identity.
const providerController=createMeasuredCardProviders({epoch:1})
const initialProviders=providerController.forCapture()
await initialProviders.providers.svg({}, {id:'a:box-0:svg'})
await initialProviders.providers.svg({}, {id:'b:box-0:svg'})
assert.equal(initialProviders.scalePolicyFor('a').exactScale,true,'The real SVG provider marks its sampled oracle as scale-dependent')
initialProviders.release();assert.deepEqual(retiredEffects.at(-1),['a:box-0:svg:filter','b:box-0:svg:filter'])
const partialProviders=providerController.forCapture(new Set(['b']))
await partialProviders.providers.svg({}, {id:'a:box-1:svg'})
partialProviders.release();assert.deepEqual(retiredEffects.at(-1),['a:box-1:svg:filter','b:box-0:svg:filter'],'Refreshed provider retires obsolete child IDs while retained neighbor survives')
providerController.forCapture(new Set(['b'])).release()
assert.deepEqual(retiredEffects.at(-1),['b:box-0:svg:filter'],'Removed card provider retires independently')
providerController.forCapture().release();assert.deepEqual(retiredEffects.at(-1),[])
providerController.dispose()

// Legacy live-clip compatibility oracle (Notes now use model paint). Join the actual adapter. Immutable drag
// replacements must capture the moved card without recapturing its neighbors.
const {registerHooks}=await import('node:module')
registerHooks({resolve(s,c,next){try{return next(s,c)}catch(e){if(s.startsWith('.'))return next(s+'.ts',c);throw e}}})
const {createArtEquationCanvasScene}=await import('../src/board/artEquationCanvasAdapter.ts')
const dragNodes=Array.from({length:40},(_,i)=>({id:'drag-card-'+i,kind:'clip',assetId:'legacy-live-clip',title:'Card '+i,body:'Original prose',x:i*100,y:0,width:90,height:80}))
const dragAssets=[],dragColors={background:'#000',grid:'#fff'},dragDirty={globalRevision:1,objectRevisions:new Map()}
const dragArticles=dragNodes.map(n=>({dataset:{nodeId:n.id},getAnimations:()=>[]}))
const dragStage={querySelectorAll:()=>dragArticles,ownerDocument:{defaultView:{devicePixelRatio:1}},getAnimations:()=>[]}
const dragController=createMountedScenePaint(dragStage),dragHeld=[]
let dragBoard={id:'retained-drag',nodes:dragNodes,connectors:[]},beforeDragCaptures=captures
let dragScene=createArtEquationCanvasScene(dragBoard,dragAssets,dragColors)
dragHeld.push(await dragController.capture(dragScene,view,vectors,1,()=>true,dragDirty))
assert.equal(captures-beforeDragCaptures,40)
for(let i=0;i<8;i++){
 dragBoard={...dragBoard,nodes:dragBoard.nodes.map((n,j)=>j===0?{...n,x:n.x+.25}:n)}
 dragScene=createArtEquationCanvasScene(dragBoard,dragAssets,dragColors)
 dragHeld.push(await dragController.capture(dragScene,view,vectors,i+2,()=>true,dragDirty))
 assert.equal(missRows.at(-1).reused,39,'Moving one canonical card retains all stationary paint')
}
assert.equal(captures-beforeDragCaptures,48,'Eight drag samples capture eight moved cards, not 320 cards')
dragBoard={...dragBoard,nodes:dragBoard.nodes.map((n,j)=>j===1?{...n,body:'Edited prose'}:n)}
dragHeld.push(await dragController.capture(createArtEquationCanvasScene(dragBoard,dragAssets,dragColors),view,vectors,10,()=>true,dragDirty))
assert.equal(captures-beforeDragCaptures,49,'Real prose edits still invalidate their retained paint')
dragController.dispose();for(const paint of dragHeld)paint?.release();assert.equal(pins,0);assert.equal(leases,0)
const structuredController=createMountedScenePaint(stage),beforeStructuredReads=canonicalReads
const structuredPaint=await structuredController.capture({...scene,objects:[{...scene.objects[0],structuredCard:{kind:'graph-column'}}]},view,vectors,0,()=>true,{globalRevision:0,objectRevisions:new Map()})
assert.equal(canonicalReads,beforeStructuredReads,'Model-painted graph bodies never toggle DOM skins')
assert.equal(structuredPaint.cardIds.size,1,'Structured paint remains complete and eligible for ownership')
const modelScene={...scene,objects:[{...scene.objects[0],localBounds:{x:0,y:0,width:100,height:100},structuredCard:{kind:'graph-column'}}]}
const modelFirst=await structuredController.capture(modelScene,view,vectors,1,()=>true,{globalRevision:0,objectRevisions:new Map()})
const modelOther=await structuredController.capture({...modelScene,id:'other',objects:[]},view,vectors,2,()=>true,{globalRevision:1,objectRevisions:new Map()})
const modelBack=await structuredController.capture(modelScene,{...view,scale:.5},vectors,3,()=>true,{globalRevision:2,objectRevisions:new Map([['a',99]])})
assert.equal(missRows.at(-1).reused,1,'Returning to a board reuses model paint despite replaced DOM/global revisions and zoom')
assert.equal(canonicalReads,beforeStructuredReads,'Model board switches do not measure DOM paint')
const modelEdit=await structuredController.capture({...modelScene,objects:[{...modelScene.objects[0],revision:2,structuredCard:{kind:'graph-column',title:'Edited'}}]},view,vectors,4,()=>true,{globalRevision:2,objectRevisions:new Map()})
assert.equal(missRows.at(-1).reused,0,'Authored replacement invalidates model paint')
structuredController.dispose();for(const result of [structuredPaint,modelFirst,modelOther,modelBack,modelEdit])result?.release();assert.equal(pins,0);assert.equal(leases,0)
const obsoleteController=createMountedScenePaint(stage)
let currencyChecks=0
assert.equal(await obsoleteController.capture(scene,view,vectors,0,()=>++currencyChecks===1,{globalRevision:0,objectRevisions:new Map()}),undefined)
assert.equal(diagnosticRows.filter(row=>row.kind==='paint.capture-outcome').at(-1).data.disposition,'obsolete','Capture invalidated during provider IO is attributed explicitly')
obsoleteController.dispose();assert.equal(pins,0);assert.equal(leases,0)
assert.ok(diagnosticRows.some(row=>row.kind==='paint.cache-evict'&&Object.values(row.data).some(value=>value>0)),'Actual card releases emit aggregated reason counters')
// Providers complete after a camera request loses its generation. Qualified
// content is useful to the next request, but never returned as an old frame.
const warmingArticles=[{dataset:{nodeId:'a'},getAnimations:()=>[]}],warmingStage={...stage,querySelectorAll:()=>warmingArticles}
const warmingController=createMountedScenePaint(warmingStage),warmingDirty={globalRevision:0,objectRevisions:new Map()}
let warmingChecks=0,beforeWarming=captures
assert.equal(await warmingController.capture(scene,view,vectors,0,()=>++warmingChecks===1,warmingDirty,()=>true),undefined)
assert.equal(diagnosticRows.filter(row=>row.kind==='paint.capture-outcome').at(-1).data.cached,1,'Camera-obsolete capture warms qualified card cache')
const warmed=await warmingController.capture(scene,{...view,x:200},vectors,0,()=>true,warmingDirty)
assert.equal(captures-beforeWarming,1,'Latest pan reuses provider work completed by superseded camera')
assert.equal(missRows.at(-1).reused,1)
warmingController.dispose();warmed.release();assert.equal(pins,0);assert.equal(leases,0)
const staleContentController=createMountedScenePaint(warmingStage)
let staleChecks=0,beforeStale=captures
assert.equal(await staleContentController.capture(scene,view,vectors,0,()=>++staleChecks===1,warmingDirty,()=>false),undefined)
assert.equal(diagnosticRows.filter(row=>row.kind==='paint.capture-outcome').at(-1).data.cached,0,'Content-obsolete capture cannot seed reusable paint')
const afterStale=await staleContentController.capture(scene,view,vectors,0,()=>true,warmingDirty)
assert.equal(captures-beforeStale,2,'Latest request recaptures when content validation failed')
staleContentController.dispose();afterStale.release();assert.equal(pins,0);assert.equal(leases,0)

// Exercise the actual production host predicate, not a duplicate validator.
const hostSource=await fs.readFile('src/board/VelloBoardBackdrop.tsx','utf8')
const hostAst=ts.createSourceFile('VelloBoardBackdrop.tsx',hostSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let predicate,lookup
function findPredicate(node){if(ts.isVariableDeclaration(node)&&node.name.getText(hostAst)==='contentCurrent')predicate=node.initializer.getText(hostAst);if(ts.isVariableDeclaration(node)&&node.name.getText(hostAst)==='objectsForValidation')lookup=node.initializer.getText(hostAst);ts.forEachChild(node,findPredicate)}
findPredicate(hostAst);assert.ok(predicate)
const predicateCode=ts.transpileModule('let validationSources;let validationObjects=new Map();const objectsForValidation='+lookup+';const check='+predicate+'; return {check,setGlobal(value){globalRevision=value},dispose(){disposed=true}}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const sourceObject={id:'a'},capturedScene={id:'s',environment:{grid:{visible:true}},objects:[sourceObject]},latestRef={current:{scene:capturedScene}},windowFixture={devicePixelRatio:2},localRevisions=new Map()
let validationIndexBuilds=0
const guard=new Function('recordMetric','disposed','globalRevision','invalidation','window','capturedDpr','inputRef','paintedScene','capturedEnvironment','objectRevisions',predicateCode)(()=>validationIndexBuilds++,false,7,{globalRevision:7,objectRevisions:new Map()},windowFixture,2,latestRef,capturedScene,JSON.stringify(capturedScene.environment),localRevisions)
assert.equal(guard.check(),true)
assert.equal(guard.check(),true);assert.equal(validationIndexBuilds,1,'Repeated async checks reuse the canonical ID index')
latestRef.current.scene={...capturedScene};assert.equal(guard.check(),true,'Camera wrapper retains immutable content')
latestRef.current.scene={...capturedScene,objects:[{...sourceObject}]};assert.equal(guard.check(),false,'Replacement model cannot reuse captured paint')
latestRef.current.scene={...capturedScene,id:'other'};assert.equal(guard.check(),false,'Board switch revokes warming')
latestRef.current.scene={...capturedScene,environment:{grid:{visible:false}}};assert.equal(guard.check(),false,'Environment edits revoke warming')
latestRef.current.scene=capturedScene;localRevisions.set('a',1);assert.equal(guard.check(),false,'Local DOM/source invalidation revokes warming')
localRevisions.clear();windowFixture.devicePixelRatio=1;assert.equal(guard.check(),false,'DPR change revokes warming')
windowFixture.devicePixelRatio=2;guard.setGlobal(8);assert.equal(guard.check(),false,'Theme/global invalidation revokes warming')
guard.setGlobal(7);guard.dispose();assert.equal(guard.check(),false,'Disposal revokes warming')
console.log('Complete paint retention: PASS (pan, zoom, scoped/global invalidation, per-card animation, replacement, membership, rejection, asynchronous ownership and DOM-free structured paths; no pixel qualification)')


