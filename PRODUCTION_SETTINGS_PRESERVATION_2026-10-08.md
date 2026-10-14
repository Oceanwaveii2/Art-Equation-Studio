# Production Settings preservation — October 8, 2026

The owner explicitly requires the newer production Settings system and relocated Codex controls to survive the prototype UI integration. The isolated P1 browser prototype's older Settings specimen is not the application settings backend.

Verified implementation being carried forward from the latest production source:

- `src/ui/SettingsDialog.tsx`: centered Settings dialog with section navigation, keyboard focus handling and theme-aware controls.
- Production App mounts six sections: Appearance; Canvas and input; Workspace; Saving and recovery; Rendering; Codex.
- Appearance: Navy/Dark/Light and flat/glass strength. Document paper remains separate.
- Canvas and input: grid visibility, spacing, opacity, theme defaults and snapping.
- Workspace: minimal canvas navigation.
- Saving and recovery: continuous edit saving with recovery snapshots or interval-only saving; 5/10/30/custom minute choices; pending state, explicit flush, project/board/recovery timestamps.
- Rendering: wgpu with Vello GPU and Vello CPU fallback.
- Codex: the existing native Codex bridge panel and live inspection/architecture/telemetry access.

Integration rule: retain the exact production SettingsDialog, SaveSettingsPanel, CodexBridgePanel and their existing controller callbacks. The prototype replaces surrounding workspace chrome. It must not substitute its browser-only Settings dialog, localStorage scene, fake save actions or older Codex connection flow.

Evidence: production `src/App.tsx` SettingsDialog section definitions around line 3335; `src/ui/SettingsDialog.tsx`; `src/ui/SaveSettingsPanel.tsx`; the earlier P1.5 save contract at the 9164 checkout's `current/2026-10/docs/P1_5_SAVE_CONTRACT_2_5_2026-10-08.md`; native lifecycle evidence at `current/2026-10/output/playwright/p15-2.5-native/native-lifecycle.json`.

This note records the preservation contract. The new shell integration is still being implemented and has not qualified for release or the native Retina performance gate.
