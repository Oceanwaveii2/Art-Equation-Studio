import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

const { registerHooks } = await import('node:module')
const { pathToFileURL } = await import('node:url')
registerHooks({resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.'))return next(specifier+'.ts',context);throw error}}})
const { validateBoardMutation, patchBoardNode, dissolveBoardContainer } = await import(pathToFileURL(resolve('src/board/boardMutationSafety.ts')).href)
const node = (id, kind, extra = {}) => ({ id, kind, title: id, x: 10, y: 20, width: 100, height: 100, ...extra })
const fixture = () => ({ id: 'fixture', title: 'Fixture', viewport: { x: 0, y: 0, scale: 1 }, nodes: [node('outer', 'group'), node('inner', 'group', { groupId: 'outer', x: 30 }), node('leaf', 'shape', { groupId: 'inner', x: 50 }), node('outside', 'shape', { x: 900 })], connectors: [
  { id: 'internal', sourceId: 'inner', targetId: 'leaf', sourcePort: 'right', targetPort: 'left', style: 'elbow', width: 2, color: '#ff0000', bendPoints: [{ x: 60, y: 70 }], label: 'keep', labelPosition: { t: .4, offsetX: 3, offsetY: 5 } },
  { id: 'free', sourceId: 'leaf', targetPoint: { x: 300, y: 400 }, sourcePort: 'right', targetPort: 'left', style: 'elbow', bendPoints: [{ x: 180, y: 220 }] },
  { id: 'boundary', sourceId: 'leaf', targetId: 'outside', sourcePort: 'right', targetPort: 'left', style: 'elbow', bendPoints: [{ x: 800, y: 220 }] },
] })
const checks = [], check = (name, run) => { run(); checks.push(name) }
check('Numeric owner movement translates every descendant and internal route once', () => {
  const before = fixture(), saved = JSON.stringify(before), result = patchBoardNode(before, 'outer', { x: 110, y: 70 })
  assert(result.ok)
  for (const original of before.nodes) {
    const next = result.value.nodes.find((entry) => entry.id === original.id), delta = original.id === 'outside' ? { x: 0, y: 0 } : { x: 100, y: 50 }
    assert.equal(next.x, original.x + delta.x); assert.equal(next.y, original.y + delta.y)
    assert.equal(next.width, original.width); assert.equal(next.height, original.height)
  }
  assert.deepEqual(result.value.connectors[0].bendPoints, [{ x: 160, y: 120 }]); assert.deepEqual(result.value.connectors[1].targetPoint, { x: 400, y: 450 })
  assert.deepEqual(result.value.connectors[2], before.connectors[2]); assert.deepEqual(result.value.connectors[0].labelPosition, before.connectors[0].labelPosition)
  assert.equal(JSON.stringify(before), saved)
})
check('Inherited locks block inspector, appearance, order and direct callback edits', () => {
  const before = fixture(); before.nodes[0].locked = true
  for (const patch of [{ x: 99 }, { color: '#abcdef' }, { zIndex: 99 }, { coverAssetId: 'image' }, { locked: false }]) assert(!patchBoardNode(before, 'leaf', patch).ok)
  const next = structuredClone(before); next.nodes[2].color = '#123456'; assert(!validateBoardMutation(before, next).ok)
})
check('Locked descendant makes owner movement/dissolve atomic refusal', () => {
  const before = fixture(), saved = JSON.stringify(before); before.nodes[2].locked = true
  const locked = JSON.stringify(before)
  assert(!patchBoardNode(before, 'outer', { x: 50 }).ok); assert(!dissolveBoardContainer(before, 'outer').ok)
  assert.equal(JSON.stringify(before), locked); assert.notEqual(locked, saved)
})
check('Own unlock works while inherited unlock and content edits stay blocked', () => {
  const before = fixture(); before.nodes[2].locked = true
  assert(patchBoardNode(before, 'leaf', { locked: false }).ok)
  assert(!patchBoardNode(before, 'leaf', { locked: false, color: '#123456' }).ok)
})
check('Hidden deep descendants refuse mutation, while owner can expand', () => {
  const before = fixture(); before.nodes[0].collapsed = true
  assert(!patchBoardNode(before, 'leaf', { x: 0 }).ok)
  assert(patchBoardNode(before, 'outer', { collapsed: false }).ok)
})
check('Dissolve preserves geometry, nested ownership and detaches boundary edges', () => {
  const before = fixture(), result = dissolveBoardContainer(before, 'inner')
  assert(result.ok); assert.equal(result.value.nodes.length, 3)
  const leaf = result.value.nodes.find((entry) => entry.id === 'leaf')
  assert.equal(leaf.groupId, 'outer'); assert.equal(leaf.x, 50)
  assert.equal(result.value.connectors[0].sourceId, undefined); assert(result.value.connectors[0].sourcePoint)
  assert.equal(result.value.connectors[0].targetId, 'leaf')
  assert.deepEqual(result.value.connectors[0].bendPoints, before.connectors[0].bendPoints)
  assert(validateBoardMutation(before, result.value).ok)
})
check('Read-only blocks content/appearance but permits navigation', () => {
  const before = fixture()
  assert(!patchBoardNode(before, 'leaf', { color: '#123456' }, true).ok)
  assert(!validateBoardMutation(before, { ...before, backgroundColor: '#123456' }, true).ok)
  assert(validateBoardMutation(before, { ...before, viewport: { x: 50, y: 60, scale: 2 } }, true).ok)
})
check('Invalid geometry, cycles, dual owners and dangling edges refuse publication', () => {
  const before = fixture()
  for (const patch of [{ x: Infinity }, { width: 0 }, { height: NaN }]) assert(!patchBoardNode(before, 'leaf', patch).ok)
  const cycle = structuredClone(before); cycle.nodes[0].groupId = 'inner'; assert(!validateBoardMutation(before, cycle).ok)
  const dual = structuredClone(before); dual.nodes[2].parentColumnId = 'outer'; assert(!validateBoardMutation(before, dual).ok)
  const dangling = structuredClone(before); dangling.nodes = dangling.nodes.filter((entry) => entry.id !== 'leaf'); assert(!validateBoardMutation(before, dangling).ok)
})
check('Numeric path size scales canonical operands, resolved contours and handles together', () => {
  const path = { version: 1, closed: true, points: [{ x: 0, y: 0, handleOut: { x: 10, y: 20 } }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }
  const shape = node('path', 'shape', { shapeType: 'path', vectorPath: path, vectorBoolean: { operation: 'union', operands: [path, structuredClone(path)], resolvedPaths: [structuredClone(path)], fillRules: ['nonzero', 'evenodd'] }, strokeWidth: 0 })
  const before = { ...fixture(), nodes: [shape], connectors: [] }, saved = JSON.stringify(before)
  const result = patchBoardNode(before, shape.id, { x: 40, width: 200, height: 300 })
  assert(result.ok)
  const after = result.value.nodes[0]
  assert.equal(after.x, 40); assert.equal(after.y, shape.y); assert.equal(after.width, 200); assert.equal(after.height, 300)
  for (const geometry of [after.vectorPath, ...after.vectorBoolean.operands, ...after.vectorBoolean.resolvedPaths]) {
    assert.deepEqual(geometry.points[2], { x: 200, y: 300 })
    assert.deepEqual(geometry.points[0].handleOut, { x: 20, y: 60 })
  }
  assert.equal(after.strokeWidth, 0); assert.deepEqual(after.vectorBoolean.fillRules, ['nonzero', 'evenodd'])
  for (const patch of [{ width: NaN }, { height: 0 }, { height: Infinity }]) assert(!patchBoardNode(before, shape.id, patch).ok)
  assert.equal(JSON.stringify(before), saved)
})
await mkdir('output/playwright/partii-safety-resume', { recursive: true })
await writeFile('output/playwright/partii-safety-resume/mutation-report.json', JSON.stringify({ passed: true, generatedAt: new Date().toISOString(), checks, limitation: 'Production model command tests; native disk/pixels and UI input are separate acceptance.' }, null, 2))
console.log(`Part II mutation safety: ${checks.length}/${checks.length} scenarios passed`)
