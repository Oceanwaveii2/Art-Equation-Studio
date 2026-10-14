# Approved UI reference — October 8, 2026

The owner's latest clarification identifies http://127.0.0.1:5276/ as the UI to use. Verify the actual served page and its source before comparing screenshots. Earlier screenshots with the production sidebar are historical evidence, not proof of current visual fidelity.

The preview is served from this integration checkout. The presentation boundary is src/ui/Prototype25Shell.tsx and its scoped CSS; the production controller supplies canonical command-bound slots from src/App.tsx. Document tabs, the asset shelf and the floating studio have their own UI modules.

Preserve the newer production SettingsDialog, Saving and recovery controls, and native Codex bridge. See PRODUCTION_SETTINGS_PRESERVATION_2026-10-08.md.

Inspection discipline:

- Identify the runtime, workspace and embedded source-manifest identity before interpreting bridge results.
- The connected native production app and the browser preview are separate targets. Production telemetry does not certify the browser preview or a rebuilt native candidate.
- Compare a fresh screenshot of the approved page at the same viewport, theme, mode and panel state. An architecture/source hash proves source identity, not visual fidelity.
- Record remaining visual/workflow issues and the exact candidate tested. Compilation, bounded telemetry and UI smoke tests do not qualify native Retina performance or release acceptance.

Verified in this session: the currently connected native bridge reports project p1-v2-studies, 33 boards, 131 assets, wgpu / Vello GPU and Vello CPU, and embedded source identity fd694330b92088819d8ab370360fabcf0b9687a81b48568f1a861b2d8fdd04a8. This is the existing native production runtime, not the new browser preview at port 5276. Recheck those values after attaching the integration executable.
