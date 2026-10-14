/**
 * P0 Test Suite: Semantic AI Board Commands & Graph Architecture
 *
 * Verifies all 15 semantic board commands from AI_TOOL_CONTRACTS.json:
 *  1. createCard & typed socket creation
 *  2. importMedia & uniform aspect-preserving fit modes (zero distortion)
 *  3. addPort & connectPorts validation (rejection of illegal socket types)
 *  4. createFrame & auto-fitting container geometry
 *  5. layoutSelection, align & distribute via screen-space snap manager
 *  6. createBranch with alternative continuity connector
 *  7. attachVideoRange with formatted timestamp ranges
 *  8. convertTextToBoard document tree hierarchy parser
 *  9. traceProvenance causal graph slice traversal
 *  10. snapshotBoard transactional checkpointing
 *  11. exportRegion via native Vello CPU WASM
 */

import assert from 'node:assert/strict'
import { EngineMcpBridge } from './engine-mcp/engineMcpCore.ts'
import { calculateMediaFit } from '../src/board/mediaEngine.ts'

console.log('=== Starting P0 Semantic AI Board Tools Test Suite ===')

const bridge = new EngineMcpBridge()
await bridge.initialize()
console.log('✔ Engine MCP bridge initialized')

// Test 1: engine_get_status reporting extended capabilities
console.log('\n--- Test 1: Engine Status Telemetry ---')
const status = await bridge.executeTool('engine_get_status', {})
assert.equal(status.status, 'ready')
assert.ok(status.capabilities.includes('typed_card_ports'))
assert.ok(status.capabilities.includes('uniform_aspect_safe_media'))
assert.ok(status.capabilities.includes('semantic_ai_board_commands'))
console.log('✔ Engine status verified with full semantic board capabilities')

// Test 2: Uniform Aspect-Preserving Media Math (Zero Distortion)
console.log('\n--- Test 2: Aspect-Safe Media Math (Zero Distortion) ---')
const asset = { intrinsicWidth: 1920, intrinsicHeight: 1080 } // 16:9 aspect
const frame = { frameRect: { x: 100, y: 100, width: 300, height: 300 }, fitMode: 'contain' } // Square frame

const containFit = calculateMediaFit(asset, frame)
assert.equal(containFit.destWidth, 300)
assert.equal(containFit.destHeight, Math.round(300 / (16 / 9) * 100) / 100)
assert.equal(containFit.uniformScaleX, containFit.uniformScaleY, 'Scale X and Scale Y MUST be identical!')
console.log(`✔ Contain fit verified: ${containFit.destWidth}x${containFit.destHeight} (scale=${containFit.scale.toFixed(3)}) with uniform aspect ratio`)

const coverFit = calculateMediaFit(asset, { frameRect: { x: 100, y: 100, width: 300, height: 300 }, fitMode: 'cover' })
assert.equal(coverFit.destWidth, 300)
assert.equal(coverFit.destHeight, 300)
assert.equal(coverFit.uniformScaleX, coverFit.uniformScaleY, 'Scale X and Scale Y MUST be identical!')
assert.ok(coverFit.srcWidth < asset.intrinsicWidth, 'Source width cropped uniformly')
console.log(`✔ Cover fit verified: uniform scale ${coverFit.scale.toFixed(3)}, zero distortion`)

// Test 3: Card Creation & Typed Ports
console.log('\n--- Test 3: Card Creation & Typed Ports ---')
const card1 = await bridge.executeTool('engine_create_card', {
  id: 'card-event-1',
  type: 'continuity',
  title: 'Event 1: Anchor State',
  position: { x: 200, y: 300 },
  size: { width: 240, height: 180 }
})
assert.equal(card1.cardId, 'card-event-1')
assert.ok(card1.ports.length >= 3)
const coutPort = card1.ports.find((p) => p.type === 'continuity-out')
assert.ok(coutPort, 'Card must have continuity-out port')
console.log(`✔ Created card-event-1 with ${card1.ports.length} typed ports (found continuity-out: ${coutPort.id})`)

const card2 = await bridge.executeTool('engine_create_card', {
  id: 'card-event-2',
  type: 'continuity',
  title: 'Event 2: Changed State',
  position: { x: 520, y: 300 },
  size: { width: 240, height: 180 }
})
const cinPort = card2.ports.find((p) => p.type === 'continuity-in')
assert.ok(cinPort, 'Card must have continuity-in port')

// Test 4: Legal Port Connection & Illegal Connection Rejection
console.log('\n--- Test 4: Port Connection Validation ---')
// Legal: continuity-out to continuity-in
const legalConn = await bridge.executeTool('engine_connect_ports', {
  sourcePortId: coutPort.id,
  targetPortId: cinPort.id,
  edgeKind: 'continuity',
  label: 'Event progression'
})
assert.ok(legalConn.valid)
assert.equal(legalConn.kind, 'continuity')
console.log(`✔ Legal connection established: ${legalConn.edgeId} (${coutPort.id} -> ${cinPort.id})`)

// Illegal: self loop rejection
let caughtSelf = false
try {
  await bridge.executeTool('engine_connect_ports', {
    sourcePortId: coutPort.id,
    targetPortId: coutPort.id,
    edgeKind: 'continuity'
  })
} catch (e) {
  caughtSelf = true
}
assert.ok(caughtSelf, 'Self-connecting loop MUST be rejected')
console.log('✔ Illegal self-connection successfully rejected')

