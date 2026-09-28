#!/usr/bin/env bash
#
# Build the Meetily2 standalone DMG (Apple Silicon).
#
#   scripts/build-dmg.sh                dev build (ad-hoc signature, not for distribution)
#   scripts/build-dmg.sh --dist         distribution build (requires signing env vars)
#
# Distribution signing env vars:
#   MACOS_SIGNING_IDENTITY   "Developer ID Application: Your Name (TEAMID)"
#   APPLE_ID                 Apple ID email for notarization
#   APPLE_PASSWORD            App-specific password for the Apple ID
#   APPLE_TEAM_ID            Team ID
#
# Output: release/Meetily2_<version>_aarch64.dmg (+ .sha256, release notes)
set -euo pipefail

V2_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_TAURI="$V2_ROOT/meetily/frontend/src-tauri"
RELEASE_DIR="$V2_ROOT/release"
MODE="dev"
[[ "${1:-}" == "--dist" ]] && MODE="dist"

if [[ "$MODE" == "dist" ]]; then
  : "${MACOS_SIGNING_IDENTITY:?set MACOS_SIGNING_IDENTITY for --dist}"
  : "${APPLE_ID:?set APPLE_ID for --dist notarization}"
  : "${APPLE_PASSWORD:?set APPLE_PASSWORD for --dist notarization}"
  : "${APPLE_TEAM_ID:?set APPLE_TEAM_ID for --dist notarization}"
fi

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[[ "$(uname -m)" == "arm64" ]] || fail "Apple Silicon only (arm64 required)"
[[ "$(uname)" == "Darwin" ]] || fail "macOS required"

if ! command -v bun >/dev/null 2>&1; then export PATH="$HOME/.bun/bin:$PATH"; fi
command -v bun >/dev/null 2>&1 || fail "bun is required (https://bun.sh)"
command -v cargo >/dev/null 2>&1 || fail "cargo is required (rustup)"
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required (npm i -g pnpm) — drives both the Next build and tauri"
command -v python3 >/dev/null 2>&1 || fail "python3 is required (install Xcode Command Line Tools)"
command -v cmake >/dev/null 2>&1 || fail "cmake is required to build whisper.cpp (brew install cmake)"

VERSION=$(python3 -c "import json;print(json.load(open('$SRC_TAURI/tauri.conf.json'))['version'])")
PRODUCT_NAME=$(python3 -c "import json;print(json.load(open('$SRC_TAURI/tauri.conf.json'))['productName'])")
FINAL_DMG="$RELEASE_DIR/${PRODUCT_NAME}_${VERSION}_aarch64.dmg"
[[ ! -e "$FINAL_DMG" ]] || fail "release artifact already exists: $FINAL_DMG"
say "Meetily2 v$VERSION ($MODE mode)"

# 1. Vendors (sidecar binaries + resources)
say "Step 1/5 — vendored engines"
"$V2_ROOT/scripts/fetch-vendors.sh"

# 2. Frontend static export
say "Step 2/5 — frontend build (Next.js static export)"
cd "$V2_ROOT/meetily/frontend"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile --prefer-offline
  pnpm build
else
  bun install --frozen-lockfile
  bun run build
fi
[[ -f out/index.html ]] || fail "frontend build did not produce out/index.html"
# The bundle serves the web UI from resources/web-static, so refresh it with
# the export that was just built (tauri.conf's beforeBuildCommand rebuilds
# out/ again inside step 3, which is fine — same source of truth).
rm -rf "$SRC_TAURI/resources/web-static"
cp -R out "$SRC_TAURI/resources/web-static"

# 3. Release Rust build + app bundle. The DMG is created by this script with
# hdiutil (deterministic, no Finder/AppleScript involvement).
say "Step 3/5 — Tauri release build (this can take a while)"
cd "$V2_ROOT/meetily/frontend"
PATH="$V2_ROOT/meetily/frontend/scripts/native-build-support:$PATH" \
  RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--remap-path-prefix=$HOME=/build-home --cfg meetily_public_bundle" \
  CFLAGS="${CFLAGS:+$CFLAGS }-ffile-prefix-map=$HOME=/build-home" \
  CXXFLAGS="${CXXFLAGS:+$CXXFLAGS }-ffile-prefix-map=$HOME=/build-home" \
  CMAKE_C_FLAGS="${CMAKE_C_FLAGS:+$CMAKE_C_FLAGS }-ffile-prefix-map=$HOME=/build-home" \
  CMAKE_CXX_FLAGS="${CMAKE_CXX_FLAGS:+$CMAKE_CXX_FLAGS }-ffile-prefix-map=$HOME=/build-home" \
  pnpm tauri build --bundles app

