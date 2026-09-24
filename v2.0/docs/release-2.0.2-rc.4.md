# Meetily2 2.0.2 RC4 — experimental development preview

**Status:** Apple Silicon macOS test build. This DMG is ad-hoc signed; it is not Developer ID signed or notarized and has not passed a clean second-Mac installation check. Do not use it as a generally approved installer or as the sole capture method for an important meeting.

DMG: `Meetily2_2.0.2-rc.4_aarch64.dmg`

SHA-256: `a2c8c6feeffed59baf6be60acade1ec71ca356d266071c3f864807fcff8c6030`

## Changes

- Live Japanese-to-Korean interpretation has one timeline card per recognized turn, a Japanese/Korean preview, first/latest navigation, and side-by-side captions that retain earlier turns while later speech is processed.
- Translation receives at most two preceding completed Japanese/Korean turns as context. It aims to preserve the speaker's formality and does not repeat earlier turns or invent the end of unfinished speech. A revised Japanese turn clears its outdated Korean translation until the matching revision arrives.
- The macOS app includes upper-right close, minimize, and full-screen controls for sessions where macOS covers the native upper-left controls with its screen-sharing indicator.
- Core Audio microphone and computer-audio initialization now has bounded waits. Computer-audio startup runs off the async UI worker; a failed requested computer-audio source is reported rather than silently falling back to microphone-only interpretation. Native string errors are shown in the interpretation view.
- The DMG builder refuses to overwrite an existing image and checks the app bundle for local build-home paths before packaging it.

## Verification and limits

- Frontend local tests: 93 passed, 1 skipped. TypeScript, frontend/Tauri release build, Rust release check, 253 Rust tests passed (4 ignored; 2 Core Audio hardware queries filtered after hanging on this Mac), local Whisper/Ollama inference smoke test, DMG SHA-256 and image verification, and ad-hoc code-signature verification passed.
- A prior RC1 app build on the build Mac displayed four live turns during 26 seconds of Japanese audio, with navigable earlier JA/KO captions. The timeline and context behavior is present in RC4 source. Later RC3 testing exposed intermittent Core Audio startup hangs; RC4 adds deadlines and an explicit error path. Live native audio startup in RC4 still requires a fresh interactive check because the build Mac was locked during the final test attempt. Therefore this candidate has **not** passed end-to-end audio acceptance.
- The localhost status and inference service passed smoke checks. Browser live microphone capture remained unverified in the Codex in-app browser. A short model probe and one 26-second fixture are not an accuracy benchmark; Japanese ASR can mishear negation or produce text from quiet microphone input.
- Real mixed-audio accuracy, meeting-recording/summary in this candidate, 30–60 minute memory stability, first-run model download, clean-Mac permissions, Developer ID signing, and notarization remain release gates. See [interpretation quality](interpretation-quality.md) and [Pass 03](../../reviews/pass-03.md).

Models, meeting recordings, personal audio, databases, and secrets are not included in this release asset. The `.sha256` file accompanies the DMG.
