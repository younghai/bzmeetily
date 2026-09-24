#!/bin/bash
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$HOME/Library/Application Support/com.meetily.ai"
LOG_DIR="$DATA_DIR/local-logs"
AGENT_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
WEB_LABEL="com.meetily.local-web"
WHISPER_LABEL="com.meetily.local-whisper"
ACTION="${1:-start}"

health() { /usr/bin/curl --silent --fail --max-time 3 "$1" >/dev/null; }
api_ready() {
  /usr/bin/curl --silent --fail --max-time 6 http://127.0.0.1:3118/api/local/status |
    /usr/bin/python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ready") is True else 1)' 2>/dev/null
}
loaded() { /bin/launchctl print "$DOMAIN/$1" >/dev/null 2>&1; }

case "$ACTION" in
  stop)
    for label in "$WEB_LABEL" "$WHISPER_LABEL"; do
      if loaded "$label"; then /bin/launchctl bootout "$DOMAIN/$label"; fi
    done
    echo "Meetily 웹·전사 서비스를 종료했습니다. Ollama와 저장된 회의는 유지됩니다."
    exit 0
    ;;
  status)
    for endpoint in http://127.0.0.1:3118/api/local/status http://127.0.0.1:8178/health http://127.0.0.1:11434/api/version; do
      /usr/bin/curl --silent --show-error --max-time 3 "$endpoint" || true
      echo
    done
    exit 0
    ;;
  start) ;;
  *) echo "Usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac

export PATH="/opt/homebrew/bin:$HOME/.bun/bin:/usr/local/bin:$PATH"
BUN_BIN="$(command -v bun)"
WHISPER_BIN="$(command -v whisper-server)"
FFMPEG_BIN="$(command -v ffmpeg)"
MODEL_PATH="$DATA_DIR/models/ggml-large-v3-turbo.bin"
if [[ ! -f "$MODEL_PATH" || ! -f "$FRONTEND_DIR/out/index.html" ]]; then
  echo "Whisper 모델과 웹 빌드가 필요합니다. 설치 안내를 확인하세요." >&2
  exit 1
fi
mkdir -p "$LOG_DIR" "$AGENT_DIR"
if ! health http://127.0.0.1:11434/api/version; then
  /opt/homebrew/bin/brew services start ollama
fi

/usr/bin/python3 - "$FRONTEND_DIR" "$DATA_DIR" "$LOG_DIR" "$AGENT_DIR" "$BUN_BIN" "$WHISPER_BIN" "$FFMPEG_BIN" "$MODEL_PATH" <<'PY'
import os, plistlib, sys
frontend, data, logs, agents, bun, whisper, ffmpeg, model = sys.argv[1:]
jobs = {
    'com.meetily.local-whisper': [whisper, '--host', '127.0.0.1', '--port', '8178', '-m', model, '-l', 'ja', '--public', frontend + '/public'],
    'com.meetily.local-web': [bun, frontend + '/local-server/index.ts'],
}
for label, args in jobs.items():
    job = {
        'Label': label, 'ProgramArguments': args, 'WorkingDirectory': frontend,
        'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
        'EnvironmentVariables': {'HOME': os.path.expanduser('~'), 'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'MEETILY_FFMPEG_PATH': ffmpeg, 'MEETILY_WHISPER_MODEL': 'large-v3-turbo'},
        'StandardOutPath': logs + '/' + label + '.log',
        'StandardErrorPath': logs + '/' + label + '.error.log',
    }
    with open(agents + '/' + label + '.plist', 'wb') as file:
        plistlib.dump(job, file)
PY

for label in "$WHISPER_LABEL" "$WEB_LABEL"; do
  if ! loaded "$label"; then /bin/launchctl bootstrap "$DOMAIN" "$AGENT_DIR/$label.plist"; fi
done
for ((attempt=0; attempt<90; attempt++)); do
  if health http://127.0.0.1:8178/health && api_ready; then
    echo "Meetily 준비 완료: http://localhost:3118"
    exit 0
  fi
  sleep 1
done
echo "서비스 준비 시간이 초과되었습니다. 로그: $LOG_DIR" >&2
exit 1
