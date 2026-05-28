# Brief: issue-30-console

## 이슈/주제

**GitHub Issue #30** — [로그 console => 파일](https://github.com/vmfhrmfoaj-tech/discord-claude-bridge/issues/30)

현재 `structured-logger.ts`의 모든 로그 출력이 `console.log/warn/error`로만 구현되어 있음. 운영 환경에서 로그를 파일에 저장하는 방향으로 전환이 필요.

### 현재 console 사용 현황
- `src/structured-logger.ts:37,40,43` — StructuredLogger의 info/warn/error 구현 (주요 대상)
- `src/reply-publisher.ts:90` — `console.error` 직접 호출 (StructuredLogger 우회)
- `src/main.ts:8,17` — `console.log` / `console.error` 직접 호출
- `src/smoke-claude.ts:75,150` — `console.log` / `console.error` 직접 호출

---

## 설계 질문

1. **출력 전략**: 파일 단독 vs console + 파일 멀티플렉싱 (개발 환경 고려)
2. **라이브러리 선택**: 직접 `fs.appendFile` 구현 vs winston vs pino — 의존성 추가 정당성
3. **파일 경로 및 회전 정책**: 경로 설정 방법, 크기/날짜 기반 rotation 필요 여부
4. **직접 console 호출 처리**: `reply-publisher.ts`, `main.ts`, `smoke-claude.ts`의 직접 console 호출도 통합 대상인가?
5. **StructuredLogger 인터페이스 변경 여부**: 기존 Interface 계약 유지인가, 확장 필요한가?
6. **쓰기 실패 시 fallback**: 파일 IO 오류 시 silent ignore vs stderr fallback vs 프로세스 종료

---

## 선정 역할

| 역할 | 선정 사유 |
|---|---|
| **Dev** | structured-logger.ts 구현 교체 + 직접 console 호출 위치 통합 |
| **Architect** | StructuredLogger Interface 계약 유지 여부 + 새 LogAdapter Seam 필요성 판단 |
| **SRE/Ops** | 파일 로그 운영 정책 (경로, rotation, 장애 모드, 디스크 영향) |

복합 perspective (개발 + 운영) → 역할 매핑 합집합 적용.

---

## 관련 파일

- `src/structured-logger.ts` — 핵심 변경 대상
- `src/modules.ts:168` — `StructuredLogger` 인터페이스 정의
- `src/reply-publisher.ts:90` — 직접 console 호출
- `src/main.ts:8,17` — 직접 console 호출
- `src/smoke-claude.ts:75,150` — 직접 console 호출

---

## 옵션

- rounds: 2 (default)
- lead: 자동 추론 (충돌 유형에 따라)
- exclude: 없음
