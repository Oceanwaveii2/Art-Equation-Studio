import assert from 'node:assert/strict'
import { FrameScheduler, SampleRing } from '../src/canvas-engine/frameScheduler.ts'
import { BackdropInvalidation } from '../src/canvas-engine/renderInvalidation.ts'
import { UniformGridSpatialIndex } from '../src/canvas-engine/spatialIndex.ts'

let nextId = 1
const callbacks = new Map()
const clock = { request: (callback) => { const id = nextId++; callbacks.set(id, callback); return id }, cancel: (id) => callbacks.delete(id) }
const frame = () => { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(16) }
const scheduler = new FrameScheduler(clock)
let position = -1, calls = 0
for (let index = 0; index < 500; index++) scheduler.schedule('move', () => { position = index; calls++ })
assert.equal(callbacks.size, 1)
frame()
assert.equal(position, 499)
assert.equal(calls, 1)
assert.equal(scheduler.metrics.mergedTasks, 499)
assert.equal(callbacks.size, 0, 'idle scheduler must have no pending frame')

// A release flush must survive without a new animation frame and never replay.
scheduler.schedule('move', () => { position = 600; calls++ })
scheduler.flush('move')
frame()
assert.equal(position, 600)
assert.equal(calls, 2)
scheduler.schedule('move', () => { throw new Error('cancelled work ran') })
scheduler.cancel('move')
frame()

let settled = 0
scheduler.beginInteraction()
scheduler.settle(() => settled++)
scheduler.beginInteraction()
frame()
assert.equal(settled, 0, 'new input cancels obsolete settle work')
scheduler.settle(() => settled++)
frame()
assert.equal(settled, 1)
assert.equal(scheduler.phase, 'idle')
assert.equal(callbacks.size, 0)

// Exceptions must not wedge the frame pump; teardown must cancel all work.
scheduler.schedule('fail', () => { throw new Error('expected') })
assert.throws(frame, /expected/)
scheduler.schedule('next', () => { calls++ })
frame()
assert.equal(calls, 3)
scheduler.schedule('unmount', () => { throw new Error('disposed work ran') })
scheduler.dispose()
scheduler.schedule('late', () => { throw new Error('late work ran') })
assert.equal(callbacks.size, 0)

const ring = new SampleRing(64)
for (let index = 0; index < 1000; index++) ring.push({ x: index, pressure: .5 })
assert.equal(ring.size, 64)
assert.equal(ring.dropped, 936)
assert.deepEqual(ring.drain().map((sample) => sample.x), Array.from({ length: 64 }, (_, index) => index + 936))
assert.equal(ring.size, 0)
assert.deepEqual(ring.drain(), [])

const column = { id: 'column', role: 'column', bounds: { x: 0, y: 0, width: 300, height: 400 } }
const card = { id: 'card', bounds: { x: 20, y: 20, width: 100, height: 80 } }
const scene = { id: 'board', objects: [column, card], environment: { grid: { visible: true, color: '#334455', spacing: 44, opacity: .32 } } }
const camera = { x: 0, y: 0, scale: 1 }
const index = new UniformGridSpatialIndex([column, card])
const moved = { ...card, bounds: { ...card.bounds, x: 9000 } }
const fork = index.fork([column, moved])
assert.equal(index.get('card'), card, 'abandoned render must not change the committed index')
assert.equal(fork.get('card'), moved)
assert(index.query(card.bounds).some((entry) => entry.id === 'card'))
assert(!fork.query(card.bounds).some((entry) => entry.id === 'card'))
fork.remove('column')
assert(index.get('column'), 'fork removal must not mutate shared cell membership')
const tracker = new BackdropInvalidation()
assert.deepEqual(tracker.consume(scene, camera), { grid: true, structure: true, viewport: true })
assert.deepEqual(tracker.consume(scene, camera), { grid: false, structure: false, viewport: false })
assert.deepEqual(tracker.consume(scene, { ...camera, x: 200 }), { grid: false, structure: false, viewport: true })
tracker.consume(scene, camera)
const movedCard = { ...scene, objects: [column, { ...card, bounds: { ...card.bounds, x: 50 } }] }
assert.deepEqual(tracker.consume(movedCard, camera), { grid: false, structure: false, viewport: false })
const movedColumn = { ...scene, objects: [{ ...column, bounds: { ...column.bounds, x: 50 } }, card] }
assert.deepEqual(tracker.consume(movedColumn, camera), { grid: false, structure: true, viewport: false })
const changedGrid = { ...movedColumn, environment: { grid: { ...scene.environment.grid, spacing: 60 } } }
assert.deepEqual(tracker.consume(changedGrid, camera), { grid: true, structure: false, viewport: false })
tracker.reset()
assert.deepEqual(tracker.consume(changedGrid, camera), { grid: true, structure: true, viewport: true })
console.log('frame scheduler, ring overload, release/cancel/settle/dispose, layer invalidation: PASS')
