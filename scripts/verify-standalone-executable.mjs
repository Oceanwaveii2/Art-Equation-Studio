import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

console.log('=== Verifying Three Tests Loaded in Standalone Dual-Engine Release ===')

const exePath = 'D:\\Artq\\standalone_release\\ArtEquation_DualEngine_Final.exe'
const workspaceDir = 'D:\\Artq\\standalone_release'

const instancesDir = path.join(process.env.LOCALAPPDATA || '', 'studio.artequation.p1v21', 'codex-live-instances')
await fs.mkdir(instancesDir, { recursive: true })

console.log(`Launching: ${exePath}`)
console.log(`Workspace: ${workspaceDir}`)

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
console.log(`Spawned PID: ${pid}`)

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
  console.error('FAILED: Timed out waiting for live discovery registration.')
  process.exit(1)
}

console.log(`Bridge discovery located: port ${discovery.port}, token ${discovery.token.slice(0, 8)}...`)

// Test 1: Native Handshake
console.log('Test 1: Querying art_app_handshake...')
const handshakeRes = await fetch(`http://127.0.0.1:${discovery.port}/inspect`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${discovery.token}`
  },
  body: JSON.stringify({ tool: 'art_app_handshake', arguments: {} })
}).then(r => r.json())

if (!handshakeRes.ok) {
  console.error('FAILED: art_app_handshake failed')
  process.exit(1)
}
console.log('Handshake OK! Native D3D12/Vello core ready.')

// Test 2: UI Status
console.log('Test 2: Querying art_app_status (verifying loaded project & boards)...')
let statusRes = null
const statusStart = Date.now()

while (Date.now() - statusStart < 15000) {
  try {
    statusRes = await fetch(`http://127.0.0.1:${discovery.port}/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${discovery.token}`
      },
      body: JSON.stringify({ tool: 'art_app_status', arguments: {} }),
      signal: AbortSignal.timeout(4000)
    }).then(r => r.json())
    if (statusRes.ok) break
  } catch (err) {
    await new Promise(r => setTimeout(r, 1000))
  }
}

if (!statusRes || !statusRes.ok) {
  console.error('FAILED: art_app_status failed or timed out.')
  try { process.kill(pid) } catch {}
  process.exit(1)
}

console.log(`Project Loaded: "${statusRes.data.title}" (ID: ${statusRes.data.projectId})`)
console.log(`Total Boards Loaded: ${statusRes.data.boards}`)
console.log(`Active Board: ${statusRes.data.ui?.activeBoardId}`)

// Test 3: Verify the three tests via art_app_read
console.log('Test 3: Reading board list to verify Ultra Graph Test 1, Test 2, and Test 3...')
const boardsRes = await fetch(`http://127.0.0.1:${discovery.port}/inspect`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${discovery.token}`
  },
  body: JSON.stringify({ tool: 'art_app_read', arguments: { domain: 'boards' } })
}).then(r => r.json())

if (!boardsRes.ok) {
  console.error('FAILED: art_app_read boards failed')
  try { process.kill(pid) } catch {}
  process.exit(1)
}

const boards = boardsRes.data?.records || []
console.log(`Retrieved ${boards.length} boards from project:`)
const foundTests = {
  test1: boards.find(b => b.id === 'ultra-graph-test-1' || b.title?.includes('Ultra Graph')),
  test2: boards.find(b => b.id === 'test-2-layout' || b.title?.includes('Test 2')),
  test3: boards.find(b => b.id === 'test-3-layout' || b.title?.includes('Test 3') || b.title?.includes('Milanote'))
}

console.log('  [Test 1] Ultra Graph Test 1:', foundTests.test1 ? `FOUND (ID: ${foundTests.test1.id}, Title: "${foundTests.test1.title}")` : 'MISSING')
console.log('  [Test 2] Real Time Board Test 2:', foundTests.test2 ? `FOUND (ID: ${foundTests.test2.id}, Title: "${foundTests.test2.title}")` : 'MISSING')
console.log('  [Test 3] Milanote Test 3:', foundTests.test3 ? `FOUND (ID: ${foundTests.test3.id}, Title: "${foundTests.test3.title}")` : 'MISSING')

const allFound = foundTests.test1 && foundTests.test2 && foundTests.test3

if (!allFound) {
  console.error('FAILED: One or more test boards are missing.')
  try { process.kill(pid) } catch {}
  process.exit(1)
}

console.log('\nSUCCESS: All Three Test Boards Are Fully Loaded in the Dual Engine Application!')

try {
  process.kill(pid)
  console.log(`Cleanly terminated test process ${pid}`)
} catch {}

process.exit(0)
