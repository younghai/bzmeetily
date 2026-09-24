# Localhost and Japanese-to-Korean interpretation

Status: implementation and verification completed, with the explicit runtime limitations recorded below and in the local usage guide.

## Scope

Run Meetily's core meeting workflow in a localhost browser: microphone capture, optional shared-tab audio, audio-file import, persistent meetings/transcripts, local summaries, export, and Japanese-to-Korean live interpretation with optional local Korean speech output. Retain the existing native Tauri meeting workflow and add interpretation to its live screen. The final user steering requires a dedicated dialog with Japanese in the left pane and Korean in the right pane in both runtimes; this is implemented and passed final rendered verification in both runtimes.

## Implementation sequence

1. Define browser/server schemas, shared DB writes and lifecycle boundaries. Add security and persistence regression tests before the implementation. [completed]
2. Implement a loopback Bun server using existing runtime/dependencies, resident whisper-server, installed Qwen through Ollama, shared Meetily SQLite and additive interpretation storage. [completed]
3. Implement browser PCM capture with bounded ordered queues, silence handling, final flush, stop/cancel/error cleanup, and the web meeting workspace. [completed]
4. Add runtime shell selection and native live interpretation, keeping original desktop capture/providers. Build web and desktop artifacts; add local launchers. [completed]
5. Run targeted tests, typecheck/build, browser workflows and Japanese audio-to-Korean translation QA; independent code and visual review; write exact limitations. Replace macOS device-enumeration probes with existing CoreAudio metadata APIs. Verify the final native app's startup, new recording, live dual captions and successful save. [completed]

## Verification limits

- Browser microphone/file-import/summary and native live captions/stop/save were actually exercised. 51 local tests and one focused Rust test passed; web typecheck/build and macOS bundling passed. Two independent reviewers passed all ten final captures.
- Browser screen/tab audio was not independently fixture-tested, and completed Markdown download was not established.
- A separate transient CoreAudio microphone-open stall recovered without an audio service reset; a subsequent new recording started normally. The enumeration fix does not claim to eliminate every device-open delay.
- Native translated captions remain scoped to the active screen. ASR errors and processing latency remain practical limits.

## Boundaries

- No external AI API, cloud deployment, paid service, commit, push, or destructive migration.
- Reuse current Meetily database schema for meetings/transcripts/summaries; preserve existing content. Keep translation metadata in an additive sidecar database and take a SQLite backup before implementation touches the current DB.
- Loopback listening only, validate Host/Origin, no wildcard CORS, strict payload/size bounds; never accept arbitrary filesystem paths from the browser.
- Browser microphone and shared-tab audio use browser consent. If no audio track is returned, show an actionable error; never imply system audio was captured.
- Keep original Japanese text and Korean translation visibly distinct. Interpretation has processing latency and is not sample-synchronous speech translation.
- Native installed v0.4.1 is preserved until a separately built local artifact passes verification.
