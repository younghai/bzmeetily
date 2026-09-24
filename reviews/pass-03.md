# Pass 03 — 2026-09-24, 20:25–20:37 KST

## Result and root causes

- **Timeline:** the view grouped six consecutive interpretation items into one card. A short meeting therefore appeared to have no navigable history even though its transcript array still contained earlier text. Each recognized turn now has its own timeline card, two-line Japanese/Korean preview, timestamp, first/latest navigation, and selected state. Prior captions remain visible while later translation runs.
- **Source/translation mismatch:** when Whisper revised a Japanese utterance, its old Korean translation remained alongside the new Japanese text. The same-turn Korean text now clears until the matching revision completes; completed earlier turns remain. Both native and localhost translation use at most two earlier completed JA/KO turns as bounded context. The Qwen prompt specifies plain, polite, or preserved register, uses context for consistency only, and forbids repeating context or guessing unfinished speech.
- **macOS window controls:** during screen sharing, macOS replaces the native upper-left traffic lights with its purple indicator. The previous 2.0.1 DMG was built before the app's upper-right close/minimize/full-screen fallback existed. The new 2.0.2 RC1 bundle includes that toolbar; the native controls remain enabled in the app's accessibility tree. The new DMG therefore contains the fix missing from the older installer.
- The DMG builder now refuses to overwrite a same-version image. Existing 2.0.0 and 2.0.1 images were not changed.

## Source and automated checks

- `pnpm test:local`: 92 passed, 1 skipped, 0 failed. The skipped test requires a copied existing native database; the source database was not changed for QA.
- `pnpm exec tsc --noEmit`: passed. `pnpm build` (Next.js static export) and `pnpm tauri build --bundles app`: passed as part of the candidate build.
- `cargo test --lib --quiet`: 254 passed, 4 ignored, 0 failed. Ignored tests include real hardware paths; the computer-audio hardware test passed in Pass 02 and was not rerun here.
- `v2.0/scripts/smoke-test.sh`: local server identity and readiness, Whisper health/inference, installed `qwen3.5:4b`, Japanese-to-Korean translation, and loopback binding all passed.
- `git diff --check` and `bash -n v2.0/scripts/build-dmg.sh`: passed. `pnpm lint` opens this repository's first-time interactive ESLint setup, so no lint result is claimed. Existing Rust compiler warnings did not fail the build or tests.
- Re-running `build-dmg.sh` with the same version exited immediately because the DMG already existed; the image was not overwritten.
- Direct model probe: `どう思う？` yielded informal Korean `어떻게 생각해?`; `どうお考えでしょうか。` yielded polite Korean `이 부분에 대해 어떻게 생각하시나요?`. This checks two examples only and is not a translation-quality benchmark.

## Actual app and localhost E2E

- Launched the freshly built `Meetily2.app` on the build Mac. The mode chooser did not start capture. Opening interpretation showed Japanese-left/Korean-right panes, source selection, and a separate Start button.
- Played a local 26.27-second Japanese fixture through Mac speakers with the app's combined computer-audio-plus-microphone input. Before stopping, the timeline increased from one to four cards. Earlier Japanese and Korean text remained visible while later chunks translated. `처음 대화` selected the first card; selecting the third card moved its selected state; Stop retained all four turns. The expected fixture discussed a test, improving a customer support page, organizing questions, and an undecided owner/deadline. The displayed third Japanese and Korean turns both preserved the negative deadline meaning in this run.
- The purple macOS screen-sharing indicator visibly covered the native traffic-light area. The new app's upper-right three-button toolbar was visible on the mode chooser and interpretation view. The same functions were exposed as enabled accessibility buttons. The older 2.0.1 DMG did not contain the toolbar asset; the new mounted DMG did.
- The running app served `http://127.0.0.1:3118/`: the browser mode chooser and live interpretation screen loaded. In the Codex in-app browser, microphone Start remained at `오디오 연결 중` without an audio track; Stop returned it to idle. Therefore browser audio capture was **not** verified end-to-end. The localhost inference smoke test did pass.
- Earlier in this review session, the prior app bundle (same native capture code) produced Japanese and Korean captions before Stop from computer-audio-only, microphone-only, and combined inputs on this Mac. The microphone-only run misheard one negation and hallucinated digits in quiet audio. This remains an ASR accuracy risk, despite the translation alignment correction.

## Image and memory evidence

