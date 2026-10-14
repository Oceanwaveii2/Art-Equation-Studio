import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import ts from 'typescript'

// Actual budget, independent pressure/callback oracles; no browser or live data.
const source = await readFile('src/canvas-engine/resourceBudget.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { CanvasResourceBudget } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const report = { schema: 'art-equation.resource-acceptance', measuredAt: new Date().toISOString(), sourceSha256: createHash('sha256').update(source).digest('hex'), tests: [], observations: {}, limitations: ['In-memory policy/controller checks are not physical GPU exhaustion, full-App performance or native WebView2 acceptance.'] }
const limits = (total = 100, retained = 20) => ({ total, pools: { 'tile-atlas': 80, 'tile-surface': 40, retained } })
const acquire = (b, key, pool, bytes, extra = {}) => b.acquire({ owner: {}, key, pool, bytes, ...extra })
const cap = b => { const s = b.snapshot(); assert(s.bytes <= s.limit); assert(Object.values(s.pools).every(p => p.bytes <= p.limit)); assert.equal(s.bytes, Object.values(s.pools).reduce((sum, p) => sum + p.bytes, 0)); return s }
const test = (name, run) => { try { const detail = run(); report.tests.push({ name, passed: true, ...(detail === undefined ? {} : { detail }) }); console.log('PASS ' + name) } catch (error) { report.tests.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message) } }

