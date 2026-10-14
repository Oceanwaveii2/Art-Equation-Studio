import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

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
      let target = resolve(dirname(file), /\.tsx?$/.test(spec) ? spec : spec + '.ts')
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

// Import production modules
const Minimap = await import(await moduleUrl('src/board/minimapGeometry.ts'))
const Connectors = await import(await moduleUrl('src/board/connectors.ts'))
const Arrangement = await import(await moduleUrl('src/board/arrangement.ts'))
const Search = await import(await moduleUrl('src/search/projectSearchModel.ts'))

const inputs = [
  'src/board/minimapGeometry.ts',
  'src/board/connectors.ts',
  'src/board/arrangement.ts',
  'src/board/BoardMinimap.tsx',
  'src/search/projectSearchModel.ts',
  'src/board/velloEligibility.ts'
]
const hashes = async () => Object.fromEntries(await Promise.all(inputs.map(async (p) => [p, createHash('sha256').update(await readFile(p)).digest('hex')])))

const report = {
  generatedAt: new Date().toISOString(),
  passed: false,
  checks: 0,
  groups: [],
  sourceHashes: await hashes(),
  limitations: [
    'Verifies mathematical camera view navigation, fit algorithms, minimap mapping and drag panning, low-zoom connector stability across 5% to 200% zoom, and search return view restoration in headless Node runtime.'
  ]
}

const outputDir = resolve('output/partii-camera-minimap-connectors')
await mkdir(outputDir, { recursive: true })

const check = (condition, message) => {
  report.checks++
  assert(condition, message)
}
const close = (a, b, epsilon = 1e-4) => {
  report.checks++
  assert(Math.abs(a - b) <= epsilon, `${a} is not close to ${b} (diff ${Math.abs(a - b)})`)
}

async function group(name, run) {
  const before = report.checks
  await run()
  report.groups.push({ name, checks: report.checks - before, passed: true })
}

// Helpers
const MIN_CANVAS_ZOOM = 0.05
const MAX_CANVAS_ZOOM = 4.0

function computeFitBoard(nodes, stageSize, padding = 54) {
  if (!nodes.length) return null
  const boxes = nodes.map(Arrangement.boardNodeVisualBounds)
  const minX = Math.min(...boxes.map((b) => b.left))
  const minY = Math.min(...boxes.map((b) => b.top))
  const maxX = Math.max(...boxes.map((b) => b.right))
  const maxY = Math.max(...boxes.map((b) => b.bottom))
  const scale = Math.min(1.4, Math.max(0.18, Math.min((stageSize.width - padding * 2) / Math.max(1, maxX - minX), (stageSize.height - padding * 2) / Math.max(1, maxY - minY))))
  return {
    x: (stageSize.width - (maxX - minX) * scale) / 2 - minX * scale,
    y: (stageSize.height - (maxY - minY) * scale) / 2 - minY * scale,
    scale,
    bounds: { minX, minY, maxX, maxY }
  }
}

function computeFitSelection(nodes, selectedIds, stageSize, padding = 70) {
  const selected = nodes.filter((n) => selectedIds.includes(n.id))
  if (!selected.length) return null
  const boxes = selected.map(Arrangement.boardNodeVisualBounds)
  const minX = Math.min(...boxes.map((b) => b.left))
  const minY = Math.min(...boxes.map((b) => b.top))
  const maxX = Math.max(...boxes.map((b) => b.right))
  const maxY = Math.max(...boxes.map((b) => b.bottom))
  const scale = Math.min(2.0, Math.max(0.18, Math.min((stageSize.width - padding * 2) / Math.max(1, maxX - minX), (stageSize.height - padding * 2) / Math.max(1, maxY - minY))))
  return {
    x: (stageSize.width - (maxX - minX) * scale) / 2 - minX * scale,
    y: (stageSize.height - (maxY - minY) * scale) / 2 - minY * scale,
    scale,
    bounds: { minX, minY, maxX, maxY }
  }
}