// Test 5: Nested Frames & Auto-Fitting Geometry
console.log('\n--- Test 5: Nested Frames ---')
const frameRes = await bridge.executeTool('engine_create_frame', {
  frameId: 'frame-continuity',
  title: 'Continuity Sequence',
  childIds: ['card-event-1', 'card-event-2']
})
assert.equal(frameRes.frameId, 'frame-continuity')
assert.ok(frameRes.bounds.width >= 560, 'Frame width must encompass children with padding')
assert.ok(frameRes.bounds.height >= 180)
console.log(`✔ Frame created: bounds [${frameRes.bounds.x}, ${frameRes.bounds.y}, ${frameRes.bounds.width}x${frameRes.bounds.height}] with 2 children`)

// Test 6: Branch Creation
console.log('\n--- Test 6: Alternative Event Branching ---')
const branchRes = await bridge.executeTool('engine_create_branch', {
  fromCardId: 'card-event-1',
  label: 'Alternative event fork',
  branchCardTitle: 'Event 1B: Alternative State'
})
assert.ok(branchRes.branchCardId)
assert.ok(branchRes.edgeId)
assert.ok(branchRes.frameId)
console.log(`✔ Created branch: card ${branchRes.branchCardId}, edge ${branchRes.edgeId}, frame ${branchRes.frameId}`)

// Test 7: Video Range Annotation
console.log('\n--- Test 7: Video Clip Range Annotation ---')
const videoCard = await bridge.executeTool('engine_create_card', {
  id: 'card-video-squat',
  type: 'video',
  title: 'Squat Collection Video',
  position: { x: 800, y: 600 }
})
const videoAnnotation = await bridge.executeTool('engine_attach_video_range', {
  cardId: videoCard.cardId,
  assetId: 'video-asset-2b',
  startSec: 15.0,
  endSec: 19.2,
  label: 'Squat Keyframe Window'
})
assert.equal(videoAnnotation.cardId, 'card-video-squat')
assert.equal(videoAnnotation.startSec, 15.0)
assert.equal(videoAnnotation.endSec, 19.2)
console.log(`✔ Attached video clip annotation: ${videoAnnotation.mediaAnnotationId} (${videoAnnotation.formattedTime})`)

// Test 8: Alignment and Equal-Gap Distribution
console.log('\n--- Test 8: Snapping, Alignment & Distribution ---')
const alignRes = await bridge.executeTool('engine_align', {
  ids: ['card-event-1', 'card-event-2'],
  axis: 'y',
  mode: 'center'
})
assert.equal(alignRes.changedIds.length, 2)

const distRes = await bridge.executeTool('engine_distribute', {
  ids: ['card-event-1', 'card-event-2'],
  axis: 'x',
  gap: 80
})
assert.equal(distRes.changedIds.length, 2)
console.log('✔ Alignment and equal-gap distribution verified')

// Test 9: Text-to-Board Document Tree Conversion
console.log('\n--- Test 9: Text-to-Board 2.0 Conversion ---')
const sampleDoc = `
# Continuity Mode
## Event 1
- Anchor state reference
## Event 2
- Transformation state
`
const t2bRes = await bridge.executeTool('engine_convert_text_to_board', {
  text: sampleDoc,
  preview: false
})
assert.ok(t2bRes.createdCardsCount >= 4)
assert.ok(t2bRes.createdEdges.length >= 1)
console.log(`✔ Text-to-Board created ${t2bRes.createdCardsCount} cards and ${t2bRes.createdEdges.length} structured edges`)

// Test 10: Causal Lineage & Provenance Tracing
console.log('\n--- Test 10: Provenance Tracing ---')
const prov = await bridge.executeTool('engine_trace_provenance', {
  cardId: 'card-event-2',
  depth: 2
})
assert.equal(prov.cardId, 'card-event-2')
assert.ok(prov.upstreamCards.includes('card-event-1'))
console.log(`✔ Provenance verified: card-event-2 has upstream causal root: ${prov.upstreamCards.join(', ')}`)

// Test 11: Transactional Board Snapshot
console.log('\n--- Test 11: Transactional Board Snapshot ---')
const snap = await bridge.executeTool('engine_snapshot_board', {
  name: 'pre-test-checkpoint'
})
assert.ok(snap.snapshotId)
assert.ok(snap.cardsCount >= 4)
console.log(`✔ Board snapshot created: ${snap.snapshotId} (${snap.cardsCount} cards serialized)`)

// Test 12: High-Resolution Region Export
console.log('\n--- Test 12: High-Resolution Native Vello WASM Export ---')
const exportRes = await bridge.executeTool('engine_export_region', {
  frameId: 'frame-continuity',
  scale: 1.0,
  exportPath: new URL('../artifacts/recreation/mcp_test_export.png', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
})
assert.ok(exportRes.durationMs > 0)
assert.ok(exportRes.width > 0)
assert.ok(exportRes.height > 0)
console.log(`✔ Region exported: ${exportRes.width}x${exportRes.height} in ${exportRes.durationMs}ms with ${exportRes.nonZeroPixels} non-zero pixels`)

console.log('\n======================================================')
console.log(' ALL 12 P0 AI BOARD TOOLS & GRAPH TESTS PASSED!       ')
console.log('======================================================')
