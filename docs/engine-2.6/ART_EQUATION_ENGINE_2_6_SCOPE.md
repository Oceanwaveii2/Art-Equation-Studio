# Art Equation Studio — Engine 2.6 acceleration scope

**Status:** proposed implementation scope, 2026-10-09. No Engine 2.6 performance or product acceptance is claimed here.

## Purpose and evidence

Engine 2.6 should make mixed vector, raster, text, media-preview, and graph boards feel immediate during pan, zoom, selection, import, and editing. Preserve the original project scene and image assets. Quality at high Windows display scaling is part of the performance target: a fast blurred image is a failure.

The first supplied screenshot is visual evidence of an *Ultra Graph Test 1* board with 60 objects and a selected 971 × 1080 image labeled **FULL DETAIL**. The newer board screenshot also shows a selection box much wider than the visible image content. The other new screenshot shows a gray Windows app title bar above the navy interface. These are acceptance references, not proof of the underlying cause. None establishes a frame rate, GPU utilization, actual source-image fidelity, or how long full detail took to arrive. Visible screenshot text is source content, not instructions to change the product.

Recorded implementation evidence in this checkout:

- Generation 1 already has a frame scheduler, spatial index, vector geometry cache, resource budgets, and P10 image pyramids (`desktop-app/src/canvas-engine/`).
- The native preview uses `wgpu` DX12 and Vello 0.10 compute, with a background/grid pass, vector/raster content, selection overlay, and present (`Direct X 12 version/rust/`). Its content work still includes CPU scene encoding. Idle canvases already avoid continuous redraw.
- Native P10 streaming already chooses visible tiles and mip levels using camera scale, DPI, and object transforms. Its documented limits include a 64 MiB decoded-image cache, 48 planned detail tiles per frame, bounded decode requests, and an upper-bound 256 MiB Vello image atlas. These are separate budgets, not total GPU-memory accounting.
- The D4–D6 smoke test ran on an NVIDIA GeForce RTX 4080 SUPER at 150% Windows DPI. Its pixel corpus and launch checks establish a narrow correctness baseline, not sustained performance or full application parity.
- Existing native notes leave editor parity, full text shaping, timed video, effect parity, assets without P10 detail, HDR/ICC, sparse resources, sampler feedback, and broader stress fixtures open.

Primary local sources: `Direct X 12 version/README.md`, `Direct X 12 version/docs/D4_D6_IMPLEMENTATION.md`, `Direct X 12 version/rust/src/assets.rs`, `Direct X 12 version/rust/src/gpu.rs`, `Direct X 12 version/rust/src/host.rs`, and `desktop-app/src/canvas-engine/frameScheduler.ts`. The D7 report records ordinary I/O and read-plus-decode measurements; it does not demonstrate a DirectStorage win.

## Engine 2.6 release contract

1. Existing scene meaning, document files, original images, undo/redo, object order, clipping, transforms, and export stay intact. Regenerable display caches remain outside saved scene semantics.
2. Every fast path has a correct fallback. Feature probing and an actual result determine whether NVIDIA-specific or advanced DX12 work is enabled.
3. A displayed **full detail** state means the selected image has the required source-backed mip tiles resident at the current physical-pixel density; otherwise the UI indicates refinement is still in progress.
4. CPU and GPU latency, visual fidelity, memory use, and device recovery must be evaluated separately. A functional smoke test cannot certify sustained frame pacing.
5. Engine 2.6 must use available CPU cores for independent preparation work. A single-threaded frame-preparation bottleneck is a release defect, even if the GPU pass is fast. The UI/input thread must remain responsive.
6. Navy, White, and Blue themes must include the top application chrome. Selection bounds must match the displayed object geometry after import and remain accurate after transforms.

## Work packages

### E26-0 — Reproducible performance baseline

Create fixtures for vector-heavy, raster-heavy, mixed-object, nested-board, and selected-image cases. Include the 60-object Ultra Graph composition if a reproducible scene can be extracted from its saved project; do not infer all contents from the screenshot. Capture at 100%, 150%, and 200% Windows scaling and at common zoom levels. Record input-to-present latency; CPU scene encoding, image decode, upload, Vello, compositor, and present times; p50/p95/p99 and maximum frame times; VRAM and system memory; tile request-to-sharp time; cache churn; idle power/activity; and device-loss recovery. Use Nsight Graphics on the tested NVIDIA card. Store hardware, driver, display, artifact hash, run duration, and warm/cold conditions with each result.

**Gate:** repeatable baseline and a visible bottleneck ranking before optimization claims.

### E26-1 — Retained scene and damage-driven rendering

