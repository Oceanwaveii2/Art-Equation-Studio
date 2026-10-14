# Classic upgrade progress â€” 2026-10-12

Session rule: no new app EXE until all seven upgrade jobs (scope steps1â€“7) are complete. No app EXE was built in this implementation pass. Prior alpha SHA256 remains 6b36eab49405020c71e97b445f3f90dfe993d27d90146729b6c29fd25a7acf4a.

## Implemented and checked

### Telemetry/Codex first implementation slice (job1 remains open)

- Native `art_app_events` returns bounded durable event rows and resumable byte/row cursors without React callbacks. Existing frontend-to-native batches normally flush each second; this is not instantaneous event push.
- Cursor continuity across current/previous-log rotation, explicit expired/truncated/raced-file errors, bounds, loss counters and session filtering. No silent expired-cursor empty success. Existing two-file retention remains; this is not indefinite telemetry storage.
- `art_app_handshake` identifies PID/workspace, executable hash, embedded architecture/WASM hashes, build features and WebView runtime. Actual active renderer is separately available from runtime diagnostics; capabilities are not fabricated as active backend evidence.
- Per-process discovery and bounded probing; external adapter rejects ambiguous new instances and supports explicit selection through ART_EQUATION_BRIDGE_DISCOVERY. Old singleton discovery is a compatibility fallback, not multi-instance proof for old apps.
- Both embedded Codex dynamic tools and external MCP expose handshake/events. Native telemetry writes are serialized around append/rotation.
- Remaining job1: complete end-to-end phase correlation, allocation-map instrumentation, worker-clock alignment, restart/consumer recovery coverage and telemetry-overhead measurement. No claim of full observability or full production live validation. The running old EXE does not contain these source changes.

### Retained engine API (job2 core implemented; broader integration remains)

- Engine-owned versioned render-display-list model with load and atomic, expected-revision range patches. Canonical editable project, saving and undo/redo remain external.
- Camera-only prepare method reuses the compiled scene and checked Classic rasterizer without transferring JSON, hashing scene bytes or reparsing. Existing GPU checks and queue waits remain.
- GPU frontend routes supported display lists through retained transport. Same snapshot or generation-only differences use retained camera commands. Small changed ordered ranges use patches; large changes/full-board switches load the scene. Legacy scene format keeps its prior guarded path.
- Reject malformed/stale patches without changing prior retained state. Dispose releases retained model. Scene append and checked-render timing are separately reported on the new camera path.
- Limitations: content edits still assemble/parse the frontend display-list snapshot to derive patches; engine patch validation still prepares the whole candidate derivative. Stable canonical object deltas, localized compilation, per-camera image bookkeeping removal and resource-budget refinement belong to subsequent work. Scene::append remains O(N). No performance gain is claimed.

## Evidence

- npm run build:v2 passed (output/classic-retained-build-v2.log). Later narrow source changes also received TypeScript, source/binary provenance and renderer-contract checks; final frontend build follows.
- Native cargo test telemetry_cursor passed; test includes replay across rotation and expired-cursor rejection.
- Native engine retained_protocol test passed; expected revision and invalid-range checks.
- scripts/live-bridge-transport-tests.mjs passed with a controlled authenticated local HTTP server: new tool exposure, selection, ambiguity rejection. This is transport logic testing, not deployed app acceptance.
- Existing Codex inspection, diagnostic-buffer and backend guard checks passed; added retained frontend checks cover load, zero-byte camera commands, generation-only reuse, narrow patch, rejection rollback and legacy compatibility.
- Actual rebuilt browser GPU correctness: D:/0/ArtEquation-Tests/2026-10-11-browser-dual/retained-correctness-1791790512779/report.json. Legacy Classic versus retained Classic pixels equal on the supported scene; actual patch validation/revision guards, resize and camera path checks passed. Camera metadata has parseScene=0, hash=0, transferBytes=0. Hybrid-vs-Classic parity remains non-exact and is not this task's performance acceptance.
- Engine receipt: 88 source/binding hashes. Browser-hybrid capability remains compiled for diagnostic compatibility; normal frontend defaults to Classic unless the existing explicit dual build flag is set. This pass does not change rasterizer preference to Hybrid.

## Next

Finish job1 correlation/recovery coverage, then extend job2 canonical delta integration without prematurely claiming the patch transport eliminates all preparation. Jobs3â€“7 are not complete. Large Classic comparison remains step8; acceptance step9. Keep WebView2/UI and originals intact.

## Step2 frontend completion pass

