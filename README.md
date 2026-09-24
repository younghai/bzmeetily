# Meetily2 source and review workflow

This GitHub-ready folder includes the Meetily2 macOS app and localhost service source under `v2.0/`, build scripts, three-pass review records under `reviews/`, and the Codex skill at `skills/meetily2-release-cycle/`. It was prepared from the local source on 2026-09-24. The older source and versioned DMGs remain unchanged; a shared generated app bundle was rebuilt for local QA.

The app source is based on [Zackriya-Solutions/meetily](https://github.com/Zackriya-Solutions/meetily) and includes local Meetily2 changes. The upstream MIT license and copyright notice remain in `v2.0/meetily/LICENSE.md`.

In local audit records, `$MEETING_ROOT` denotes the parent directory of this checkout, which also contains the earlier `v2.0/` and `meetily/` workspaces. It is a documentation placeholder, not a required environment variable.

The loop adapts [chatgpt2codex](https://github.com/ezBuilder/chatgpt2codex): inspect local source, edit, test, launch the app/browser, and preserve E2E evidence. No connector or tunnel is installed. Meetily source retains its [MIT license](v2.0/meetily/LICENSE.md).

See [reviews/STATE.md](reviews/STATE.md) and [v2.0/docs/distribution-dmg.md](v2.0/docs/distribution-dmg.md) for the current release state. The prior 2.0.1 DMG is a development candidate; native computer-audio and clean-Mac distribution checks remain open.

For local checks, use `pnpm test:local`, `pnpm exec tsc --noEmit`, and `pnpm build` in `v2.0/meetily/frontend`, plus focused Rust tests for native changes. From `v2.0/`, `scripts/build-dmg.sh` produces an ad-hoc candidate; `scripts/build-dmg.sh --dist` requires Developer ID signing and notarization.

Build output, models, DMGs, private audio, and credentials are ignored by Git. Before a commit, inspect `git status`, `git diff --check`, tracked files, secrets, and large generated files. Add a remote only for a repository you own or are authorized to update. The Codex scheduling configuration is local and does not travel with this clone.
