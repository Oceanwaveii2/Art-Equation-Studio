# Art Equation Studio
## Document + Universal Preview + DX12 Upgrade Dossier
**Research revision:** 2026-09-09  
**Target application:** Art Equation Studio, Rust desktop application in transition from Tauri/WebView2 toward a DX12-native rendering architecture.

> This dossier replaces the page-model assumption in the 2026-09-02 document scope. It keeps the useful UI and export research from that package, but changes the core to a continuous authored document with derived pagination. It also expands the scope to placed images, video and 3D objects inside documents, and broad document previews on the Canvas.

## Executive decision
Art Equation should not become three separate editors glued together. The Document, Canvas, media viewer and future DX12 renderer should share one project/asset core, one drag/drop importer and one preview-provider system.

The architecture should be built around five independent layers:

1. **Project + asset core:** originals, managed assets, dedupe, metadata, preview jobs and persistent IDs.
2. **Document core:** authored blocks, styles, sections, manual breaks, inline/anchored media and undoable editing operations.
3. **Layout core:** text shaping, line layout, pagination, wrapping, page styles and hit-test geometry.
4. **Preview/media providers:** PDF, text, Office/ODF conversion, image, video and 3D preview services.
5. **Rendering adapters:** current WebView implementation and future DX12 implementation consume the same state and display-list contracts.

The renderer is the skin. The document model is the skeleton. Do not weld the skeleton to WebView DOM or DX12 command lists.

## 1. Current application audit
The supplied September 9 portable build identifies itself as the P14 media-preview release with the Generation 1 canvas-layout hotfix. It already keeps imported image, video, document and font originals under `projects/<project-id>/assets/originals/`, retains project navigation state, and uses Tauri/WebView2 today.

Targeted strings from the current executable show existing frontend modules named `RichDocument`, `PdfPreview`, `PsdPreview`, `FormatImagePreview`, `VideoReview`, `CanvasPool`, and `CanvasRenderer`. The binary also exposes commands or strings for `start_image_pyramid`, `assets/previews`, `assets/thumbnails`, `import_model_bundle`, and an `Invalid GLTF JSON` path. This means the upgrade should begin with an audit and extension of existing preview/media infrastructure rather than creating a competing subsystem.

### Existing assets to preserve
- Portable/local-first workspace model.
- `assets/originals/` ownership of source files.
- Preview and thumbnail directories.
- Current image pyramid work.
- Existing image, PSD, PDF and video preview modules until their replacement is proven.
- Existing model-bundle/glTF path.
- Project-level Canvas, Board, Document and Split navigation.
- Full-size media preview and current selection/camera retention behavior.

### Immediate document gap
The current UI visually resembles a page editor, but practical pagination is not complete. The goal is not merely a `+ page` button. It is a real layout engine that can derive page 2, page 3 and page 300 from one editable story while retaining explicit page/section intent.

## 2. Product model: Pages and Flow are views of one document
`Pages` and `Flow` must never persist independent copies of the text.

**Pages view** is the physical-layout view. It renders page size, margins, headers, footers, page numbers, page backgrounds, columns and gaps between sheets. It is the authoritative print-preview editing view.

**Flow view** is the continuous writing view. It removes physical sheet boundaries from the viewport while retaining explicit break markers and section metadata. It is better for long-form writing and wide content. Page-specific elements can be hidden or represented as markers while in Flow.

A page created because text overflowed is **derived**. A page created because the user inserted a page break, blank page or section boundary is **authored intent**.

### Required authored break types
- `PageBreak`
- `BlankPage`
- `SectionBreakContinuous`
- `SectionBreakNextPage`
- later: `SectionBreakOddPage`, `SectionBreakEvenPage`
- later: `FixedPageInsert` for a deliberately designed full-page plate

### Why not persist `document.pages[]` as the content model
Physical page ownership makes ordinary edits mutate the structure of the document. A font change, margin change or image resize could require moving content between page objects. That makes undo, selection, tables, copy/paste and serialization far more fragile. `PageSlice[]` may exist as a runtime cache, but it is a product of layout, not the authored source.

## 3. Proposed persistent document schema
Use stable node IDs. Persist semantic content and user intent. Treat geometry that can be recomputed as cache.