Removed cached-frame JSON parse/re-serialization in VelloBoardBackdrop submission. Retained vector transport identity now uses derived paint tokens rather than enclosing scene generation. Image-reference extraction uses a single-frame validated cache and clears on GPU session disposal. Together with retained-camera commands, unchanged derived paint avoids full scene assembly, parse/hash and JSON transfer into WASM. Actual changed visible membership, detail or screen-scaled stroke geometry remains a content derivative update; final Scene::append/raster work remains and belongs to later optimization. Content updates still use validated ordered range patches; localized engine recompile is job3, not falsely claimed here.

Added checks: generation-only changes retain identical vector JSON; same resource snapshot parses once; cache clear forces revalidation. Existing path/alpha/order/stroke oracle and retained patch guards pass. No new app EXE and no new 4K performance claim.

Prepared vector records and complete-card display lists now travel through capture/submission into the retained transport directly. Content patches are derived from those records rather than reparsing the serialized full scene. Full serialized snapshots remain available for initial load, recovery and CPU fallback; retaining that compatibility representation is not a camera transfer. A controlled test rejects full-scene JSON parsing during direct-record load/edit/camera reuse.

## Steps3–5 implementation pass

### 3: incremental preparation

- Reuse unchanged immutable vector contributions across edits to neighboring cards, with camera-scale-aware visual bounds.
- Non-tiled camera translation reuses complete paint before stream membership, demand preparation, eviction and contribution assembly bookkeeping. Changed immutable objects, paint tokens, editor, environment, DPR, scale or tile-detail revision invalidate reuse.
- Async content validation retains its canonical ID lookup until the immutable object array changes; repeated checks during one capture/camera movement no longer repeatedly rebuild a whole-board map.
- Existing retained compiler and card caches still rebuild changed object derivatives; final ordered composition and strict whole-candidate engine patch validation remain. This pass does not claim arbitrary constant-time updates or change Vello's O(N) append.

### 4: resource caching

- GPU session caches successful residency/registration/admission by validated resource descriptors and immutable upload identity. Unchanged camera and geometry-only frames skip repeated image byte validation, retain-images calls, residency enumeration and registration.
- Resource descriptors are read directly from prepared records when available, rather than parsing a full display list. Cache invalidates on changed resources/uploads, failure or session disposal. Frame target admission and GPU health checks remain active.
- Native image originals/atlas slots remain retained under existing memory accounting. No budget was enlarged to manufacture a pass. Detail streaming remains demand-driven and cancellable; this is not an additional image-detail algorithm.

### 5: bounded multicore coordination

- Browser TIFF and model decoder pools share active-task and working-memory admission; release wakes other pools, cancellation returns admission and rejects late responses, disposal unregisters listeners. Aggregate queue/work durations and admission counters appear in preparation diagnostics.
- Browser quota uses half the reserved-capacity preparation policy; native pyramid quota similarly reserves a share for browser/UI work. The existing native job registry already serializes pyramid jobs, so no redundant native queue was added.
- This is conservative quota coordination, not a dynamic cross-process token service or OS core affinity. On the observed 20-logical-processor machine: at most two active browser preparation tasks and up to four native pyramid workers. Separate experimental compute helpers remain outside these decoder quotas. No claim of optimal worker count or benchmark speedup; stage8 will measure it.
- Existing worker output transfers and revision/cancellation guards remain. GPU preferred rendering and single-worker CPU fallback are unchanged; unused parallel text/graph evaluators were not introduced without a demonstrated workload.

### Checks

- Controlled shared-worker tests passed: two pools cannot exceed the shared worker/memory budget; releasing a slot wakes the other pool; cancellation/stale results and cleanup preserve zero leaked admission.
- Native preparation_reserves_cores_and_limits_memory cargo test passed.
- Actual Classic frontend session plus rebuilt WASM: D:/0/ArtEquation-Tests/2026-10-12-classic-resources/1791792840272/report.json. One image-registration span, two resource-reuse frames (camera and geometry edit), no additional cumulative atlas uploads, retained-camera command, invalid revision rejected. This is a supported-scene correctness/counter proof, not full app or 4K qualification. An earlier test incorrectly looked for paintMode in present metadata rather than prepare metadata; its failed report is retained, not erased.
- TypeScript, retained compiler oracle, backend guards and source integration checks pass. Steps6–7 are next. No new EXE built. Large before/after tests remain step8 and acceptance step9.

Final steps3–5 worker proof: D:/0/ArtEquation-Tests/2026-10-12-classic-resources/1791793345477/report.json passed the actual Classic frontend GPU session checks and four real browser-worker decodes. Pixels/output dimensions matched; two workers were used and aggregate active permits/working bytes returned to zero. The test exposed and fixed a pre-existing worker reply omission (output width/height were declared but missing). Earlier failing reports remain preserved. Expanded actual-host retention tests prove repeated content-validation checks reuse the canonical ID lookup and still reject changed objects/board/environment/DPR/disposal. The final source build remains separate from deployment and performance acceptance.
