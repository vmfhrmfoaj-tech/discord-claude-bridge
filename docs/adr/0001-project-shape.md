# ADR-0001: Project Shape

## Status

Accepted

## Context

초기 README는 lightweight Discord bot framework와 Anthropic Claude API usage를 암시했다. 현재 v1 product direction은 Claude Code CLI가 이미 설치되고 로그인된 machine에서 self-host하는 internal team bot이다.

## Decision

v1은 **Internal Team** use case를 위한 **Bot App**이며, **Local Node Process**로 실행한다.

v1은 reusable framework/library가 아니다.

## Consequences

- README와 docs는 npm package publishing이 아니라 self-hosted bot 운영에 집중한다.
- Node 22 + npm + TypeScript + ESM을 baseline stack으로 둔다.
- Docker, public multi-guild community hardening, slash command UX는 extension TODO로 둔다.
- Architecture는 Discord Ingress, Queue Worker, Claude CLI Adapter 주변의 Locality를 우선한다.
