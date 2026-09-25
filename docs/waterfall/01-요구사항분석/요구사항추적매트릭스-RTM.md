# 요구사항 추적 매트릭스 (RTM)

`소스`는 구현 위치이고 `TC`는 검증할 케이스다. TC가 문서에 있어도 실행 증거가 없으면 통과가 아니다. 각 요구사항의 현재 판정은 [SRS](요구사항명세서-SRS.md)와 [결과 보고서](../05-테스트/테스트결과보고서.md)를 따른다.

| 요구사항 | 유스케이스 | 설계 | 핵심 소스 | 시험 |
| --- | --- | --- | --- | --- |
| FR-01 | UC-01/02 | 화면·상세 | `src/local/components/SessionModeChooser.tsx`, `src/local/recordingPolicy.ts` | TC-01 |
| FR-02 | UC-01 | SAD·상세 | `src/local/native/tauriPcmCapture.ts`, `src-tauri/src/audio/` | TC-02 |
| FR-03 | UC-01 | 상세·API | `src/local/native/interpretationQueue.ts`, `local-server/app.ts` | TC-03 |
| FR-04 | UC-01 | 상세·화면 | `src/local/native/interpretationQueue.ts`, `src/local/components/InterpretationView.tsx` | TC-03/04 |
| FR-05 | UC-01 | 화면·상세 | `src/local/components/InterpretationView.tsx` | TC-04 |
| FR-06 | UC-02/03 | DB·API | `local-server/database.ts`, `local-server/app.ts` | TC-05/06 |
| FR-07 | UC-03 | API·DB | `local-server/app.ts`, `local-server/inference.ts` | TC-06 |
| FR-08 | UC-04 | SAD·화면 | `local-server/index.ts`, `src/local/components/` | TC-07 |
| FR-09 | UC-05 | 배포·화면 | `src-tauri/src/local_runtime.rs`, `src/components/ModelDownloadProgress.tsx` | TC-10 |
| NFR-01 | UC-04 | SAD·API | `local-server/index.ts`, `local-server/security.ts` | TC-08 |
| NFR-02 | UC-01 | 품질 | `src/local/native/interpretationQueue.ts` | TC-02/09 |
| NFR-03 | UC-01/02 | 상세·테스트 | 캡처·큐·timeline 경로 전체 | TC-09 |
| NFR-04 | UC-05 | 배포 | `scripts/build-dmg.sh` | TC-10 |

상대 소스 경로의 기준은 `v2.0/meetily/frontend/`이며 `scripts/`만 `v2.0/` 기준이다. 변경 시 요구사항 ID → 설계 → 코드 → 테스트 결과 순으로 함께 갱신한다.
