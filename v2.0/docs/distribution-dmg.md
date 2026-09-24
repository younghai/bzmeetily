# DMG 제작 현황 (v2.0–v2.0.2 RC4)

이 문서의 `$MEETING_ROOT`는 GitHub용 작업 폴더의 상위 로컬 디렉터리를 뜻한다.

## 2026-09-24: v2.0.2 RC4 실험용 개발 후보

`v2.0/release/Meetily2_2.0.2-rc.4_aarch64.dmg`를 별도 이미지로 제작했습니다. SHA-256은 `a2c8c6feeffed59baf6be60acade1ec71ca356d266071c3f864807fcff8c6030`입니다. 앱 번들에 빌드 Mac의 홈 경로가 포함되지 않는지 검사하고, DMG 체크섬·이미지·ad-hoc 서명을 검증했습니다. 원본/기존 후보 DMG는 덮어쓰지 않았습니다.

RC3 실기에서 간헐적인 Core Audio 시작 멈춤을 재현했습니다. RC4는 컴퓨터 소리 초기화를 별도 작업으로 옮기고 시간 제한과 사용자 오류 메시지를 추가했지만, 이 Mac이 잠겨 있어 RC4의 음성 E2E를 아직 완료하지 못했습니다. 따라서 RC4는 **실험용 사전 릴리스**이며, 일반 배포 게이트는 통과하지 않았습니다. 상세 내용은 [RC4 릴리스 노트](release-2.0.2-rc.4.md)와 [통역 품질 검토](interpretation-quality.md)를 참고하세요.

## 2026-09-24: v2.0.2 RC1 개발용 후보

`v2.0/release/Meetily2_2.0.2-rc.1_aarch64.dmg`를 새 버전으로 빌드했습니다. SHA-256은 `4d90409e0755c86e8d34138a274e137e78bb9d7ba2885d1286d6eb9f92c1f8cc`입니다. 기존 2.0.0·2.0.1 DMG는 덮어쓰지 않았습니다. 수정된 대화별 타임라인, 이전 두 발언 문맥을 활용한 어조 유지, 수정된 일본어 원문과 오래된 한국어 번역의 불일치 방지, 화면 공유 중 오른쪽 상단 창 제어를 포함합니다.

빌드 Mac의 실제 앱에서 26초 일본어 재생 중 4개 타임라인 카드와 좌우 자막을 확인했고, DMG 체크섬·이미지·앱 ad-hoc 서명을 검사했습니다. 전체 증거와 남은 항목은 [3회차 점검](../../reviews/pass-03.md), 사용자 안내는 [릴리스 노트](release-2.0.2-rc.1.md)에 있습니다. **일반 배포는 보류**합니다. 유효한 Developer ID 인증서가 없고 공증·다른 Mac 설치/권한/모델 다운로드, 장시간 메모리, 브라우저 음성 입력, 실제 혼합 오디오 정확도 검증이 남았습니다. GitHub에는 사전 릴리스 개발용 후보로만 게시합니다.

## 2026-09-24: v2.0.1 개발용 후보

기존 `release/Meetily2_2.0.0_aarch64.dmg`는 이번 변경을 포함하지 않습니다. 새 빌드는 `release/Meetily2_2.0.1_aarch64.dmg`이며 SHA-256은 `8eb26173b31293f84e799fa0c96653f26f6c4e52c5d2b104a078f8e7ee284c73`입니다. 이는 **ad-hoc 서명된 개발용 후보**이고, 일반 배포용으로 승인된 릴리스는 아닙니다.

- 화면: 시작 전에 실시간 통역과 회의 녹음을 선택하고, 통역 화면은 일본어 전사와 한국어 통역을 나란히 표시합니다. 과거 대화 타임라인을 눌러 두 창에서 이전 내용을 확인할 수 있습니다.
- 처리: 네이티브 PCM과 캡처 대기열을 제한해 처리 지연 시 메모리가 무한히 늘지 않도록 했고, 과부하 오류를 화면으로 전달합니다. Ollama 통역 모델은 마지막 요청 후 5분 동안 유지됩니다. 마이크·컴퓨터 소리 혼합 창의 중복 시간 문제를 수정했습니다.
- 자동 검사: 프론트엔드 로컬 테스트 90개 통과, Rust 혼합 오디오 테스트 3개 통과, 프론트엔드 빌드·Rust 검사·DMG 체크섬 및 이미지 검증 통과.
- 앱 실기 확인: DMG에서 실행한 앱의 모드 선택, 통역 시작·중지, 좌우 자막, 과거 타임라인은 확인했습니다. 그러나 이 Mac에서 컴퓨터 소리만 선택하고 21.5초 일본어 샘플을 재생하면 전사가 나오지 않았습니다. Core Audio 진단 로그상 스트림은 시작됐지만 처리된 입력 청크는 0개였습니다. 마이크+컴퓨터 소리 모드에서는 샘플과 다른 전사도 나왔습니다. 같은 WAV를 Whisper 서버에 직접 보내면 올바른 일본어 문장이 반환되므로 네이티브 입력 경로의 정확도는 **미검증/실패**입니다.
- localhost: 앱 실행 중 `127.0.0.1:3118/api/local/status`에서 Whisper `large-v3-turbo`와 Ollama `qwen3.5:4b` 준비 상태를 확인했습니다. 브라우저 통역 화면은 열렸지만 이 QA 환경에서는 브라우저의 화면 오디오 캡처가 시작되지 않아 웹 음성 입력의 끝단 검증도 남았습니다. 앱 종료 시 번들 로컬 서버도 종료됩니다.
- 권한: macOS 설정에는 Meetily2의 시스템 오디오 권한이 켜져 있으나, 재적용에는 Touch ID 또는 관리자 암호가 필요해 수행하지 않았습니다. 진단 시 Core Audio 스트림 시작과 중지가 수십 초 이상 지연된 사례도 있습니다.
- 배포 차단: 이 Mac에 유효한 Developer ID 서명 인증서가 없어서 공증을 진행하지 못했고, 다른 Mac에서 설치·권한·모델 다운로드·30~60분 연속 통역을 검증하지 못했습니다. 시스템 오디오 경로를 해결하고 이 항목들을 통과하기 전까지 일반 배포에 사용하지 마세요.

