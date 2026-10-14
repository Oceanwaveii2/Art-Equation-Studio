import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const inputs = ['src/board/columns.ts', 'src/model/vector.ts', 'src/board/diagramStructureCore.ts', 'src/board/nativeCommandJournal.ts', 'scripts/partii-column-vector-frames.mjs']
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
const report = { generatedAt: new Date().toISOString(), passed: false, checks: 0, groups: [], sourceHashes: await hashes(), limitations: ['Production column/vector/journal helpers in disposable model fixtures; actual pointer/DOM/save acceptance is a separate UI fixture. Independently calculated local anchors and relative controls verify scaling and affine baking; native renderer/device pixels remain separate.'] }
const output = resolve('output/partii-column-vector-frames', report.generatedAt.replace(/[:.]/g, '-')); await mkdir(output, { recursive: true })
const modules = new Map()
async function moduleUrl(path) {
  path = resolve(path); if (modules.has(path)) return modules.get(path)
  let code = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const match of [...code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)]) {
    const imported = await moduleUrl(resolve(dirname(path), `${match[1]}.ts`))
    code = code.replaceAll(`'${match[1]}'`, `'${imported}'`).replaceAll(`"${match[1]}"`, `"${imported}"`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`; modules.set(path, url); return url
}
const C = await import(await moduleUrl('src/board/columns.ts')), H = await import(await moduleUrl('src/board/nativeCommandJournal.ts'))
let resolvedDetachedFixture
const path = { version: 1, closed: true, points: [{ id: 'p0', x: 0, y: 0, handleOut: { x: 30, y: 15 } }, { id: 'p1', x: 160, y: 0, handleIn: { x: -25, y: 18 } }, { id: 'p2', x: 160, y: 96, handleIn: { x: 0, y: -20 } }, { id: 'p3', x: 0, y: 96, handleOut: { x: 20, y: 0 } }] }
const rectangle = (id, left, top, right, bottom) => ({ version: 1, closed: true, points: [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y], index) => ({ id: `${id}-${index}`, x, y })) })
const vector = (id, extra = {}) => ({ id, kind: 'shape', shapeType: 'path', title: id, x: 40, y: 50, width: 160, height: 96, vectorPath: structuredClone(path), color: '#60a5fa', strokeColor: '#eee', strokeWidth: 2, ...extra })
const column = (id, extra = {}) => ({ id, kind: 'column', title: id, x: 400, y: 30, width: 260, height: 300, ...extra })
const board = (nodes, connectors = []) => ({ id: 'column-vector-test', title: 'Disposable', viewport: { x: 0, y: 0, scale: 1 }, nodes, connectors })
const get = (board, id) => board.nodes.find(node => node.id === id), snapshot = value => JSON.stringify(value)
const check = (condition, message) => { report.checks++; assert(condition, message) }, ok = result => { check(result.ok, result.ok ? 'success' : JSON.stringify(result.issues)); return result.value }
const near = (a, b) => Math.abs(a - b) <= 1e-5
// Independent SVG-order calculation: centre origin, scale, skewY, skewX, offset.
function transformed(point, node, relative = false) {
  const t = node.vectorTransform || {}, ox = relative ? 0 : node.width / 2, oy = relative ? 0 : node.height / 2
  let x = (point.x - ox) * (t.scaleX ?? 1), y = (point.y - oy) * (t.scaleY ?? 1)
  y += x * Math.tan((t.skewY ?? 0) * Math.PI / 180); x += y * Math.tan((t.skewX ?? 0) * Math.PI / 180)
  return { x: x + ox + (relative ? 0 : t.translateX ?? 0), y: y + oy + (relative ? 0 : t.translateY ?? 0) }
}
function assertPath(oldPath, newPath, original, width, height) {
  check(oldPath.points.length === newPath.points.length && oldPath.closed === newPath.closed, 'path topology retained')
  for (let index = 0; index < oldPath.points.length; index++) {
    const old = oldPath.points[index], next = newPath.points[index], expected = transformed(old, original)
    check(old.id === next.id && near(next.x, expected.x * width / original.width) && near(next.y, expected.y * height / original.height), 'independent affine/frame anchor')
    for (const handle of ['handleIn', 'handleOut']) {
      if (old[handle]) { const expected = transformed(old[handle], original, true); check(near(next[handle].x, expected.x * width / original.width) && near(next[handle].y, expected.y * height / original.height), 'relative cubic control scales with anchor frame') }
      else check(next[handle] === undefined, 'missing relative control stays missing')
    }
  }
}
async function group(name, run) { const before = report.checks; await run(); report.groups.push({ name, checks: report.checks - before, passed: true }) }
try {
  await group('drop/relayout/detach scale plain cubic path and preserve one command history', () => {
    const original = board([vector('path'), column('column'), { ...vector('unrelated', { x: 900, locked: true }), vectorTransform: { scaleX: .8 } }]), before = snapshot(original)
    const dropped = ok(C.insertNodesIntoColumnResult(original, ['path'], { columnId: 'column', index: 0 })), node = get(dropped, 'path')
    check(node.width === 240 && node.height === 144 && node.freeWidth === 160 && node.freeHeight === 96 && node.parentColumnId === 'column', 'drop frame and free dimensions')
    assertPath(get(original, 'path').vectorPath, node.vectorPath, get(original, 'path'), 240, 144)
    check(snapshot(get(dropped, 'unrelated')) === snapshot(get(original, 'unrelated')) && snapshot(original) === before, 'unrelated locked/input exact')
    const repeated = ok(C.layoutBoardColumnsResult(dropped, ['column'])); check(snapshot(repeated) === snapshot(dropped), 'stable layout never accumulates scales')
    const resized = ok(C.layoutBoardColumnsResult({ ...dropped, nodes: dropped.nodes.map(node => node.id === 'column' ? { ...node, width: 340 } : node) }, ['column']))
    assertPath(node.vectorPath, get(resized, 'path').vectorPath, node, 320, 192)
    const released = ok(C.releaseNodesFromColumnsResult(resized, ['path'])), free = get(released, 'path')
    check(free.width === 160 && free.height === 96 && !free.parentColumnId && !free.groupId, 'detach free dimensions and owner')
    assertPath(get(original, 'path').vectorPath, free.vectorPath, get(original, 'path'), 160, 96)
    const undo = [], redo = []; H.recordNativeCommand(undo, redo, resized, released)
    check(snapshot(H.undoNativeCommand(undo, redo)) === snapshot(resized), 'detach one Undo exact')
    check(snapshot(H.redoNativeCommand(undo, redo)) === snapshot(released), 'detach one Redo exact')
    check(snapshot(JSON.parse(snapshot(released))) === snapshot(released), 'JSON reload geometry/metadata exact')
  })
  await group('affine transform is baked once and rotation/style persist', () => {
    const originalNode = vector('affine', { rotation: 27, vectorTransform: { scaleX: .7, scaleY: 1.2, skewX: 15, skewY: -10, translateX: 7, translateY: -4 }, opacity: .63 }), original = board([originalNode, column('column')])
    const dropped = ok(C.insertNodesIntoColumnResult(original, ['affine'], { columnId: 'column', index: 0 })), node = get(dropped, 'affine')
    assertPath(originalNode.vectorPath, node.vectorPath, originalNode, node.width, node.height)
    check(node.vectorTransform === undefined && node.rotation === 27 && node.opacity === .63 && node.strokeColor === originalNode.strokeColor, 'transform cleared only after bake; rotation/style exact')
    const released = get(ok(C.releaseNodesFromColumnsResult(dropped, ['affine'])), 'affine')
    assertPath(originalNode.vectorPath, released.vectorPath, originalNode, 160, 96)
    check(released.vectorTransform === undefined && released.rotation === 27, 'detach never reapplies baked affine')
  })
  await group('Boolean operands and resolved contours share drop/relayout/detach frame', () => {
    const operands = [rectangle('outer', 0, 0, 160, 96), rectangle('cut', 40, 24, 120, 72)], resolvedPaths = [operands[0], { ...operands[1], points: [...operands[1].points].reverse() }]
    const originalNode = vector('boolean', { vectorPath: operands[0], vectorBoolean: { operation: 'subtract', operands, resolvedPaths, fillRules: ['nonzero', 'evenodd'], extension: { keep: true } } }), original = board([originalNode, column('column')])
    const dropped = ok(C.insertNodesIntoColumnResult(original, ['boolean'], { columnId: 'column', index: 0 })), node = get(dropped, 'boolean')
    for (const field of ['operands', 'resolvedPaths']) for (let index = 0; index < originalNode.vectorBoolean[field].length; index++) assertPath(originalNode.vectorBoolean[field][index], node.vectorBoolean[field][index], originalNode, 240, 144)
    check(snapshot(node.vectorBoolean.fillRules) === snapshot(originalNode.vectorBoolean.fillRules) && snapshot(node.vectorBoolean.extension) === snapshot(originalNode.vectorBoolean.extension), 'Boolean rule and extension metadata exact')
    const released = get(ok(C.releaseNodesFromColumnsResult(dropped, ['boolean'])), 'boolean')
    for (const field of ['operands', 'resolvedPaths']) for (let index = 0; index < originalNode.vectorBoolean[field].length; index++) assertPath(originalNode.vectorBoolean[field][index], released.vectorBoolean[field][index], originalNode, 160, 96)
    check(snapshot(JSON.parse(snapshot(released.vectorBoolean))) === snapshot(released.vectorBoolean), 'resolved contours serialize intact')
    resolvedDetachedFixture = released
  })
  await group('container subtree dimensions/internal routes and inherited refusal stay exact', () => {
    const groupNode = { id: 'group', kind: 'group', title: 'Frame', containerRole: 'frame', x: 0, y: 0, width: 280, height: 220 }, child = vector('child', { groupId: 'group', x: 30, y: 40 })
    const edge = { id: 'edge', sourceId: 'child', targetPoint: { x: 260, y: 150 }, sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#aaf', width: 2, startArrow: false, endArrow: true, animated: false, dashed: false, bendPoints: [{ x: 250, y: 130 }], label: 'Internal' }, original = board([groupNode, child, column('column')], [edge])
    const dropped = ok(C.insertNodesIntoColumnResult(original, ['group', 'child'], { columnId: 'column', index: 0 })), nextGroup = get(dropped, 'group'), nextChild = get(dropped, 'child'), dx = nextGroup.x - groupNode.x, dy = nextGroup.y - groupNode.y
    check(nextGroup.width === groupNode.width && nextGroup.height === groupNode.height && nextChild.width === child.width && nextChild.height === child.height && snapshot(nextChild.vectorPath) === snapshot(child.vectorPath), 'container-owned vectors translate without resizing')
    check(nextChild.x === child.x + dx && nextChild.y === child.y + dy && dropped.connectors[0].targetPoint.x === edge.targetPoint.x + dx && dropped.connectors[0].bendPoints[0].y === edge.bendPoints[0].y + dy, 'subtree internal free endpoint/manual route translated once')
    const locked = { ...dropped, nodes: dropped.nodes.map(node => node.id === 'group' ? { ...node, locked: true } : node) }, before = snapshot(locked)
    check(!C.releaseNodesFromColumnsResult(locked, ['group']).ok && snapshot(locked) === before, 'locked subtree detach refuses atomically')
  })
  report.sourceHashesAtEnd = await hashes(); assert.deepEqual(report.sourceHashesAtEnd, report.sourceHashes)
  await writeFile(resolve(output, 'resolved-detached-node.json'), JSON.stringify(resolvedDetachedFixture, null, 2)); report.passed = true
} catch (error) { report.failure = { message: error.message, stack: error.stack?.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[production module]') }; process.exitCode = 1 }
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, checks: report.checks, groups: report.groups, failure: report.failure, output }))