# Cargo workspace puts bundle output under the workspace-root target dir.
APP_PATH="$V2_ROOT/meetily/target/release/bundle/macos/$PRODUCT_NAME.app"
DMG_PATH="$V2_ROOT/meetily/target/release/bundle/dmg/${PRODUCT_NAME}_${VERSION}_aarch64.dmg"
[[ -d "$APP_PATH" ]] || fail "app bundle missing: $APP_PATH"

# Rust panic locations can otherwise embed the build user's home directory.
# Keep private build paths out of publicly shared candidate binaries.
python3 - "$APP_PATH" "$HOME" <<'PY'
from pathlib import Path
import sys

bundle = Path(sys.argv[1])
home = (sys.argv[2] + "/").encode()
leaks = [str(path.relative_to(bundle)) for path in bundle.rglob("*")
         if path.is_file() and not path.is_symlink() and home in path.read_bytes()]
if leaks:
    print("ERROR: app bundle contains local build paths: " + ", ".join(leaks), file=sys.stderr)
    raise SystemExit(1)
PY

mkdir -p "$RELEASE_DIR"

# 4. Optional signing + notarization
if [[ "$MODE" == "dist" ]]; then
  : "${MACOS_SIGNING_IDENTITY:?set MACOS_SIGNING_IDENTITY for --dist}"
  say "Step 4/5 — signing with $MACOS_SIGNING_IDENTITY"
  ENTITLEMENTS="$SRC_TAURI/entitlements.plist"
  # Sign every Mach-O inside the bundle, deepest first.
  find "$APP_PATH" -type f \( -perm -111 -o -name "*.dylib" \) | while read -r binary; do
    file "$binary" | grep -q "Mach-O" || continue
    /usr/bin/codesign --force --options runtime --timestamp \
      --entitlements "$ENTITLEMENTS" \
      --sign "$MACOS_SIGNING_IDENTITY" "$binary"
  done
  /usr/bin/codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$MACOS_SIGNING_IDENTITY" "$APP_PATH"
  /usr/bin/codesign --verify --strict --verbose=2 "$APP_PATH"

  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    say "Notarizing app…"
    /usr/bin/ditto -c -k --keepParent "$APP_PATH" "$RELEASE_DIR/${PRODUCT_NAME}.app.zip"
    /usr/bin/xcrun notarytool submit "$RELEASE_DIR/${PRODUCT_NAME}.app.zip" \
      --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
    /usr/bin/xcrun stapler staple "$APP_PATH"
    rm -f "$RELEASE_DIR/${PRODUCT_NAME}.app.zip"
  else
    say "APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID not set — skipping notarization"
  fi

  # Rebuild a clean DMG from the signed app.
  say "Rebuilding DMG from signed app"
  STAGING="$RELEASE_DIR/.dmg-staging"
  rm -rf "$STAGING" && mkdir -p "$STAGING"
  cp -R "$APP_PATH" "$STAGING/"
  ln -s /Applications "$STAGING/Applications"
  [[ ! -e "$FINAL_DMG" ]] || fail "release artifact already exists: $FINAL_DMG"
  hdiutil create -volname "$PRODUCT_NAME $VERSION" -srcfolder "$STAGING" \
    -format UDZO "$FINAL_DMG"
  rm -rf "$STAGING"

  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    say "Notarizing DMG…"
    /usr/bin/xcrun notarytool submit "$FINAL_DMG" \
      --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
    /usr/bin/xcrun stapler staple "$FINAL_DMG"
  fi
else
  say "Step 4/5 — dev build: ad-hoc signature (Gatekeeper will warn)"
  STAGING="$RELEASE_DIR/.dmg-staging"
  rm -rf "$STAGING" && mkdir -p "$STAGING"
  cp -R "$APP_PATH" "$STAGING/"
  ln -s /Applications "$STAGING/Applications"
  [[ ! -e "$FINAL_DMG" ]] || fail "release artifact already exists: $FINAL_DMG"
  hdiutil create -volname "$PRODUCT_NAME $VERSION" -srcfolder "$STAGING" \
    -format UDZO "$FINAL_DMG"
  rm -rf "$STAGING"
