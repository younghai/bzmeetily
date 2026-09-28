#!/usr/bin/env bash
#
# Latency benchmark for Meetily2 local inference (transcribe + translate).
# Slices a sample WAV into sequential 6s chunks, POSTs each to
# /api/local/transcribe, then translates every segment via
# /api/local/translate (ja->ko, polish) and prints a latency summary.
#
#   scripts/benchmark.sh                 # default sample audio
#   AUDIO=/path/to/x.wav scripts/benchmark.sh
#
# Exit codes: 0 measured, 1 zero chunks succeeded, 2 preflight failure.
set -euo pipefail

SERVER_URL="http://127.0.0.1:3118"
AUDIO="${AUDIO:-/Users/young2026/Downloads/meeting/verification/korean-test.wav}"
CHUNK_SEC=6
REPORT_DIR="/Users/young2026/Downloads/meeting/v2.0/release"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
pass() { printf '  \033[1;32mPASS\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m경고\033[0m %s\n' "$1"; }
fail() { printf '  \033[1;31mFAIL\033[0m %s\n' "$1" >&2; }

command -v curl >/dev/null 2>&1 || { fail "curl required"; exit 2; }
command -v python3 >/dev/null 2>&1 || { fail "python3 required"; exit 2; }

# ---------------------------------------------------------------------------
# 1. Preflight: app must be running and ready
# ---------------------------------------------------------------------------
say "1. 사전 점검 (서버 상태)"
STATUS=$(curl -sf --max-time 5 "$SERVER_URL/api/local/status") || {
  fail "127.0.0.1:3118 응답 없음 — launch Meetily2 first"
  exit 2
}
echo "$STATUS" | python3 -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get("ready") is True else 1)' || {
  fail "서버가 준비되지 않음 — launch Meetily2 first ($STATUS)"
  exit 2
}
MODELS=$(echo "$STATUS" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["whisper"]["model"], d["ollama"]["model"])')
WHISPER_MODEL=${MODELS%% *}
OLLAMA_MODEL=${MODELS##* }
pass "서버 준비됨 (whisper: $WHISPER_MODEL, ollama: $OLLAMA_MODEL)"

[[ -f "$AUDIO" ]] || { fail "오디오 파일 없음: $AUDIO (AUDIO 환경변수로 대체 가능)"; exit 2; }

# ---------------------------------------------------------------------------
# 2. ffmpeg resolution (app-bundled first, then PATH)
# ---------------------------------------------------------------------------
FFMPEG="/Applications/Meetily2.app/Contents/MacOS/ffmpeg"
[[ -x "$FFMPEG" ]] || FFMPEG="$(command -v ffmpeg || true)"
if [[ -z "${FFMPEG:-}" ]]; then
  fail "ffmpeg 없음 — Meetily2 앱 번들 또는 PATH에 ffmpeg 필요"
  exit 2
fi
FFPROBE="$(command -v ffprobe || true)"

now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

# Run "$@" with timing; prints "<wall_ms> <rc>", command stdout -> $1 file.
py_measure() {
  local out="$1"; shift
  python3 -c '
import subprocess, sys, time
out, cmd = sys.argv[1], sys.argv[2:]
t0 = time.perf_counter()
r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
dt = (time.perf_counter() - t0) * 1000.0
open(out, "wb").write(r.stdout)
sys.stderr.buffer.write(r.stderr)
print("%.0f %d" % (dt, r.returncode))
' "$out" "$@"
}

# min/median/p95/max of given numbers (sort -n, nearest-rank p95).
stats() {
  if [[ "$#" -eq 0 ]]; then echo "n/a n/a n/a n/a"; return; fi
  local nums min max med p95idx p95 n
  nums=($(printf '%s\n' "$@" | sort -n))
  n=${#nums[@]}
  min=${nums[0]}; max=${nums[n-1]}
  if (( n % 2 == 1 )); then med=${nums[n/2]}; else med=$(( (nums[n/2-1] + nums[n/2]) / 2 )); fi
  p95idx=$(( (n * 95 + 99) / 100 )); (( p95idx < 1 )) && p95idx=1
  p95=${nums[p95idx-1]}
  echo "$min $med $p95 $max"
}

# ---------------------------------------------------------------------------
# 3. Slice audio into sequential CHUNK_SEC-second WAV chunks (16kHz mono s16)
# ---------------------------------------------------------------------------
say "2. 오디오 분할 (ffmpeg, ${CHUNK_SEC}초 청크)"
TOTAL_DUR=""
if [[ -n "$FFPROBE" ]]; then
  TOTAL_DUR=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$AUDIO" 2>/dev/null || true)
fi
if [[ -z "$TOTAL_DUR" ]]; then
  SZ=$(stat -f%z "$AUDIO" 2>/dev/null || echo 0)
  TOTAL_DUR=$(awk -v b=$(( SZ > 44 ? SZ - 44 : 0 )) 'BEGIN{printf "%.3f", b/32000}')
  warn "ffprobe 없음 — 파일 크기 기준 길이 추정 사용"
fi
N=$(python3 -c "import math,sys;print(max(1, math.ceil(float(sys.argv[1])/$CHUNK_SEC)))" "$TOTAL_DUR")

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for i in $(seq 1 "$N"); do
  SS=$(( (i - 1) * CHUNK_SEC ))
  "$FFMPEG" -y -ss "$SS" -t "$CHUNK_SEC" -i "$AUDIO" -ar 16000 -ac 1 -c:a pcm_s16le \
    "$TMP/chunk-$(printf '%03d' "$i").wav" -loglevel error || { fail "청크 $i 분할 실패"; exit 2; }
done
pass "${N}개 청크 생성 (원본 ${TOTAL_DUR}초)"

# ---------------------------------------------------------------------------
# 4. Transcribe each chunk sequentially
# ---------------------------------------------------------------------------
say "3. 전사 (STT) — 청크 순차 전송"
CHUNKS_TSV="$TMP/chunks.tsv"; : > "$CHUNKS_TSV"
SEGF_FILES=()
CHUNKS_OK=0; CHUNKS_EMPTY=0; SEG_TOTAL=0
FIRST_CAP=""; PREV_MS=0
RUN_START=$(now_ms)
for i in $(seq 1 "$N"); do
  CHUNK="$TMP/chunk-$(printf '%03d' "$i").wav"
  START=$(( (i - 1) * CHUNK_SEC ))
  CSZ=$(stat -f%z "$CHUNK" 2>/dev/null || echo 44)
  CDUR=$(awk -v b=$(( CSZ > 44 ? CSZ - 44 : 0 )) 'BEGIN{printf "%.3f", b/32000}')
  RESULT=$(py_measure "$TMP/resp.json" \
    curl -sS --max-time 120 -X POST \
    "$SERVER_URL/api/local/transcribe?sequence=$i&start=$START&duration=$CDUR" \
    -H 'Content-Type: audio/wav' -H 'X-Meetily-Client: local' \
    --data-binary @"$CHUNK") || true
  [[ -z "$RESULT" ]] && RESULT="0 1"
  MS=${RESULT%% *}; RC=${RESULT##* }
  CNT_SNIP=$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    segs = d["segments"]
    assert isinstance(segs, list)
except Exception:
    print("-1\t-")
    raise SystemExit
for j, s in enumerate(segs):
    t = str(s.get("sourceText", "")).strip()
    if t:
        open(f"{sys.argv[2]}{j}.txt", "w", encoding="utf-8").write(t)
snip = ""
if segs:
    snip = str(segs[0].get("sourceText", "")).replace("\n", " ").replace("\r", " ").replace("\t", " ").strip()[:40]
if not snip:
    snip = "-"
print(f"{len(segs)}\t{snip}")
' "$TMP/resp.json" "$TMP/seg-$(printf '%03d' "$i")-") || CNT_SNIP=$'-1\t-'
  CNT=${CNT_SNIP%%$'\t'*}; SNIP=${CNT_SNIP#*$'\t'}
  if [[ "$CNT" -ge 0 ]] 2>/dev/null; then
    CHUNKS_OK=$((CHUNKS_OK + 1))
    if [[ -z "$FIRST_CAP" && "$CNT" -gt 0 ]]; then FIRST_CAP=$(( PREV_MS + MS )); fi
    if (( CNT > 0 )); then
      for j in $(seq 0 $(( CNT - 1 ))); do
        SEGF="$TMP/seg-$(printf '%03d' "$i")-$j.txt"
        [[ -f "$SEGF" ]] && SEGF_FILES+=("$SEGF")
      done
    else
      CHUNKS_EMPTY=$((CHUNKS_EMPTY + 1))
    fi
    SEG_TOTAL=$((SEG_TOTAL + CNT))
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$i" "$START" "$CDUR" "$MS" "$CNT" "$SNIP" >> "$CHUNKS_TSV"
    printf '  청크 %s/%s  %sms  세그먼트 %s개  「%s」\n' "$i" "$N" "$MS" "$CNT" "$SNIP"
  else
    printf '%s\t%s\t%s\t%s\t-1\t-\n' "$i" "$START" "$CDUR" "$MS" >> "$CHUNKS_TSV"
    printf '  \033[1;31mFAIL\033[0m 청크 %s/%s  %sms  요청 실패 (rc=%s)\n' "$i" "$N" "$MS" "$RC" >&2
  fi
  PREV_MS=$(( PREV_MS + MS ))
done

if (( CHUNKS_OK == 0 )); then
  fail "성공한 청크가 없어 벤치마크를 완료할 수 없음"
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. Translate every segment (ja -> ko, polish)
# ---------------------------------------------------------------------------
SEG_COUNT=${#SEGF_FILES[@]}
say "4. 번역 (ja→ko, polish) — 세그먼트 ${SEG_COUNT}개"
TRANS_TSV="$TMP/trans.tsv"; : > "$TRANS_TSV"
TL_OK=0; TL_FAIL=0; IDX=0
for SEGF in ${SEGF_FILES[@]+"${SEGF_FILES[@]}"}; do
  IDX=$((IDX + 1))
  BODY=$(python3 -c 'import json,sys;print(json.dumps({"text":open(sys.argv[1],encoding="utf-8").read().strip(),"sourceLanguage":"ja","targetLanguage":"ko","polish":True},ensure_ascii=False))' "$SEGF")
  RESULT=$(py_measure "$TMP/tresp.json" \
    curl -sS --max-time 180 -X POST "$SERVER_URL/api/local/translate" \
    -H 'Content-Type: application/json' -H 'X-Meetily-Client: local' \
    --data-binary "$BODY") || true
  [[ -z "$RESULT" ]] && RESULT="0 1"
  MS=${RESULT%% *}; RC=${RESULT##* }
  TL=$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
    ms = int(round(float(d["elapsedMs"])))
    txt = str(d["text"]).strip()
except Exception:
    print("-1\t-\t-")
    raise SystemExit
snip = txt.replace("\n", " ").replace("\r", " ").replace("\t", " ")[:40]
src = open(sys.argv[2], encoding="utf-8").read().replace("\n", " ").replace("\r", " ").replace("\t", " ").strip()[:40]
if not snip:
    snip = "-"
if not src:
    src = "-"
print(f"{ms}\t{snip}\t{src}")
' "$TMP/tresp.json" "$SEGF") || TL=$'-1\t-\t-'
  SRV_MS=${TL%%$'\t'*}; REST=${TL#*$'\t'}; KO_SNIP=${REST%%$'\t'*}; SRC_SNIP=${REST#*$'\t'}
  if [[ "$SRV_MS" -ge 0 ]] 2>/dev/null; then
    TL_OK=$((TL_OK + 1))
    printf '%s\t%s\t%s\t%s\t%s\n' "$IDX" "$SRV_MS" "$MS" "$SRC_SNIP" "$KO_SNIP" >> "$TRANS_TSV"
    printf '  세그 %2s  서버 %sms / 벽시계 %sms  「%s」\n' "$IDX" "$SRV_MS" "$MS" "$KO_SNIP"
  else
    TL_FAIL=$((TL_FAIL + 1))
    printf '%s\t-1\t%s\t%s\t-\n' "$IDX" "$MS" "$SRC_SNIP" >> "$TRANS_TSV"
    printf '  \033[1;33m실패\033[0m 세그 %2s  벽시계 %sms (rc=%s) — 계속 진행\n' "$IDX" "$MS" "$RC"
  fi
done
RUN_END=$(now_ms)
TOTAL_WALL=$(( RUN_END - RUN_START ))

# ---------------------------------------------------------------------------
# 6. Aggregate summary (stdout) + aggregates file for the report
# ---------------------------------------------------------------------------
say "5. 결과 요약"
TR_MS=()
while IFS=$'\t' read -r _ _ _ MS CNT _; do
  [[ "$CNT" != "-1" ]] && TR_MS+=("$MS")
done < "$CHUNKS_TSV"
SV_MS=(); TW_MS=()
while IFS=$'\t' read -r _ SV MS _ _; do
  if [[ "$SV" != "-1" ]]; then SV_MS+=("$SV"); TW_MS+=("$MS"); fi
done < "$TRANS_TSV"

print_stat_row() { # $1 label; rest = numbers
  local label="$1"; shift
  local s
  if [[ "$#" -eq 0 ]]; then s="n/a n/a n/a n/a"; else s=$(stats "$@"); fi
  printf '  %-18s %10s %10s %10s %10s\n' "$label" $s
}
printf '  %-18s %10s %10s %10s %10s\n' "항목" "최소" "중앙값" "p95" "최대"
print_stat_row "전사(ms)" ${TR_MS[@]+"${TR_MS[@]}"}
print_stat_row "번역-서버(ms)" ${SV_MS[@]+"${SV_MS[@]}"}
print_stat_row "번역-벽시계(ms)" ${TW_MS[@]+"${TW_MS[@]}"}

AGG_TSV="$TMP/agg.tsv"; : > "$AGG_TSV"
agg_row() { # $1 label; rest = numbers
  local label="$1"; shift
  local s
  if [[ "$#" -eq 0 ]]; then s="n/a n/a n/a n/a"; else s=$(stats "$@"); fi
  printf '%s\t%s\n' "$label" "$s" >> "$AGG_TSV"
}
agg_row "전사(ms)" ${TR_MS[@]+"${TR_MS[@]}"}
agg_row "번역-서버(ms)" ${SV_MS[@]+"${SV_MS[@]}"}
agg_row "번역-벽시계(ms)" ${TW_MS[@]+"${TW_MS[@]}"}

CHUNKS_WITH_SEG=$(( CHUNKS_OK - CHUNKS_EMPTY ))
if [[ -n "$FIRST_CAP" ]]; then FC_TXT="${FIRST_CAP}ms"; else FC_TXT="n/a"; fi
pass "청크 ${N}개 중 $CHUNKS_OK 성공 (세그먼트 있음 $CHUNKS_WITH_SEG / 빈 결과 $CHUNKS_EMPTY)"
pass "세그먼트 ${SEG_TOTAL}개 중 번역 성공 $TL_OK / 실패 $TL_FAIL"
pass "첫 캡션 도달: $FC_TXT (근사, 첫 POST 시작 → 첫 세그먼트 수신)"
pass "전체 소요: ${TOTAL_WALL}ms"

# ---------------------------------------------------------------------------
# 7. Markdown report
# ---------------------------------------------------------------------------
mkdir -p "$REPORT_DIR"
TS=$(date +%Y%m%d-%H%M%S)
REPORT="$REPORT_DIR/benchmark-$TS.md"
OS_VER=$(sw_vers -productVersion 2>/dev/null || echo "-")
CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "-")
NOW=$(date '+%Y-%m-%d %H:%M:%S')
AUDIO_DUR=$(python3 -c "import sys;print(round(float(sys.argv[1]),2))" "$TOTAL_DUR" 2>/dev/null || echo "$TOTAL_DUR")

META="$TMP/summary.meta"
{
  printf '실행 일시\t%s\n' "$NOW"
  printf 'macOS\t%s\n' "$OS_VER"
  printf '칩\t%s\n' "$CHIP"
  printf '서버\t%s\n' "$SERVER_URL"
  printf 'whisper 모델\t%s\n' "$WHISPER_MODEL"
  printf 'ollama 모델\t%s\n' "$OLLAMA_MODEL"
  printf '오디오\t%s (%s초, 16kHz mono)\n' "$AUDIO" "$AUDIO_DUR"
  printf '청크 구성\t%s초 x %s개\n' "$CHUNK_SEC" "$N"
  printf '측정 대상\t/api/local/transcribe, /api/local/translate\n'
  printf '비고\twhisper는 language=ja 강제 (타이밍 측정 목적)\n'
  printf '청크 결과\t%s개 중 %s 성공 (세그먼트 있음 %s / 빈 결과 %s)\n' "$N" "$CHUNKS_OK" "$CHUNKS_WITH_SEG" "$CHUNKS_EMPTY"
  printf '세그먼트 결과\t%s개 중 번역 성공 %s / 실패 %s\n' "$SEG_TOTAL" "$TL_OK" "$TL_FAIL"
  printf '첫 캡션 도달\t%s (근사)\n' "$FC_TXT"
  printf '전체 소요\t%sms\n' "$TOTAL_WALL"
} > "$META"

python3 - "$REPORT" "$CHUNKS_TSV" "$TRANS_TSV" "$AGG_TSV" "$META" <<'PY'
import sys

report, chunks_tsv, trans_tsv, agg_tsv, meta_path = sys.argv[1:6]
meta = {}
for line in open(meta_path, encoding="utf-8"):
    k, _, v = line.rstrip("\n").partition("\t")
    meta[k] = v

def read_tsv(path):
    return [l.rstrip("\n").split("\t") for l in open(path, encoding="utf-8") if l.strip()]

def cell(v):
    v = str(v).replace("|", "/")
    return v if v else "-"

lines = []
lines.append("# Meetily2 지연시간 벤치마크")
lines.append("")
for k in ["실행 일시", "macOS", "칩", "서버", "whisper 모델", "ollama 모델",
          "오디오", "청크 구성", "측정 대상", "비고"]:
    if k in meta:
        lines.append(f"- **{k}**: {meta[k]}")
lines.append("")
lines.append("## 청크별 전사 (STT)")
lines.append("")
lines.append("| 청크 | 시작(s) | 길이(s) | 소요(ms) | 세그먼트 | 첫 문장(40자) |")
lines.append("|---:|---:|---:|---:|---:|---|")
for r in read_tsv(chunks_tsv):
    seq, start, dur, ms, cnt, snip = (r + ["-"] * 6)[:6]
    lines.append("| %s | %s | %s | %s | %s | %s |" % (cell(seq), cell(start), cell(dur), cell(ms), cell(cnt), cell(snip)))
lines.append("")
lines.append("## 세그먼트별 번역 (ja→ko, polish=true)")
lines.append("")
lines.append("| # | 서버(ms) | 벽시계(ms) | 원문(40자) | 번역(40자) |")
lines.append("|---:|---:|---:|---|---|")
for r in read_tsv(trans_tsv):
    idx, sv, wall, src, ko = (r + ["-"] * 5)[:5]
    lines.append("| %s | %s | %s | %s | %s |" % (cell(idx), cell(sv), cell(wall), cell(src), cell(ko)))
lines.append("")
lines.append("## 집계")
lines.append("")
lines.append("| 항목 | 최소 | 중앙값 | p95 | 최대 |")
lines.append("|---|---:|---:|---:|---:|")
for r in read_tsv(agg_tsv):
    name = r[0]
    vals = r[1].split()
    while len(vals) < 4:
        vals.append("n/a")
    lines.append("| %s | %s |" % (cell(name), " | ".join(cell(v) for v in vals[:4])))
lines.append("")
for k in ["청크 결과", "세그먼트 결과", "첫 캡션 도달", "전체 소요"]:
    if k in meta:
        lines.append(f"- **{k}**: {meta[k]}")
lines.append("")
open(report, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY

pass "리포트 저장: $REPORT"
