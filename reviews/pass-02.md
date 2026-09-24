# Pass 02 — 2026-09-24, 18:51–19:09 KST

## Trigger and result

- The previous packaged app reported zero processed chunks from computer audio during a 21.5-second Japanese playback, while direct Whisper inference worked. The root cause in the packaged app is **not resolved**.
- A manual macOS Core Audio test received at least 48,000 samples. A new ignored hardware test exercised the complete Rust `RecordingManager` → Core Audio stream → mixer → live PCM channel with playback; five consecutive 600 ms windows arrived and contained non-zero audio. These tests run as a test binary and do not establish the app bundle's capture permission or webview behavior.
- The mixer had an unsynchronized `static mut` diagnostic counter shared across sessions. It now owns a wrapping counter per ring buffer, removing a data race without changing audio samples or timing.
- Three existing Rust tests expected outdated behavior: a real MacBook microphone was expected to be unknown even when Core Audio identifies it as built-in, and two failed-download tests expected partial model files to be deleted although the implementation intentionally retains them for HTTP Range resume. Updated the tests to reflect the existing behavior; production download code was not changed.

## Source changed

- `v2.0/meetily/frontend/src-tauri/src/audio/pipeline.rs`: per-buffer diagnostic count.
- `v2.0/meetily/frontend/src-tauri/src/audio/recording_manager.rs`: ignored, opt-in hardware path test, including a non-silence assertion. It requires actual system audio playback and macOS Audio Capture permission.
- `v2.0/meetily/frontend/src-tauri/src/audio/device_detection.rs` and `v2.0/meetily/frontend/src-tauri/src/whisper_engine/whisper_engine.rs`: stale test expectations corrected.

## Verification

- `cargo test --lib system_audio_reaches_live_pcm_mixer -- --ignored --nocapture` with a local 26.27-second Japanese WAV played through the Mac: 1 passed, 5 live PCM windows with non-zero audio. The underlying Core Audio one-second capture test also passed. The WAV stayed outside this public repository.
- `cargo test --lib audio::pipeline::tests`: 3 passed.
- `cargo test --lib --quiet`: 254 passed, 4 ignored, 0 failed. Before correcting stale assertions it had 251 passed and 3 failed; each failure also reproduced alone.
- `pnpm test:local`: 90 passed, 1 skipped, 0 failed. `pnpm exec tsc --noEmit`: passed.
- `pnpm tauri build --bundles app`: passed after `pnpm build`. First attempt failed because a shared **release** cache entry contained an absolute path to an older checkout. `cargo clean --release -p tauri` removed only 100.8 MiB of Tauri release cache, then the build passed. The protected `target/debug` directory and its contents were not cleaned.
- `git diff --check`: passed. Workspace-wide `cargo fmt --all -- --check` reports widespread pre-existing formatting differences, including untouched files; no blanket formatting was applied. The editor LSP daemon timed out; compilation and tests passed.

## E2E observations and limits

- The localhost API initially reported Whisper unavailable and Ollama `qwen3.5:4b` ready. Starting the bundled Whisper server against the already-installed model made `/health` and `/api/local/status` ready. A direct `/api/local/transcribe` upload of the 26.27-second WAV returned five Japanese segments in 0.52 s; `/api/local/translate` returned Korean text in 3.89 s. The temporary Whisper server was stopped afterward. This is **file/API inference**, not a real-time app latency or accuracy measurement.
- The Mac was locked and the UI automation surface could not open Meetily2, despite the user being asked to unlock it. Native source selection, system-only live transcription, microphone+system mixing accuracy, timeline, meeting recording/summary, and visible error handling were therefore **not run** in the rebuilt app. The earlier packaged-app zero-chunk failure remains a release blocker.
- No sustained capture or memory profile was run. The per-session counter removes a specific data race; it does not prove total memory stability. No screenshots or private audio were placed in this repository.
- A newly built ad-hoc `Meetily2.app` exists under the shared `v2.0/meetily/target/release/bundle/macos` build cache. No DMG was rebuilt or overwritten. Developer ID signing, notarization, and a clean-Mac test remain open.

## Release decision and next pass

General distribution: **blocked**. Pass 03 must repeat the system-only and mixed Japanese-to-Korean flow in the actual app after the Mac is unlocked, record transcript/translation quality and latency, inspect sustained memory, and evaluate signing/notarization plus clean-Mac gates. If those checks cannot be completed, keep only a clearly labeled developer candidate.
