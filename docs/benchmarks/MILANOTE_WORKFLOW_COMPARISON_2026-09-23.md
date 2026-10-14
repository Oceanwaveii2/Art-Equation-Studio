# Milanote workflow comparison — Art Equation board and trash scope

Date: 2026-09-23, 7 PM Pacific. Scope and evidence only. This review did not change Milanote board content or Art Equation code. Collaboration controls were excluded.

Owner clarification added 2026-09-24: the requirements below define the intended Art Equation hierarchy and appearance, including compact breadcrumbs, nested-board navigation, optional disk-folder links, and square board/project artwork. These are product requirements; they are not claims that every detail was verified in Milanote during the earlier read-only session.

## What was actually observed

- The live signed-in test board was **For Chat GPT** at `https://app.milanote.com/1X9wXG1wO8UF0H/for-chat-gpt`. Its root canvas had a **Character Board** tile containing a further **Rainee Transform into a Strip Club** board tile, along with image/file placeholders, notes, three white color cards, and a link card. Several media previews were gray cloud placeholders, so their final imagery could not be assessed.
- From Home, **For Chat GPT** appeared as a board tile inside a column. The column displayed its own board count; the tile displayed **3 boards, 11 cards**. Other columns mixed board tiles with media, links, and text. The test-board accessibility tree likewise exposed nested board summaries, showing that visual container, board, and child-board relationships are separate concepts.
- The left tool rail exposed Note, Link, To-do, Line, Board, Column, Comment, Table, Add image, Upload, Draw, and Trash. Comment and other collaboration controls were not opened.
- A card/image right-click menu exposed Cut, Copy, Duplicate, Move to Trash, Crop Image to Fit Dot Grid, Lock Position, Bring to Front, Send to Back, and creator/time information. Selection also exposed Color, Labels, Edit, Background, Caption, and More controls. Their menus and effects were not exercised.
- Right-clicking the **For Chat GPT** board tile exposed Cut, Copy, Duplicate, Move to Trash, Rename, Open in New Tab, Create a Shortcut to This Board, Copy a Link to This Board, Convert to Template, Lock Position, and creation/modification attribution. Its selected-item rail changed to Color, Icon, Rename, and More. More exposed the board-specific secondary actions again. No menu command was executed.
- The selected board Color control opened solid, patterned, and custom color choices. The Icon control opened category choices, icon search, and **Upload an image**. These are distinct from changing the current board's canvas background. No color, icon, or image was selected or uploaded.
- The left rail has a Board creation affordance. Right-clicking empty canvas exposed Paste, Undo, Select All, New Note, New Link, New To-do, New Line, **New Board**, New Column, New Table, Change Board Background, and New Image/File Placeholder (plus New Comment, excluded here). New Board was observed as an entry point only; its creation flow was not activated.
- The View menu exposed percentage zoom, Scale to fit, and presentation options. This supports keeping canvas navigation separate from card editing. Zoom was inspected, but no project content was edited.
- Milanote's compact top path shows Home followed by the current board and its nested-board ancestors. Entering a nested board adds another breadcrumb segment; the child board is the active workspace rather than another peer in the parent's main canvas. The supplied screenshots also show the path occupying a shallow header strip, while Art Equation's current board-title/navigation header is comparatively tall.
- Trash opened a separate panel with **Deleted by me** and **Deleted by others** tabs, date groups including Today and Yesterday, visual previews for some items, link title/URL information, a video filename and size, Load more, and an Empty trash action. Some deleted items had incomplete or unloaded previews. No Restore, Empty trash, or permanent-delete action was activated.
- The owner's screenshots show why the reference matters: Milanote's deleted content is recognizable at a glance, while Art Equation currently presents compressed text rows. The owner also supplied screenshots of Milanote's board right-click menu and Art Equation's inline `X` controls.

### Limits of this session

The crowded test-board canvas and overlapping unloaded media made its board-tile hit targets unreliable. On Home, single click selected the board tile and exposed its tools. Attempted double-clicks did not navigate, so the exact double-click/open behavior remains unverified. The outcomes of New Board, Rename, Open in New Tab, Shortcut, Template, Lock, color/icon selection, upload, and individual Trash restore/permanent-delete were not activated. The existence of their controls was verified, but not their results. A controlled second inspection should verify those outcomes before treating them as parity rules.

## Current Art Equation behavior and gaps

