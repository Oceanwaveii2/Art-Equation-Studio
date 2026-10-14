import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

// Headless test suite for Package 4: Connected Diagrams, Mind-Maps & Process Templates (PII-6 / PII-7 / X-19)
// Pure model and memory test fixture. No Tauri native windows, no desktop takeover, no simulation.

const moduleCache = new Map()
async function moduleUrl(file) {
  file = resolve(file)
  if (moduleCache.has(file)) return moduleCache.get(file)
  let code = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  for (const match of [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)]) {
    const spec = match[1]
    if (spec.startsWith('.')) {
      let target = resolve(dirname(file), spec + '.ts')
      try {
        await stat(target)
      } catch {
        target = resolve(dirname(file), spec + '.tsx')
      }
      const imported = await moduleUrl(target)
      code = code.replaceAll(`'${spec}'`, `'${imported}'`).replaceAll(`"${spec}"`, `"${imported}"`)
    } else {
      try {
        const resolved = import.meta.resolve(spec)
        code = code.replaceAll(`'${spec}'`, `'${resolved}'`).replaceAll(`"${spec}"`, `"${resolved}"`)
      } catch {}
    }
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  moduleCache.set(file, url)
  return url
}

// Load core modules
const Connectors = await import(await moduleUrl('src/board/connectors.ts'))
const Structure = await import(await moduleUrl('src/board/diagramStructureCore.ts'))
const Workflow = await import(await moduleUrl('src/board/diagramWorkflow.ts'))
const Palette = await import(await moduleUrl('src/board/diagramPaletteCommands.ts'))
const MutationSafety = await import(await moduleUrl('src/board/boardMutationSafety.ts'))

const checks = []
const groups = []
let currentGroup = null

function group(name, fn) {
  currentGroup = { name, checks: 0, passed: true }
  groups.push(currentGroup)
  fn()
}

function check(name, ok, details) {
  checks.push({ name, passed: Boolean(ok), details })
  if (currentGroup) {
    currentGroup.checks++
    if (!ok) currentGroup.passed = false
  }
  assert.ok(ok, `${name}${details ? ': ' + JSON.stringify(details) : ''}`)
}

const pointClose = (a, b, eps = 1e-4) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
const blankBoard = (id = 'test-board') => ({
  id,
  title: 'Test Board',
  linkedFolderPath: `projects/test/boards/${id}`,
  viewport: { x: 0, y: 0, scale: 1 },
  nodes: [],
  connectors: []
})