아래 내용은 2026-09-15 기준 v2.0 작업 기록입니다.

작성: 2026-09-15. 이 문서는 `meeting/meetily/docs/plans/distribution-dmg.md`(T01~T08)의 v2.0 실행 결과와 남은 작업을 기록합니다.

## 요약

`$MEETING_ROOT/v2.0/`에 단독 실행 프로젝트를 새로 만들고, T01~T07 구현과 dev 빌드(DMG)까지 완료했습니다.

- 산출물: `v2.0/release/Meetily2_2.0.0_aarch64.dmg` (약 86MB, 앱 번들 222MB)
- 앱 + localhost 서버 + Whisper + Ollama 모두 내장, 모델은 첫 실행 때 다운로드
- 남은 작업: T08(다른 Mac 실기 검증)과 일반 배포를 위한 서명·공증(Developer ID 필요)

## 작업별 현황

### T01 배포 대상·앱 설정 — 완료
- 번들 ID `ai.meetily.interp`, 제품명 `Meetily2`, 버전 2.0.0, macOS 14.2+(Core Audio tap 요구), Apple Silicon 전용
- 데이터 분리: `~/Library/Application Support/ai.meetily.interp/` (원본 `com.meetily.ai`와 무간섭)
- 원본 저장소를 향한 자동 업데이터 제거 (플러그인·설정·프론트엔드 check 비활성화)
- 번들 타깃을 app/dmg로 축소 (Windows/Linux 제거)

### T02 최신 통역 기능의 앱 통합 — 완료 (구조적으로 해결)
9/15 웹 지연 개선을 앱에 "이식"하는 대신, 앱이 웹과 **같은 파이프라인을 공유**하도록 재구성했습니다. 앱과 웹의 동작이 구조적으로 동일해집니다.

- Rust: 오디오 캡처(마이크+시스템 tap, 적응형 믹싱, 장치 핫스왑)는 기존 파이프라인 유지, 믹스된 raw PCM(600ms 창)을 웹뷰로 스트리밍하는 탭 추가 (`audio/pipeline.rs`, `audio/live_pcm.rs`)
- 웹뷰: 받은 PCM을 웹과 동일한 `LiveAudioChunker`(1.5초 문맥 갱신·0.24초 무음 확정·8초 경계)에 투입, 전사는 whisper-server(:8178), 번역은 meetily-server(:3118)→Ollama 경로 공유 (`src/local/native/tauriPcmCapture.ts`)
- 실시간 통역은 저장 없음(기존 정책 유지), 시작 전 모드 선택, 중지 후 자막 유지 모두 유지
- 검증: 앱 실행 후 실제 마이크/시스템 소리로 좌 JA·우 KO 자막 확인 필요 → T08 체크리스트 4번 항목

### T03 실행 엔진·서버 내장 — 완료
- `meetily-server`: local-server를 bun `--compile`로 단일 실행 파일화 (신규 DB 스키마 자동 생성 포함)
- `whisper-server`: whisper.cpp 1.9.1 소스 빌드, Metal 셰이더 내장(GGML_METAL_EMBED), 외부 dylib 0개
- `ollama`: 공식 macOS 배포 tarball에서 arm64 슬라이스, GPU 러너 내장(실행 시 Metal 자동 발견 확인)
- ffmpeg·llama-helper: 기존 사이드카 유지
- 리소스: `resources/web-static`(웹 UI), `resources/whisper-public`(오디오 워크렛), `resources/licenses`(제3자 고지)
- Homebrew/Node/Bun/Python 전면 불필요

