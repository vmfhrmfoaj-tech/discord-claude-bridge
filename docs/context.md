# Project Context

## Domain Vocabulary

`Discord Ingress`

- Discord message event를 받아 project 내부 job으로 변환하는 Module.
- v1에서는 mention-only event만 통과시킨다.

`Mention Parser`

- bot mention 여부와 user prompt를 추출하는 Module.
- Discord-specific message shape를 나머지 flow에서 분리한다.

`Job Queue`

- Discord event handling과 Claude CLI execution을 분리하는 in-memory queue.
- v1 Adapter는 process-local이다. Redis는 TODO다.

`Claude CLI Adapter`

- Claude Code CLI child process 실행을 감추는 Module.
- command construction, timeout, output parsing, exit code mapping을 Interface 뒤에 둔다.

`Session Store`

- Discord thread/channel key와 Claude session-id mapping을 저장하는 Module.
- v1 Adapter는 JSON file이다. SQLite는 TODO다.

`Reply Publisher`

- typing indicator, final reply, long response split, failure message를 처리하는 Module.

## Architecture Vocabulary

`Module`

- Interface와 Implementation을 가진 단위.

`Interface`

- caller가 Module을 올바르게 쓰기 위해 알아야 하는 모든 것. type signature, invariants, ordering, error modes, config를 포함한다.

`Implementation`

- Module 내부 동작.

`Seam`

- Interface가 위치하는 지점. behavior를 editing 없이 바꿀 수 있는 자리다.

`Adapter`

- Seam에 놓이는 concrete implementation.

`Depth`

- 작은 Interface 뒤에 많은 behavior가 숨어 있을수록 deep하다.

`Leverage`

- caller가 Interface를 배워 얻는 capability.

`Locality`

- change, bugs, knowledge, verification이 집중되는 정도.

## Naming Rules

- "service", "component", "boundary"보다 `Module`, `Adapter`, `Seam`을 우선한다.
- Discord, Claude CLI, filesystem은 external dependency로 보고 Adapter 뒤에 둔다.
- v1에서 하나의 Adapter만 있는 Seam은 future extension reason이 분명할 때만 문서화한다.

