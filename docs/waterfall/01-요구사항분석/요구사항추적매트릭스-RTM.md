# 요구사항 추적 매트릭스 (RTM)

> 요구사항을 유스케이스·설계·소스·시험과 연결한다.

| 항목 | 내용 |
|------|------|
| 프로젝트명 | Meetily2 |
| 문서 번호 | WF-01-03 |
| 문서 버전 | v0.2 |
| 작성일 | 2026-09-25 |
| 수정일 | 2026-09-25 |
| 작성자 | Codex (AI 문서 초안) |
| 승인자 | 미지정 (승인 기록 없음) |
| 문서 상태 | 검토 초안 (릴리스 승인 아님) |

---

## 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| v0.1 | 2026-09-25 | Codex | Meetily2 단계별 초안 작성 |
| v0.2 | 2026-09-25 | Codex | 문서 정보·변경 이력·목차·번호 체계와 개요 보강 |

---

## 목차

1. [문서 개요](#1-문서-개요)
2. [목적과 추적 범위](#2-목적과-추적-범위)
3. [상태 정의](#3-상태-정의)
4. [기능 요구사항 추적 매트릭스](#4-기능-요구사항-추적-매트릭스)
5. [비기능 요구사항 추적 매트릭스](#5-비기능-요구사항-추적-매트릭스)
6. [커버리지 요약](#6-커버리지-요약)
7. [구현 상세 참조](#7-구현-상세-참조)
8. [RTM 갱신 절차](#8-rtm-갱신-절차)
9. [차기 릴리스 검증 우선순위](#9-차기-릴리스-검증-우선순위)
10. [ID 체계](#10-id-체계)

---

## 1. 문서 개요

### 1.1 목적

요구사항을 유스케이스·설계·소스·시험과 연결한다.

### 1.2 적용 범위와 독자

FR-01~FR-09 및 NFR-01~NFR-04의 추적 관계를 다룬다. 제품 기획·개발·QA·릴리스 검토자가 사용한다.

### 1.3 기준과 판정

이 문서는 2026-09-25의 소스와 기록을 바탕으로 한 **검토 초안**이다. 문서화·코드 구현·실행 검증·일반 배포 승인은 서로 다른 상태다.

`소스`는 구현 위치이고 `TC`는 검증할 케이스다. TC가 문서에 있어도 실행 증거가 없으면 통과가 아니다. 각 요구사항의 현재 판정은 [SRS](요구사항명세서-SRS.md)와 [결과 보고서](../05-테스트/테스트결과보고서.md)를 따른다.

---

## 2. 목적과 추적 범위

요구사항 ID → 사용자 흐름 → 설계·소스 → 테스트 케이스 → 실행 결과를 한 줄로 추적한다. 범위는 [SRS](요구사항명세서-SRS.md)의 기능 9건과 비기능 4건이다. 계획된 TC는 통과 증거가 아니다.

---

## 3. 상태 정의

| 상태 | 의미 |
|------|------|
| 구현 | 대응 소스가 현재 체크아웃에 존재 |
| 부분 검증 | 특정 후보·Mac·짧은 시나리오에서 실행 기록 존재 |
| 미검증 | 수용에 필요한 E2E 또는 장시간 결과 부재 |
| 배포 차단 | 일반 배포 게이트의 필수 항목 미충족 |

---

## 4. 기능 요구사항 추적 매트릭스

| 요구사항 | 유스케이스 | 설계 | 핵심 소스 | 시험 | 관련 정책 |
| --- | --- | --- | --- | --- | --- |
| FR-01 | UC-01/02 | 화면·상세 | `src/local/components/SessionModeChooser.tsx`, `src/local/recordingPolicy.ts` | TC-01 | BP-MODE |
| FR-02 | UC-01 | SAD·상세 | `src/local/native/tauriPcmCapture.ts`, `src-tauri/src/audio/` | TC-02 | BP-SOURCE |
| FR-03 | UC-01 | 상세·API | `src/local/native/interpretationQueue.ts`, `local-server/app.ts` | TC-03 | BP-LIVE |
| FR-04 | UC-01 | 상세·화면 | `src/local/native/interpretationQueue.ts`, `src/local/components/InterpretationView.tsx` | TC-03/04 | BP-LIVE, BP-AI |
| FR-05 | UC-01 | 화면·상세 | `src/local/components/InterpretationView.tsx` | TC-04 | BP-LIVE |
| FR-06 | UC-02/03 | DB·API | `local-server/database.ts`, `local-server/app.ts` | TC-05/06 | BP-DATA |
| FR-07 | UC-03 | API·DB | `local-server/app.ts`, `local-server/inference.ts` | TC-06 | BP-DATA, BP-AI |
| FR-08 | UC-04 | SAD·화면 | `local-server/index.ts`, `src/local/components/` | TC-07 | BP-LOCAL |
| FR-09 | UC-05 | 배포·화면 | `src-tauri/src/local_runtime.rs`, `src/components/ModelDownloadProgress.tsx` | TC-10 | BP-LOCAL, BP-ERROR |

---

## 5. 비기능 요구사항 추적 매트릭스

| 요구사항 | 유스케이스 | 설계 | 핵심 소스 | 시험 | 관련 정책 |
| --- | --- | --- | --- | --- | --- |
| NFR-01 | UC-04 | SAD·API | `local-server/index.ts`, `local-server/security.ts` | TC-08 | BP-LOCAL |
| NFR-02 | UC-01 | 품질 | `src/local/native/interpretationQueue.ts` | TC-02/09 | BP-AI |
| NFR-03 | UC-01/02 | 상세·테스트 | 캡처·큐·timeline 경로 전체 | TC-09 | BP-LIVE, BP-ERROR |
| NFR-04 | UC-05 | 배포 | `scripts/build-dmg.sh` | TC-10 | BP-RELEASE |

---

## 6. 커버리지 요약

| 항목 | 문서상 연결 | 실제 통과 해석 |
|------|--------------|----------------|
| 기능 요구사항 | 9/9가 유스케이스·설계·TC에 연결 | 각 TC의 실행 증거는 후보별로 별도 확인 |
| 비기능 요구사항 | 4/4가 설계·TC에 연결 | 지연·메모리·일반 배포는 미통과 |
| 테스트 케이스 | TC-01~TC-10 문서화 | 테스트 계획만으로 완료 인정 금지 |

---

## 7. 구현 상세 참조

상대 소스 경로의 기준은 `v2.0/meetily/frontend/`이며 `scripts/`만 `v2.0/` 기준이다. 변경 시 요구사항 ID → 설계 → 코드 → 테스트 결과 순으로 함께 갱신한다.

주요 소스는 `v2.0/meetily/frontend/`의 UI·Tauri·local-server이고, DMG 스크립트는 `v2.0/scripts/`에 있다.

---

## 8. RTM 갱신 절차

기능 변경 시 SRS ID를 확인하고 설계·소스·TC·실행 결과를 같은 변경에서 갱신한다. 삭제·통합한 요구사항은 추적 이력을 남긴다. 새 후보에서 예전 후보의 통과 기록을 자동 승계하지 않는다.

---

## 9. 차기 릴리스 검증 우선순위

혼합 오디오 정확도·무음 환각, 30~60분 메모리, 회의록 E2E, 브라우저 입력, 서명·공증·다른 Mac 설치가 차기 수용 항목이다. 순서는 [로드맵](../08-검토/우선순위-로드맵.md)을 따른다.

---

## 10. ID 체계

`FR-xx`는 기능, `NFR-xx`는 비기능, `UC-xx`는 사용자 흐름, `TC-xx`는 시험을 뜻한다. 정책은 `BP-`로 표기한다. 정책 ID는 [비즈니스 정책](../00-기획/비즈니스정책서.md)에서 관리한다.
