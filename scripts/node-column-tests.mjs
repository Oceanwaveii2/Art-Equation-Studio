import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

// Bundle the actual production command and its imports. This tests the same
// validation boundary used by the app without creating a second graph model.
const appDir = fileURLToPath(new URL('..', import.meta.url))
const sourceDir = join(appDir, 'src')
const tempDir = await mkdtemp(join(appDir, '.tmp-node-column-tests-'))
const compiled = new Set()
async function compileModule(sourcePath) {
  const destination = join(tempDir, relative(sourceDir, sourcePath)).replace(/\.ts$/, '.mjs')
  if (compiled.has(sourcePath)) return destination
  compiled.add(sourcePath)
  await mkdir(dirname(destination), { recursive: true })
  let code = ts.transpileModule(await readFile(sourcePath, 'utf8'), { fileName: sourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  const dependencies = []
  code = code.replace(/(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (_whole, begin, specifier, end) => {
    const dependency = resolve(dirname(sourcePath), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`)
    dependencies.push(dependency)
    return `${begin}${specifier.replace(/\.ts$/, '')}.mjs${end}`
  })
  await writeFile(destination, code)
  await Promise.all(dependencies.map(compileModule))
  return destination
}
let commands, columns
try {
  commands = await import(pathToFileURL(await compileModule(join(sourceDir, 'board', 'nodeColumnCommands.ts'))).href)
  columns = await import(pathToFileURL(await compileModule(join(sourceDir, 'board', 'columns.ts'))).href)
}
catch (error) { await rm(tempDir, { recursive: true, force: true }); throw error }
try {
const check = (result) => { assert.equal(result.ok, true, result.ok ? '' : result.issues[0]?.detail); return result.value }
const board = { id: 'fixture', title: 'Node Column test', viewport: { x: 0, y: 0, scale: 1 }, nodes: [], connectors: [] }
const column = (id, x) => ({ id, kind: 'column', x, y: 10, width: 290, height: 150, title: id, color: '#526575' })
const image = (id, owner, assetId, x) => ({ id, kind: 'image', x, y: 78, width: 270, height: 180, title: id, assetId, parentColumnId: owner, columnOrder: 0,
  imageTransform: { fit: 'cover', zoom: 1.25, positionX: 30, positionY: 48 } })
const ordinary = column('plain', 30)
const nodeA = column('graph-a', 400), nodeB = column('graph-b', 810)
let current = { ...board, nodes: [ordinary] }
current = check(commands.createNodeColumnResult(current, nodeA))
current = check(commands.createNodeColumnResult(current, nodeB))
assert.equal(commands.isNodeColumn(current.nodes[0]), false, 'Existing columns must not acquire graph behavior')
assert.equal(commands.isNodeColumn(current.nodes[1]), true)
current = { ...current, nodes: [...current.nodes, image('card-a', nodeA.id, 'original-a', 410), image('card-b', nodeB.id, 'original-b', 820)] }
const beforeAssets = current.nodes.filter(node => node.kind === 'image').map(node => [node.assetId, node.imageTransform])
assert.deepEqual(commands.nodeGraphPorts(current, current.nodes[0]), [], 'Ordinary Column has no graph sockets')
assert(commands.nodeGraphPorts(current, current.nodes[3]).some(port => port.key === 'ref-right'))
const historyBefore = current
current = check(commands.connectNodeGraphPortsResult(current, { id: 'edge-1', sourceId: 'card-a', sourceSocket: 'ref-right', targetId: 'card-b', targetSocket: 'ref-left' }))
assert.equal(current.connectors.length, 1)
assert.equal(historyBefore.connectors.length, 0, 'Connection command leaves its history baseline untouched')
assert.equal(current.connectors[0].nodeGraph.kind, 'reference')
assert.equal(current.connectors[0].sourcePort, 'right')
assert.equal(current.connectors[0].targetPort, 'left')
assert.equal(commands.hasConnectedNodeGraphEdges(current, ['card-a']), true, 'Grouping a connected child must be guarded')
assert.equal(commands.hasConnectedNodeGraphEdges(current, ['plain']), false)
const detachedCopy = { ...current, nodes: current.nodes.filter(node => node.id !== 'card-a' && node.id !== 'card-b').concat([
  { ...current.nodes.find(node => node.id === 'card-a'), id: 'copied-a', parentColumnId: undefined },
  { ...current.nodes.find(node => node.id === 'card-b'), id: 'copied-b', parentColumnId: undefined },
]) }
const copiedEdge = { ...current.connectors[0], id: 'copied-edge', sourceId: 'copied-a', targetId: 'copied-b' }
assert.equal(commands.retainPastedNodeGraphConnectors(detachedCopy, [copiedEdge]).length, 0, 'Partial clipboard cannot persist a typed edge without Node Column owners')
assert.equal(commands.retainPastedNodeGraphConnectors(detachedCopy, [{ ...copiedEdge, nodeGraph: undefined }]).length, 1, 'Ordinary pasted edges are unchanged')
const ownedCopy = { ...detachedCopy, nodes: detachedCopy.nodes.map(node => node.id === 'copied-a' ? { ...node, parentColumnId: nodeA.id }
  : node.id === 'copied-b' ? { ...node, parentColumnId: nodeB.id } : node) }
assert.equal(commands.retainPastedNodeGraphConnectors(ownedCopy, [copiedEdge]).length, 1, 'Whole-column copy retains typed edges')
const rotated = { ...current, nodes: current.nodes.map(node => node.id === 'card-a' ? { ...node, rotation: 90 } : node) }
const rotatedPort = commands.nodeGraphPortPosition(rotated, 'card-a', 'ref-right')
assert(Math.abs(rotatedPort.x - (rotated.nodes.find(node => node.id === 'card-a').x + 135)) < 1e-6)
assert(Math.abs(rotatedPort.y - (rotated.nodes.find(node => node.id === 'card-a').y + 225)) < 1e-6, 'Socket draft position follows rotated card geometry')
assert.deepEqual(current.nodes.filter(node => node.kind === 'image').map(node => [node.assetId, node.imageTransform]), beforeAssets, 'Original assets and fit transforms survive graph commands')
assert.equal(columns.releaseNodesFromColumnsResult(current, ['card-a']).ok, false, 'A connected typed card cannot silently lose its sockets')
assert.equal(columns.insertNodesIntoColumnResult(current, ['card-a'], { columnId: 'plain', index: 0 }).ok, false, 'Regular Columns do not silently take typed edges')
assert.equal(columns.insertNodesIntoColumnResult({ ...current, connectors: [] }, ['card-a'], { columnId: 'plain', index: 0 }).ok, true, 'Regular Column row insertion remains compatible')
assert.equal(commands.connectNodeGraphPortsResult(current, { id: 'edge-2', sourceId: 'card-a', sourceSocket: 'ref-right', targetId: 'card-b', targetSocket: 'ref-left' }).ok, false, 'Duplicate socket edge refused')
assert.equal(commands.connectNodeGraphPortsResult(current, { id: 'edge-3', sourceId: 'plain', sourceSocket: 'ref-right', targetId: 'card-b', targetSocket: 'ref-left' }).ok, false, 'Plain Column cannot act as typed source')
assert.equal(commands.connectNodeGraphPortsResult(current, { id: 'edge-4', sourceId: 'card-a', sourceSocket: 'ref-right', targetId: 'card-a', targetSocket: 'ref-left' }).ok, false, 'Self edge refused')
assert.equal(commands.setNodeGraphRoleResult(current, 'card-a', 'continuity').ok, false, 'Role changes cannot silently invalidate saved edges')
const roundTrip = JSON.parse(JSON.stringify(current))
assert.equal(commands.isNodeColumn(roundTrip.nodes[1]), true)
assert.equal(commands.nodeGraphPort(roundTrip, 'card-a', roundTrip.connectors[0].nodeGraph.sourceSocket).side, 'right')
assert.deepEqual(roundTrip.nodes.filter(node => node.kind === 'image').map(node => [node.assetId, node.imageTransform]), beforeAssets)
const styled = JSON.parse(JSON.stringify({ ...current, connectors: current.connectors.map(edge => ({ ...edge, color: '#62c3d2', label: 'Evidence', bendPoints: [{ x: 600, y: 200 }] })) }))
assert.equal(styled.connectors[0].nodeGraph.sourceSocket, 'ref-right', 'Visual connector edits retain typed endpoints')
assert.equal(styled.connectors[0].label, 'Evidence')
let roleBoard = board
roleBoard = check(commands.createNodeColumnResult(roleBoard, nodeA))
roleBoard = check(commands.createNodeColumnResult(roleBoard, nodeB))
roleBoard = { ...roleBoard, nodes: [...roleBoard.nodes, image('source', nodeA.id, 'original-a', 410), image('target', nodeB.id, 'original-b', 820)] }
roleBoard = check(commands.setNodeGraphRoleResult(roleBoard, 'source', 'continuity'))
roleBoard = check(commands.setNodeGraphRoleResult(roleBoard, 'target', 'branch'))
roleBoard = check(commands.connectNodeGraphPortsResult(roleBoard, { id: 'semantic-edge', sourceId: 'source', sourceSocket: 'cout', targetId: 'target', targetSocket: 'bin' }))
assert.equal(roleBoard.connectors[0].nodeGraph.kind, 'continuity')
assert.equal(commands.connectNodeGraphPortsResult(roleBoard, { id: 'invalid-direction', sourceId: 'source', sourceSocket: 'cin', targetId: 'target', targetSocket: 'bin' }).ok, false)
assert.equal(commands.connectNodeGraphPortsResult(roleBoard, { id: 'invalid-semantic', sourceId: 'source', sourceSocket: 'cout', targetId: 'target', targetSocket: 'cout' }).ok, false)
let identityBoard = { ...roleBoard, connectors: [] }
identityBoard = check(commands.setNodeGraphRoleResult(identityBoard, 'source', 'reference'))
identityBoard = check(commands.setNodeGraphRoleResult(identityBoard, 'target', 'identity'))
assert.equal(commands.connectNodeGraphPortsResult(identityBoard, { id: 'invalid-identity', sourceId: 'source', sourceSocket: 'ref-right', targetId: 'target', targetSocket: 'idin' }).ok, false)
const replaced = check(commands.reconnectNodeGraphPortResult(roleBoard, 'semantic-edge', 'target', 'target', 'bin'))
assert.deepEqual(replaced.connectors[0], roleBoard.connectors[0], 'Reattaching to the same socket is identity preserving')
console.log(JSON.stringify({ status: 'passed', scope: 'Production Node Column commands and canonical board roundtrip' }))
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
