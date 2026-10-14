# DX12 pipeline research: Classic launch preparation

Research date: 2026-10-12. This is an implementation scope, not a performance result or a deployed feature.

## Findings

1. DX12 pipeline state objects (PSOs) combine shader bytecode and fixed pipeline settings. Creating them during initialization allows reuse during rendering. Render-target format, sample count and root signature are among the relevant settings; warming a different device or format does not establish readiness for the viewport.
2. Native DX12 pipeline libraries can persist compiled PSOs between launches. Probe `D3D12_FEATURE_SHADER_CACHE` and `D3D12_SHADER_CACHE_SUPPORT_LIBRARY`. Reject incompatible or corrupt blobs and rebuild; adapter and driver/runtime changes can invalidate the cache. Keep the supplied library blob alive throughout the library lifetime. Serialize simultaneous loads of the same PSO.
3. The pinned viewport dependency is wgpu 29.0.4 with the `webgpu` feature, and Classic Vello 0.10.0. The wgpu 29 public `PipelineCache` documentation lists Vulkan support only and identifies it as Rust-only. Browser WebGPU does not give this application a native DX12 pipeline-library handle. A native helper using another device must not be reported as warming the browser viewport.
4. Microsoft's PSO sample uses an already compiled general shader while specialized variants compile. This is a useful design pattern, but not an automatic reason to replace Vello's compute rasterizer with a custom whiteboard shader.
5. DX12 supports separate copy/compute/graphics queues and dependency fences. Browser WebGPU does not expose those native queues for direct application control. Here, maintain ordered submissions and resource lifetimes; remove only a demonstrably redundant completion wait, preserving the checked allocation readback required by our renderer.

## Apply to this app

- Initialize and retain the actual viewport renderer/device while the launch screen is visible. Reuse that session for the first real board frame.
- Run a tiny private render with representative fills, curves, strokes, transparency and sampled images, followed by a private blit in the actual surface format. Do not publish test pixels to the visible canvas.
- Observe completion once at startup and record duration, failure, device/session identity and exercised paths. This is representative warm-up, not proof that every shader variant, font or asset has been prepared.
- Permit manual entry and a bounded failure escape; a failed warm-up must not trap startup. A pane created later warms its own session at creation.
- Keep existing pipelines, atlas resources and scene data alive through camera movement and board changes. Device loss requires rebuilding and warming the replacement session.
- Compare checked-completed and checked-ordered rendering for pixels, resize, stale-frame rejection, resource changes and failures before accepting synchronization changes.
- Separate module/device creation time, representative render time, queue completion callback time, first real frame and warm camera frame metrics. Callback time is not isolated GPU execution time or physical display latency.

## Acceptance and limits

First verify private warm-up, identical subsequent Classic pixels, no leaked image references, safe disposal during initialization, and failure recovery. Then run the agreed 100 / 500 / 1,000 / 5,000 / 10,000 mixed-object matrix, with cold/warm results and 4K end-to-end measurements. No speedup is established by research or compilation alone.

No Vulkan rewrite, WebView2 replacement or new app EXE is part of this research pass. Native DX12 persistent PSO libraries remain a separate backend-integration scope, not an enabled setting in this browser viewport.

## Primary sources

- [Microsoft: Managing Graphics Pipeline State in Direct3D 12](https://learn.microsoft.com/en-us/windows/win32/direct3d12/managing-graphics-pipeline-state-in-direct3d-12)
- [Microsoft: CreatePipelineLibrary](https://learn.microsoft.com/en-us/windows/win32/api/d3d12/nf-d3d12-id3d12device1-createpipelinelibrary)
- [Microsoft: Pipeline state cache sample](https://learn.microsoft.com/en-us/samples/microsoft/directx-graphics-samples/d3d12-pipeline-state-cache-sample-win32/)
- [Microsoft: Multi-engine synchronization](https://learn.microsoft.com/en-us/windows/win32/direct3d12/user-mode-heap-synchronization)
- [wgpu 29: PipelineCache](https://docs.rs/wgpu/29.0.0/wgpu/struct.PipelineCache.html)
- [MDN: createComputePipelineAsync](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createComputePipelineAsync)

Local evidence: `engine/vello-surface/rust/Cargo.toml`; `engine/vello-surface/rust/src/lib.rs` renderer initialization, checked rendering, completion policy and staged private warm-up. Warm-up is not yet wired into launch readiness or browser-verified.
