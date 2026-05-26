# discord-claude-bridge

> Discord mention을 host에 로그인된 Claude Code CLI 응답으로 연결하는 self-hosted bridge.

`discord-claude-bridge`는 internal team Discord workspace에서 bot mention을 감지하고, 요청을 in-memory queue에 넣은 뒤, background worker가 `claude -p --output-format json` child process를 실행해 최종 답변을 Discord reply로 돌려주는 bot app입니다.

v1은 Anthropic API key 기반 app이 아닙니다. Claude는 host machine에 설치되고 로그인된 **Claude Code CLI**를 사용합니다.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure secrets

`.env`에 Discord token을 설정합니다. `.env`는 commit하지 않습니다.

```bash
cp .env.example .env
```

`.env` 필수 key:

```dotenv
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
```

### 3. Configure runtime options

YAML config를 복사하고 deployment별로 수정합니다.

```bash
cp config.example.yaml config.yaml
```

주요 설정:

| Key | Default | 설명 |
|-----|---------|------|
| `discord.allowedGuildIds` | `["000..."]` | 응답할 guild ID 목록. v1은 반드시 채워야 함. |
| `queue.concurrency` | `1` | 동시 Claude CLI 프로세스 수. conservative 기본값. |
| `claude.model` | `null` | null이면 host CLI default 사용. |
| `claude.timeoutMs` | `120000` | Claude CLI child process timeout. |
| `session.storePath` | `.data/sessions.json` | session 매핑 저장 경로. commit 제외. |

### 4. Run the Local Node Process

```bash
npm run build
npm start
```

또는 개발 중 typecheck:

```bash
npm run typecheck
```

## Development

### Tests

```bash
npm test
```

### Lint

```bash
npm run lint
```

### Format check

```bash
npm run format:check
```

### Local fake smoke flow

실제 Discord와 Claude CLI 없이 전체 flow를 검증하려면:

```bash
npm test -- tests/e2e-fake-flow.test.ts
```

`e2e-fake-flow` test는 `FakeDiscordIngress`와 `FakeClaudeAdapter`를 사용해 mention → queue → worker → reply 경로를 end-to-end로 실행합니다.

## Local Smoke Guidance

Bot을 Discord에 배치하기 전에 아래 항목을 순서대로 확인합니다.

### 1. Claude CLI 확인

```bash
claude --version
claude auth status
```

`claude --version`이 실패하면 [Claude Code CLI](https://claude.ai/code) 설치 필요.  
`claude auth status`가 `Not logged in`이면 `claude auth login` 실행.

### 2. 필수 환경변수 확인

```bash
node -e "
  const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];
  required.forEach(k => {
    if (!process.env[k]) console.error('MISSING:', k);
    else console.log('OK:', k);
  });
"
```

또는 `.env` 로드 후:

```bash
node --env-file=.env -e "
  ['DISCORD_TOKEN','DISCORD_CLIENT_ID'].forEach(k =>
    console.log(k, process.env[k] ? 'set' : 'MISSING')
  );
"
```

### 3. Config 유효성 확인

```bash
npm run typecheck
```

`config.yaml`에 `allowedGuildIds`가 실제 guild ID로 채워져 있어야 합니다. 기본값 `"000000000000000000"`은 응답하지 않습니다.

### 4. Fake E2E smoke

```bash
npm test -- tests/e2e-fake-flow.test.ts --reporter=verbose
```

전체 test suite:

```bash
npm test
```

### 5. Runtime 구동 확인

```bash
npm run build && npm start
```

로그에 `runtime started` 또는 `Discord client ready` 메시지가 나오고 프로세스가 종료되지 않으면 정상입니다.

## Branch Naming

이 repo는 issue-sized branch 전략을 사용합니다. Branch 이름은 `issue-<number>-<short-slug>` 형식입니다.

실제 예:

```
issue-10-discord-ingress-runtime
issue-11-structured-logging
issue-12-e2e-fake-adapter-mention-reply
issue-13-readme-smoke-docs
```

PR은 branch 당 하나, issue 당 하나입니다.

## Goal

v1 목표는 **Self-hosted Mention Bridge**입니다.

- Discord mention-only interaction을 안정적으로 처리한다.
- Claude Code CLI를 per-message child process로 실행한다.
- Discord thread ID 또는 channel ID 기준으로 Claude session continuity를 유지한다.
- Claude CLI tool execution은 기본적으로 비활성화해 Discord prompt가 filesystem/tool 권한으로 확장되지 않게 한다.
- Node 22 + npm + TypeScript + ESM 기반 app으로 구현한다.

자세한 목표와 non-goals는 [PROJECT_GOAL.MD](PROJECT_GOAL.MD)를 기준으로 합니다.

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

v1은 **Claude CLI Adapter** 방식을 사용합니다. host user는 Claude Code CLI에 이미 로그인되어 있어야 합니다. Anthropic API key는 필요하지 않습니다.

v1 기본 command shape:

```bash
claude -p "<prompt>" \
  --output-format json \
  --tools ""
```

`--tools ""`는 Discord-triggered prompt에서 Claude Code tools를 비활성화합니다. host filesystem과 shell을 prompt injection으로부터 보호하기 위한 기본 정책입니다.

설정에 따라 optional로 `--model`, `--system-prompt`, `--resume` 또는 `--session-id` 계열 option을 추가합니다.

Execution mode 비교와 CLI parameter reference는 [CLAUDE_DIFF.MD](CLAUDE_DIFF.MD)를 봅니다.

## v1 Non-Goals

아래 항목은 **v1 out of scope**입니다.

| 항목 | 이유 |
|------|------|
| Anthropic API key 통합 | v1은 host Claude CLI auth 방식만 사용 |
| Docker-first deployment | Local Node Process가 v1 target |
| Redis queue | In-memory queue가 v1 충분 |
| SQLite session store | JSON file store가 v1 충분 |
| Slash commands | Mention-only가 v1 interaction model |
| DM support | Guild mention-only가 v1 scope |
| Web dashboard | Console log + structured JSON이 v1 observability |

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
