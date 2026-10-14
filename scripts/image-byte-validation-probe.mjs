import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'

const comparisonPath = resolve(process.argv[2] || '../output/playwright/quality-1791472800126/comparison.json')
const outputPath = resolve(process.argv[3] || '../evidence/image-byte-validation-attribution-20261008.json')
const comparisonSource = await readFile(comparisonPath, 'utf8')
const comparison = JSON.parse(comparisonSource)
const sourcePath = 'src/canvas-engine/decodedImageRegistry.ts'
const registrySource = await readFile(sourcePath, 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const budgetUrl = url(compile(await readFile('src/canvas-engine/resourceBudget.ts', 'utf8')))
const demandUrl = url(compile(await readFile('src/canvas-engine/imageDemand.ts', 'utf8')))
const { sameImageBytes } = await import(url(compile(registrySource)
  .replace(/from ['"]\.\/resourceBudget['"]/g, "from '" + budgetUrl + "'")
  .replace(/from ['"]\.\/imageDemand['"]/g, "from '" + demandUrl + "'")))
const runs = comparison.results.filter(result => result.board === 'ultra-graph-test-1')
const metadata = JSON.parse(runs[0].observed.gpu.frameMetadata)
const references = metadata.imageResources.references
const pairs = references.map(reference => {
  const size = reference.width * reference.height * 4, left = new Uint8Array(size), right = new Uint8Array(size)
  for (const index of [0, Math.floor(size / 2), size - 1]) left[index] = index % 251 + 1
  right.set(left)
  return { left, right, size }
})
const totalBytes = pairs.reduce((total, pair) => total + pair.size, 0)
assert.equal(totalBytes, metadata.imageResources.bytes)
assert.equal(totalBytes, 28230608)
assert.equal(pairs.length, 48)
const referenceCompare = (left, right) => left.length === right.length && !left.some((byte, index) => byte !== right[index])
const runScan = compare => {
  const start = performance.now()
  for (const pair of pairs) assert(compare(pair.left, pair.right))
  return performance.now() - start
}
runScan(referenceCompare); runScan(sameImageBytes)
const oldSamples = [], newSamples = []
for (let sample = 0; sample < 7; sample++) {
  oldSamples.push(runScan(referenceCompare))
  newSamples.push(runScan(sameImageBytes))
}
for (const pair of pairs) {
  pair.right[pair.size - 1] ^= 1
  assert.equal(referenceCompare(pair.left, pair.right), false)
  assert.equal(sameImageBytes(pair.left, pair.right), false)
  pair.right[pair.size - 1] ^= 1
}
const summary = samples => {
  const sorted = [...samples].sort((a, b) => a - b)
  return { samplesMs: samples, minMs: sorted[0], medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1) }
}
const traceSegments = runs.map(result => {
  const rows = result.observed.diagnostics.rows
  const reuse = rows.find(row => row.kind === 'paint.card-retention' && row.data.reused === 51 && row.data.captured === 0)
  assert(reuse)
  const after = rows.filter(row => row.sequence >= reuse.sequence)
  const first = kind => after.find(row => row.kind === kind)
  const capture = first('paint.capture'), submit = first('paint.submit'), upload = first('gpu.image-register')
  return {
    run: result.run, reused: reuse.data.reused, captured: reuse.data.captured,
    captureMs: capture.data.ms, captureEndToSubmitGapMs: submit.t - capture.t,
    submitToUploadValidationFinishedGapMs: upload.t - submit.t, missingUploads: upload.data.missing,
    gpuSnapshotMs: first('gpu.snapshot').data.ms, gpuPrepareMs: first('gpu.prepare').data.ms,
    gpuInternalMs: first('gpu.phase.total').data.ms, snapshotChars: submit.data.bytes,
  }
})
const sha256 = source => createHash('sha256').update(source).digest('hex')
const report = {
  schema: 'art-equation.image-byte-validation-attribution',
  generatedAt: new Date().toISOString(),
  scope: 'OFFLINE_NODE_EXACT_COMPARATOR_COST_ONLY; existing integrated telemetry attribution; no new browser or rendering qualification',
  dataset: { comparisonPath, comparisonSha256: sha256(comparisonSource), board: 'ultra-graph-test-1', references: references.map(({ width, height }) => ({ width, height })), imageCount: pairs.length, totalBytes, content: 'distinct deterministic synthetic byte arrays using actual accepted image dimensions; no image decode or GPU' },
  implementation: { path: sourcePath, sha256: sha256(registrySource), change: 'aligned Uint32 comparisons plus exact unaligned/tail bytes; comparison remains at every existing ownership boundary and is never memoized' },
  measuredOffline: { priorUint8ArraySome: summary(oldSamples), exactWordComparator: summary(newSamples) },
  existingTraceSegments: traceSegments,
  attribution: {
    capture: 'captureScenePaint.ts registry.retain(compiled.displayList.resources) calls resolve for all retained resources; resolve compares public transport against private canonical bytes',
    beforeSubmit: 'VelloBoardBackdrop.ts encoded.stage() calls registry.stage, repeating resolve comparison before paint.submit',
    gpuPreparePrefix: 'backends.ts imageUploads validates all declared uploads before gpu.image-register even when missing=0; this performs another canonical comparison',
    acceptedCommit: 'paint.present() calls registry.stage again on acceptance, retaining the same mutation validation',
    inference: 'Three callback-per-byte scans explain the matching roughly quarter-second capture, stage and frontend-prepare intervals; the spans do not independently profile individual functions. Added frontend subspans and integrated reruns must verify attribution and remaining costs.'
  },
  qualification: 'Synthetic offline comparator timing cannot establish native 4K input-to-commit or complete sharp-frame acceptance.'
}
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ outputPath, totalBytes, images: pairs.length, oldMedianMs: report.measuredOffline.priorUint8ArraySome.medianMs, newMedianMs: report.measuredOffline.exactWordComparator.medianMs }))