```rust
struct Document {
    id: DocumentId,
    schema_version: u32,
    story: Vec<Block>,
    styles: StyleSheet,
    sections: Vec<SectionSpec>,
    page_styles: Vec<PageStyle>,
    metadata: DocumentMetadata,
}

enum Block {
    Paragraph(ParagraphBlock),
    Heading(HeadingBlock),
    List(ListBlock),
    Table(TableBlock),
    Image(MediaBlock),
    Video(MediaBlock),
    Model3D(MediaBlock),
    PdfEmbed(PdfEmbedBlock),
    Attachment(AttachmentBlock),
    PageBreak(BreakBlock),
    BlankPage(BlankPageBlock),
    SectionBreak(SectionBreakBlock),
}

struct MediaBlock {
    id: NodeId,
    asset_id: AssetId,
    placement: MediaPlacement,
    intrinsic_size: Size2D,
    crop: Option<CropRect>,
    caption: Option<RichText>,
    alt_text: Option<String>,
    poster: Option<PreviewRef>,
}
```

### Stable IDs matter
Page thumbnails, comments, selections, object inspectors, undo transactions and asset references should point to stable block/node IDs rather than array offsets. Array offsets are mayflies. Stable IDs survive edits.

### Text buffers
Keep the public document schema independent of the backing text-buffer implementation. For large editing buffers, benchmark `Ropey` and `crop`. A pragmatic design is a block tree whose paragraphs own a `TextBuffer` abstraction rather than putting the entire document in one giant rope.

### Unicode index mapping is mandatory
Rust strings are UTF-8 while Windows text APIs commonly expose UTF-16 positions. The editor also needs grapheme and glyph-cluster boundaries. Create an explicit `TextIndexMap` per edited paragraph that maps:
- UTF-8 byte offset
- Unicode scalar index
- UTF-16 code-unit index
- grapheme/word boundaries
- shaping cluster / caret positions

Do not scatter ad-hoc `encode_utf16().count()` conversions across the editor. That breeds caret bugs in emoji, CJK and combining text.

## 4. Pagination engine
Pagination is a constraint-solving pass over a continuous sequence of blocks and lines.

### Layout inputs
- page width/height
- margins and bleed-safe region where relevant
- columns and gutters
- paragraph style
- line height, font metrics and baseline
- language/script shaping
- keep-with-next / keep-together
- widow/orphan controls
- explicit breaks
- table row split policy
- media placement and wrap geometry
- headers/footers and page-style geometry

### Layout outputs
```rust
struct PaginationResult {
    revision: Revision,
    pages: Vec<PageSlice>,
    anchors: HitTestMap,
    overflow: Vec<OverflowDiagnostic>,
}

struct PageSlice {
    page_index: u32,
    section_id: SectionId,
    source_start: DocPosition,
    source_end: DocPosition,
    fragments: Vec<FragmentRef>,
    page_style_id: PageStyleId,
}
```

### Incremental reflow
Do not repaginate a 400-page document from page 1 on every keystroke.

1. Record pagination checkpoints at safe boundaries, normally page starts and section starts.
2. When content changes, invalidate from the nearest earlier checkpoint that can influence the edit.
3. Re-shape/re-measure only dirty paragraphs and affected media blocks.
4. Reflow forward.
5. Stop once new page boundaries and downstream measurements converge with the cached layout.
6. Keep caret/visible-page work synchronous; let distant pages settle in background slices.
7. Render only visible pages plus overscan.

### Media stability rule
The moment an asset is imported, reserve an intrinsic layout box from metadata. Do not wait for a high-resolution thumbnail, video frame or 3D render before deciding its page size. Late preview availability must not cause the document to jump around.

### Page panel behavior
The Pages panel should show computed pages and explicit page metadata together.
- thumbnail
- page number
- current selection
- section badge
- parent/page-style badge
- manual-break indicator
- overflow/error badge

`Add Page After` inserts authored page intent. It does not create a second rich-text editor.

## 5. Page styles and InDesign-like parent behavior
After basic pagination is solid, add reusable Page Styles inspired by InDesign Parent Pages.

A `PageStyle` can define:
- dimensions and orientation
- margins / columns / gutters
- header/footer frames
- automatic page number
- background and guide geometry
- repeating logos / labels
- first-page variation
- facing-page left/right variation

Keep page styles separate from story content. Applying a style changes layout and repeating decoration, not ownership of the body text.

### Override strategy
Begin simpler than InDesign. Phase 1 supports page-style assignment by section. Later phases can allow local overrides of selected parent elements. Avoid full parent-on-parent inheritance until pagination is stable.

