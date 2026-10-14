# Art Equation graphing and spatial-board UI comparison

**2026-09-29 update:** See the [source-checked Miro gap and repair addendum](MIRO_GAP_REPAIR_ADDENDUM_2026-09-29.md) for MG-01–MG-10, specific connector/export/arrangement limitations, the owner's connected-image examples, native reproduction steps and Stage 4A subdivisions. These refine X-19 and G-01–G-08; repairs remain open.

Date: 2026-09-28  
Status: research-backed repair scope; **no Art Equation code or reference-board content was changed**.

## Scope and evidence

Here, “graphing” means vector diagrams, connected objects, process maps, and visually arranged information—not mathematical/statistical plots. The research combines current official Lucidchart and Miro documentation, the user’s previously analyzed Milanote and Real Time Boards recordings/screenshots, and the September 27 Art Equation baseline/audit. The Real Time Boards recording itself shows Miro-branded chrome; this scope calls it the **Real Time Boards reference (Miro-branded UI)** and does not infer app identity beyond the visible evidence. Collaboration, presence, comments, permissions, invitations, and team administration are excluded. AI generation and cloud integrations are also not proposed as requirements.

Official docs describe vendor capabilities, not independent usability scores. Supplied recordings show only sampled states and the Art Equation native gaps remain subject to the evidence labels in [Audit record 2](AUDIT_RECORD_2_CROSS_APP_UI_UX_2026-09-27.md). A visible menu or still image does not prove an interaction succeeded.

## What the references are good at

### Lucidchart — precise, diagram-first authoring

The current Lucidchart help material describes a diagram editor organized around a shape-library panel at left, a contextual formatting bar across the top, an advanced contextual panel, and page/zoom/layer controls below. Users can start from a blank document, template, import, or supported diagram-as-code/data workflows. A diagram-focused subset of its documented authoring behavior includes:

- searchable and configurable shape libraries; drag a stencil onto the page, or create the next connected shape from an existing shape’s connection nodes;
- object text, exact size/position fields, proportional resize, rotation, style copying, fill/opacity/stroke/arrowhead and connector labels;
- front/back order, group, align, distribute, match dimensions, and grid/hierarchy auto-layout;
- semantic containers and swimlanes, including connecting/magnetizing shapes to a lane;
- optional layers to show alternate process states; page navigation for multi-page diagram documents;
- CSV/data-linked diagrams and specialized shapes, plus export/publish options. Some data functions and specialized libraries are plan-dependent. CSV process generation itself warns that complex inputs can still overlap and need manual adjustment.

The portable lesson for Art Equation is **discoverable diagram primitives plus reliable object relationships and arrangement commands**. Lucidchart’s data synchronization, business-library breadth, administration and collaboration are not required for a single-user art-planning app.

![Lucidchart formatting toolbar: object-aware typography, fill/stroke, line and endpoint controls.](../research/graphing-reference/figures/lucidchart-formatting-toolbar.png)

![Lucidchart process-flow example with colored swimlanes, labels and routed connectors.](../research/graphing-reference/figures/lucidchart-flowchart-swimlanes.jpg)

![Lucidchart image panel example, demonstrating a persistent left tool/panel rail next to the canvas.](../research/graphing-reference/figures/lucidchart-image-panel.png)

### Real Time Boards reference — broad, mixed-content spatial canvas

The owner’s video samples show an infinite grid, zoom readout, creation rail, separate board-level menu, mixed images/documents/notes and frames/rectangles, and labeled straight or curved connectors. A separate owner still shows many differently proportioned images in two rows, inner image edges, one broad selection outline with handles, and a floating toolbar. That still **does not prove** whether the objects are a persistent group, how they were aligned, or what resize/crop operation was used.

Current official Miro help documents a shape panel and shape packs; drag-created frames; grouping; alignment/distribution and smart alignment; line/dot grids and snapping; object dimensions; connector creation from blue dots; straight/elbow/curved lines, labels, and distinct center versus edge anchor behavior; layered diagram workspaces, containers, focus mode, and templates. Its help also cautions that very large boards become less smooth to navigate/load. We should borrow the useful spatial patterns, not assume every Miro diagram feature is visible in the owner’s clip.

![Official Miro diagramming panel and shape library beside an open canvas.](../research/graphing-reference/figures/miro-diagram-shapes-panel.jpg)

![Owner-supplied Miro-branded canvas reference showing mixed content and connected spatial clusters.](../research/video-uiux/figures/realtime_connectors_t288.png)

