# CommandLineTools fallback for cidre

Meetily's pinned `cidre` build script invokes `xcodebuild` to compile small Objective-C static libraries. On a macOS host with CommandLineTools but without the full Xcode app, prepend this directory to `PATH` for the Cargo command:

```sh
PATH="$PWD/frontend/scripts/native-build-support:$PATH" cargo build --release
```

The wrapper is intentionally narrow. It accepts only the pinned `cidre` project's macOS static-library invocation, validates every argument and target, and compiles each real `pomace/<target>/<target>.m` source with the CommandLineTools SDK, `clang`, and `libtool`. Other Xcode projects, Apple platforms, configurations, architectures, arguments, or implicit target builds fail closed.
