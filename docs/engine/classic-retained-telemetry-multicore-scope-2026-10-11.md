# Classic renderer: live diagnostics, retained updates and bounded multicore preparation

Session rule: do not build/package a new app EXE until all seven upgrade jobs (steps 1–7) are complete. Source, WASM and test checks may proceed.

Date: 2026-10-11. Status: researched implementation scope; changes below are not implemented or performance-qualified.

## Objective and boundaries

Improve input-to-committed-frame latency on mixed/image-heavy boards while preserving Classic Vello 0.10, the current WebView2 host, drawing fidelity, editable text/IME, saving, undo/redo, Settings, Codex and the approved toolbar/themes. Hybrid is outside this work's comparison baseline. Keep the prior executable and use copied workspaces for tests.

## Verified starting points

- Live MCP status and embedded architecture reads succeeded. The responding workspace is `D:/0/ArtEquation-Tests/2026-10-11-browser-dual/build`, project `reference-reconstruction-20261011`, 135 boards, 131 assets. Embedded architecture identity: `f426d1073b1826c741545a866807da3deeed71a70382e4095e010cce44d41d29`. This identifies the responding app, not every running app or the browser at port 5324.
- Status exposes 2,000 retained telemetry rows, historyDropped=10,352, dropped=0, transportFailures=0. History eviction is not proof of durable-log loss: native JSONL already receives bounded batches. Recovery/replay from those logs must be tested.
- The local bridge already has eight workers, a 64-request queue, overload responses and request metrics. The MCP adapter separately caps active calls at 16. Increasing limits alone will not create live streaming or reduce UI inspection cost.
- Embedded Codex already uses official app-server over stdio, auto-connects, and offers read-only dynamic tools. The local MCP adapter also exposes reads. These are separate clients of app state; an embedded model is not automatically this desktop chat, nor continuously reasoning over every event.
- Static small-scene comparison: Classic median 19.7 ms, dual/Hybrid 16.7 ms. Classic parse/prepare median roughly 7.8 ms. Camera cache avoids parsing but still hashes snapshot bytes, stages resources, appends the retained scene and calls checked rendering. Cached timing label `encode` includes rendering/checking and must be split.
- Custom `vendor/vello/src/checked.rs` maps 32-byte coarse allocation status before fine rasterization. `lib.rs` separately waits for queue completion. Neither the status-map time nor queue callback wall time is isolated GPU execution time.
- CPU: Intel i9-10850K, 10 physical cores, 20 logical processors. Existing browser preparation admission caps four workers; model-image decoding caps two. Native pyramid generation also limits workers and sets libvips concurrency. Nested pools need coordination.
- Renderer initialization creates its persistent Classic renderer; its pipeline-cache option is currently None. A native helper's shader warm-up is not evidence that a different browser GPU device has been warmed.

## Ordered implementation

Order revised 2026-10-12 at the owner's request: telemetry first, upgrades next, Classic baseline comparison at step 8, acceptance at step 9. Preserve the pre-upgrade build now so a before/after comparison remains possible later.

### 1. Upgrade diagnostics and Codex access first

Extend `diagnosticBuffer.ts`, `performance.ts`, `live_inspection.rs`, `codex_bridge.rs`, `appInspection.ts` and `live-app-mcp-server.mjs` around one versioned telemetry service.

1. Publish a build/session handshake: executable and WASM hashes, app PID, workspace identity, bridge identity, actual backend/device, target pixels, DPR, runtime version and schema capabilities. Use explicit instance selection when multiple apps run; avoid a single last-writer discovery file silently selecting the wrong app.
2. Add bounded cursor reads such as `art_app_events(afterSequence, sessionId, kinds, maxRows, maxBytes)` and a capped wait operation. Return next cursor, oldest retained/durable sequence, explicit gaps, rotation identifiers and counters. A failed or expired cursor must not become an empty success.
3. Native service owns durable append/replay and summary snapshots. Collect locally continuously, batch asynchronously, and expose data without serializing the board or routing every telemetry request through React. Use a small bounded subscription queue or short cursor reads; cap wait concurrency separately so streams cannot occupy all eight inspection workers.
4. Keep critical errors/input evidence separate from sampled routine phase metrics. Coalesce summaries, never silently discard credited input samples. Slow consumers receive gap markers and durable replay. Rotate logs with a manifest and declared retention; no unbounded memory or SSD writes.
5. Expose process CPU-time deltas, resident memory, worker queue age, preparation duration, cancelled/stale results, graph evaluations, render-batch rebuilds, atlas uploads and cache evictions. Distinguish app allocations from driver VRAM; unavailable counters must say unavailable.
6. Correlate session, board/content/camera revision, gesture/input sequence, generation and submission across input receipt, scheduling, serialization, WASM transfer, hashing, parsing, shaping, append, coarse submit, status-map wait, fine submit, queue callback and present submission. Preserve clock domains; align worker clocks before combining timestamps.
7. Expose GPU timestamp results only when supported and validated. Browser present submission is not physical display scanout. Use process-scoped browser traces and Windows presentation tracing for separately labeled display/compositor evidence.
8. Reconnect with bounded backoff, schema negotiation and heartbeat. Keep existing sign-in and opt-out. Generate schemas from the installed Codex app-server version; do not assume website examples match that binary. Add tool parity tests for embedded and external clients.

