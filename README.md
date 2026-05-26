# discord-claude-bridge

> Discord mention을 host에 로그인된 Claude Code CLI 응답으로 연결하는 self-hosted bridge.

`discord-claude-bridge`는 internal team Discord workspace에서 bot mention을 감지하고, 요청을 in-memory queue에 넣은 뒤, background worker가 `claude -p --output-format json` child process를 실행해 최종 답변을 Discord reply로 돌려주는 bot app입니다.

v1은 Anthropic API key 기반 app이 아닙니다. Claude는 host machine에 설치되고 로그인된 **Claude Code CLI**를 사용합니다.

## Goal

v1 목표는 **Self-hosted Mention Bridge**입니다.

- Discord mention-only interaction을 안정적으로 처리한다.
- Claude Code CLI를 per-message child process로 실행한다.
- Discord thread ID 또는 channel ID 기준으로 Claude session continuity를 유지한다.
- Claude CLI tool execution은 기본적으로 비활성화해 Discord prompt가 filesystem/tool 권한으로 확장되지 않게 한다.
- Node 22 + npm + TypeScript + ESM 기반 app으로 구현한다.

자세한 목표와 non-goals는 [PROJECT_GOAL.MD](PROJECT_GOAL.MD)를 기준으로 합니다.

## Current Scope

현재 repo phase는 **Docs + Examples Only**입니다.

포함:

- project goal 문서
- architecture 문서와 ADR
- Claude CLI execution mode 비교 문서
- `.env.example`
- `config.example.yaml`

미포함:

- `src/` app scaffold
- Discord bot runtime implementation
- package manifest와 test setup

## Requirements

- Node.js 22
- npm
- TypeScript, ESM
- Discord bot token
- Claude Code CLI 설치 및 로그인 완료

Claude CLI 상태 확인:

```bash
claude --version
claude auth status
```

이 repo를 작성할 때 확인한 local CLI version은 `Claude Code 2.1.148`입니다.

## Configuration

Secret은 `.env`에 둡니다. `.env`는 commit하지 않습니다.

```bash
cp .env.example .env
```

Runtime tuning은 YAML config에 둡니다.

```bash
cp config.example.yaml config.yaml
```

v1 config의 기본 방향은 conservative입니다.

- queue concurrency: `1`
- Claude request timeout: `120s`
- max prompt size 제한
- guild/channel allowlist 필수
- Claude tool permission 비활성화

## Architecture

Core flow:

```mermaid
flowchart LR
  A[Discord Ingress] --> B[Mention Parser]
  B --> C[In-memory Job Queue]
  C --> D[Claude CLI Worker]
  D --> E[Reply Publisher]
  E --> F[Discord Reply]
```

핵심 Module:

- `Discord Ingress`: Discord message event를 받아 bot mention 후보만 통과시킵니다.
- `Mention Parser`: mention 여부와 user prompt를 추출합니다.
- `In-memory Job Queue`: Discord event handling과 Claude CLI execution을 분리합니다.
- `Claude CLI Adapter`: `claude -p --output-format json` child process를 실행하고 결과를 parsing합니다.
- `Session Store`: Discord thread/channel ID와 Claude session-id mapping을 JSON file로 저장합니다.
- `Reply Publisher`: typing indicator, final reply, long response split을 처리합니다.

Architecture detail은 [docs/architecture.md](docs/architecture.md)를 기준으로 합니다.

## Claude CLI Policy

v1 기본 command shape:

```bash
claude -p "<prompt>" \
  --output-format json \
  --tools ""
```

설정에 따라 optional로 `--model`, `--system-prompt`, `--resume` 또는 `--session-id` 계열 option을 추가합니다.

Execution mode 비교와 CLI parameter reference는 [CLAUDE_DIFF.MD](CLAUDE_DIFF.MD)를 봅니다.

## Planned Implementation

다음 phase에서 추가할 source structure:

```txt
src/
  bot/
  discord/
  claude/
  queue/
  session/
  config/
  logging/
  index.ts
```

Required tests:

- Mention Parser unit tests
- JSON Session Store contract tests
- Claude CLI Adapter command construction/output parsing tests
- Queue Worker timeout/failure tests
- Reply Publisher split/error response tests

Discord와 Claude actual calls는 fake Adapter로 대체합니다.

## Extension TODO

- [ ] `stream-json` 기반 streaming response
- [ ] Redis queue support
- [ ] SQLite session store
- [ ] Slash commands
- [ ] DM support
- [ ] Docker deployment
- [ ] OpenAI/multi-provider support
- [ ] Prometheus metrics 또는 health endpoint
- [ ] Web dashboard

## License

MIT
