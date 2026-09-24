---
name: meetily2-release-cycle
description: Run a bounded Meetily2 macOS improvement pass with code changes, tests, native and localhost E2E evidence, and a release decision. Use for this project's three-pass review and later release maintenance.
---

# Meetily2 release cycle

Work in the GitHub-ready project root containing `v2.0/meetily`, `v2.0/scripts`, and `reviews/STATE.md`. Read the state first. Complete exactly one numbered pass per invocation, then update its record. Keep the older versioned DMGs, source, and user data intact; its generated build cache may be reused for local QA.

`$MEETING_ROOT` in audit documents means the parent directory of this GitHub-ready checkout in the local development setup.

The user explicitly forbids deleting `$MEETING_ROOT/v2.0/meetily/target/debug`. Preserve that directory and its contents during every pass and cleanup, including when accessing it through the GitHub-ready tree's `v2.0/meetily/target` symlink.

Follow the local-project loop described by [chatgpt2codex](https://github.com/ezBuilder/chatgpt2codex): inspect source and rules, make a bounded patch, run checks, launch the real app/browser, capture E2E evidence, and report diff and blockers. Its connector, owner token, and tunnel are unnecessary here.

For each pass:

1. Read the previous pass, current source, `v2.0/docs/distribution-dmg.md`, and [release gates](references/release-gates.md). Pick a reproducible issue in Japanese-to-Korean interpretation, meeting recording/transcription/summary, memory stability, or setup/recovery.
2. Reproduce the affected flow before editing. Make the smallest source fix. If permission, hardware, or model state blocks this defect, record it and choose another verifiable fix. Never claim a native audio defect fixed from a source-only check.
3. Run focused regressions and relevant type/Rust/build checks. Exercise the changed flow in Meetily2 and, where relevant, `http://localhost:3118/`. Record timing, text accuracy, memory/error behavior, and screenshots or logs when available. Say `not run` or `blocked` explicitly.
4. Write `reviews/pass-0N.md` with date, trigger/expected behavior, changed paths, test commands/counts, native and localhost E2E observations, evidence paths, regressions, blockers, and next priority. Only then update `reviews/STATE.md`. Keep private audio, meeting content, credentials, and sensitive screenshots outside this GitHub-ready tree.

After pass 3, apply the release gates. Update version, notes, checksum, and DMG only for a build actually produced and verified. Distinguish an ad-hoc developer candidate from a signed/notarized distribution build. If a required gate fails, leave general distribution blocked and document remaining work. Do not push or publish without a target remote and authorization.

Scheduling is external to this repository. Do not add a daemon or repo secret to simulate the three-hour interval. The Codex heartbeat should invoke this skill for passes 2 and 3, then pause itself.