## 6. Native text technology for the DX12 generation
### Production baseline: DirectWrite
For a Windows-first DX12 application, DirectWrite is the safest baseline for text shaping and layout. It supplies font fallback, international shaping, line metrics, hit testing, typography and inline-object support. It is independent of the final rasterization path.

Use DirectWrite for:
- shaping and script analysis
- fallback and OpenType features
- caret hit testing
- line metrics
- selection geometry
- inline objects while the layout engine is maturing

### D3D11On12 as migration bridge
D3D11On12 exists specifically so D3D11-era components such as Direct2D text/UI can interoperate with a D3D12 application during incremental migration. That makes it a practical bridge while the native DX12 renderer is being built.

Do not confuse bridge with destination. Once the DX12 text path is mature, measure whether the bridge remains worth its synchronization cost.

### Rust-native research path: Parley
Parley is the most interesting Rust-native text-layout project in this research pass. Its stack combines Fontique, HarfRust, Skrifa and ICU4X, and recent releases include richer inline/out-of-flow box behavior useful for text wrapping. An August 2026 rich-editor pull request explores style spans, IME composition, selection and accessibility. Treat that PR as research, not a production dependency until it lands and is released.

### Vello
Vello is compelling for GPU-compute 2D, but its own project still labels the renderer alpha and calls out unfinished blur/filter work, artifacts, GPU-memory strategy and glyph caching. It belongs in a benchmark branch, not underneath the entire document system today.

### wgpu versus native D3D12
`wgpu` 30.x treats DX12 as a first-class Windows backend. It is a credible abstraction if Art Equation still wants backend portability. If the current DX12 branch is already built directly with `windows-rs`/D3D12, do not churn the renderer simply to adopt wgpu. Put a narrow rendering interface above whichever backend you choose.

The document core should produce a renderer-neutral display list:
- glyph runs / text decorations
- vector paths / rules
- image quads
- clip regions
- selection/caret geometry
- video surface quads
- 3D viewport rectangles
- debug overlays

## 7. Text input, IME and accessibility
A custom native editor must handle composition-based input correctly. East Asian IME support cannot be bolted on after caret handling is finished.

### Windows input
Use Text Services Framework or the appropriate Windows Core Text path for the native editor. Composition ranges must be first-class transient editor state, with visual attributes and correct commit/cancel semantics.

### Accessibility
A custom DX12 control has no automatic accessibility tree. Expose document text, headings, controls, selections and actions through UI Automation. AccessKit is worth evaluating as a Rust-side tree abstraction, but the final Windows bridge still needs validation against Narrator and UIA clients.

### CJK/RTL acceptance from day one
Tests must include:
- Simplified and Traditional Chinese
- Japanese punctuation and line starts/ends
- Korean
- Arabic RTL and mixed Latin/Arabic
- emoji sequences and variation selectors
- combining marks
- bidirectional selection

The user-facing target should not be a Latin-only editor wearing a Unicode hat.

## 8. Images inside documents
Images already belong to the project asset system. Placing an image in a document should create a lightweight block that references the existing asset ID.

### Placement modes
1. **Inline:** behaves as a large glyph-like object in a paragraph.
2. **Block:** occupies its own flow block, easiest and most reliable first implementation.
3. **Anchored:** attached to a source paragraph but positioned outside the line flow.
4. **Floating/wrapped:** text wraps around an exclusion rectangle or contour. Implement rectangular wrapping first; contour wrapping later.
5. **Full-bleed/full-page:** later page-design feature.

### Image inspector
- fit: contain / cover / actual pixels / custom
- crop and focal point
- width / height / lock ratio
- align
- wrap mode and distance
- anchor
- caption
- alt text
- link
- send/open in Canvas

### Existing image pipeline reuse
The portable build already carries libvips and image-pyramid machinery. Reuse those derivatives for document thumbnails and high-zoom display. Keep color management centralized rather than creating a separate document-only image decoder.

## 9. Video inside documents
Video should be interactive while editing but geometrically stable as a document object.

### Editor behavior
- poster frame generated at import or chosen by user
- play/pause and scrub on selection or activation
- muted-by-default option for document workspaces
- object sizing independent of playback resolution
- `contain`/`cover` fit
- caption and accessible description
- open in full media viewer

