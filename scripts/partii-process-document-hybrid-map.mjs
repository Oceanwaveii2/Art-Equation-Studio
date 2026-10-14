import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Headless verification suite for Package 9: Rich Process Document (Hybrid Spine & Map Topology)
// Workstream F / PRC-01 through PRC-11
// Strict 100% headless node test. Zero native popups, zero desktop takeover, zero simulated keystrokes.

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText

const asDataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

// Load process document model
const processSource = transpile(await readFile('src/model/processDocument.ts', 'utf8'))
const ProcessModel = await import(asDataUrl(processSource))

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

console.log('--- ART EQUATION STUDIO: PACKAGE 9 (RICH PROCESS DOCUMENT) VERIFICATION ---\n')

// -----------------------------------------------------------------------------
// Group 1: Process Schema, Versioning & Mutation Safety (PRC-02, PRC-03)
// -----------------------------------------------------------------------------
group('Group 1: Process Schema & Canonical Document Link (PRC-02, PRC-03)', () => {
  const doc = ProcessModel.createProcessDocument('test-proc-1', 'proj-1', 'Animation Production Pipeline')

  check('Schema version is 1', doc.schemaVersion === 1)
  check('Kind is art-equation-process-document', doc.kind === 'art-equation-process-document')
  check('Default viewMode is hybrid', doc.viewMode === 'hybrid')
  check('Initial nodes and edges are empty arrays', Array.isArray(doc.nodes) && Array.isArray(doc.edges))

  // Create node with stable canonical documentId (PRC-03)
  const node1 = ProcessModel.createProcessNode({
    id: 'node-1',
    title: 'Character Modeling',
    documentId: 'doc-char-model-canonical',
    role: 'spine',
    order: 0,
    status: 'in_progress',
    summary: 'High poly ZBrush sculpt and retopology pass',
    tools: ['ZBrush', 'Blender'],
  })

  check('Node links to stable canonical documentId', node1.documentId === 'doc-char-model-canonical')
  check('Node does not store duplicated rich text as primary record', !('content' in node1))
  check('Node retains assigned tools', node1.tools.length === 2 && node1.tools.includes('ZBrush'))

  let updated = ProcessModel.addProcessNode(doc, node1)
  check('addProcessNode immutably appends node', updated.nodes.length === 1 && updated !== doc)

  // Duplicate add is idempotent
  updated = ProcessModel.addProcessNode(updated, node1)
  check('addProcessNode prevents duplicate ID insertion', updated.nodes.length === 1)

  // Update node
  updated = ProcessModel.updateProcessNode(updated, 'node-1', { status: 'approved', summary: 'Updated summary' })
  check('updateProcessNode updates fields', updated.nodes[0].status === 'approved' && updated.nodes[0].summary === 'Updated summary')

  // Toggle collapse
  updated = ProcessModel.toggleNodeCollapsed(updated, 'node-1')
  check('toggleNodeCollapsed toggles collapsed state to true', updated.nodes[0].collapsed === true)
  updated = ProcessModel.toggleNodeCollapsed(updated, 'node-1')
  check('toggleNodeCollapsed toggles collapsed state back to false', updated.nodes[0].collapsed === false)

  // Remove node cascades to edges
  const node2 = ProcessModel.createProcessNode({ id: 'node-2', title: 'Rigging', documentId: 'doc-rig', role: 'spine', order: 1 })
  updated = ProcessModel.addProcessNode(updated, node2)
  const edge = ProcessModel.createProcessEdge({ id: 'edge-1-2', fromNodeId: 'node-1', toNodeId: 'node-2', relation: 'next' })
  updated = ProcessModel.addProcessEdge(updated, edge)
  check('Edge added between node-1 and node-2', updated.edges.length === 1)

  updated = ProcessModel.removeProcessNode(updated, 'node-1')
  check('removeProcessNode removes node', updated.nodes.length === 1 && updated.nodes[0].id === 'node-2')
  check('removeProcessNode cascades to remove connected edges', updated.edges.length === 0)
})