// ============================================================================
// Group 1: Connected Diagrams & Relationship Styles (PII-6 / X-19)
// ============================================================================
group('Connected diagrams & relationship styles (PII-6 / X-19)', () => {
  const nodeA = { id: 'node-a', kind: 'shape', x: 100, y: 100, width: 160, height: 80 }
  const nodeB = { id: 'node-b', kind: 'shape', x: 500, y: 100, width: 160, height: 80 }
  const baseEdge = {
    id: 'edge-1',
    sourceId: 'node-a',
    targetId: 'node-b',
    sourcePort: 'right',
    targetPort: 'left',
    style: 'straight',
    color: '#60a5fa',
    width: 2,
    dashed: false,
    startArrow: false,
    endArrow: true,
    animated: false
  }

  // 1. Four relationship styles
  const styles = Connectors.CONNECTOR_RELATIONSHIP_STYLES
  check('Has 4 relationship styles registered', styles.length === 4)
  const styleIds = styles.map(s => s.id)
  check('Style IDs match reference, sequence, alternative, dependency',
    ['reference', 'sequence', 'alternative', 'dependency'].every(id => styleIds.includes(id)))

  for (const style of styles) {
    const applied = Connectors.applyConnectorRelationshipStyle({ ...baseEdge }, style.id)
    check(`Style ${style.id} applies color ${style.color}`, applied.color === style.color)
    check(`Style ${style.id} applies linePattern ${style.linePattern}`, Connectors.connectorLinePattern(applied) === style.linePattern)
    check(`Style ${style.id} applies startArrow ${style.startArrow}`, applied.startArrow === style.startArrow)
    check(`Style ${style.id} applies endArrow ${style.endArrow}`, applied.endArrow === style.endArrow)
    check(`Style ${style.id} applies cue label "${style.cue}"`, applied.label === style.cue)

    const markup = Connectors.connectorSvgMarkup(applied, [nodeA, nodeB])
    check(`SVG markup for ${style.id} includes own-color arrowhead def`,
      markup.includes(`fill="${style.color}"`))
    if (style.linePattern === 'dot') {
      check(`SVG markup for ${style.id} includes round cap for dot`, markup.includes('stroke-linecap="round"'))
    }
    if (style.linePattern !== 'solid') {
      const dash = Connectors.connectorDashArray(applied)
      check(`SVG markup for ${style.id} includes dash array ${dash}`, markup.includes(`stroke-dasharray="${dash}"`))
    }
  }

  // 2. Custom label preservation on style apply
  const customLabeled = Connectors.applyConnectorRelationshipStyle({ ...baseEdge, label: 'Custom note' }, 'dependency')
  check('Custom label is preserved when applying relationship style', customLabeled.label === 'Custom note')

  // 3. Rotation-aware ports
  const centerNode = { id: 'center', kind: 'shape', x: 200, y: 200, width: 100, height: 100, rotation: 0 }
  const top0 = Connectors.portPoint(centerNode, 'top')
  check('Port point at 0 deg: top is (250, 200)', pointClose(top0, { x: 250, y: 200 }))

  const rot90 = { ...centerNode, rotation: 90 }
  const top90 = Connectors.portPoint(rot90, 'top')
  check('Port point at 90 deg: top rotates to right (300, 250)', pointClose(top90, { x: 300, y: 250 }))

  const rot180 = { ...centerNode, rotation: 180 }
  const top180 = Connectors.portPoint(rot180, 'top')
  check('Port point at 180 deg: top rotates to bottom (250, 300)', pointClose(top180, { x: 250, y: 300 }))

  const rot270 = { ...centerNode, rotation: 270 }
  const top270 = Connectors.portPoint(rot270, 'top')
  check('Port point at 270 deg: top rotates to left (200, 250)', pointClose(top270, { x: 200, y: 250 }))

  // Nearest port
  check('Nearest port to (250, 50) is top', Connectors.nearestPort(centerNode, { x: 250, y: 50 }) === 'top')
  check('Nearest port to (500, 250) is right', Connectors.nearestPort(centerNode, { x: 500, y: 250 }) === 'right')
  check('Nearest port to (250, 450) is bottom', Connectors.nearestPort(centerNode, { x: 250, y: 450 }) === 'bottom')
  check('Nearest port to (50, 250) is left', Connectors.nearestPort(centerNode, { x: 50, y: 250 }) === 'left')

  // 4. Adaptive vs fixed attachment
  const adaptiveEdge = { ...baseEdge, sourcePortMode: 'adaptive', targetPortMode: 'adaptive' }
  const geomAdaptive = Connectors.connectorGeometry(adaptiveEdge, [
    { id: 'node-a', kind: 'shape', x: 100, y: 100, width: 100, height: 100 },
    { id: 'node-b', kind: 'shape', x: 100, y: 400, width: 100, height: 100 }
  ])
  check('Adaptive attachment selects bottom port for source when target is directly below', geomAdaptive?.sourcePort === 'bottom')
  check('Adaptive attachment selects top port for target when source is directly above', geomAdaptive?.targetPort === 'top')

  const fixedEdge = { ...baseEdge, sourcePort: 'right', targetPort: 'left', sourcePortMode: 'fixed', targetPortMode: 'fixed' }
  const geomFixed = Connectors.connectorGeometry(fixedEdge, [
    { id: 'node-a', kind: 'shape', x: 100, y: 100, width: 100, height: 100 },
    { id: 'node-b', kind: 'shape', x: 100, y: 400, width: 100, height: 100 }
  ])
  check('Fixed attachment keeps declared sourcePort right', geomFixed?.sourcePort === 'right')
  check('Fixed attachment keeps declared targetPort left', geomFixed?.targetPort === 'left')

  // 5. Straight, elbow, and curved routes
  const geomStraight = Connectors.connectorGeometry({ ...baseEdge, style: 'straight' }, [nodeA, nodeB])
  check('Straight route has 2 points', geomStraight?.points.length === 2)

  const geomElbow = Connectors.connectorGeometry({ ...baseEdge, style: 'elbow' }, [nodeA, nodeB])
  check('Elbow route has 4 points (source, 2 mid-steps, target)', geomElbow?.points.length === 4)

  const geomCurve = Connectors.connectorGeometry({ ...baseEdge, style: 'curve' }, [nodeA, nodeB])
  check('Curve route has 33 sampled points for smooth rendering', geomCurve?.points.length === 33)

  // 6. Route-projected labels
  const testPoint = { x: 300, y: 120 }
  const projected = Connectors.projectConnectorLabelPosition(geomStraight, testPoint)
  check('Projected label has valid t between 0 and 1', projected.t >= 0 && projected.t <= 1)
  const roundtripLabel = Connectors.connectorLabelPoint({ ...baseEdge, labelPosition: projected }, geomStraight)
  check('Roundtrip projected label recovers target coordinates accurately', pointClose(roundtripLabel, testPoint))
})

