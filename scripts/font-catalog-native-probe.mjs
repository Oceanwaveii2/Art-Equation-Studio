import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// Read-only native family resolution. No browser, canvas, GPU or font install.
const helper = process.env.NATIVE_FONT_RESOLVER || 'D:/0/AE2Target-20261007/release/examples/audit-font-resolver.exe'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const records = []
for (const family of ['Source Serif 4', 'Iowan Old Style', 'Inter', 'Garamond', 'Segoe UI', 'Arial', 'Georgia']) {
  const request = { family, weight: 400, italic: false }
  const result = await new Promise(resolve => {
    const child = execFile(helper, [], { timeout: 20000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => resolve({ error, stdout, stderr }))
    child.stdin.end(JSON.stringify({ command: 'resolve_system_font', request }))
  })
  if (result.error) {
    records.push({ request, result: result.stderr.trim().startsWith('FONT_FAMILY_NOT_FOUND:') ? 'FAMILY_NOT_FOUND' : 'ERROR', error: result.stderr.trim() || result.error.message })
    continue
  }
  const receipt = JSON.parse(result.stdout)
  const bytes = Buffer.from(receipt.bytesBase64, 'base64')
  if (!bytes.length || hash(bytes) !== receipt.contentHash) throw new Error(`Invalid native face byte/hash receipt for ${family}`)
  const { bytesBase64, ...metadata } = receipt
  records.push({ request, result: 'RESOLVED', receipt: metadata, byteLength: bytes.length, byteHashVerified: true })
}
const evidence = {
  generatedAt: new Date().toISOString(),
  scope: 'Read-only standalone compiled Fontique helper on this device; no browser/GPU or font installation',
  helper: { path: helper, sha256: hash(await fs.readFile(helper)) },
  resolverSource: { path: 'desktop-app/src-tauri/src/font_resolver.rs', sha256: hash(await fs.readFile('src-tauri/src/font_resolver.rs')) },
  records,
  qualification: 'This probes the named helper binary. It does not establish packaged EXE/helper source equivalence, browser-rendered faces, DOM/engine equality or native P1 UI acceptance.',
  status: records.some(record => record.result === 'ERROR') ? 'ERROR' : 'READ_ONLY_PROBE_COMPLETE',
}
const output = path.resolve('../evidence/font-catalog-native-probe-20261008.json')
await fs.writeFile(output, JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify({ output, status: evidence.status, families: records.map(record => ({ family: record.request.family, result: record.result, resolvedFamily: record.receipt?.resolvedFamily })) }))
if (evidence.status === 'ERROR') process.exitCode = 1
