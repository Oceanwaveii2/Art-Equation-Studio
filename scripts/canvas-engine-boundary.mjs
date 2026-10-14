import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

const root = resolve('src', 'canvas-engine')
const files = (await readdir(root, { recursive: true })).filter((name) => extname(name) === '.ts')
assert(files.length > 0, 'canvas-engine must contain TypeScript source files')

for (const name of files) {
  const path = resolve(root, name)
  const source = await readFile(path, 'utf8')
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
  for (const specifier of imports) {
    assert(specifier.startsWith('.'), `${name}: canvas-engine core cannot import package or application module ${specifier}`)
    const target = resolve(dirname(path), specifier)
    assert(target.startsWith(root), `${name}: canvas-engine core import escapes its boundary: ${specifier}`)
  }
}

console.log(`canvas engine boundary: PASS (${files.length} core files)`)
