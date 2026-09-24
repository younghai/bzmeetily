# Meetily2 release gates

Read `v2.0/docs/distribution-dmg.md` and `v2.0/docs/clean-mac-checklist.md` for project checks.

- App starts at a mode choice. Live interpretation shows Japanese on the left, Korean on the right, with prior timeline content retained; it must not start meeting recording.
- Test computer audio alone, microphone alone, and both together with known Japanese speech. Measure first-result latency and check missing, duplicated, or invented text.
- Test stop/restart, recording/transcription/summary, and a sustained session for memory, queue growth, crashes, and shutdown. Record duration and measurements. Test native app and localhost separately; an API response is not proof of native capture.
- The existing 2.0.1 ad-hoc DMG is a development candidate. Prior packaged QA had zero computer-audio chunks and inaccurate mixed input. Keep this blocker until a fresh native test produces correct Japanese transcription and Korean translation.
- General distribution additionally needs Developer ID signing, Apple notarization, checksum, and install/model/permissions/interpretation/relaunch checks on a clean other Apple Silicon Mac. If any gate is unavailable, a new DMG can be labeled a development candidate only.
- Keep raw audio, models, credentials, private logs, and DMGs out of the public source tree. Never overwrite an existing release artifact without verifying its version and origin.
