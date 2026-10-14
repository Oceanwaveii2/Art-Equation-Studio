import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'

const source = await readFile('src/canvas-engine/spatialIndex.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { UniformGridSpatialIndex: Index } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const checks = []
const check = (name, value) => { checks.push({ name, passed: Boolean(value) }); assert(value, name) }
const record = (id, x, y, width, height) => ({ id, bounds: { x, y, width, height } })
const ids = values => values.map(value => value.id).sort().join(',')
const index = new Index([record('small', 0, 0, 10, 10), record('enormous', -1e10, -1e10, 2e10, 2e10), record('unsafe-cell', 1e100, 1e100, 10, 10)])
check('huge records do not enumerate their cells', index.cellCount === 1 && index.size === 3)
check('overflow record still intersects an ordinary viewport', ids(index.query({ x: 0, y: 0, width: 10, height: 10 })) === 'enormous,small')
check('unsafe integer cell coordinates retain exact finite geometry', ids(index.query({ x: 1e100, y: 1e100, width: 10, height: 10 })) === 'unsafe-cell')
check('huge viewport scans membership without losing ordinary records', ids(index.query({ x: -1e11, y: -1e11, width: 2e11, height: 2e11 })) === 'enormous,small')
index.upsert(record('invalid', NaN, 0, 1, 1))
check('unknown bounds stay conservatively discoverable for caller validation', ids(index.query({ x: 0, y: 0, width: 1, height: 1 })) === 'enormous,invalid,small')
for (const bounds of [{ x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: Infinity, height: 1 }, { x: 0, y: 0, width: -1, height: 1 }, { x: 1e308, y: 0, width: 1e308, height: 1 }]) {
  check('invalid query returns without enumerating unbounded cells', index.query(bounds).length === 0)
}
const fork = index.fork([record('small', 1000, 1000, 10, 10), record('enormous', 2000, 2000, 10, 10)])
check('fork reconciles overflow membership independently', ids(fork.query({ x: 0, y: 0, width: 1, height: 1 })) === '' && ids(index.query({ x: 0, y: 0, width: 1, height: 1 })) === 'enormous,invalid,small')
check('fork removes abandoned overflow/invalid records', fork.size === 2 && fork.get('unsafe-cell') === undefined)
fork.upsert(record('enormous', -1e10, -1e10, 2e10, 2e10))
check('ordinary-to-overflow update removes old cell membership', ids(fork.query({ x: 0, y: 0, width: 1, height: 1 })) === 'enormous')
fork.upsert(record('enormous', 4000, 4000, 10, 10))
check('overflow-to-ordinary update removes old overflow membership', fork.query({ x: 0, y: 0, width: 1, height: 1 }).length === 0)
check('remove clears overflow membership', index.remove('enormous') && !index.query({ x: 0, y: 0, width: 1, height: 1 }).some(value => value.id === 'enormous'))

let seed = 7
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
const records = Array.from({ length: 500 }, (_, n) => record(`r${n}`, random() * 10000 - 5000, random() * 10000 - 5000, random() * 1200, random() * 1200))
records.push(record('zero', 0, 0, 0, 0), record('giant', -1e8, -1e8, 2e8, 2e8))
const before = JSON.stringify(records), randomIndex = new Index(records)
const intersects = (a, b) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
const started = performance.now()
for (let n = 0; n < 100; n++) {
  const query = { x: random() * 12000 - 6000, y: random() * 12000 - 6000, width: random() * 10000, height: random() * 10000 }
  check(`actual index matches linear intersection oracle ${n}`, ids(randomIndex.query(query)) === ids(records.filter(value => intersects(value.bounds, query))))
}
check('source geometry is never clamped or mutated', JSON.stringify(records) === before)
check('invalid cell size rejects before indexing', [0, NaN, Infinity, -1].every(size => { try { new Index([], size); return false } catch { return true } }))
console.log(JSON.stringify({ passed: true, checks: checks.length, sourceSha256: createHash('sha256').update(source).digest('hex'), oracleQueryMs: performance.now() - started,
  limits: ['Cell enumeration is bounded per record/query; very large records use a finite membership scan.', 'Malformed record bounds are conservatively returned for caller validation; malformed viewport queries return empty.'] }, null, 2))
