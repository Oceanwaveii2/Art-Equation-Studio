# Gemini takeover â€” Classic performance scope

Session rule: do not build/package a new app EXE until all seven upgrade jobs (steps 1–7) are complete. Source, WASM and test checks may proceed.

Date: 2026-10-12. Status: research and scope complete; the new nine-step scope has NOT been implemented. This document is a local handoff, not proof of delivery to Gemini or acknowledgement.

## Owner's current instruction

Apply the improvements to Classic Vello. Preserve WebView2 and the current UI. Upgrade Codex telemetry access first. Do implementation and lightweight correctness checks before the large comparison campaign: Classic baseline/comparison is step 8; acceptance and packaging are step 9. The owner requested this file as a fallback if Codex credits run out.

## Exact checkout and instructions

Workspace root: C:/Users/User/.codex/worktrees/04ce/Art_Equation_Studio_2026-08-27_v81-combined-with-desktop-scope

Commands currently run in: C:/Users/User/.codex/worktrees/04ce/Art_Equation_Studio_2026-08-27_v81-combined-with-desktop-scope/current/2026-10/integration/prototype-2.5-engine

Read AGENTS.md here. QUALITY_GATE_GUIDE calls current/2026-10/desktop-app the active source; verify directory/source identity before changing a different checkout. Do not assume Git can restore the working tree: extensive source is untracked. Preserve current files and avoid reset/clean. Read scripts/QUALITY_GATE_GUIDE.txt before acceptance claims; scripts/UI_CONSISTENCY_POLICY.txt before UI work. No UI redesign is requested.

Main scope: docs/engine/classic-retained-telemetry-multicore-scope-2026-10-11.md

## Approved order

1. Diagnostics and Codex access: instance-aware handshake, resumable cursor events, durable replay, bounded transport, correlated phase/input metrics, reconnect and parity between embedded Codex and external MCP.
2. Retained engine model and revision-validated object patches; camera-only commands without full scene transport/hash/parse.
3. Incremental spatial visibility and retained object/text/connection batches with correct clips, blends and ordering.
4. Revision-cached image bookkeeping/residency and stable detail demands.
5. Coordinated bounded multicore preparation across existing browser/native/libvips workers.
6. Instrument and safely reduce synchronization while preserving allocation checks and resource lifetimes.
7. Shader/pipeline warm-up on the actual retained Classic viewport device.
8. Controlled before/after Classic comparison: preserved old build vs candidate; 500/1,000/5,000/10,000 mixed objects; 1080p and exact physical 4K; cold/warm, subset/overview, pan/zoom/drag/edit.
9. Fidelity/workflow/soak/4K acceptance and separately packaged candidate.

Preserve the old executable now; measuring it later supplies the pre-upgrade baseline even though the campaign is deferred. Small correctness checks remain necessary between changes.

## Current architecture and evidence

Classic Vello 0.10 and Hybrid 0.2 through wgpu 29 browser WebGPU on an HTMLCanvasElement inside WebView2. The native child-pane experiment was rejected and rolled back. Do not restore native pane integration.

Separate browser dual candidate exists. Hybrid is used for supported changed static scenes; camera reuse runs Classic. This is not the new retained API or a proven heavy-board optimization.

Candidate: D:/0/ArtEquation-Tests/2026-10-11-browser-dual/build/Art-Equation-browser-dual-alpha.exe
SHA256: bb1b1f02aa74aba139a84850063b0e2ffac903d955eb973a0c132e271fe87545
Previous alpha: D:/0/ArtEquation-Tests/2026-10-11-reference-reconstruction/builds/2026-10-11-boot-splash-alpha/Art-Equation-alpha.exe
SHA256: 6b36eab49405020c71e97b445f3f90dfe993d27d90146729b6c29fd25a7acf4a
Verify hashes before use; do not overwrite either.

Comparison: D:/0/ArtEquation-Tests/2026-10-11-browser-dual/comparison-1791786997942/report.json
Runner: scripts/browser-dual-performance-compare.mjs
60 warmed samples/case, alternating policies, three rounds, small supported scene at 1818x693, shared-machine GPU activity. Static median Classic 19.7ms, Hybrid 16.7ms; pan Classic 12.2ms, dual 12.1ms; zoom Classic 12.5ms, dual 13.0ms. Dual pan/zoom both execute Classic. Not EXE end-to-end, full500, 4K, physical scanout or pure GPU timings.
Classic static parse/prepare median ~7.8ms. Cached camera 'encode' ~7ms includes checked rendering; separate these phases before drawing conclusions.

Valid pixel proof: D:/0/ArtEquation-Tests/2026-10-11-browser-dual/pixels-1791784995732/report.json
Mean RGBA8 error ~0.02525, max66, not exact parity. Avoid older invalidated canvas-copy comparisons: drawImage of a presented GPU canvas can read discarded/blank pixels. Use compositor screenshots outside timing.

Candidate EXE startup/browser-canvas/grid initial checks passed, but full native edit/duplicate/delete workflow testing was interrupted/incomplete. Do not label the app fully verified.

## Code to inspect first

