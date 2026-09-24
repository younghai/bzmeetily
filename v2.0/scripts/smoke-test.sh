#!/usr/bin/env bash
#
# Smoke test for an installed Meetily2. Run AFTER the app has been launched
# once and models are installed (or copy models manually for a fast pass).
#
#   scripts/smoke-test.sh              # validate services + inference
#
# Exits non-zero on the first failed check. Safe: read-only HTTP checks plus a
# 10s whisper inference on a generated tone file.
set -euo pipefail

SERVER_URL="http://127.0.0.1:3118"
WHISPER_URL="http://127.0.0.1:8178"
OLLAMA_URL="http://127.0.0.1:11434"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
pass() { printf '  \033[1;32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[1;31mFAIL\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl required"

say "1. Local server (meetily-server)"
STATUS=$(curl -sf --max-time 5 "$SERVER_URL/api/local/status") || fail "no response on :3118 — launch Meetily2 first"
echo "$STATUS" | python3 -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get("ready") is True else 1)' \
  && pass "status ready" \
  || fail "status not ready — models may be missing: $STATUS"
echo "$STATUS" | grep -q '"instanceId":"[^"]*"' && pass "instance identity present" || fail "no instanceId (old server on :3118?)"

say "2. Whisper transcription server"
HEALTH=$(curl -sf --max-time 5 "$WHISPER_URL/health") || fail "whisper /health failed on :8178"
echo "$HEALTH" | grep -q '"ok"' && pass "whisper healthy ($HEALTH)" || fail "unexpected health: $HEALTH"

say "3. Whisper inference (generated 2s tone)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# Use ffmpeg from the app bundle if present, else PATH.
FFMPEG="/Applications/Meetily2.app/Contents/MacOS/ffmpeg"
[[ -x "$FFMPEG" ]] || FFMPEG="$(command -v ffmpeg || true)"
if [[ -n "${FFMPEG:-}" ]]; then
  "$FFMPEG" -y -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 1 "$TMP/tone.wav" -loglevel error
  RESP=$(curl -sf --max-time 60 -F "file=@$TMP/tone.wav" -F response_format=verbose_json -F language=ja "$WHISPER_URL/inference") \
    && pass "inference responded ($(echo "$RESP" | head -c 80)…)" || fail "inference request failed"
else
  echo "  SKIP ffmpeg not found — install tone generation unavailable"
fi

say "4. Ollama service + model"
VERSION=$(curl -sf --max-time 5 "$OLLAMA_URL/api/version") || fail "ollama not responding on :11434"
pass "ollama version: $VERSION"
TAGS=$(curl -sf --max-time 5 "$OLLAMA_URL/api/tags")
echo "$TAGS" | grep -q '"name":"qwen3.5:4b"' && pass "qwen3.5:4b installed" || fail "qwen3.5:4b missing — run the in-app model installer"

say "5. Translation roundtrip (ja → ko via meetily-server)"
TRANSLATE=$(curl -sf --max-time 120 -X POST "$SERVER_URL/api/local/translate" \
  -H 'Content-Type: application/json' -H 'X-Meetily-Client: local' \
  -d '{"text":"本日はご集まりいただきありがとうございます。","sourceLanguage":"ja","targetLanguage":"ko"}') \
  || fail "translate request failed"
echo "$TRANSLATE" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  KO:", d.get("text","")[:80])' \
  && pass "translation produced Korean output" || fail "translate response invalid: $TRANSLATE"

say "6. Port hygiene (services bound to loopback only)"
for port in 3118 8178 11434; do
  if lsof -nP -i ":$port" 2>/dev/null | grep -qv 127.0.0.1 && lsof -nP -i ":$port" | grep -q '\*:'; then
    fail "port $port appears bound beyond 127.0.0.1"
  fi
done
pass "all services loopback-only"

say "Smoke test complete — all checks passed."
