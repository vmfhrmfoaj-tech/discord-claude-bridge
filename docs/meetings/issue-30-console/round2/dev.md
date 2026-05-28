## [Dev] Round 2 — 구현 계획 확정

### 파일별 변경 최종 목록

- **`src/modules.ts`**
  - `RuntimeConfig.logging`에 `filePath?: string` 필드 추가
  - `StructuredLogger` 인터페이스에 `close(): Promise<void>` 메서드 추가 (SRE/Ops R2 결정 반영, Architect R1의 인터페이스 불변 원칙보다 운영 안전성 우선)

- **`src/structured-logger.ts`**
  - `createStructuredLogger(config: RuntimeConfig["logging"])` 시그니처로 변경. 기존 무인자 호출부는 config 객체를 받도록 호출부 갱신 필요.
  - `filePath`가 있을 경우 팩토리 내부에서 `fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' })` 1회 오픈. `mkdir -p` 로 부모 디렉토리 자동 생성 (`fs.mkdirSync(path.dirname(filePath), { recursive: true })`). 기존 `.data/` 자동 생성 선례(`e1b33f0`)와 동일 패턴.
  - 스트림 `'error'` 이벤트 핸들러 등록: `process.stderr.write(JSON.stringify({ ts, level: 'warn', event: 'log_write_failed', path: filePath, error: err.message }) + '\n')` 출력 후 내부 `fileStream` 참조를 `null`로 교체 → 이후 쓰기는 stderr-only로 강등. **프로세스 종료 없음**.
  - `filePath` 미설정 시 팩토리 초기화 단계에서 `process.stderr.write(JSON.stringify({ ts, level: 'warn', event: 'log_file_path_not_configured' }) + '\n')` 1회 출력 후 stderr-only 모드 진입.
  - `filePath` 설정 성공 시 `process.stderr.write(JSON.stringify({ ts, level: 'info', event: 'log_file_opened', path: filePath }) + '\n')` 1회 출력.
  - `info/warn/error` 각 메서드: `JSON.stringify(buildPayload(...))` 라인을 `process.stderr.write(line + '\n')` 로 교체(항상 stderr 멀티플렉싱). `fileStream`이 살아있으면 추가로 `fileStream.write(line + '\n')` 호출 — `write()` 반환값(백프레셔 신호)은 v1에서 무시하고 비동기 flush에 위임.
  - `close(): Promise<void>` 구현: `fileStream`이 null이면 `Promise.resolve()` 반환. 있으면 `new Promise((resolve) => fileStream.end(resolve))` 반환하여 flush 보장.
  - `buildPayload` 함수는 그대로 유지 (직렬화 책임 분리, Architect R1 근거 동의).

- **`src/reply-publisher.ts`**
  - line 90, `defaultOnDiscordError` 함수 내 `console.error(...)` 제거.
  - `deps.logger`가 존재하면 `deps.logger.error({ event: 'discord_publish_error', ... })` 호출. `deps.logger`가 undefined이면 `process.stderr.write(...)` 1줄로 fallback. `logger` optional 유지 (required 승격은 Architect 영역, 이번 범위 제외).

- **`src/main.ts`**
  - line 8: `console.log(JSON.stringify(event))` → `createStructuredLogger(config.logging)` 인스턴스가 이미 생성된 시점이면 해당 인스턴스의 `info` 콜백으로 위임. `local-runtime.ts`의 `options.log?.(event)` 위임 구조와 통합 경로 확인 후 적용.
  - line 17: `catch` 절 `console.error(error)` → `process.stderr.write(String(error) + '\n')`. 이 시점은 구조화 로거 미초기화 가능 구간이므로 stderr 직접 기록이 옳다 (SRE/Ops R2 결정 동일).

- **`src/smoke-claude.ts`**
  - line 75: `writeOutput` 기본값 `console.log(text)` → **변경 없음**. smoke 리포트는 터미널/CI 사람용 stdout 출력이며 운영 로그와 성격이 다르다 (SRE/Ops R2 결정 그대로 반영).
  - line 150: `catch` 절 `console.error(error)` → `process.stderr.write(String(error) + '\n')`. `main.ts:17`과 동일 패턴.

---

### Lead 결정에 대한 동의/이견

SRE/Ops R2의 모든 결정(멀티플렉싱 필수, `createWriteStream` 비동기 전용, filePath 미설정 시 경고+stderr-only, `close()` 인터페이스 추가)에 전면 동의한다. 특히 `createWriteStream`이 매번 `appendFile` 콜백 체인보다 파일 핸들 관리와 백프레셔 처리에서 명확하다는 판단은 구현 복잡도 관점에서도 타당하다.

### 후속 조정 필요

- `createStructuredLogger(config)` 시그니처 변경으로 인해 현재 무인자 호출 위치(예: `local-runtime.ts`, 테스트 파일)를 전수 확인하고 config 전달 경로를 연결해야 한다.
- `StructuredLogger` 인터페이스에 `close()` 추가 시 기존 mock/stub이 있는 테스트 파일에서 `close` 메서드 stub 추가가 필요하다 (QA 역할에 전달).
- `process.exit` 호출 전 `await logger.close()` 삽입 위치를 `main.ts` 종료 경로(정상 종료, SIGINT/SIGTERM 핸들러)에서 확인해야 한다.