| Area | Current source evidence | Scope implication |
| --- | --- | --- |
| Board/document navigation | `desktop-app/src/App.tsx:2097-2099`, `:2280`, `:5199`: single-click opens; double-click renames; navigator rows have inline `X`. The supplied screenshots show Milanote's compact Home → parent → current-board breadcrumb. | Decide a consistent open/select/rename contract, then replace scattered deletion affordances with discoverable contextual actions and keyboard equivalents. Keep nested boards out of the parent's main canvas by default; navigate into a child board as a distinct board view and show its ancestry in a compact breadcrumb path. |
| Media double-click | `desktop-app/src/App.tsx:5024`: filled image/video/model objects open preview. Earlier `docs/scope/MASTER_CANVAS_ASSET_COMPANION_SCOPE_2026-08-31.md:53` proposed add/replace on an image-capable card. | Resolve the contract explicitly: empty media slot may open a picker; filled media may open preview; Replace and Set cover must be named actions. |
| Cover/color capability | `desktop-app/src/model/project.ts:207-218` already has board `coverAssetId` and `backgroundColor`; `desktop-app/src/App.tsx:1844`, `:2281`, `:5194` expose cover controls. The provided Milanote menu/screen references include an image-upload icon affordance; the user's current request extends this to square board and project artwork. | Reuse board data; add a coherent tile cover/color editor instead of a second board schema. Support a high-quality square image/icon for board tiles and the project entry, with crop/reposition, fit, replace, and reset actions. Keep tile accent distinct from the board's canvas background unless the user chooses to link them. Inspect whether project imagery needs a separate field from board cover data. |
| Trash presentation | `desktop-app/src/App.tsx:2148-2166` renders title, type, origin, date, Restore, Delete forever; no preview or date grouping. | Build recognizable, type-specific previews and scan-friendly groups before expanding deletion shortcuts. |
| Asset restore | `desktop-app/src/model/trash.ts:164` implements `applyAssetRestore`, but `desktop-app/src/App.tsx:1145-1146` routes every non-board item through `applyNodeRestore`. | Fix and test restore dispatch before promoting Trash as reliable recovery. |
| Board restore | `desktop-app/src/model/trash.ts:102-119` snapshots one board, promotes its direct children to roots, removes incoming board links; `:92-97` restores only the board snapshot. | Specify and implement subtree/link restoration or clearly restrict deletion of a parent board until its descendants can be recovered. |
| Permanent deletion label | `desktop-app/src/App.tsx:1156-1163` removes a Trash entry after confirmation, while `:2150` states files remain on disk. | Make the label and confirmation describe the actual outcome. Define an explicit file-purge policy separately from removing the recovery record. |

Existing owner decisions in `docs/scope/ADUTT_SCOPE_V2_TRASH_DUPLICATION_DECISIONS_2026-09-02.md` call for immediate, undoable canvas trash moves, confirmation for navigator deletion, and confirmation for permanent purge. The later app implementation already puts boards in Trash. Reconcile those rules in one current action contract before changing the interface. The nested-board recovery issue is also tracked as LK-08 in `docs/history/LOST_KNOWLEDGE_AUDIT.md`.

## Proposed interaction contract

1. A single click selects a board tile or object. Adopt a defined open gesture for boards after confirming Milanote's exact behavior; use a visible Open action regardless. A populated media object opens a preview and an empty media slot opens its image picker. Rename uses F2/Enter or the context menu. Record any exception for document rows separately; the document engine stays independent of canvas rendering.
2. One context-action vocabulary applies across navigator rows, board filmstrip, board tiles, canvas cards, and assets: Open/Edit, Rename, Copy/Duplicate, appearance/cover, Lock, and Move to Trash. Each surface shows only actions valid for its item type; selected multi-object actions preserve the selection. Empty-canvas right-click remains an insertion/navigation menu.
3. A board tile can use a chosen project image as a square cover/icon, a default/automatic cover, and an optional color accent or pattern. The project entry can also use chosen square artwork. Provide crop/reposition and quality-preserving preview at tile sizes. The same saved appearance appears consistently in the canvas, filmstrip, navigator, and Trash preview. Do not silently recolor the board canvas when changing the mini-board accent; keep its background control separate.
4. Board hierarchy follows a path model: a nested board opens as its own workspace and is not automatically duplicated as a visible tile on its parent's main board. A compact breadcrumb displays Home/project context and the ancestor-to-current-board chain; selecting a breadcrumb returns to that level. Creating a nested board explicitly records its parent relationship. A board may optionally link to a disk folder so the user can track related local files; the mapping is visible/editable and never implies that moving or renaming the board moves or renames disk content.
5. Move to Trash is reversible and offers immediate Undo. Permanent removal is available only from Trash, with a clear preview and confirmation. If disk bytes are retained, say **Remove recovery record**; reserve **Delete files permanently** for an implemented, verified purge path. Never use a generic `X` as the sole discovery point for a destructive command.
6. Trash uses date groups and cards sized for identification: thumbnail or document/board preview, full title, kind, former board/project, deletion time, source asset path or link where relevant, size, and the count of affected placements or descendants. Missing previews have a labeled fallback, not an empty rectangle. Single-item Restore, permanent action, and any future Empty Trash action remain visually distinct.
7. The current project is local/single-user. Milanote's **Deleted by others**, collaboration, comments, and presence are outside this implementation scope.

## Feature-by-feature passes

### 0. Recovery correctness before visual expansion

Route Trash entries by kind, exercise asset restore with all prior board placements, and decide parent-board/child-board/link recovery. Capture snapshots before any destructive mutation; keep entries if restoration fails. Clarify whether permanent action removes only the index or file bytes. Document the current reversible versus irreversible rules.

### 1. Universal action model

