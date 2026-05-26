# PRD: v1 Self-hosted Mention Bridge Runtime

Triage label: `ready-for-agent`

## Problem Statement

현재 `discord-claude-bridge`는 project goal, architecture, ADR, example config가 정리된 Docs + Examples Only phase에 있다. Internal team Discord workspace에서 bot mention을 Claude Code CLI response로 연결하려는 product direction은 명확하지만, 아직 runtime source scaffold, Discord bot event handling, Claude CLI child process execution, session continuity, queue worker, reply publishing, tests가 구현되어 있지 않다.

사용자는 Discord channel 또는 thread에서 bot을 mention했을 때 host machine에 로그인된 Claude Code CLI가 안전하게 실행되고, thread/channel 단위 context를 이어가며, 긴 응답과 failure를 Discord UX에 맞게 처리하는 self-hosted bot app을 원한다. 동시에 v1은 Anthropic API key integration, reusable framework, slash command, DM, Docker, Redis, web dashboard가 아니라 Local Node Process로 운영되는 conservative bot app이어야 한다.

## Solution

v1 runtime을 Node.js 22 + npm + TypeScript + ESM 기반 bot app으로 구현한다. Discord message event는 allowlist와 mention-only policy를 통과한 뒤 normalized request로 변환되고, event handler는 Claude CLI completion을 기다리지 않고 in-memory Job Queue에 job을 넘긴다. Background Worker는 request마다 `claude -p --output-format json` child process를 실행하고, no-tools policy를 기본값으로 적용하며, Discord thread ID 또는 channel ID 기준 session-id mapping을 JSON Session Store에 저장한다.

사용자는 bot mention 후 typing indicator를 보고, 작업 완료 시 원 message에 final reply를 받는다. Claude output이 Discord message limit을 넘으면 Reply Publisher가 여러 message로 split한다. timeout, missing CLI, auth failure, invalid JSON, Discord reply failure 같은 error mode는 requestId와 structured console logs로 추적 가능하게 만들고, 사용자에게는 concise Korean failure reply를 제공한다.

## User Stories

