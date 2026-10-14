import assert from 'node:assert/strict'
import { CanvasResourceBudget } from '../src/canvas-engine/resourceBudget.ts'

const MiB = 1024 * 1024
const limits = { total: 12 * MiB, pools: { 'tile-atlas': 8 * MiB, 'tile-surface': 4 * MiB, retained: 4 * MiB } }
const budget = new CanvasResourceBudget(limits), ownerA = {}, ownerB = {}, events = []
const old = budget.acquire({ owner: ownerA, key: 'old', pool: 'retained', bytes: 2 * MiB, evict: () => events.push('old') })
const newer = budget.acquire({ owner: ownerA, key: 'newer', pool: 'retained', bytes: 2 * MiB, priority: 1, evict: () => events.push('newer') })
assert(old && newer)
old.touch()
const replacement = budget.acquire({ owner: ownerB, key: 'replacement', pool: 'retained', bytes: 2 * MiB })
assert(replacement); assert.deepEqual(events, ['old'], 'lower-priority idle allocation evicts first')
newer.setPinned(true)
assert.equal(budget.acquire({ owner: ownerB, key: 'blocked', pool: 'retained', bytes: 3 * MiB }), undefined, 'active allocation cannot be evicted')
newer.setPinned(false)
assert(replacement.resize(3 * MiB), 'resize can evict idle allocations')
assert.deepEqual(events, ['old', 'newer'])
const atlas = budget.acquire({ owner: ownerA, key: 'atlas', pool: 'tile-atlas', bytes: 8 * MiB, pinned: true })
assert(atlas)
assert.equal(budget.acquire({ owner: ownerB, key: 'too-large', pool: 'tile-atlas', bytes: 1 }), undefined, 'pool cap remains independent of total headroom')
budget.releaseOwner(ownerA)
assert.equal(budget.snapshot().pools['tile-atlas'].bytes, 0)
replacement.release(); replacement.release()
const snapshot = budget.snapshot()
assert.equal(snapshot.bytes, 0); assert.equal(snapshot.allocations, 0); assert.equal(snapshot.evictions, 2); assert.equal(snapshot.denied, 2)
assert.throws(() => budget.acquire({ owner: {}, key: 'bad', pool: 'retained', bytes: -1 }))
console.log('P9 resource budget: PASS', snapshot)
