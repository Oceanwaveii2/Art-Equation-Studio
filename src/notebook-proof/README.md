# Production Notebook document proof of concept

This is a separate browser demonstrator, not the production Art Equation document system. It does not load, migrate or save project.json, rich-document content, the supplied Word file or portable assets. No collaboration or paid services are used.

Open `http://127.0.0.1:5174/notebook-proof.html` when the existing Vite server is running. Optional independent build: `npx vite build --config notebook-proof.vite.config.ts`. Its output is `dist-notebook-proof`; the production build entries remain unchanged. This route is not included in the shipped EXE by default.

## Contract and capabilities

`ProductionNotebook({ initial?, storageKey?, onChange? })` uses the independent schema in notebookModel.ts. Explicit pages hold ordered, stable-ID modules: Heading, Text, Note, Task, Image and Video. Modules can be inserted with +, edited, removed reversibly, moved with buttons, Alt+Up/Down or drag, and transferred with a keyboard-accessible page selector or by dropping onto a page. The insertion flyout is viewport-clamped and supports arrow/Home/End, Escape, Tab and outside-click dismissal. A heading outline and Pages/Flow/reading views help navigate longer notes.

Undo/Redo snapshots cover module/page operations and coalesce typing until field blur. Ctrl/Cmd+Alt+Z performs document Undo; Shift redoes. Native textarea Ctrl+Z remains text Undo. Alt+PageUp/PageDown navigates explicit pages. Page layout is presentation, not canvas placement or filesystem ownership.

The default browser storage key is `art-equation.notebook-proof.v1`. Autosave is isolated; JSON export/import retains identities and content. Invalid saved data is not overwritten. The UI can save a separate recovery key, while export is the portable backup. Storage quota varies: on failure, edits stay in memory and the alert asks for JSON export.

Imported JSON is validated with limits of 50 pages, 1000 modules, 100000 characters per text field and 16 MiB per portable copy. Unknown active HTML fields are discarded; scripts, remote sources, SVG and blob URLs are not imported. Portable HTML escapes all text, embeds allowed raster images, disables scripts/network through CSP, and represents local media with named relink placeholders. It is suitable for browser Print; it does not promise Word pagination fidelity.

## Source safety and limits

Image selection reads a new embedded proof copy, up to 4 MiB, without writing its original. PNG, JPEG, WebP, GIF and AVIF are supported. Local MP4/WebM/Ogg videos use a session-only object URL; the saved document retains a stable media identity/name/MIME, not video bytes or unrestricted paths. After reopening, explicit file selection is required to relink. Codec support depends on the browser. Replacement and Undo never silently play a different reference under an old filename.

The sample paraphrases the supplied production-process document’s Source → Reconstruction → Reconceptualize → Production structure and questionnaire task/working-note separation. It does not reproduce the entire Word document or its formatting/media. Actual source text was inspected read-only: 213 paragraphs and 3 embedded images; the source file remains untouched.

Plain text and manual pages are deliberate proof limits. Inline rich-text styling, tables, Word import/export, automatic editor pagination, native disk media packaging, real Split integration and production recovery are future integration decisions. The proof uses responsive independent CSS and both themes, but browser accessibility samples are not native screen-reader/physical-DPI certification.

## Integration decision required

Before any production integration, approve the block/page/media contract, define document migration and backup/restore, connect source references to project asset IDs and authorized workspace paths, choose rich-text/table semantics, specify pagination/export formats and large-document budgets, and verify a real Split/native workflow. Keep the production document engine and Vello canvas lifecycle separate. Do not simply copy browser localStorage into project documents.

Tests: `node scripts/partii-notebook-model.mjs`, `node scripts/partii-notebook-ui.mjs`. Browser tests use fresh contexts, an independent namespace and synthetic local media. Reports/screenshots are under `output/playwright/partii-notebook`.

## Verified checkpoint, September 30, 2026

The current proof passed 23 pure-model checks and 50 actual-browser checks. Coverage includes all six module types, keyboard insertion and menu dismissal, same-page reorder and cross-page transfer, Undo/Redo, independent reload, sharp embedded raster images, real synthetic video playback and explicit relink, atomic JSON import/cancel, escaped HTML download/render, corrupt-save preservation and quota-failure recovery cues. The 600 px and 1040 px layouts remained within the viewport. A five-page/200-module browser fixture retained its ordered content; its 849 ms import/view/render timing is not a native or large-board performance guarantee.

Six captured renders were visually inspected, including both themes, compact layout, editor insertion menu, long Flow view and the exported HTML. Both sampled themes had zero axe violations, with 29 unresolved color-contrast checks in each sample. This is not a full accessibility certification.

The latest independent build is `output/notebook-proof-build-20260930T0810`, created with `npx vite build --config notebook-proof.vite.config.ts --outDir output/notebook-proof-build-20260930T0810`. Earlier proof build directories were preserved. The app's native build and EXE are separate release checks; this proof does not modify their document model or build entries.
