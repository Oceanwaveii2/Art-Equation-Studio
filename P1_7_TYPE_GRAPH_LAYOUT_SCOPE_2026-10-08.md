# P1.7 — Type, graph nodes, guides and reference layout

Date: 2026-10-08. Status: researched implementation scope; NOT IMPLEMENTED or accepted.

The owner's visual reference is `C:/Users/User/Downloads/Testing Art Equation/Real Time Board Replication Test 2/Screenshot 2026-10-06 152130.png`. The submitted current-board screenshot is `C:/Users/User/AppData/Local/Temp/codex-clipboard-ccfee3a3-69ac-48af-b71a-237545752439.png`. Preserve both uncropped. The owner's latest rejection supersedes earlier UI completion language: the interaction smoke results remain valid only for their measured scope; board fidelity, Type and replacement graph acceptance remain open.

## Reference gaps

The supplied images show a substantially different composition, not just a theme mismatch. The reference has a large unboxed Tier 1 Stories title and an arrow; contiguous black editorial backgrounds; a dominant central media image; a logo below it; long paragraph/list text; and a right-hand character sheet. The current board substitutes headed text cards and shortened explanatory captions, adds gaps and tall mostly empty containers, and changes image placement, scale and media presentation. Removing card borders alone will not fix this.

Do not invent the exact font from the screenshot, replace authored prose with summaries, or flatten editable content into one screenshot. Recover source text/assets where available; record missing originals and uncertain font matches as fidelity blockers. Use the screenshot to calibrate anchors, ratios, line breaks and colours. Black rectangular vector shapes may fill intentional background areas, be locked and sent behind content. They are ordinary editable artwork, not placeholder text or substitutes for missing content.

## Current-code findings

- `src/model/project.ts` already distinguishes `note` and `text`; keep that distinction and define explicit presentation/behaviour rather than renaming all objects.
- `src/board/BoardRichText.tsx` uses a real rich-text editor with font/colour/alignment extensions; reuse its editing capability after checking supported marks and serialization. Do not rewrite document editing unnecessarily.
- `src/typography/fontCatalog.ts` says native enumeration lists family names, not resolved faces. A listed font is not proof that the packaged app renders it.
- `src/board/freeformTextTool.ts` has heuristic measurement and a fallback that produces typography bars. No active production call site was found in the inspected source search. It is not established as the cause of the current screenshot or a finished glyph renderer.
- `src/board/snapManager.ts` contains a separate screen-space manager, but no active UI call to that manager was found. `App.tsx` uses its own `snapBounds` and drag-grid calculations. Consolidation must verify all move/resize/creation paths, not simply import the standalone helper.
- Current `snapBounds` returns early when `snapToGrid` is false, coupling object alignment to grid snapping. It scans raw node rectangles, excludes column members, and rounds dimensions/coordinates. The current drag path also quantizes grid position separately. These are concrete audit targets; current guides should not be described as a complete InDesign-equivalent system.

## Tool contracts

| Object/tool | Intended behaviour | Default visual treatment |
| --- | --- | --- |
| Note | Quick card-based notes, optional title/body, lists and simple formatting | Deliberate card surface; can join an ordinary Column |
| Type: point text | Click to place a free heading/caption; natural text bounds | Transparent, no card header, border or permanent editor chrome |
| Type: area text | Drag a text rectangle; width governs wrapping and optional height governs overflow | Transparent editable paragraph frame; selection-only outline |
| Ordinary Column | Organize cards with responsive/minimum-height choices | Familiar column, no computational ports |
| Replacement Node Column | Group/read/pass connected card data with typed inputs/outputs | Renderer-owned graph object, separate from ordinary Column |
| Frame | Group, constrain members, move the family and export a region | Existing bounded-container behaviour preserved |
| Drawing Canvas | Drawing surface with bounded drawing members | Existing separate drawing object preserved |

Type's first release must include resolved family/face, size, weight, italic, underline, colour, leading, tracking, paragraph alignment, paragraph spacing, indents, bullets/numbering, padding and character/paragraph styles. Resizing area text reflows text without silently scaling its font. Explicit Scale Type is a different operation. Point text preserves its intended point/heading behaviour. Report overset text visibly and never hide it behind a scrollable display card in reference mode. Selection and font inspection must not mutate content.

Subsequent typography work can add linked text frames, advanced OpenType controls, variable-font axes, hyphenation and text-on-path. These are explicit later tasks; complete InDesign parity is not a prerequisite for this reference. Establish one revisioned text-layout result for glyphs, baselines, bounds, hit testing and export. Evaluate the existing text engine first; compare a HarfBuzz-backed route only where shaping is missing. Preserve grapheme-aware caret/selection, IME, clipboard, undo and edit/render handoff. Real sharp glyph paint is mandatory; placeholder bars and silent font substitution cannot pass.

## Guides and snapping upgrade

