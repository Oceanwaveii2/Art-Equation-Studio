import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const lockPath = join(root, 'package-lock.json')
const distPath = join(root, 'dist')
const nodeOnlyPackages = ['onnxruntime-node', 'adm-zip', 'sharp']

if (!existsSync(lockPath)) {
  console.error('security scan: package-lock.json is missing')
  process.exit(1)
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const installed = nodeOnlyPackages.flatMap((name) => {
  const packageEntry = lock.packages?.[`node_modules/${name}`]
  return packageEntry ? [{ name, version: packageEntry.version }] : []
})

function collectJavaScript(directory) {
  if (!existsSync(directory)) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectJavaScript(path))
    else if (/\.(?:js|mjs|cjs)$/i.test(entry.name)) files.push(path)
  }
  return files
}

const importPattern = /(?:from|import\s*\(|require\s*\()\s*["'](?:onnxruntime-node|adm-zip|sharp)(?:["'])/g
const bundleReferences = []
for (const path of collectJavaScript(distPath)) {
  const source = readFileSync(path, 'utf8')
  if (importPattern.test(source)) bundleReferences.push(relative(root, path))
  importPattern.lastIndex = 0
}

console.log('security scan: dependency tree')
if (installed.length) {
  for (const entry of installed) console.log(`  ${entry.name}@${entry.version} (transitive Node-side dependency)`)
  console.log('  These packages remain in the npm tree because Transformers.js declares them for its Node export.')
} else {
  console.log('  no Node-side semantic packages found')
}

console.log('security scan: production bundle')
if (bundleReferences.length) {
  console.error(`  FAIL: Node-only package imports found in ${bundleReferences.length} bundle file(s):`)
  for (const path of bundleReferences) console.error(`    ${path}`)
  process.exit(1)
}
console.log('  PASS: no onnxruntime-node, adm-zip, or sharp imports are present in dist/')
console.log('  Browser semantic runtime is therefore isolated from these Node-side packages.')