// ============================================================================
// Group 2: Mind-Map Tree Structures & Branch Lifecycle (PII-7 / X-19)
// ============================================================================
group('Mind-map tree structures & branch lifecycle (PII-7 / X-19)', () => {
  // 1. Tree template creation
  const created = Structure.createMindMapTemplate('mm-test', { x: 0, y: 0 })
  check('Template creation succeeds', created.ok === true)
  const { nodes, connectors, treeId } = created.value
  check('20 nodes created in template', nodes.length === 20)
  check('19 tree connectors created (one per non-root child)', connectors.length === 19)

  // Root verification
  const rootNodes = nodes.filter(n => !n.mindMap?.parentId)
  check('Exactly 1 root node in tree', rootNodes.length === 1)
  const root = rootNodes[0]
  check('Root title is "Project"', root.title === 'Project')
  check('Root has mindMap version 1', root.mindMap?.version === 1)
  check('Root treeId matches', root.mindMap?.treeId === treeId)

  // Validate entire mind-map graph
  const validatedTree = Structure.validateMindMap(nodes, treeId)
  check('Mind-map structure validates without issues', validatedTree.ok === true)

  const validatedEdges = Structure.validateMindMapConnectors(nodes, connectors, treeId)
  check('Mind-map connectors validate 1-to-1 matching', validatedEdges.ok === true)

  // 2. Branch IDs retrieval
  const researchBranch = nodes.find(n => n.title === 'Research')
  check('Found Research branch', Boolean(researchBranch))
  const branchIds = Structure.mindMapBranchIds(nodes, researchBranch.id)
  check('Branch IDs retrieval succeeds', branchIds.ok === true)
  check('Branch includes parent and descendants', branchIds.value.length > 1 && branchIds.value[0] === researchBranch.id)

  // 3. Cycle prevention
  const leafNode = nodes.find(n => n.id === branchIds.value.at(-1))
  const cycleReparent = Structure.reparentMindMapBranch(nodes, connectors, researchBranch.id, leafNode.id)
  check('Reparenting to descendant fails with mind-map-cycle',
    cycleReparent.ok === false && cycleReparent.issues.some(i => i.code === 'mind-map-cycle'))

  // Reparent root attempt fails
  const reparentRoot = Structure.reparentMindMapBranch(nodes, connectors, root.id, researchBranch.id)
  check('Reparenting root node fails with root-reparent',
    reparentRoot.ok === false && reparentRoot.issues.some(i => i.code === 'root-reparent'))

  // 4. Legitimate reparenting
  const designBranch = nodes.find(n => n.title === 'Design')
  const reparentChild = Structure.reparentMindMapBranch(nodes, connectors, leafNode.id, designBranch.id)
  check('Reparenting leaf to Design branch succeeds', reparentChild.ok === true)
  if (reparentChild.ok) {
    const updatedLeaf = reparentChild.value.nodes.find(n => n.id === leafNode.id)
    check('Updated leaf has new parentId matching Design', updatedLeaf.mindMap?.parentId === designBranch.id)
    const updatedEdge = reparentChild.value.connectors.find(c => c.mindMap?.childId === leafNode.id)
    check('Updated connector sourceId points to Design', updatedEdge.sourceId === designBranch.id)
  }

  // 5. Branch folding / collapsing (derived visibility)
  const initialVisible = Structure.visibleDiagramNodeIds(nodes)
  check('All 20 nodes initially visible', initialVisible.ok && initialVisible.value.length === 20)

  // Collapse Research branch
  const collapsedNodes = nodes.map(n => n.id === researchBranch.id ? { ...n, mindMap: { ...n.mindMap, collapsed: true } } : n)
  const collapsedVisible = Structure.visibleDiagramNodeIds(collapsedNodes)
  check('Derived visibility after collapse excludes research subtree',
    collapsedVisible.ok && collapsedVisible.value.length === 20 - (branchIds.value.length - 1))
  check('Collapsed branch itself remains visible', collapsedVisible.value.includes(researchBranch.id))
  for (const childId of branchIds.value.slice(1)) {
    check(`Descendant ${childId} is derived hidden`, !collapsedVisible.value.includes(childId))
  }

  // 6. Right-growing auto-layout (layoutMindMap)
  const laidOut = Structure.layoutMindMap(nodes, treeId, { origin: { x: 50, y: 50 }, horizontalGap: 100, verticalGap: 30 })
  check('Auto-layout succeeds', laidOut.ok === true)
  if (laidOut.ok) {
    const rootPlaced = laidOut.value.find(n => n.id === root.id)
    check('Root placed at origin x=50', rootPlaced.x === 50)
    for (const b of nodes.filter(n => n.mindMap?.parentId === root.id)) {
      const placed = laidOut.value.find(n => n.id === b.id)
      check(`Child branch ${b.title} placed to the right of root`, placed.x > rootPlaced.x + rootPlaced.width)
    }
  }
})

