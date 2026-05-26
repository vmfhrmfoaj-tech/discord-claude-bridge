# Claude CLI Execution Modes

## Purpose

이 문서는 Discord request를 Claude Code CLI에 전달하는 방식의 차이와 v1에서 사용할 CLI parameters를 정리한다. v1 선택은 **per-message `claude -p` + thread/channel session continuity + no-tools policy**다.

참고:

- Anthropic Claude Code CLI reference: `https://docs.anthropic.com/en/docs/claude-code/cli-usage`
- local 확인값: `Claude Code 2.1.148`

## Mode 1: Per-message `claude -p`

각 Discord job마다 child process를 실행하고 응답 후 종료한다.

```bash
claude -p "<prompt>" --output-format json --tools ""
```

장점:

- 구현과 testing이 가장 단순하다.
- request 간 process isolation이 좋다.
- timeout, exit code, stderr handling을 job 단위로 관리하기 쉽다.
- Discord prompt가 long-running interactive session을 오염시킬 가능성이 낮다.

단점:

- process startup overhead가 있다.
- session continuity를 원하면 session-id mapping이 별도로 필요하다.
- streaming UX는 별도 확장이 필요하다.

v1 결정:

- 이 mode를 기본으로 사용한다.
- thread/channel ID 기준 session-id를 저장해 continuity를 제공한다.

## Mode 2: Session Resume

Claude session을 이어서 사용한다. CLI surface는 `--resume`, `--continue`, `--session-id` 계열 option을 사용한다.

예시:

```bash
claude -p "<prompt>" --output-format json --resume "<session-id>"
```

장점:

- 대화 context continuity가 자연스럽다.
- Discord thread/channel 단위 assistant behavior를 만들기 좋다.

단점:

- Discord entity와 Claude session-id mapping 저장소가 필요하다.
- session corruption, expired auth, missing session-id failure mode를 설계해야 한다.
- 일반 channel에서 너무 많은 사용자가 같은 session을 공유하면 context가 섞일 수 있다.

v1 결정:

- execution process는 per-message로 유지한다.
- continuity만 thread/channel key로 제공한다.
- 저장소는 local JSON file로 시작한다.

## Mode 3: Background Agents

`claude agents`는 background session 관리를 위한 CLI surface다.

예시:

```bash
claude agents --json
```

장점:

- long-running agent orchestration으로 확장 가능하다.
- 여러 background session 관찰과 운영에 유리할 수 있다.

단점:

- v1 Discord mention bridge에는 complexity가 크다.
- job lifecycle, permission, routing, cleanup policy를 추가로 설계해야 한다.
- testing과 local operations 문서가 무거워진다.

v1 결정:

- 구현하지 않는다.
- future DevOps assistant 또는 multi-agent workflow 확장 후보로 남긴다.

## CLI Parameter Reference

### Required in v1

`-p`, `--print`

- non-interactive mode로 prompt를 처리하고 exit한다.
- Discord job worker에서 사용한다.

`--output-format json`

- structured result parsing을 위해 사용한다.
- Adapter contract test의 기준 format이다.
- `text`는 단순하지만 metadata/error handling이 약하다.

`--tools ""`

- Discord-triggered prompt에서 Claude Code tools를 비활성화하기 위한 default policy다.
- 구현 시 CLI version별 exact behavior를 smoke test로 확인한다.

### Optional in v1

`--model <model>`

- config의 `claude.model`이 있을 때만 전달한다.
- 비어 있으면 host Claude CLI default를 따른다.
- alias, 예: `sonnet`, 또는 full model name을 허용한다.

`--system-prompt <prompt>`

- bot role, safety policy, response style을 user content와 분리한다.
- 기본 style은 concise Korean helper다.

`--resume <session-id>` 또는 `--session-id <uuid>`

- Discord thread/channel key에 저장된 Claude session을 이어갈 때 사용한다.
- exact option은 implementation smoke test에서 local CLI behavior와 맞춘다.

`--max-budget-usd <amount>`

- print mode에서 request 비용 상한을 둘 때 사용한다.
- v1 example config에는 optional field로만 둔다.

`--fallback-model <model>`

- default model overload 시 fallback을 허용할 때 사용한다.
- v1에서는 optional extension config로만 둔다.

### Extension TODO

`--output-format stream-json`

- partial output streaming과 progress event handling에 사용한다.
- Discord message edit/update policy가 필요하므로 v1에서는 구현하지 않는다.

`--input-format stream-json`

- realtime streaming input에 사용한다.
- v1 mention bridge에는 필요하지 않다.

`--permission-mode <mode>`

- Claude Code permission behavior를 지정한다.
- Discord-triggered execution에서는 no-tools policy가 우선이다.

`--allowedTools`, `--disallowedTools`

- future configured allowlist policy에 사용할 수 있다.
- v1에서는 no-tools가 default다.

`--debug`, `--debug-file`

- local troubleshooting에 유용하다.
- production log에는 secret/prompt leakage 위험이 있으므로 주의한다.

## Security Matrix

| Policy | v1 Default | Reason |
| --- | --- | --- |
| Tool execution | Disabled | Discord prompt injection blast radius 축소 |
| Dangerous permission skip | Forbidden | external user prompt와 host 권한을 분리 |
| API key | Not used | host Claude CLI login을 사용 |
| Output format | JSON | Adapter parsing 안정성 |
| Streaming | TODO | Discord update policy가 더 필요 |
| Session continuity | Thread/channel key | internal team assistant UX 확보 |

