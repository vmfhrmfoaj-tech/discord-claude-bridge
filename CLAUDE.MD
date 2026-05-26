# CLAUDE.MD

## Purpose

이 파일은 Claude Code가 이 repo에서 작업할 때 따라야 할 Claude-specific guide다. 일반 coding agent 규칙은 [AGENTS.MD](AGENTS.MD)를 따른다.

## Project Shape

- v1 product는 self-hosted Discord bot app이다.
- Claude integration은 Anthropic API key가 아니라 host에 로그인된 Claude Code CLI다.
- 이번 repo phase는 Docs + Examples Only다. source scaffold는 별도 요청 전까지 만들지 않는다.

## Claude CLI Assumptions

- host에 `claude` binary가 설치되어 있어야 한다.
- host 사용자는 `claude auth login` 또는 equivalent 방식으로 로그인되어 있어야 한다.
- docs 작성 시 local 확인값은 `Claude Code 2.1.148`이다.
- CLI reference는 Anthropic 공식 문서 `https://docs.anthropic.com/en/docs/claude-code/cli-usage`를 우선한다.

## Security Rules

- Discord user prompt를 Claude Code tool execution 권한으로 연결하지 않는다.
- v1 command policy는 no-tools다. 구현 시 `--tools ""`를 사용한다.
- `--dangerously-skip-permissions`는 Discord-triggered execution에서 금지한다.
- `.env`와 local auth/session data를 commit하지 않는다.
- `.data/sessions.json`은 runtime state이며 source of truth 문서가 아니다.

## Implementation Guidance

- Claude CLI integration은 `Claude CLI Adapter` Module 뒤에 숨긴다.
- Adapter Interface는 command construction, timeout, output parsing, session-id handling, error mapping을 포함한다.
- caller는 raw child process details를 알면 안 된다.
- `--output-format json`을 v1 default로 사용한다.
- `stream-json`은 extension TODO로만 남긴다.

## Prompt Policy

- system prompt와 Discord user content를 분리한다.
- 기본 system prompt는 concise Korean helper style을 요구한다.
- Discord message를 shell command string으로 직접 interpolation하지 말고 argv array로 전달한다.

