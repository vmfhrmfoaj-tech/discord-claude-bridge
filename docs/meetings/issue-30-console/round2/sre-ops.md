## [SRE/Ops] Round 2 — 최종 운영 결정

### 결정

파일 쓰기는 **항상 비동기**, 콘솔 출력은 **filePath 유무와 무관하게 stderr 멀티플렉싱 유지**, filePath 미설정 시 기동 단계에서 **경고를 발생시켜 운영 누락을 가시화**한다.

### 근거

- 장애 영향 최소화:
  - 멀티플렉싱(file + stderr 동시 출력)은 파일 IO 장애 시에도 systemd/PM2가 stderr를 캡처하므로 로그 유실 없음. exclusive 분기(Architect R1 제안)는 filePath 미설정 시 운영 환경에서 파일 로그 전체 누락 위험이 존재한다.
  - `appendFileSync`는 디스크 IO 블로킹으로 Discord 응답 지연 및 이벤트 루프 정체를 유발한다. 비동기 `fs.appendFile` 또는 `fs.createWriteStream` 중 **`createWriteStream` + 내부 버퍼링** 방식을 선택한다. `createWriteStream`은 반복 `appendFile` 콜백 체인보다 백프레셔 처리가 명확하고 파일 핸들을 하나만 유지해 ENOENT 재검출이 용이하다.

- 진단 가능성:
  - filePath가 설정되지 않은 채 프로세스가 기동되면 `warn` 레벨로 `event: "log_file_path_not_configured"` 1회 출력. 운영자가 설정 누락을 즉시 인지할 수 있다.
  - 파일 오픈/초기화 성공 시 `info` 레벨로 `event: "log_file_opened"`, `path` 1회 출력(R1 유지).
  - 파일 쓰기 실패 시 `event: "log_write_failed"`, `path`, `error` 를 stderr에 기록. 연속 실패는 stderr 스트림에 그대로 누적되어 PM2/journald 수준에서 알람 필터링 가능.

- 롤백 안전성:
  - `createWriteStream`은 `close()` 호출로 flush 보장이 가능하므로, `StructuredLogger`에 `close(): Promise<void>` 생명주기 메서드 추가가 정당화된다(Architect R1은 인터페이스 변경을 유보했으나, 파일 핸들 미닫힘은 로그 유실로 직결되므로 운영 관점에서 필수). 메서드를 추가해도 기존 소비자는 `close`를 호출하지 않아도 동작하므로 additive breaking이 아니다.
  - 롤백(이전 console 전용 버전 복원) 시에는 filePath를 제거하면 즉시 stderr-only 모드로 전환되어 코드 변경 없이 되돌릴 수 있다.

---

### 구현 지시 (다른 역할에게)

- @dev:
  - `fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' })` 로 파일 핸들을 팩토리 초기화 시점에 1회만 열 것. `appendFile`을 매 로그 호출마다 실행하지 말 것.
  - 스트림 `error` 이벤트 핸들러에서 `process.stderr.write(...)` 로 fallback. 이후 쓰기는 파일 없이 stderr only로 강등(스트림을 null로 교체). **프로세스 종료 금지**.
  - `StructuredLogger` 인터페이스에 `close(): Promise<void>` 추가 구현. 파일 스트림이 없는 경우(console-only 모드) `close()`는 no-op resolved Promise 반환.
  - `main.ts`, `reply-publisher.ts`, `smoke-claude.ts` 직접 console 호출을 통합 대상에 포함. `main.ts:17` · `smoke-claude.ts:150` catch 절의 최후 안전망은 `process.stderr.write` 로 교체 — 구조화 로거 미초기화 시점이므로 파일 경로 없이 stderr 직접 기록이 옳다.
  - `smoke-claude.ts`의 `writeOutput` 기본값(`console.log`)은 사람용 stdout 출력이므로 **파일 로그 통합 제외**. smoke 리포트는 터미널/CI 출력이 목적이며 운영 로그와 성격이 다르다.
  - filePath 미설정 시 팩토리 초기화 시 `process.stderr.write('{"level":"warn","event":"log_file_path_not_configured",...}\n')` 1회 출력 후 stderr-only 모드로 동작.

- @architect:
  - `StructuredLogger` 인터페이스(`modules.ts:168`)에 `close(): Promise<void>` 를 추가하도록 결정. 파일 스트림 생명주기 관리가 필수이므로 인터페이스 불변 원칙보다 운영 안전성이 우선한다. 기존 소비자 파괴 없이 additive 추가 가능.
  - `RuntimeConfig.logging`에 `filePath?: string` 추가(R1 제안 유지). `undefined` 시 경고 출력 후 stderr-only 모드 — Architect R1의 "console fallback(silent)" 방식은 **경고 없는 silent fallback이므로 운영 불가**. 경고 발생 후 계속 동작하는 것으로 정책 수정.
  - `stdout/stderr 병행 출력 여부를 설정으로 제어`하는 seam은 불필요. 멀티플렉싱(file + stderr)이 항상 활성화되므로 분기 로직이 없다. `NODE_ENV` 기반 분기 제거.

- @qa:
  - 장애 시나리오 테스트 우선순위: (1) filePath 미설정 → 경고 1회 + stderr-only 동작, (2) 스트림 `error` 이벤트 발생 → fallback 전환 + 이후 로그가 stderr로 나오는지, (3) `close()` 호출 후 flush → 파일에 마지막 항목까지 기록되는지.
  - `createStructuredLogger()` 시그니처 변경으로 영향받는 테스트 파일 범위 확인 및 갱신.
  - `reply-publisher.ts:defaultOnDiscordError` 변경 경로 커버 여부 확인.
