# ADR-0004: Smoke Test Strategy

## Status

Accepted

## Context

v1 runtime은 두 개의 외부 의존성을 가진다: Discord (bot token, channel, mention event)와 Claude CLI (설치된 CLI, 유효한 세션). 이 둘을 함께 테스트하면 실패 원인을 격리하기 어렵다. Discord 문제인지, Claude CLI 문제인지, 아니면 둘 사이 wiring 문제인지 구분이 안 된다.

또한 full integration test는 두 외부 자격증명이 모두 준비된 환경에서만 실행할 수 있어, 한쪽 의존성만 있는 상황에서의 검증이 불가능하다.

## Decision

3-tier isolation smoke strategy를 채택한다. 각 tier는 독립 issue로 만들고 순서대로 통과한다.

**Tier 1 — Discord path isolation (`RESPONSE_MODE=echo`)**

Claude CLI를 완전히 우회하고 Discord ingress, mention parsing, job routing, reply publishing만 검증한다. `RESPONSE_MODE=echo`로 실행하면 bot은 `[에코] <원문>` 형태로 즉시 응답한다. Discord token만 있으면 실행 가능하다.

**Tier 2 — Claude CLI path isolation (`npm run smoke:claude`)**

Discord 없이 고정 prompt를 Claude CLI Adapter에 직접 전달하고 stdout, stderr, exit code, timeout, failure handling을 검증한다. Discord token과 channel 없이 실행 가능하다.

**Tier 3 — End-to-end integration (`RESPONSE_MODE=claude`)**

앞의 두 tier가 통과한 뒤, 실제 Discord mention에서 Claude CLI 응답까지 전체 경로를 검증한다. 두 외부 의존성이 모두 필요하다.

`RESPONSE_MODE` env var를 runtime behavior toggle의 주 축으로 사용한다. 향후 `mock`, `dry-run` 같은 mode가 추가되더라도 같은 축으로 확장한다.

## Consequences

- 레이어별 실패 격리 가능 — Discord 문제와 Claude CLI 문제를 독립적으로 추적할 수 있다.
- 외부 자격증명이 일부만 있는 환경에서도 해당 tier까지 검증 가능하다.
- Tier 1은 CI에서 Discord bot token만으로 실행할 수 있는 경로를 열어둔다.
- 각 tier를 독립 issue로 관리하므로 특정 tier 실패 시 해당 tier에서만 bugfix가 일어난다.
- `RESPONSE_MODE`가 테스트 전용 환경 설정이 되지 않도록 주의한다 — production에서도 유효한 값은 `claude`뿐이다.