- Built the separate `v2.0/release/Meetily2_2.0.2-rc.1_aarch64.dmg` (99,579,206 bytes). SHA-256: `4d90409e0755c86e8d34138a274e137e78bb9d7ba2885d1286d6eb9f92c1f8cc`; `.sha256` check and `hdiutil verify` passed. Mounted the DMG read-only; its app version was `2.0.2-rc.1`, it contained the new timeline UI asset and Applications link, then it was detached. `codesign --verify --strict` passed for the built app, but its signature is ad-hoc (`TeamIdentifier` unset), not Developer ID.
- A short idle/live/smoke window showed app resident memory about 112 MB falling to 97 MB over four minutes, the local server about 30 MB to 28 MB, and Whisper about 1.71 GB. This is only a short process RSS spot check; it excludes GPU/model allocations and does not establish 30–60 minute stability.
- No personal audio, models, databases, secrets, absolute user paths, or build products are included in Git. The local test WAV stayed outside the repository. The protected shared `target/debug` directory and contents were not deleted.

## Release gate

General release: **blocked**. There is no valid Developer ID signing identity on this Mac, and notarization, clean second-Mac install/permissions/model download, browser microphone capture, longer memory run, mixed-input accuracy across real conditions, and meeting recording/summary in the new candidate remain unverified. Publish only a clearly labeled **GitHub prerelease development candidate** with these limits; do not mark it as a stable/latest release.

## Post-pass packaging and stability update — 2026-09-24

RC1 was not published after inspection found embedded build-home paths. RC2 used Rust/C/C++ path remapping and a pre-package privacy guard; no build-home path appeared in the app or mounted DMG. Native RC2/RC3 runs then intermittently stalled during Core Audio microphone probing or aggregate-device IO-proc creation. A macOS process sample located the blocking Core Audio calls. RC3 bounded the microphone probe, but a system-only start still remained at “preparing.” RC4 moves Core Audio stream creation to a blocking worker, caps the caller wait at 15 seconds, prevents duplicate stalled initializations, surfaces returned Tauri string errors, and requires a requested computer-audio source for live interpretation instead of accepting microphone-only fallback. This is a startup stability fix, not proof that Core Audio captures reliably on all Macs.

RC4: 93 frontend local tests passed, 1 skipped; TypeScript and Rust release check passed; 253 Rust tests passed, 4 ignored, with 2 Core Audio hardware-query tests filtered after the unfiltered run hung over 60 seconds on this Mac; Tauri/Next release build passed; local inference smoke test passed; DMG checksum, image, and ad-hoc signature checks passed. RC4 DMG SHA-256: `a2c8c6feeffed59baf6be60acade1ec71ca356d266071c3f864807fcff8c6030`. The build Mac was locked at the attempted RC4 UI check, so native audio E2E is **not yet proven** for RC4. No general distribution approval follows from this package.

## Later RC4 audio check and RC6 window-control check — 2026-09-24

After the Mac was unlocked, the RC4 native app started combined computer-audio-plus-microphone interpretation in about 16 seconds. During roughly 40 seconds of local playback/ambient audio, the live timeline showed four Japanese/Korean cards and kept earlier captions accessible; Stop returned the view to idle. Quiet input also produced a clearly incorrect ASR phrase, so this run proves the UI/audio path operated on the build Mac, not transcription accuracy. The earlier locked-Mac statement above records the state at the first attempt and is superseded for RC4 by this later check.

The older RC4 fallback controls were on the upper right, away from the location the user expected. A local RC5 experiment moved them left but visibly covered the collapsed sidebar logo, expanded sidebar header/search, and interpretation title; RC5 was not published. RC6 adds space under the toolbar in both sidebar states and before the interpretation title. The freshly built RC6 app was opened on the build Mac: the left close/minimize/full-screen toolbar was visible below the native title bar, its labels were present in the accessibility tree, and the mode chooser, expanded sidebar, normal interpretation window, and full-screen interpretation layout had no observed overlap. The custom full-screen action entered and exited full screen, minimize set the macOS `AXMinimized` state to true, and close hid the main window to the tray as designed. The native traffic lights reappeared when the purple screen-sharing overlay was absent.

RC6 Next.js production build and Tauri release bundle passed. `hdiutil verify`, SHA-256 check, and `codesign --verify --deep --strict` passed for the new DMG/app; its SHA-256 is `0a54aea9fb5a3cfaeeabdcee8cd6300839bd9bcfa189e1e5dafeb0f0b8274627`. No RC6 audio-accuracy or long-duration memory claim is added. General distribution remains blocked by the gates above.
