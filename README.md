# Meetily2

Meetily2 is a local-first AI meeting assistant for Apple Silicon Macs. It offers two separate workflows: live Japanese-to-Korean interpretation, and meeting recording, transcription, and Korean summaries. The desktop app also serves a browser interface at `http://127.0.0.1:3118/` on the same Mac.

> **Release status (24 September 2026):** The `2.0.2-rc.1` DMG is an ad-hoc development candidate, not an approved public installer. The current app has been exercised with computer audio, microphone, and both sources on the build Mac; mixed-input accuracy, long-session memory use, Developer ID signing, notarization, and a clean-Mac test remain release gates. See [review status](reviews/STATE.md) and the [DMG audit](v2.0/docs/distribution-dmg.md) before relying on a build for a meeting.

## What it does

| Workflow | User experience | Data behavior |
| --- | --- | --- |
| Live interpretation | Select **Live interpretation**, choose microphone, computer audio, or both, then start. Japanese transcription appears on the left and Korean interpretation on the right. A timeline retains earlier dialogue on screen. | Live captions are not automatically saved as a meeting. The desktop view offers copy and text export. |
| Meeting recording | Select **Meeting recording**, create a meeting or import an audio file, review the transcript, and generate a Korean summary. | Meeting records and imported audio are stored locally for later review. |

The app asks you to choose a workflow before it starts listening. Live interpretation processes incoming audio in short, contextual chunks; it does not wait for a completed recording. Each recognized turn remains accessible in the timeline. Translation uses the two preceding completed Japanese/Korean turns to keep terms and address consistent, while aiming to preserve the current speaker's level of formality. The recording workflow supports Japanese, Korean, and English source language choices, with Japanese-to-Korean interpretation when selected.

## How it works

```text
Microphone / computer audio
          │
          ├─ macOS app: Core Audio capture and native mixing
          └─ browser: microphone or browser audio sharing
          │
          ▼
   PCM chunking and ordered requests
          │
          ├─ Whisper large-v3-turbo → Japanese transcription
          └─ Qwen 3.5 4B       → Korean interpretation and summaries
          │
          ▼
   Side-by-side captions or saved meeting workspace
```

The desktop app bundles and manages three loopback services:

| Service | Address | Purpose |
| --- | --- | --- |
| `meetily-server` | `127.0.0.1:3118` | Browser UI, local meeting storage, and API |
| `whisper-server` | `127.0.0.1:8178` | Local speech recognition |
| `ollama` | `127.0.0.1:11434` | Local Qwen inference |

The first-run wizard downloads Whisper large-v3-turbo (about 1.6 GB) and `qwen3.5:4b` (about 3.4 GB). Model download requires internet access; inference runs on this Mac after setup. The app keeps its data and models under `~/Library/Application Support/ai.meetily.interp/`, separate from the original Meetily app. End users of a complete app bundle do not need Node.js, Bun, Rust, or Homebrew to run it.

## Install and run

### Install an app bundle