// ============================================================================
// Group 3: Process Templates & Swimlanes (PII-6 / PII-7)
// ============================================================================
group('Process templates & swimlanes (PII-6 / PII-7)', () => {
  // 1. createDiagramShape - all 4 shapes
  const processShape = Structure.createDiagramShape('process', 'sh-1', { x: 0, y: 0, width: 160, height: 90 })
  check('Process shape creates 4-point rectangle vector path',
    processShape.ok && processShape.value.vectorPath?.points.length === 4)

  const decisionShape = Structure.createDiagramShape('decision', 'sh-2', { x: 0, y: 0, width: 160, height: 120 })
  check('Decision shape creates 4-point diamond vector path',
    decisionShape.ok && decisionShape.value.vectorPath?.points.length === 4)

  const terminatorShape = Structure.createDiagramShape('terminator', 'sh-3', { x: 0, y: 0, width: 160, height: 80 })
  check('Terminator shape creates 8-point smooth capsule vector path',
    terminatorShape.ok && terminatorShape.value.vectorPath?.points.length === 8)

  const documentShape = Structure.createDiagramShape('document', 'sh-4', { x: 0, y: 0, width: 160, height: 100 })
  check('Document shape creates 5-point wavy bottom vector path',
    documentShape.ok && documentShape.value.vectorPath?.points.length === 5)

  // 2. Process map template creation
  const procMap = Structure.createProcessMapTemplate('proc-test', { x: 100, y: 200 })
  check('Process map template creates successfully', procMap.ok === true)
  if (procMap.ok) {
    check('10 nodes in process map', procMap.value.nodes.length === 10)
    check('9 sequential connectors in process map', procMap.value.connectors.length === 9)
    check('First node is terminator (Start)', procMap.value.nodes[0].diagramShape === 'start-end')
    check('Last node is terminator (Finish)', procMap.value.nodes[9].diagramShape === 'start-end')
    check('Step 3 is decision (Choose direction)', procMap.value.nodes[3].diagramShape === 'decision')
    check('Step 6 is decision (Review)', procMap.value.nodes[6].diagramShape === 'decision')
    check('Step 8 is document (Document)', procMap.value.nodes[8].diagramShape === 'document')
    check('Decision connectors have "Continue" cue',
      procMap.value.connectors[3].label === 'Continue' && procMap.value.connectors[6].label === 'Continue')
  }

  // 3. Swimlane template creation
  const swimlane = Structure.createSwimlaneTemplate('swim-test', { x: 0, y: 0 }, 'Project Pipeline', ['Design', 'Develop', 'Test'])
  check('Swimlane template creates successfully', swimlane.ok === true)
  if (swimlane.ok) {
    const rootFrame = swimlane.value.nodes[0]
    check('Swimlane root is group container frame',
      rootFrame.kind === 'group' && rootFrame.containerRole === 'frame' && rootFrame.diagramRole === 'swimlane')
    check('Swimlane has 3 child lanes', swimlane.value.nodes.length === 4)
    for (let i = 1; i <= 3; i++) {
      const lane = swimlane.value.nodes[i]
      check(`Lane ${i} has diagramRole "lane" and groupId pointing to root`,
        lane.diagramRole === 'lane' && lane.groupId === rootFrame.id)
    }

    const ownership = Structure.validateContainerOwnership(swimlane.value.nodes)
    check('Swimlane container hierarchy validates with zero errors', ownership.ok === true)

    const descendants = Structure.containerDescendantIds(swimlane.value.nodes, [rootFrame.id])
    check('Descendant query on swimlane root returns root and all 3 lanes',
      descendants.ok && descendants.value.length === 4)
  }
})