### DX12 video path
The long-term renderer can use Direct3D 12 Video APIs where appropriate. During migration, preserving the current video pipeline and sharing compatible surfaces is lower risk than rewriting decoding just because the canvas renderer changed.

### Print/PDF behavior
Do not attempt to make interactive rich-media PDF the default. Export a deterministic poster frame plus caption/link metadata. HTML or future interactive package export can preserve playback.

## 10. OBJ / 3D models inside documents
OBJ support is useful, but treat OBJ as an **input adapter**, not the preferred internal scene format.

### Import pipeline
- parse OBJ with a maintained Rust loader such as `tobj`
- resolve MTL and referenced texture paths safely
- copy original OBJ, MTL and textures into the managed asset bundle
- normalize mesh/material data into the same internal scene representation used by glTF/GLB
- preserve original source for round-trip/open-with workflows

The current executable already contains glTF-related code, so first identify its internal model representation before adding another scene graph.

### Document 3D block
- poster/thumbnail immediately available
- click to activate orbit viewport
- orbit / pan / zoom
- named front / 3/4 / side / top camera presets
- basic environment and key light
- wireframe toggle
- material diagnostic view
- reset camera
- `Open in 3D viewer`

### PDF behavior
Export the selected camera as a high-resolution static render. Interactive 3D PDF is not the baseline goal.

### Safety budgets
A dropped model can be hostile even without executable code. Enforce budgets for file count, texture dimensions, decompressed bytes, triangle count, material count and dependency traversal. Offer an explicit override for trusted large assets instead of silently freezing the app.

## 11. PDF support on Canvas and in documents
The current binary already has a `PdfPreview` module, so the first step is to document what it actually uses and what it cannot do.

### Recommended provider interface
```rust
trait PdfProvider {
    fn metadata(&self, asset: AssetId) -> Result<PdfMetadata>;
    fn render_page(&self, page: u32, req: RenderRequest) -> Job<PreviewImage>;
    fn extract_text(&self, page: u32) -> Result<Option<TextLayer>>;
    fn search(&self, query: &str) -> Result<Vec<PdfMatch>>;
}
```

### Native Windows fast path
`Windows.Data.Pdf` can render a page asynchronously to an image stream. It is an excellent low-dependency baseline for page previews in a Windows-only application.

### Richer provider option
`pdfium-render` wraps Chromium's PDFium and adds page rendering plus text/image extraction and other PDF operations. This is the stronger path if Art Equation needs selectable PDF text, search, links and richer introspection.

### libvips note
libvips 8.18 has PDF loading improvements, but PDF support depends on how the Windows build was compiled and which loader dependencies are present. The current portable package must be queried with `vips -l`/`vips pdfload` rather than assuming PDF is enabled because libvips itself supports it.

### Canvas PDF UX
- default card: cover page + filename + page count
- double-click: full PDF viewer
- optional thumbnail strip
- page jump / search if provider supplies text
- drag a page thumbnail out as a page-preview object
- `Explode pages` creates separate managed preview objects, not duplicate original PDF files
- `Place pages in document…` supports single page, range or all pages

## 12. TXT, Markdown, JSON, CSV and source-text previews
These should be native, fast and boring in the best possible way.

### TXT
- encoding detection with explicit override
- virtualized line rendering for huge files
- monospace or document-style preview choice
- line numbers optional
- search
- never mutate source on preview

### Markdown
- safe rendered preview plus source tab
- no arbitrary script execution
- local image references resolved through a controlled asset resolver

### JSON
- syntax highlighting, collapsible tree and raw view
- size threshold switches to streamed/raw mode

### CSV/TSV
- virtualized table preview
- delimiter and encoding detection
- row/column caps in interactive preview

## 13. DOC, DOCX, ODT, RTF, PPT/PPTX, XLS/XLSX and ODF previews
Do not try to write a second Microsoft Office renderer inside Art Equation.

### Three-layer strategy
**Layer 1: Windows Shell thumbnail fallback.** `IShellItemImageFactory` can obtain a thumbnail or icon using installed handlers. Run extraction off the UI thread.

**Layer 2: optional fidelity provider.** LibreOffice headless conversion can convert many office/ODF formats to PDF. Run conversion in a constrained worker process, cache the PDF derivative, then hand it to the same PDF preview pipeline.

**Layer 3: semantic import.** If a user explicitly chooses `Import DOCX as editable document`, use a semantic parser such as `docx-rs` and accept that complex Word layout is not guaranteed to round-trip. Editable import is a different promise from visual preview.

