## [Architect] Round 1

### 입장

`StructuredLogger` 인터페이스(`info/warn/error` 3-메서드 계약)는 현행 그대로 유지해야 한다. 출력 매체(console vs file)는 구현 세부사항이므로 `createStructuredLogger()` 팩토리 내부에서 교체하면 충분하며, 새 LogAdapter Seam은 현 시점에 불필요하다. `RuntimeConfig.logging`에 `filePath` 필드를 추가하는 additive 변경으로 설정을 수용하고, 팩토리 시그니처를 `createStructuredLogger(config: RuntimeConfig["logging"])` 형태로 확장하면 기존 호출부 계약을 깨지 않는다. `reply-publisher.ts`의 직접 `console.error` 호출은 `StructuredLogger`가 이미 의존성 주입으로 공급되는 구조이므로 구조적 처리(즉 로거로 교체) 대상이고, `main.ts`와 `smoke-claude.ts`의 직접 호출은 각각의 성격(프로세스 부트스트랩 오류, 독립 스크립트)이 달라 별도 판단이 필요하다.

### 근거

- **패턴 일관성**: `modules.ts`는 이미 `"Structured Logger"`를 명명된 Module Seam으로 등록했다. 인터페이스를 변경하면 해당 Seam과 계약하는 모든 소비자(`job-queue`, `claude-cli-adapter` 등)에 breaking change가 전파된다. 출력 전략 변경은 impl-swap으로 해결 가능하므로 인터페이스 수정은 정당화되지 않는다.
- **책임 분리**: `buildPayload` 로직(이벤트 → JSON 직렬화)은 출력 매체와 무관하다. 현재 `structured-logger.ts` 내 직렬화 책임과 출력 책임이 뒤섞여 있으나, 이는 파일 추가(출력 책임 교체)로 자연스럽게 분리된다. Seam을 추가로 만들면 책임이 세 층으로 불필요하게 분산된다.
- **설정 Seam 위치**: `RuntimeConfig.logging`은 이미 `level`과 `format`을 보유한다. `filePath?: string` 하나를 추가하는 것이 Config Loader Module 경계 안의 additive 변경이며, 별도 `LogConfig` 타입 신설은 over-engineering이다. `undefined`이면 console fallback, 값이 있으면 file 출력으로 팩토리가 분기하면 된다.
- **직접 console 호출의 구조적 처리 범위**: `reply-publisher.ts:90`은 `StructuredLogger` deps가 이미 주입된 컨텍스트 안에 있는 raw call이므로 로거로 교체가 구조적으로 적합하다. `main.ts`의 최상위 `catch`는 로거 초기화 이전에 발생하는 프로세스 레벨 오류이므로 `console.error` 유지가 정당하다(로거가 아직 존재하지 않는다). `smoke-claude.ts`는 독립 진단 스크립트이므로 별도 정책이 필요하다.
- **위험 회피**: 라이브러리(winston/pino) 도입은 의존성 표면을 늘리고 번들 크기·보안 패치 부담을 수반한다. `fs.appendFile`(또는 `fs.createWriteStream`) 직접 구현으로 요건을 충족할 수 있는 한, 외부 의존성 추가의 ROI가 낮다.

### 미결 사항 (다른 역할에게)

- @dev: `createStructuredLogger(config: RuntimeConfig["logging"])` 시그니처 채택 시 기존 호출부(`local-runtime.ts` 등)에서 config 전달 경로가 어떻게 흐르는지 확인 필요. `main.ts:8`의 인라인 `log` 콜백도 같은 팩토리로 통합 가능한지 판단 위임.
- @dev: `reply-publisher.ts:90`의 `defaultOnDiscordError`는 현재 `StructuredLogger` deps 외부에 있는 module-level 함수. 로거를 클로저로 캡처하도록 리팩토링 가능한지, 아니면 별도 처리 필요한지 구현 판단 위임.
- @sre: `filePath` 미설정(undefined) 시 console 출력 유지 정책 적절한가? 운영 배포에서 실수로 경로를 누락했을 때 파일 로그 없이 진행될 위험을 어떻게 통제할지 운영 관점 의견 요청.
- @sre: 파일 쓰기 실패(디스크 풀, 권한 오류) 시 stderr fallback vs silent ignore 중 어느 쪽이 운영 정책상 수용 가능한지 판단 요청. 이 결정이 팩토리의 error-handler Seam 노출 여부에 영향을 준다.