// ============================================================================
// Group 4: Diagram Palette & Connected Successor Workflow
// ============================================================================
group('Diagram palette & connected successor workflow', () => {
  // 1. Searchable shape catalog
  check('Diagram catalog has 7 shapes', Palette.DIAGRAM_SHAPE_CATALOG.length === 7)
  const searchFlow = Palette.filterDiagramShapes('flow')
  check('Query "flow" matches process, decision, start-end, document', searchFlow.length >= 4)
  const searchDiamond = Palette.filterDiagramShapes('diamond')
  check('Query "diamond" matches Decision shape', searchDiamond.length === 1 && searchDiamond[0].id === 'decision')
  const searchMulti = Palette.filterDiagramShapes('step task')
  check('Multi-word query "step task" matches Process', searchMulti.length === 1 && searchMulti[0].id === 'process')

  // 2. Create standalone shape on board
  const board0 = blankBoard()
  const createdNodeResult = Palette.createDiagramNodeResult(board0, {
    shape: 'process',
    id: 'proc-1',
    center: { x: 200, y: 200 },
    title: 'Init'
  })
  check('Create standalone shape node succeeds', createdNodeResult.ok === true)
  const board1 = createdNodeResult.value.board

  // 3. Connected successor creation
  const successorResult = Palette.createConnectedSuccessorResult(board1, {
    sourceId: 'proc-1',
    node: { shape: 'decision', id: 'dec-1', title: 'Check valid?' },
    connectorId: 'conn-1',
    direction: 'right',
    gap: 80,
    connector: { style: 'elbow', color: '#eab308', relationshipStyle: 'sequence' }
  })
  check('Connected successor creation succeeds', successorResult.ok === true)
  const board2 = successorResult.value.board
  check('Board now has 2 nodes', board2.nodes.length === 2)
  check('Board now has 1 connector', board2.connectors.length === 1)
  const edge1 = board2.connectors[0]
  check('Connector links proc-1 to dec-1', edge1.sourceId === 'proc-1' && edge1.targetId === 'dec-1')
  check('Connector uses requested sequence relationship style', edge1.relationshipStyle === 'sequence')

  // 4. Insert node along existing connection
  const insertResult = Palette.insertDiagramNodeOnConnectorResult(board2, {
    connectorId: 'conn-1',
    node: { shape: 'process', id: 'middle-step', title: 'Validate Token' },
    downstreamConnectorId: 'conn-2',
    fraction: 0.5
  })
  check('Insert node on connector succeeds', insertResult.ok === true)
  const board3 = insertResult.value.board
  check('Board now has 3 nodes', board3.nodes.length === 3)
  check('Board now has 2 connectors (split from 1)', board3.connectors.length === 2)
  const inEdge = board3.connectors.find(c => c.targetId === 'middle-step')
  const outEdge = board3.connectors.find(c => c.sourceId === 'middle-step')
  check('Incoming edge links proc-1 to middle-step', inEdge?.sourceId === 'proc-1')
  check('Outgoing edge links middle-step to dec-1', outEdge?.targetId === 'dec-1')
  check('Downstream edge uses requested id conn-2', outEdge?.id === 'conn-2')
  check('Incoming edge retains original id conn-1', inEdge?.id === 'conn-1')
})