Inventory actions per project/document/board/board tile/column/media/object type. Use a shared command definition for menu labels, availability, shortcuts, disabled reasons, and undo behavior while each subsystem retains its own data handler. Replace navigator `X` with a context menu or explicit overflow control only after keyboard and touch equivalents exist. Add tests for target selection, multi-selection preservation, read-only workspaces, and context menu dismissal.

### 2. Board creation, structure, navigation, and mini-board appearance

Provide New Board in the rail and empty-canvas menu, with a predictable insertion point and immediate naming path. Confirm whether creation inside a column creates a child board, a board tile inside that column, or a shortcut; never infer ownership from visual placement alone. Show board/card/file/document counts on tiles and maintain the distinction between Home, project board, visual column, child board, and shortcut. Finalize single/double-click and rename behavior.

Implement nested boards as a navigation hierarchy: when the user enters a child board it becomes the active board view, its parent/ancestors appear in a compact breadcrumb, and the child is not also shown as a peer tile on the parent's main canvas unless the user explicitly creates a shortcut/board-link card. Breadcrumb selection navigates back to an ancestor. Define whether a child can optionally map to a local disk folder; show the path and provide explicit link/change/unlink actions, with no filesystem mutation implied by board navigation or rename. Protect against broken/stale mappings and distinguish “board hierarchy” from “disk folder hierarchy.”

Add a visible board tile menu for cover/icon, crop/fit, automatic cover, accent/pattern, and reset. Support square, high-resolution artwork on both board tiles and the project entry; allow choosing from project assets or importing an image, then crop/reposition and preview at actual small-tile sizes. Reuse the existing `coverAssetId` and `backgroundColor` only where their semantics match; add a separate accent field if needed, and inspect whether project art requires its own field. Keep artwork sharp with appropriate source retention and generated thumbnail sizes. Verify the same appearance in parent-board navigation, board strip, navigator, project list, and Trash preview. Trashing a shortcut must retain its target.

Make the current-board header compact: breadcrumb height should stay close to Milanote's shallow navigation bar, with the board title and actions placed without consuming the canvas/document viewport. At narrow widths, truncate the middle path segments and expose them in an accessible overflow menu rather than wrapping into a tall header.

### 3. Rich Trash preview

Use existing Trash snapshot and thumbnail fields to render image/video/model previews, board covers or a miniature board snapshot, and a document first-page preview when available. Keep preview generation bounded and lazy for large trash lists. Date grouping, searchable title/source text, accessible metadata, and placeholder/error states come before decorative polish. A preview must represent the deleted snapshot, not a later-mutated live object.

### 4. Destructive-action safety and responsive polish

Show impacts before deleting a board subtree or asset used on multiple boards. Restore reports partial recovery with named missing boards/files. Confirm irreversible actions with the item name and actual disk effect. Make menus and previews usable at narrow split widths and at 200% display scaling; retain keyboard focus, Escape behavior, visible focus, screen-reader names, and sufficient contrast in light/dark modes. Do not add hover-only actions.

## Acceptance checks

- The same board/card/asset action has the same name and shortcut wherever it appears; invalid actions are absent or explain why they are disabled. A right-click does not unexpectedly move, rename, or delete content.
- Board creation from the rail and empty-canvas menu lands in the intended container, appears once in history, can be undone, and is named without creating accidental duplicates. A visual column does not silently become an ownership parent. Tile summary counts update after create/move/trash/restore.
- Entering a nested board replaces the parent board canvas with the child view; parent canvas does not accumulate child-board tiles unless the user creates an explicit shortcut. Breadcrumbs show the complete ancestor chain, navigate to each ancestor, remain compact, and have an accessible overflow behavior at narrow widths.
- Optional board-to-folder mapping can be assigned, changed, and removed without moving, renaming, or deleting local files; a missing folder is clearly reported and does not break board navigation.
- Board tile open gesture, media double-click, empty media slot, F2/Enter rename, and context actions each have one documented result; the board gesture and menu outcomes are verified against the live reference in a controlled follow-up.
- Choosing a cover or mini-board accent survives save/reopen, appears on all board surfaces, and does not change the underlying image or canvas background without an explicit choice.
- Board and project artwork accepts square high-resolution images, crops/repositions predictably, remains sharp on tile and project-list surfaces, survives save/reopen, and offers replace/reset without modifying the source asset.
- Trash previews identify a deleted image, video, board, document, link, and simple shape without requiring Restore. Dates, origin, and placement/dependency counts are accurate; unavailable files are visibly marked.
- Restore returns an asset and every recoverable placement, or names each placement that cannot return. Parent-board recovery preserves descendants and board links, or deletion is blocked with an explanation until that path exists. Undo and reopened project state agree.
- The permanent-action label, confirmation, post-action status, and disk contents agree. No recoverable record is discarded when a restore or purge step fails.
- Menus, Trash, and tile controls work by mouse, keyboard, and touch-sized targets in both themes and narrow split mode. Collaboration controls are not part of these checks.

## Handoff

Start Pass 0 in the current Vello GPU repository before changing the UI. This document is a scope, not an implementation report. Re-check the unresolved live Milanote behaviors on a sparse test board if exact parity is required; no changes were made to the owner's Milanote content during this review.