![Owner-supplied dense image arrangement target: two mixed-aspect rows, broad bounds/handles, and floating object controls.](../research/video-uiux/figures/miro_complex_image_arrangement_reference_2026-09-27.png)

### Milanote — creative organization and board hierarchy

The owner’s Milanote recording/screenshots show a visual board rather than a specialized flowchart editor: images, notes, links, video/file cards, lines, columns, and board portals coexist on a spatial canvas. A child board is a separate destination represented by a portal on its parent; the compact breadcrumb expresses hierarchy. In the recording, a portal can appear as a small icon/title row within a visual column, while owner screenshots show a standalone square. Selecting a board/column exposes local appearance and naming actions. The rail tucks less frequent creation actions under More. The Trash view is preview-oriented and close to its persistent entry. The recording’s displayed menu is evidence of available commands, not proof that each command’s outcome was tested.

![Milanote creation rail recorded in the user’s video.](../research/video-uiux/figures/milanote_toolbar_icons_t156.png)

![Milanote compact child-board portal in a visual column; this remains a portal to a separate board.](../research/video-uiux/figures/milanote_board_portal_t156.png)

![Milanote column-local appearance/color controls.](../research/video-uiux/figures/milanote_column_color_controls_t096.png)

![Milanote Trash preview with visual items and a separate empty-trash action.](../research/video-uiux/figures/milanote_trash_preview_t264.png)

Transfer the direct manipulation, visual organization, hierarchy, and local appearance cues. Do not copy its cloud retention model or collaboration features.

## Side-by-side gap assessment

| Capability | Lucidchart | Real Time Boards / Miro reference | Milanote | Art Equation evidence and gap |
|---|---|---|---|---|
| Spatial canvas | Page-based diagram workspace, plus pages | Large zoomable spatial field | Freeform creative board | Art Equation has an infinite Vello canvas, grid, pan/zoom and minimap. Stable camera, native performance, ghost-free rendering and large-board behavior still need target-EXE validation (X-11). |
| Shapes and tools | Searchable diagram stencils and context formatting | Left creation rail with diagram shape packs | Compact creation rail and More | Art Equation has Pen, node/path editing and common shapes, but the audit does not verify a Lucid/Miro-style searchable stencil library or a consistently discoverable set of diagram primitives. Tool rail/menu clipping/layering remains X-02/X-06. |
| Connectors | Connection nodes, editable routes/endpoints and labels | Blue-dot creation, center/edge anchors, straight/elbow/curved links and labels | Visual line/link cards for relationships | Art Equation has connector models/rendering, but reliable anchor semantics after object move/resize/group, routing, labels and fine hit targets are unverified (X-11). Treat as an interaction-foundation gap, not a claim that connectors are absent. |
| Selection and arrangement | Exact dimensions, group, align/distribute, match size, auto-layout | Group, align/distribute, smart guides, dimensions, frames | Directly rearranged cards and columns | Art Equation has selection, groups/frames and arrangement controls; cross-path/marquee and dense selection behavior, exact layout commands and native scaling are incomplete/unverified (X-03, X-10, X-15). |
| Structure | Containers, swimlanes, pages, optional diagram layers | Frames, nested containers/layers, board views | Columns plus true nested-board portals and breadcrumbs | Art Equation has groups/frames and child boards, but their semantics and membership/deletion rules need to stay distinct; inspect X-01/X-05/X-08. No verified dedicated diagram-layer panel or swimlane contract is recorded. |
| Media + boards together | Images may be inserted alongside diagram objects | Mixed diagrams/media on the large canvas | Core use: mixed creative cards/columns/board portals | Art Equation’s model includes image/video/document/board-link and vector nodes. A 50-image mixed-aspect arrangement, clean one-selection bound, crop/fit, saved grouping and sharp preview flow are not verified (X-07/X-10). A portal must remain a navigable object—not an embedded copy of its child canvas. |
| Recovery and actions | Editor undo/history; diagram export | Menus and reversible board edits | Context menu plus preview-first Trash | Art Equation has context actions and Trash preview; action-menu parity and whole-subtree/asset recovery remain open (X-01/X-06/X-09). Do not copy permanent-delete defaults or cloud collaboration semantics. |
| Diagram-specific capability | Data-bound shapes, CSV/import, templates, Mermaid and many specialized libraries | Shape packs/templates and structured Diagram format | Not a diagram-data specialist | No equivalent full diagram authoring/import/data layer has been verified in Art Equation. This is not a launch requirement: first support a compact manual flow/relationship-diagram subset. Data binding, huge symbol packs, AI and vendor integrations are later opt-in questions. |

