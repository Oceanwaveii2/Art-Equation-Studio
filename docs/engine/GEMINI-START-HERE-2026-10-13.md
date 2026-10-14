# Gemini handoff for October 13, 2026

Prepared October 12 (America/Los_Angeles). Owner stopped work because credits were exhausted. This file is saved locally; it has not been dispatched or acknowledged by Gemini.

## Start here: instructions and identity

Working directory:
`C:/Users/User/.codex/worktrees/04ce/Art_Equation_Studio_2026-08-27_v81-combined-with-desktop-scope/current/2026-10/integration/prototype-2.5-engine`

Read applicable AGENTS.md, `scripts/QUALITY_GATE_GUIDE.txt`, and `scripts/UI_CONSISTENCY_POLICY.txt`. Preserve originals, Settings, Saving, Codex, aquarium, themes and compact bottom toolbar. Keep WebView2: the owner rejected the native-pane experiment and requested rollback. Do not change that decision to implement shader caching.

**Session rule: no new app EXE until upgrade jobs 1–7 are finished.** Source/frontend/WASM compilation and checks are allowed. Do not reset/clean the worktree; extensive source is untracked. Existing app EXEs remain unchanged.

Main scope: `docs/engine/classic-retained-telemetry-multicore-scope-2026-10-11.md`.
Prior detailed handoff: `docs/engine/GEMINI-HANDOFF-CLASSIC-PERFORMANCE-2026-10-12.md`.
Progress: `docs/engine/CLASSIC-UPGRADE-PROGRESS-2026-10-12.md`.
Latest research: `docs/engine/DX12-PIPELINE-RESEARCH-2026-10-12.md`.
This handoff supersedes stale status text in older files.

## Owner's latest request

Set up retained pipelines during launch, DX12 disk caching for the real EXE, and actual viewport-device warm-up behind the splash screen. Owner emphasized that the browser preview is a test window. Verify the executable's actual renderer boundary rather than assuming native presentation from its extension.

## Verified architectural facts and important correction

- The current EXE is Tauri with WebView2. The production viewport uses WASM Vello 0.10.0 and wgpu 29.0.4 WebGPU targeting an HTMLCanvasElement. Native Rust services also use DX12/Vulkan wgpu, but their compute helper is a different device/session. Warming that helper does not warm the viewport.
- Local wgpu-hal 29.0.4 DX12 code defines an empty PipelineCache and create_pipeline_cache returns that placeholder. Public wgpu 29 persistent cache is Vulkan-only. Do not add a setting falsely claiming native DX12 pipeline-library caching through this API.
- **New finding:** Chromium/Dawn has a runtime-managed WebGPU GPU-blob cache, with host-side disk storage callbacks. Therefore the earlier statement that browser rendering cannot benefit from disk GPU caching was too broad. What is unavailable is an application-controlled native DX12 pipeline-library handle through browser WebGPU.
- Actual existing app profile was inspected read-only at `C:/Users/User/AppData/Local/studio.artequation.p1v21/EBWebView`. It contains `Default/DawnWebGPUCache`, `Default/DawnGraphiteCache`, `Default/GPUCache`, and root `GPUPersistentCache`, `ShaderCache`, `GrShaderCache`. Directory presence does NOT prove hits, contents, active D3D12 backend or performance gains.
- Keep that existing persistent profile. Do not point the app at a fresh profile and lose settings/login/browser storage. Do not delete, manually overwrite, copy between adapters or manage opaque runtime shader blobs.
- Next caching work should verify runtime/backend and cache write/reuse with controlled cold/warm launches, expose honest cache diagnostics, and preserve runtime-managed persistence. An independent native DX12 cache is useful only if wired into a native workload it actually serves. No such custom cache was completed in this pass.

Primary sources for the new finding:
https://chromium.googlesource.com/chromium/src/+/main/gpu/command_buffer/service/dawn_caching_interface.cc
https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder
https://learn.microsoft.com/en-us/windows/win32/api/d3d12/nf-d3d12-id3d12device1-createpipelinelibrary
https://docs.rs/wgpu/29.0.0/wgpu/struct.PipelineCache.html

