# Meetily2 2.0.2 RC6 — experimental development preview

**Status:** Apple Silicon macOS test build. This DMG is ad-hoc signed; it is not Developer ID signed or notarized and has not passed a clean second-Mac installation check. Do not use it as a generally approved installer or as the sole capture method for an important meeting.

DMG: `Meetily2_2.0.2-rc.6_aarch64.dmg`

SHA-256: `0a54aea9fb5a3cfaeeabdcee8cd6300839bd9bcfa189e1e5dafeb0f0b8274627`

## Changes

- The native app provides close, minimize, and full-screen controls at the upper left, below the macOS title bar. They remain available when the purple screen-sharing indicator covers the native traffic lights. The sidebar and live-interpretation header reserve space so these controls do not cover their content.
- Live Japanese-to-Korean interpretation retains one timeline card per recognized turn, Japanese/Korean previews, first/latest navigation, and side-by-side captions while later speech is processed.
- Translation receives at most two preceding completed Japanese/Korean turns as context. Revised Japanese text clears its outdated Korean translation until the matching revision arrives.
- Core Audio startup has bounded waits and reports failures. A requested computer-audio source does not silently fall back to microphone-only interpretation.
- The DMG builder refuses to overwrite an existing image and scans the app bundle for local build-home paths before packaging.

## Verification and limits

- RC6's Next.js production build, Tauri release bundle, DMG SHA-256/image checks, and ad-hoc code-signature verification passed. The native app was opened on the build Mac: the controls did not overlap the mode chooser, expanded sidebar, or live-interpretation title. Full-screen entry/exit, minimization, and close-to-tray actions were exercised.
- The RC4 native app completed a combined computer-audio-plus-microphone run after the Mac was unlocked. Four Japanese/Korean timeline cards remained available. A quiet segment also caused an ASR hallucination. RC6 carries that audio code, but audio accuracy and long-session stability were not retested in RC6.
- Frontend local tests in the RC4 candidate: 93 passed, 1 skipped. Rust unit tests: 253 passed, 4 ignored; 2 Core Audio hardware-query tests were filtered after an unfiltered run hung on this Mac. TypeScript, Rust release check, frontend/Tauri build, and local Whisper/Ollama smoke inference passed at that candidate. RC6 changes only the window layout and version metadata.
- Browser live microphone capture remained unverified in the Codex in-app browser. Mixed-input accuracy across real conditions, meeting recording and summary in this candidate, 30–60 minute memory stability, first-run model download, clean-Mac permissions, Developer ID signing, and notarization remain release gates. See [interpretation quality](interpretation-quality.md) and [Pass 03](../../reviews/pass-03.md).

Models, meeting recordings, personal audio, databases, and secrets are not included in these release assets. The `.sha256` file accompanies the DMG. RC5 was a local layout experiment and was not published.
