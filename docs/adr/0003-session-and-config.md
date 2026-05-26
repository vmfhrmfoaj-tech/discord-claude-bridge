# ADR-0003: Session and Config Policy

## Status

Accepted

## Context

bot은 full memory system 없이도 team context에서 유용하게 답해야 한다. Per-message child process는 execution을 단순하게 유지하지만, 사용자는 thread/channel 단위 continuity를 기대한다.

## Decision

v1은 per-message Claude CLI child process를 사용하되 Discord thread/channel session continuity를 제공한다.

- Session key: Discord thread ID가 있으면 thread ID, 없으면 channel ID.
- Session store: local JSON file, 기본값 `.data/sessions.json`.
- Secrets: `.env`, commit하지 않는다.
- Runtime config: YAML, `config.example.yaml`에 상세 주석을 둔다.
- Discord access: guild/channel allowlist.

## Consequences

- `.data/`를 persist하면 restart 후에도 session mapping을 유지할 수 있다.
- JSON corruption과 missing session case는 명시적인 failure handling이 필요하다.
- SQLite와 Redis는 future Adapter이며 v1 default가 아니다.
- Config는 readable non-secret file로 유지하고 token은 `.env`에 둔다.
