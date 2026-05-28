# issue-30-console 회의 요약
날짜: 2026-05-28

## 결정 사항

### 1. 출력 전략: 파일 + stderr 상시 멀티플렉싱
파일 로그(filePath 설정 시)와 stderr을 항상 동시에 출력한다. `NODE_ENV` 기반 환경 분기는 도입하지 않으며, 멀티플렉싱은 무조건 활성화된다. 이로써 파일 IO 장애 시에도 systemd/PM2가 stderr를 캡처하므로 로그 유실이 없다. (SRE/Ops R2 결정, Architect R2 동의)

### 2. 파일 쓰기 구현: `fs.createWriteStream` 비동기 방식
`appendFile`(매 호출마다 파일 핸들 열기) 대신 `fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' })`로 팩토리 초기화 시 파일 핸들을 1회만 열고 유지한다. `appendFileSync`는 이벤트 루프 블로킹을 유발하므로 사용이 금지된다. 스트림 `error` 이벤트 발생 시 stderr fallback으로 강등하며 프로세스는 계속 동작한다. (SRE/Ops R2 결정, Dev R2/Architect R2 동의)

### 3. `StructuredLogger` 인터페이스에 `close(): Promise<void>` 추가
`modules.ts:168`의 `StructuredLogger` 타입 정의에 `close(): Promise<void>` 메서드를 additive로 추가한다. 파일 스트림 생명주기(flush 보장)를 인터페이스 계약 안에서 관리해야 하므로 Architect R1의 인터페이스 불변 원칙보다 운영 안전성이 우선한다. 기존 소비자는 `close`를 호출하지 않아도 동작하므로 breaking change가 없다. console-only 모드의 `close()`는 no-op resolved Promise로 구현한다. (SRE/Ops R2 지시, Architect R2에서 R1 유보 철회 후 승인)

### 4. 라이브러리 선택: 외부 의존성 없이 `fs` 직접 구현
winston/pino 등 외부 로깅 라이브러리는 도입하지 않는다. 현재 `dependencies`가 2개(`discord.js`, `js-yaml`)뿐이고 `fs.createWriteStream`으로 요건을 충족할 수 있으므로 외부 의존성 추가의 ROI가 낮다. (Architect R1 결정, 전 역할 동의)

### 5. `filePath` 미설정 시 경고 방출 + stderr-only 모드
`RuntimeConfig.logging.filePath`가 설정되지 않으면 팩토리 초기화 시 `event: "log_file_path_not_configured"` warn 1회를 stderr에 출력한 뒤 stderr-only 모드로 동작한다. Architect R1의 silent fallback 방안은 SRE/Ops가 운영 불가로 판정하여 대체되었다. (SRE/Ops R2 결정, Architect R2 동의)

### 6. 직접 `console` 호출 통합 범위 확정
- `reply-publisher.ts:90` (`defaultOnDiscordError`): `StructuredLogger` deps가 이미 주입된 컨텍스트이므로 로거로 교체. `deps.logger` undefined 시 `process.stderr.write` fallback.
- `main.ts:17`, `smoke-claude.ts:150` (진입점 catch 절): 구조화 로거 미초기화 시점이므로 `process.stderr.write`로 교체.
- `smoke-claude.ts:75` (`writeOutput` 기본값 `console.log`): 터미널/CI 사람용 stdout 출력이므로 파일 로그 통합 제외, 변경 없음.
- `main.ts:8` (`console.log(JSON.stringify(event))`): 로거 인스턴스 생성 후 `info` 메서드로 위임, 통합 대상.

---

## 합의된 구현 방향

### `src/modules.ts`
- `RuntimeConfig.logging`에 `filePath?: string` 필드 추가
- `StructuredLogger` 인터페이스에 `close(): Promise<void>` 메서드 추가

### `src/structured-logger.ts`
- `createStructuredLogger(config: RuntimeConfig["logging"])` 시그니처로 변경
- 팩토리 내부에서 `fs.mkdirSync(path.dirname(filePath), { recursive: true })`로 부모 디렉토리 자동 생성 (기존 `.data/` 선례 동일 패턴)
- `filePath` 있으면 `fs.createWriteStream` 1회 오픈; 없으면 `process.stderr.write(event: log_file_path_not_configured)` 1회 출력
- 파일 오픈 성공 시 `event: log_file_opened` info 1회 출력
- `info/warn/error` 메서드: 항상 `process.stderr.write` + fileStream이 살아있으면 추가로 `fileStream.write`
- 스트림 `error` 이벤트: `event: log_write_failed` stderr 출력 + `fileStream = null`으로 강등, 프로세스 종료 없음
- `close()`: fileStream이 null이면 `Promise.resolve()`, 있으면 `fileStream.end(resolve)`로 flush 보장
- `buildPayload` 직렬화 함수 그대로 유지

### `src/reply-publisher.ts`
- `defaultOnDiscordError`(line 90) `console.error` 제거
- `deps.logger` 존재 시 `deps.logger.error(...)` 호출; undefined 시 `process.stderr.write` 1줄 fallback
- `logger` optional 유지 (required 승격은 이번 범위 제외)

