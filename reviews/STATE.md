# Three-pass Meetily2 review

Started: 2026-09-24 Asia/Seoul. Source of truth: this GitHub-ready folder.

`$MEETING_ROOT` denotes the parent directory of this GitHub-ready checkout in the local development setup.

Permanent user constraint: **never delete** `$MEETING_ROOT/v2.0/meetily/target/debug` or its contents, including through the GitHub-ready `target` symlink. The five other approved generated paths were deleted on 2026-09-24; see `cleanup-proposal-2026-09-24.md`.

| Pass | Target | Status | Evidence |
|---|---|---|---|
| 1 | 2026-09-24 15:30–15:56 KST | completed; release blocked | `pass-01.md` |
| 2 | 2026-09-24 about 18:50 KST | pending | `pass-02.md` |
| 3 | 2026-09-24 about 21:50 KST | pending | `pass-03.md` |

After pass 3, update the release decision from actual test and distribution evidence. The 2.0.1 ad-hoc candidate in the older tree is not a general release. Known blockers: packaged native computer-audio capture returned zero chunks; mixed audio accuracy, signing/notarization, and clean-Mac E2E are unverified. Never convert `pending` to `passed` by schedule alone.
