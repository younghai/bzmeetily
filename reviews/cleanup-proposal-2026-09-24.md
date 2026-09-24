# Meetily2 폴더 정리 및 삭제 기록 (2026-09-24)

`$MEETING_ROOT`는 이 GitHub용 복사본의 상위 폴더를 뜻하는 문서용 표기다.

아래 용량은 삭제 전 `du -sh` 기준 반올림 값이다. 사용자가 승인한 다섯 경로만 삭제했다. 사용자가 **절대 삭제 금지**로 지정한 `$MEETING_ROOT/v2.0/meetily/target/debug`는 보존했고, 삭제 전후 디렉터리 inode가 `39368979`로 동일하며 크기도 약 14 GB다. 이후 2·3회차 점검과 릴리스 빌드에 필요한 입력물은 유지했다.

GitHub 제출용 복사본은 루트 `README.md`·`.gitignore`, 점검 상태와 결과를 담는 `reviews/`, 자동 점검 절차인 `skills/meetily2-release-cycle/`, 실행 소스인 `v2.0/`으로 나뉜다. `v2.0/meetily/frontend/`에는 화면(`src/`), localhost 서버(`local-server/`), Tauri/Rust 앱(`src-tauri/`), 테스트가 있다. `v2.0/meetily/backend/`는 서버·Whisper 관련 소스이며 `v2.0/scripts/`는 엔진 확보와 DMG 빌드 절차다. 상위 `$MEETING_ROOT/`에는 이 복사본 외에 기존 `v2.0/` 작업본, 이전 `meetily/` 작업본, 설치 파일, 실행 스크립트, 검증 로그가 함께 있다.

## 구조와 용량 (삭제 전)

| 경로 | 크기 | 역할 |
| --- | ---: | --- |
| `$MEETING_ROOT/meetily2-github` | 832 MB | GitHub 제출용 복사본, 스킬, 점검 기록 |
| `meetily2-github/v2.0/meetily/frontend/.next` | 637 MB | Next.js 빌드 산출물 (그중 `cache` 629 MB) |
| `meetily2-github/v2.0/meetily/frontend/src-tauri/binaries` | 163 MB | 패키징 입력용 로컬 실행 엔진 |
| `meetily2-github/v2.0/meetily/frontend/out` | 5.7 MB | 정적 웹 출력물 |
| `$MEETING_ROOT/v2.0` | 22 GB | 기존 Meetily2 작업본 및 릴리스 |
| `v2.0/meetily/target/debug` | 14 GB | Rust 디버그 빌드 산출물 |
| `v2.0/meetily/target/release` | 5.9 GB | Rust 릴리스 빌드, 현재 앱 번들 포함 |
| `v2.0/meetily/frontend/node_modules` | 819 MB | 패키지 설치 결과 |
| `v2.0/meetily/frontend/.next` | 596 MB | 기존 작업본의 Next.js 빌드 출력 |
| `$MEETING_ROOT/meetily` | 16 GB | 이전 Meetily 작업본 |
| `meetily/target/debug` | 9.8 GB | 이전 버전 Rust 디버그 빌드 |
| `meetily/target/release` | 4.8 GB | 이전 버전 Rust 릴리스 빌드 |

새 GitHub 폴더의 `v2.0/meetily/target`과 `frontend/node_modules`는 **기존 `v2.0` 작업본을 가리키는 심볼릭 링크**다. 링크 자체의 크기는 0에 가깝다. 링크 안쪽에서 삭제하면 기존 작업본의 실제 파일이 지워진다. 이번 창 버튼 검증에 사용한 Meetily2 앱은 `v2.0/meetily/target/release/bundle/macos/Meetily2.app`에서 시작됐으며, 정리 조사 종료 시점에는 실행 중이지 않았다. 이전 `meetily/frontend/local-server`와 Whisper 서버는 별도로 실행 중이다.

## 승인 후 실행 결과

| 상태 | 정확한 경로 | 삭제 전 크기 | 영향·복원 |
| --- | --- | ---: | --- |
| 삭제 완료 | `$MEETING_ROOT/meetily2-github/v2.0/meetily/frontend/.next/cache` | 약 629 MB | 다음 빌드에서 캐시 재생성. |
| 삭제 완료 | `$MEETING_ROOT/meetily2-github/v2.0/meetily/frontend/out` | 약 5.7 MB | 다음 DMG 빌드 전 `pnpm build`로 재생성. |
| 삭제 완료 | `$MEETING_ROOT/meetily2-github/v2.0/meetily/frontend/tsconfig.tsbuildinfo` | 약 0.6 MB | 다음 TypeScript 검사에서 재생성. |
| 삭제 완료 | `$MEETING_ROOT/meetily/target/debug` | 약 9.8 GB | 이전 버전 Rust 디버그 빌드 시 재컴파일. |
| 삭제 완료 | `$MEETING_ROOT/v2.0/meetily/frontend/.next` | 약 596 MB | 다음 웹 빌드에서 재생성. |
| **삭제 금지·보존 확인** | `$MEETING_ROOT/v2.0/meetily/target/debug` | 약 14 GB | 사용자 지정 보호 대상. |

삭제 후 `meetily2-github`는 약 197 MB, 이전 `meetily` 작업본은 약 5.8 GB, 기존 `v2.0` 작업본은 약 21 GB다. 0.4.1·2.0.0·2.0.1 DMG와 릴리스 노트는 이번 승인 목록에 없어 그대로 보존했다.

`src-tauri/binaries`(163 MB)와 `src-tauri/resources/web-static`(5.7 MB)도 Git에는 포함되지 않는 재생성 산출물이지만, **다음 앱/DMG 빌드의 입력**이다. 전자는 `scripts/fetch-vendors.sh` 및 관련 빌드 단계, 후자는 프런트엔드 출력으로 복원한다. 외부 다운로드·컴파일이 필요할 수 있으므로 3회차 릴리스 판정 전에는 유지한다.

## 유지할 파일

- `frontend/src/`, `frontend/local-server/`, `frontend/src-tauri/src/`, `frontend/src-tauri/build/`: 앱·서버·빌드 스크립트 **소스**다. 이름에 `build`가 있어도 `src-tauri/build/ffmpeg.rs` 등은 삭제 대상이 아니다.
- `Cargo.lock`, `pnpm-lock.yaml`, `v2.0/scripts/`, 테스트와 마이그레이션: 재현 가능한 빌드·검증에 필요하다.
- `src-tauri/resources/licenses/`, 앱 아이콘, `frontend/public/`: 배포 리소스 또는 법적 고지다.
- `reviews/`, `skills/meetily2-release-cycle/`: 남은 두 차례 점검과 릴리스 판단의 기록·절차다.
- `v2.0/meetily/target/release/bundle/macos/Meetily2.app`과 `v2.0/release/Meetily2_2.0.1_aarch64.dmg`: 앱 재실행 및 기존 개발용 후보를 위해 유지한다.
- `$MEETING_ROOT/v2.0/meetily/target/debug`: 사용자가 절대 삭제 금지로 지정한 디버그 빌드다.

Git에 제출할 파일은 현재 634개, 실제 파일 크기 합계 약 17.3 MiB다. `target`, `node_modules`, `.next`, `out`, 실행 엔진, DMG, 모델·개인 오디오·환경 설정은 `.gitignore`로 제외되어 있다. 따라서 GitHub 업로드 크기를 줄이기 위해 필수 소스를 삭제할 필요는 없다. 향후 Git add/commit 전에 무시 규칙과 비밀값을 다시 확인한다.
