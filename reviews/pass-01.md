# Pass 01 — 2026-09-24, 15:30–15:56 KST

## Trigger and result

- The prior 2.0.1 DMG release note says native computer-audio capture delivered zero chunks and mixed input produced inaccurate text. Those defects remain open.
- A user screenshot showed a purple screen-sharing indicator where macOS normally displays close, minimize, and full-screen buttons. Tauri had `decorations: true`; accessibility still exposed the native buttons. Ordinary traffic lights returned after app restart. macOS replaced them during window sharing.
- Added a compact native-only toolbar with close, minimize, and full-screen actions. It appears on the mode chooser and interpretation dialog without covering the dialog's close action.
- The DMG build script previously overwrote versioned release notes with generic copy. It now preserves existing reviewed notes and creates a minimal mode-labeled note only when none exists.

## Source changed

`v2.0/meetily/frontend/src/components/runtime/MacWindowControls.tsx`, `v2.0/meetily/frontend/src/app/layout.tsx`, `v2.0/meetily/frontend/src-tauri/tauri.conf.json`, `v2.0/scripts/build-dmg.sh`, and `v2.0/meetily/DESIGN.md`.

## Automated checks

- `bash -n v2.0/scripts/build-dmg.sh`: passed.
- Release-note fixture: generated an ad-hoc warning for a new version and preserved a pre-existing note on a second run.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm test:local`: 90 passed, 1 skipped, 0 failed.
- `pnpm build`: passed.
- `pnpm tauri build --bundles app`: passed. The app is ad-hoc signed; Rust emitted existing unused-code warnings, no errors.
- Codex skill validator: passed.

## E2E and limits

- Before the patch, the packaged 2.0.1 app showed the purple macOS indicator in place of traffic lights. Its mode chooser was visible. The localhost status API returned HTTP 200 and reported Whisper `large-v3-turbo` and Ollama `qwen3.5:4b` ready. The browser's localhost mode choice and left/right interpretation panes were visibly opened.
- In the rebuilt app, mode chooser and Japanese-left/Korean-right dialog both visibly showed the toolbar. Its full-screen action entered full screen and returned to a window. Native traffic lights were visible again after restart. Minimize was clicked, but the UI tool reactivated the window, so minimized state was not independently measured. Close was also clicked; the app remained running as designed for close-to-tray, but the UI tool reactivated its window, so the hidden state was not independently measured.
- No fresh Japanese audio capture, sustained memory run, or clean-other-Mac test occurred in this pass. No screenshot artifact is stored in this public folder. Earlier native audio failures remain release blockers.
- Local app bundle: `$MEETING_ROOT/meetily2-github/v2.0/meetily/target/release/bundle/macos/Meetily2.app` (shared target cache). The older `v2.0/release/Meetily2_2.0.1_aarch64.dmg` was **not** rebuilt or changed.

## Release decision and next pass

General distribution: **blocked**. Pass 02 should diagnose the native computer-audio zero-chunk path with a known Japanese sample, then check mixed-audio accuracy and sustained queue/memory behavior. Developer ID notarization and clean-Mac checks remain necessary before a public release.