### Art Equation strengths to keep

- Native vector/path authoring and an art-oriented mixed-content canvas, not a business-process-only document.
- Board/sub-board identity, project organization, local disk-linked roots, and source media management.
- Images, video, notes/text, shapes, connectors, and child-board portal objects can be modeled in one project workspace.
- Separate Document, Split and Canvas modes, hideable side panels, and local save/recovery are product-specific strengths.

### Repair backlog to add

| ID | Priority / status | Needed work | Completion evidence |
|---|---|---|---|
| G-01 | **P1, foundation; unverified behavior** | Stabilize coordinate conversion, selection/hit targets, connector anchor identity and route persistence under pan/zoom, move, resize, rotate, group, undo and reopen. | Native Vello regression fixture with attached and free connectors; endpoints visibly remain correct after every transform, at multiple zooms; no stale overlay/ghost pixels. |
| G-02 | **P1, foundation; partial** | Complete one-object and multi-object selection semantics, tight selection bounds, keyboard operation, and separation of transient multi-select from saved Group/Frame. | Select/drag/marquee/group/ungroup on paths and mixed image cards; correct bounds and one-step undo in native build. |
| G-03 | **P2, not started as a diagram-specific UI** | Offer a compact, searchable/labeled shape palette; expose common diagram shapes, line/arrow variants, connector creation from anchors, and selection-aware formatting without crowding the rail. | Create a small labeled process map without hunting hidden tools; keyboard, tooltips and outside-click/Escape behavior pass. |
| G-04 | **P2, partial/unverified** | Make alignment, distribution, equal gap/size, z-order and optional smart guides/snap reliable for heterogeneous selected objects. | Arrange varied-size shapes and images; values/spacing are predictable; Undo restores exact geometry; locked items are handled visibly. |
| G-05 | **P2, semantics to decide** | Define Group vs Frame vs any future semantic Container/Swimlane. Specify child membership, resize/move behavior, connector treatment, collapse/clip rules and Trash/restore. | A diagram frame with nested regions moves/resizes predictably; visual overlap alone never changes board or disk hierarchy; undo/recovery preserves membership. |
| G-06 | **P2, optional later** | Consider per-diagram layers or locked/hidden groups only after selection and object hierarchy are dependable. | Toggle visibility/lock without affecting other boards; labels and keyboard state are clear; saved/reopened layer state is stable. |
| G-07 | **P2, overlaps existing scope** | Finish the Milanote-style child-board portal and consistent item action/appearance/recovery path within mixed spatial canvases. | X-05/X-06/X-07/X-08/X-09 pass for standalone and column-row portals, menus, icons/colors and subtree recovery. |
| G-08 | **P2, overlaps existing scope** | Validate image collage layout and large-canvas response: aspect ratio/crop, group vs selection, align/distribute, overview/detail zoom and thumbnail loading. | 50 mixed-aspect images plus a small diagram coexist; native Vello stays responsive and accurate through save/reopen, with unchanged source media. |

## Recommended staged plan

1. **Foundation first:** close X-02/X-03/X-06/X-11/X-18 in their existing milestones: panel/overlay geometry, coordinate transforms, path/selection/connector behavior, exact fill opacity, and native renderer checks. Do not add diagram affordances on top of unstable selection.
2. **Milanote structure and safety:** close X-01/X-05/X-07/X-08/X-09. Board portals, columns, images and shapes stay peers on a parent canvas; child entry is explicit; visual placement is not filesystem ownership.
3. **Compact diagramming slice:** implement G-03–G-05 only after the foundations pass. Start with a practical reusable shape palette, reliable attached connectors with endpoint/route/label options, multi-select, align/distribute, and an explicitly defined group/frame. Keep rare commands in a labeled flyout.
4. **Dense media + diagram coexistence:** close G-08/X-10 with a reproducible fixture containing 50 mixed-ratio images, one small connected flow and child-board portals. Prioritize responsive rendering, keyboard use and source safety over data-heavy Lucid parity.
5. **Optional advanced diagrams:** evaluate G-06, templates, SVG import/export and data-driven generation separately, based on owner workflows. CSV-linked data, enterprise shape libraries, AI generation, integrations, presentations and collaboration are explicitly not in the initial fix list.
6. **Release check:** test the exact named native EXE, both themes, 100/150/200% Windows scaling, keyboard/screen-reader paths, save/reopen, Undo/Redo, Trash/restore and measured performance. Browser-only checks do not close native gates.

