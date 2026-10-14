import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Pure production loading boundary; no live projects or disk mutation.
const code = ts.transpileModule(await readFile(new URL('../src/model/project.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { normalizeBoardConnector } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const base = { id: 'edge', color: '#60a5fa', sourceId: 'source', targetId: 'target', sourcePort: 'right', targetPort: 'left', style: 'elbow', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false }
let count = 0
const check = (name, run) => { run(); ++count; console.log(`PASS ${name}`) }
check('legacy defaults stay backward compatible', () => {
  assert.deepEqual(normalizeBoardConnector({ id: 'old', color: '' }), { id: 'old', color: '#58c8c1', sourceId: undefined, targetId: undefined, sourcePoint: undefined, targetPoint: undefined, sourcePort: 'right', targetPort: 'left', style: 'curve', width: 2, dashed: false, startArrow: false, endArrow: true, animated: true, label: undefined })
})
check('false booleans and explicit paint survive', () => {
  const loaded = normalizeBoardConnector({ ...base, startArrow: true, endArrow: false, label: 'Manual route' })
  assert.equal(loaded.endArrow, false); assert.equal(loaded.animated, false); assert.equal(loaded.startArrow, true); assert.equal(loaded.label, 'Manual route')
})
check('routes, attachment modes, labels and relationships survive production load', () => {
  const saved = { ...base, sourcePortMode: 'adaptive', targetPortMode: 'fixed', bendPoints: [{ x: 80, y: -45 }, { x: 220, y: 200 }], labelPosition: { t: .25, offsetX: 15, offsetY: -10, extension: { keep: true } }, linePattern: 'dash-dot', relationshipStyle: 'dependency', label: 'Requires', futureMetadata: { revision: 2 } }
  const loaded = normalizeBoardConnector(JSON.parse(JSON.stringify(saved)))
  for (const key of ['sourcePortMode', 'targetPortMode', 'bendPoints', 'labelPosition', 'linePattern', 'relationshipStyle', 'futureMetadata']) assert.deepEqual(loaded[key], saved[key], key)
  assert.deepEqual(normalizeBoardConnector(JSON.parse(JSON.stringify(loaded))), loaded)
  assert.deepEqual(saved.bendPoints, [{ x: 80, y: -45 }, { x: 220, y: 200 }])
})
check('free endpoint coordinates and extension fields survive', () => {
  const loaded = normalizeBoardConnector({ ...base, sourceId: undefined, sourcePoint: { x: 10, y: 20 }, extension: 'kept' })
  assert.equal(loaded.sourceId, undefined); assert.deepEqual(loaded.sourcePoint, { x: 10, y: 20 }); assert.equal(loaded.extension, 'kept')
})
console.log(`Connector loading: ${count}/${count} passed`)
