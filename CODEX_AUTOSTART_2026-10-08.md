# Embedded Codex startup

The owner's requirement is automatic Codex availability in the new application,
with current project information and troubleshooting evidence.

- The native loopback inspection service starts in Tauri setup.
- The embedded official Codex app-server connects after its frontend event listener
  is registered, independently of whether Settings is open. Only the main window
  launches it; Mini Bridge windows do not spawn duplicate assistants.
- Startup is enabled by default. Settings > Codex has a persisted opt-out. Explicit
  Disconnect disables automatic startup. Failed initialization has at most three
  attempts, separated by 5 and 15 seconds, then displays an actionable error.
- The live adapter reads the latest controller state on every tool request: project
  metadata, board settings, objects, connectors, documents, asset records, UI and
  retained telemetry. Unsaved edits are available. Stable IDs and revisions prevent
  silently concatenating data from different revisions. Large records are paginated.
- Native tools expose retained logs and this exact build's embedded architecture,
  source manifest and allowlisted source files. Assets retain their disk references;
  this is not an unconditional upload of every media file.
- Connection startup does not create a model turn. Model requests run when asked,
  with live inspection tools. Account sign-in remains required and visible.

Official lifecycle reference: https://developers.openai.com/codex/app-server/

Verification: `output/native-codex-autostart-review.mjs` checks status without
calling Connect, then sends an embedded audit question exercising the live tools.
Its JSON report records actual results. Build and UI smoke are separate from the
deferred graph-board/native 4K acceptance gate.

## Verified on the rebuilt native application

`output/native-codex-autostart-review.json`: PASS, six checks. Status was read
before opening Settings and without invoking Connect. Existing ChatGPT sign-in
was recognized, seven models were listed, and the embedded assistant completed
the requested live audit. It read all eight model/UI/telemetry domains, native log
listing and a log sample, architecture overview/files and `src/model/project.ts`.
Its reported source identity matches the directly inspected live bridge identity:
`98d05523a05424d6413f11796d7ef2d6e7a0d5aca15218dbc1eb1f3af6d6fe01`.

Native executable: `output/builds/2026-10-08/Art-Equation-2.5-P1.7-Codex.exe`.
Process and SHA-256 receipt: `output/native-codex-autostart-build-receipt.json`.
Current owned process: 32396. The earlier owned app was closed through its normal
window-close path before launch. The other production app was preserved.

`npm run build:v2` passed, including inspection and P1.7 model tests. Four fresh UI
reviews passed at `output/playwright/ui-four-passes-1791520340198/review.json`.
These are startup/inspection/UI evidence, not graph-board or 4K acceptance.