- src/diagnostics/performance.ts and diagnosticBuffer.ts: history and separate native durable batch transport, event/input evidence, loss counters.
- src/codex/appInspection.ts, CodexBridgePanel.tsx, runtimeDiagnostics.ts.
- src-tauri/src/live_inspection.rs: local authenticated HTTP inspection, eight workers, 64 queued requests, native logs/architecture/runtime reads; UI reads route through main window.
- src-tauri/src/codex_bridge.rs: official Codex app-server stdio, startup/sign-in, read-only dynamic tools.
- scripts/live-app-mcp-server.mjs: external adapter, single discovery file, 16 active calls maximum. Avoid last-writer app selection when multiple builds run.
- src/project-b/p0-surface/backends.ts: per-frame image references/residency and prepare/present health checks.
- engine/vello-surface/rust/src/lib.rs: snapshot hash, parse, scene cache, Scene::append, queue completion wait, persistent device/renderer.
- engine/vello-surface/rust/vendor/vello/src/checked.rs: 32-byte coarse allocation status map awaited before fine rasterization. This is distinct from the later queue-completion wait. Do NOT remove allocation safety to produce faster numbers.
- src/board/preparationWorkers.ts; src/canvas-engine/preparationPolicy.ts; src-tauri/src/image_pyramid.rs. Existing bounded pools must share a budget rather than multiply nested concurrency.

Hardware verified during research: i9-10850K, 10 physical cores/20 logical processors; RTX4080 SUPER. Recheck runtime availability. Trial 1/2/4 heavy workers; more cores do not automatically help latency.

Live MCP status responded for workspace D:/0/ArtEquation-Tests/2026-10-11-browser-dual/build, project reference-reconstruction-20261011, 135 boards/131 assets. Architecture identity f426d1073b1826c741545a866807da3deeed71a70382e4095e010cce44d41d29. Retained history2000, historyDropped10352, transport dropped0/failures0. History eviction does not imply durable JSONL loss; replay must be verified. This app identity does not prove the browser at5324 serves the same build.

## Research conclusions

Vello Scene::append is O(N): retained child scenes avoid recompilation but final composition still has cost. Camera-only API should first eliminate snapshot copying/hash/parse; claim constant-time composition only if actually implemented/measured.

Queue callback elapsed time can include main-thread delivery. Isolate allocation-map and explicit queue waits; correlate submission and presentation. Browser submission is not physical scanout. Safety checks require independent failure tests and generation/resource ownership.

Worker messages copy ordinary objects; use transferable buffers only when ownership may move. Do not copy documents per task. Browser Worker pools do not automatically provide WASM shared-memory threading or native Rayon.

Shader warm-up helps cold/first-use latency on the SAME retained viewport GPU device. Native compute helper warm-up is not equivalent. Pipeline-cache option is None; do not assume native cache export works in WebView2.

Official references are linked in the main scope:
https://developers.openai.com/codex/app-server
https://docs.rs/vello/0.10.0/vello/struct.Scene.html
https://docs.rs/wgpu/29.0.0/wgpu/struct.Queue.html
https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createRenderPipelineAsync

Generate app-server schemas from the installed binary/version; retain stdio and authentication. Continuous telemetry access is not continuous model inference. No telemetry tokens/config credentials in exports.

## Validation/build reminders

Run npm run build:v2 for integration; inspect package.json for relevant diagnostics, inspection, preparation and renderer checks. Existing tests include scripts/codex-app-inspection-tests.mjs, scripts/canvas-input-telemetry-tests.mjs and scripts/image-board-streaming-tests.mjs. Read their actual invocation/dependencies before running.

Browser-hybrid WASM build previously used AE_ENGINE_FEATURES=browser-hybrid with node scripts/engine-provenance.mjs --record. Classic candidate must verify selected features and actual renderer instead of inheriting dual accidentally. Build/private frontend details are in docs/engine/browser-dual-renderer-experiment-2026-10-11.md and BUILD-INFO.json.

Do not use absolute Windows frontendDist in Tauri config: it previously launched a file://directory instead of embedded UI. Private relative frontendDist was used successfully. No new EXE is requested until implementation/testing warrants one.

Exact4K gates in scripts/quality-policy.json: three runs, pan input-to-committed-frame p95<=16.2ms; zoom<=22.3ms; first postgesture<=78.5ms; sharp completion<=613ms. Preserve full pixels/quality, report all input coalescing/delays, no unexpected CPU fallback. Five-minute soak and workflows required. Synthetic checks/rAF timing do not qualify.

Do not kill user apps or overwrite original assets/projects. Use isolated copied workspaces. Keep observation/profiling separate from clean timing. Record actual scope and incomplete evidence honestly.

## Immediate next action

Begin step1 by confirming exact running instance/source/schema, then implement resumable telemetry and phase correlation with bounded native-owned capture. Test replay, reconnect, overload, clock alignment and observer cost. Continue the retained API only after telemetry correctness is established. The research turn changed documentation only.

## Implementation update after the research handoff

Read CLASSIC-UPGRADE-PROGRESS-2026-10-12.md beside this file before continuing. Source now includes durable native cursor tools, instance handshakes/discovery and a retained display-list/camera protocol. Research-only status above describes the earlier checkpoint; this update supersedes it. Job1 remains open for full phase correlation; job2 core transport is tested but canonical incremental compilation remains. No new app EXE has been built, and none may be built until all seven upgrade jobs are complete.

### Step2 follow-up
Prepared display-list object records now reach the retained GPU transport directly, bypassing full-scene JSON parsing to derive content patches. Cached submission and resource-reference extraction no longer parse/reassemble unchanged derived paint. Retained vector frame identity excludes enclosing generation. Scoped compiler/transport checks and browser GPU retained/revision/pixel checks pass. Remaining localized recompile and residency costs are jobs3–4. Read the latest progress document; do not mistake this source implementation for a deployed EXE or a 4K result.

### Steps3–5 update
Read the latest progress document: incremental preparation reuse, cached GPU resource bookkeeping and shared bounded browser decoder admission are now implemented. Native decoder quota coordination is conservative, not a global cross-process token service. Actual Classic browser GPU resource reuse and invalid-resource refusal passed. Steps6–7 remain; no app EXE may be built yet.
