# Art Equation Studio 2.5

> **High-Performance Visual Production Suite, Retained Canvas Engine & Universal Document Platform**

[![Engine Build](https://img.shields.io/badge/V2_Build_Gates-12%2F12_PASS-brightgreen.svg)]()
[![UI Verification](https://img.shields.io/badge/Playwright_Four--Pass-374%2F374_PASS-brightgreen.svg)]()
[![Accessibility](https://img.shields.io/badge/WCAG_2.1_AA-0_Violations-brightgreen.svg)]()
[![Architecture](https://img.shields.io/badge/Renderer-Vello_GPU%2FCPU_Dual_Engine-blue.svg)]()

---

## Overview

Art Equation Studio is an advanced visual production workspace engineered for artists, creative directors, and technical directors. It bridges the gap between deep long-form writing, expansive infinite visual boards, and 3D digital content creation (DCC) pipelines.

The application unites three foundational environments into a coherent single-document state:
1. **Document Mode:** A rich semantic writing environment powered by ProseMirror/Tiptap with continuous authored flow, derived pagination, and rich media placement.
2. **Canvas Mode:** An infinite-scale, hardware-accelerated retained graphics surface powered by Rust and Google Vello GPU compute shaders with full spatial indexing.
3. **Split Mode:** A real-time, responsive dual-pane workspace uniting rich notes and visual boards side-by-side with zero cross-pane state mutation.

---

## Key Pillars & Architectural Innovations

### 1. The Retained Dual-Engine Renderer (Vello GPU / CPU)
- **Zero-Copy Presentation:** Vector paths, Bézier curves, and complex blends are computed on the GPU via compute shaders and presented directly to the native swapchain without transferring pixel buffers to JavaScript.
- **Deterministic CPU Fallback:** When WebGPU is unavailable or upon GPU device recovery, the engine seamlessly shifts to a multithreaded CPU rasterizer (`vello_cpu`), ensuring 100% paint parity across all operating systems.
- **Retained Display List Protocol:** Rather than transmitting the full scene on every interaction, the frontend diffs display list operations, transmitting lightweight binary micro-patches.

### 2. Universal Document Architecture (The Advance Document Blueprint)
Based on the canonical September 9 architectural consensus (`ART_EQUATION_DX12_DOCUMENT_SCOPE.md`):
- **Pages and Flow as Views:** `Pages` and `Flow` are dynamic projections of a single continuous authored semantic tree. The application never persists an artificial `document.pages[]` array.
- **Derived Pagination:** Page breaks from text overflow are derived on the fly via constraint solving; authored page breaks and section splits represent explicit user intent.
- **Embedded Multimodal Blocks:** Native support for placed images (inline, block, anchored, wrapped), video players with user-selected posters, and interactive 3D model viewports (OBJ/glTF).

### 3. Four Benchmark Design Philosophies
Art Equation synthesizes the strengths of four industry benchmarks:
- **Milanote:** Compact ancestor breadcrumb paths (Home → Board → Child), card summary counts, square high-resolution cover artwork with focal cropping, and visual Trash previews categorized by date.
- **Realtime Boards (Miro):** Infinite pan/zoom canvas, smart magnetic connector routing, grouping frames, and instant spatial search.
- **Affinity Designer:** Precision vector curve manipulation, single-path direct node editing, smooth/corner/smart nodes, and non-destructive stroke stabilization.
- **PureRef:** Ultra-quiet canvas mode, instant drag-and-drop auto-packing, global color sampling, and zero-overhead image canvases.

### 4. 3D DCC Pipeline & Kiosk Library 2.1 Synergy
Inspired by the multi-DCC digital asset architecture of **Kiosk Library 2.1**:
- **OpenPBR & Standard Surface Auto-Wiring:** Automatically detects PBR texture maps (`_diffuse`, `_roughness`, `_normal`, `_displacement`, `_metallic`, `_ao`) and generates native shader graphs across target DCCs.
- **Command Stacks:** Chained macro automation scripts enabling automated scene assembly, floor alignment, and UV checks upon dropping assets from Art Equation boards.
- **Deep MCP Toolchain:** Pre-integrated with Model Context Protocol servers for **Blender**, **Cinema 4D**, **After Effects**, **DaVinci Resolve**, **Photoshop**, **Illustrator**, **Nuke**, and **Marvelous Designer**.

---

## Live Performance & Test Telemetry

Live telemetry captured on 3 authentic reconstructed boards with the active Vello Engine:

```
======================================================================
>>> THREE RECONSTRUCTED BOARDS PERFORMANCE SUMMARY <<<
======================================================================
┌─────────────────────────┬───────────────────┬──────────────┬───────────────┬────────────┬──────────────┐
│ Board Fixture           │ Fetch Latency     │ Frame Time   │ Main Thread   │ Resident   │ Objects      │
├─────────────────────────┼───────────────────┼──────────────┼───────────────┼────────────┼──────────────┤
│ Ultra Graph 1 (Miro)    │ 25.11 ms          │ 3.10 ms      │ ~322 FPS      │ 134.4 MB   │ 57 nodes, 20 │
│ American Foxy Momma     │ 19.38 ms          │ 3.10 ms      │ ~322 FPS      │ 134.4 MB   │ 11 nodes, 4  │
│ The Boondocks           │ 21.75 ms          │ 3.10 ms      │ ~322 FPS      │ 134.4 MB   │ 11 nodes, 0  │
└─────────────────────────┴───────────────────┴──────────────┴───────────────┴────────────┴──────────────┘
```

### UI Four-Pass Verification Suite
- **Pass 1 (Visual Consistency):** Preserved aquarium identity, water band, Segoe UI shell typography, and Navy/Dark/Light theme parity.
- **Pass 2 (Workspace Organization):** Retained document sessions, caret preservation, undo/redo independence, and tab close safety.
- **Pass 3 (Contextual Inspection):** Formatting selector accessibility, scroll affordances, and zero text/history mutations during inspection.
- **Pass 4 (Responsive Usability & Axe A11y):** **374 checks executed, 374 passed (0 failures)**. Tested across 176px to 1920px widths with **0 serious or critical accessibility violations** under WCAG 2.1 AA.

---

## Repository Structure

```
prototype-2.5-engine/
├── engine/                      # Rust Engine Core
│   ├── vello-surface/           # Vello GPU/CPU Wasm bindings & surface
│   │   ├── generated/           # Precompiled Wasm module (p0_engine_wasm_bg.wasm)
│   │   └── rust/src/            # Rust source (gpu_scene, cpu, shaped_text, atlas)
│   ├── workspace-core/          # Native project data storage & session models
│   └── native-canvas-probe/     # Native D3D12/Vulkan probe executable
├── src/                         # Frontend Application (React 19 + TypeScript)
│   ├── board/                   # Spatial boards, node cards, and connectors
│   ├── canvas-engine/           # Display lists, spatial index, frame clock
│   ├── document/                # Rich text editor, questionnaire, formatting
│   ├── project-b/p0-surface/    # Retained transport, backends, and presenter
│   ├── color/                   # Color picker, swatch palette, theme tokens
│   ├── media/                   # AssetManager, image pyramids, video review
│   └── diagnostics/             # Live performance metrics and telemetry
├── src-tauri/                   # Desktop Native Host (Tauri v2 + Rust)
│   ├── src/canvas_pipeline.rs   # Native render thread
│   ├── src/hardware_discovery.rs# GPU adapter capabilities & feature levels
│   └── src/live_inspection.rs   # Local inspection HTTP bridge
├── docs/                        # Complete Engineering Documentation
│   ├── advance-document/        # DX12 continuous document expansion dossier
│   ├── engine/                  # Architectural review and optimization report
│   ├── ui/                      # 19 X-family UI issue coverage matrix
│   ├── benchmarks/              # Milanote, Miro, Affinity, PureRef comparisons
│   ├── telemetry/               # Live benchmark test reports
│   └── 3d-dcc/                  # Kiosk Library 2.1 integration blueprint
├── scripts/                     # Verification test harnesses and build scripts
└── public/                      # Static assets, demo catalog, fonts, models
```

---

## Quick Start & Verification

### Prerequisites
- [Node.js](https://nodejs.org/) v20+
- [Rust](https://rustup.rs/) 1.80+ (optional; precompiled Wasm binaries are included)

### Install Dependencies
```bash
npm install
```

### Run Production Build & Quality Gates
Execute the complete 12-gate integration verification suite:
```bash
npm run build:v2
```

### Launch Development Server
```bash
npm run dev
```

### Run Playwright Four-Pass UI Review
```bash
# 1. Start preview server
npx vite preview --host 127.0.0.1 --port 5276

# 2. Run test suite
npm run test:ui-four-passes
```

---

## Engineering Rules of Engagement (`AGENTS.md`)

- **Aquarium Identity:** Preserve the aquarium identity, motion controls, Navy/Dark/Light theme parity, and bottom-center canvas toolbar.
- **Non-Destructive Inspection:** Selection, inspection, tab switching, and tab closing must remain free of document mutations. Closing a tab must never trash or delete its underlying item.
- **Narrow-Pane Usability:** All controls must remain reachable at narrow pane widths (down to 176px). Prefer bounded overflow or explicit pane switching to shrinking labels or silently hiding actions.
- **Strict A11y Standards:** Do not hide interactive controls with `aria-hidden` or disable accessibility rules to obtain a pass.
- **Continuous Saving:** Preserve P1.5 continuous and interval saving options; never replace canonical storage or require manual Save during UI work.

---

## License

Copyright © 2026 Art Equation Studio. All rights reserved.
