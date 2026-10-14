import { geometryModuleUrl, booleanModuleUrl, vectorSvgModuleUrl } from './p0-test-module-loader.mjs'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import ts from 'typescript'

// Pure disposable model fixture. No Tauri calls, production data or live files.
const stage = process.env.PARTII_CONNECTOR_STAGE
const source = async (path) => {
  let code
  if (stage) { try { code = await readFile(resolve(stage, basename(path)), 'utf8') } catch {} }
  code ??= await readFile(new URL(path, import.meta.url), 'utf8')
  return ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
}
const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const projectUrl = url(await source('../src/model/project.ts'))
const connectorUrl = url(await source('../src/board/connectors.ts'))
const themeUrl = url(await source('../src/canvasTheme.ts'))
const coreUrl = url(await source('../src/board/diagramStructureCore.ts'))
const { createBlankProject } = await import(projectUrl)
const C = await import(connectorUrl)
const { toNativeScene, nativeChanges } = await import(url((await source('../src/board/nativeSceneAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './connectors'", `from '${connectorUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`).replace("from '../model/vectorBooleanGeometry'", `from '${booleanModuleUrl}'`).replace("from './vectorSvg'", `from '${vectorSvgModuleUrl}'`)))
const { createArtEquationCanvasScene } = await import(url((await source('../src/board/artEquationCanvasAdapter.ts')).replace("from '../canvasTheme'", `from '${themeUrl}'`).replace("from './velloVectorGeometry'", `from '${geometryModuleUrl}'`).replace("from './diagramStructureCore'", `from '${coreUrl}'`)))
const { applyCanvasSelectionTrash, applyNodeRestore, applyBoardTrash, applyBoardRestore } = await import(url((await source('../src/model/trash.ts')).replace("from './project'", `from '${projectUrl}'`)))
const checks = []
const test = (name, run) => { run(); checks.push(name) }
const close = (a, b, epsilon = 1e-6) => assert(Math.abs(a - b) <= epsilon, `${a} != ${b}`)
const pointClose = (a, b) => { close(a.x, b.x); close(a.y, b.y) }
const node = (id, x, y, width = 100, height = 100, extra = {}) => ({ id, title: id, kind: 'image', x, y, width, height, ...extra })
const edge = (extra = {}) => ({ id: 'edge', sourceId: 'a', targetId: 'b', sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#60a5fa', width: 2, dashed: false, startArrow: false, endArrow: true, animated: false, ...extra })
const nodes = [node('a', 0, 0), node('b', 400, 300)]
test('Absent optional metadata preserves legacy routes and labels', () => {
  const original = edge(), normalized = C.normalizeConnector(original)
  assert.deepEqual(normalized, original)
  const geometry = C.connectorGeometry(original, nodes)
  assert.equal(geometry.path, 'M 100 50 L 250 50 L 250 350 L 400 350')
  pointClose(C.connectorLabelPoint(original, geometry), { x: 250, y: 190 })
  assert.equal(geometry.manual, false)
})
test('Adaptive attachment rotates and deterministically resolves ties', () => {
  const adaptive = edge({ sourcePortMode: 'adaptive', targetPortMode: 'adaptive' })
  assert.equal(C.connectorGeometry(adaptive, [node('a', 0, 0), node('b', 0, -400)]).sourcePort, 'top')
  assert.equal(C.connectorGeometry(adaptive, [node('a', 0, 0, 100, 100, { rotation: 90 }), node('b', 0, -400)]).sourcePort, 'left')
  assert.equal(C.nearestPort(node('a', 0, 0), { x: 50, y: 50 }), 'top')
  assert.equal(C.connectorGeometry(edge(), [node('a', 0, 0), node('b', 0, -400)]).sourcePort, 'right')
})
test('Attached/free reconnect removes stale IDs or coordinates without losing metadata', () => {
  const original = edge({ vendorData: { preserve: true }, labelPosition: { t: .3, offsetX: 8, offsetY: -20, future: 'keep' } })
  const freed = C.withConnectorEndpoint(original, 'source', { attachment: 'free', point: { x: 20, y: 30 } })
  assert.equal(freed.sourceId, undefined); pointClose(freed.sourcePoint, { x: 20, y: 30 })
  const attached = C.withConnectorEndpoint(freed, 'source', { attachment: 'attached', objectId: 'a', port: 'bottom', portMode: 'adaptive' })
  assert.equal(attached.sourcePoint, undefined); assert.equal(attached.sourceId, 'a'); assert.equal(attached.sourcePortMode, 'adaptive')
  assert.deepEqual(attached.vendorData, original.vendorData); assert.deepEqual(attached.labelPosition, original.labelPosition)
  assert.equal(C.connectorGeometry(edge({ sourceId: 'missing', sourcePoint: undefined }), nodes), null)
})
test('Finite bounded metadata validation preserves future fields', () => {
  const normalized = C.normalizeConnector(edge({ sourcePortMode: 'invalid', linePattern: 'unknown', sourcePoint: { x: Infinity, y: 0 }, bendPoints: [{ x: NaN, y: 0 }, ...Array.from({ length: 40 }, () => ({ x: 1e9, y: -1e9 }))], labelPosition: { t: Infinity, offsetX: 1e9, offsetY: NaN, future: { retained: true } }, future: 'keep' }))
  assert.equal(normalized.sourcePortMode, undefined); assert.equal(normalized.linePattern, undefined); assert.equal(normalized.sourcePoint, undefined)
  assert.equal(normalized.bendPoints.length, 32); pointClose(normalized.bendPoints[0], { x: 1e6, y: -1e6 })
  assert.deepEqual(normalized.labelPosition, { t: .5, offsetX: 1e6, offsetY: -10, future: { retained: true } }); assert.equal(normalized.future, 'keep')
})
test('Manual elbow bends remain fixed-world through move/resize and can reset', () => {
  const manual = edge({ bendPoints: [{ x: 270, y: 100 }, { x: 330, y: 260 }] })
  const geometry = C.connectorGeometry(manual, nodes)
  assert.equal(geometry.manual, true)
  for (const bend of manual.bendPoints) assert(geometry.points.some((p) => p.x === bend.x && p.y === bend.y))
  const moved = C.connectorGeometry(manual, [node('a', -20, 40, 140, 130), nodes[1]])
  for (const bend of manual.bendPoints) assert(moved.points.some((p) => p.x === bend.x && p.y === bend.y))
  moved.points.slice(1).forEach((point, index) => assert(point.x === moved.points[index].x || point.y === moved.points[index].y, 'Every elbow segment is orthogonal'))
  assert.equal(C.connectorGeometry({ ...manual, bendPoints: [] }, nodes).manual, false)
  assert.equal(C.connectorGeometry({ ...manual, style: 'curve' }, nodes).manual, false, 'Non-elbow styles preserve but ignore bends')
})
test('Route-length label placement and drag projection round trip', () => {
  for (const style of ['straight', 'elbow', 'curve']) {
    const current = edge({ style, labelPosition: { t: .2, offsetX: 11, offsetY: -16 } })
    const geometry = C.connectorGeometry(current, nodes), base = C.pointAlongRoute(geometry.points, .2)
    pointClose(C.connectorLabelPoint(current, geometry), { x: base.x + 11, y: base.y - 16 })
    const dragged = { x: 243, y: 187 }, projected = C.projectConnectorLabelPosition(geometry, dragged)
    pointClose(C.connectorLabelPoint({ ...current, labelPosition: projected }, geometry), dragged)
    const svg = C.connectorSvgMarkup({ ...current, label: '<unsafe & label>' }, nodes)
    assert(svg.includes('&lt;unsafe &amp; label&gt;')); assert(svg.includes(`x="${base.x + 11}"`))
  }
})
test('Four stable relationship styles provide distinguishable line and text cues', () => {
  const patterns = []
  for (const preset of C.CONNECTOR_RELATIONSHIP_STYLES) {
    const applied = C.applyConnectorRelationshipStyle(edge(), preset.id), markup = C.connectorSvgMarkup(applied, nodes)
    assert.equal(applied.relationshipStyle, preset.id); assert.equal(applied.label, preset.cue)
    patterns.push(C.connectorLinePattern(applied))
    if (preset.linePattern === 'dot') assert(markup.includes('stroke-linecap="round"'))
    if (preset.linePattern !== 'solid') assert(markup.includes(`stroke-dasharray="${C.connectorDashArray(applied)}"`))
  }
  assert.equal(new Set(patterns).size, 4)
  const custom = edge({ label: 'Custom note' }); assert.equal(C.applyConnectorRelationshipStyle(custom, 'dependency').label, 'Custom note')
  assert.equal(C.applyConnectorRelationshipStyle(custom, 'future-unregistered'), custom)
})

const fixture = createBlankProject('PII-6 disposable 24-image/30-edge map')
fixture.id = 'pii6-connector-fixture'; fixture.assets = []
fixture.boards = [{ id: 'map', title: 'Image map', linkedFolderPath: 'projects/pii6-connector-fixture/boards/map', viewport: { x: 0, y: 0, scale: 1 },
  nodes: Array.from({ length: 24 }, (_, index) => node(`image-${index}`, index % 8 * 240, Math.floor(index / 8) * 310, 85 + index % 4 * 30, 100 + index % 5 * 25, { rotation: index % 3 === 0 ? 30 : 0 })),
  connectors: Array.from({ length: 30 }, (_, index) => C.applyConnectorRelationshipStyle(edge({ id: `link-${index}`, sourceId: `image-${index % 24}`, targetId: `image-${(index * 7 + 5) % 24}`, style: index === 0 ? 'curve' : index % 5 ? 'elbow' : 'straight', sourcePortMode: index % 2 ? 'adaptive' : 'fixed', targetPortMode: 'adaptive', ...(index % 3 === 1 ? { bendPoints: [{ x: 90 + index * 38, y: -75 + index * 29 }] } : {}), labelPosition: { t: .15 + index % 4 * .2, offsetX: index % 3 * 4, offsetY: -20, future: 'kept' }, futureMetadata: { retained: true } }), C.CONNECTOR_RELATIONSHIP_STYLES[index % 4].id)),
}]
const board = fixture.boards[0], snapshot = structuredClone(fixture)
test('24-image/30-edge branched map serializes exactly, with all stable IDs and routes', () => {
  const reopened = JSON.parse(JSON.stringify(fixture))
  assert.deepEqual(reopened, fixture); assert.equal(reopened.boards[0].nodes.length, 24); assert.equal(reopened.boards[0].connectors.length, 30)
  assert(board.connectors.some((a, i) => board.connectors.slice(i + 1).some((b) => b.sourceId === a.sourceId)), 'Multiple outgoing edges are independent pairwise relationships')
  assert(board.connectors.some((a, i) => board.connectors.slice(i + 1).some((b) => b.targetId === a.targetId)), 'Multiple incoming edges are independent pairwise relationships')
  board.connectors.forEach((connector) => assert(C.connectorGeometry(connector, board.nodes)))
})
test('Production Trash helpers recover mixed image/edge metadata, identity and order', () => {
  const trashed = applyCanvasSelectionTrash(fixture, board.id, ['image-0', 'image-5', 'image-7'], 12345)
  assert(trashed); const reopenedTrash = JSON.parse(JSON.stringify(trashed))
  const restored = applyNodeRestore(reopenedTrash.project, reopenedTrash.entry)
  assert(restored); assert.deepEqual(restored.boards[0], board)
  const whole = applyBoardTrash(fixture, board.id, 12345); assert(whole)
  const restoredBoard = applyBoardRestore(JSON.parse(JSON.stringify(whole.project)), JSON.parse(JSON.stringify(whole.entry)))
  assert(restoredBoard); assert.deepEqual(restoredBoard.boards, fixture.boards)
  assert.deepEqual(fixture, snapshot, 'Fixture remains immutable')
})
const native = toNativeScene(fixture, board, 'dark', 'pii6-1')
test('Native and retained metadata carry exact route/label/style; moved nodes upsert affected edges', () => {
  const retained = createArtEquationCanvasScene(board, [], { background: '#181a1f', grid: '#333333' })
  for (let index = 0; index < 30; index++) {
    const connector = board.connectors[index], geometry = C.connectorGeometry(connector, board.nodes), projected = native.connections[index]
    assert.deepEqual(projected.resolvedGeometry.commands, geometry.commands)
    pointClose(projected.resolvedGeometry.labelPoint, C.connectorLabelPoint(connector, geometry))
    assert.deepEqual(projected.labelPosition, connector.labelPosition); assert.equal(projected.relationshipStyle, connector.relationshipStyle)
    assert.deepEqual(retained.connections[index].bendPoints, connector.bendPoints); assert.deepEqual(retained.connections[index].labelPosition, connector.labelPosition)
    assert.equal(retained.connections[index].linePattern, connector.linePattern)
  }
  const moved = { ...board, nodes: board.nodes.map((n) => n.id === 'image-0' ? { ...n, x: n.x + 70, width: n.width + 15 } : n) }
  const changed = nativeChanges(native, toNativeScene(fixture, moved, 'dark', 'pii6-2'))
  assert(changed.operations.some((op) => op.op === 'upsert-connection' && op.connection.id === 'link-0'))
})
const output = resolve('output/playwright/partii-connectors')
await mkdir(output, { recursive: true })
await writeFile(resolve(output, 'fixture.json'), JSON.stringify(fixture, null, 2))
await writeFile(resolve(output, 'native-fixture.json'), JSON.stringify(native, null, 2))
await writeFile(resolve(output, 'native-expected.json'), JSON.stringify(board.connectors.map((connector) => ({ id: connector.id, geometry: { ...C.connectorGeometry(connector, board.nodes), labelPoint: C.connectorLabelPoint(connector, C.connectorGeometry(connector, board.nodes)) } })), null, 2))
await writeFile(resolve(output, 'image-map.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 2200 1100"><rect x="-100" y="-100" width="2200" height="1100" fill="#181a1f"/>${board.nodes.map((n) => `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" transform="rotate(${n.rotation} ${n.x + n.width / 2} ${n.y + n.height / 2})" fill="#39414d"/><text x="${n.x + 6}" y="${n.y + 18}" fill="white">${n.id}</text>`).join('')}${board.connectors.map((c) => C.connectorSvgMarkup(c, board.nodes)).join('')}</svg>`)
await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, generatedAt: new Date().toISOString(), fixture: { images: 24, edges: 30, styles: 4 }, checks, limitations: 'Pure geometry/export/projection/production Trash helpers only. Native pixels and interactive route/label UI are separate gates.' }, null, 2))
console.log(JSON.stringify({ passed: true, checks: checks.length, output }, null, 2))
