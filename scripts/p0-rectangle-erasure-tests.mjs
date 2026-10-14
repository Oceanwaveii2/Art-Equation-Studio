import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { eraseRectangleAppearance, rectangleErasureState, resizeRectangleErasureFrame, resolveRectangleErasureMask } from '../src/model/rectangleErasure.ts'
import { rectangleErasureCssClip, prepareRectangleErasurePick, maskCompleteRectanglePaint } from '../src/board/rectangleErasurePaint.ts'
import { vectorLocalToBoard } from '../src/model/vector.ts'
import { vectorDirectSelectionPolicy } from '../src/model/vectorEditing.ts'
import { bindP0Geometry } from './p0-test-module-loader.mjs'

const files = ['src/model/rectangleErasure.ts', 'src/board/rectangleErasurePaint.ts', 'src/model/vectorDrawing.ts', 'src/model/vectorBooleanGeometry.ts', 'src/board/canonicalVectorPicking.ts', 'src/board/completeMeasuredCardPaint.ts', 'src/board/completeMeasuredCardPaint.css', 'src/board/boardMutationSafety.ts', 'src/board/nativeEditCommands.ts', 'src/board/columns.ts', 'src/board/boardVisualExport.ts', 'src/model/vectorEditing.ts', 'src/App.tsx']
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])))
const sourceHashes = Object.fromEntries([...sources].map(([file, text]) => [file, createHash('sha256').update(text).digest('hex')]))
const pickerCode = bindP0Geometry(ts.transpileModule(sources.get('src/board/canonicalVectorPicking.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
const { createRequire } = await import('node:module'), { pathToFileURL } = await import('node:url')
const require = createRequire(new URL('../package.json', import.meta.url))
const { createCanonicalVectorPicker } = await import(`data:text/javascript;base64,${Buffer.from(pickerCode.replace(/from ['"]paper['"]/g, `from '${pathToFileURL(require.resolve('paper')).href}'`)).toString('base64')}`)
const picker = createCanonicalVectorPicker(), checks = [], check = (name, body) => { body(); checks.push(name) }
const node = extra => ({ id: 'css-rectangle', kind: 'shape', shapeType: 'rectangle', title: 'Rectangle', body: 'Caption stays anchored', x: 40, y: 60, width: 200, height: 100, color: '#d76e32', textColor: '#ffffff', strokeColor: '#30a2ef', strokeWidth: 12, cornerRadius: 14, opacity: .4, rotation: 0, ...extra })
const erase = (value, localPoints, radius = 18) => eraseRectangleAppearance(value, localPoints.map(point => vectorLocalToBoard(value, point)), radius)
const hit = (value, localPoint) => picker.hitNode(value, vectorLocalToBoard(value, localPoint))
let cut
const boundModules = new Map()
async function bindActualModule(file) {
  if (boundModules.has(file.href)) return boundModules.get(file.href)
  let code = ts.transpileModule(await readFile(file, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
  for (const match of [...code.matchAll(/from ['"](\.[^'"]+)['"]/g)]) {
    const child = new URL(match[1].endsWith('.ts') ? match[1] : match[1] + '.ts', file)
    const childUrl = await bindActualModule(child)
    code = code.replace(match[0], `from '${childUrl}'`)
  }
  code = code.replace(/from ['"]paper['"]/g, `from '${pathToFileURL(require.resolve('paper')).href}'`)
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;boundModules.set(file.href,url);return url
}

check('canonical rectangle erasure retains frame, style, body, identity and caller source', () => {
  const value = node(), before = JSON.stringify(value), result = erase(value, [{ x: 90, y: 50 }])
  assert(result.changed); assert.equal(result.nodes.length, 1); cut = result.nodes[0]
  const { vectorBoolean, ...kept } = cut
  assert.deepEqual(kept, value); assert.equal(JSON.stringify(value), before)
  assert.equal(vectorBoolean.operation, 'subtract'); assert.equal(vectorBoolean.operands.length, 2)
  assert.equal(cut.vectorPath, undefined); assert.equal(cut.shapeType, 'rectangle')
})
check('actual canonical picker consumes shared world contours, including erased interior', () => {
  assert(hit(cut, { x: 30, y: 50 })); assert(!hit(cut, { x: 90, y: 50 })); assert(!hit(cut, { x: -10, y: 50 })); assert(!hit(cut, { x: 1, y: 1 }))
  const prepared = prepareRectangleErasurePick(cut)
  assert.equal(picker.nodeStatus(cut), 'ready'); assert.equal(picker.hitNode(cut, {x:NaN,y:2}), false)
  assert(Object.isFrozen(prepared)); assert(Object.isFrozen(prepared.commands)); assert(prepared.commands.every(Object.isFrozen))
})
check('overlapping and crossing capsule cutters subtract their union without re-filled intersections', () => {
  const twice = erase(cut, [{ x: 104, y: 50 }]).nodes[0]
  for (const x of [74, 80, 90, 97, 104, 118]) assert(!hit(twice, { x, y: 50 }), `overlap ${x} became visible`)
  assert(hit(twice, { x: 145, y: 50 }))
  const crossed = erase(twice, [{ x: 140, y: 5 }, { x: 140, y: 95 }], 6).nodes[0]
  assert(!hit(crossed, { x: 140, y: 30 })); assert(!hit(crossed, { x: 140, y: 70 }))
})
check('identical and wholly exterior brushes create no history commit', () => {
  assert.equal(erase(cut, [{ x: 90, y: 50 }]).changed, false)
  assert.equal(erase(cut, [{ x: 300, y: 50 }]).changed, false)
})
check('rotation maps a circular world brush into the retained local mask exactly once', () => {
  for (const rotation of [-173, 37, 90, 271]) {
    const value = node({ rotation }), result = erase(value, [{ x: 90, y: 50 }])
    assert(result.changed); assert.equal(result.nodes[0].rotation, rotation)
    assert(!hit(result.nodes[0], { x: 90, y: 50 })); assert(hit(result.nodes[0], { x: 30, y: 50 }))
  }
})
check('JSON save/reopen retains canonical cutters and all appearance semantics', () => {
  const reopened = JSON.parse(JSON.stringify(cut))
  assert.deepEqual(reopened, cut); assert(rectangleErasureState(reopened)); assert(!hit(reopened, { x: 90, y: 50 }))
  assert(hit(reopened, { x: 20, y: 50 }))
})
check('resize scales cuts from the gesture baseline while rebuilding absolute clamped radius', () => {
  const before = JSON.stringify(cut), resized = resizeRectangleErasureFrame(cut, { x: 70, y: 80, width: 400, height: 50 })
  assert.equal(JSON.stringify(cut), before); assert.equal(resized.cornerRadius, 14)
  assert.equal(rectangleErasureState(resized).base.points[0].x, 14)
  assert(!hit(resized, { x: 180, y: 25 })); assert(hit(resized, { x: 60, y: 25 }))
  assert.equal(resized.body, cut.body); assert.equal(resized.strokeWidth, cut.strokeWidth)
  const repeated = resizeRectangleErasureFrame(cut, { x: 70, y: 80, width: 400, height: 50 })
  assert.deepEqual(repeated, resized)
})
check('changing CSS radius changes live corners without moving existing cuts', () => {
  const edited = { ...cut, cornerRadius: 40 }
  assert(rectangleErasureState(edited)); assert(!hit(edited, { x: 5, y: 5 })); assert(!hit(edited, { x: 90, y: 50 })); assert(hit(edited, { x: 40, y: 5 }))
})
check('whole-paint shadow envelope and CSS nonzero path keep unaffected external shadow area', () => {
  const bounds = { x: -30, y: -30, width: 260, height: 160 }, paths = resolveRectangleErasureMask(cut, bounds)
  assert(paths && paths.length > 1)
  const css = rectangleErasureCssClip(cut, bounds)
  assert(css.startsWith('path(nonzero, "')); assert(css.includes('-30')); assert(css.includes(' C '))
  assert.equal(rectangleErasureCssClip(cut, { x: 0, y: 0, width: 100, height: 100 }), undefined)
})
check('engine clip wraps unchanged border/shadow/text/image/group operations and shared resources', () => {
  const operations = [{ type: 'blurredRoundedRect', id: 'original-shadow', rect: { x: 0, y: 0, width: 200, height: 100 }, radius: 14, stdDeviation: 6, color: '#000000aa', transform: [1, 0, 0, 1, 40, 60] }, { type: 'pushComposite', scopeId: 'original-opacity', commands: [['M', 0, 0], ['L', 200, 0], ['L', 200, 100], ['L', 0, 100], ['Z']], transform: [1, 0, 0, 1, 40, 60], fillRule: 'nonzero', isolation: 'isolated', opacity: .4, blendMode: 'normal' }, { type: 'vector', object: { id: 'original-inset-border', kind: 'vector', payload: { fill: '#30a2efff', commands: [] } } }, { type: 'pop', scopeId: 'original-opacity' }]
  const result = { objectId: cut.id, objectRevision: 7, order: 2, layoutRevision: 3, sourceFingerprint: 'original-skin', status: 'ready', completePaint: true, operations, uploads: [], visualBounds: { x: 10, y: 30, width: 260, height: 160 }, blockers: [] }
  const masked = maskCompleteRectanglePaint(cut, result)
  assert(masked.completePaint); assert.equal(masked.operations[0].type, 'pushClip'); assert.equal(masked.operations.at(-1).type, 'pop')
  assert.deepEqual(masked.operations.slice(1, -1), result.operations); assert.equal(masked.uploads, result.uploads)
  assert.equal(masked.operations[0].fillRule, 'nonzero'); assert.deepEqual(masked.operations[0].transform, [1, 0, 0, 1, 40, 60])
  assert(masked.sourceFingerprint.includes('rectangle-mask')); assert.equal(result.operations.length, 4)
  assert.equal(maskCompleteRectanglePaint(cut, { ...result, objectId: 'wrong' }).completePaint, false)
  assert.equal(maskCompleteRectanglePaint(cut, { ...result, completePaint: false, status: 'unsupported' }).completePaint, false)
})
check('malformed/caption-diagram/hidden/locked/over-budget data never replaces source', () => {
  for (const extra of [{ width: 0 }, { x: NaN }, { rotation: Infinity }, { vectorTransform: { scaleX: 1 } }, { vectorPath: { version: 1, closed: true, points: [] } }, { diagramShape: { version: 1 } }, { locked: true }, { hidden: true }, { vectorBoolean: { operation: 'union', operands: [] } }]) {
    const value = node(extra), result = eraseRectangleAppearance(value, [{ x: 90, y: 50 }], 20)
    assert.equal(result.changed, false); assert.equal(result.nodes[0], value)
  }
  for (const sweep of [[{ x: NaN, y: 2 }], Array.from({ length: 514 }, (_, x) => ({ x, y: 50 }))]) assert.equal(eraseRectangleAppearance(cut, sweep, 4).changed, false)
  assert.equal(resizeRectangleErasureFrame(cut, { x: 0, y: 0, width: 0, height: 10 }), cut)
})

const { prepareBoardVisualExport } = await import(await bindActualModule(new URL('../src/board/boardVisualExport.ts',import.meta.url)))
const { patchBoardNode, validateBoardMutation } = await import(await bindActualModule(new URL('../src/board/boardMutationSafety.ts',import.meta.url)))
const { applyNativeEditCommand } = await import(await bindActualModule(new URL('../src/board/nativeEditCommands.ts',import.meta.url)))
const { insertNodesIntoColumnResult, layoutBoardColumnsResult, releaseNodesFromColumnsResult } = await import(await bindActualModule(new URL('../src/board/columns.ts',import.meta.url)))
check('actual central inspector and native resize/patch preserve rectangle cuts and appearance atomically',()=>{
  const board={id:'board',nodes:[cut],connectors:[],viewport:{x:0,y:0,scale:1}},before=JSON.stringify(board),frame={x:70,y:80,width:400,height:50}
  const inspector=patchBoardNode(board,cut.id,frame);assert(inspector.ok)
  const resized=inspector.value.nodes[0];assert.deepEqual(resized,resizeRectangleErasureFrame(cut,frame));assert(!hit(resized,{x:180,y:25}));assert.equal(resized.body,cut.body)
  const native=applyNativeEditCommand(board,{kind:'resize',id:cut.id,bounds:frame});assert(native.ok);assert.deepEqual(native.value.board,inspector.value)
  const patch=applyNativeEditCommand(board,{kind:'patch',ids:[cut.id],patch:{width:400,height:50,cornerRadius:22}});assert(patch.ok);assert(!hit(patch.value.board.nodes[0],{x:180,y:25}));assert.equal(patch.value.board.nodes[0].cornerRadius,22)
  for(const proposal of[{width:0},{width:Infinity},{width:1e10},{width:400,vectorBoolean:cut.vectorBoolean}])assert.equal(patchBoardNode(board,cut.id,proposal).ok,false)
  assert.equal(patchBoardNode(board,cut.id,{width:400},true).ok,false)
  const malformed={...cut,vectorBoolean:{operation:'union',operands:[]}}
  assert.equal(validateBoardMutation(board,{...board,nodes:[malformed]}).ok,false)
  assert.equal(patchBoardNode({...board,nodes:[malformed]},cut.id,{width:400}).ok,false)
  assert.equal(JSON.stringify(board),before)
})
check('actual column attach/reflow/release rescales the retained cutter frame and rejects malformed rows',()=>{
  const column={id:'column',kind:'column',title:'Column',body:'',x:500,y:100,width:360,height:200,color:'#303030'},board={id:'board',nodes:[column,cut],connectors:[],viewport:{x:0,y:0,scale:1}},before=JSON.stringify(board)
  const inserted=insertNodesIntoColumnResult(board,[cut.id],{columnId:column.id,index:0});assert(inserted.ok)
  const row=inserted.value.nodes.find(value=>value.id===cut.id);assert.equal(row.parentColumnId,column.id);assert.equal(row.freeWidth,cut.width);assert.equal(row.freeHeight,cut.height)
  assert(!hit(row,{x:row.width*90/200,y:row.height/2}));assert.equal(row.body,cut.body);assert.equal(row.strokeWidth,cut.strokeWidth)
  const reflow=layoutBoardColumnsResult({...inserted.value,nodes:inserted.value.nodes.map(value=>value.id===column.id?{...value,width:480}:value)},[column.id]);assert(reflow.ok)
  const widened=reflow.value.nodes.find(value=>value.id===cut.id);assert(widened.width>row.width);assert(!hit(widened,{x:widened.width*90/200,y:widened.height/2}))
  const released=releaseNodesFromColumnsResult(reflow.value,[cut.id]);assert(released.ok)
  const free=released.value.nodes.find(value=>value.id===cut.id);assert.equal(free.parentColumnId,undefined);assert.equal(free.width,cut.width);assert.equal(free.height,cut.height);assert(!hit(free,{x:90,y:50}));assert.equal(free.body,cut.body)
  const malformed={...row,vectorBoolean:{operation:'union',operands:[]}},invalid={...inserted.value,nodes:inserted.value.nodes.map(value=>value.id===cut.id?malformed:value)}
  assert.equal(releaseNodesFromColumnsResult(invalid,[cut.id]).ok,false)
  assert.equal(layoutBoardColumnsResult({...invalid,nodes:invalid.nodes.map(value=>value.id===column.id?{...value,width:480}:value)},[column.id]).ok,false)
  assert.equal(JSON.stringify(board),before)
})
check('actual export projection refuses lossy masked rectangle SVG/PNG regions before artifact writes',()=>{
  const plain=node({id:'other',vectorBoolean:undefined,body:''}),board={id:'board',nodes:[cut,plain],connectors:[],viewport:{x:0,y:0,scale:1}},options={viewportSize:{width:800,height:600}}
  for(const target of['full','viewport','selection']){const result=prepareBoardVisualExport(board,{...options,target,selectedIds:[cut.id]});assert.equal(result.ok,false);assert.equal(result.issues[0].code,'rectangle-appearance-export-pending')}
  assert(prepareBoardVisualExport(board,{...options,target:'selection',selectedIds:[plain.id]}).ok)
  assert(prepareBoardVisualExport({...board,nodes:[{...cut,hidden:true},plain]},{...options,target:'full'}).ok)
  const policy=vectorDirectSelectionPolicy(board.nodes,[cut.id]);assert.equal(policy.state,'unsupported');assert(policy.message.includes('complete appearance'));assert(!policy.message.includes('must be converted'))
})

const domReceipt=JSON.parse(await readFile(new URL('../../docs/engine-p0/2026-10-03/artwork-coverage/MOUNTED_RECTANGLE_MASK.json',import.meta.url),'utf8'))
const engine=await import(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm.js',import.meta.url))
await engine.default({module_or_path:await readFile(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm',import.meta.url))})
const cpuReceipts=[]
check('genuine Vello CPU consumes actual DOM-derived full skin and masks border/shadow/fill as one appearance',()=>{
  for(const key of['before','cut','overlap','resized']){
    const value=domReceipt[key],n=value.node,paint=value.masked;assert(paint.completePaint)
    const snapshot={schema:'art-equation.display-list',schemaVersion:2,sceneId:'mounted-css-rectangle-mask',revision:key,environment:{background:'#00000000',colorSpace:'srgb'},resources:[],operations:paint.operations},width=1060,height=380
    const pixels=engine.render_cpu_snapshot(width,height,JSON.stringify(snapshot),1,40,40),at=(x,y)=>{const i=(Math.round(y)*width+Math.round(x))*4;return[...pixels.slice(i,i+4)]}
    const hole=at(40+n.x+n.width*90/220,40+n.y+n.height/2),fill=at(40+n.x+n.width*40/220,40+n.y+n.height/2),border=at(40+n.x+4,40+n.y+n.height/2),shadow=at(40+n.x-10,40+n.y+n.height/2)
    const nearColor=(actual,expected)=>actual.forEach((channel,i)=>assert(Math.abs(channel-expected[i])<=(i===3?0:1),`premultiplied8bit roundtrip channel ${i}: ${channel} vs ${expected[i]}`))
    nearColor(fill,[215,110,50,166]);nearColor(border,[48,162,239,166]);assert(shadow[3]>0)
    if(key==='before')assert.deepEqual(hole,fill);else{assert.deepEqual(hole,[0,0,0,0]);assert.deepEqual(fill,cpuReceipts[0].fill);assert.deepEqual(border,cpuReceipts[0].border)}cpuReceipts.push({key,hole,fill,border,shadow})
  }
})

picker.dispose()
const receipt = { schema: 'art-equation.p0-rectangle-erasure-tests', timestamp: new Date().toISOString(), sourceHashes, wasmHash:createHash('sha256').update(await readFile(new URL('../src/project-b/p0-surface/generated/p0_engine_wasm_bg.wasm',import.meta.url))).digest('hex'), checkCount: checks.length, checks,cpuReceipts, limits: ['Actual DOM-derived full skin / genuine CPU interiors and mask holes verified; full antialias/blur pixel parity is separate', 'App JSX/scope/resize wiring remains root-owned', 'GPU masked pixel parity and actual native save/reopen not claimed', '512 retained cutters per rectangle; invalid/excessive geometry fails closed'] }
const directory = new URL('../../docs/engine-p0/2026-10-03/artwork-coverage/', import.meta.url)
await mkdir(directory, { recursive: true }); await writeFile(new URL('RECTANGLE_ERASURE_ACCEPTANCE.json', directory), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt, null, 2))
