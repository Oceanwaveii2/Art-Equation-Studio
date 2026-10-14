import assert from 'node:assert/strict'
import { imageDemand } from '../src/canvas-engine/imageDemand.ts'
assert.deepEqual(imageDemand(1024,512,[.125,0,0,.125,10,20],2),{width:256,height:128,divisor:4})
assert.equal(imageDemand(1024,512,[0,.125,-.125,0,0,0],2).divisor,4)
assert.equal(imageDemand(1024,512,[2,0,0,2,0,0],2).divisor,1,'Deep zoom retains original pixels')
assert.equal(imageDemand(1024,512,[.2,0,0,.2,0,0],2).divisor,2,'Round toward sharper mip')
assert.equal(imageDemand(1024,512,[.25,0,.25,.25,0,0],2).divisor,1,'Shear requires conservative density')
for(const scale of [.001,.01,.1,.33,.5,1,2]) {
 const result=imageDemand(1001,573,[.7,.2,-.1,.5,0,0],scale)
 const density=scale*Math.max(Math.hypot(.7,.2),Math.hypot(-.1,.5))
 assert.ok(result.width>=Math.min(1001,1001*density))
 assert.ok(result.height>=Math.min(573,573*density))
}
assert.throws(()=>imageDemand(10,10,[1,0,0,1,0,0],0),/IMAGE_INVALID/)
console.log('Physical image demand: PASS (DPR, rotation, shear, sharper rounding and deep zoom)')
