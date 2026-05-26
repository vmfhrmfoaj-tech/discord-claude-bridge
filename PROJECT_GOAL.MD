# Project Goal

## Title

`discord-claude-bridge` v1은 **Self-hosted Mention Bridge**다.

## Goal

Internal team Discord workspace에서 bot mention을 받으면, host machine에 로그인된 Claude Code CLI를 background child process로 실행해 답변을 생성하고 Discord reply로 돌려준다.

이 project는 v1에서 "Claude API wrapper"가 아니라 "Discord ingress와 Claude CLI execution을 안전하게 연결하는 bot app"이다.

## Success Criteria

- Discord guild/channel allowlist 안에서 bot mention만 처리한다.
- Discord event handler는 오래 block하지 않고 in-memory queue에 job을 넘긴다.
- Worker는 request마다 `claude -p --output-format json` child process를 실행한다.
- Claude CLI tools는 기본 비활성화한다.
- Discord thread ID, 없으면 channel ID 기준으로 Claude session continuity를 유지한다.
- session-id mapping은 local JSON file, 예: `.data/sessions.json`, 에 저장한다.
- typing indicator 후 final reply를 보낸다.
- 긴 Claude output은 Discord message limit에 맞춰 split한다.
- structured console logs로 requestId, guild/channel, job status, duration, exit code를 남긴다.

## Non-goals

- v1은 Anthropic API key 기반 integration을 구현하지 않는다.
- v1은 reusable npm framework/library가 아니다.
- v1은 slash command, DM, Docker, Redis queue, web dashboard를 구현하지 않는다.
- v1은 Claude CLI tool execution을 Discord 사용자에게 열지 않는다.
- 이번 phase는 source code scaffold를 만들지 않는다. docs와 examples만 작성한다.

## Baseline Stack

- Node.js 22
- npm
- TypeScript
- ESM
- strict TypeScript
- ESLint
- Prettier
- Vitest
- discord.js
- Claude Code CLI

## User Experience

- 사용자는 Discord channel 또는 thread에서 bot을 mention한다.
- bot은 typing indicator로 processing 상태를 보여준다.
- 작업이 끝나면 원 message에 final reply를 보낸다.
- 기본 응답 style은 concise Korean helper다. 한국어 중심으로 짧고 실용적으로 답하되, code/log/domain terms는 English를 유지한다.

## Extension TODO

- Streaming response: `--output-format stream-json`와 partial message update.
- Persistent queue: Redis Adapter.
- Session storage: SQLite Adapter.
- Discord interactions: slash commands, DM support, thread-first UX.
- AI providers: OpenAI/multi-provider Interface.
- Deployment: Docker와 process manager docs.
- Observability: metrics, health endpoint, dashboard.