This separation is important. Preview fidelity and semantic editability are different jobs.

## 14. Universal preview provider API
Every Canvas preview object should have the same lifecycle regardless of source format.

```rust
trait PreviewProvider: Send + Sync {
    fn can_open(&self, sniff: &SniffedFile) -> Confidence;
    fn inspect(&self, source: &ManagedAsset) -> Result<PreviewMetadata>;
    fn make_thumbnail(&self, source: &ManagedAsset, req: ThumbnailRequest) -> PreviewJob;
    fn open_preview(&self, source: &ManagedAsset, req: PreviewRequest) -> PreviewSession;
}
```

### Provider priority
1. first-party native provider
2. configured conversion provider
3. Windows Shell thumbnail
4. icon + metadata fallback

### Never key only on extension
Use magic bytes/container inspection when possible. If extension and detected content disagree, mark the asset and avoid handing it to the wrong parser.

## 15. Preview worker security model
Document previewing is a file parser farm. Treat it that way.

### Worker-process requirements
- no network by default
- read-only source handle or copied input
- dedicated temp directory
- timeout
- memory cap / job object
- output-size cap
- process kill on cancel
- no macro execution
- no HTML script execution
- archive traversal protection
- zip-bomb / decompression limits
- logs identify provider and failure without leaking unrelated files

Windows Shell preview handlers themselves use an out-of-process and low-integrity model by default, which is a useful security precedent.

## 16. Drag and drop, current WebView and future native DX12
Build one semantic `DropRouter` and give it two platform adapters.

### Current generation
Tauri 2 can already emit file drop events with paths and positions. Use that rather than HTML5 drag/drop hacks where possible.

### Native generation
Implement OLE `IDropTarget` on the native window. It supplies enter/over/drop/leave and lets the app communicate drop effects and feedback. Normalize those events into the exact same `DropIntent` sent by the current Tauri adapter.

```rust
enum DropTarget {
    DocumentInsertion(DocPosition),
    DocumentPage(PageIndex),
    CanvasWorld(WorldPoint),
    ProjectAssetLibrary,
}

struct DropIntent {
    sources: Vec<DropSource>,
    target: DropTarget,
    modifiers: ModifierState,
    suggested_action: DropAction,
}
```

### Drop affordance UI
While hovering, draw explicit insertion affordances:
- thin caret for text insertion
- full-width bar for block placement
- page highlight for page-level placement
- Canvas ghost card at world position
- unsupported icon before the user releases the mouse

If a file has several sensible interpretations, show a compact post-drop action chip: `Place`, `Attach`, `Import only`, `Place selected PDF pages`.

## 17. Canvas preview object model
The Canvas should not contain format-specific spaghetti. Use one generic preview object with typed capabilities.

```rust
struct FilePreviewObject {
    object_id: CanvasObjectId,
    asset_id: AssetId,
    provider_id: PreviewProviderId,
    view_state: PreviewViewState,
    transform: CanvasTransform,
}
```

Capabilities can advertise:
- pages
- text search
- playback
- 3D camera
- frame selection
- page extraction
- open-with
- live reload

The Canvas renderer then asks the provider for the current visual surface rather than understanding DOCX/PDF/OBJ itself.

## 18. DX12 render architecture
### Renderer boundary
The document and Canvas should submit immutable render packets/display lists to the GPU layer. The GPU layer must not own semantic document state.

Recommended high-level passes:
1. background/grid
2. Canvas/page surfaces
3. raster/vector media
4. glyphs/text decorations
5. 3D/video embedded surfaces
6. selections/guides/caret
7. drag/drop and hover overlays
8. diagnostics

### Resource strategy
- descriptor pools separated by persistent and per-frame resources
- LRU GPU texture cache
- staging/upload queue independent of UI thread
- image pyramid tiles requested by visible zoom/region
- video textures use hardware decode path where available
- 3D thumbnails and document posters cached as normal preview derivatives

### Device loss
The project/document state must survive DXGI device loss. GPU caches are disposable and rebuilt from managed assets/derivatives.

## 19. Full UI specification
See `diagrams/01_full_application_ui_wireframe.*` and the supplied/generated screenshots in `references/`.

### A. Application/project header
Keep the current top-level `Document / Split / Canvas` modes. Add a renderer/diagnostic indicator only in a developer status mode, not as permanent chrome for normal users.

