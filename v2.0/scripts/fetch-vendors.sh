#!/usr/bin/env bash
#
# Fetch and prepare the vendored runtime engines for the Meetily2 standalone
# build. Idempotent: re-running skips work that is already done.
#
# Produces (inside frontend/src-tauri):
#   binaries/ollama-aarch64-apple-darwin          Ollama server (arm64)
#   binaries/whisper-server-aarch64-apple-darwin  whisper.cpp server (Metal embedded)
#   binaries/meetily-server-aarch64-apple-darwin  bun-compiled local web/API server
#   resources/licenses/*                          third-party license texts
#
# Usage: scripts/fetch-vendors.sh [--force]
set -euo pipefail

V2_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_TAURI="$V2_ROOT/meetily/frontend/src-tauri"
BUILD_DIR="${TMPDIR:-/tmp}/meetily2-vendors"
WHISPER_VERSION="1.9.1"
# Pin the ollama release: the tarball layout (llama-server runner location) is
# not a stable contract, so every bump needs the bundle re-verified.
OLLAMA_VERSION="0.34.0"
mkdir -p "$BUILD_DIR"

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# 1. whisper.cpp server (standalone, Metal shaders embedded)
# ---------------------------------------------------------------------------
WHISPER_BIN="$SRC_TAURI/binaries/whisper-server-aarch64-apple-darwin"
if [[ -x "$WHISPER_BIN" && "$FORCE" != true ]]; then
  say "whisper-server already present: $WHISPER_BIN"
else
  say "Building whisper.cpp v$WHISPER_VERSION (Metal embedded)…"
  cd "$BUILD_DIR"
  if [[ ! -d "whisper.cpp-$WHISPER_VERSION" ]]; then
    curl -sL -o "whisper-$WHISPER_VERSION.tar.gz" \
      "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v$WHISPER_VERSION.tar.gz"
    tar xzf "whisper-$WHISPER_VERSION.tar.gz"
  fi
  cd "whisper.cpp-$WHISPER_VERSION"
  cmake -B build -DCMAKE_BUILD_TYPE=Release \
    -DGGML_METAL_EMBED=ON -DGGML_BLAS=OFF -DGGML_OPENMP=OFF \
    -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_SERVER=ON
  cmake --build build --target whisper-server -j "$(sysctl -n hw.ncpu)"
  mkdir -p "$SRC_TAURI/binaries"
  cp build/bin/whisper-server "$WHISPER_BIN"
  say "whisper-server built ($(du -h "$WHISPER_BIN" | cut -f1))"
fi

# ---------------------------------------------------------------------------
# 2. Ollama (arm64 slice of the official macOS bundle)
# ---------------------------------------------------------------------------
OLLAMA_BIN="$SRC_TAURI/binaries/ollama-aarch64-apple-darwin"
if [[ -x "$OLLAMA_BIN" && "$FORCE" != true ]]; then
  say "ollama already present: $OLLAMA_BIN"
else
  say "Downloading official Ollama macOS bundle…"
  cd "$BUILD_DIR"
  curl -sL -o ollama-darwin.tgz \
    "https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-darwin.tgz"
  rm -rf ollama-extract && mkdir ollama-extract
  tar xzf ollama-darwin.tgz -C ollama-extract
  mkdir -p "$SRC_TAURI/binaries"
  lipo -thin arm64 ollama-extract/ollama -output "$OLLAMA_BIN"
  # ollama 0.34+ spawns llama-server as its inference runner and looks for it
  # next to itself; bundle the arm64 slice alongside the ollama binary.
  lipo -thin arm64 ollama-extract/llama-server \
    -output "$SRC_TAURI/binaries/llama-server-aarch64-apple-darwin"
  mkdir -p "$SRC_TAURI/resources/licenses"
  for license in GO_LICENSE LLAMA_CPP_LICENSE MLX_LICENSE MLX_C_LICENSE; do
    [[ -f "ollama-extract/$license" ]] && cp "ollama-extract/$license" "$SRC_TAURI/resources/licenses/OLLAMA_$license"
  done
  say "ollama vendored ($(du -h "$OLLAMA_BIN" | cut -f1))"
fi

# ---------------------------------------------------------------------------
# 3. meetily-server (bun single-file executable of local-server/)
# ---------------------------------------------------------------------------
SERVER_BIN="$SRC_TAURI/binaries/meetily-server-aarch64-apple-darwin"
if ! command -v bun >/dev/null 2>&1; then
  export PATH="$HOME/.bun/bin:$PATH"
fi
say "Compiling meetily-server with bun…"
cd "$V2_ROOT/meetily/frontend"
bun build --compile local-server/index.ts --outfile "$SERVER_BIN"
say "meetily-server compiled ($(du -h "$SERVER_BIN" | cut -f1))"

# ---------------------------------------------------------------------------
# 4. Static resources
# ---------------------------------------------------------------------------
say "Refreshing bundled resources…"
mkdir -p "$SRC_TAURI/resources/whisper-public"
if [[ -d "$V2_ROOT/meetily/frontend/out" ]]; then
  rm -rf "$SRC_TAURI/resources/web-static"
  cp -R "$V2_ROOT/meetily/frontend/out" "$SRC_TAURI/resources/web-static"
else
  echo "warning: frontend/out missing — run the frontend build before packaging web-static" >&2
fi
rm -rf "$SRC_TAURI/resources/whisper-public"
cp -R "$V2_ROOT/meetily/frontend/public" "$SRC_TAURI/resources/whisper-public"
mkdir -p "$SRC_TAURI/resources/licenses"
cat > "$SRC_TAURI/resources/licenses/README.txt" <<'EOF'
Third-party licenses for components bundled with Meetily2:
- ollama (MIT) and its vendored llama.cpp / MLX components — see OLLAMA_* files
- whisper.cpp (MIT) — see WHISPER_CPP_LICENSE
- FFmpeg sidecar binary — downloaded at build time; license shown by `ffmpeg -version`
- bun runtime (MIT) compiled into meetily-server
EOF
if [[ ! -f "$SRC_TAURI/resources/licenses/WHISPER_CPP_LICENSE" ]]; then
  curl -sL -o "$SRC_TAURI/resources/licenses/WHISPER_CPP_LICENSE" \
    "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v$WHISPER_VERSION/LICENSE"
fi

say "Vendors ready."