1. Independent controls: document grid visibility, grid snapping, object Smart Guides, ruler-guide snapping and text baseline snapping. Hiding a guide is not a geometry edit. Provide named controls in Canvas settings and the floating Workspace/Grid section.
2. Persistent horizontal/vertical ruler guides with numeric positions, lock, show/hide, delete and board/Frame scope. Saved board guides must survive close/reopen; transient candidate guides must not enter autosave/history.
3. Smart alignment to left/right/top/bottom edges and centres; equal gaps; equal width/height during resize; Frame/content margins and actual text baselines. Align/distribute commands must support selection, key object and Frame as explicit targets.
4. Candidate geometry comes from the shared visual/content bounds, including image aspect ratio, crop policy, text layout and rotation. A locked background fill is excluded by default so a giant black rectangle does not magnetically capture everything. Do not use stale DOM bounds as the canonical layout.
5. One solver for move, resize and creation. Separate snap candidates from constraint application; check the final position against Frame boundaries and aspect-ratio constraints. Multi-selection moves use the family's envelope and one translation, preserving relative offsets.
6. Proposed defaults: 6 CSS-pixel acquire radius, 10 CSS-pixel release radius, configurable. Convert to world distance using zoom, independently of DPR. Keep the current target until release to avoid jitter. Choose the nearest eligible candidate with deterministic ties; explicit guides win equal-distance ties over objects, then grid. Emit only the winning guides and gap measurements.
7. Alt temporarily bypasses snapping; Shift constrains axes/aspect ratio according to the current tool. Numeric placement remains exact unless the user explicitly requests snapping. Do not round fractional coordinates on every pointer move. Explain conflicts instead of silently shifting artwork.
8. Query a spatial index near the moving selection; cache eligible anchors by geometry revision. Pan/zoom changes projection, not every object's semantic layout or graph output. Record candidate count, solver duration, chosen target, acquire/release and constraint rejection through the Codex bridge.

## Layout contract

Separate fixed authored layout from responsive/reflow layout. Fixed reference boards retain exact coordinates, dimensions, z-order and image fit; changing viewport aspect ratio changes the camera only. Responsive layouts have explicit tracks, gutters, padding, minimum sizes, aspect-ratio rules and an opt-in reflow command. Never overwrite imported authored positioning simply because a column was resized or a new panel opened.

Use reusable layout groups for the left image/text column, central media/logo/article and right character sheet. A group may have a background shape independently of text. Support align, distribute, exact gaps, guides and numeric measurements. Media bounds follow their source ratio unless explicit crop/fit is selected. Preserve each original asset reference and all editable text. Backgrounds, media, text, connectors and grouping are separate scene objects with explicit z-order and ownership.

## Replacement graph architecture

Recommended design: canonical graph data plus an independent evaluator and renderer-owned scene projection. A Node Column's visual layout is not its evaluator. Cards expose stable object references and typed values (text, image/asset reference, number, boolean, ordered records); ports and edges have stable IDs, direction, type, cardinality and revisions. Reads must not alter the source card. Evaluate explicit pure transformations first; defer side-effecting operations and feedback loops until separately designed.

Prototype `rete-engine` in headless mode against existing graph contracts, rather than adopting a DOM node-editor UI. Compare it with a small internal evaluator using the same fixtures before choosing a dependency. ConMan informs ports/connection management; OpenExec informs cached outputs and dependency invalidation; Hydra informs structured scene data and precise change notifications. These are architectural references, not a proposal to add USD/Hydra/OpenExec wholesale to this app.

Use affected-subgraph evaluation, typed validation, visible errors, stale-job cancellation and revisioned cache keys. Reject unsupported cycles explicitly. Camera movement must not recompute card data. Send source IDs/metadata, not full media bytes, through graph edges. Keep evaluator work off the interaction thread where its cost warrants a worker.

Render column bodies, backgrounds, ports, labels and connections through the existing wgpu/Vello GPU/CPU contract. Mount a DOM editor only for the focused editing session; preserve keyboard accessibility through a bounded accessible representation. Avoid permanent rich-card DOM capture for every graph object. Prove real text/card paint and renderer ownership; an empty accepted scene or a captured screenshot does not qualify. Port paint and connector stroke scale with the scene and remain small when zoomed out; invisible interaction targets can be larger without enlarging visible connectors. Preserve current animated connector semantics and test them enabled.

Migration runs on copies with a reversible mapping of old column/card/port/edge IDs to new records. Preserve text, assets, ordering, hierarchy, ownership, locks, visibility, undo and save semantics. Unsupported ports/edges become listed migration blockers; never silently delete them or downgrade graph columns to ordinary Columns.

## Ordered work and acceptance

| Milestone | Deliverable | Required evidence |
| --- | --- | --- |
| 1. Reference manifest | Full source/screenshot inventory, board anchors, image ratios, font/text inventory; replace earlier fidelity completion claim with OPEN | Original files hashed; uncertain/missing content listed; no uncropped reference replaced |
| 2. Shared guide/snap core | Single geometry/anchor solver; independent toggles; manual guides; equal spacing; keyboard bypass | Deterministic geometry tests and real pointer/resize tests across zoom/DPR; no duplicate drag-grid quantization |
| 3. Type tools | Point and area text with transparent appearance, correct formatting and overset behaviour | Native resolved-face evidence; line breaks/baselines and editable/exported glyphs agree; Notes remain cards |
| 4. Graph vertical slice | One real replacement Node Column, typed ports, headless evaluation and actual retained paint | Data flows correctly; one source change invalidates affected outputs only; camera movement does not evaluate graph; no missing card pixels |
| 5. Migration and board repair | Five exported boards repaired; drawing test preserved; Milanote 3.2 created with ordinary Columns and subboards | Migration diff/report, stable references, original authored text/assets and no missing edges; originals recoverable |
| 6. Reference and native gates | Matched composition, four UI reviews, packaged native save/reopen and live comparison against isolated P0/P1 baselines | Separate functional, visual, renderer-ownership and exact-4K performance receipts; all required cases PASS |