### B. Main project navigator
Keep Projects and Workspace. It owns document/board identity, not page navigation.

### C. Document navigator
Add a second collapsible rail that changes according to `Pages`/`Flow`:
- Pages: thumbnails, section badges, page styles, insert/reorder controls
- Flow: headings/outline, section boundaries, document landmarks

This prevents page navigation from bloating the global project tree.

### D. Document toolbar
Keep common text formatting in the horizontal toolbar. Add:
- `Insert`
- `Media`
- `Table`
- `Break`
- `View`

Do not put every object property in the top toolbar. Selection-specific properties belong in the inspector.

### E. Inspector
Tabs:
- **Document**: page/section/typography defaults
- **Object**: geometry, alignment, wrapping
- **Media**: crop, poster, camera, playback, page range
- **Accessibility**: alt text, reading order, decorative flag, link description

### F. Project shelf
The bottom shelf remains a high-value bridge between Canvas and Document. An asset dragged from the shelf into a document should reuse the same `asset_id` and never re-import the file.

### G. Status bar
Add page/word/save state and background-job feedback. Heavy preview conversions should appear here rather than spawning modal dialogs.

## 20. Media UX in Pages mode
### Image drop
Drop between paragraphs → block image. Drop into a paragraph line → inline image if the cursor target is precise. Drop onto page margin → default to anchored object only after anchored positioning is implemented.

### Video drop
Insert a poster-sized block with a play overlay. Playback activates on click, not merely on hover. The inspector controls poster frame, loop, mute and fit.

### OBJ/glTF drop
Insert a deterministic poster immediately. The full 3D viewport loads asynchronously. If dependencies are missing, show a repair card listing missing MTL/textures without corrupting pagination.

### PDF drop
Prompt with a small action chooser when intent is ambiguous:
- Place first page
- Choose page range
- Attach file
- Open in Canvas

## 21. Media UX in Flow mode
Flow view should preserve block widths and media order but can relax physical page constraints. A very wide table or image may use a wider content lane in Flow while Pages remains the print truth. This mirrors the useful difference between paginated and pageless editing without creating two documents.

## 22. Tables
Tables are a pagination stress test. Build them after paragraphs/media but before calling the page engine finished.

Minimum table rules:
- repeat header row option
- keep row together when it fits
- split across pages when needed
- cell content reflows normally
- detect a row taller than the page content box and report a diagnostic
- no nested-table pagination in first release unless already required

Tiptap's paginated stack requiring table-specific handling is a useful warning: tables are not ordinary paragraphs wearing grid lines.

## 23. Headers, footers and page numbers
Treat headers/footers as page-style content with fields such as:
- current page
- total pages
- section title
- document title
- date/export metadata

The body story should not own them. In Flow view, show them as optional section/page-style indicators, not repeated interruptions.

## 24. Footnotes, endnotes and comments
These are later-phase features because they complicate pagination. Reserve schema space now:
- inline reference marker points to stable note ID
- footnote body stored semantically
- page layout engine owns footnote allocation
- comments are annotations, not text runs

## 25. Undo/redo and layout
Only authored commands enter undo history. Pagination is derived and should never create its own user-visible undo steps.

Examples of undoable commands:
- insert/delete text
- apply style
- insert media block
- resize/crop placed media
- insert page/section break
- apply page style

Examples of non-undoable derived work:
- recompute line breaks
- regenerate page thumbnails
- rebuild GPU texture
- regenerate PDF preview

## 26. Save format and migration
Keep a versioned, inspectable document schema. JSON is acceptable for the persistent semantic model if the existing workspace already uses JSON. Large derived caches can use separate binary files.

Never persist:
- GPU resource handles
- WebView DOM IDs
- DirectWrite COM objects
- page raster bitmaps as source of truth
- automatically computed page ownership

Persist stable asset IDs and regenerate preview paths if cache is lost.

## 27. Export strategy
### PDF
Keep the export layer independent of the live DX12 display. The live renderer can provide media snapshots and vector geometry, but export should traverse semantic/layout output.

Typst is still attractive as a Rust-friendly PDF backend because its current export supports PDF versions 1.4 through 2.0, multiple PDF/A profiles and PDF/UA-1, with tagged PDF by default. It is not a complete answer for every prepress/PDF-X workflow, so do not promise PDF/X until a dedicated path is validated.

### WebView-era bridge
Paged.js can remain a bridge for HTML/CSS print preview while WebView is still part of the product. Do not make it the permanent native pagination engine.

