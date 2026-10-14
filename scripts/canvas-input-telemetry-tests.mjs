import assert from 'node:assert/strict'
import { CanvasInputTracker } from '../src/diagnostics/canvasInput.ts'
let time=0
const tracker=new CanvasInputTracker(()=>time)
tracker.mark('pan');time=10;const request=tracker.begin()
time=20;tracker.mark('zoom');time=1000
const first=tracker.commit(request)
assert.equal(first.oldestInputMs,1000)
assert.equal(first.latestInputMs,1000)
assert.equal(first.pendingInputs,1,'Newer input must not be credited to an older frame')
assert.deepEqual(JSON.parse(first.inputSamplesJson),[{seq:1,kind:'pan',ms:1000}])
assert.equal(tracker.commit(request),undefined,'Repeated frames must not manufacture new samples')
const next=tracker.begin();time=1020
assert.equal(tracker.commit(next).latestInputMs,1000,'Blocked input must retain its original timestamp')
time=2000;tracker.mark('pan');time=2010;tracker.mark('pan');const merged=tracker.begin();time=2040
const result=tracker.commit(merged);assert.equal(result.coalesced,2);assert.equal(result.oldestInputMs,40);assert.equal(result.latestInputMs,30)
assert.deepEqual(JSON.parse(result.inputSamplesJson),[{seq:3,kind:'pan',ms:40},{seq:4,kind:'pan',ms:30}])
time=2050;tracker.mark('zoom');time=2060;tracker.mark('pan');time=2070;tracker.mark('zoom')
const mixed=tracker.begin();time=2090
const mixedResult=tracker.commit(mixed)
assert.equal(mixedResult.kind,'zoom','Legacy aggregate still identifies the last credited event')
assert.equal(mixedResult.sampleSchema,1)
assert.deepEqual(JSON.parse(mixedResult.inputSamplesJson),[{seq:5,kind:'zoom',ms:40},{seq:6,kind:'pan',ms:30},{seq:7,kind:'zoom',ms:20}], 'Mixed batches preserve each event kind and its full delay')
assert.equal(tracker.commit(mixed),undefined,'Per-event samples cannot repeat on the next frame')
for(let i=0;i<513;i++)tracker.mark('pan')
assert.equal(tracker.dropped,1,'Overflow must be observable and invalidate qualification')
const overflowResult=tracker.commit(tracker.begin())
assert.equal(JSON.parse(overflowResult.inputSamplesJson).length,512,'Per-event telemetry retains the existing queue bound')
assert.equal(overflowResult.dropped,1)
console.log('Canvas input-to-committed-generation telemetry: PASS (stale frames, mixed pan/zoom events, coalescing, backlog and overflow)')
