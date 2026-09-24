#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/../../.." && pwd)
cidre_root=${CIDRE_ROOT:-$HOME/.cargo/git/checkouts/cidre-2c979cd9b38fdb3d/a9587fa/cidre}
test_root=${TEST_ROOT:-"$repo_root/target/native-build-support-test"}

cd "$cidre_root"
"$script_dir/xcodebuild" \
  -project ./pomace/pomace.xcodeproj \
  -sdk macosx \
  -arch arm64 \
  -configuration Release \
  -target av \
  build \
  MACOSX_DEPLOYMENT_TARGET=15.0 \
  "SYMROOT=$test_root"

archive="$test_root/Release/libav.a"
[[ -s "$archive" ]]
file "$archive" | grep -q 'current ar archive'
xcrun ar -t "$archive" | grep -q '^av[.]o$'

if "$script_dir/xcodebuild" \
  -project ./pomace/pomace.xcodeproj \
  -sdk iphoneos \
  -arch arm64 \
  -configuration Release \
  -target av \
  build \
  "SYMROOT=$test_root"; then
  printf 'expected unsupported SDK invocation to fail\n' >&2
  exit 1
fi

printf 'native-build-support test passed: %s\n' "$archive"
