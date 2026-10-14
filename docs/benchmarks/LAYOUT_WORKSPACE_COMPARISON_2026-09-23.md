# Layout workspace comparison — Affinity, Miro, and Art Equation

Date: 2026-09-23. Read-only UI scope; no app content or code was changed for this review.

## Sources and limits

- Inspected the open Affinity Layout workspace (current Affinity), Affinity Publisher 2, Miro desktop, and Art Equation Studio Vello GPU windows. These are observations of the current visible state, not a complete feature audit.
- The Miro connection became available during this review. Its read-only search found the open board, **Connection and Relationships Between Media**; a canvas overview reported 3,593 items: 2,179 images, 717 text areas, 353 shapes, 228 connectors, 107 documents, 5 embeds, and 4 frames. 3,328 items were outside frames. Private board content is deliberately not reproduced here. No Miro object was created or changed.
- No Affinity MCP connection was found. Affinity findings are from the open desktop applications, not programmatic document inspection. The observed Publisher document was read-only.
- No workflows involving creation, export, save, deletion, or sharing were exercised. Menu presence alone does not prove an action's behavior.

## Direct comparison

| Area | Affinity Layout / Publisher observation | Miro observation | Art Equation observation | Scope implication |
| --- | --- | --- | --- | --- |
| Work surface | Affinity Layout presents one bounded page on a large pasteboard. Publisher presents pages/spreads and a long page-thumbnail list. | One spatial canvas with persistent navigation and zoom. The inspected board has far more free-floating items than frames. | Split mode shows document and board simultaneously, plus project navigation and inspector. | Preserve Split, but offer a layout-focused mode with a clear page/board boundary and enough editing space. Do not make every workflow use one crowded four-column arrangement. |
| Hierarchy | Pages/Master Pages at left; Layers at right; Publisher shows page/spread thumbnails for a 124-page document. | Tabs and board-level navigation are visible, while frames can provide structure within a board. | Projects, documents, boards, a bottom board strip, and project contents all coexist. Board-strip thumbnails were generic placeholders in this view. | State exactly which navigator owns pages, boards, assets, and layers; avoid three parallel board lists with different affordances. Give board tiles meaningful previews and names. |
| Selection | The selected Layout image has direct on-page handles, a matching highlighted layer, exact transform fields, and a contextual Replace Image control. | Select tool and bottom zoom controls stay separate from content. | A selected canvas shape has handles and compact geometry controls, while the right inspector continues to show project status rather than object properties. | Make selection inspectable in one predictable place: object properties when an object is selected, project summary when nothing is selected. Preserve the direct handles and exact numeric editing. |
| Tool discovery | Layout's left tool rail includes distinct text, table, picture-frame, shape, and navigation tools; top bar changes with selection. Publisher also exposes typography panels. | Miro keeps a short creation rail with a More entry, leaving navigation visible. | Canvas rail is icon-only, while tool-specific values occupy a narrow horizontal bar. At this width some values and board titles are visibly clipped. | Add accessible labels/tooltips and a narrow-width overflow design. Group drawing, board insertion, and document tools by task, not solely by icon density. |
| Color and typography | Layout has dedicated Color/Swatches/Stroke tabs; Publisher shows CMYK controls and Character/Paragraph/Text Styles panels. | Spatial board styling is separate from board navigation. | Color chip, stroke width, text size, and geometry share the top bar; project inspector remains open. | Separate appearance controls from geometry; put text-specific controls and reusable styles in a document/text panel. Keep the application theme separate from document and canvas colors. |
| Navigation and feedback | Affinity page thumbnails show real page content and selected layer is highlighted. | Miro has persistent tabs and visible zoom percentage. | Art Equation shows 23% zoom in the inspected canvas, Fit/zoom controls at bottom, plus a minimap that occupies part of the canvas. | Improve Fit/100% discoverability and show a visible object/board title during navigation. Make the minimap collapsible and avoid covering selected content. |

