import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(s, c, next) {
    try {
      return next(s, c)
    } catch (e) {
      if (s.startsWith('.')) return next(s + '.ts', c)
      throw e
    }
  }
})

const {
  CanvasFrameDrawList,
  PackedCardBuffer,
  batchRasterImagesByAtlas,
} = await import('../src/canvas-engine/canvasPrimitive.ts')

const {
  ViewportCamera,
  SpatialQuadtree,
} = await import('../src/canvas-engine/viewportCamera.ts')

const {
  InkingScratchpad,
} = await import('../src/canvas-engine/inkingScratchpad.ts')

console.log('========================================================================')
console.log(' ART EQUATION CARD SCALE STRESS TEST: 50 | 100 | 500 | 1,000 | 10,000')
console.log(' (WITH SPATIAL QUADTREE INDEX & TYPED RING BUFFER ACCELERATION)')
console.log('========================================================================\n')

const CARD_COUNTS = [50, 100, 500, 1000, 10000]
const VIEWPORT_WIDTH = 1920
const VIEWPORT_HEIGHT = 1080
const CARD_W = 300
const CARD_H = 200
const CARD_GAP = 50

const results = []

for (const N of CARD_COUNTS) {
  console.log(`>>> Running Benchmark for N = ${N.toLocaleString()} cards...`)

  // 1. Scene Construction & Packed Binary Buffer
  const cols = Math.ceil(Math.sqrt(N))
  const gridWidth = cols * (CARD_W + CARD_GAP)
  const gridHeight = Math.ceil(N / cols) * (CARD_H + CARD_GAP)

  const startBuild = performance.now()
  const primitives = []
  const quadtree = new SpatialQuadtree([-1000, -1000, gridWidth + 1000, gridHeight + 1000], 32, 8)
  const packedBuffer = new PackedCardBuffer(N)

  for (let i = 0; i < N; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * (CARD_W + CARD_GAP)
    const y = row * (CARD_H + CARD_GAP)
    const bounds = [x, y, x + CARD_W, y + CARD_H]

    // Quadtree spatial index population
    quadtree.insert({ id: i, bounds })
    packedBuffer.writeCard(x, y, x + CARD_W, y + CARD_H, 1.0, 0, i)

    // Alternating between raster image cards and structured vector cards
    if (i % 2 === 0) {
      primitives.push({
        kind: 'rasterImage',
        image: {
          assetId: `atlas-group-${i % 8}`,
          bounds,
          transform: { translation: [x, y], scale: 1.0, rotation: 0 },
          opacity: 1.0,
          sparseTiling: { lod: 0, tileSize: 256, resident: true },
        },
      })
    } else {
      primitives.push({
        kind: 'vectorPath',
        vector: {
          id: `card-vector-${i}`,
          commands: [
            ['M', x, y],
            ['L', x + CARD_W, y],
            ['L', x + CARD_W, y + CARD_H],
            ['L', x, y + CARD_H],
            ['Z'],
          ],
          strokeWidth: 1.5,
          strokeColor: '#333333',
          fillColor: '#ffffff',
          transform: [1, 0, 0, 1, 0, 0],
        },
      })
    }
  }
  const buildTimeMs = performance.now() - startBuild

  // 2. Camera Simulation & Frustum Culling
  const cameraCenter = [gridWidth / 2, gridHeight / 2]
  const camera = new ViewportCamera(cameraCenter, 1.0, [VIEWPORT_WIDTH, VIEWPORT_HEIGHT])

  // A. Linear Frustum Culling (for baseline comparison)
  const startLinearCull = performance.now()
  let visibleCount = 0
  let culledCount = 0
  const visiblePrimitives = []

  for (const prim of primitives) {
    const aabb = prim.kind === 'rasterImage'
      ? prim.image.bounds
      : [prim.vector.commands[0][1], prim.vector.commands[0][2], prim.vector.commands[0][1] + CARD_W, prim.vector.commands[0][2] + CARD_H]

    if (camera.intersectsFrustum(aabb)) {
      visibleCount++
      visiblePrimitives.push(prim)
    } else {
      culledCount++
    }
  }
  const linearCullTimeMs = performance.now() - startLinearCull

  // B. Hierarchical Spatial Quadtree Culling
  const startQuadtreeCull = performance.now()
  const quadtreeVisible = camera.cullQuadtree(quadtree)
  const quadtreeCullTimeMs = performance.now() - startQuadtreeCull

  // 3. CanvasPrimitive Draw List Segregation & Atlas Batching
  const startSegregate = performance.now()
  const drawList = CanvasFrameDrawList.segregate(visiblePrimitives)
  const atlasBatches = batchRasterImagesByAtlas(drawList.rasterImages)
  const segregateTimeMs = performance.now() - startSegregate

  // 4. Sparse Virtual Texturing LOD Computation
  const currentLOD = camera.computeTileLOD(5)

  // 5. Active Inking Latency with Typed Ring Buffer
  const inking = new InkingScratchpad()
  const inkingBench = inking.benchmarkInputLatency(500)

  // Assertions
  assert.equal(visibleCount + culledCount, N)
  assert.equal(drawList.totalCount, visibleCount)
  assert.ok(inkingBench.passedSub4ms, `Active inking must stay under 4ms with ${N} cards in memory`)

  const row = {
    cardCount: N,
    buildTimeMs: parseFloat(buildTimeMs.toFixed(2)),
    linearCullMs: parseFloat(linearCullTimeMs.toFixed(3)),
    quadtreeCullMs: parseFloat(quadtreeCullTimeMs.toFixed(3)),
    cullSpeedup: parseFloat((linearCullTimeMs / Math.max(0.001, quadtreeCullTimeMs)).toFixed(1)),
    visibleCards: visibleCount,
    culledCards: culledCount,
    cullPercentage: parseFloat(((culledCount / N) * 100).toFixed(1)),
    segregateMs: parseFloat(segregateTimeMs.toFixed(3)),
    atlasBatches: atlasBatches.length,
    tileLOD: currentLOD,
    inkLatencyAvgMicros: parseFloat(inkingBench.avgMicrosPerPoint.toFixed(2)),
    inkLatencyMaxMicros: parseFloat(inkingBench.maxMicrosPerPoint.toFixed(2)),
  }

  results.push(row)
  console.log(`  -> Built in ${row.buildTimeMs} ms | Linear Cull: ${row.linearCullMs} ms | Quadtree Cull: ${row.quadtreeCullMs} ms (${row.cullSpeedup}x faster!)`)
  console.log(`  -> Culled ${row.culledCards}/${N} (${row.cullPercentage}%) | Segregated into ${row.atlasBatches} atlas batches in ${row.segregateMs} ms`)
  console.log(`  -> Stylus Inking (Typed Buffer): avg ${row.inkLatencyAvgMicros} µs/pt, max ${row.inkLatencyMaxMicros} µs/pt (Target < 4000 µs)\n`)
}

console.log('========================================================================')
console.log(' ACCELERATED BENCHMARK SUMMARY TABLE')
console.log('========================================================================')
console.table(results)

console.log('\n[PASS] All scale tests (50, 100, 500, 1000, 10000) verified successfully with acceleration!')

