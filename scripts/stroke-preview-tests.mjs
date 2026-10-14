import assert from 'node:assert/strict'
import { StrokePreview } from '../src/board/StrokePreview.ts'
import { AppFrameClock } from '../src/canvas-engine/appFrameClock.ts'

let id=0;const frames=new Map(),painted=[]
const host={request:cb=>{frames.set(++id,cb);return id},cancel:i=>frames.delete(i)}
const phased=new AppFrameClock(host)
const preview=new StrokePreview({request:cb=>phased.request(cb,'present'),cancel:phased.cancel},d=>painted.push(d))
const frame=()=>{const list=[...frames.values()];frames.clear();list.forEach(cb=>cb(16))}
preview.begin({x:0,y:0})
phased.request(()=>{for(let i=1;i<=60;i++)preview.append({x:i,y:i%3})},'input')
assert.equal(painted.filter(Boolean).length,0)
frame()
assert.equal(painted.filter(Boolean).length,1,'one paint for the whole ordered input batch')
assert.equal(preview.metrics.samples,61)
assert.equal(painted.at(-1).split(' L ').length,61)
assert(painted.at(-1).endsWith('L 60 0'))
assert.equal(frames.size,0,'no independent continuously running frame loop')
preview.append({x:61,y:1});preview.append({x:62,y:2});frame()
assert.equal(preview.metrics.frames,2);assert(painted.at(-1).endsWith('L 62 2'))
preview.append({x:99,y:99});preview.clear();frame()
assert.equal(painted.at(-1),'','cancel discards queued preview')
preview.begin({x:200,y:200});preview.append({x:220,y:220});frame()
assert.equal(painted.at(-1),'M 200 200 L 220 220','no stale previous gesture commands')
preview.clear();assert.equal(phased.pending,0)
// A host that cannot cancel an already-delivered callback must not replay it.
let late;const race=[]
const guarded=new StrokePreview({request:cb=>{late=cb;return 1},cancel:()=>{}},d=>race.push(d))
guarded.begin({x:1,y:1});guarded.clear();late(16)
assert.equal(race.filter(Boolean).length,0)
console.log('Stroke preview: ordered batch, once-per-frame paint, reuse, cancellation and late callback guards PASS')