test('pool pressure preserves unrelated old resources', () => {
  const b = new CanvasResourceBudget(limits()), evicted = []
  const atlas = acquire(b, 'atlas', 'tile-atlas', 50, { evict: () => evicted.push('atlas') })
  acquire(b, 'card', 'retained', 20, { evict: () => evicted.push('card') })
  assert(acquire(b, 'next', 'retained', 1)); assert.deepEqual(evicted, ['card']); assert.equal(b.snapshot().pools['tile-atlas'].bytes, atlas.bytes); cap(b)
})
test('total pressure retains deterministic priority then LRU ordering', () => {
  const b = new CanvasResourceBudget(limits(50, 40)), evicted = []
  const old = acquire(b, 'old', 'retained', 10, { priority: 1, evict: () => evicted.push('old') })
  acquire(b, 'low-priority', 'tile-atlas', 20, { priority: 0, evict: () => evicted.push('low-priority') })
  acquire(b, 'new', 'retained', 10, { priority: 1, evict: () => evicted.push('new') }); old.touch()
  assert(acquire(b, 'requested', 'tile-surface', 30, { pinned: true })); assert.deepEqual(evicted, ['low-priority']); cap(b)
})
test('combined pressure first frees constrained pool then only necessary global bytes', () => {
  const b = new CanvasResourceBudget(limits(50, 20)), evicted = []
  acquire(b, 'atlas', 'tile-atlas', 30, { evict: () => evicted.push('atlas') })
  acquire(b, 'card', 'retained', 20, { evict: () => evicted.push('card') })
  assert(acquire(b, 'next', 'retained', 15, { pinned: true })); assert.deepEqual(evicted, ['card']); assert.equal(cap(b).bytes, 45)
})
test('denial leaves every victim and callback unchanged', () => {
  const b = new CanvasResourceBudget(limits(30, 20)), evicted = []
  acquire(b, 'idle', 'retained', 10, { evict: () => evicted.push('idle') }); acquire(b, 'active', 'retained', 10, { pinned: true })
  assert.equal(acquire(b, 'denied', 'retained', 15), undefined); assert.deepEqual(evicted, []); assert.equal(cap(b).bytes, 20); assert.equal(b.snapshot().denied, 1)
})
test('eviction callback sees committed reservation and cannot overfill budget', () => {
  const b = new CanvasResourceBudget(limits(10, 10)); let during, nested
  acquire(b, 'old', 'retained', 10, { evict: () => { during = cap(b); nested = acquire(b, 'nested', 'retained', 10, { pinned: true }) } })
  const next = acquire(b, 'next', 'retained', 8, { pinned: true })
  assert(next); assert.equal(during.bytes, 8); assert.equal(nested, undefined); assert.equal(cap(b).bytes, 8)
})
test('subscriber mutation cannot overfill acquire transaction', () => {
  const b = new CanvasResourceBudget(limits(10, 10)); acquire(b, 'old', 'retained', 10); let once = false, nested
  b.subscribe(() => { cap(b); if (!once) { once = true; nested = acquire(b, 'nested', 'retained', 10, { pinned: true }) } })
  assert(acquire(b, 'next', 'retained', 8, { pinned: true })); assert.equal(nested, undefined); assert.equal(cap(b).bytes, 8)
})
test('resize commits grown reservation before victim callbacks', () => {
  const b = new CanvasResourceBudget(limits(20, 20)); const first = acquire(b, 'first', 'retained', 10, { pinned: true }); let during, nested
  acquire(b, 'victim', 'retained', 10, { evict: () => { during = cap(b); nested = acquire(b, 'nested', 'retained', 10, { pinned: true }) } })
  assert(first.resize(15)); assert.equal(during.bytes, 15); assert.equal(nested, undefined); assert.equal(first.bytes, 15); assert.equal(cap(b).bytes, 15)
})
test('failed resize retains original lease and every victim', () => {
  const b = new CanvasResourceBudget(limits(20, 20)), evicted = []
  const first = acquire(b, 'first', 'retained', 10, { pinned: true }); acquire(b, 'victim', 'retained', 10, { pinned: true, evict: () => evicted.push('victim') })
  assert.equal(first.resize(15), false); assert.equal(first.bytes, 10); assert.deepEqual(evicted, []); assert.equal(cap(b).bytes, 20)
})
test('throwing callbacks do not strand allocation or skip remaining callbacks', () => {
  const b = new CanvasResourceBudget(limits(20, 20)), called = []; const before = console.error; console.error = () => {}
  try {
    acquire(b, 'a', 'retained', 10, { evict: () => { called.push('a'); throw new Error('dispose failed') } })
    acquire(b, 'b', 'retained', 10, { evict: () => called.push('b') }); b.subscribe(() => { throw new Error('listener failed') })
    const next = acquire(b, 'next', 'retained', 15, { pinned: true }); assert(next); assert.deepEqual(called, ['a', 'b']); assert.equal(cap(b).bytes, 15); next.release(); assert.equal(cap(b).bytes, 0); assert(b.snapshot().callbackErrors >= 2)
  } finally { console.error = before }
})
test('runtime unknown pool is refused before creating an unaccounted allocation', () => { const b = new CanvasResourceBudget(); assert.throws(() => acquire(b, 'bad', 'unknown', 4)); assert.equal(cap(b).bytes, 0) })
test('invalid priority is refused before touching valid resources', () => { const b = new CanvasResourceBudget(); assert.throws(() => acquire(b, 'bad', 'retained', 4, { priority: NaN })); assert.equal(cap(b).bytes, 0) })
for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) test(`invalid byte count ${String(value)} fails before mutation`, () => { const b = new CanvasResourceBudget(); assert.throws(() => acquire(b, 'bad', 'retained', value)); assert.equal(cap(b).bytes, 0) })
for (const value of [-1, NaN, Infinity, 1.5]) test(`invalid configured cap ${String(value)} is refused`, () => { assert.throws(() => new CanvasResourceBudget(limits(value))) })
test('limits are copied and immutable after construction', () => { const input = limits(); const b = new CanvasResourceBudget(input); input.total = 999; input.pools.retained = 999; assert.equal(b.limits.total, 100); assert.equal(b.limits.pools.retained, 20); assert.throws(() => { b.limits.pools.retained = 900 }); cap(b) })
test('releaseOwner batches only matching identity and preserves other resources', () => { const b = new CanvasResourceBudget(limits()), a = {}, c = {}; b.acquire({ owner: a, key: 'a', pool: 'retained', bytes: 5 }); b.acquire({ owner: a, key: 'b', pool: 'tile-atlas', bytes: 5 }); b.acquire({ owner: c, key: 'c', pool: 'retained', bytes: 5 }); b.releaseOwner(a); assert.equal(cap(b).bytes, 5); assert.equal(b.snapshot().allocations, 1) })
test('retired leases cannot mutate accounting or emit false changes', () => { const b = new CanvasResourceBudget(limits()), a = acquire(b, 'a', 'retained', 5); a.release(); const version = b.snapshot().version; assert.equal(a.resize(10), false); a.touch(); a.setPinned(true); a.release(); assert.equal(b.snapshot().version, version); assert.equal(cap(b).bytes, 0) })
test('repeated allocation/resize/pin/release pressure never exceeds limits', () => {
  const b = new CanvasResourceBudget(limits(180, 70)), entries = [], owner = {}, pools = ['retained', 'tile-atlas', 'tile-surface']; let seed = 1937, high = 0
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return seed >>> 0 }
  for (let i = 0; i < 10000; i++) {
    const action = random() % 5, entry = entries.length ? entries[random() % entries.length] : undefined
    if (action === 0 || !entry) { const value = b.acquire({ owner, key: String(i), pool: pools[random() % pools.length], bytes: random() % 50, pinned: random() % 4 === 0, priority: random() % 5 }); if (value) entries.push(value) }
    else if (action === 1) entry.resize(random() % 85)
    else if (action === 2) entry.setPinned(Boolean(random() % 2))
    else if (action === 3) entry.release()
    else entry.touch()
    const s = cap(b); high = Math.max(high, s.bytes)
  }
  const before = cap(b); b.releaseOwner(owner); assert.equal(cap(b).bytes, 0); assert.equal(b.snapshot().allocations, 0); return { operations: 10000, highWaterBytes: high, evictions: before.evictions, denied: before.denied }
})
report.passed = report.tests.every(t => t.passed); report.passedTests = report.tests.filter(t => t.passed).length
if (process.argv[2]) { const target = resolve(process.argv[2]); await mkdir(target, { recursive: true }); await writeFile(resolve(target, 'RESOURCE_POLICY_ACCEPTANCE.json'), JSON.stringify(report, null, 2)) }
console.log(JSON.stringify({ passed: report.passed, passedTests: report.passedTests, totalTests: report.tests.length, sourceSha256: report.sourceSha256 })); if (!report.passed) process.exitCode = 1