### T04 첫 실행 모델 설치 — 완료 (구현), 실다운로드 검증은 T08에서
- Whisper: 기존 `whisper_download_model`에 HTTP Range 이어받기 추가, 진행률 이벤트·취소 유지
- Qwen: Ollama `/api/pull` 스트리밍 진행률 파싱 → `ollama-pull-progress` 이벤트, 취소 명령 추가
- 용량 확인(여유 <9GB 경고), 진행률 바, 실패 재시도, 중단 재개를 `SetupWizard.tsx`에서 제공
- 모델은 사용자 데이터 영역(`.../ai.meetily.interp/models/`)에 저장 → 앱 업데이트 후 재사용
- 참고: 앱 기존 온보딩이 Parakeet(639MB)·요약 GGUF(2.6GB)를 자동 내려받는 기존 동작은 유지됨 (회의 녹음 모드에 필요)

### T05 서비스 자동 실행·복구 — 완료
- 앱 setup에서 `ensure_runtime` 실행: meetily-server → ollama → whisper-server(모델 있을 때) 순차 기동, 헬스 대기
- 이미 뜬 호환 서비스 재사용, **다른 데이터 디렉터리를 쓰는 서버는 거부**(instanceId 확인), 앱이 시작한 프로세스만 종료
- 자식 프로세스 감시: 비정상 종료 시 3초 후 자동 재기동, 앱 종료 시 함께 종료(kill_on_drop)
- 개발 Mac의 LaunchAgents(local-services.sh) 방식과 병행 가능하나, v2.0은 앱 자체 관리가 원칙

### T06 권한·음성 입력 — 완료
- 마법사 권한 단계: 마이크(시스템 설정 연결), 컴퓨터 소리(오디오 캡처 권한 연결), 로컬 처리 고지
- 장치 선택(마이크/컴퓨터 소리/둘 다), 장치 분리·재연결 복구, 권한 거부 안내는 기존 네이티브 구현 재사용

### T07 서명·공증·DMG 자동화 — 완료 (스크립트), 공증 실행은 계정 필요
- `scripts/fetch-vendors.sh`(엔진 확보, 멱등) + `scripts/build-dmg.sh`(전체 빌드+DMG+체크섬+릴리스 노트)
- `--dist` 모드: 내부 Mach-O 전부 codesign(hardened runtime+entitlements) → notarytool 공증 → staple → DMG 재생성
- 현재 산출물은 **ad-hoc 서명 dev 빌드** — 다른 Mac에서 우클릭→열기 필요, 일반 배포 불가

### T08 깨끗한 Mac 최종 검증 — 미착수 (별도 Mac 필요)
- `docs/clean-mac-checklist.md` 준비 완료, `scripts/smoke-test.sh` 제공
- 완료 기준: 설치 → 모델 → 권한 → 일본어 입력 → 좌 전사·우 통역 → 중지·재실행, 30~60분 연속

## 로컬 검증 기록 (개발 Mac, 2026-09-15, 최종)

- `scripts/smoke-test.sh` 전 항목 통과: 서버 ready+신원, whisper /health, 톤 추론 응답, ollama 0.34.0+qwen3.5:4b, ja→ko 번역(한국어 출력), 루프백 전용 바인딩
- 실문장 번역 E2E: 「本日の会議にお集まりいただき…」→「오늘의 회의에 참석해 주셔서 감사합니다…」 3.3초(모델 로딩 포함)
- whisper-server 스탠드얼론: "using embedded metal library", 외부 dylib 없음
- ollama 스탠드얼론: Metal GPU 자동 발견(Apple M5 Max), llama-server 러너는 사이드카로 동반 번들(0.34 아키텍처)
- 종료 정리: 앱 종료 시 3118/8178/11434 모두 해제 확인
- 첫 실행 DB 경합 수정: 서버가 앱보다 먼저 스키마를 만들어 마이그레이션이 깨지는 문제를 스키마 소유권 정리(Rust 소유, 서버는 대기·복구)로 해결하고 재검증
- 앱 기동(재발견·수정 이슈 포함): 사이드카는 번들 시 접미사가 제거됨 → 런타임 경로 탐색 수정

## 남은 위험

1. **앱 통역 UI 실측**: 이 세션에서는 화면 캡처·접근성 권한이 없어 마법사/모드 선택/좌우 자막 화면을 사람 눈으로 확인하지 못함. API·프로세스 수준 검증은 모두 통과. 다른 Mac 검증(T08) 첫 단계로 수행할 것
2. **Qwen 풀다운로드 스트리밍**: `/api/pull` 진행률 파싱은 실제 3.4GB 다운로드에서 최종 확인 필요 (로컬 검증은 레지스트리 복사로 대체)
3. **서명·공증**: Apple Developer 계정·인증서 연결 후 `--dist` 재빌드 필요
4. **기존 온보딩 모델**: Parakeet(639MB)·요약 GGUF(2.6GB) 자동 다운로드가 통역 외 목적으로 추가 발생 — 필요 시 비활성화 검토
5. **개발 Mac 공존**: 이 Mac에서는 기존 LaunchAgents가 로그인 시 자동 기동되어 v2.0과 포트(3118/8178) 충돌. v2.0 사용 시 `Meetily-웹-종료.command` 실행 또는 LaunchAgents 제거 필요 (v2.0은 명확한 충돌 안내 표시)
