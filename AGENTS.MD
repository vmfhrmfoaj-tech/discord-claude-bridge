# AGENTS.MD

## Purpose

이 파일은 이 repo에서 작업하는 모든 coding agent의 공통 contract다. Claude-specific 내용은 [CLAUDE.MD](CLAUDE.MD)를 추가로 따른다.

## Language

- 문서는 한국어 문장 + English dev terms 스타일로 작성한다.
- architecture 용어는 `Module`, `Interface`, `Implementation`, `Seam`, `Adapter`, `Depth`, `Leverage`, `Locality`를 사용한다.
- "component", "service", "boundary"는 architecture 설명의 기본 용어로 쓰지 않는다.

## Project Rules

- v1은 Discord mention을 Claude Code CLI response로 연결하는 bot app이다.
- v1은 library/framework가 아니다.
- Anthropic API key integration을 전제로 설계하지 않는다.
- source code scaffold는 별도 phase다. docs/examples 작업에서 임의로 `src/`를 만들지 않는다.

## Architecture Rules

- shallow pass-through Module을 늘리지 않는다.
- Interface는 type signature뿐 아니라 invariants, ordering, error modes, config를 포함한다.
- external Seam은 실제 variation이 있을 때 만든다. 하나의 Adapter만 있으면 TODO로 남길 수 있다.
- test surface는 Module Interface와 일치해야 한다.
- Discord, Claude CLI, filesystem session store는 각각 Adapter 뒤에 둔다.

## Development Baseline

다음 implementation phase의 baseline:

- Node.js 22
- npm
- TypeScript + ESM
- strict TypeScript
- ESLint
- Prettier
- Vitest
- structured console logging

## Required Test Direction

- Mention Parser unit tests
- JSON Session Store contract tests
- Claude CLI Adapter command construction/output parsing tests
- Queue Worker timeout/failure tests
- Reply Publisher split/error response tests
- external Discord/Claude calls는 fake Adapter로 대체한다.

## Secrets and Runtime State

- `.env`는 commit하지 않는다.
- `.env.example`에는 secret name과 placeholder만 둔다.
- `config.example.yaml`에는 non-secret runtime options와 상세 주석을 둔다.
- `.data/`는 runtime state로 취급한다.

