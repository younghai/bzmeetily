# Mode-first Japanese to Korean interpretation

## Acceptance
- Opening localhost or the modified native Home shows a choice: 실시간 통역 / 회의 녹음.
- Choosing interpretation opens an idle, side-by-side Japanese transcription / Korean translation view. Only an explicit 통역 시작 action opens audio capture.
- The view shows 일본어 음성 → 일본어 전사 → 한국어 통역 and provides start/stop controls.
- Japanese source is displayed before its Korean translation. Stop releases audio before final processing, and completed captions remain reviewable.
- Both browser and native live interpretation keep only temporary audio/text in memory; no recording, meeting, transcript or recovery files are created.
- Existing recording/import/history workflows remain available after selecting 회의 녹음.

## Steps
1. completed: add a mode-first UI and explicit start/stop controls.
2. completed: correct native streaming output and separate live capture from all recording/file/DB persistence; reduce browser live chunk latency.
3. completed: targeted regression tests, full typecheck/build, rebuild native and refresh localhost.
4. completed: apply the requested full-window continuous conversation view, repair reviewed live lifecycle boundaries, then rebuild and repeat active/stop/no-persistence and final visual review.
5. completed: update guide and report measured behavior and remaining platform limits.

## Ownership
Parent: browser capture timing/shared UI, integration, builds, runtime QA, documentation.
mode_native: native live control/hook, partial-chunk translation, no IndexedDB path.
native_live_backend: native in-memory capture mode, input source selection, no saver/file persistence.

## Clarification
User explicitly rejected native recording-backed interpretation: live speech recognition and translation must update before Stop. Earlier acceptance allowing native saved recordings is superseded.