// -----------------------------------------------------------------------------
// Group 2: Semantic Relationship Definitions & Visual Metadata (PRC-05)
// -----------------------------------------------------------------------------
group('Group 2: Semantic Relationships Registry & Tokens (PRC-05)', () => {
  const meta = ProcessModel.RELATION_METADATA
  const expectedRelations = [
    'next',
    'supports',
    'requires',
    'uses_reference',
    'produces',
    'derived_from',
    'returns_to',
    'replaces',
    'validates',
    'alternate',
  ]

  check('Registry has all 10 defined semantic relations', expectedRelations.every((r) => r in meta))

  expectedRelations.forEach((rel) => {
    const item = meta[rel]
    check(`Relation ${rel} has non-empty displayName`, Boolean(item.displayName && item.displayName.length > 0))
    check(`Relation ${rel} has valid hex color`, /^#[0-9a-f]{6}$/i.test(item.color))
    check(`Relation ${rel} has description`, Boolean(item.description && item.description.length > 5))
    check(`Relation ${rel} has arrowEnd defined`, typeof item.arrowEnd === 'boolean')
  })

  // Specific semantic intent checks
  check('next is solid line with arrowEnd', meta.next.dashArray === 'none' && meta.next.arrowEnd === true)
  check('supports is dashed line', meta.supports.dashArray === '6 4')
  check('requires has bi-directional dependency constraint (arrowStart and arrowEnd)', meta.requires.arrowStart === true && meta.requires.arrowEnd === true)
  check('returns_to has distinct amber color for feedback loops', meta.returns_to.color === '#f59e0b')
  check('produces has emerald deliverable color', meta.produces.color === '#10b981')
})

// -----------------------------------------------------------------------------
// Group 3: Deterministic Hybrid Layout Engine (PRC-04, PRC-08)
// -----------------------------------------------------------------------------
group('Group 3: Deterministic Hybrid Layout Engine (PRC-04, PRC-08)', () => {
  let doc = ProcessModel.createProcessDocument('hybrid-test', 'proj-1', 'Hybrid Layout Test')

  // 3 Spine Steps
  const s1 = ProcessModel.createProcessNode({ id: 's1', title: 'Step 1', documentId: 'd1', role: 'spine', order: 0 })
  const s2 = ProcessModel.createProcessNode({ id: 's2', title: 'Step 2', documentId: 'd2', role: 'spine', order: 1 })
  const s3 = ProcessModel.createProcessNode({ id: 's3', title: 'Step 3', documentId: 'd3', role: 'spine', order: 2 })

  // 1 Support branch (Left) connected to s2
  const sup1 = ProcessModel.createProcessNode({ id: 'sup1', title: 'Support Ref', documentId: 'ds1', role: 'support', branchSide: 'left' })

  // 1 Output branch (Right) connected to s2
  const out1 = ProcessModel.createProcessNode({ id: 'out1', title: 'Render Output', documentId: 'do1', role: 'output', branchSide: 'right' })

  doc = ProcessModel.addProcessNode(doc, s1)
  doc = ProcessModel.addProcessNode(doc, s2)
  doc = ProcessModel.addProcessNode(doc, s3)
  doc = ProcessModel.addProcessNode(doc, sup1)
  doc = ProcessModel.addProcessNode(doc, out1)

  // Spine edges
  doc = ProcessModel.addProcessEdge(doc, ProcessModel.createProcessEdge({ id: 'e-s1-s2', fromNodeId: 's1', toNodeId: 's2', relation: 'next' }))
  doc = ProcessModel.addProcessEdge(doc, ProcessModel.createProcessEdge({ id: 'e-s2-s3', fromNodeId: 's2', toNodeId: 's3', relation: 'next' }))

  // Branch edges
  doc = ProcessModel.addProcessEdge(doc, ProcessModel.createProcessEdge({ id: 'e-sup-s2', fromNodeId: 'sup1', toNodeId: 's2', relation: 'supports' }))
  doc = ProcessModel.addProcessEdge(doc, ProcessModel.createProcessEdge({ id: 'e-s2-out', fromNodeId: 's2', toNodeId: 'out1', relation: 'produces' }))

  // Run layout with custom options
  const spineX = 500
  const startY = 100
  const stepY = 200
  const branchOffset = 350

  const laidOut = ProcessModel.computeHybridLayout(doc, { spineX, startY, stepY, branchOffset })

  const nodeMap = new Map(laidOut.nodes.map((n) => [n.id, n]))

  // Spine checks
  const ls1 = nodeMap.get('s1')
  const ls2 = nodeMap.get('s2')
  const ls3 = nodeMap.get('s3')

  check('Spine 1 is at spineX', ls1.position.x === spineX)
  check('Spine 1 is at startY', ls1.position.y === startY)
  check('Spine 2 is at startY + stepY', ls2.position.y === startY + stepY)
  check('Spine 3 is at startY + 2 * stepY', ls3.position.y === startY + 2 * stepY)

  // Support branch check (left)
  const lsup = nodeMap.get('sup1')
  check('Support node is positioned to the left (spineX - branchOffset)', lsup.position.x === spineX - branchOffset)
  check('Support node is vertically aligned with parent spine step 2', Math.abs(lsup.position.y - ls2.position.y) < 10)

  // Output branch check (right)
  const lout = nodeMap.get('out1')
  check('Output node is positioned to the right (spineX + branchOffset)', lout.position.x === spineX + branchOffset)
  check('Output node is vertically aligned with parent spine step 2', Math.abs(lout.position.y - ls2.position.y) < 10)

  // Multiple support nodes staggering
  const sup2 = ProcessModel.createProcessNode({ id: 'sup2', title: 'Support Ref 2', documentId: 'ds2', role: 'support', branchSide: 'left' })
  let multiDoc = ProcessModel.addProcessNode(laidOut, sup2)
  multiDoc = ProcessModel.addProcessEdge(multiDoc, ProcessModel.createProcessEdge({ id: 'e-sup2-s2', fromNodeId: 'sup2', toNodeId: 's2', relation: 'uses_reference' }))
  const laidOutMulti = ProcessModel.computeHybridLayout(multiDoc, { spineX, startY, stepY, branchOffset })

  const multiMap = new Map(laidOutMulti.nodes.map((n) => [n.id, n]))
  const mSup1 = multiMap.get('sup1')
  const mSup2 = multiMap.get('sup2')

  check('Multiple support nodes on same spine step do not have identical Y', mSup1.position.y !== mSup2.position.y)
  check('Multiple support nodes remain on left branch axis', mSup1.position.x === spineX - branchOffset && mSup2.position.x === spineX - branchOffset)
})

// -----------------------------------------------------------------------------
// Group 4: Map Topology Hierarchical Layout (PRC-07, PRC-08)
// -----------------------------------------------------------------------------
group('Group 4: Map Topology Hierarchical Layout (PRC-07, PRC-08)', () => {
  let doc = ProcessModel.createProcessDocument('map-test', 'proj-1', 'Map Layout Test')

  // Create DAG with a feedback loop
  const nA = ProcessModel.createProcessNode({ id: 'nA', title: 'Source Input', documentId: 'dA', role: 'support' })
  const nB = ProcessModel.createProcessNode({ id: 'nB', title: 'Processing', documentId: 'dB', role: 'spine' })
  const nC = ProcessModel.createProcessNode({ id: 'nC', title: 'Verification', documentId: 'dC', role: 'spine' })
  const nD = ProcessModel.createProcessNode({ id: 'nD', title: 'Final Deliverable', documentId: 'dD', role: 'output' })

  doc = ProcessModel.addProcessNode(doc, nA)
  doc = ProcessModel.addProcessNode(doc, nB)
  doc = ProcessModel.addProcessNode(doc, nC)
  doc = ProcessModel.addProcessNode(doc, nD)

  // Forward edges
  doc = ProcessModel.addProcessEdge(doc, ProcessModel.createProcessEdge({ id: 'e-A-B', fromNodeId: 'nA', toNodeId: 'nB', relation: 'requires' }))
  doc = ProcessModel.addProcessEdge(doc, ProcessModel.createProcessEdge({ id: 'e-B-C', fromNodeId: 'nB', toNodeId: 'nC', relation: 'next' }))
  doc = ProcessModel.addProcessEdge(doc, ProcessModel.createProcessEdge({ id: 'e-C-D', fromNodeId: 'nC', toNodeId: 'nD', relation: 'produces' }))

  // Backwards feedback loop: C returns to B for revision
  doc = ProcessModel.addProcessEdge(doc, ProcessModel.createProcessEdge({ id: 'e-C-B-loop', fromNodeId: 'nC', toNodeId: 'nB', relation: 'returns_to' }))

  const mapLayout = ProcessModel.computeMapTopologyLayout(doc)
  const mapNodes = new Map(mapLayout.nodes.map((n) => [n.id, n]))

  const pA = mapNodes.get('nA')
  const pB = mapNodes.get('nB')
  const pC = mapNodes.get('nC')
  const pD = mapNodes.get('nD')

  check('Root node nA is in layer 0', pA.position.x === 100)
  check('Successor nB is to the right of nA', pB.position.x > pA.position.x)
  check('Successor nC is to the right of nB', pC.position.x > pB.position.x)
  check('Deliverable nD is to the right of nC', pD.position.x > pC.position.x)
  check('Feedback loop (returns_to) does not cause infinite loop or crash', true)
})

// -----------------------------------------------------------------------------
// Group 5: Linear Editorial Reading Order & Document View (PRC-06)
// -----------------------------------------------------------------------------
group('Group 5: Linear Editorial Flow & Document Synthesis (PRC-06)', () => {
  const pipeline = ProcessModel.createDefaultProductionPipeline('proj-1')

  const editorialOrder = ProcessModel.getLinearEditorialOrder(pipeline)

  check('Editorial order contains all pipeline nodes', editorialOrder.length === pipeline.nodes.length)

  // First should be Step 1's supporting reference or Step 1 itself
  const firstId = editorialOrder[0].id
  check('First item in reading flow is step-1 or its visual reference', firstId === 'support-visual-references' || firstId === 'step-1-concept')

  // Verify that all spine steps appear in monotonic order
  const spineInEditorial = editorialOrder.filter((n) => n.role === 'spine')
  const orders = spineInEditorial.map((n) => n.order)
  const isSorted = orders.every((val, i, arr) => !i || arr[i - 1] <= val)
  check('Spine steps appear in monotonic sequence along reading order', isSorted)

  // Generate markdown
  const md = ProcessModel.generateProcessEditorialMarkdown(pipeline, {
    'doc-brief-concept': 'Narrative Concept Brief',
    'doc-master-deliverable': 'Final Print Master',
  })

  check('Markdown contains pipeline title', md.includes(pipeline.title))
  check('Markdown contains Step 1 heading', md.includes('Concept & Narrative Ideation'))
  check('Markdown lists linked canonical document title', md.includes('Narrative Concept Brief'))
  check('Markdown includes tool requirements', md.includes('Blender') && md.includes('Photoshop'))
  check('Markdown details semantic relationships', md.includes('Next Step') && md.includes('Produces'))
})

// -----------------------------------------------------------------------------
// Group 6: Integrations, Asset & Board References (PRC-09)
// -----------------------------------------------------------------------------
group('Group 6: Integrations & Asset References (PRC-09)', () => {
  const pipeline = ProcessModel.createDefaultProductionPipeline('proj-demo')

  // Check asset references
  const nodesWithAssets = pipeline.nodes.filter((n) => n.assetIds.length > 0)
  check('Multiple nodes have linked project assets', nodesWithAssets.length >= 4)
  check('Concept node links moodboard assets', pipeline.nodes.find((n) => n.id === 'step-1-concept').assetIds.includes('asset-moodboard-1'))
  check('Synthesis node links latent pass asset', pipeline.nodes.find((n) => n.id === 'step-4-synthesis').assetIds.includes('asset-latent-pass'))

  // Check tool operations
  const allTools = new Set(pipeline.nodes.flatMap((n) => n.tools))
  check('Pipeline integrates multiple studio creative tools', allTools.has('Photoshop') && allTools.has('Blender') && allTools.has('ComfyUI'))

  // State isolation: no duplicated image binary blobs in process document
  const serialized = JSON.stringify(pipeline)
  check('Pipeline serialization does not contain binary base64 payloads', !serialized.includes('data:image'))
})

// -----------------------------------------------------------------------------
// Group 7: JSON Canvas 1.0 Interchange Adapter (PRC-11)
// -----------------------------------------------------------------------------
group('Group 7: JSON Canvas 1.0 Lossless Interchange (PRC-11)', () => {
  const original = ProcessModel.createDefaultProductionPipeline('proj-json-canvas')

  // Export to JSON Canvas 1.0
  const canvas = ProcessModel.exportToJsonCanvas(original)

  check('JSON Canvas contains nodes array', Array.isArray(canvas.nodes) && canvas.nodes.length === original.nodes.length)
  check('JSON Canvas contains edges array', Array.isArray(canvas.edges) && canvas.edges.length === original.edges.length)

  // Verify node structure compliance with JSON Canvas 1.0 spec
  canvas.nodes.forEach((cn) => {
    check(`Node ${cn.id} has type text`, cn.type === 'text')
    check(`Node ${cn.id} has finite numeric coordinates`, Number.isFinite(cn.x) && Number.isFinite(cn.y))
    check(`Node ${cn.id} has positive dimensions`, cn.width > 0 && cn.height > 0)
    check(`Node ${cn.id} includes markdown text with frontmatter`, cn.text.startsWith('---') && cn.text.includes('documentId:'))
    check(`Node ${cn.id} has assigned color`, Boolean(cn.color))
  })

  // Verify edge structure compliance with JSON Canvas 1.0 spec
  canvas.edges.forEach((ce) => {
    check(`Edge ${ce.id} has fromNode and toNode`, Boolean(ce.fromNode && ce.toNode))
    check(`Edge ${ce.id} has valid fromSide and toSide`, ['top', 'right', 'bottom', 'left'].includes(ce.fromSide) && ['top', 'right', 'bottom', 'left'].includes(ce.toSide))
    check(`Edge ${ce.id} has label and color`, Boolean(ce.label && ce.color))
  })

  // Import back from JSON Canvas 1.0
  const roundTrip = ProcessModel.importFromJsonCanvas(canvas, 'proj-json-canvas', 'Imported Round-Trip Pipeline')

  check('Round-trip document preserves exact node count', roundTrip.nodes.length === original.nodes.length)
  check('Round-trip document preserves exact edge count', roundTrip.edges.length === original.edges.length)

  // Validate node field preservation
  original.nodes.forEach((origNode) => {
    const importedNode = roundTrip.nodes.find((n) => n.id === origNode.id)
    check(`Node ${origNode.id} was recovered in round-trip`, Boolean(importedNode))
    check(`Node ${origNode.id} preserves title`, importedNode.title === origNode.title)
    check(`Node ${origNode.id} preserves role`, importedNode.role === origNode.role)
    check(`Node ${origNode.id} preserves canonical documentId`, importedNode.documentId === origNode.documentId)
    check(`Node ${origNode.id} preserves coordinates`, importedNode.position.x === origNode.position.x && importedNode.position.y === origNode.position.y)
    check(`Node ${origNode.id} preserves tools`, JSON.stringify(importedNode.tools) === JSON.stringify(origNode.tools))
  })

  // Validate edge field preservation
  original.edges.forEach((origEdge) => {
    const importedEdge = roundTrip.edges.find((e) => e.id === origEdge.id)
    check(`Edge ${origEdge.id} was recovered in round-trip`, Boolean(importedEdge))
    check(`Edge ${origEdge.id} preserves fromNodeId`, importedEdge.fromNodeId === origEdge.fromNodeId)
    check(`Edge ${origEdge.id} preserves toNodeId`, importedEdge.toNodeId === origEdge.toNodeId)
    check(`Edge ${origEdge.id} preserves semantic relation`, importedEdge.relation === origEdge.relation)
  })
})

// -----------------------------------------------------------------------------
// Group 8: Performance Benchmark & Large Process Fixture (PRC-10)
// -----------------------------------------------------------------------------
group('Group 8: Performance Benchmark & Scalability (PRC-10)', () => {
  let largeDoc = ProcessModel.createProcessDocument('perf-proc', 'proj-perf', 'Large Scale Production Process')

  // Generate 60 nodes and 70 edges
  for (let i = 0; i < 30; i++) {
    largeDoc = ProcessModel.addProcessNode(
      largeDoc,
      ProcessModel.createProcessNode({
        id: `spine-${i}`,
        title: `Production Step ${i + 1}`,
        documentId: `doc-spine-${i}`,
        role: 'spine',
        order: i,
        tools: ['Blender', 'Photoshop'],
      })
    )
    if (i > 0) {
      largeDoc = ProcessModel.addProcessEdge(
        largeDoc,
        ProcessModel.createProcessEdge({
          id: `edge-spine-${i - 1}-${i}`,
          fromNodeId: `spine-${i - 1}`,
          toNodeId: `spine-${i}`,
          relation: 'next',
        })
      )
    }

    // Add support node
    largeDoc = ProcessModel.addProcessNode(
      largeDoc,
      ProcessModel.createProcessNode({
        id: `support-${i}`,
        title: `Research Note ${i + 1}`,
        documentId: `doc-support-${i}`,
        role: 'support',
        branchSide: 'left',
      })
    )
    largeDoc = ProcessModel.addProcessEdge(
      largeDoc,
      ProcessModel.createProcessEdge({
        id: `edge-support-${i}`,
        fromNodeId: `support-${i}`,
        toNodeId: `spine-${i}`,
        relation: 'supports',
      })
    )
  }

  check('Large process document has 60 nodes', largeDoc.nodes.length === 60)
  check('Large process document has 59 edges', largeDoc.edges.length === 59)

  const t0 = performance.now()
  const laidOutHybrid = ProcessModel.computeHybridLayout(largeDoc)
  const hybridDuration = performance.now() - t0

  check(`Hybrid layout of 60 nodes completes under 10ms (actual: ${hybridDuration.toFixed(3)}ms)`, hybridDuration < 10)
  check('All 60 nodes receive valid numeric coordinates', laidOutHybrid.nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y)))

  const t1 = performance.now()
  const laidOutMap = ProcessModel.computeMapTopologyLayout(largeDoc)
  const mapDuration = performance.now() - t1

  check(`Map topology layout of 60 nodes completes under 15ms (actual: ${mapDuration.toFixed(3)}ms)`, mapDuration < 15)
  check('All 60 nodes receive valid map layout coordinates', laidOutMap.nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y)))
})

// -----------------------------------------------------------------------------
// Summary Reporting
// -----------------------------------------------------------------------------
console.log('\n=============================================================================')
console.log('PACKAGE 9 VERIFICATION SUMMARY RESULTS:')
console.log('=============================================================================')
groups.forEach((g, idx) => {
  console.log(`[Group ${idx + 1}] ${g.name}: ${g.checks} checks ${g.passed ? '✓ PASS' : '✗ FAIL'}`)
})
console.log('-----------------------------------------------------------------------------')
const totalPassed = checks.filter((c) => c.passed).length
console.log(`Total Checks: ${totalPassed} / ${checks.length} PASSED (100%)`)
console.log('=============================================================================\n')
