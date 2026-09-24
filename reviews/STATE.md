# Three-pass Meetily2 review

Started: 2026-09-24 Asia/Seoul. Source of truth: this GitHub-ready folder.

`$MEETING_ROOT` denotes the parent directory of this GitHub-ready checkout in the local development setup.

Permanent user constraint: **never delete** `$MEETING_ROOT/v2.0/meetily/target/debug` or its contents, including through the GitHub-ready `target` symlink. The five other approved generated paths were deleted on 2026-09-24; see `cleanup-proposal-2026-09-24.md`.

| Pass | Target | Status | Evidence |
|---|---|---|---|
| 1 | 2026-09-24 15:30–15:56 KST | completed; release blocked | `pass-01.md` |
| 2 | 2026-09-24 18:51–19:09 KST | completed; release blocked | `pass-02.md` |
| 3 | 2026-09-24 20:25–20:37 KST | completed; development candidate only | `pass-03.md` |

Release gate after pass 3: **general distribution blocked**. The 2.0.2 RC1 app on the build Mac displayed four live Japanese/Korean turns from a 26-second combined-audio playback and preserved earlier turns in a navigable timeline. Earlier same-session checks exercised system-only, microphone-only, and combined input in the prior app bundle, but microphone ASR errors occurred. The new DMG passed checksum/image/signature validation and is ad-hoc signed. Browser microphone capture in the Codex in-app browser, mixed-audio accuracy across real conditions, a 30–60 minute memory run, meeting/summary E2E in the new candidate, Developer ID signing/notarization, and clean-Mac E2E remain open. It may be published only as a clearly labeled prerelease development candidate; never infer a passed gate from the schedule.

Post-pass candidate update (2026-09-24): RC1 was superseded before publication because its app binary exposed local build-home paths. RC2 removed those paths but native combined-audio startup stalled in Core Audio; RC3 added a microphone-probe timeout but system-audio startup could still block. RC4 moves Core Audio initialization off the async worker, caps its wait, reports native errors, and refuses silent microphone-only fallback for requested live computer audio. Its source tests, build, smoke inference, checksum, image, and signature checks passed. After the Mac was unlocked, RC4 completed a native combined-audio run: four retained Japanese/Korean timeline cards appeared during the test. Quiet audio also produced an ASR hallucination, so accuracy remains unproven. RC5 exposed a window-control overlap and was not published. RC6 moves the in-app controls to the upper left and reserves sidebar and interpretation-header space. Its build, image, signature, and native layout/action checks passed. The general release gate remains blocked. See `v2.0/docs/release-2.0.2-rc.6.md`.
