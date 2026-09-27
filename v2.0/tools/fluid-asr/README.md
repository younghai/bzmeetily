# Japanese ASR comparison

This is an optional, local benchmark for Meetily2 file import. The shipped macOS and localhost import paths continue to use Whisper. The Swift binary is not bundled in the app or DMG, and the Japanese model is downloaded on first run. Do not select FluidAudio for production import until the same-file accuracy and memory gate below passes.

## Build and run

```sh
swift build -c release --package-path v2.0/tools/fluid-asr --disable-automatic-resolution
python3 v2.0/tools/fluid-asr/compare.py /path/to/japanese-meeting.wav \
  --reference /path/to/reviewed-japanese-transcript.txt \
  --whisper-url http://127.0.0.1:8179 \
  --concurrency 1 2 4 \
  --output /path/to/local-comparison.json
```

For a separate short-window experiment, add `--fluid-window-seconds 10 15`. This launches the model once per window and reports a combined transcript; it is an evaluation path, not Meetily2's production import flow.

Run from the repository root. Start Meetily2's local Whisper server first. The script converts the file once with ffmpeg to 16 kHz mono WAV on disk, sends the same WAV to the loopback Whisper server, and runs the pinned FluidAudio Japanese TDT model through its disk-backed API with each requested worker count. It records decode, model load, ASR and total elapsed times. With a reviewed Japanese reference, it reports character error rate after Unicode NFKC normalization and removal of whitespace and punctuation. Without a reference, the output is a timing comparison only. The tool does not send audio to a remote transcription service.

Inspect `sourceAudio.channels` before interpreting results. For separate speakers on the left and right channels, repeat the comparison with `--channel left` and `--channel right`; mixed-channel scores alone can conceal dropped speakers. Keep source recordings and resulting transcripts outside Git.

Use representative 5, 30 and 75 minute recordings: clear speech, noise, long silence, overlapping speakers, and stereo speakers. Record first visible transcript time and peak RSS for the full Meetily2 import separately; this benchmark's total elapsed time is not an incremental-display metric. Review names, numbers, sentence omissions and repetitions at every chunk boundary and Japanese-to-Korean meaning preservation. Enable FluidAudio as a selectable production engine only if it improves these measures on the actual recordings without unacceptable memory or latency regression. Diarization and denoising require their own accuracy checks and are not assumed to speed up ASR.

FluidAudio 0.17.4 is pinned in `Package.resolved`. Its SDK is Apache-2.0; the [Japanese model](https://huggingface.co/FluidInference/parakeet-0.6b-ja-coreml) is CC-BY-4.0 and needs attribution if distributed. The [long transcription guide](https://github.com/FluidInference/FluidAudio/blob/21493f8dac5a97e65742e6ff26f42f164c2fda0f/Documentation/ASR/LongTranscription.md) describes overlap and seam failure modes that the test set must cover.