### `src/main.ts`
- line 8: `console.log` → 로거 인스턴스 `info` 메서드로 위임 (local-runtime.ts `options.log?.(event)` 통합 경로 확인 후 적용)
- line 17: `console.error` → `process.stderr.write(String(error) + '\n')`
- SIGTERM/SIGINT 핸들러 또는 `process.on('exit')` 지점에 `await logger.close()` 삽입

### `src/smoke-claude.ts`
- line 75: `writeOutput` 기본값 `console.log` — 변경 없음 (사람용 stdout 출력)
- line 150: `console.error` → `process.stderr.write(String(error) + '\n')`

### `config.yaml` / Config Loader
- `logging.filePath` 필드를 `config.yaml` 파싱 경로에서 `RuntimeConfig`로 매핑하는 additive 변경
- 별도 Config Validation Seam 신설 없음; filePath 부재 경고는 팩토리 내부에서 처리

### 테스트 파일
- `createStructuredLogger()` 무인자 호출 → config 전달 형태로 갱신
- `StructuredLogger` mock/stub에 `close: () => Promise<void>` no-op 일괄 추가
- `reply-publisher.ts:defaultOnDiscordError` 변경 경로 커버 확인 및 갱신
- 장애 시나리오 3건 테스트 추가: (1) filePath 미설정 → 경고 1회 + stderr-only, (2) 스트림 error → fallback 전환, (3) `close()` 후 flush 확인

---

## 위험 엣지케이스

1. **디스크 풀 (`ENOSPC`)**: 파일 쓰기 실패 후 stderr fallback 전환 시 이후 모든 로그는 stderr에만 기록. 운영자가 디스크 정리 후 재시작해야 파일 로그 복구 가능.
2. **로그 디렉토리 미존재 (`ENOENT`)**: `mkdirSync recursive`로 자동 생성되지만, 권한 부족 등으로 생성 실패 시 파일 쓰기 전체 불가. stderr fallback으로 계속 동작.
3. **logrotate 외부 삭제/이동**: `createWriteStream` 방식에서 파일 핸들은 유지되므로 삭제 후 디스크 해제가 안 될 수 있음. `copytruncate` 방식 logrotate 사용 권장. SIGHUP 핸들 재오픈은 v2 고려.
4. **프로세스 비정상 종료 (mid-write)**: `close()` 미호출 시 스트림 버퍼의 마지막 로그 유실 가능. 각 이벤트가 단일 JSON 라인이므로 파싱 내결함성은 확보되나 마지막 라인 잘림 허용.
5. **`main.ts:8` 통합 경로 미확인**: `local-runtime.ts`의 `options.log?.(event)` 위임 구조와 로거 인스턴스 주입 경로가 실제로 연결 가능한지 코드 확인 선행 필요. 경로가 없으면 별도 처리 필요.
6. **테스트 mock 타입 오류**: `StructuredLogger`에 `close()` 추가 후 기존 mock/stub에 해당 메서드가 없으면 TypeScript 컴파일 오류 발생. 전수 갱신 필요.

---

## 미합의 / 추가 논의 필요

- **`ReplyPublisherDeps.logger` optional → required 승격 여부**: Dev R2에서 이번 범위 제외로 결론지었으나, Architect R1이 모듈 경계 관점에서 판단을 요청한 항목. 별도 이슈로 논의 필요.
- **SIGHUP 핸들러로 파일 핸들 재오픈**: logrotate 연동을 위한 SIGHUP 처리는 v2 고려 항목으로 유보. 기준 및 시점 미정.
- **`main.ts:8` 로거 통합 구체 경로**: `local-runtime.ts` 내부 `createLogger` 함수와 `options.log?.(event)` 위임 구조의 실제 연결 가능성은 구현 시점에 재확인 필요.

---

## 액션 아이템

- [ ] `src/modules.ts`: `RuntimeConfig.logging`에 `filePath?: string` 추가; `StructuredLogger` 인터페이스에 `close(): Promise<void>` 추가
- [ ] `src/structured-logger.ts`: `createStructuredLogger(config: RuntimeConfig["logging"])` 시그니처 변경; `fs.createWriteStream` 비동기 방식 구현; 멀티플렉싱(stderr + file) 로직; `close()` 구현; 경고/정보 이벤트 방출 로직
- [ ] `src/reply-publisher.ts`: `defaultOnDiscordError` `console.error` 제거 및 `deps.logger.error` / `process.stderr.write` fallback으로 교체
- [ ] `src/main.ts`: line 8 `console.log` → 로거 통합; line 17 `console.error` → `process.stderr.write`; 종료 경로(`SIGTERM`/`SIGINT`/`process.on('exit')`)에 `await logger.close()` 삽입
- [ ] `src/smoke-claude.ts`: line 150 `console.error` → `process.stderr.write` (line 75 `writeOutput` 기본값은 변경 없음)
- [ ] `config.yaml` 파싱 경로: `logging.filePath` 필드를 `RuntimeConfig`에 매핑하는 additive 변경
- [ ] `createStructuredLogger()` 무인자 호출 위치(`local-runtime.ts` 등) 전수 확인 후 config 전달 경로 연결
- [ ] 테스트 파일: `StructuredLogger` mock/stub에 `close: () => Promise<void>` no-op 일괄 추가; `defaultOnDiscordError` 변경 경로 커버 확인; 장애 시나리오 3건 테스트 추가
