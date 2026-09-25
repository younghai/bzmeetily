# 로컬 API 설계서

> 실제 localhost API의 경로, 입출력과 보호 경계를 설명한다.

| 항목 | 내용 |
|------|------|
| 프로젝트명 | Meetily2 |
| 문서 번호 | WF-02-02 |
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
2. [API 설계 원칙](#2-api-설계-원칙)
3. [접근 제어와 공통 규격](#3-접근-제어와-공통-규격)
4. [엔드포인트 목록](#4-엔드포인트-목록)
5. [주요 요청과 응답 상세](#5-주요-요청과-응답-상세)
6. [오류 코드와 제한](#6-오류-코드와-제한)
7. [API 변경 관리](#7-api-변경-관리)

---

## 1. 문서 개요

### 1.1 목적

실제 localhost API의 경로, 입출력과 보호 경계를 설명한다.

### 1.2 적용 범위와 독자

Bun 로컬 서버의 /api/local 요청과 같은 Mac의 UI 호출을 대상으로 한다. 제품 기획·개발·QA·릴리스 검토자가 사용한다.

### 1.3 기준과 판정

이 문서는 2026-09-25의 소스와 기록을 바탕으로 한 **검토 초안**이다. 문서화·코드 구현·실행 검증·일반 배포 승인은 서로 다른 상태다.

기준 구현: [local-server/app.ts](../../../v2.0/meetily/frontend/local-server/app.ts), [Zod 계약](../../../v2.0/meetily/frontend/src/local/contracts.ts). 기본 주소는 앱이 실행 중인 같은 Mac의 `http://127.0.0.1:3118`; 공개 서버 API가 아니다. 모든 메서드는 실제 라우터를 기준으로 적었다.

---

## 2. API 설계 원칙

API는 같은 Mac의 앱/브라우저가 사용하는 로컬 계약이다. 응답은 성공·실패를 HTTP 상태와 구조화된 본문으로 구분한다. 전사/번역의 임시 요청과 회의 저장 요청은 서로 다른 경로다. 코드 기준은 [app.ts](../../../v2.0/meetily/frontend/local-server/app.ts)와 [contracts.ts](../../../v2.0/meetily/frontend/src/local/contracts.ts)다.

---

## 3. 접근 제어와 공통 규격

서버는 `127.0.0.1`에 바인딩한다. Host는 `127.0.0.1:3118` 또는 `localhost:3118`이어야 하고 Origin은 허용된 localhost/Tauri 값이어야 한다. GET/HEAD/OPTIONS가 아닌 변경 요청에는 `X-Meetily-Client` 헤더가 필요하다. JSON은 `cache-control: no-store`로 반환한다. 이는 로그인 인증이나 원격 공개 API를 뜻하지 않는다.

---

## 4. 엔드포인트 목록

| 메서드·경로 | 입력 | 응답·의도 |
| --- | --- | --- |
| `GET /api/local/status` | 없음 | Whisper/Ollama 준비 상태와 인스턴스 ID |
| `GET /api/local/meetings` | 없음 | 회의 목록 |
| `POST /api/local/meetings` | JSON `title`, `language`, `interpret` | `201`, 새 로컬 회의 |
| `GET /api/local/meetings/{id}` | 회의 ID | 전사·요약·오디오 가용성 포함 상세 |
| `PATCH /api/local/meetings/{id}` | JSON `title` | 변경된 회의 |
| `POST /api/local/transcribe?sequence&start&duration` | `audio/wav` | 저장하지 않는 일본어 전사 청크 |
| `POST /api/local/translate` | JSON `text`, `sourceLanguage:"ja"`, `targetLanguage:"ko"`, `context` 최대 2턴 | 번역 텍스트·경과 ms |
| `POST /api/local/meetings/{id}/chunks?sequence&start&duration` | `audio/wav` | 저장한 전사 청크, 동일 순번 재요청 시 기존 receipt |
| `POST /api/local/meetings/{id}/summary` | 없음 | 저장된 전사 기반 Markdown 요약; 빈 전사면 409 |
| `POST /api/local/meetings/{id}/audio` | `audio/wav` | 저장 성공 시 204 |
| `GET /api/local/meetings/{id}/audio` | 없음 | 저장한 오디오 스트림 |
| `POST /api/local/import` | multipart `file`, `title`, `language`, `interpret` | `201`, 변환·전사·저장한 회의 |

---

## 5. 주요 요청과 응답 상세

### 5.1 통역 번역

`POST /api/local/translate`는 `text`, `sourceLanguage: "ja"`, `targetLanguage: "ko"`, 완료된 앞선 발화의 `context` 최대 2건을 받는다. 응답은 번역 `text`와 `elapsedMs`를 담는다.

### 5.2 회의 청크

`POST /api/local/meetings/{id}/chunks`는 `audio/wav` 본문과 `sequence`, `start`, `duration`을 받는다. 같은 회의·순번의 재전송은 저장된 receipt를 돌려 중복 세그먼트를 방지한다.

### 5.3 요약과 가져오기

요약은 저장된 회의 전사에서 생성되며 빈 전사는 409다. 가져오기는 multipart 파일을 로컬에서 WAV로 변환·전사한 뒤 회의를 만든다. 실제 구조는 계약 스키마를 따른다.

---

## 6. 오류 코드와 제한

| 상태·코드 | 발생 예 | 사용자 처리 |
|-----------|---------|-------------|
| 400 | JSON/스키마 오류, 빈 파일 | 입력 수정 |
| 403 | Host·Origin·client 헤더 불일치 | 같은 Mac과 앱 호출 경로 확인 |
| 404 `NOT_FOUND` | 회의·오디오·경로 없음 | ID/파일 확인 |
| 409 `EMPTY_TRANSCRIPT` | 전사 없는 요약 요청 | 전사 생성 후 재시도 |
| 413 `PAYLOAD_TOO_LARGE` | 본문 상한 초과 | 더 작은 파일·청크 사용 |
| 415 `UNSUPPORTED_MEDIA` | WAV 또는 multipart 형식 불일치 | 지원 형식으로 변환 |
| 503 `DB_NOT_READY` | 첫 실행 중 DB 미준비 | 마이그레이션 완료 후 재시도 |

`language`는 `ja|ko|en|auto`; 회의 제목은 1~180자다. 청크 순번은 0~100000, 길이는 0초 초과·60초 이하다. 요청 본문 크기와 import 시간에는 서버 제한이 있다. 오류는 `error` 및 일부 경우 `code`를 가진 JSON과 HTTP 상태로 표시된다. 브라우저 호출에는 허용 origin 및 `X-Meetily-Client` 검사 규칙이 적용된다. 정확한 상한·허용 origin은 [보안 코드](../../../v2.0/meetily/frontend/local-server/security.ts)와 실행 설정을 본다. 새 경로·필드 변경 시 [계약 정책](../11-품질/API-계약-운영정책.md)을 적용한다.

---

## 7. API 변경 관리

경로·필드·상태 코드를 바꾸면 Zod 계약, 서버, 클라이언트, 로컬 테스트, 문서, RTM을 함께 갱신한다. 실제 localhost 요청을 한 번 이상 실행해 성공·오류를 확인한다. [품질 정책](../11-품질/API-계약-운영정책.md)을 따른다.