1. As an internal team Discord user, I want to mention the bot in an allowed channel, so that I can ask Claude for help without leaving Discord.
2. As an internal team Discord user, I want the bot to ignore messages that do not mention it, so that normal team conversation is not intercepted.
3. As an internal team Discord user, I want the bot to show a typing indicator while processing, so that I know my request was accepted.
4. As an internal team Discord user, I want the bot to reply to my original message, so that the answer stays attached to the question.
5. As an internal team Discord user, I want replies to be concise Korean by default, so that team communication stays practical and readable.
6. As an internal team Discord user, I want code identifiers, logs, and domain terms to remain in English when clearer, so that technical answers stay precise.
7. As an internal team Discord user, I want long Claude responses to be split into Discord-sized chunks, so that useful answers are not lost.
8. As an internal team Discord user, I want the bot to preserve context inside a Discord thread, so that follow-up questions continue the same Claude session.
9. As an internal team Discord user, I want channel-level continuity when no thread exists, so that repeated channel mentions can share context.
10. As an internal team Discord user, I want oversized prompts to be rejected or trimmed according to config, so that accidental huge messages do not overload the bot.
11. As an internal team Discord user, I want a clear failure reply when Claude times out, so that I know to retry or shorten the prompt.
12. As an internal team Discord user, I want a clear failure reply when Claude CLI is unavailable, so that an operator can fix host setup.
13. As an internal team Discord user, I want the bot to avoid leaking secrets in errors, so that operational failures do not expose sensitive data.
14. As a bot operator, I want the app to run as a Local Node Process, so that v1 deployment stays simple and self-hosted.
15. As a bot operator, I want Discord token and client ID to come from `.env`, so that secrets are not stored in runtime config.
16. As a bot operator, I want non-secret runtime options to come from YAML config, so that behavior can be tuned without code changes.
17. As a bot operator, I want guild/channel allowlists to be required or strongly encouraged, so that the bot is only active in approved Discord spaces.
18. As a bot operator, I want queue concurrency to default to one, so that Claude CLI child process load stays conservative.
19. As a bot operator, I want max pending jobs to be configurable, so that the app can apply backpressure under bursty mention traffic.
20. As a bot operator, I want each job to have a requestId, so that Discord events, queue state, Claude execution, and reply publishing can be correlated.
21. As a bot operator, I want structured console logs, so that request status, duration, exit code, guild, channel, and thread can be searched reliably.
22. As a bot operator, I want startup validation for required config, so that common deployment mistakes fail early.
23. As a bot operator, I want Claude CLI auth or binary problems to be surfaced clearly, so that host setup can be corrected.
24. As a bot operator, I want session-id mappings persisted locally, so that restarts do not always lose thread/channel continuity.
25. As a bot operator, I want invalid session store JSON to be handled deliberately, so that a corrupt local file does not produce silent misrouting.
26. As a bot operator, I want Discord-triggered Claude tool execution disabled by default, so that prompt injection cannot directly expand into host filesystem or shell access.
27. As a bot operator, I want dangerous Claude permission bypass flags to be forbidden, so that internal Discord prompts do not inherit unsafe host privileges.
28. As a bot operator, I want optional Claude model and system prompt config, so that response style can be tuned while preserving safe defaults.
29. As a bot operator, I want optional per-request budget config to be passed only when configured, so that host Claude CLI defaults remain usable.
30. As a developer, I want a clear Module map, so that implementation follows the documented architecture vocabulary.
31. As a developer, I want Discord-specific message parsing isolated in Mention Parser, so that the rest of the flow works with normalized requests.
32. As a developer, I want Claude child process details hidden behind Claude CLI Adapter, so that command construction, timeout, parsing, and error mapping stay local.
33. As a developer, I want Session Store behind a small Interface, so that JSON file storage can later be replaced by SQLite without changing the Worker contract.
34. As a developer, I want Job Queue behind a small Interface, so that Redis can later replace in-memory queue without changing Discord Ingress.
35. As a developer, I want Reply Publisher to own Discord message splitting and failure replies, so that Worker logic does not know Discord formatting limits.
36. As a developer, I want external Discord and Claude calls to be faked in tests, so that test runs are fast, deterministic, and safe.
37. As a maintainer, I want v1 to avoid slash commands and DM support, so that mention-only interaction can ship first.
38. As a maintainer, I want v1 to avoid Anthropic API key integration, so that the product remains a Claude Code CLI bridge rather than an API wrapper.
39. As a maintainer, I want v1 to avoid Docker-first assumptions, so that local host Claude CLI auth remains the explicit runtime model.
40. As a maintainer, I want extension TODOs to remain visible but unimplemented, so that future work does not distort v1 scope.

## Implementation Decisions

- Build a bot app runtime rather than a reusable framework or library.
- Use Node.js 22, npm, TypeScript, ESM, strict TypeScript, ESLint, Prettier, Vitest, and discord.js as the implementation baseline.
- Add source scaffold only for the runtime implementation phase. Keep docs/examples assumptions intact and do not change v1 product shape.
- Discord Ingress accepts Discord message events, applies guild/channel allowlist policy, ignores bot/self messages, and forwards only mention candidates.
- Mention Parser is a deep Module that converts Discord-specific message shape into either an ignored result or a normalized mention request. It owns mention detection, self-reply prevention, prompt trimming, and max prompt size policy if assigned during implementation.
- Job Queue is a deep Module that separates Discord event handling from Claude CLI execution. It accepts normalized mention requests, assigns requestId, tracks pending/running/completed/failed state, enforces max pending jobs, and exposes shutdown behavior.
- Claude CLI Worker claims jobs from the Job Queue, loads session-id by Discord scope key, calls Claude CLI Adapter, persists updated session-id, and asks Reply Publisher to publish success or failure.
- Claude CLI Adapter is a deep Module with a stable Interface for command construction, argv safety, timeout handling, stdout/stderr capture, JSON parsing, exit code mapping, session option handling, model/system prompt/budget options, and no-tools policy.
- Claude CLI Adapter must pass Discord user content as argv data rather than shell-interpolated command text.
- Claude CLI Adapter uses print mode with JSON output as v1 default.
- Claude CLI Adapter disables tools by default and must not use dangerous permission bypass flags for Discord-triggered execution.
- Claude CLI Adapter may include optional model, system prompt, session resume, and budget flags only when configured or when a valid session-id exists.
- Session Store is a deep Module with a small Interface for loading and saving Claude session-id by Discord scope key.
- Session key policy is thread ID when the message is inside a thread, otherwise channel ID.
- JSON Session Store is the only v1 Adapter and persists local runtime state. SQLite remains out of scope.
- Config Loader reads secrets from environment and non-secret runtime options from YAML config. It validates required Discord token, Discord client ID, allowlist shape, queue limits, Claude options, prompt limits, session settings, reply limits, and logging format.
- Reply Publisher owns typing indicator, final replies, long response split, chunk ordering, and concise failure replies.
- Structured Logger emits requestId, guildId, channelId, threadId, job status, duration, exit code, and mapped error category without leaking secrets.
- Discord event handler must not wait for Claude CLI completion before returning control to the Discord runtime.
- Queue concurrency defaults to one and is configurable.
- Claude request timeout defaults to 120 seconds and is configurable.
- Reply chunk size defaults below the Discord 2000-character limit to leave room for chunk markers and formatting.
- Failure handling maps timeout, missing CLI, auth failure, non-zero exit, invalid JSON, invalid session mapping, queue full, deleted message, permission failure, and rate limit into explicit log categories and user-facing messages where appropriate.
- Invalid or missing session mappings should not crash the bot. The implementation should either clear the broken mapping or proceed without resume according to a documented local policy.
- Startup should validate configuration and, where practical, detect missing Claude CLI before accepting Discord events.
- Streaming response, Redis queue, SQLite session store, slash commands, DM support, Docker deployment, multi-provider support, metrics, health endpoint, and web dashboard remain extension TODOs.