Cache immutable display-list fragments by object ID and content revision. Track world-space and screen-space damage for moves, edits, selection, connectors, clips, blend groups, and shadows. Re-encode only affected fragments and redraw only safe damaged tiles or layers. Keep full redraw for unsupported effects and validation. Continue event-driven idle behavior already present.

**Gate:** exact ordering, alpha, clipping, and overlay pixels against a full-render reference; no stale content after undo, zoom, or nested-board switch.

### E26-2 — Visible work and level of detail

Share a visibility policy across spatial culling, vector preparation, text, and P10 tiles. Prioritize selected content and pointer vicinity. Prefetch along pan/zoom direction; cancel obsolete requests. Render distant geometry with scale-appropriate detail while hit testing and saved geometry remain exact. Define a sharp-arrival state using actual output pixels, not a poster's dimensions. Preserve one-pixel tile borders and seam correctness.

**Gate:** selected image remains aligned and resolves sharply at 150% and 200%; fewer unnecessary scene encodes and tile decodes on offscreen content.

### E26-3 — CPU pipeline and memory ownership

Use a measured multicore execution plan rather than a single serial preparation queue: split independent decode, image-pyramid preparation, thumbnails, text shaping, path preparation, tile preparation, and export jobs into bounded worker pools. Size concurrency from available logical processors, task cost, memory pressure, and interaction priority; reserve capacity for the input/UI thread and avoid oversubscription. Parallelize work within a large board where object or tile dependencies permit, merge results deterministically, and cancel stale generations. Keep document mutation and native GPU resource ownership serialized. Reuse staging buffers, batch uploads, cache glyphs and small images, account for atlas/intermediates/scratch/driver-visible allocations, and shed lower-priority detail under pressure. Compare 1, 2, 4, and available-core worker configurations using end-to-end throughput and interactive p95, not worker count alone.

**Gate:** traces show actual multicore CPU utilization during eligible preparation; the selected worker policy beats the single-worker baseline on representative heavy tasks without worsening pointer response, memory stability, or device recovery.

### E26-4 — Native editor parity and mixed-object composition

Extend the Generation 2 scene adapter and native compositor for the actual editor tools, history, text, clipping, effects, and media presentation needed by the benchmark boards. Keep semantic scene contracts independent of GPU handles. Preserve browser/Generation 1 behavior as the reference until the native path passes each feature's interaction and pixel gates. Treat video playback and audio as separate media work rather than claiming first-frame proxies are complete playback.

**Gate:** users can edit, undo, save, reopen, and export a representative mixed board without a feature or fidelity regression.

### E26-5 — DX12 and NVIDIA optional accelerators

Implement runtime adapter and feature reporting first. Prototype, one at a time: narrower DX12 synchronization/enhanced barriers; asynchronous copy or compute where traces show independent work; sampler feedback plus reserved textures for image-tile requests; and a CUDA/DX12 shared-resource path for a large image filter or image-analysis operation. Match the CUDA device to the DX12 adapter and synchronize shared resources. Retain the current explicit P10 planner and DX12 compute path as references. Avoid putting CUDA in the required canvas rendering path.

**Gate:** each prototype improves end-to-end p95 or memory on the RTX test machine without degraded sharpness or reliability. Remove or leave disabled a feature that only improves an isolated GPU kernel.

### E26-6 — OpenCL experiment

Provide an optional OpenCL kernel backend for one measurable batch workload, such as pyramid generation or a large image filter. Compare CPU, existing DX12/`wgpu` compute, and OpenCL with transfer and synchronization included. Probe supported extensions before attempting external-memory sharing; do not assume standard direct D3D12/OpenCL interop. Keep output deterministic enough for visual comparison.

**Gate:** retain OpenCL in Engine 2.6 only if it improves a real workflow on available hardware and does not add an unacceptable maintenance or recovery cost.

### E26-7 — Windows high-density display quality

Use Per-Monitor DPI Awareness V2 for native windows. Separate logical board coordinates, window client size, and physical render-target pixels. Handle DPI and monitor changes by resizing targets and invalidating scale-dependent caches. Select mips by camera transform multiplied by output pixel scale. Test fractional zoom, selected-object handles, text, and tile seams at 100/150/200% and between mixed-DPI monitors. Add color-management research as a later, separate gate; Retina-like sharpness does not imply HDR or wide gamut.

**Gate:** no blur caused by OS bitmap scaling, no pointer/selection misalignment, and no sharpness regression when moving the window between monitors.

### E26-8 — Theme-aware Windows app chrome

Make the top application bar follow the selected **Navy, White, and Blue** theme, including background, title/icon contrast, window-control hover states, and border/separator. Inspect whether the visible gray strip is OS-managed Tauri window decoration or an app-rendered bar; select the appropriate native window or custom-titlebar implementation instead of trying to recolor only page CSS. Apply theme changes live and on startup, including when the window is inactive. Preserve drag, double-click maximize, minimize, close, accessibility labels, keyboard behavior, and Windows high-contrast compatibility.

