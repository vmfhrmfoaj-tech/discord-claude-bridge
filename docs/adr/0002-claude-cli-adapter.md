# ADR-0002: Claude CLI Adapter

## Status

Accepted

## Context

v1은 Anthropic API를 직접 호출하지 않는다. 의도한 runtime environment에는 Claude Code CLI가 이미 설치되어 있고 host user가 로그인되어 있다.

## Decision

v1은 Claude Code CLI를 child process로 실행하는 `Claude CLI Adapter` Module을 사용한다.

기본 command shape:

```bash
claude -p "<prompt>" --output-format json --tools ""
```

Adapter는 command construction, timeout handling, JSON parsing, exit code mapping, session option handling, security defaults를 소유한다.

## Consequences

- `.env`는 `CLAUDE_API_KEY`를 포함하지 않는다.
- Runtime은 host Claude CLI auth state에 의존한다.
- Test는 child process runner를 fake로 대체하고 Adapter contract를 검증한다.
- `stream-json`, provider routing, Anthropic API Adapter는 TODO로 둔다.
- Discord-triggered execution에서는 dangerous permission bypass flag를 사용하지 않는다.