## Acceptance fixture for the new scope

On a disposable project, make a six-to-ten-node process map with labeled shapes, a decision branch, an attached curved/elbow connector and one free connector. Add a frame/group boundary, then place a child-board portal and a varied image/video/reference cluster beside it. Select single shapes, several shapes, connectors and images; align/distribute; move and resize; pan/zoom; save/reopen; undo/redo; move a test group/sub-board to Trash and restore. Verify route/anchor, selection bounds, hierarchy, object identity, source media, disk folders and inspector/menu state. Repeat at 100/150/200% display scale and 25/50/100/200% canvas zoom; record any behavior the reference video does not establish as a product decision, not a copied assumption.

## Screenshots and videos

- Lucid official walkthrough: [Getting started with Lucidchart workshop](https://www.youtube.com/watch?v=I6c2IWWxgog) (Lucid Software; covers workspace, process maps, swimlanes, assisted layout and line endpoints). [Lucid workspace documentation](https://help.lucid.co/hc/en-us/articles/11970952773652-Welcome-to-Lucidchart) · [shape/arrangement documentation](https://help.lucid.co/hc/en-us/articles/16390096079764-Add-and-customize-shapes-in-Lucidchart).
- Miro official walkthrough: [How to Build Diagrams in Miro](https://www.youtube.com/watch?v=UtW8DycdMWQ). [Mapping & diagramming](https://help.miro.com/hc/en-us/articles/4403634496402-Miro-for-mapping-diagramming) · [structure, grouping and align](https://help.miro.com/hc/en-us/articles/360017730973-Structuring-board-content) · [Diagram focus/layers/containers](https://help.miro.com/hc/en-us/articles/25275263961874-Miro-Diagrams).
- User’s local interaction evidence (available on the owner’s machine): [Real Time Boards recording](file:///C:/Users/User/OneDrive/Videos/Real%20Time%20Boards%20.mp4) · [Milanote recording](file:///C:/Users/User/OneDrive/Videos/Milinotes.m4v). The captured frames are included above and in the linked dated studies; the videos were not re-extracted for this scope.
- Milanote official references: [create a first project and nest boards](https://help.milanote.com/en/articles/112349-creating-your-first-project) · [organize a Home board](https://help.milanote.com/en/articles/6978839-organizing-your-home-board) · [columns](https://help.milanote.com/en/articles/10478526-columns) · [nesting boards](https://help.milanote.com/en/articles/9860073-nesting-boards).

## Sources

- Lucid, [Welcome to Lucidchart](https://help.lucid.co/hc/en-us/articles/11970952773652-Welcome-to-Lucidchart); [Add and customize shapes](https://help.lucid.co/hc/en-us/articles/16390096079764-Add-and-customize-shapes-in-Lucidchart); [Flowcharts guide](https://help.lucid.co/hc/en-us/articles/31745848620308-Flowcharts-A-guide-from-start-to-finish); [CSV process-diagram import](https://help.lucid.co/hc/en-us/articles/15927090927508-Create-a-process-diagram-from-CSV-import).
- Miro, [Mapping & diagramming](https://help.miro.com/hc/en-us/articles/4403634496402-Miro-for-mapping-diagramming); [Structuring board content](https://help.miro.com/hc/en-us/articles/360017730973-Structuring-board-content); [Miro Diagrams](https://help.miro.com/hc/en-us/articles/25275263961874-Miro-Diagrams); [Layers](https://help.miro.com/hc/en-us/articles/20258488000786-Layers).
- Existing local evidence: [Milanote video analysis](../research/video-uiux/MILANOTE_BOARD_AND_CARD_ANALYSIS_2026-09-27.md), [Real Time Boards/Miro video analysis](../research/video-uiux/REAL_TIME_BOARDS_MIRO_CANVAS_ANALYSIS_2026-09-27.md), [dense image arrangement scope](ART_EQUATION_VIDEO_REFERENCE_IMAGE_ARRANGEMENT_SCOPE_2026-09-27.md), [baseline UI audit](ART_EQUATION_PART_I_BASELINE_UI_AUDIT_2026-09-27.md), and [cross-app issue register](AUDIT_RECORD_2_CROSS_APP_UI_UX_2026-09-27.md).