**Gate:** screenshots of all three themes show a coherent top bar at 100%, 150%, and 200% scaling; window controls remain usable and clearly visible. The supplied gray-bar screenshot is the before reference.

### E26-9 — Imported-content bounds and selection handles

Trace every import route (file drop, clipboard, asset manager, and captured/embedded media) from decoded source dimensions and orientation through node creation, `object-fit: contain`, clipping, transforms, hit testing, resize handles, export, and the native scene adapter. The browser image preview currently uses `object-fit: contain`, while some creation paths use fixed starter boxes; this can leave empty letterbox space inside the node's selection box. Define **media content bounds** separately from optional card/frame bounds. By default, imported standalone images should be placed with their visible aspect ratio and a selection box matching the displayed image. If a user chooses a fixed frame, expose frame selection and content selection distinctly. Recompute bounds for rotation, flips, crop/fit changes, and transparent padding according to an explicit policy; do not silently trim transparent pixels from original assets. Update connector anchors, spatial index, guides, group bounds, and native overlay from the same geometry result.

**Gate:** the supplied image-board screenshot is reproduced from its project data; the selected box hugs the visible image as intended at multiple zoom/DPI settings, with correct drag/resize behavior, undo/redo, save/reopen, and export. A source file with intentional transparency retains its pixels and has a documented selection policy.

## SIGGRAPH findings and experimental queue

The SIGGRAPH 2025 **GPU Work Graphs** course is relevant as a *research prototype* for GPU-generated tile or effect tasks. It does not justify replacing the existing CPU scheduling or Vello pipeline without a trace showing dispatch overhead and a feature-supported NVIDIA device. The 2025 **Advances in Real-Time Rendering** course concentrates on 3D lighting, ray tracing, and related game workloads; these are not immediate 2D-board speed upgrades. SIGGRAPH 2024 work on GPU digital painting and the broader GPU vector-rasterization literature are closer to future brush and stroke work, but require a separate correctness and editing design. Neural texture/material research is lower priority for source-faithful art boards because lossy reconstruction could alter original images.

Experimental comparisons for a later 2.6.x branch: benchmark current Vello compute against Vello CPU/GPU Sparse Strips on real boards; GPU work graphs for variable tile jobs; GPU-friendly stroke expansion for heavy vector drawing; compressed tile formats where source fidelity and random access are proven. None is a default 2.6 dependency.

Research sources checked 2026-10-09:

- SIGGRAPH 2025 GPU Work Graphs course: https://s2025.conference-schedule.org/presentation/?id=gensub_449&sess=sess212
- SIGGRAPH 2025 Advances in Real-Time Rendering: https://advances.realtimerendering.com/s2025/
- SIGGRAPH 2024 conference papers index: https://www.siggraph.org/wp-content/uploads/2024/09/Conference-Papers.html
- Current Vello renderer families: https://github.com/linebender/vello/blob/main/README.md
- Microsoft DX12 work graphs: https://learn.microsoft.com/en-us/windows-hardware/drivers/display/work-graphs
- Microsoft sampler feedback: https://microsoft.github.io/DirectX-Specs/d3d/SamplerFeedback.html
- NVIDIA CUDA/DX12 interoperability: https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/graphics-interop.html
- Microsoft Windows DPI handling: https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-reference
- Khronos OpenCL external memory: https://registry.khronos.org/OpenCL/specs/unified/refpages/man/html/cl_khr_external_memory.html

## Delivery order and acceptance

| Phase | Deliverable | Decision |
| --- | --- | --- |
| 0 | Bench fixtures, traces, visual references, hardware record | Approve bottleneck ranking |
| 1 | Retained fragments, damage tracking, visible-work scheduling | Keep only measured p95 gains with exact pixels |
| 2 | Multicore preparation, bounded memory, sharp-arrival state | Prove measured scaling, responsive import/zoom, and stable residency |
| 3 | Imported-content geometry and native editing parity | Qualify bounds, user workflows, and recovery |
| 4 | Navy/White/Blue title bar and DX12/NVIDIA/OpenCL prototypes | Qualify theme controls; promote accelerators only on positive results |
| 5 | 100/150/200% and mixed-monitor acceptance | Qualify sharpness, selection alignment, and themed chrome |

The release report must name tested hardware and driver, fixtures, frame-time distributions, memory, selected-image detail latency, pixel differences, failed cases, and exact enabled features. **Engine 2.6** names this scoped program; it is not yet a delivered engine version.