Acceptance: reconnect/restart and log rotation replay correctly; concurrent reads have explicit overload behavior; capture continues while the Settings panel is closed; wrong-instance selection is rejected; token/config data is absent from logs; complete input coverage is validated. Compare telemetry enabled/disabled overhead rather than assuming observation is free. Real-time means accessible event batches, not token-costly model inference for every pointer event.

### 2. Retain the canonical render model inside the engine

Introduce bounded `loadBoard`, `applyObjectChanges`, `setCamera`, `setViewport`, `updateResources`, and `renderGeneration` contracts. Keep the canonical editable document authoritative; retain a derived renderer model keyed by stable IDs and object/content/resource revisions. Patches use expected-base revision, atomic validation, ordered updates/removals and explicit resynchronization on mismatch. Undo/redo/save remain canonical transactions; rendering patches are not a replacement persistence format.

Camera commands contain numbers/revisions only. Stop full-snapshot transfer, hashing, parse and resource enumeration on unchanged-content movement. First board load and recovery may use the full snapshot path. Acceptance: zero scene parse/hash and zero graph evaluations for a camera-only change; measured patch bytes scale with changed records, not total board size.

### 3. Retain object batches and incrementally query visibility

Update the spatial index from object changes. Cache shaped text, paths, column layout and connections with complete dependency keys, including font identity, wrap width, style, hierarchy, clips and order. Compile only changed objects and affected dependants. Preserve group opacity/blend/clip semantics and z-order when batching.

Important limitation: Vello 0.10 `Scene::append` is O(N), even with retained child scenes. Object caching removes rebuilding but does not make final composition constant-time. Measure append separately. Investigate changed spatial chunks and strictly valid retained raster reuse for static regions only after the simpler retained protocol is working. Zoom still requires suitable quality; never use blurry reuse to claim sharp-frame parity.

### 4. Cache resource bookkeeping and stabilize detail demands

Retain active image-reference sets, residency admission and atlas plans by content/resource/visible-demand revision. Camera changes can require newly visible images, but unchanged demand must not re-enumerate the board. Incrementally update changed demand keys; deduplicate assets, preserve atlas placements and throttle refinement. Track per-frame upload deltas separately from cumulative counters. Keep cancellation, memory limits and visible-image priority. Acceptance: unchanged visibility produces no upload or image registration; obsolete requests do not commit.

### 5. Coordinate multicore preparation

Use one admission budget across browser workers, native tasks and libvips internal threads. Trial total heavy-work concurrency of 1, 2 and 4 first; consider 6 only if latency and memory improve. These are experiments, not an optimal setting inferred from 20 logical processors. Reserve scheduling capacity without promising OS core affinity.

Image decode/resize/pyramids are first candidates; changed text shaping and independent graph branches follow when profiling justifies them. Jobs consume immutable IDs/revisions and asset references. Use transferable buffers where ownership can move safely, rather than cloning whole documents or media. Batch tiny jobs to amortize messaging. Cancellation/generation checks reject stale results; final commit/render order stays deterministic. Respect graph dependencies, cycles, locks and undo. Browser WASM threads need a separate capability/isolation design; ordinary Workers do not automatically parallelize the existing WASM renderer, and enabling native Rayon does not enable browser multithreading.

Acceptance: identical typography/paint/graph outputs, bounded peak memory and queue age, no stale results, and measured improvement to both preparation throughput and interaction p95. Avoid nested four-worker pools each spawning four native threads.