### Dynamic media
- image → normal placed image/vector
- video → poster frame + metadata/link
- 3D → selected-camera snapshot + metadata/link
- embedded PDF → selected pages rendered/embedded in export

### Future HTML package
An HTML export could preserve video and glTF interaction and is the natural place for dynamic media. Keep it separate from print PDF.

## 28. Performance targets
Treat these as engineering budgets, not marketing promises.

### Interaction
- caret/typing path should not wait for distant-page preview work
- target 60 Hz scrolling/zooming on normal documents
- no synchronous Office conversion, PDF thumbnail extraction or model parsing on UI thread
- cached page thumbnails should feel instant

### Scale tests
Test at least:
- 500+ page text-heavy document
- 100+ placed high-resolution images
- long CJK document
- large tables
- 4K video blocks
- 1000-page PDF preview
- very large TXT/JSON
- OBJ with many textures and a deliberately oversized mesh

## 29. Failure-state design
Every preview object needs a useful failure state:
- Loading
- Converting
- Missing dependency
- Unsupported format
- Password-protected
- Too large / requires confirmation
- Corrupt file
- Provider crashed
- Preview unavailable, original retained

A preview failure must never delete the imported original.

## 30. Recommended Rust crate/module split
```text
crates/
  project-core/          workspace, IDs, persistence, undo commands
  asset-core/            originals, hashing, dedupe, metadata, dependencies
  preview-core/          provider traits, jobs, cache keys, capabilities
  preview-win/           Windows.Data.Pdf, Shell thumbnail, worker host
  preview-office/        optional LibreOffice provider
  document-core/         semantic block tree, styles, sections
  document-text/         text buffers, index maps, selection/edit ops
  document-layout/       shaping adapters, wrapping, pagination
  document-render/       display-list construction + hit-test map
  media-video/           playback surface/session abstraction
  model-import/          glTF + OBJ adapters, normalized scene
  export-core/           print snapshot, PDF/HTML pipelines
  renderer-dx12/         GPU device, resources, render passes
  ui-bridge/             current WebView and future native UI adapters
```

The names are suggestions. The important part is dependency direction: `document-core` must not import `renderer-dx12`.

## 31. Technology decision matrix
| Area | Recommended baseline | Secondary / research | Avoid as core |
|---|---|---|---|
| Windows text layout | DirectWrite | Parley benchmark | DOM-only layout model |
| DX12 migration | existing native DX12 branch + D3D11On12 bridge where needed | wgpu if renderer is not yet committed | rewriting document model during GPU migration |
| GPU 2D vector | current renderer / Direct2D bridge | Vello benchmark | depending on Vello alpha for critical editor behavior |
| PDF preview | audit current; Windows.Data.Pdf fast path | PDFium for richer features | embedding browser PDF viewer as permanent native architecture |
| Office preview | LibreOffice→PDF optional provider | Shell thumbnail fallback | writing full Office renderer |
| DOCX editing import | docx-rs semantic import | custom OOXML fixes | pretending semantic import equals Word-perfect rendering |
| images | existing libvips/pyramid | specialized codec providers | separate document-only image cache |
| video | preserve current playback, evolve to DX12 surfaces | direct D3D12 video path | tying pagination to decoder state |
| 3D | existing glTF scene path + OBJ adapter | richer importers later | making OBJ the internal scene format |
| drag/drop | shared DropRouter | Tauri adapter + OLE adapter | separate Canvas and Document importers |
| PDF export | Typst-backed path worth prototyping | Paged.js bridge while WebView exists | using screen screenshots as primary PDF export |

## 32. Build phases
### Phase 0 — Current-code audit and contracts
**Goal:** stop duplicate engineering.
- locate current `RichDocument`, `PdfPreview`, `PsdPreview`, `VideoReview`, Canvas preview and model bundle source
- identify current document persistence schema
- identify actual PDF provider
- enumerate libvips loaders in the shipped Windows bundle
- identify glTF internal scene model
- define `AssetId`, `PreviewProvider`, `DropRouter`, `DocumentCore`, `LayoutBackend`, `RenderBackend` interfaces

**Exit:** architecture document maps every existing implementation to keep/replace/wrap.

### Phase 1 — Continuous document core + real pagination
- stable block IDs
- paragraphs/headings/basic lists
- page and section settings
- derived `PageSlice[]`
- automatic overflow pages
- manual PageBreak / BlankPage
- Pages thumbnails
- Pages/Flow same-content synchronization
- incremental reflow and viewport virtualization

