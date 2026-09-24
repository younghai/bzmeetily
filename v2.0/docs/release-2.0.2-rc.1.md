# Meetily2 2.0.2 RC1 — development preview

**Status:** Apple Silicon macOS development candidate. This DMG is ad-hoc signed, not Developer ID signed or notarized. It has not passed installation and permission checks on a clean second Mac, so it is not approved for general distribution.

DMG: `Meetily2_2.0.2-rc.1_aarch64.dmg`

SHA-256: `4d90409e0755c86e8d34138a274e137e78bb9d7ba2885d1286d6eb9f92c1f8cc`

## Changes

- Live interpretation keeps a separate timeline card for each recognized Japanese turn, with Japanese and Korean previews and controls to jump to the first or latest conversation. Earlier captions remain visible while new speech is processed.
- Revising a Japanese turn immediately clears its outdated Korean translation; completed earlier turns stay visible. Translation now receives at most the two preceding completed turns as context and instructions to preserve the speaker's formality without repeating context or guessing unfinished speech.
- The macOS app exposes close, minimize, and full-screen controls at the upper right of the window. This keeps them usable when macOS replaces the native upper-left controls with its purple screen-sharing indicator.
- The build script refuses to overwrite a DMG with the same version.

## Verified on the build Mac

- The packaged app displayed four timeline cards during a 26-second Japanese playback, with Korean translations appearing before interpretation stopped. Selecting the first and a middle card marked the corresponding entry; stopping kept the captions visible.
- The same app had previously produced Japanese and Korean captions from computer audio, microphone, and their combined input on this Mac. This is a smoke check, not an accuracy benchmark for different devices or noisy meetings.
- Local tests, TypeScript checking, frontend build, app build, local service smoke test, DMG checksum, image validation, and app code-signature validation passed. Detailed counts and limits are in [Pass 03](../../reviews/pass-03.md).

## Known limits and release gate

- Japanese ASR can still mishear negation or hallucinate speech in quiet microphone input. Korean text now stays aligned with the displayed Japanese revision, but it cannot correct an ASR error in the source.
- Browser live microphone capture stayed at “Connecting audio” in the Codex in-app browser; browser audio end-to-end remains unverified. The localhost UI and inference services loaded and responded.
- Mixed-audio accuracy, 30–60 minute memory stability, meeting recording/summary in the new candidate, first-run model download, and clean-Mac permissions remain to be checked.
- No valid Developer ID signing identity was available on the build Mac. A general release requires Developer ID signing, notarization, and clean-Mac validation.

The DMG and its `.sha256` file are attached to the GitHub prerelease for this tag. Models, user audio, databases, and secrets are not included in the repository or release assets.
