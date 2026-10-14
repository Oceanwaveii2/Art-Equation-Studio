import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'

const moduleCache = new Map()
async function moduleUrl(file) {
  file = resolve(file)
  if (moduleCache.has(file)) return moduleCache.get(file)
  let code = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  for (const match of [...code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)]) {
    let importPath = match[1]
    if (importPath.endsWith('.ts') || importPath.endsWith('.tsx')) {
      importPath = importPath.replace(/\.tsx?$/, '')
    }
    let target = resolve(dirname(file), importPath + '.ts')
    try {
      await stat(target)
    } catch {
      target = resolve(dirname(file), importPath + '.tsx')
    }
    const imported = await moduleUrl(target)
    code = code.replaceAll(`'${match[1]}'`, `'${imported}'`).replaceAll(`"${match[1]}"`, `"${imported}"`)
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  moduleCache.set(file, url)
  return url
}

// Production modules
const Cmd = await import(await moduleUrl('src/board/columnRowCommands.ts'))
const Col = await import(await moduleUrl('src/board/columns.ts'))
const Arr = await import(await moduleUrl('src/board/arrangement.ts'))
const Struct = await import(await moduleUrl('src/board/diagramStructureCore.ts'))
const Safety = await import(await moduleUrl('src/board/boardMutationSafety.ts'))
const Spatial = await import(await moduleUrl('src/canvas-engine/spatialIndex.ts'))

const inputs = [
  'src/board/columnRowCommands.ts',
  'src/board/arrangement.ts',
  'src/board/columns.ts',
  'src/board/diagramStructureCore.ts',
  'src/board/boardMutationSafety.ts',
  'src/canvas-engine/spatialIndex.ts',
  'src/board/velloEligibility.ts'
]
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async (p) => [p, createHash('sha256').update(await readFile(p)).digest('hex')])))

const report = {
  generatedAt: new Date().toISOString(),
  passed: false,
  checks: 0,
  groups: [],
  benchmarks: {},
  sourceHashes: await hashes(),
  limitations: [
    'Stress testing verifies in-memory 50-item mixed-media arrangements, sibling column transfers, ancestor container movement, visual bounds calculations, shelf packing, and sub-millisecond spatial index queries headless.'
  ]
}

const outputDir = resolve('output/partii-dense-media-arrangement')
await mkdir(outputDir, { recursive: true })

const check = (condition, message) => {
  report.checks++
  assert(condition, message)
}
const ok = (result) => {
  check(result.ok, result.ok ? 'success' : JSON.stringify(result.issues))
  return result.value
}
const snapshot = (v) => JSON.stringify(v)

async function group(name, run) {
  const before = report.checks
  await run()
  report.groups.push({ name, checks: report.checks - before, passed: true })
}

// Node builders
const makeNode = (id, kind, extra = {}) => ({
  id,
  kind,
  title: id,
  x: 0,
  y: 0,
  width: 200,
  height: 120,
  ...extra
})

