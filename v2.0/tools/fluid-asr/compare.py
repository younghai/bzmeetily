#!/usr/bin/env python3

import argparse
import http.client
import json
import subprocess
import tempfile
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlparse


def normalize(text: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFKC", text)
        if not char.isspace() and not unicodedata.category(char).startswith("P")
    )


def character_error_rate(reference: str, hypothesis: str) -> float:
    expected, actual = normalize(reference), normalize(hypothesis)
    if not expected:
        raise ValueError("The reference transcript is empty")
    previous = list(range(len(actual) + 1))
    for row, expected_char in enumerate(expected, 1):
        current = [row]
        for column, actual_char in enumerate(actual, 1):
            current.append(min(
                current[-1] + 1,
                previous[column] + 1,
                previous[column - 1] + (expected_char != actual_char),
            ))
        previous = current
    return previous[-1] / len(expected)


def whisper_transcribe(wav: Path, base_url: str) -> tuple[dict, float]:
    parsed = urlparse(base_url)
    if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Whisper URL must be an HTTP loopback address")
    fields = {"response_format": "verbose_json", "language": "ja", "temperature": "0"}
    boundary = "meetily-asr-comparison"
    prefix = b"".join(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
        for name, value in fields.items()
    ) + f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"sample.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode()
    suffix = f"\r\n--{boundary}--\r\n".encode()
    connection = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=7200)
    started = time.monotonic()
    try:
        connection.putrequest("POST", parsed.path.rstrip("/") + "/inference")
        connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        connection.putheader("Content-Length", str(len(prefix) + wav.stat().st_size + len(suffix)))
        connection.endheaders()
        connection.send(prefix)
        with wav.open("rb") as source:
            while block := source.read(1024 * 1024):
                connection.send(block)
        connection.send(suffix)
        response = connection.getresponse()
        data = response.read()
        if response.status != 200:
            raise RuntimeError(f"Whisper HTTP {response.status}: {data[:500]!r}")
        return json.loads(data), time.monotonic() - started
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare local Whisper and FluidAudio on the same decoded Japanese audio")
    parser.add_argument("audio", type=Path)
    parser.add_argument("--reference", type=Path, help="Reviewed Japanese transcript for CER")
    parser.add_argument("--whisper-url", default="http://127.0.0.1:8179")
    parser.add_argument("--fluid-binary", type=Path, default=Path(__file__).parent / ".build/release/MeetilyFluidASR")
    parser.add_argument("--channel", choices=("mix", "left", "right"), default="mix")
    parser.add_argument("--concurrency", type=int, nargs="+", choices=(1, 2, 4), default=[1, 2, 4])
    parser.add_argument("--fluid-window-seconds", type=int, nargs="+", choices=(10, 15), default=[])
    parser.add_argument("--output", type=Path, help="Optional JSON result path")
    args = parser.parse_args()
    if not args.audio.is_file():
        parser.error("Audio file does not exist")
    if not args.fluid_binary.is_file():
        parser.error("FluidAudio binary is missing; run swift build -c release --package-path v2.0/tools/fluid-asr")
    reference = args.reference.read_text(encoding="utf-8") if args.reference else None
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=channels,channel_layout,sample_rate", "-of", "json", str(args.audio),
    ], capture_output=True, text=True, check=True)
    channels = json.loads(probe.stdout)["streams"][0]
    if args.channel == "right" and channels["channels"] < 2:
        parser.error("The source file has no right channel")
    with tempfile.TemporaryDirectory(prefix="meetily-asr-") as directory:
        wav = Path(directory) / "same-input.wav"
        decoded_at = time.monotonic()
        command = [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(args.audio),
            "-vn",
        ]
        if args.channel != "mix":
            command.extend(["-af", f"pan=mono|c0=c{0 if args.channel == 'left' else 1}"])
        command.extend(["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)])
        subprocess.run(command, check=True)
        report = {"audio": str(args.audio), "sourceAudio": channels, "channel": args.channel,
                  "decodeSeconds": time.monotonic() - decoded_at, "wavBytes": wav.stat().st_size, "results": []}
        whisper, seconds = whisper_transcribe(wav, args.whisper_url)
        text = whisper.get("text", "")
        report["results"].append({"engine": "whisper", "seconds": seconds, "text": text,
                                  "cer": character_error_rate(reference, text) if reference else None})
        for concurrency in dict.fromkeys(args.concurrency):
            started = time.monotonic()
            process = subprocess.run([str(args.fluid_binary), str(wav), str(concurrency)],
                                     capture_output=True, text=True, check=True)
            output = json.loads(process.stdout)
            text = output["result"]["text"]
            report["results"].append({
                "engine": "fluid-tdt-ja", "concurrency": concurrency,
                "seconds": time.monotonic() - started,
                "modelLoadSeconds": output["modelLoadSeconds"], "asrSeconds": output["asrSeconds"],
                "text": text, "cer": character_error_rate(reference, text) if reference else None,
            })
        for window_seconds in dict.fromkeys(args.fluid_window_seconds):
            pattern = Path(directory) / f"window-{window_seconds}-%04d.wav"
            started = time.monotonic()
            subprocess.run([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
                "-f", "segment", "-segment_time", str(window_seconds), "-c:a", "pcm_s16le", str(pattern),
            ], check=True)
            outputs = [json.loads(subprocess.run([
                str(args.fluid_binary), str(part), "1",
            ], capture_output=True, text=True, check=True).stdout) for part in sorted(Path(directory).glob(f"window-{window_seconds}-*.wav"))]
            text = "".join(item["result"]["text"] for item in outputs)
            report["results"].append({
                "engine": "fluid-tdt-ja-windowed", "windowSeconds": window_seconds,
                "windows": len(outputs), "seconds": time.monotonic() - started,
                "modelLoadSeconds": sum(item["modelLoadSeconds"] for item in outputs),
                "asrSeconds": sum(item["asrSeconds"] for item in outputs),
                "text": text, "cer": character_error_rate(reference, text) if reference else None,
            })
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")


if __name__ == "__main__":
    main()