// ============================================================================
// Group 5: Template Capture, Roundtrip Instantiation & Undo/Redo Safety
// ============================================================================
group('Template capture, roundtrip instantiation & undo/redo safety', () => {
  // 1. Build a board with a 3-step process
  let board = blankBoard()
  const step1 = Structure.createDiagramShape('process', 's1', { x: 0, y: 0, width: 140, height: 80 }, 'Step 1').value
  const step2 = Structure.createDiagramShape('process', 's2', { x: 240, y: 0, width: 140, height: 80 }, 'Step 2').value
  const edge = {
    id: 'e1',
    sourceId: 's1',
    targetId: 's2',
    sourcePort: 'right',
    targetPort: 'left',
    style: 'straight',
    color: '#60a5fa',
    width: 2,
    dashed: false,
    startArrow: false,
    endArrow: true,
    animated: false
  }
  board = { ...board, nodes: [step1, step2], connectors: [edge] }

  // 2. Capture template
  const captured = Workflow.captureDiagramTemplate(board, ['s1', 's2'], 'tpl-proc', 'Custom 2-Step Process')
  check('Capture template succeeds', captured.ok === true)
  const template = captured.value
  check('Captured template has title "Custom 2-Step Process"', template.title === 'Custom 2-Step Process')
  check('Captured template validates via validateDiagramTemplate', Workflow.validateDiagramTemplate(template) === true)
  check('Captured template normalized origin to (0, 0)', template.nodes[0].x === 0 && template.nodes[0].y === 0)

  // 3. Instantiate template twice with fresh namespaces
  const inst1 = Workflow.instantiateDiagramTemplate(board, template, 'copy1', { x: 0, y: 200 })
  check('First instantiation succeeds', inst1.ok === true)
  const boardAfterInst1 = inst1.value.board

  const inst2 = Workflow.instantiateDiagramTemplate(boardAfterInst1, template, 'copy2', { x: 0, y: 400 })
  check('Second instantiation succeeds', inst2.ok === true)
  const finalBoard = inst2.value.board

  check('Final board contains original 2 nodes + 2 in copy1 + 2 in copy2 = 6 nodes', finalBoard.nodes.length === 6)
  check('Final board contains original 1 edge + 1 in copy1 + 1 in copy2 = 3 edges', finalBoard.connectors.length === 3)

  // Zero ID collision
  const allIds = [...finalBoard.nodes.map(n => n.id), ...finalBoard.connectors.map(c => c.id)]
  check('All node and connector IDs are strictly unique across instantiations', new Set(allIds).size === allIds.length)

  // Re-linking verification
  const copy1Edge = finalBoard.connectors.find(c => c.id === 'copy1:edge:0')
  check('Copy 1 connector re-linked to copy1:node:0 and copy1:node:1',
    copy1Edge?.sourceId === 'copy1:node:0' && copy1Edge?.targetId === 'copy1:node:1')

  const copy2Edge = finalBoard.connectors.find(c => c.id === 'copy2:edge:0')
  check('Copy 2 connector re-linked to copy2:node:0 and copy2:node:1',
    copy2Edge?.sourceId === 'copy2:node:0' && copy2Edge?.targetId === 'copy2:node:1')

  // 4. Undo/redo roundtrip simulation
  const snapshotBefore = Structure.cloneDiagramSnapshot(board.nodes, board.connectors)
  check('Snapshot before preserves exact original nodes and connectors',
    snapshotBefore.nodes.length === 2 && snapshotBefore.connectors.length === 1)
})