## Testing Decisions

- Good tests should verify external Module behavior through public Interfaces, not private implementation details.
- Tests should use fake Discord and Claude dependencies rather than actual Discord Gateway, Discord REST, or Claude CLI calls.
- Mention Parser unit tests should cover mention-only acceptance, non-mention ignore, self-message ignore, prompt extraction, trimming, empty prompt, channel/thread metadata normalization, and max prompt size behavior.
- Config Loader tests should cover valid config loading, missing secrets, invalid allowlist, invalid queue limits, invalid Claude timeout, invalid reply chunk size, default values, and environment config path handling.
- JSON Session Store contract tests should cover missing file, empty store, read existing mapping, write new mapping, update mapping, invalid JSON, write failure, and thread/channel key policy.
- Claude CLI Adapter contract tests should cover argv construction, no-tools default, optional model/system prompt/budget/session flags, timeout mapping, non-zero exit mapping, invalid JSON mapping, missing binary mapping, auth failure mapping, stdout parsing, stderr capture, and session-id extraction.
- Job Queue and Worker tests should cover enqueue acceptance, queue full rejection, concurrency one behavior, job timeout, job failure, successful completion, shutdown behavior, requestId propagation, and session load/save ordering.
- Reply Publisher tests should cover typing indicator behavior, final reply, long response split, split ordering, failure reply, deleted message failure, permission failure, and rate limit mapping.
- Structured logging tests should verify that required correlation fields are emitted and secrets are not included.
- Integration-style tests should wire fake Discord Ingress, in-memory Queue, fake Claude CLI Adapter, JSON or fake Session Store, and fake Reply Publisher to prove the full mention-to-reply flow.
- Prior art is the test direction already documented for Mention Parser, JSON Session Store, Claude CLI Adapter, Queue Worker, and Reply Publisher. There are no existing source tests yet, so implementation should establish these patterns as the first test suite.

## Out of Scope

- Anthropic API key integration.
- Reusable npm framework or library packaging.
- Slash commands.
- DM support.
- Docker deployment.
- Redis queue.
- SQLite session store.
- Streaming response with `stream-json`.
- OpenAI or multi-provider routing.
- Prometheus metrics, health endpoint, or web dashboard.
- Public multi-guild community hardening beyond configured internal allowlists.
- Claude Code tool execution for Discord-triggered prompts.
- Dangerous Claude permission bypass behavior.
- Background agents or long-running Claude agent orchestration.
- Publishing source package to npm.

## Further Notes

- This PRD follows the accepted v1 direction: Self-hosted Mention Bridge, Local Node Process, Claude CLI Adapter, in-memory Job Queue, JSON Session Store, and conservative no-tools policy.
- The implementation should preserve the project vocabulary: Module, Interface, Implementation, Seam, Adapter, Depth, Leverage, and Locality.
- The most important deep Modules are Mention Parser, Job Queue, Claude CLI Adapter, Session Store, Config Loader, and Reply Publisher. Each should hide meaningful behavior behind a small testable Interface.
- This document is prepared as an issue-ready PRD with the `ready-for-agent` label noted at the top.
