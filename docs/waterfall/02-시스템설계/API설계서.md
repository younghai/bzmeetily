# 로컬 API 설계서

기준 구현: [local-server/app.ts](../../../v2.0/meetily/frontend/local-server/app.ts), [Zod 계약](../../../v2.0/meetily/frontend/src/local/contracts.ts). 기본 주소는 앱이 실행 중인 같은 Mac의 `http://127.0.0.1:3118`; 공개 서버 API가 아니다. 모든 메서드는 실제 라우터를 기준으로 적었다.

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

`language`는 `ja|ko|en|auto`; 회의 제목은 1~180자다. 청크 순번은 0~100000, 길이는 0초 초과·60초 이하다. 요청 본문 크기와 import 시간에는 서버 제한이 있다. 오류는 `error` 및 일부 경우 `code`를 가진 JSON과 HTTP 상태로 표시된다. 브라우저 호출에는 허용 origin 및 `X-Meetily-Client` 검사 규칙이 적용된다. 정확한 상한·허용 origin은 [보안 코드](../../../v2.0/meetily/frontend/local-server/security.ts)와 실행 설정을 본다. 새 경로·필드 변경 시 [계약 정책](../11-품질/API-계약-운영정책.md)을 적용한다.
