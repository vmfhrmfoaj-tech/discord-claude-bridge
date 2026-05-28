## [Architect] Round 2 — 구조 검증

### Lead 결정에 대한 구조 평가

SRE/Ops의 세 가지 핵심 결정을 기존 Module 경계 및 Interface 계약 관점에서 평가한다.

**결정 1: 멀티플렉싱(file + stderr 동시 출력)**
`StructuredLogger` 인터페이스(`info/warn/error`)의 시그니처 자체는 변경이 없다. 멀티플렉싱은 팩토리(`createStructuredLogger`) 내부에서 `WriteStream`과 `process.stderr`를 함께 소비하는 구현 전략이므로, 인터페이스 계약에 영향 없음. R1에서 "impl-swap으로 해결 가능"이라고 판단한 범위 안에 있다. 다만 팩토리가 두 개의 출력 채널을 동시에 관리하는 내부 구조가 되므로, 팩토리 반환 타입에는 외부로 노출할 채널 선택 로직이 없어야 한다. 소비자는 여전히 `info/warn/error/close`만 알면 된다.

**결정 2: `createWriteStream` 비동기 방식과 생명주기 계약**
`createWriteStream` 도입은 파일 핸들의 명시적 `close()`를 필수로 만든다. SRE/Ops가 `close(): Promise<void>`를 `StructuredLogger` 인터페이스에 추가할 것을 지시했으며, R1에서 Dev가 먼저 같은 필요성을 제기했다. 구조 관점에서도 이 추가는 정당하다. 이유는 다음과 같다.

- `modules.ts`의 `StructuredLogger` Seam은 현재 출력 전용 계약만 보유한다. 파일 핸들이 도입되면 해당 Seam은 자원 관리 책임도 포함하게 된다. 이를 인터페이스 밖에 두면(팩토리 반환값에 캐스팅으로 접근하는 방식 등) Seam 계약과 실제 구현 사이에 숨겨진 의존이 생긴다.
- `close()`를 additive로 추가하면 기존 소비자(`job-queue`, `claude-cli-adapter` 등)는 `close` 호출 없이도 동작한다. Breaking change 없음.
- console-only 모드의 `close()`는 no-op resolved Promise로 처리하면 되므로, 인터페이스 통일성이 유지된다.

따라서 R1에서 유보했던 `close(): Promise<void>` 인터페이스 추가를 **이제 승인**한다. `modules.ts:168`의 `StructuredLogger` 타입 정의에 해당 메서드를 추가해야 한다.

**결정 3: `filePath` 미설정 시 경고 + stderr-only 정책**
R1에서 제안한 "undefined이면 silent console fallback"은 SRE/Ops가 운영 불가로 판정하고 "경고 1회 + stderr-only"로 대체했다. 구조 관점에서 이 정책 변경이 별도의 Config Validation Seam을 필요로 하는지 검토한다.

결론: **별도 Seam 불필요**. 경고 출력은 팩토리 초기화 로직 안의 early-return guard에 해당하며, 이는 Config Loader가 RuntimeConfig를 생성한 이후 팩토리가 소비하는 시점의 defensive check이다. Config Loader Boundary 안에서 `filePath` 유효성 검증을 추가하는 것보다, 팩토리 내부에서 `filePath` 부재를 감지해 경고를 방출하는 것이 책임 위치상 더 적합하다. Config Loader는 "파싱 가능한가"를 검증하는 책임을 갖고, "파일 경로가 없으면 운영 위험"이라는 운영 정책 판단은 팩토리가 수행하는 것이 자연스럽다. 이 구분을 지키면 Config Loader는 스키마 검증에만 집중하고, 경고 방출 로직은 팩토리 안에 국소화된다.

---

### 동의/이견

**동의**

- `StructuredLogger` 인터페이스에 `close(): Promise<void>` additive 추가 — R1 유보를 철회하고 동의. 파일 핸들 생명주기를 인터페이스 계약 밖에 두는 것은 Seam 신뢰성을 손상시킨다.
- `RuntimeConfig.logging.filePath?: string` additive 추가 — R1 제안과 동일하므로 변경 없음.
- `NODE_ENV` 기반 멀티플렉싱 분기 제거 — R1에서 환경 분기 seam을 SRE/Ops에게 위임했는데, SRE/Ops가 "항상 멀티플렉싱"으로 결정했으므로 구조 단순화된다. 조건 분기가 없으면 팩토리 경로가 단일화되어 테스트 용이성도 높아진다.
- `smoke-claude.ts writeOutput`의 파일 로그 통합 제외 — R1에서 "독립 스크립트로 별도 정책 필요"라고 판단한 것과 일치.
- `main.ts:17`, `smoke-claude.ts:150` catch 절을 `process.stderr.write`로 교체 — 로거 미초기화 시점의 안전망이므로 구조적으로 올바른 판단.

**이견 없음** — SRE/Ops 결정이 R1 Architect 입장과 충돌하는 지점은 두 곳이었으나 모두 수용 가능하다.

- R1에서 "silent fallback"을 제안한 것은 운영 정책 판단을 SRE/Ops에 위임하는 의도였다. SRE/Ops가 "경고 방출 후 stderr-only"로 결정한 것은 구조 경계를 침범하지 않는다.
- R1에서 `close()` 인터페이스 추가를 유보한 것은 "현재 필요성을 모른다"는 판단이었다. `createWriteStream` 선택으로 필요성이 확정된 이상, 추가는 합당하다.

---

### 후속 조정 필요

**1. `modules.ts:168` — `StructuredLogger` 타입 정의 수정**

`close(): Promise<void>` 메서드를 추가해야 한다. 이것이 이번 변경에서 인터페이스 계약에 발생하는 유일한 변경이다. 추가 후 `StructuredLogger` Seam과 계약하는 모든 소비자 파일을 열거하여 `close` 호출 경로(주로 `main.ts`의 graceful shutdown 지점)가 존재하는지 확인해야 한다.

**2. `main.ts` — graceful shutdown 지점에 `logger.close()` 호출 삽입**

`createWriteStream`은 `close()` 없이 프로세스가 종료되면 버퍼에 남은 데이터가 유실될 수 있다. `main.ts`의 `SIGTERM`/`SIGINT` 핸들러 또는 `process.on('exit')` 지점에 `await logger.close()` 호출 Seam이 필요하다. 이 지점이 현재 `main.ts`에 존재하는지, 없다면 새 Seam으로 추가해야 하는지 Dev가 확인해야 한다.

**3. Config Loader Boundary — Seam 추가 불필요, 단 타입 확장 필요**

`RuntimeConfig.logging`에 `filePath?: string`을 추가하는 것은 Config Loader가 관리하는 타입 스키마 변경이다. `config.yaml` 파싱 로직에서 해당 필드를 읽어 `RuntimeConfig`로 매핑하는 additive 변경이 필요하다. 별도 Validation Seam은 신설하지 않는다.

**4. `StructuredLogger` 소비자 목록 점검 (Adapter 도입 불필요)**

별도 LogAdapter Seam을 추가할 필요는 없다. 다만 `close()` 추가로 인해 mock/stub을 사용하는 테스트 내 `StructuredLogger` 구현체가 `close` 메서드 누락으로 타입 오류가 발생할 수 있다. 각 테스트 파일의 mock 타입 정의를 `close: () => Promise<void>` no-op으로 일괄 보완하는 것이 Dev 구현 범위에 포함된다.