There is no generally approved, signed Meetily2 DMG in this repository yet. The [2.0.2 RC1 GitHub prerelease](https://github.com/younghai/bzmeetily/releases/tag/v2.0.2-rc.1) is a development candidate for a trusted test Mac. Open its DMG, drag `Meetily2.app` to **Applications**, and launch the app. An ad-hoc build can trigger a Gatekeeper warning; it has not passed the clean-Mac release checks. Do not treat an older `2.0.0` or `2.0.1` DMG as containing later repository changes.

On first launch:

1. Complete the model-download wizard. Allow roughly 15 GB of free disk space for setup and working files.
2. Allow microphone access if you intend to use the mic, and macOS audio-capture access if you intend to interpret computer sound.
3. Choose **Live interpretation** or **Meeting recording**. Choosing a mode does not start audio capture; use the next screen's **Start** control.
4. For live interpretation, select the input source and watch the Japanese-left/Korean-right captions. Stop the session when finished; copy or export captions if needed.
5. For meeting work, record or import audio, review the transcript, then request a Korean summary.

While the app and its local services are running, open [`http://127.0.0.1:3118/`](http://127.0.0.1:3118/) in a browser on the **same Mac** to use the localhost interface. Browser capture uses the browser's microphone and audio-sharing permissions; computer-audio availability depends on the browser's sharing support. The browser audio path and the packaged native audio path require separate end-to-end validation.

### Build a development DMG from source

Build on an Apple Silicon Mac running macOS 14.2 or later. Install Xcode Command Line Tools (or Xcode), stable Rust/Cargo, Node.js 18+, pnpm, Bun, Python 3, and CMake. The build downloads third-party engines and requires network access. These are **build-host** requirements, not end-user requirements.

```sh
git clone https://github.com/younghai/bzmeetily.git
cd bzmeetily/v2.0/meetily/frontend
pnpm install --frozen-lockfile

# The helper sidecar is not committed as a binary.
cd ..
cargo build --release -p llama-helper
mkdir -p frontend/src-tauri/binaries
install -m 755 target/release/llama-helper \
  frontend/src-tauri/binaries/llama-helper-aarch64-apple-darwin

cd ..
scripts/build-dmg.sh
```

The build script prepares the other bundled engines, builds the static UI and Tauri app, and writes `v2.0/release/Meetily2_<version>_aarch64.dmg` with a SHA-256 file and release notes. It refuses to overwrite an existing DMG with the same version. This default build is ad-hoc signed and is for development only.

`scripts/build-dmg.sh --dist` is the separate Developer ID signing and notarization route; it needs Apple signing credentials and must still pass the [clean-Mac checklist](v2.0/docs/clean-mac-checklist.md). The script alone does not establish release readiness.

## Validate a local build

After launching the app and installing both models, run `v2.0/scripts/smoke-test.sh` from the repository root. It checks the local service status, Whisper and Ollama, a short inference request, translation, and loopback binding. It does not replace a real microphone/computer-audio test in the app.

For source changes, the main checks are:

```sh
cd v2.0/meetily/frontend
pnpm test:local
pnpm exec tsc --noEmit
pnpm build

cd src-tauri
cargo test --lib
```

Hardware-dependent Rust capture tests are ignored by default and must be run deliberately with audio playback and macOS permission. See [Pass 02](reviews/pass-02.md) for the latest test counts and limitations.

## Repository map

| Path | Contents |
| --- | --- |
| [`v2.0/meetily/frontend/src/`](v2.0/meetily/frontend/src/) | Next.js UI, live chunking, interpretation, and meeting workspace |
| [`v2.0/meetily/frontend/src-tauri/`](v2.0/meetily/frontend/src-tauri/) | Rust/Tauri app, audio capture, and bundled-service management |
| [`v2.0/meetily/frontend/local-server/`](v2.0/meetily/frontend/local-server/) | Loopback API and local meeting database access |
| [`v2.0/scripts/`](v2.0/scripts/) | Vendor preparation, DMG build, and smoke test |
| [`v2.0/docs/`](v2.0/docs/) | Distribution audit and clean-Mac checklist |
| [`reviews/`](reviews/) | Three-pass test evidence and release decision |
| [`skills/meetily2-release-cycle/`](skills/meetily2-release-cycle/) | Repeatable review workflow for this project |

Generated binaries, models, DMGs, private audio, databases, and secrets are excluded from Git. The scheduled review automation is local to the operator's Codex app and is not installed by cloning this repository.

## Current limitations

- General distribution remains blocked while mixed-input accuracy, long-session memory use, signing/notarization, and clean-Mac installation are being checked. Local system-audio capture worked in the build-Mac smoke test, but it is not a substitute for clean-Mac validation.
- Apple Silicon macOS is the current packaging target; an Intel or Windows installer is not provided by this project.
- Ports `3118`, `8178`, and `11434` must be available or occupied only by compatible local services. Another Meetily installation or local development service can cause a conflict.
- Local speech recognition and translation are model outputs; review important transcripts and summaries before relying on them.

Meetily2 is based on [Zackriya-Solutions/meetily](https://github.com/Zackriya-Solutions/meetily). The upstream copyright and [MIT license](v2.0/meetily/LICENSE.md) are retained.