// Build a 50+ item mixed-media fixture
function createStressFixture() {
  const nodes = []
  const connectors = []

  // 1. Column A (Left)
  nodes.push(makeNode('col-left', 'column', { x: 100, y: 100, width: 260, height: 400 }))
  // 6 rows in col-left
  nodes.push(makeNode('row-l1-img', 'image', { parentColumnId: 'col-left', columnOrder: 0, x: 110, y: 140, width: 240, height: 160, assetId: 'asset-img1', imagePresentation: 'artwork' }))
  nodes.push(makeNode('row-l2-note', 'note', { parentColumnId: 'col-left', columnOrder: 1, x: 110, y: 310, width: 240, height: 80, body: 'Note in col left' }))
  nodes.push(makeNode('row-l3-shape', 'shape', { parentColumnId: 'col-left', columnOrder: 2, x: 110, y: 400, width: 240, height: 90, shapeType: 'path', vectorPath: { version: 1, closed: true, points: [{ id: 'p0', x: 0, y: 0 }, { id: 'p1', x: 240, y: 90 }] } }))
  nodes.push(makeNode('row-l4-text', 'text', { parentColumnId: 'col-left', columnOrder: 3, x: 110, y: 500, width: 240, height: 40, body: 'Label header' }))
  nodes.push(makeNode('row-l5-doc', 'document', { parentColumnId: 'col-left', columnOrder: 4, x: 110, y: 550, width: 240, height: 100, assetId: 'asset-doc1' }))
  nodes.push(makeNode('row-l6-note2', 'note', { parentColumnId: 'col-left', columnOrder: 5, x: 110, y: 660, width: 240, height: 70, body: 'Footer note' }))

  // 2. Column B (Middle)
  nodes.push(makeNode('col-middle', 'column', { x: 420, y: 100, width: 260, height: 400 }))
  // 5 rows in col-middle
  nodes.push(makeNode('row-m1-note', 'note', { parentColumnId: 'col-middle', columnOrder: 0, x: 430, y: 140, width: 240, height: 90, body: 'Middle note 1' }))
  nodes.push(makeNode('row-m2-img', 'image', { parentColumnId: 'col-middle', columnOrder: 1, x: 430, y: 240, width: 240, height: 140, assetId: 'asset-img2' }))
  nodes.push(makeNode('row-m3-shape', 'shape', { parentColumnId: 'col-middle', columnOrder: 2, x: 430, y: 390, width: 240, height: 80, shapeType: 'ellipse' }))
  nodes.push(makeNode('row-m4-text', 'text', { parentColumnId: 'col-middle', columnOrder: 3, x: 430, y: 480, width: 240, height: 50, body: 'Paragraph text' }))
  nodes.push(makeNode('row-m5-doc', 'document', { parentColumnId: 'col-middle', columnOrder: 4, x: 430, y: 540, width: 240, height: 90, assetId: 'asset-doc2' }))

  // 3. Column C (Right)
  nodes.push(makeNode('col-right', 'column', { x: 740, y: 100, width: 260, height: 300 }))
  nodes.push(makeNode('row-r1-note', 'note', { parentColumnId: 'col-right', columnOrder: 0, x: 750, y: 140, width: 240, height: 70, body: 'Right note' }))
  nodes.push(makeNode('row-r2-img', 'image', { parentColumnId: 'col-right', columnOrder: 1, x: 750, y: 220, width: 240, height: 120, assetId: 'asset-img3' }))

  // 4. Column D (Locked)
  nodes.push(makeNode('col-locked', 'column', { x: 1060, y: 100, width: 260, height: 200, locked: true }))
  nodes.push(makeNode('row-lock1', 'note', { parentColumnId: 'col-locked', columnOrder: 0, x: 1070, y: 140, width: 240, height: 60, body: 'Locked row' }))

  // 5. Enclosing Frame Container
  nodes.push(makeNode('frame-container', 'group', { containerRole: 'frame', x: 1400, y: 80, width: 500, height: 600 }))
  // Frame-nested Column
  nodes.push(makeNode('col-in-frame', 'column', { groupId: 'frame-container', x: 1420, y: 120, width: 220, height: 350 }))
  nodes.push(makeNode('row-f1-note', 'note', { parentColumnId: 'col-in-frame', columnOrder: 0, x: 1430, y: 150, width: 200, height: 60, body: 'Nested note' }))
  nodes.push(makeNode('row-f2-img', 'image', { parentColumnId: 'col-in-frame', columnOrder: 1, x: 1430, y: 220, width: 200, height: 100, assetId: 'asset-img4' }))
  // Frame-nested direct objects
  nodes.push(makeNode('frame-child-note', 'note', { groupId: 'frame-container', x: 1660, y: 150, width: 200, height: 100, body: 'Direct in frame' }))
  nodes.push(makeNode('frame-child-shape', 'shape', { groupId: 'frame-container', x: 1660, y: 270, width: 200, height: 120, shapeType: 'ellipse' }))

  // 6. Free canvas cards (28 items)
  for (let i = 0; i < 28; i++) {
    const kind = i % 5 === 0 ? 'image' : i % 5 === 1 ? 'note' : i % 5 === 2 ? 'shape' : i % 5 === 3 ? 'text' : 'document'
    const x = 100 + (i % 7) * 220
    const y = 800 + Math.floor(i / 7) * 180
    const extra = {}
    if (kind === 'image') {
      extra.assetId = `free-asset-${i}`
      extra.width = 180 + (i % 3) * 20
      extra.height = 130 + (i % 2) * 20
      if (i === 0) extra.rotation = 30
      if (i === 5) extra.imageTransform = { fit: 'cover', zoom: 1.4 }
    } else if (kind === 'shape') {
      extra.shapeType = i % 2 === 0 ? 'path' : 'ellipse'
      if (extra.shapeType === 'path') {
        extra.vectorPath = { version: 1, closed: true, points: [{ id: `sp0-${i}`, x: 0, y: 0 }, { id: `sp1-${i}`, x: 160, y: 80 }] }
      }
    } else if (kind === 'note') {
      extra.body = `Free note ${i} content with details`
    }
    nodes.push(makeNode(`free-${i}-${kind}`, kind, { x, y, width: 180, height: 120, ...extra }))
  }

  // 7. Connectors linking diverse cards
  connectors.push({ id: 'edge-1', sourceId: 'row-l1-img', targetId: 'row-m1-note', sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#60a5fa', width: 2, startArrow: false, endArrow: true, dashed: false, animated: false })
  connectors.push({ id: 'edge-2', sourceId: 'free-0-image', targetId: 'free-1-note', sourcePort: 'right', targetPort: 'left', style: 'elbow', color: '#34d399', width: 2, startArrow: false, endArrow: false, dashed: true, animated: false })

  return {
    id: 'dense-media-stress-board',
    title: 'Dense Media Stress Board',
    viewport: { x: 0, y: 0, scale: 1 },
    nodes,
    connectors
  }
}

try {
  await group('50-item mixed-media fixture topology and safety baseline', () => {
    const fixture = createStressFixture()
    check(fixture.nodes.length >= 50, `fixture contains ${fixture.nodes.length} nodes (>= 50 required)`)
    const ownership = Struct.validateContainerOwnership(fixture.nodes)
    check(ownership.ok, 'container ownership is structurally valid')
    const mutation = Safety.validateBoardMutation(fixture, fixture)
    check(mutation.ok, 'mutation safety validates initial fixture')

    // Verify presence of all key media kinds
    const kinds = new Set(fixture.nodes.map((n) => n.kind))
    check(kinds.has('image'), 'has image cards')
    check(kinds.has('note'), 'has note cards')
    check(kinds.has('shape'), 'has shape cards')
    check(kinds.has('text'), 'has text cards')
    check(kinds.has('document'), 'has document cards')
    check(kinds.has('column'), 'has columns')
    check(kinds.has('group'), 'has frames')
  })

  await group('Column row reordering earlier/later preserves row identities and source bytes', () => {
    const fixture = createStressFixture()
    const baseline = snapshot(fixture)

    // Check action states
    const l1State = Cmd.columnRowActionState(fixture, ['row-l1-img'])
    check(l1State.visible, 'row-l1-img action visible')
    check(!l1State.earlier, 'first row cannot move earlier')
    check(l1State.later, 'first row can move later')
    check(!l1State.previousColumn, 'leftmost column row has no previous column')
    check(l1State.nextColumn, 'leftmost column row has next sibling column')

    // Move first row later
    const movedLater = ok(Cmd.moveColumnRowsResult(fixture, ['row-l1-img'], 'later'))
    const childrenAfterLater = Col.columnChildren(movedLater, 'col-left')
    check(childrenAfterLater[0].id === 'row-l2-note', 'row-l2-note became first')
    check(childrenAfterLater[1].id === 'row-l1-img', 'row-l1-img moved to second index')
    check(childrenAfterLater[1].imagePresentation === 'artwork', 'image presentation preserved')
    check(childrenAfterLater[1].assetId === 'asset-img1', 'asset ID preserved')

    // Move it back earlier
    const movedEarlier = ok(Cmd.moveColumnRowsResult(movedLater, ['row-l1-img'], 'earlier'))
    const childrenAfterEarlier = Col.columnChildren(movedEarlier, 'col-left')
    check(childrenAfterEarlier[0].id === 'row-l1-img', 'restored to first position')
    check(childrenAfterEarlier[1].id === 'row-l2-note', 'second restored')

    // Non-adjacent selection refused
    const nonAdjacent = Cmd.moveColumnRowsResult(fixture, ['row-l1-img', 'row-l3-shape'], 'later')
    check(!nonAdjacent.ok, 'non-adjacent selection refused')

    // Cross-column selection refused
    const crossColumn = Cmd.moveColumnRowsResult(fixture, ['row-l1-img', 'row-m1-note'], 'later')
    check(!crossColumn.ok, 'cross-column selection refused')

    // Input unchanged
    check(snapshot(fixture) === baseline, 'input board was never mutated in-place')
  })

  await group('Move to sibling column (previous/next) transfers rows and auto-layouts columns', () => {
    const fixture = createStressFixture()

    // Move row from col-left to col-middle (next)
    const movedToNext = ok(Cmd.moveColumnRowsToSiblingColumnResult(fixture, ['row-l1-img'], 'next'))
    const targetChildren = Col.columnChildren(movedToNext, 'col-middle')
    const sourceChildren = Col.columnChildren(movedToNext, 'col-left')

    check(!sourceChildren.some((n) => n.id === 'row-l1-img'), 'row removed from col-left')
    check(targetChildren.some((n) => n.id === 'row-l1-img'), 'row inserted into col-middle')
    const transferredNode = targetChildren.find((n) => n.id === 'row-l1-img')
    check(transferredNode.parentColumnId === 'col-middle', 'parentColumnId updated to col-middle')
    check(transferredNode.width === 240, 'width preserved/fit to column')
    check(transferredNode.assetId === 'asset-img1', 'assetId preserved')

    // Move row from col-middle to col-left (previous)
    const movedBack = ok(Cmd.moveColumnRowsToSiblingColumnResult(movedToNext, ['row-l1-img'], 'previous'))
    const leftRestored = Col.columnChildren(movedBack, 'col-left')
    check(leftRestored.some((n) => n.id === 'row-l1-img'), 'row restored to col-left')

    // Refuse previous when in col-left (no previous sibling)
    const noPrev = Cmd.moveColumnRowsToSiblingColumnResult(fixture, ['row-l1-img'], 'previous')
    check(!noPrev.ok, 'refuses previous when no earlier sibling column exists')

    // Refuse move into locked sibling
    const rightColChildren = Col.columnChildren(fixture, 'col-right')
    const toLocked = Cmd.moveColumnRowsToSiblingColumnResult(fixture, [rightColChildren[0].id], 'next')
    check(!toLocked.ok, 'refuses move into locked sibling column')

    // Nested frame column sibling boundary:
    // col-in-frame is inside frame-container, so its siblings must also share frame-container
    const inFrameState = Cmd.columnRowActionState(fixture, ['row-f1-note'])
    check(!inFrameState.previousColumn, 'in-frame column has no previous column inside frame')
    check(!inFrameState.nextColumn, 'in-frame column has no next column inside frame')
  })

  await group('Move to ancestor container reparents to parent frame or canvas', () => {
    const fixture = createStressFixture()

    // 1. Move row from col-in-frame out to enclosing frame-container
    const movedOutToFrame = ok(Cmd.moveSelectionToAncestorResult(fixture, ['row-f1-note']))
    const reparentedInFrame = movedOutToFrame.nodes.find((n) => n.id === 'row-f1-note')
    check(reparentedInFrame.parentColumnId === undefined, 'parentColumnId removed')
    check(reparentedInFrame.groupId === 'frame-container', 'groupId set to enclosing frame-container')

    // 2. Move item already directly inside frame-container out to canvas
    const movedOutOfFrame = ok(Cmd.moveSelectionToAncestorResult(fixture, ['frame-child-note']))
    const freeFromFrame = movedOutOfFrame.nodes.find((n) => n.id === 'frame-child-note')
    check(freeFromFrame.groupId === undefined, 'groupId cleared (now on canvas)')
    check(freeFromFrame.parentColumnId === undefined, 'parentColumnId remains undefined')

    // 3. Move row from top-level column out to canvas
    const movedFromTopCol = ok(Cmd.moveSelectionToAncestorResult(fixture, ['row-l2-note']))
    const freeFromCol = movedFromTopCol.nodes.find((n) => n.id === 'row-l2-note')
    check(freeFromCol.parentColumnId === undefined, 'parentColumnId cleared')
    check(freeFromCol.groupId === undefined, 'groupId is undefined (free on canvas)')
    check(freeFromCol.x === 110, 'world x preserved')
    check(freeFromCol.y === 310, 'world y preserved')

    // Mutation safety checks
    check(Safety.validateBoardMutation(fixture, movedOutToFrame).ok, 'frame reparent mutation valid')
    check(Safety.validateBoardMutation(fixture, movedOutOfFrame).ok, 'canvas release mutation valid')
    check(Safety.validateBoardMutation(fixture, movedFromTopCol).ok, 'col release mutation valid')
  })

  await group('Multi-card alignment on 10 free cards calculates visual bounds and skips containers', () => {
    const fixture = createStressFixture()
    const freeCardIds = fixture.nodes.filter((n) => n.id.startsWith('free-')).slice(0, 10).map((n) => n.id)

    // Test Left Alignment
    const alignedLeft = Arr.alignBoardNodes(fixture.nodes, freeCardIds, 'left')
    const leftBoxes = freeCardIds.map((id) => Arr.boardNodeVisualBounds(alignedLeft.find((n) => n.id === id)))
    const minLeft = leftBoxes[0].left
    for (const box of leftBoxes) {
      check(Math.abs(box.left - minLeft) < 1e-4, 'all selected cards aligned to same left')
    }

    // Test Center Alignment
    const alignedCenter = Arr.alignBoardNodes(fixture.nodes, freeCardIds, 'center')
    const centerBoxes = freeCardIds.map((id) => Arr.boardNodeVisualBounds(alignedCenter.find((n) => n.id === id)))
    const avgCenter = (centerBoxes[0].left + centerBoxes[0].right) / 2
    for (const box of centerBoxes) {
      check(Math.abs((box.left + box.right) / 2 - avgCenter) < 1e-4, 'all selected cards aligned to horizontal center')
    }

    // Test Top Alignment
    const alignedTop = Arr.alignBoardNodes(fixture.nodes, freeCardIds, 'top')
    const topBoxes = freeCardIds.map((id) => Arr.boardNodeVisualBounds(alignedTop.find((n) => n.id === id)))
    const minTop = topBoxes[0].top
    for (const box of topBoxes) {
      check(Math.abs(box.top - minTop) < 1e-4, 'all selected cards aligned to top')
    }

    // Container exclusion: Attempting to align a column row with free cards must exclude the column row
    const mixedSelection = [...freeCardIds.slice(0, 2), 'row-l1-img', 'col-left', 'frame-container']
    const eligible = Arr.eligibleArrangementNodes(fixture.nodes, mixedSelection)
    check(eligible.length === 2, 'eligible arrangement nodes filters out column rows and containers')
    check(!eligible.some((n) => n.id === 'row-l1-img'), 'column row excluded')
    check(!eligible.some((n) => n.id === 'col-left'), 'column container excluded')
    check(!eligible.some((n) => n.id === 'frame-container'), 'frame container excluded')
  })

  await group('Shelf packing with gap preserves all media dimensions without collision', () => {
    const fixture = createStressFixture()
    const freeCardIds = fixture.nodes.filter((n) => n.id.startsWith('free-')).slice(0, 16).map((n) => n.id)

    // Pack into 2 rows with gap 24
    const packed2Rows = Arr.packBoardNodes(fixture.nodes, freeCardIds, { gap: 24, rows: 2 })
    const packedBoxes = freeCardIds.map((id) => Arr.boardNodeVisualBounds(packed2Rows.find((n) => n.id === id)))

    // Check no pair overlaps
    for (let i = 0; i < packedBoxes.length; i++) {
      for (let j = i + 1; j < packedBoxes.length; j++) {
        const a = packedBoxes[i], b = packedBoxes[j]
        const overlapX = a.left < b.right && a.right > b.left
        const overlapY = a.top < b.bottom && a.bottom > b.top
        check(!(overlapX && overlapY), `packed cards ${i} and ${j} do not overlap`)
      }
    }

    // Original node dimensions must remain exact
    for (const id of freeCardIds) {
      const orig = fixture.nodes.find((n) => n.id === id)
      const packed = packed2Rows.find((n) => n.id === id)
      check(orig.width === packed.width, `width preserved for ${id}`)
      check(orig.height === packed.height, `height preserved for ${id}`)
    }
  })

  await group('Marquee selection broad-phase and containment vs crossing', () => {
    const fixture = createStressFixture()
    const records = fixture.nodes.map((n) => ({
      id: n.id,
      bounds: { x: n.x, y: n.y, width: n.width, height: n.height }
    }))
    const index = new Spatial.UniformGridSpatialIndex(records, 256)

    // 1. Containing Marquee query
    // Query a box that strictly contains free-0-image and free-1-note
    const n0 = fixture.nodes.find((n) => n.id === 'free-0-image')
    const n1 = fixture.nodes.find((n) => n.id === 'free-1-note')
    const encloseBox = {
      x: Math.min(n0.x, n1.x) - 10,
      y: Math.min(n0.y, n1.y) - 10,
      width: Math.max(n0.x + n0.width, n1.x + n1.width) - Math.min(n0.x, n1.x) + 20,
      height: Math.max(n0.y + n0.height, n1.y + n1.height) - Math.min(n0.y, n1.y) + 20
    }
    const candidates = index.query(encloseBox)
    check(candidates.some((c) => c.id === n0.id), 'contains free-0-image')
    check(candidates.some((c) => c.id === n1.id), 'contains free-1-note')

    // 2. Crossing Marquee simulation:
    // A narrow box that intersects n0's border but does not contain it
    const intersectBox = {
      x: n0.x + 10,
      y: n0.y + 10,
      width: 20,
      height: 20
    }
    const intersectCandidates = index.query(intersectBox)
    check(intersectCandidates.some((c) => c.id === n0.id), 'crossing box intersects candidate')

    // Test containment condition:
    const contains = (box, node) =>
      node.x >= box.x &&
      node.x + node.width <= box.x + box.width &&
      node.y >= box.y &&
      node.y + node.height <= box.y + box.height

    check(!contains(intersectBox, n0), 'intersecting box does not contain node')
    check(contains(encloseBox, n0), 'enclosing box contains node')
  })

  await group('50-item spatial index benchmark and fork isolation (< 1ms query)', () => {
    const fixture = createStressFixture()
    const records = fixture.nodes.map((n) => ({
      id: n.id,
      bounds: { x: n.x, y: n.y, width: n.width, height: n.height }
    }))
    const index = new Spatial.UniformGridSpatialIndex(records, 256)

    // Benchmark 1000 queries
    const t0 = performance.now()
    const iterations = 1000
    let totalFound = 0
    for (let i = 0; i < iterations; i++) {
      const q = { x: 200 + (i % 50) * 10, y: 200 + (i % 50) * 10, width: 400, height: 300 }
      const res = index.query(q)
      totalFound += res.length
    }
    const t1 = performance.now()
    const avgQueryMs = (t1 - t0) / iterations
    report.benchmarks.spatialQueries1000TotalMs = t1 - t0
    report.benchmarks.spatialQueryAvgMs = avgQueryMs
    check(avgQueryMs < 0.1, `average spatial query time ${avgQueryMs.toFixed(4)}ms is well under 0.1ms (< 1ms target)`)

    // Fork isolation test
    const forked = index.fork(records)
    check(forked.size === index.size, 'fork has identical size')
    forked.upsert({ id: 'ephemeral', bounds: { x: 50, y: 50, width: 50, height: 50 } })
    check(forked.size === index.size + 1, 'fork added record')
    check(!index.get('ephemeral'), 'original index unaffected by fork mutation')
  })

  report.sourceHashesAtEnd = await hashes()
  assert.deepEqual(report.sourceHashesAtEnd, report.sourceHashes, 'source files unchanged during test run')
  report.passed = true
} catch (error) {
  report.failure = {
    message: error.message,
    stack: error.stack?.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[module]')
  }
  process.exitCode = 1
}

await writeFile(resolve(outputDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  passed: report.passed,
  checks: report.checks,
  groups: report.groups,
  benchmarks: report.benchmarks,
  failure: report.failure,
  report: resolve(outputDir, 'report.json')
}))
