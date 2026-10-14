# Agent Argon — Automated Git Commit & Push Script for Art Equation Studio 2.5
# Target Repository: https://github.com/Oceanwaveii2/Art-Equation-Studio.git (branch: main)
$ErrorActionPreference = "Stop"

Write-Host "=== Art Equation Studio 2.5: Agent Argon Quality & Size Gate Check ===" -ForegroundColor Cyan

# Verify no single tracked/untracked file exceeds 50 MB (Argon Directive Section 7)
$oversized = Get-ChildItem -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\(\.git|node_modules|target|dist|output|artifacts)\\' -and $_.Length -gt 50MB
}
if ($oversized) {
    Write-Error "Quality Gate Failed: File(s) exceed 50 MB limit: $($oversized.FullName -join ', ')"
    exit 1
}

git status -s

git add `
  src/document/paginationEngine.ts `
  src/document/RichDocument.tsx `
  src/document/ProcessDocumentView.tsx `
  src/document/processDocument.css `
  src/media/pbrClassifier.ts `
  src/media/dccBridge.ts `
  src/board/ModelViewer.tsx `
  src/board/ModelViewer.css `
  src/App.css `
  src/project-b/p0-surface/atlasPlan.ts `
  src/project-b/p0-surface/retainedTextShape.ts `
  src/project-b/p0-surface/cpu.worker.ts `
  engine/vello-surface/rust/src/cpu.rs `
  engine/vello-surface/rust/src/image_atlas.rs `
  engine/vello-surface/rust/src/shaped_text.rs `
  engine/vello-surface/rust/src/image_resources.rs `
  engine/vello-surface/rust/src/prepared_display_list.rs `
  engine/vello-surface/rust/src/gpu_scene.rs `
  engine/vello-surface/build-receipt.json `
  src-tauri/bridge-architecture.json `
  scripts/workspace-organization.mjs `
  scripts/engine-provenance.mjs `
  scripts/build-bridge-architecture.mjs `
  docs/ARGON_INSTRUCTION_DIRECTIVE.md `
  ARGON_INSTRUCTION_DIRECTIVE.md

$commitMsg = @"
feat(argon): advance document pagination system, 3D DCC bridge, and Vello engine optimizations

- Work Stream 1 (Advance Document Architecture):
  - Add constraint-solving pagination engine (src/document/paginationEngine.ts) deriving PageSlice[], section checkpoints, widow/orphan splits, keep-with-next heading guards, and UTF-8/UTF-16/grapheme/CJK/RTL TextIndexMap without persisting document.pages[].
  - Add always-visible Document Page & Section Bar (.document-page-bar) in Pages mode with live Page Pills (P1..PN), Prev/Next navigation, and 1-click + Add Page, + Blank Page, and + Section actions.
  - Add BlankPage, SectionBreakContinuous, SectionBreakNextPage, VideoBlock, Model3DBlock, and PdfEmbedBlock Tiptap extensions with intrinsic layout box reservation.
  - Add Selected Node Quick Inspector Bar and ArrowLeft/ArrowRight branch navigation in ProcessDocumentView.tsx.

- Work Stream 3 (Vello Engine Optimizations):
  - Task 1: Expose surface_buffer_ptr, surface_buffer_len, and render_into_surface on B4CpuRenderer (cpu.rs & cpu.worker.ts) with persistent output_buffer reuse.
  - Task 2: Replace Shelf Next-Fit packing with MaxRects Best-Short-Side-Fit (BSSF) with 1px extruded gutters in image_atlas.rs and atlasPlan.ts.
  - Task 3: Add packed Float32Array binary glyph outline command stream (OP_MOVE_TO..OP_CLOSE) in shaped_text.rs and retainedTextShape.ts.
  - Task 4: Precompute resource_index on PreparedImage and pre-resolve atlas slots in gpu_scene.rs for O(1) inner-loop lookup with zero per-op String clones.

- Work Stream 4 (3D DCC Viewport & Kiosk Library 2.1 Bridge):
  - Upgrade src/board/ModelViewer.tsx with PBR Texture Channel Tracking Drawer, drag-and-drop auto-wiring, 4 diagnostic shading modes (PBR, Clay, Normals, UV Grid), 4 lighting presets, 4 camera presets, live polycount HUD, and 1-click PNG snapshot.
  - Add src/media/pbrClassifier.ts and src/media/dccBridge.ts for OpenPBR shader generation (Blender, Cinema 4D Redshift, Houdini MaterialX) and Command Stacks.
"@

git commit -m $commitMsg
Write-Host "Committed changes on branch $(git branch --show-current). Pushing to origin/main..." -ForegroundColor Green
git push origin main
