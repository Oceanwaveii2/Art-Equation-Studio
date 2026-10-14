# DOM removal progress — 2026-10-09

Implemented: production grid/background now enters the ordered Vello display list at submission. Grid coordinates use camera plus surface size; no CSS gradients or card measurements. Grid preparation does not invalidate cached card compilation. Dense grids retain the existing two-pixel minimum spacing. Pixel tests cover pan, zoom, hidden state and bounded line count using actual Vello CPU output.

Cold preparation now reports separate text-engine wait, native font resolve/fallback, font registration, text shaping, TIFF decode and image decode spans. Async spans are elapsed waits; synchronous shape/register spans are CPU-side calls. None establish total-frame latency or a 4K pass.

Remaining: video transport and playback controls; PDF/PSD/3D presentation; passive non-image card subtree removal with editing/IME handoff; native workspace shell preserving document editor, accessibility, settings, storage and Codex. React/WebView2 still hosts the workspace. The separate native window host is not a native workspace implementation. No claim that all DOM is removed.

Next migration boundary: connect native host input and scene delivery to the production command/model boundary, then media presentation. A native workspace requires document/Type editing, selection, undo, accessibility, Settings, storage and Codex contracts; removing browser controls without those replacements is not conversion.

## Source-tile implementation

Qualified pyramid images now compile from authored image framing, object rotation and live camera/surface dimensions. The provider decodes bounded PNG tiles with createImageBitmap and OffscreenCanvas (no mounted DOM geometry or separate WebGL viewer). Stable tile references preserve source SHA/revision and reuse checked decoded resources. Vello receives core rectangles, source-to-world transforms, clip/composite scopes and grayscale/opacity/flip support. Unsupported composition overlays still retain an explicit fallback. Registry/memory-limit failures remain explicit; this does not qualify worst-case full-4K tile residency.

Accepted image cards remove their legacy browser viewer subtree rather than merely making it transparent. The article remains an input/selection host, and ownership loss restores the fallback. Viewer-only DOM mutations no longer invalidate model image paint. Small actual CPU pixel tests verify colors, seam boundaries, pan crop and rotation geometry. The writable-canvas EXE passed small native pan/move, graph/Type/full-source/tile paint, board return and save/reopen checks. This is not stress-board or 4K acceptance.

## Flicker handoff and native host

Model-painted card descendants and non-editing focus no longer act as browser paint authority. Fully model-painted scenes retain the last accepted Vello frame while a replacement prepares, with camera reprojection. That retention never advances accepted generation, input completion or quality telemetry. Board changes, removed/hidden members, unsupported mixed media and active editors retain explicit handoffs. A native interaction check records any restoration of browser paint during pan/move.

`engine/native-canvas-probe/src/bin/live_host.rs` implements a demand-driven native window using the existing Vello renderer. Initial pixels are prepared before revealing the window. Native pointer, keyboard, IME, resize and DPI events emit scoped JSON receipts. Bounded frame/camera commands preserve the session, coalesce pending updates and reject stale generation/sequence values. Native camera and scene-update checks passed without WebView2 or pixel readback. This host does not yet mutate/save production boards or implement the complete workspace shell.

Workspace, video, PDF/PSD and 3D conversion remains open. No claim that this removes WebView2 from the application.
