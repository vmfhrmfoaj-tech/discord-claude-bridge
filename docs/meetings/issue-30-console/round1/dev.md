## [Dev] Round 1

### 입장

`structured-logger.ts`의 `console.log/warn/error` 3개는 단순 교체 대상이고, 나머지 직접 호출 4곳(main.ts×2, reply-publisher.ts×1, smoke-claude.ts×2)은 성격이 다르다. `reply-publisher.ts:90`은 이미 optional `logger`가 주입된 모듈에서 `logger?.error`를 쓰지 않고 `console.error`로 떨어지는 fallback인데, 이는 구조적 불일치로 즉시 수정 가능하다. `main.ts`·`smoke-claude.ts`의 catch절 `console.error(error)`는 "프로세스 진입점의 최후 안전망"이므로 별도 처리 전략이 필요하다. 라이브러리 선택(fs vs winston vs pino)이 `structured-logger.ts` 구현 방식을 전적으로 결정하므로 이 결정이 먼저 내려져야 한다.

### 구현 스케치

**파일별 변경:**

- `src/structured-logger.ts`:
  - `createStructuredLogger()` 시그니처에 `LogSink` 또는 설정 옵션을 파라미터로 추가 (Architect 결정 후 확정)
  - 라이브러리 선택 A (직접 fs): `fs.appendFileSync` or `fs.createWriteStream` 기반 `FileLogSink` 내부 구현, 환경변수(`LOG_FILE_PATH`) 로 경로 주입
  - 라이브러리 선택 B (pino/winston): 해당 라이브러리 인스턴스를 wrapping하는 thin adapter로 교체, 기존 `buildPayload` 로직 제거 또는 라이브러리 직렬화에 위임
  - 개발 환경(`NODE_ENV !== 'production'`)에서 console + 파일 멀티플렉싱 여부는 SRE/Ops 결정 후 반영
  - 쓰기 실패 시 `process.stderr.write` fallback — `fs.appendFile` 콜백 오류 또는 스트림 `'error'` 이벤트에서 silent ignore 하지 않음

- `src/reply-publisher.ts`:
  - `defaultOnDiscordError` 함수(line 89–91)의 `console.error` 제거
  - `ReplyPublisherDeps.logger` 가 undefined일 때의 fallback을 `process.stderr.write` 한 줄로 대체하거나, `logger`를 required로 승격 (Architect 판단 필요)
  - `deps.logger`가 존재하면 이미 `logger?.error`로 호출하고 있으므로 `defaultOnDiscordError`의 중복 출력 문제도 해결됨

- `src/main.ts`:
  - line 8: `console.log(JSON.stringify(event))` — `createStructuredLogger()` 인스턴스를 생성 후 `log` 콜백 대신 logger를 `createLocalRuntime`에 직접 전달하는 방식으로 리팩터링 가능 여부 확인 필요 (local-runtime.ts의 `createLogger` 내부 함수가 `options.log?.(event)` 위임 구조이므로, `createStructuredLogger()`가 반환하는 객체를 `options.logger`로 주입하는 경로가 있는지 확인)
  - line 17: `catch` 절의 `console.error(error)` — 이 시점은 런타임 미초기화 상태이므로 구조화 로거를 사용할 수 없음. `process.stderr.write(String(error) + '\n')` 으로 교체하거나 그대로 유지 (정책 결정 필요)

- `src/smoke-claude.ts`:
  - line 75: `writeOutput` 기본값의 `console.log(text)` — smoke 리포트 출력은 구조화 로그가 아닌 사람이 읽는 stdout 출력이므로 그대로 유지하는 것이 맞을 수 있음 (SRE/Ops 의견 필요)
  - line 150: `catch` 절 `console.error(error)` — `main.ts:17`과 동일한 진입점 안전망 패턴, 동일 정책 적용

- `tests/` 관련 (변경 동반 필요):
  - `createStructuredLogger()` 시그니처가 바뀌면 이를 직접 호출하는 테스트 파일 파악 필요
  - `reply-publisher.ts`의 `defaultOnDiscordError` 변경 시 해당 경로를 커버하는 테스트 갱신 필요

체크 순서 / 데이터 흐름:

```
1. Architect → LogSink seam 결정 (인터페이스 변경 여부)
2. SRE/Ops  → 파일 경로, 환경 분기, rotation 정책
3. Dev       → structured-logger.ts 구현 교체
4. Dev       → reply-publisher.ts defaultOnDiscordError 수정
5. Dev       → main.ts / smoke-claude.ts 진입점 console 처리
6. QA        → 변경된 파일 테스트 범위 확인
```

### 미결 사항 (다른 역할에게)

- @architect: `StructuredLogger` 인터페이스(modules.ts:168)를 그대로 유지할지, 아니면 `close(): Promise<void>` 같은 생명주기 메서드를 추가해야 할지 결정해주세요. 파일 스트림을 열면 프로세스 종료 전 flush/close가 필요합니다. 또한 `ReplyPublisherDeps.logger`를 optional에서 required로 바꾸는 것이 적절한지 모듈 경계 관점에서 판단해주세요.

- @architect: 라이브러리 추가(pino/winston) vs 직접 `fs` 구현 중 프로젝트 의존성 원칙 관점에서 결정 부탁합니다. 현재 `dependencies`가 `discord.js`, `js-yaml` 2개뿐이고 devDependencies에도 로깅 라이브러리가 없습니다.

- @sre-ops: `smoke-claude.ts`의 `writeOutput` 기본값(`console.log`)이 smoke 리포트 stdout 출력용인데, 이것도 파일 로그로 전환해야 하는지 아니면 사람용 stdout으로 유지해야 하는지 의견 주세요.

- @sre-ops: `main.ts:17`, `smoke-claude.ts:150`의 진입점 `catch` 절 — 구조화 로거 미초기화 시점의 치명적 오류 출력을 어떻게 처리할지 정책 결정이 필요합니다 (stderr 유지 vs 파일에도 써야 하는지).

- @qa: `createStructuredLogger()` 시그니처 변경 시 영향받는 테스트 파일 범위를 확인해 주세요. 현재 `reply-publisher.ts`의 `defaultOnDiscordError` console 경로가 테스트에서 커버되고 있는지도 확인 필요합니다.