## Status by job

1. Diagnostics/Codex: source adds instance-aware handshake, executable/WASM identities, native durable event cursor replay, bridge discovery/auth/ambiguity tests. New tools are not deployed to the old running EXE. Full end-to-end phase/input/GPU timing remains incomplete.
2. Retained engine API: source complete for load/ordered patches/camera-only commands. Unchanged camera commands avoid full-scene transfer/hash/parse. Strict candidate validation still copies candidate Value for edits; Scene::append remains O(N). Not a constant-time renderer claim.
3. Incremental prep: retained immutable vector/card contributions and non-tiled translation reuse; canonical validation lookup cached until model identity changes. Full arbitrary delta spatial updates remain limited.
4. Resource caching: successful residency/upload admission cached by references and immutable upload identity, retained native atlas allocation accounting, invalidation on changes/failure/disposal.
5. Multicore: bounded shared browser TIFF/model decoder admission plus conservative native pyramid quota. Not a cross-process core scheduler; experimental helper outside these quotas.
6. Synchronization: staged SOURCE, not verified. Classic checked-ordered mode avoids later queue-completion waits; required checked coarse allocation readback is preserved. Hybrid retains completion requirement. Need safety/pixel comparison before acceptance.
7. Actual viewport warm-up: newly wired SOURCE, not browser-proven or full-build-proven. See below.
8. Tests: 100 / 500 / 1,000 / 5,000 / 10,000 mixed objects. Cold/warm, pan/zoom/drag/edit, subset vs all-visible, memory/refinement/uploads and end-to-end input timing. Do after source correctness; no current new performance result.
9. Acceptance/package: only after jobs 1–7 and appropriate gates. No new EXE has been built.

## Latest edits, exact files

`engine/vello-surface/rust/src/lib.rs`:
- SurfaceState wait_for_completion defaults false. Export set_completion_policy supports checked-ordered / checked-completed.
- Classic final completion waits gated by policy; Hybrid retains its completion gate. Metadata distinguishes completionPolicy and queueOrdering; do not claim completed GPU work for checked-ordered receipts.
- warm_classic registers tiny image and representative fill/stroke/curve/opacity scene, prepares private 64x64 texture and surface-format blit, waits once at startup, checks health, discards prepared scene and removes temporary image references. It does not acquire/present visible surface pixels.
- Warm image schema fixed to include sourceRect and sampling bilinear. Latest WASM rebuilt with browser-hybrid feature and provenance receipt recorded successfully.

`src/project-b/p0-surface/backends.ts`:
- createGpuSession wraps initialization with viewportWarmup counters; internal createWarmedGpuSession calls renderer.warm_classic BEFORE returning actual retained session.
- Records gpu.launch-warm telemetry. Accounts surviving warm atlas allocation using existing tile-atlas pool. Same renderer/device continues into real frames.
- Error cleanup releases warm image lease.
- Last tiny corrections changed invalid pool image-atlas to tile-atlas and snapshot counter type; these fixes have NOT been re-typechecked yet.
- Review frameLease.resize after warm: check failure handling and accounting for private warm target/temporary texture. Audit before claiming budget correctness.

`src/project-b/p0-surface/viewportWarmup.ts` NEW:
- Pure external-store pending/ready/failed counters with idempotent finish and subscription; counter type corrected after first TS failure. Needs controlled tests for concurrent sessions, failure and idempotence.

`src/project-b/p0-surface/presenter.ts`:
- Added warm() preparing a retained GPU session with busy guard; no surface publication. Frames queue while setup is pending; finally cleanup on disposal or kick newest pending frame.
- Existing lazy initialization remains available. Review warm/setup error fallback and late disposal; add tests. Test injected factories do not execute real rasterizer.

