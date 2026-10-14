import assert from 'node:assert/strict'
import { plannedAtlasPages, ATLAS_PAGE_RESERVE } from '../src/project-b/p0-surface/atlasPlan.ts'
assert.equal(plannedAtlasPages([]),0)
assert.equal(plannedAtlasPages([{width:4094,height:4094}]),1)
assert.throws(()=>plannedAtlasPages([{width:4096,height:1}]),/GPU_IMAGE_ATLAS_FULL/)
assert.equal(plannedAtlasPages(Array.from({length:4},()=>({width:4094,height:4094}))),4)
assert.throws(()=>plannedAtlasPages(Array.from({length:5},()=>({width:4094,height:4094}))),/budget exceeded/)
assert.equal(plannedAtlasPages([{width:2046,height:2046},{width:2046,height:2046},{width:4094,height:2046}]),1)
assert.equal(plannedAtlasPages([{width:4094,height:2046},{width:2046,height:2046},{width:2046,height:2046}]),1)
assert.equal(ATLAS_PAGE_RESERVE,201326592)
assert.ok(2*ATLAS_PAGE_RESERVE>256*1024*1024,'Two pages must exceed the unchanged atlas budget before GPU allocation')
console.log('Atlas admission: PASS (padding, ordered rows, page limits and memory reservation)')
