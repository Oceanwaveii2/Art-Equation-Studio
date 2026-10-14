import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url), cache = new Map(), sources = {}
async function moduleUrl(file) {
  file = resolve(file)
  if (cache.has(file)) return cache.get(file)
  const source = await readFile(file, 'utf8'); sources[file] = createHash('sha256').update(source).digest('hex')
  let code = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  for (const match of [...code.matchAll(/from ['"](.+?)['"]/g)]) {
    const dependency = match[1].startsWith('.') ? await moduleUrl(resolve(dirname(file), `${match[1]}.ts`)) : pathToFileURL(require.resolve(match[1])).href
    code = code.replace(match[0], `from '${dependency}'`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`; cache.set(file, url); return url
}
const workflow = await import(await moduleUrl('src/board/diagramWorkflow.ts'))
const core = await import(await moduleUrl('src/board/diagramStructureCore.ts'))
const { DiagramStructurePanel } = await import(await moduleUrl('src/board/DiagramStructurePanel.tsx'))
const { runDiagramWorkflow: run, captureDiagramTemplate: capture, instantiateDiagramTemplate: insert, validateDiagramTemplate: validTemplate, diagramObjectRows: rows, validateDiagramWorkflowGraph: validGraph } = workflow
const report = { generatedAt: new Date().toISOString(), passed: false, checks: [], sourceHashes: sources, limits: 'Pure production commands and React server-rendered accessibility surface. Does not certify integrated App gestures/history, native pixels, disk/restart or physical screen readers.' }
const check = (name, action) => { action(); report.checks.push(name) }
const blank = () => ({ id: 'workflow-fixture', title: 'Workflow', viewport: { x: 0, y: 0, scale: 1 }, nodes: [], connectors: [] })
const success = (result) => { assert(result.ok, JSON.stringify(result.issues)); return result.value }
const refused = (result) => assert(!result.ok && result.issues[0].detail)
const edge = (id, more) => ({ id, sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#60a5fa', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false, ...more })
const original = blank(), originalJson = JSON.stringify(original)
const starter = success(run(original, { kind: 'starter-map', namespace: 'starter', origin: { x: 150, y: 180 } })).board
check('20-node starter is one valid source graph with19stable branch edges and no input mutation', () => {
  assert.equal(starter.nodes.length, 20); assert.equal(starter.connectors.length, 19)
  assert(validGraph(starter.nodes, starter.connectors).ok); assert.equal(JSON.stringify(original), originalJson)
  assert.equal(new Set(starter.nodes.map(node => node.id)).size, 20)
})
check('Root child sibling entry preserves ordered tree and exactly one edge per new child', () => {
  let board = success(run(blank(), { kind: 'new-root', namespace: 'root', origin: { x: 10, y: 20 }, title: 'Planning' })).board
  board = success(run(board, { kind: 'add-child', id: 'root:node:0', namespace: 'first', title: 'Ideas' })).board
  board = success(run(board, { kind: 'add-sibling', id: 'first:node:0', namespace: 'second', title: 'Checks' })).board
  assert.deepEqual(board.nodes.map(node => node.mindMap.order), [0, 0, 1]); assert.equal(board.connectors.length, 2)
  assert.equal(board.connectors[1].sourceId, 'root:node:0'); assert.equal(board.nodes[2].title, 'Checks')
  refused(run(board, { kind: 'add-sibling', id: 'root:node:0', namespace: 'bad', title: 'Impossible' }))
  refused(run(board, { kind: 'add-child', id: 'root:node:0', namespace: 'first', title: 'Duplicate' }))
})
check('Reparent20node tree preserves identities labels edge metadata and unchanged world frames', () => {
  const moved = success(run(starter, { kind: 'reparent', id: 'starter:node:1', parentId: 'starter:node:2' })).board
  assert(validGraph(moved.nodes, moved.connectors).ok)
  for (const node of starter.nodes) { const next = moved.nodes.find(entry => entry.id === node.id); assert.deepEqual([next.title,next.x,next.y,next.width,next.height], [node.title,node.x,node.y,node.width,node.height]) }
  assert.equal(moved.connectors.find(edge => edge.mindMap.childId === 'starter:node:1').sourceId, 'starter:node:2')
  assert.deepEqual(moved.nodes.filter(node => node.mindMap.parentId === 'starter:node:0').map(node => node.mindMap.order), [0,1,2])
  refused(run(moved, { kind: 'reparent', id: 'starter:node:2', parentId: 'starter:node:1' }))
  refused(run(moved, { kind: 'reparent', id: 'starter:node:0', parentId: 'starter:node:1' }))
})
check('Collapsed branches keep source records and edge identities; expand restores visibility', () => {
  const collapsed = success(run(starter, { kind: 'collapse', id: 'starter:node:1', collapsed: true })).board
  assert.equal(collapsed.nodes.length, 20); assert.equal(collapsed.connectors.length, 19)
  assert(!success(core.visibleDiagramNodeIds(collapsed.nodes)).includes('starter:node:17'))
  refused(run(collapsed, { kind: 'add-child', id: 'starter:node:1', namespace: 'hidden-entry', title: 'Hidden' }))
  refused(run(collapsed, { kind: 'move-branch', id: 'starter:node:1', delta: { x: 40, y: 0 } }))
  const expanded = success(run(collapsed, { kind: 'collapse', id: 'starter:node:1', collapsed: false })).board
  assert.equal(success(core.visibleDiagramNodeIds(expanded.nodes)).length, 20)
  assert.deepEqual(expanded.connectors, starter.connectors)
})
check('Whole branch movement moves each member and internal routes once; external/free routes stay fixed', () => {
  const base = structuredClone(starter), branch = new Set(success(core.mindMapBranchIds(base.nodes, 'starter:node:1')))
  base.connectors.find(edge => edge.mindMap.childId === 'starter:node:5').bendPoints = [{ x: 440, y: 100 }]
  base.connectors.push(edge('external', { sourceId: 'starter:node:1', targetId: 'starter:node:2', bendPoints: [{ x: 600, y: 50 }], labelPosition: { t: .3, offsetX: 4, offsetY: 6 } }), edge('free', { sourcePoint: { x: 0, y: 0 }, targetPoint: { x: 500, y: 500 } }))
  const before = JSON.stringify(base), moved = success(run(base, { kind: 'move-branch', id: 'starter:node:1', delta: { x: 40, y: -20 } })).board
  for (const node of base.nodes) { const next = moved.nodes.find(entry => entry.id === node.id); assert.equal(next.x, node.x + (branch.has(node.id) ? 40 : 0)); assert.equal(next.y, node.y + (branch.has(node.id) ? -20 : 0)) }
  assert.deepEqual(moved.connectors.find(edge => edge.mindMap?.childId === 'starter:node:5').bendPoints, [{ x: 480, y: 80 }])
  assert.deepEqual(moved.connectors.slice(-2), base.connectors.slice(-2)); assert.equal(JSON.stringify(base), before)
})
check('Layout is deterministic, preserves source edge metadata and rejects visible inherited lock', () => {
  const disturbed = { ...starter, nodes: starter.nodes.map(node => node.id === 'starter:node:10' ? { ...node, x: 3000, y: 2000 } : node) }
  const arranged = success(run(disturbed, { kind: 'layout', id: 'starter:node:0' })).board
  assert.deepEqual(arranged.nodes, starter.nodes); assert.deepEqual(arranged.connectors, starter.connectors)
  const locked = { ...disturbed, nodes: disturbed.nodes.map(node => node.id === 'starter:node:1' ? { ...node, locked: true } : node) }
  refused(run(locked, { kind: 'layout', id: 'starter:node:0' }))
  refused(run(locked, { kind: 'reparent', id: 'starter:node:5', parentId: 'starter:node:2' }))
})
check('Hide clears selection; own unhide is reversible while inherited hiding prevents leaks', () => {
  const hidden = success(run(starter, { kind: 'visibility', id: 'starter:node:1', hidden: true }))
  assert.deepEqual(hidden.selectedIds, []); assert.equal(hidden.board.nodes.length, 20)
  const visible = success(run(hidden.board, { kind: 'visibility', id: 'starter:node:1', hidden: false }))
  assert.deepEqual(visible.selectedIds, ['starter:node:1'])
  refused(run(hidden.board, { kind: 'visibility', id: 'starter:node:5', hidden: false }))
  const row = success(rows(hidden.board.nodes)).find(row => row.node.id === 'starter:node:5')
  assert(row.hidden && row.inheritedHidden)
})
check('Own lock unlock uses shared boundary and inherited lock cannot be overridden', () => {
  const locked = success(run(starter, { kind: 'lock', id: 'starter:node:1', locked: true })).board
  refused(run(locked, { kind: 'lock', id: 'starter:node:5', locked: false }))
  refused(run(locked, { kind: 'rename', id: 'starter:node:5', title: 'Changed' }))
  const unlocked = success(run(locked, { kind: 'lock', id: 'starter:node:1', locked: false })).board
  assert.equal(success(run(unlocked, { kind: 'rename', id: 'starter:node:5', title: 'Editable' })).board.nodes.find(node => node.id === 'starter:node:5').title, 'Editable')
})
const swimlane = success(run(blank(), { kind: 'swimlane', namespace: 'lane', origin: { x: 30, y: 40 }, title: 'Production' })).board
check('Named swimlane uses ordinary frame ownership, no clipping field or filesystem links', () => {
  assert.equal(swimlane.nodes.length, 4); assert.equal(swimlane.nodes[0].diagramRole, 'swimlane')
  assert.deepEqual(swimlane.nodes.slice(1).map(node => node.title), ['Research','Production','Review'])
  assert(swimlane.nodes.slice(1).every(node => node.groupId === 'lane:frame' && node.kind === 'group' && node.containerRole === 'frame' && node.diagramRole === 'lane'))
  assert(!JSON.stringify(swimlane).includes('clipChildren')); assert(!JSON.stringify(swimlane).includes('linkedFolderPath'))
  const collapsed = success(run(swimlane, { kind: 'collapse', id: 'lane:frame', collapsed: true })).board
  assert.deepEqual(success(core.visibleDiagramNodeIds(collapsed.nodes)), ['lane:frame'])
  const expanded = success(run(collapsed, { kind: 'collapse', id: 'lane:frame', collapsed: false })).board
  assert.equal(success(core.visibleDiagramNodeIds(expanded.nodes)).length, 4)
})
check('Sibling layer ordering preserves contiguous owned branches and all connector records', () => {
  const board = { ...swimlane, nodes: [...swimlane.nodes, { id: 'outside',kind:'note',title:'Outside',x:1300,y:40,width:180,height:90 }] }
  const layered = success(run(board, { kind: 'layer', id: 'lane:frame', direction: 'front' })).board
  assert.deepEqual(success(core.containerPaintOrder(layered.nodes)).orderedIds, ['outside', 'lane:frame','lane:lane:0','lane:lane:1','lane:lane:2'])
  assert.deepEqual(layered.connectors, board.connectors); assert.deepEqual(layered.nodes.slice(1), board.nodes.slice(1))
})
const process = success(run(blank(), { kind: 'process-map', namespace: 'process', origin: { x: 100, y: 120 } })).board
check('10node process map uses editable portable paths and nine attached internal relationships', () => {
  assert.equal(process.nodes.length, 10); assert.equal(process.connectors.length, 9)
  assert(process.nodes.every(node => node.vectorPath?.closed && node.title === node.body && node.diagramShape)); assert(validGraph(process.nodes, process.connectors).ok)
  const renamed=success(run(process,{kind:'rename',id:'process:node:1',title:'Renamed step'})).board.nodes[1]
  assert.equal(renamed.title,'Renamed step');assert.equal(renamed.body,'Renamed step')
})
check('Save local process map and instantiate twice with fresh IDs and exact relationships', () => {
  const template = success(capture(process, process.nodes.map(node => node.id), 'saved-process', 'My process'))
  assert(validTemplate(template)); const before = JSON.stringify(template)
  const first = success(insert(blank(), template, 'instance-one', { x: 20, y: 30 })).board
  const second = success(insert(first, template, 'instance-two', { x: 1800, y: 500 })).board
  assert.equal(second.nodes.length, 20); assert.equal(second.connectors.length, 18)
  assert.equal(new Set([...second.nodes, ...second.connectors].map(item => item.id)).size, 38)
  assert.deepEqual(second.nodes.slice(0,10).map(node => node.title), second.nodes.slice(10).map(node => node.title))
  for (const connection of second.connectors) assert(connection.sourceId.startsWith(connection.id.split(':edge:')[0]) && connection.targetId.startsWith(connection.id.split(':edge:')[0]))
  assert.equal(JSON.stringify(template), before); refused(insert(second, template, 'instance-one', { x: 0, y: 0 }))
})
check('Captured nested regions close ownership and preserve asset refs/manual/detached route metadata', () => {
  const child = { id:'image',kind:'image',title:'Source',x:80,y:160,width:100,height:100,groupId:'lane:lane:0',assetId:'immutable-source',customField:{retain:true} }
  const board = { ...swimlane, nodes:[...swimlane.nodes,child,{id:'outside',kind:'note',title:'Outside',x:1300,y:40,width:100,height:100}],connectors:[edge('inside',{sourceId:'image',targetPoint:{x:200,y:230},bendPoints:[{x:140,y:220}],labelPosition:{t:.4,offsetX:3,offsetY:5},relationshipStyle:'keep'}),edge('outside-edge',{sourceId:'image',targetId:'outside'})] }
  const snapshot=JSON.stringify(board),template=success(capture(board,['lane:frame'],'saved-region','Region'))
  assert.equal(template.nodes.length,5);assert.equal(template.connectors.length,1)
  const restored=success(insert(blank(),template,'region-copy',{x:30,y:40})).board
  assert.deepEqual(restored.nodes.map(node=>({ ...node,id:undefined,groupId:undefined })),board.nodes.slice(0,5).map(node=>({ ...node,id:undefined,groupId:undefined })))
  assert.deepEqual(restored.connectors[0].bendPoints,board.connectors[0].bendPoints);assert.deepEqual(restored.connectors[0].targetPoint,board.connectors[0].targetPoint)
  assert.deepEqual(restored.connectors[0].labelPosition,board.connectors[0].labelPosition);assert.equal(restored.nodes.at(-1).assetId,'immutable-source');assert.equal(JSON.stringify(board),snapshot)
})
check('Mind-map branch templates remap tree/parent/child IDs independently and survive JSON', () => {
  const template=success(capture(starter,['starter:node:1'],'saved-tree','Research tree'))
  assert.equal(template.nodes.length,7);assert.equal(template.connectors.length,6)
  const first=success(insert(blank(),JSON.parse(JSON.stringify(template)),'tree-one',{x:0,y:0})).board
  const second=success(insert(first,template,'tree-two',{x:1400,y:0})).board
  assert.equal(new Set(second.nodes.map(node=>node.mindMap.treeId)).size,2)
  assert(validGraph(second.nodes,second.connectors).ok);assert.equal(second.connectors.length,12)
})
check('Unsupported portal templates and corrupt runtime templates are refused atomically', () => {
  const portal={id:'portal',kind:'board-link',title:'Child',boardLinkRole:'child',targetBoardId:'child-board',x:0,y:0,width:200,height:140}
  refused(capture({...blank(),nodes:[portal]},['portal'],'bad','Portal'))
  const template=success(capture(process,process.nodes.map(node=>node.id),'valid','Valid'))
  assert(!validTemplate({...template,nodes:[{...template.nodes[0],kind:'unsupported'}]}))
  assert(!validTemplate({...template,nodes:[{...template.nodes[0],vectorPath:{version:1,closed:true,points:[{x:NaN,y:0},{x:1,y:0},{x:1,y:1}]}}]}))
  refused(insert(blank(),{...template,version:99},'invalid-copy',{x:0,y:0}));refused(run(blank(),{kind:'starter-map',namespace:'read-only',origin:{x:0,y:0}},true))
})
check('Accessible nonmodal panel exposes named labels/state and preserves normal Tab guidance', () => {
  const html=renderToStaticMarkup(createElement(DiagramStructurePanel,{board:starter,selectedIds:['starter:node:1'],templates:[],origin:{x:0,y:0},onPublish:()=>false,onSaveTemplate:()=>false,onSelect:()=>{},onClose:()=>{}}))
  for(const text of ['aria-label="Diagram structure"','New diagram label','Object label','Branch parent','Template name','role="status"','Tab moves focus normally','Frames do not clip artwork','Add child branch','Reparent branch','Show diagram object Research','Lock diagram object Research'])assert(html.includes(text),text)
  assert(!html.includes('aria-modal="true"'));assert(!html.includes('role="dialog"'))
  const readOnly=renderToStaticMarkup(createElement(DiagramStructurePanel,{board:starter,selectedIds:['starter:node:1'],templates:[],origin:{x:0,y:0},readOnly:true,onPublish:()=>false,onSaveTemplate:()=>false,onSelect:()=>{},onClose:()=>{}}))
  assert(readOnly.includes('workspace is read-only'));assert(readOnly.match(/disabled=""/g).length>=30)
})
const changed=[];for(const [path,hash] of Object.entries(sources))if(hash!==createHash('sha256').update(await readFile(path,'utf8')).digest('hex'))changed.push(path)
assert.deepEqual(changed,[],'Helper sources changed during run; repeat on frozen source')
report.sourcesUnchanged=true;report.passed=true
await mkdir('output/partii-diagram-workflow',{recursive:true});await writeFile('output/partii-diagram-workflow/report.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({passed:report.passed,groups:report.checks.length,report:resolve('output/partii-diagram-workflow/report.json')},null,2))