`src/board/VelloBoardBackdrop.tsx`:
- Calls environmentPresenter.warm() and presenter.warm() after both callbacks are installed, before regular painting. Both sessions remain independent; warm-up does not share devices across them.

`src/BootLoader.tsx`:
- Subscribes to viewportWarmup; auto-exit readiness requires pending zero. Existing 5-second minimum, 10-second escape and manual Enter remain. Uses existing translated status text, no UI redesign.
- If canvas pane is not mounted at boot, there is no viewport session to warm; it warms on first mount. Do not claim all hidden panes/fonts/assets are warmed.

`src/project-b/p0-surface/backends.test.mjs`:
- Added actual warm-store transpilation/import rewrite for existing data-URL test harness.

## Evidence at interruption

- WASM compilation/provenance succeeded: `output/step67-engine-build.log` (release build ~10 seconds, four warnings).
- Existing presenter tests and backend guard tests passed before TypeScript stage. They do not cover new warm lifecycle yet.
- TypeScript failed on pool name and literal counter type. Both were fixed immediately before handoff, but rerun is required.
- Browser test `node scripts/classic-resource-browser-check.mjs` was started, remained in Vite dependency optimization, and was intentionally interrupted with Ctrl+C in session 13875 when owner requested handoff. `output/step67-resource-browser.log` has no final PASS. Do not reuse older PASS as proof of these latest changes.
- Existing verified steps3–5 report: `D:/0/ArtEquation-Tests/2026-10-12-classic-resources/1791793345477/report.json` (actual frontend Classic session/resource reuse, four real browser worker decodes). It predates warm-up wiring.
- Earlier retention proof: `D:/0/ArtEquation-Tests/2026-10-11-browser-dual/retained-correctness-1791791619801/report.json`. Predates synchronization/warm-up changes.
- Previous full frontend source build: `output/step35-final-build.log`. Predates these edits.

## First actions tomorrow

1. Confirm no orphan owned test processes remain; do not kill user apps or browser tabs. Read latest source and the logs above.
2. Rerun `npx tsc -b`. Add presenter tests: warm queues only latest frame, no warm pixels published, same session used, pending disposal releases late session, initialization failure recovers. Add warm-store tests.
3. Verify warm_classic strict scene parsing with actual WASM/browser. Check its current tiny fixture for all strict required fields. Add clips/composites if needed and report exercised paths honestly.
4. Run `node scripts/classic-resource-browser-check.mjs` with bounded timeout; compare upload deltas because warm-up legitimately adds its tiny image/page once. Run `node scripts/retained-browser-correctness.mjs`, adding checked-completed vs checked-ordered same-scene pixel comparison and resize/stale/error cases. Preserve failed reports.
5. Research exact installed WebView2/Dawn backend and persistent-cache behavior. Implement read-only cache telemetry/diagnostics at the bridge and launch hardware panel as appropriate. Native feature reporting is not viewport backend reporting; no fabricated cache hits.
6. `npm run build:v2` for source/frontend checks. If Rust diagnostics change, cargo check/tests only; **no app EXE yet**. WASM rebuild command: PowerShell `$env:AE_ENGINE_FEATURES='browser-hybrid'; node scripts/engine-provenance.mjs --record`.
7. Update scope/progress and this handoff with precise pass/fail evidence, then proceed to mixed-object performance tests only when correctness and GPU availability permit.

Keep measured 4K acceptance separate: physical 3840x2160, three runs, pan p95 <=16.2ms, zoom <=22.3ms, first post-gesture <=78.5ms, sharp <=613ms, 120 pan / 60 zoom events, no GPU fallback or quality reduction, five-minute soak. Existing small-scene correctness is not this acceptance.

Preserved reference EXE: `D:/0/ArtEquation-Tests/2026-10-11-reference-reconstruction/builds/2026-10-11-boot-splash-alpha/Art-Equation-alpha.exe`, previously verified SHA256 `6b36eab49405020c71e97b445f3f90dfe993d27d90146729b6c29fd25a7acf4a`. Reverify before using; do not overwrite.