fi

# 5. Checksums + release notes
say "Step 5/5 — checksums and release notes"
cd "$RELEASE_DIR"
FINAL_DMG="${PRODUCT_NAME}_${VERSION}_aarch64.dmg"
shasum -a 256 "$FINAL_DMG" > "$FINAL_DMG.sha256"
cat > "RELEASE-NOTES-$VERSION.md" <<EOF
# Meetily2 $VERSION

Apple Silicon(macOS 14.2+)용 로컬 실시간 통역 앱.

## 설치 흐름
1. DMG를 열고 Meetily2를 Applications로 복사
2. 앱 실행 (개발용 ad-hoc DMG는 Gatekeeper 경고가 표시될 수 있음)
3. 모델 다운로드 마법사 (통역용 Whisper + Qwen 외에 회의록용 모델도 설치될 수 있음. 첫 설치 전 여유 공간 15GB 권장)
4. 마이크·컴퓨터 소리 권한 허용
5. 실시간 통역 또는 회의 녹음 선택. 통역 화면은 왼쪽 일본어 전사, 오른쪽 한국어 통역

## 모델 프로바이더
- **DeepSeek API 추가** — 설정에서 DeepSeek 선택 후 API 키 입력, 모델 deepseek-flash(V4.1-Flash) / deepseek-chat / deepseek-reasoner
- **OpenAI 모델 목록 최신화** — gpt-5.4 / gpt-5.4-mini / gpt-5.3 / gpt-5.1 / gpt-5 등

## 화자 표시·안정화
- 화자 표시 — 마이크(나)/컴퓨터 소리(상대) 우세량으로 발언별 배지 표시, 자막 내보내기에 포함
- 외부 URL 열기 http(s) 전용 검증, 파일시스템 권한 축소 (fs read-all/write-all 제거)
- 모델 다운로드 중단 시 이어받기(전송 중단만 보존, 시작 실패는 정리)
- 전사 대기열 상한(128세그먼트)·드롭 계수·실측 대기열 상태 표시, 녹음 중지 대기 90초/저장 120초로 상한
- 지연 벤치마크 스크립트(scripts/benchmark.sh)

## 보안·안정성 수정
- 파일 읽기/쓰기 Tauri 명령을 회의 저장 위치로 한정 (전체 디스크 접근 차단)
- 중지 버튼 이중 호출 시 전사 유실 방지(단일 중지 게이트)
- API 키가 콘솔 로그에 출력되지 않도록 마스킹
- 로컬 서비스 감시자가 재시작 실패 시 지수 백오프로 5회 재시도
- 첫 실행 마법사가 모델 부재 시 정상 표시되도록 수정

## 구성
- 앱 + localhost 서버 + Whisper + Ollama 모두 내장, 별도 개발 도구 불필요
- 모델은 첫 실행 때 다운로드되어 사용자 데이터 영역에 저장 (앱 업데이트 후 재사용)
- 이전 대화를 시간순 미리보기에서 선택하면 일본어·한국어 두 창이 해당 구간으로 이동
- 통역 모델은 마지막 요청 후 5분 동안 유지되어 사용하지 않을 때 메모리 반환
- 네이티브 음성 스트림은 소비 속도보다 빠르게 쌓이면 과도한 메모리 증가 대신 오류를 표시하고 안전하게 중지
- 서명: $(/usr/bin/codesign -dv "$APP_PATH" 2>&1 | grep "Authority" | head -1 || echo "ad-hoc (dev)")
EOF

say "Done."
echo
ls -la "$RELEASE_DIR"
echo
echo "Checksum: $(cat "$FINAL_DMG.sha256")"
if [[ "$MODE" == "dev" ]]; then
  cat <<'NOTE'

NOTE: This is a DEV build with an ad-hoc signature. Other Macs will show a
Gatekeeper warning (right-click → Open) or refuse to run it if quarantined.
For a distributable build run: scripts/build-dmg.sh --dist (requires an
Apple Developer ID Application certificate).
NOTE
fi