First implementation task: extract and unify the production snap/guide command path using actual scene bounds. Keep behaviour reversible and preserve current files. In parallel in the design sequence (not delegated agent work), define the reference manifest and Type data contract; do not repair every stress board before the graph slice passes.

## Test matrix to build, then execute

- Snapping: 10%, 25%, 50%, 100%, 200%, 400% zoom; DPR 1/1.5/2; acquire/release tolerance in CSS pixels; equal gaps; edges/centres; fractional coordinates; rotated objects; source-ratio images; grid off with object snap on; guides hidden/locked; scoped guides; background exclusion; deterministic tie behaviour; no jitter while crossing targets.
- Commands: drag/create/resize and inspector numeric commands agree; Alt bypass, Shift constraint, undo/redo one action, cancel restores exactly; family movement and Frame bounds remain valid. Opening Settings, inspecting, panning and guide visibility leave object geometry/text unchanged.
- Type: heading and paragraph-frame tools create distinct unboxed results; width changes reflow but retain font size; point text sizing; caret/IME/accented text; lists/leading/tracking; missing face reported; overset indicator; actual pixels at zoom; editor-to-render transition; SVG/PDF/raster export; close/reopen/clipboard preserve styles and content.
- Graph: compatible/incompatible ports, duplicates, reconnect/delete, cycles, cancelled jobs, graph errors, dependency invalidation, ordered card inputs, disconnected source data, whole-family move, locks/visibility, save/reopen, migration/reversal, zoomed-out connector size and accepted card/text paint.
- Fidelity: compare uncropped source and fresh application capture at the same normalized board transform; register once, no independent per-object repositioning or masked gaps. Assert title/arrow, three major composition regions, image rectangles/ratios, backgrounds, text presence, paragraph wrapping and z-order. Proposed calibrated anchor tolerance: 1 board pixel at the reference scale; font/antialias differences recorded separately. Thresholds remain provisional until source geometry/font identity is recovered. Unresolved fonts or missing prose remain blockers; do not manufacture a perfect-match score.
- Native persistence: create, edit, save, close process, reopen, restore and export actual project files in a disposable workspace using P1.5 storage options. Browser simulation is not disk acceptance.
- Performance: after the graph replacement and repairs, run all five exports plus drawing test and the new ordinary-column Milanote 3.2 variant using the established isolated-prototype exact-4K gates. Preserve full paint, features and animated edges. Keep tracing runs separate from timing; capture pointer-to-present, frame distribution, shaping/layout, graph invalidation/evaluation, snap time, capture/upload, ownership failures, memory and transport completeness. Retain rejected samples. No slower substitute baseline or fabricated target numbers.

Pass means all mandatory receipts pass and the owner accepts reference fidelity. These are planned tests; no P1.7 pass is claimed in this document.

## Primary research

- Adobe InDesign Smart Guides: dynamic edge/centre/spacing alignment during object transformations. https://helpx.adobe.com/indesign/desktop/layout-and-grid-tools/rulers-and-measure-tools/use-smart-guides.html
- Adobe grid snapping: snap-zone behaviour and guide/baseline-grid snapping. https://helpx.adobe.com/indesign/desktop/layout-and-grid-tools/grids/snap-objects-to-grids.html
- Adobe ruler guides: persistent layout guides. https://helpx.adobe.com/ph_fil/indesign/desktop/layout-and-grid-tools/rulers-and-measure-tools/create-ruler-guides.html
- Adobe text frames: page-layout text-frame model. https://helpx.adobe.com/indesign/desktop/add-and-manage-text/add-and-manage-text-frames/create-position-text-frames.html
- Affinity Frame Text: frame-based wrapping and typography control, separate from artistic text. https://s3-eu-west-1.amazonaws.com/affinity-docs/help/designer/en-US.lproj/pages/Tools/tools_frameText.html
- HarfBuzz: glyph shaping and positioned glyph output; not a complete paragraph-layout editor. https://harfbuzz.github.io/what-is-harfbuzz.html
- ConMan, SIGGRAPH 1988: ports and a separate connection manager. https://people.cs.vt.edu/~north/infoviz/conman.pdf
- Rete headless processing: processing nodes independent of UI integration. https://retejs.org/docs/guides/processing/dataflow/
- OpenExec: cached computed values and dependency invalidation. https://openusd.org/release/intro_to_openexec.html
- Hydra 2 scene indexing: structured data and granular change notifications. https://openusd.org/dev/api/_page__hydra__getting__started__guide.html
