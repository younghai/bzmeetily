# Meetily2 — 독립 실행형 실시간 통역 (v2.0)

업데이트: 2026-09-15 · Apple Silicon (macOS 14.2+) 전용

이 폴더는 Meetily v0.4.1 포크에 **일본어→한국어 실시간 통역**을 얹고, **다른 Mac에서 앱 설치만으로 동작**하도록 재구성한 단독 배포 프로젝트입니다. 원본 Meetily(`com.meetily.ai`)와 이름·데이터·자동 업데이트가 분리되어 함께 설치됩니다.

## 최종 사용자 흐름

```
DMG 설치 → 앱 실행 → 모델 다운로드 마법사 → 음성 권한 허용 → 실시간 통역 시작
```

- **모드 선택**: 앱을 열면 "어떤 작업을 시작할까요?" 화면에서 실시간 통역 / 회의 녹음을 선택합니다.
- **실시간 통역**: 왼쪽 창 일본어 전사, 오른쪽 창 한국어 통역. 발언 문맥 갱신 방식으로 약 1.5초마다 자막을 보완하고, 말을 멈추면 구간을 확정합니다. 통역 내용은 저장하지 않습니다.
- **모델**: Whisper large-v3-turbo(전사, 약 1.6GB) + Qwen 3.5 4B(통역·요약, 약 3.4GB)를 첫 실행 때 내려받습니다. 이어받기·재시도·용량 확인을 제공합니다. 이후에는 오프라인으로 통역 가능합니다.

## 아키텍처 (단독 실행의 핵심)

앱이 런타임을 소유합니다. `src-tauri/src/local_runtime.rs`가 다음 세 서비스를 앱 내장 바이너리로 실행·감시합니다:

| 서비스 | 포트 | 내장 바이너리 | 역할 |
|---|---|---|---|
| meetily-server | 3118 | `meetily-server` (bun 컴파일 단일 실행 파일) | 웹 UI·회의 DB·번역/전사 API |
| whisper-server | 8178 | `whisper-server` (whisper.cpp 1.9.1, Metal 내장) | 음성 전사 |
| ollama | 11434 | `ollama` + `llama-server` (공식 빌드, arm64) | Qwen 3.5 4B 추론 |

- **Homebrew·Node·Bun·Python 의존 없음**: 모든 런타임이 앱 번들(`Contents/MacOS`, `Contents/Resources/resources/`) 안에 들어갑니다.
- **앱·웹 동일 파이프라인 (T02 통합)**: 네이티브 앱의 실시간 통역은 Rust 오디오 캡처(Core Audio tap+마이크, 적응형 믹싱)로 받은 raw PCM을 웹뷰로 스트리밍(`live-pcm` 이벤트)하고, 웹과 **동일한** `LiveAudioChunker`(문맥 갱신)·`OrderedUploadQueue`(대기열 병합·재시도)·`InterpretationQueue`(번역 취소/재시도)를 사용합니다. (`src/audio/live_pcm.rs`, `src/local/native/tauriPcmCapture.ts`)
- **포트 충돌·중복 실행**: 이미 뜬 서비스가 같은 데이터 디렉터리를 쓰면 재사용하고, 다른 데이터/다른 앱이면 안내 후 중단됩니다. 앱이 시작한 프로세스만 종료하며, 앱 종료 시 함께 정리됩니다.
- **데이터 분리 (T01)**: 번들 ID `ai.meetily.interp`, 데이터는 `~/Library/Application Support/ai.meetily.interp/`. 원본 앱의 업데이터 경로는 제거했습니다.

## 폴더 구조

```
v2.0/
├── README.md                  ← 이 문서
├── docs/
│   ├── distribution-dmg.md    ← 배포 작업 현황 (T01~T08)
│   └── clean-mac-checklist.md ← 깨끗한 Mac 최종 검증 체크리스트
├── scripts/
│   ├── fetch-vendors.sh       ← 내장 엔진 확보 (whisper.cpp 빌드, ollama, bun 컴파일)
│   ├── build-dmg.sh           ← 전체 빌드 + DMG 제작 (+ --dist 서명/공증)
│   └── smoke-test.sh          ← 설치 후 자동 스모크 테스트
├── meetily/                   ← 프로젝트 소스 (아래 참고)
└── release/                   ← 빌드 산출물 (DMG, 체크섬, 릴리스 노트)
```

소스의 주요 변경 위치:

- `frontend/src-tauri/src/local_runtime.rs` — 서비스 런타임·모델 설치 명령 (신규)
- `frontend/src-tauri/src/audio/live_pcm.rs` — 웹뷰 PCM 스트리밍 통역 (신규)
- `frontend/src-tauri/src/audio/pipeline.rs` — 믹스 오디오 raw 탭 추가
- `frontend/src-tauri/src/whisper_engine/whisper_engine.rs` — 다운로드 HTTP Range 재개
- `frontend/src/local/components/SetupWizard.tsx` — 첫 실행 모델/권한 마법사 (신규)
- `frontend/src/local/native/{tauriPcmCapture.ts,NativeInterpretation.tsx}` — 앱 통역을 웹 파이프라인으로 전환
- `frontend/local-server/*` — 신원 확인(instanceId), 신규 DB 자동 스키마 생성
- `frontend/src-tauri/tauri.conf.json` — 식별자·버전·사이드카·리소스·업데이터 제거

## 빌드

```sh
# 개발용 (ad-hoc 서명, 다른 Mac 테스트용으로는 부적합)
scripts/build-dmg.sh

# 배포용 (Apple Developer ID 서명 + 공증 필요)
export MACOS_SIGNING_IDENTITY="Developer ID Application: ..."
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
scripts/build-dmg.sh --dist
```

산출물: `release/Meetily2_<버전>_aarch64.dmg` + `.sha256` + 릴리스 노트.

## 알려진 제한

- Apple Silicon 전용. Intel 지원은 별도 범위.
- 첫 빌드(백그라운드의 whisper.cpp 컴파일, ollama 다운로드)에는 네트워크가 필요합니다.
- 일반 배포 DMG는 Apple Developer 계정·인증서 없이는 서명·공증되지 않습니다 (dev 빌드는 Gatekeeper 경고 표시).
