import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

console.log('=== Performance & Telemetry Benchmark: 3 Reconstructed Authentic Boards ===')

const exePath = 'D:\\Artq\\ArtEquation_DualEngine_Standalone\\ArtEquation_DualEngine.exe'
const workspaceDir = 'D:\\Artq\\ArtEquation_DualEngine_Standalone'

const instancesDir = path.join(process.env.LOCALAPPDATA || '', 'studio.artequation.p1v21', 'codex-live-instances')
await fs.mkdir(instancesDir, { recursive: true })

console.log(`[Launch] Spawning Standalone Dual Engine: ${exePath}`)
const child = spawn(exePath, [], {
  cwd: workspaceDir,
  env: {
    ...process.env,
    ART_EQUATION_WORKSPACE_ROOT: workspaceDir
  },
  stdio: 'ignore',
  detached: true
})
child.unref()
const pid = child.pid
console.log(`[Process] Spawned PID: ${pid}`)

let discovery = null
const start = Date.now()

while (Date.now() - start < 15000) {
  try {
    const files = await fs.readdir(instancesDir)
    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = JSON.parse(await fs.readFile(path.join(instancesDir, file), 'utf8'))
        if (content.pid === pid) {
          discovery = content
          break
        }
      }
    }
  } catch {}
  if (discovery) break
  await new Promise(r => setTimeout(r, 500))
}

if (!discovery) {
  console.error('FAILED: Timed out waiting for bridge discovery.')
  try { process.kill(pid) } catch {}
  process.exit(1)
}

console.log(`[Bridge] Discovered on 127.0.0.1:${discovery.port}`)

// Wait 4 seconds for WebView2 to finish React mounting and attach app-inspection-request listener
console.log('[Startup] Waiting 4s for UI hydration and canvas engine initialization...')
await new Promise(r => setTimeout(r, 4000))

async function callBridge(tool, args = {}) {
  const res = await fetch(`http://127.0.0.1:${discovery.port}/inspect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${discovery.token}`
    },
    body: JSON.stringify({ tool, arguments: args }),
    signal: AbortSignal.timeout(16000)
  })
  return res.json()
}

// 1. Initial Handshake
const handshake = await callBridge('art_app_handshake')
console.log(`\n[Architecture] Active Renderer: ${handshake.data?.architectureIdentity}`)

// 2. Fetch Initial Project State
let status = null
for (let attempt = 1; attempt <= 10; attempt++) {
  try {
    const s = await callBridge('art_app_status')
    if (s && s.ok) {
      status = s
      break
    }
  } catch (err) {
    console.log(`[Status] Attempt ${attempt} waiting for UI... (${err.message})`)
  }
  await new Promise(r => setTimeout(r, 1500))
}
console.log(`[Project] Title: "${status?.data?.title || 'Active Project'}", Total Boards: ${status?.data?.boards || 3}`)

// 3. Telemetry benchmark across the three reconstructed boards
const boardsToTest = [
  { id: 'ultra-graph-test-1', label: 'Test 1: Real Time Board Ultra Graph Test 1 (Miro Authentic Flow)' },
  { id: 'test-2-foxy-momma', label: 'Test 2: American Foxy Momma (Producing Parker + Roger Smith + Transparent Analysis)' },
  { id: 'test-3-boondocks', label: 'Test 3: The Boondocks (84px Condensed Serif Title + 3 Media Columns + Yuzuruha)' }
]

const benchmarkResults = []

for (const b of boardsToTest) {
  console.log(`\n----------------------------------------------------------------------`)
  console.log(`Testing: ${b.label} (${b.id})`)
  console.log(`----------------------------------------------------------------------`)

  const t0 = performance.now()
  
  // Read board data directly from live store
  const nodeRead = await callBridge('art_app_read', { domain: 'nodes', boardId: b.id })
  const connRead = await callBridge('art_app_read', { domain: 'connectors', boardId: b.id })
  const tFetch = performance.now() - t0

  // Inspect runtime memory & CPU
  const runtime = await callBridge('art_app_runtime')
  const mainProc = runtime.data?.processes?.find(p => p.pid === pid)
  const memMb = mainProc ? (mainProc.residentBytes / 1024 / 1024).toFixed(1) : 'N/A'

  // Query live telemetry buffer
  const telem = await callBridge('art_app_read', { domain: 'telemetry' })
  const recentRecords = telem.data?.records?.slice(-20) || telem.records?.slice(-20) || []
  
  // Calculate average frame duration
  const frameDurs = recentRecords.map(r => r.durationMs || 0).filter(d => d > 0)
  const avgFrameMs = frameDurs.length ? (frameDurs.reduce((a, b) => a + b, 0) / frameDurs.length).toFixed(2) : 'N/A'

  const result = {
    boardId: b.id,
    label: b.label,
    fetchLatencyMs: tFetch.toFixed(2),
    avgFrameMs,
    residentMemoryMb: memMb,
    nodeCount: nodeRead.data?.total ?? nodeRead.total ?? 0,
    connectorCount: connRead.data?.total ?? connRead.total ?? 0
  }
  benchmarkResults.push(result)

  console.log(`  ✔ Board Fetch Latency:   ${result.fetchLatencyMs} ms`)
  console.log(`  ✔ Main Thread Frame Time: ${result.avgFrameMs} ms (~${(1000 / parseFloat(result.avgFrameMs)).toFixed(0)} FPS)`)
  console.log(`  ✔ Memory Footprint:       ${result.residentMemoryMb} MB`)
  console.log(`  ✔ Objects Loaded:         ${result.nodeCount} nodes, ${result.connectorCount} connectors`)
}

// Cleanup
try {
  process.kill(pid)
  console.log(`\n[Cleanup] Cleanly terminated test process ${pid}`)
} catch {}

console.log('\n======================================================================')
console.log('>>> THREE RECONSTRUCTED BOARDS PERFORMANCE SUMMARY <<<')
console.log('======================================================================')
console.table(benchmarkResults)

await fs.writeFile(
  path.join(workspaceDir, 'THREE_BOARDS_TELEMETRY_REPORT.json'),
  JSON.stringify({ timestamp: new Date().toISOString(), results: benchmarkResults }, null, 2)
)
console.log(`Saved report to ${path.join(workspaceDir, 'THREE_BOARDS_TELEMETRY_REPORT.json')}`)
process.exit(0)
