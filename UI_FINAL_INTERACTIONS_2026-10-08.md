# UI interaction completion — 2026-10-08

Preserved: aquarium, Navy waves/Dark crescent/Light sun, canonical engine, native Settings/Saving/Codex.

Changes:
- Missing Rainee Transforms project/questionnaire is seeded only when absent, without overwriting another project.
- Trash chrome and object/context menus follow semantic theme tokens; automatic trash previews have transparent fallback rather than a fixed dark backdrop.
- Color & Layers is floating-only, draggable, keyboard-movable and hideable. Docking was removed at the owner's request.
- Canvas export detects selection/frame. Linked media offers original-file export, copying the project-folder bytes without converting video to a screenshot. Raster export remains available separately.
- New Frames are bounded grouping/export regions. Member edits are constrained in both the canvas and canonical inspector command path. Oversized changes are refused; new source assets are never distorted to fit. Explicit ungrouping removes the boundary. Existing historical frames retain authored layout until recreated as bounded frames.
- Separate Drawing Canvas Object accepts shapes/text, has an artwork background and keeps members within bounds. Drawing tools remain available on the surrounding board.
- Frame raster export uses the exact rectangle, omits frame chrome/title, offers 4x PNG/JPEG and has an 8192-pixel longest-edge cap.
- Popover ordering was repaired after real interaction testing found the floating studio obstructing export/tool menus.

Reference: Miro/RealtimeBoard frames organize and move content, and export selected frame regions. Miro does not always enforce strict containment; strict containment is this app owner's explicit policy.
https://help.miro.com/hc/en-us/articles/360018261813-Frames
https://help.miro.com/hc/en-us/articles/360017572754-How-to-export-your-board

Verification separates canonical containment/export tests, four browser UI passes and native startup/Settings/bridge smoke checks. Full five-export/drawing stress-board acceptance remains deferred until Node Column replacement. This is an alpha UI completion, not Retina-performance qualification.

Final evidence:
- Canonical bounded-frame/export checks: 10/10 (`scripts/bounded-frames-tests.mjs`).
- Four browser passes: 301/301; three themes, three viewport widths, Document/Split/Canvas modes, actual text/Frame/Canvas interactions and 4x PNG file dimensions. Report: `output/playwright/ui-four-passes-1791515027678/review.json`. No serious/critical accessibility findings in the tested states. Filmstrip contrast and rapid keyboard movement were fixed during these passes.
- Native Settings/renderer/Codex smoke: 12/12 (`output/native-ui-smoke.json`).
- Native Rainee questionnaire, recoverable Canvas deletion, and restoration of its original ID: 3/3 (`output/native-interaction-review.json`). Browser preview has no native disk-trash service; disk recovery was tested in the native app.
- Original MP4 source fetch plus real native writer: 5,859,558 bytes, source/export SHA-256 both `8dad99b5215848847ea1434d2ff384b4621d5910dfd87406070fa4fe04e63a52` (`output/native-original-bytes-review.json`). Destination was supplied directly; the Windows Save picker was not automated. Earlier picker harness attempts are diagnostic failures, not passing evidence.
- Final native build successful; live PID 108624, status and architecture requests both accepted. Embedded identity: `a779540b9f4c5fae8cbbceb741cb3be6244de921fc78574f714d3b4387cf5504` (`output/native-final-bridge-receipt.json`).
- EXE: `output/builds/2026-10-08/Art-Equation-2.5-UI-final.exe`; SHA-256 `543367e329cc6fc6eb947f4ebf3e931de71fab7775c105a1c1a739e4355d82c6`. Launcher retains the separate owned workspace/WebView profile.

UI phase accepted within this scope. Graph replacement and full exported-board/drawing performance acceptance remain outstanding.

Owner correction, 2026-10-08: the submitted board is NOT visually accepted and does not match the RealtimeBoard reference. The earlier completion statement must not be used as board-fidelity or Type-tool acceptance. Interaction receipts remain scoped smoke evidence. Notes/Type separation, guide/snapping upgrades, layout repair and graph replacement are OPEN; see `P1_7_TYPE_GRAPH_LAYOUT_SCOPE_2026-10-08.md`.