## Priority findings

1. **Selection context is split across the UI.** Art Equation has an object selected but still dedicates its right inspector to project status. The user must read a thin canvas toolbar for geometry and a different region for project state. A contextual inspector would reduce hunting without altering the separate document engine.
2. **The split layout is too compressed at the observed window size.** The document remains readable, but the canvas is narrow, object-property fields are truncated, the minimap overlaps the work surface, and bottom board titles are shortened. This is a responsive layout problem, not a renderer feature.
3. **Board navigation lacks content recognition.** The bottom board cards use generic icons, while Affinity's page strip uses actual page thumbnails. Art Equation already has board-cover concepts; use stable cover/preview states with safe fallbacks.
4. **Spatial scale needs structure.** The inspected Miro board demonstrates that thousands of loose items can exist with few frames. Art Equation should support named regions/sections, search, and jump-to-content as boards grow, while avoiding an automatic migration of every Miro convention into the document system.
5. **Text and layout controls should not be treated as canvas drawing controls.** Affinity's page, text-frame, paragraph, and style panels suggest a distinct document-layout workspace. Art Equation's document side should retain its own interaction and data model even when the board uses Vello GPU rendering.

## Proposed passes

### A. Interaction map and measurement

Record the actual paths for selecting, moving, resizing, replacing an image, changing fill/stroke, editing text, creating a board, and switching Document/Split/Canvas. Capture time-to-completion, misclicks, clipped controls, focus changes, and 100%/150%/200% display scaling. Test light and dark. Do not assume a visual analogy proves functional parity.

### B. Responsive workspace shell

Define minimum usable widths for project navigation, document, board, and inspector. Let users collapse/project-focus panels independently. At narrow widths, move secondary controls into a labeled overflow or inspector, not off-screen. Persist workspace layout per user without writing it into project content. Ensure the renderer receives the final viewport size once after layout settles.

### C. Contextual inspector and canvas controls

Use one selection model to drive the canvas toolbar, status, and right inspector. Show transform and appearance for the active object, multi-selection properties for a group, and project summary only with no applicable selection. Keep numeric values legible; include units, constraints, reset/undo, and keyboard focus. Direct handles and numeric inputs must agree after drag, zoom, and save/reopen.

### D. Page, board, and layer navigation

Use real, cached board/page previews where possible, a labeled fallback where not, and consistent active/hover/focus states. Give boards a title, cover, object count, and reliable open action. Keep document pages and canvas boards distinct, while sharing navigation patterns. Add jump-to-board, search, and optional named canvas sections before attempting Miro-scale freeform organization.

### E. Layout and typography workspace

Study picture frames versus placed images, text frames, guides, margins, alignment, overflow, linked resources, paragraph/character styles, and export/print. Implement only workflows that Art Equation's product needs; retain one document engine shared by rendering editions. This pass is not a mandate to clone Publisher or merge document state into Vello.

## Acceptance checks

- At 1280 px width and at 200% display scaling, primary object controls remain readable and reachable; no selected object is hidden by the minimap or panels.
- Selecting a rectangle, text object, image, multiple objects, or nothing yields one unambiguous inspector state, with the same values as canvas handles and keyboard actions.
- Document mode remains fully usable with the GPU canvas hidden. Split and Canvas modes do not reinitialize or alter document content merely from a layout change.
- Board/page previews identify actual content or show a labeled missing-preview state; active location is evident across navigation surfaces.
- The board can navigate a large dataset by search and named region without depending on manual zoom across an unbounded canvas.
- Light/dark UI tokens are consistent, while project/document/canvas color values remain independent of the UI theme.

## Next decision

Prototype the responsive shell and contextual inspector first, using the already-open Art Equation build for side-by-side checks. Treat Miro as the reference for large spatial navigation and Affinity Layout/Publisher as references for page, layer, selection, and text-layout clarity—not as feature lists to copy wholesale.