### 6. Reduce synchronization safely

First instrument status-map/check and queue-completion waits independently. Preserve the current checked coarse allocation gate before fine rendering. Remove a later redundant whole-queue wait only after proving same-queue ordering, target ownership, completion-based recycling, error propagation, resize/dispose and recovery behavior.

If needed, prototype a small bounded set of frame slots: each target/status resource belongs to its generation until completion; do not overwrite a target before its pending blit or reuse mapped status storage. Coalesce obsolete camera requests before rendering; limit in-flight work to avoid a backlog. GPU allocation-check redesign is a separate guarded experiment requiring equivalent failure protection, not a flag to skip checks. Ship only with corruption, capacity-failure, device-loss and stale-generation tests passing.

### 7. Warm shaders/pipelines on the actual viewport device

During launch, initialize and retain the actual Classic device/renderer and representative fill, stroke, glyph, image, clipping and blend paths. Report adapter setup, pipeline preparation and first draw separately. Feature-detect asynchronous pipeline preparation available through the pinned wgpu/browser stack; a raw JavaScript render-pipeline API is not a drop-in replacement for Vello compute pipelines. Verify compute as well as blit pipelines. Device loss requires re-warm.

Shader warm-up targets cold/first-use stalls, not recurring JSON parse, append, graph work or CPU/GPU synchronization. Browser cache portability is not assumed; do not promise an exported native pipeline cache can be installed in WebView2. Accept this phase on reduced cold/first-use stall with unchanged warmed performance and pixels.

### 8. Record a Classic-only controlled baseline

Use frozen mixed-object boards of 500, 1,000, 5,000 and 10,000 objects, physical 1920x1080 and 3840x2160 canvas targets. Include small visible subset and whole-board overview, cold open, warm return, pan, zoom, drag, typing, save/reopen. Separate cold-start/shader preparation from warmed gestures. Preserve image originals and provenance. Inventory competing processes and GPU activity; run profiling separately from clean timing.

### 9. Validate and package the Classic candidate

Use the same frozen fixtures to compare the preserved pre-upgrade Classic build with the candidate at step 8, then repeat the full mixed-board matrix for acceptance. Keep lightweight correctness checks during implementation; defer the large performance campaign until step 8. Existing exact-4K gates remain: three runs, pan input-to-committed-frame p95 <=16.2 ms, zoom <=22.3 ms, first post-gesture <=78.5 ms, sharp completion <=613 ms, full quality and GPU ownership. Include all runs, oldest delayed input, cancellations, fallbacks, image refinement and memory plateau. A five-minute soak and save/reopen/undo/export checks are required. rAF, CPU submission, synthetic unit checks and small-scene median results cannot qualify 4K. Keep the prior build as rollback; package hashes and explicit measured scope.

## Source references

- [Official Codex app-server documentation](https://developers.openai.com/codex/app-server): stdio integration, initialization, streamed events and version-specific schema generation; experimental APIs need capability negotiation.
- [Vello 0.10 Scene](https://docs.rs/vello/0.10.0/vello/struct.Scene.html): child-scene append applies transforms and is O(N).
- [wgpu 29 Queue](https://docs.rs/wgpu/29.0.0/wgpu/struct.Queue.html): submission and completion-callback semantics; a callback is not physical presentation timing.
- [MDN workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers): background work, message copying, transferable ownership and shared-memory constraints.
- [MDN asynchronous pipeline creation](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createRenderPipelineAsync): preparation without pipeline-compilation stalls, with compatibility checks.
- Local source: `src-tauri/src/live_inspection.rs`, `src-tauri/src/codex_bridge.rs`, `src/codex/appInspection.ts`, `src/diagnostics/{performance,diagnosticBuffer}.ts`, `src/board/preparationWorkers.ts`, `src/canvas-engine/preparationPolicy.ts`, `src-tauri/src/image_pyramid.rs`, `engine/vello-surface/rust/src/lib.rs`, `engine/vello-surface/rust/vendor/vello/src/checked.rs`, `scripts/quality-policy.json`.
- Diagnostic comparison: `D:/0/ArtEquation-Tests/2026-10-11-browser-dual/comparison-1791786997942/report.json`. Small supported scene, shared-machine conditions; not full-board/native/4K acceptance.