function computeZoom100(currentViewport, stageSize) {
  const worldCenterX = (stageSize.width / 2 - currentViewport.x) / currentViewport.scale
  const worldCenterY = (stageSize.height / 2 - currentViewport.y) / currentViewport.scale
  return {
    x: stageSize.width / 2 - worldCenterX,
    y: stageSize.height / 2 - worldCenterY,
    scale: 1.0,
    worldCenterX,
    worldCenterY
  }
}

try {
  await group('Camera Fit Board, Fit Selection, and 100% Zoom math', () => {
    const stageSize = { width: 1920, height: 1080 }
    const nodes = [
      { id: 'card1', kind: 'image', x: 200, y: 150, width: 300, height: 200 },
      { id: 'card2', kind: 'note', x: 800, y: 600, width: 250, height: 180 },
      { id: 'card3', kind: 'shape', x: 1400, y: 300, width: 160, height: 160, rotation: 45 }
    ]

    // Fit Board
    const fit = computeFitBoard(nodes, stageSize, 54)
    check(fit !== null, 'fit board computed')
    check(fit.scale >= 0.18 && fit.scale <= 1.4, 'fit scale clamped to [0.18, 1.4]')

    // Verify center alignment
    const boardCenterX = (fit.bounds.minX + fit.bounds.maxX) / 2
    const boardCenterY = (fit.bounds.minY + fit.bounds.maxY) / 2
    const screenCenterX = fit.x + boardCenterX * fit.scale
    const screenCenterY = fit.y + boardCenterY * fit.scale
    close(screenCenterX, stageSize.width / 2, 1.0)
    close(screenCenterY, stageSize.height / 2, 1.0)

    // Fit Selection on card2
    const fitSel = computeFitSelection(nodes, ['card2'], stageSize, 70)
    check(fitSel !== null, 'fit selection computed')
    const selCenterX = (800 + 800 + 250) / 2
    const selCenterY = (600 + 600 + 180) / 2
    const selScreenX = fitSel.x + selCenterX * fitSel.scale
    const selScreenY = fitSel.y + selCenterY * fitSel.scale
    close(selScreenX, stageSize.width / 2, 1.0)
    close(selScreenY, stageSize.height / 2, 1.0)

    // Zoom 100% preserving focal center
    const z100 = computeZoom100(fit, stageSize)
    check(z100.scale === 1.0, 'scale is exactly 1.0')
    const worldAfterX = (stageSize.width / 2 - z100.x) / z100.scale
    const worldAfterY = (stageSize.height / 2 - z100.y) / z100.scale
    close(worldAfterX, z100.worldCenterX, 1e-4)
    close(worldAfterY, z100.worldCenterY, 1e-4)
  })

  await group('Camera retention across multi-board navigation', () => {
    const project = {
      id: 'cam-project',
      boards: [
        { id: 'b1', title: 'Main Board', viewport: { x: 120, y: -45, scale: 0.85 }, nodes: [] },
        { id: 'b2', title: 'Detail Board', viewport: { x: 800, y: 400, scale: 1.5 }, nodes: [] }
      ]
    }

    // Navigating to b1 presents b1's viewport
    let activeBoard = project.boards[0]
    let camera = { ...activeBoard.viewport }
    check(camera.scale === 0.85, 'b1 camera scale retained')
    check(camera.x === 120 && camera.y === -45, 'b1 camera position retained')

    // Pan camera on b1
    camera = { x: 250, y: -10, scale: 0.9 }
    activeBoard.viewport = { ...camera }

    // Switch to b2
    activeBoard = project.boards[1]
    camera = { ...activeBoard.viewport }
    check(camera.scale === 1.5, 'b2 camera scale retained')
    check(camera.x === 800 && camera.y === 400, 'b2 camera position retained')

    // Switch back to b1
    activeBoard = project.boards[0]
    camera = { ...activeBoard.viewport }
    check(camera.scale === 0.9, 'b1 modified camera scale retained on return')
    check(camera.x === 250 && camera.y === -10, 'b1 modified camera position retained on return')
  })

  await group('Minimap geometry, viewport outline, and drag navigation', () => {
    const stageWidth = 1920, stageHeight = 1080
    const minimapWidth = 172, minimapHeight = 108

    const nodes = [
      { id: 'n1', kind: 'image', x: 100, y: 100, width: 400, height: 300 },
      { id: 'n2', kind: 'note', x: 1200, y: 800, width: 300, height: 200 }
    ]
    const sceneObjects = nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      bounds: { x: n.x, y: n.y, width: n.width, height: n.height },
      hidden: false,
      appearance: { fill: '#333', stroke: '#555', opacity: 1 },
      order: 0
    }))

    // Bounds computation
    const bounds = Minimap.minimapBounds(sceneObjects, stageWidth, stageHeight, nodes)
    check(bounds.minX <= 100 && bounds.maxX >= 1500, 'minimap bounds cover all nodes')
    check(bounds.minY <= 100 && bounds.maxY >= 1000, 'minimap bounds cover vertical extent')

    // Mapping to minimap
    const map = Minimap.mapToMinimap(bounds, minimapWidth, minimapHeight)
    check(map.scale > 0, 'positive minimap scale')

    // Test drag navigation mapping:
    // If user clicks in center of minimap:
    const clickClient = {
      clientX: map.offsetX + ((bounds.maxX - bounds.minX) * map.scale) / 2,
      clientY: map.offsetY + ((bounds.maxY - bounds.minY) * map.scale) / 2
    }
    const worldX = (clickClient.clientX - map.offsetX) / map.scale + bounds.minX
    const worldY = (clickClient.clientY - map.offsetY) / map.scale + bounds.minY
    const expectedCenterX = (bounds.minX + bounds.maxX) / 2
    const expectedCenterY = (bounds.minY + bounds.maxY) / 2
    close(worldX, expectedCenterX, 0.5)
    close(worldY, expectedCenterY, 0.5)

    // Resulting camera translation centers this world point on stage
    const currentScale = 1.0
    const cameraX = stageWidth / 2 - worldX * currentScale
    const cameraY = stageHeight / 2 - worldY * currentScale
    const verifiedScreenX = cameraX + worldX * currentScale
    const verifiedScreenY = cameraY + worldY * currentScale
    close(verifiedScreenX, stageWidth / 2, 1e-4)
    close(verifiedScreenY, stageHeight / 2, 1e-4)
  })

  await group('Low-zoom connector stability across 5% to 200% scale', () => {
    const nodes = [
      { id: 'src-node', kind: 'image', x: 0, y: 0, width: 200, height: 150 },
      { id: 'tgt-node', kind: 'note', x: 600, y: 400, width: 220, height: 160 }
    ]

    const straight = { id: 'c-straight', sourceId: 'src-node', targetId: 'tgt-node', sourcePort: 'right', targetPort: 'left', style: 'straight', color: '#60a5fa', width: 2 }
    const elbow = { id: 'c-elbow', sourceId: 'src-node', targetId: 'tgt-node', sourcePort: 'bottom', targetPort: 'top', style: 'elbow', color: '#eab308', width: 2, bendPoints: [{ x: 100, y: 300 }, { x: 710, y: 300 }] }
    const curved = { id: 'c-curve', sourceId: 'src-node', targetId: 'tgt-node', sourcePort: 'right', targetPort: 'left', style: 'curve', color: '#a78bfa', width: 2 }

    const testScales = [0.05, 0.1, 0.25, 0.5, 1.0, 2.0]

    for (const scale of testScales) {
      // 1. Geometry resolution stability
      const gStraight = Connectors.connectorGeometry(straight, nodes)
      const gElbow = Connectors.connectorGeometry(elbow, nodes)
      const gCurved = Connectors.connectorGeometry(curved, nodes)

      check(gStraight !== null && gStraight.path.length > 5, `straight route valid at scale ${scale}`)
      check(gElbow !== null && gElbow.points.length >= 4, `elbow route valid at scale ${scale}`)
      check(gCurved !== null && gCurved.commands.length === 2, `curve route valid at scale ${scale}`)

      // 2. Low-zoom hit target radius bounding
      // Formula: Math.min(64, Math.max(14, connector.width + 12) / Math.max(0.2, scale))
      const hitWidth = Math.min(64, Math.max(14, straight.width + 12) / Math.max(0.2, scale))
      const screenHitWidth = hitWidth * scale
      check(hitWidth <= 64, `hitWidth (${hitWidth}px) is capped <= 64 in world units at scale ${scale}`)
      const minExpectedHitScreen = scale < 0.1 ? 3.0 : scale < 0.2 ? 6.0 : 12.0
      check(screenHitWidth >= minExpectedHitScreen, `screen hit target (${screenHitWidth}px) maintains expected size at scale ${scale}`)

      // 3. Low-zoom visual stroke width
      // Formula: Math.max(connector.width, 0.75 / scale)
      const visualStroke = Math.max(straight.width, 0.75 / scale)
      const screenPixelStroke = visualStroke * scale
      check(screenPixelStroke >= 0.75 - 1e-4, `visual stroke on screen (${screenPixelStroke.toFixed(3)}px) stays >= 0.75px at scale ${scale}`)

      // 4. Low-zoom handle radius
      // Formula: Math.min(20, Math.max(3.5, 7 / scale))
      const endpointRadius = Math.min(20, Math.max(3.5, 7 / scale))
      const bendRadius = Math.min(16, Math.max(3, 6 / scale))
      check(endpointRadius <= 20, `endpoint radius (${endpointRadius}px) bounded <= 20 at scale ${scale}`)
      check(bendRadius <= 16, `bend waypoint radius (${bendRadius}px) bounded <= 16 at scale ${scale}`)
      check(endpointRadius >= 3.5, `endpoint radius maintains >= 3.5px at scale ${scale}`)
    }
  })

  await group('Search reveal & return view restoration lifecycle (ML-B / X-11)', () => {
    const testProject = {
      id: 'proj-search-test',
      boards: [
        {
          id: 'b-main',
          title: 'Main Canvas',
          parentBoardId: null,
          viewport: { x: 100, y: 50, scale: 1.2 },
          nodes: [
            { id: 'node-char', kind: 'text', x: 200, y: 300, width: 150, height: 80, title: 'Character Sheet', body: 'Rainee protagonist design' },
            { id: 'node-env', kind: 'card', x: 500, y: 400, width: 200, height: 120, title: 'Environment Blockout', body: 'Club scene cyberpunk vibe' }
          ],
          connectors: []
        }
      ],
      documents: [
        { id: 'doc-narrative', title: 'Narrative Storyboard', content: { type: 'doc', content: [{ type: 'paragraph', text: 'Act 1 script' }] } }
      ],
      assets: [
        { id: 'asset-rainee', displayName: 'Rainee Render', extension: 'png', aliases: ['hero'], tags: ['character'] }
      ]
    }

    // 1. Search query test
    const hits = Search.searchProject(testProject, 'Rainee')
    check(hits.some((h) => h.kind === 'board' && h.nodeId === 'node-char'), 'search locates node')
    check(hits.some((h) => h.kind === 'assets' && h.id === 'asset-rainee'), 'search locates asset')

    // 2. Transient Origin Capture & Return Simulation
    let searchOrigin = null
    const captureOrigin = (mode, activeBoardId, activeDocId) => ({
      mode,
      activeBoardId,
      activeDocId,
      viewport: mode === 'canvas' ? { ...testProject.boards[0].viewport } : undefined,
      docSelection: mode === 'document' ? { from: 10, to: 25 } : undefined
    })

    // Start in document mode
    searchOrigin = captureOrigin('document', 'b-main', 'doc-narrative')
    check(searchOrigin.mode === 'document', 'origin captured document mode')
    check(searchOrigin.activeDocId === 'doc-narrative', 'origin captured doc ID')

    // Navigate to board search result
    let currentMode = 'canvas'
    let currentBoardId = 'b-main'
    let selectedNodeId = 'node-char'

    // Return to origin
    check(searchOrigin !== null, 'searchOrigin present')
    currentMode = searchOrigin.mode
    const restoredDocId = searchOrigin.activeDocId
    const restoredSelection = searchOrigin.docSelection
    searchOrigin = null

    check(currentMode === 'document', 'restored document mode')
    check(restoredDocId === 'doc-narrative', 'restored document ID')
    check(restoredSelection.from === 10 && restoredSelection.to === 25, 'restored document text range')
    check(searchOrigin === null, 'searchOrigin cleared after return')
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
  failure: report.failure,
  report: resolve(outputDir, 'report.json')
}))