**Exit:** 100-page synthetic document edits without content migration between persisted page objects.

### Phase 2 — Native-quality text editing
- DirectWrite layout adapter
- hit testing and selection
- IME composition path
- Unicode index map
- clipboard rich/plain text
- accessibility tree skeleton
- CJK/RTL tests

**Exit:** stable caret/selection/IME behavior in Pages and Flow.

### Phase 3 — Images in documents
- drag/import or drag existing asset
- block placement first
- resize/crop/fit/caption/alt text
- inline placement
- anchored rectangular wrap
- document thumbnails use existing image derivatives

**Exit:** images survive save/reload, pagination changes and export snapshots.

### Phase 4 — Video + 3D placed blocks
- video poster, playback and stable layout box
- model poster + interactive viewport
- OBJ adapter and dependency bundle
- print snapshot behavior

**Exit:** no video/model activity can stall text input or invalidate page geometry unexpectedly.

### Phase 5 — Universal Canvas document previews
- native text family previews
- native PDF page stack
- optional PDFium search/text
- Shell thumbnail fallback
- LibreOffice worker provider
- unified failure states
- page explode/place actions

**Exit:** DOCX/PPTX/XLSX/PDF/TXT/MD/CSV and unsupported files all produce a deterministic Canvas object or a useful failure card.

### Phase 6 — DX12 document renderer cutover
- renderer-neutral display list proven against WebView/current view
- DX12 page rendering
- glyph/image caches
- video/3D surfaces
- device-loss recovery
- old WebView document renderer feature-flagged for regression comparison

**Exit:** same saved document opens identically through old and new render adapters within accepted visual tolerances.

### Phase 7 — Page styles, tables and export hardening
- parent/page styles
- table pagination
- section headers/footers
- tagged PDF/PDF-A/UA export prototype
- print snapshots for dynamic media

### Phase 8 — Advanced layout
- footnotes/endnotes
- contour wrapping
- facing pages/spreads
- odd/even section starts
- fixed design pages
- richer Word import/export

## 33. Acceptance test matrix
### Pagination invariants
- changing page size may change page count but never textual order
- deleting a computed page is impossible; deleting an explicit blank page is undoable
- Pages and Flow resolve the same document positions
- undoing text edits restores semantic content, then layout recomputes
- reloading a document does not require persisted automatic page boundaries

### Media invariants
- deleting a placed media block does not delete the managed source asset unless explicitly requested elsewhere
- same asset can be placed on multiple documents/boards without byte duplication
- missing preview cache regenerates from original
- missing OBJ texture shows repair UI while retaining mesh source

### Drag/drop invariants
- external file drop imports once then places
- internal asset drag only places
- unsupported type never crashes importer
- extension spoof does not route to wrong parser without detection

### DX12 invariants
- device loss does not corrupt workspace
- GPU cache can be deleted and reconstructed
- document save contains no GPU/WebView handles

## 34. Non-goals for the first upgrade
- Word-perfect DOCX editing round trip
- a full InDesign clone
- PDF/X prepress suite
- interactive 3D PDF
- arbitrary browser script execution inside document previews
- every CAD/3D format on day one
- replacing the entire existing asset system
- making Vello or any still-alpha component a critical dependency without benchmark and fallback

## 35. The engineering order I would use
**First:** fix the semantic document and pagination model.  
**Second:** make media placement reference the existing asset system.  
**Third:** unify all file previewing behind providers.  
**Fourth:** move the renderer to DX12 without moving the data model.  
**Fifth:** add sophisticated page design features.

That ordering prevents the DX12 transition from becoming a giant rewrite where every subsystem changes at once.

## 36. Deliverables in this package
- `README_START_HERE.html` — magazine-style offline dossier
- `ART_EQUATION_DX12_DOCUMENT_SCOPE.md` — source text
- `specs/format_support_matrix.csv`
- `specs/document_schema_example.json`
- `specs/acceptance_tests.md`
- `specs/module_plan.md`
- `prompts/CODEX_IMPLEMENTATION_PROMPT.md`
- eight SVG + PNG architecture/UI diagrams
- current screenshot, proposed UI concept and prior UI reference images
- current portable binary audit extract
- prior September 2 scope for comparison
- web research manifest with checked URLs
