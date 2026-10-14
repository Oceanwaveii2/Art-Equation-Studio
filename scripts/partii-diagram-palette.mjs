import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
const productionInputs = ['src/board/diagramPaletteCommands.ts', 'src/board/diagramStructureCore.ts', 'src/board/boardMutationSafety.ts', 'src/board/connectors.ts', 'src/board/columns.ts', 'src/model/vector.ts', 'src/board/nativeCommandJournal.ts', 'scripts/partii-diagram-palette.mjs']
const hashes = async () => Object.fromEntries(await Promise.all(productionInputs.map(async path => [path, createHash('sha256').update(await readFile(resolve(path))).digest('hex')])))
const sourceHashes = await hashes()

const modules = new Map()
async function moduleUrl(path) {
  path = resolve(path)
  if (modules.has(path)) return modules.get(path)
  let code = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const match of [...code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)]) {
    const imported = resolve(dirname(path), `${match[1]}.ts`), url = await moduleUrl(imported)
    code = code.replaceAll(`'${match[1]}'`, `'${url}'`).replaceAll(`"${match[1]}"`, `"${url}"`)
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  modules.set(path, url); return url
}
const C = await import(await moduleUrl('src/board/diagramPaletteCommands.ts'))
const G = await import(await moduleUrl('src/board/connectors.ts'))
const H = await import(await moduleUrl('src/board/nativeCommandJournal.ts'))
const report = { passed: false, generatedAt: new Date().toISOString(), groups: [], checks: 0, sourceHashes, limitations: ['Pure production command/geometry/journal helpers; no App/native UI or real disk claim. Automatic curves split into two re-routed curve segments under the existing connector contract.'] }
const output = resolve('output/partii-diagram-palette'); await mkdir(output, { recursive: true })
const check = (condition, message) => { report.checks++; assert(condition, message) }
const ok = (result) => { check(result.ok, result.ok ? 'success' : JSON.stringify(result.issues)); return result.value }
const snapshot = (value) => JSON.stringify(value)
const close = (a, b, tolerance = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance
const leaf = (id, extra = {}) => ({ id, kind: 'shape', shapeType: 'rectangle', title: id, x: 0, y: 0, width: 160, height: 96, ...extra })
const board = (nodes = [], connectors = []) => ({ id: 'test', title: 'Disposable flow', viewport: { x: 0, y: 0, scale: 1 }, nodes, connectors })
const edge = (extra = {}) => ({ id: 'old-edge', sourcePoint: { x: 0, y: 0 }, targetPoint: { x: 600, y: 0 }, sourcePort: 'right', targetPort: 'left', style: 'straight', color: '#60a5fa', width: 3, dashed: false, startArrow: true, endArrow: true, animated: false, label: 'Preserve this label', labelPosition: { t: .72, offsetX: 8, offsetY: -20, extension: { keep: true } }, futureMetadata: { version: 7 }, ...extra })
const inserted = (extra = {}) => ({ connectorId: 'old-edge', downstreamConnectorId: 'new-edge', node: { id: 'inserted', shape: 'process', title: 'Review' }, ...extra })
async function group(name, run) { const before = report.checks; await run(); report.groups.push({ name, checks: report.checks - before, passed: true }) }
try {
  await group('searchable portable common shapes', () => {
    check(C.DIAGRAM_SHAPE_CATALOG.length === 7, 'seven compact entries')
    check(C.filterDiagramShapes('branch diamond').map((entry) => entry.id).join() === 'decision', 'all query terms search common names/keywords')
    check(C.filterDiagramShapes('START').map((entry) => entry.id).join() === 'start-end', 'case insensitive start/end')
    check(C.filterDiagramShapes('not a shape').length === 0, 'empty search state')
    for (const entry of C.DIAGRAM_SHAPE_CATALOG) {
      const node = ok(C.diagramShapeNode({ shape: entry.id, id: entry.id, center: { x: 300, y: 200 }, title: '<Check & review>' }))
      check(node.id === entry.id && node.x + node.width / 2 === 300 && node.y + node.height / 2 === 200, 'factory exact world frame')
      check(snapshot(JSON.parse(snapshot(node))) === snapshot(node), 'portable model')
      if (entry.id === 'text') check(node.body === '<p>&lt;Check &amp; review&gt;</p>', 'text creation cannot inject markup')
      else if (!['line', 'arrow'].includes(entry.id)) {
        check(node.vectorPath.version === 1 && node.vectorPath.closed && node.body === '<Check & review>' && node.diagramShape === entry.id, 'shared editable core geometry + explicit diagram caption tag')
        check(JSON.parse(snapshot(node)).diagramShape === entry.id, 'diagram caption tag survives serialization')
      }
      if (['text', 'line', 'arrow'].includes(entry.id)) check(node.diagramShape === undefined, 'ordinary text/line/arrow do not acquire a vector caption tag')
    }
    const lightText = ok(C.diagramShapeNode({ id: 'light-text', shape: 'text', center: { x: 100, y: 100 }, textColor: '#302820' })), lightLine = ok(C.diagramShapeNode({ id: 'light-line', shape: 'line', center: { x: 100, y: 100 }, strokeColor: '#234f6a' }))
    check(lightText.textColor === '#302820' && lightLine.strokeColor === '#234f6a', 'caller theme-aware text/stroke defaults persist')
    check(!C.diagramShapeNode({ id: 'bad-color', shape: 'process', center: { x: 100, y: 100 }, color: NaN }).ok, 'invalid appearance type refuses before creation')
  })
  await group('atomic free/group/column creation', () => {
    const original = board([leaf('outsider', { x: 900, locked: true }), { ...leaf('group'), kind: 'group', width: 700, height: 600 }, { ...leaf('column', { x: 750 }), kind: 'column', width: 260, height: 300 }]), before = snapshot(original)
    for (const ownerId of [undefined, 'group', 'column']) {
      const command = ok(C.createDiagramNodeResult(original, { shape: 'process', id: `new-${ownerId}`, center: { x: 300, y: 200 } }, { ownerId }))
      check(command.board.nodes.length === original.nodes.length + 1 && command.connectorIds.length === 0, 'one creation transaction')
      const node = command.board.nodes.at(-1)
      check(ownerId === 'column' ? node.parentColumnId === ownerId && !node.groupId && Math.max(...node.vectorPath.points.map((point) => point.x)) === node.width : node.groupId === ownerId, 'exclusive owner and scaled column path frame')
      check(snapshot(command.board.nodes[0]) === snapshot(original.nodes[0]) && snapshot(original) === before, 'locked outsider/input preserved')
    }
  })
  await group('connected successor directional branching and style', () => {
    const original = board([leaf('source', { rotation: 30 })]), before = snapshot(original)
    for (const direction of ['top', 'right', 'bottom', 'left']) {
      const command = ok(C.createConnectedSuccessorResult(original, { sourceId: 'source', node: { id: `next-${direction}`, shape: 'decision' }, connectorId: `edge-${direction}`, direction, connector: { style: 'curve', linePattern: 'dot', label: 'Yes' } }))
      const connection = command.board.connectors[0]
      check(connection.sourceId === 'source' && connection.targetId === command.nodeId && connection.sourcePort === direction && connection.style === 'curve' && connection.linePattern === 'dot' && connection.label === 'Yes', 'attached direction/style exact')
      check(G.connectorGeometry(connection, command.board.nodes) !== null, 'resolved source/new endpoint')
    }
    const first = ok(C.createConnectedSuccessorResult(original, { sourceId: 'source', node: { id: 'branch-a', shape: 'process' }, connectorId: 'branch-edge-a' }))
    const second = ok(C.createConnectedSuccessorResult(first.board, { sourceId: 'source', node: { id: 'branch-b', shape: 'process' }, connectorId: 'branch-edge-b' }))
    const a = first.board.nodes.at(-1), b = second.board.nodes.at(-1)
    check(a.x !== b.x || a.y !== b.y, 'default branching positions avoid overlap')
    check(snapshot(original) === before, 'source input retained')
  })
  await group('straight split outside identity/arrows/label semantics', () => {
    const original = board([], [edge()]), before = snapshot(original), oldGeometry = G.connectorGeometry(original.connectors[0], [])
    const command = ok(C.insertDiagramNodeOnConnectorResult(original, inserted()))
    const [incoming, outgoing] = command.board.connectors, node = command.board.nodes[0]
    check(incoming.id === 'old-edge' && outgoing.id === 'new-edge' && incoming.targetId === node.id && outgoing.sourceId === node.id, 'old ID upstream/new ID downstream')
    check(snapshot(incoming.sourcePoint) === snapshot(original.connectors[0].sourcePoint) && snapshot(outgoing.targetPoint) === snapshot(original.connectors[0].targetPoint) && incoming.targetPoint === undefined && outgoing.sourcePoint === undefined, 'outside free endpoints exact and inside stale coordinates removed')
    check(incoming.startArrow && !incoming.endArrow && !outgoing.startArrow && outgoing.endArrow, 'two outside arrowheads only')
    check(incoming.label === original.connectors[0].label && outgoing.label === undefined && outgoing.labelPosition === undefined && snapshot(incoming.labelPosition.extension) === snapshot(original.connectors[0].labelPosition.extension), 'defined label transfer and extension preservation')
    check(close(G.connectorLabelPoint(incoming, G.connectorGeometry(incoming, command.board.nodes)), G.connectorLabelPoint(original.connectors[0], oldGeometry)), 'world label position exact')
    check(snapshot(incoming.futureMetadata) === snapshot(outgoing.futureMetadata) && snapshot(incoming.futureMetadata) === snapshot(original.connectors[0].futureMetadata), 'unknown relationship data retained')
    check(snapshot(original) === before, 'split input exact')
  })
  await group('manual elbow partition retains outer route and attached endpoints', () => {
    const original = board([leaf('a', { x: -160, y: -48 }), leaf('b', { x: 600, y: 352 })], [edge({ sourceId: 'a', targetId: 'b', sourcePoint: undefined, targetPoint: undefined, style: 'elbow', bendPoints: [{ x: 200, y: 0 }, { x: 200, y: 300 }, { x: 500, y: 300 }] })])
    const command = ok(C.insertDiagramNodeOnConnectorResult(original, inserted({ fraction: .4 }))), [a, b] = command.board.connectors
    check(a.sourceId === 'a' && b.targetId === 'b' && a.sourcePort === original.connectors[0].sourcePort && b.targetPort === original.connectors[0].targetPort, 'outside attached IDs/ports exact')
    check(snapshot([...a.bendPoints, ...b.bendPoints]) === snapshot(original.connectors[0].bendPoints), 'manual waypoints partition without duplication/loss')
    check(a.style === 'elbow' && b.style === 'elbow' && G.connectorGeometry(a, command.board.nodes).manual && G.connectorGeometry(b, command.board.nodes).manual, 'manual routing remains editable')
    check(close(G.connectorGeometry(a, command.board.nodes).source, G.connectorGeometry(original.connectors[0], original.nodes).source) && close(G.connectorGeometry(b, command.board.nodes).target, G.connectorGeometry(original.connectors[0], original.nodes).target), 'outside painted endpoints remain exact')
  })
  await group('automatic curve split and inherited group semantics', () => {
    const original = board([{ ...leaf('owner'), kind: 'group', width: 800, height: 600 }, leaf('a', { x: 10, y: 100, groupId: 'owner' }), leaf('b', { x: 600, y: 300, groupId: 'owner' })], [edge({ style: 'curve', sourceId: 'a', targetId: 'b', sourcePoint: undefined, targetPoint: undefined, sourcePortMode: 'adaptive', targetPortMode: 'adaptive' })])
    const command = ok(C.insertDiagramNodeOnConnectorResult(original, inserted({ node: { id: 'inserted', shape: 'document' } })))
    check(command.board.nodes.at(-1).groupId === 'owner', 'shared group inherited')
    check(command.board.connectors.every((connection) => connection.style === 'curve' && G.connectorGeometry(connection, command.board.nodes)), 'two resolved auto curves retain route style')
    check(command.board.connectors[0].sourcePortMode === 'adaptive' && command.board.connectors[1].targetPortMode === 'adaptive', 'outside adaptive modes survive')
  })
  await group('ten-node branching map one-command journal/JSON/reload', async () => {
    let current = board(), undo = [], redo = []
    for (let index = 0; index < 10; index++) {
      const before = current, result = index === 0 ? C.createDiagramNodeResult(current, { id: 'node-0', shape: 'start-end', center: { x: 100, y: 100 } }) : C.createConnectedSuccessorResult(current, { sourceId: `node-${Math.floor((index - 1) / 2)}`, node: { id: `node-${index}`, shape: index % 3 === 0 ? 'decision' : 'process', title: `Step ${index}` }, connectorId: `edge-${index}` })
      current = ok(result).board; H.recordNativeCommand(undo, redo, before, current)
      check(snapshot(H.undoNativeCommand(undo, redo)) === snapshot(before), 'one command Undo returns exact before snapshot')
      check(snapshot(H.redoNativeCommand(undo, redo)) === snapshot(current), 'one command Redo returns exact after snapshot')
    }
    check(current.nodes.length === 10 && current.connectors.length === 9 && new Set([...current.nodes, ...current.connectors].map((entry) => entry.id)).size === 19, 'branching 10-node identity fixture')
    check(snapshot(JSON.parse(snapshot(current))) === snapshot(current), 'save/reload exact IDs/geometry/routes/labels')
    await writeFile(resolve(output, 'ten-node-flow.json'), JSON.stringify(current, null, 2))
  })
  await group('read-only/inherited lock/visibility/identity refusal is atomic', () => {
    const original = board([{ ...leaf('owner'), kind: 'group', locked: true }, leaf('source', { groupId: 'owner' }), leaf('target', { x: 600 })], [edge({ sourceId: 'source', targetId: 'target', sourcePoint: undefined, targetPoint: undefined })]), before = snapshot(original)
    const commands = [
      () => C.createDiagramNodeResult(original, { id: 'new', shape: 'process', center: { x: 10, y: 10 } }, { readOnly: true }),
      () => C.createDiagramNodeResult(original, { id: 'new', shape: 'process', center: { x: 10, y: 10 } }, { ownerId: 'owner' }),
      () => C.createConnectedSuccessorResult(original, { sourceId: 'source', node: { id: 'new', shape: 'process' }, connectorId: 'fresh' }),
      () => C.insertDiagramNodeOnConnectorResult(original, inserted()),
      () => C.createDiagramNodeResult(original, { id: 'target', shape: 'process', center: { x: 10, y: 10 } }),
      () => C.createDiagramNodeResult(original, { id: 'new', shape: 'process', center: { x: NaN, y: 10 } }),
      () => C.insertDiagramNodeOnConnectorResult(board([], [edge()]), inserted({ fraction: 0 })),
      () => C.insertDiagramNodeOnConnectorResult(board([], [edge({ mindMap: { treeId: 'tree' } })]), inserted()),
    ]
    for (const run of commands) { const result = run(); check(!result.ok && result.issues[0].detail.length > 5, 'actionable refusal'); check(snapshot(original) === before, 'refusal input retained') }
    for (const property of ['collapsed', 'hidden']) {
      const hidden = board([{ ...leaf('owner'), kind: 'group', [property]: true }, leaf('source', { groupId: 'owner' })])
      check(!C.createConnectedSuccessorResult(hidden, { sourceId: 'source', node: { id: 'new', shape: 'text' }, connectorId: 'new-edge' }).ok, 'inherited hidden/collapse refusal')
    }
  })
  report.sourceHashesAtEnd = await hashes(); assert.deepEqual(report.sourceHashesAtEnd, report.sourceHashes)
  report.passed = true
} catch (error) { report.failure = { message: error.message, stack: error.stack?.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[production module]') }; process.exitCode = 1 }
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, checks: report.checks, groups: report.groups, failure: report.failure, report: resolve(output, 'report.json') }, null, 2))
