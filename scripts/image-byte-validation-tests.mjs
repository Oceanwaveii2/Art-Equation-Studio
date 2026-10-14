import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const registryPath = 'src/canvas-engine/decodedImageRegistry.ts'
const registrySource = await readFile(registryPath, 'utf8')
const budgetUrl = url(compile(await readFile('src/canvas-engine/resourceBudget.ts', 'utf8')))
const demandUrl = url(compile(await readFile('src/canvas-engine/imageDemand.ts', 'utf8')))
const { CanvasResourceBudget } = await import(budgetUrl)
const { sameImageBytes, DecodedImageRegistry, imageUploads } = await import(url(compile(registrySource)
  .replace(/from ['"]\.\/resourceBudget['"]/g, "from '" + budgetUrl + "'")
  .replace(/from ['"]\.\/imageDemand['"]/g, "from '" + demandUrl + "'")))
const checks = []
const check = (name, run) => { run(); checks.push({ name, pass: true }) }

check('every byte lane, first and last byte reject mutation without equality memoization', () => {
  const left = Uint8Array.from({ length: 32 }, (_, index) => index * 7), right = new Uint8Array(left)
  assert(sameImageBytes(left, right))
  for (let index = 0; index < left.length; index++) {
    right[index] ^= 1
    assert.equal(sameImageBytes(left, right), false, 'byte ' + index)
    right[index] ^= 1
    assert.equal(sameImageBytes(left, right), true, 'restored byte ' + index)
  }
})
check('aligned offsets honor byteOffset and ignore surrounding bytes', () => {
  const leftStore = new Uint8Array(64).fill(3), rightStore = new Uint8Array(80).fill(9)
  const left = leftStore.subarray(4, 33), right = rightStore.subarray(12, 41)
  left.set(Uint8Array.from({ length: 29 }, (_, index) => index + 10)); right.set(left)
  assert(sameImageBytes(left, right))
  for (let index = 0; index < left.length; index++) {
    right[index] ^= 128; assert.equal(sameImageBytes(left, right), false, 'offset byte ' + index); right[index] ^= 128
  }
})
check('unaligned subviews and all one-to-three-byte tails compare exactly', () => {
  for (let length = 0; length <= 33; length++) for (let leftOffset = 0; leftOffset < 8; leftOffset++) for (let rightOffset = 0; rightOffset < 8; rightOffset++) {
    const leftStore = new Uint8Array(length + leftOffset + 4).fill(13), rightStore = new Uint8Array(length + rightOffset + 4).fill(27)
    const left = leftStore.subarray(leftOffset, leftOffset + length), right = rightStore.subarray(rightOffset, rightOffset + length)
    left.set(Uint8Array.from({ length }, (_, index) => index * 11)); right.set(left)
    assert(sameImageBytes(left, right), [length, leftOffset, rightOffset].join(':'))
    if (length) {
      right[length - 1] ^= 1; assert.equal(sameImageBytes(left, right), false)
      right[length - 1] ^= 1; right[0] ^= 1; assert.equal(sameImageBytes(left, right), false)
    }
  }
})
check('unequal lengths refuse comparison and valid empty views remain equal', () => {
  assert.equal(sameImageBytes(new Uint8Array(8), new Uint8Array(9)), false)
  assert.equal(sameImageBytes(new Uint8Array(), new Uint8Array()), true)
  assert.equal(sameImageBytes(new Uint8Array(3).subarray(1, 1), new Uint8Array(8).subarray(4, 4)), true)
})
check('detached views are never equal, including two detached zero-length views', () => {
  const first = new Uint8Array(8), second = new Uint8Array(8)
  structuredClone(first.buffer, { transfer: [first.buffer] })
  assert.equal(sameImageBytes(first, second), false)
  assert.equal(sameImageBytes(first, new Uint8Array()), false)
  structuredClone(second.buffer, { transfer: [second.buffer] })
  assert.equal(sameImageBytes(first, second), false)
  assert.equal(sameImageBytes(first, first), false)
})

function fixture() {
  const budget = new CanvasResourceBudget({ total: 10000, pools: { retained: 10000, 'tile-surface': 10000, 'tile-atlas': 10000 } })
  const registry = new DecodedImageRegistry(1, budget)
  const reference = { key: 'pixels', revision: 1, epoch: 1, width: 3, height: 2 }
  const straight = Uint8Array.from({ length: 24 }, (_, index) => index % 4 === 3 ? (index === 3 ? 128 : 255) : index * 9)
  const upload = registry.register(reference, straight)
  registry.stage([reference]); registry.present()
  return { registry, reference, straight, upload, close() { registry.dispose(); assert.equal(budget.snapshot().bytes, 0) } }
}
check('premultiplication and defensive input-copy semantics are unchanged', () => {
  const f = fixture()
  try {
    assert.deepEqual([...f.upload.pixels.slice(0, 4)], [0, 5, 9, 128])
    assert.equal(f.registry.resolve(f.reference), f.upload)
    assert.equal(f.registry.register(f.reference, f.straight), f.upload)
    f.straight[4] ^= 1
    assert.equal(f.registry.resolve(f.reference), f.upload, 'changing original straight bytes cannot mutate authority')
    assert.throws(() => f.registry.register(f.reference, f.straight), /RESOURCE_REVISION_CONFLICT: immutable image pixels differ/)
  } finally { f.close() }
})
const boundaries = {
  resolve: f => f.registry.resolve(f.reference),
  stage: f => f.registry.stage([f.reference]),
  retain: f => f.registry.retain([f.reference]),
  imageUploads: f => imageUploads([f.reference], [f.upload]),
  duplicateRegister: f => f.registry.register(f.reference, f.straight),
}
for (const [name, invoke] of Object.entries(boundaries)) {
  check(name + ' still rejects public mutation in every RGBA lane, start and end', () => {
    for (const byte of [0, 1, 2, 3, 4, 20, 21, 22, 23]) {
      const f = fixture()
      try {
        const retained = invoke(f)
        if (name === 'retain') retained.release()
        f.upload.pixels[byte] ^= 1
        assert.throws(() => invoke(f), /RESOURCE_REVISION_CONFLICT/, name + ':' + byte)
        f.upload.pixels[byte] ^= 1
        const restored = invoke(f)
        if (name === 'retain') restored.release()
      } finally { f.close() }
    }
  })
}
for (const [name, invoke] of Object.entries(boundaries)) {
  check(name + ' still rejects a detached exposed transport array', () => {
    const f = fixture()
    try {
      structuredClone(f.upload.pixels.buffer, { transfer: [f.upload.pixels.buffer] })
      assert.throws(() => invoke(f), name === 'imageUploads' ? /RESOURCE_INVALID/ : /RESOURCE_REVISION_CONFLICT/)
    } finally { f.close() }
  })
}
check('unaligned external uploads remain valid and malformed lengths remain refused', () => {
  const f = fixture()
  try {
    const external = new Uint8Array(25).subarray(1)
    external.set(f.upload.pixels)
    assert.equal(imageUploads([f.reference], [{ reference: f.reference, pixels: external }]).size, 1)
    assert.throws(() => imageUploads([f.reference], [{ reference: f.reference, pixels: external.subarray(1) }]), /RESOURCE_INVALID/)
  } finally { f.close() }
})


check('admission reserves bytes before pixels exist and releases exactly once',()=>{
 const budget=new CanvasResourceBudget({total:128,pools:{retained:128,'tile-surface':128,'tile-atlas':128}}),registry=new DecodedImageRegistry(111,budget)
 const a={key:'a',revision:1,epoch:111,width:4,height:4},b={...a,key:'b'}
 const admission=registry.reserve(a)
 assert.equal(registry.stats().reservedBytes,128)
 assert.throws(()=>registry.reserve(b),/admission denied/)
 const upload=registry.register(a,new Uint8Array(64).fill(255))
 admission.release();admission.release()
 assert.equal(registry.stats().reservedBytes,0)
 assert.equal(budget.snapshot().bytes,128)
 const pin=registry.retain([a]);registry.retirePresentation();assert.equal(registry.resolve(a),upload)
 pin.release();assert.equal(budget.snapshot().bytes,0)
 registry.dispose()
})
check('old visible snapshot survives presentation retirement until transport releases',()=>{
 const registry=new DecodedImageRegistry(112),a={key:'active',revision:1,epoch:112,width:2,height:2}
 const upload=registry.register(a,new Uint8Array(16).fill(255)),hold=registry.retain([a])
 registry.stage([a]);registry.present();registry.retirePresentation()
 assert.equal(registry.resolve(a),upload)
 hold.release();assert.throws(()=>registry.resolve(a),/RESOURCE_NOT_READY/)
 registry.dispose()
})
check('oversize admission fails before allocation and disposal releases pending reservations',()=>{
 const registry=new DecodedImageRegistry(113)
 assert.throws(()=>registry.reserve({key:'large',revision:1,epoch:113,width:4096,height:4096}),/registry full/)
 registry.reserve({key:'small',revision:1,epoch:113,width:4,height:4})
 assert.equal(registry.stats().reservedBytes,128)
 registry.dispose();assert.equal(registry.stats().reservedBytes,0)
})
const report = { schema: 'art-equation.image-byte-validation-tests', scope: 'actual registry and comparator; controlled typed arrays; not renderer acceptance', sourceHash: createHash('sha256').update(registrySource).digest('hex'), pass: true, checks }
if (process.argv[2]) await writeFile(resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ pass: true, checks: checks.length, sourceHash: report.sourceHash }))