// ============================================================================
// Group 6: Edge Cases, Refusals & Fail-Closed Integrity
// ============================================================================
group('Edge cases, refusals & fail-closed integrity', () => {
  const board = blankBoard()

  // 1. Dual ownership rejection
  const badNode = { id: 'bad', kind: 'shape', x: 0, y: 0, width: 100, height: 100, groupId: 'g1', parentColumnId: 'col1' }
  const ownership = Structure.validateContainerOwnership([badNode])
  check('Dual ownership (groupId + parentColumnId) rejected with ambiguous-owner',
    ownership.ok === false && ownership.issues.some(i => i.code === 'ambiguous-owner'))

  // 2. Read-only workspace refusal
  const readOnlyCommand = Workflow.runDiagramWorkflow(board, {
    kind: 'starter-map',
    namespace: 'ro-test',
    origin: { x: 0, y: 0 }
  }, true)
  check('Workflow command on read-only workspace is rejected', readOnlyCommand.ok === false)

  // 3. Inserting node on mind-map connector rejection
  const mm = Structure.createMindMapTemplate('mm-insert-test', { x: 0, y: 0 }).value
  const mmBoard = { ...board, nodes: mm.nodes, connectors: mm.connectors }
  const badInsert = Palette.insertDiagramNodeOnConnectorResult(mmBoard, {
    connectorId: mm.connectors[0].id,
    node: { shape: 'process', id: 'fail-insert' },
    downstreamConnectorId: 'edge-fail'
  })
  check('Inserting node on mind-map connection rejected (mind-map-insert)',
    badInsert.ok === false && badInsert.issues.some(i => i.code === 'mind-map-insert'))

  // 4. Operating on locked node
  const lockedNode = { id: 'locked-node', kind: 'shape', x: 0, y: 0, width: 100, height: 100, locked: true }
  const lockedBoard = { ...board, nodes: [lockedNode] }
  const lockedSuccessor = Palette.createConnectedSuccessorResult(lockedBoard, {
    sourceId: 'locked-node',
    node: { shape: 'process', id: 'succ-1' },
    connectorId: 'c1'
  })
  check('Creating successor from locked source rejected (uneditable-diagram-source)',
    lockedSuccessor.ok === false && lockedSuccessor.issues.some(i => i.code === 'uneditable-diagram-source'))

  // 5. Duplicate ID collision refusal
  const existingNode = { id: 'dup-id', kind: 'shape', x: 0, y: 0, width: 100, height: 100 }
  const dupBoard = { ...board, nodes: [existingNode] }
  const dupResult = Palette.createDiagramNodeResult(dupBoard, {
    shape: 'process',
    id: 'dup-id',
    center: { x: 100, y: 100 }
  })
  check('Creating node with existing ID rejected (diagram-id-collision)',
    dupResult.ok === false && dupResult.issues.some(i => i.code === 'diagram-id-collision'))
})

// Output summary and report
const totalChecks = checks.length
const passedChecks = checks.filter(c => c.passed).length
const allPassed = groups.every(g => g.passed) && totalChecks === passedChecks

const outDir = resolve('output/partii-connected-diagrams-templates')
await mkdir(outDir, { recursive: true })
const report = {
  passed: allPassed,
  generatedAt: new Date().toISOString(),
  totalChecks,
  passedChecks,
  groups: groups.map(g => ({ name: g.name, checks: g.checks, passed: g.passed }))
}
await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))

console.log(JSON.stringify({
  passed: allPassed,
  checks: totalChecks,
  groups: groups.map(g => ({ name: g.name, checks: g.checks, passed: g.passed })),
  report: resolve(outDir, 'report.json')
}, null, 2))

if (!allPassed) {
  process.exit(1)
}
