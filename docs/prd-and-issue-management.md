# PRD and Issue Management

이 문서는 `discord-claude-bridge`에서 PRD와 GitHub Issues를 어떻게 관리할지 정리한다.

## 기본 원칙

- PRD는 repo에 versioned document로 둔다.
- GitHub Issue는 agent나 사람이 실제로 집어갈 work queue로 쓴다.
- 긴 product/architecture context는 PRD 문서에 남기고, Issue에는 실행 가능한 scope와 acceptance criteria를 둔다.
- 큰 PRD 하나를 그대로 구현하지 않고, 독립적으로 완료 가능한 작은 implementation issues로 쪼갠다.
- 각 implementation issue는 관련 PRD 문서를 링크한다.

## Current PRD

현재 v1 runtime 구현 PRD는 다음 문서를 기준으로 한다.

- `docs/prd-v1-runtime-implementation.md`

이 PRD는 v1 Self-hosted Mention Bridge runtime의 source of truth다. 포함 범위는 Discord Ingress, Mention Parser, In-memory Job Queue, Claude CLI Adapter, Session Store, Reply Publisher, Config Loader, Structured Logger, tests다.

## Commit and Push Flow

PRD 문서를 작성하거나 수정한 뒤 먼저 repo에 commit한다.

```bash
git add docs/prd-v1-runtime-implementation.md docs/prd-and-issue-management.md
git commit -m "docs: add v1 PRD and issue management guide"
git push origin main
```

PRD 문서가 바뀌면 관련 GitHub Issue에도 변경 내용을 comment로 남긴다. Issue body를 매번 길게 갱신하기보다, repo 문서를 source of truth로 유지하고 Issue에서는 링크와 상태를 관리한다.

## PRD Tracking Issue

GitHub에는 PRD 전체를 추적하는 parent issue를 하나 만든다.

추천 title:

```txt
PRD: v1 Self-hosted Mention Bridge Runtime
```

추천 labels:

```txt
ready-for-agent
prd
implementation
```

추천 body:

```md
## PRD

See `docs/prd-v1-runtime-implementation.md`.

## Scope

Implement v1 Self-hosted Mention Bridge runtime:

- Discord Ingress
- Mention Parser
- In-memory Job Queue
- Claude CLI Adapter
- Session Store
- Reply Publisher
- Config Loader
- Structured Logger

## Acceptance

- Mention-only Discord flow works
- Claude CLI runs per message with no-tools policy
- Thread/channel session continuity works
- Long replies split correctly
- Failure modes are logged and surfaced
- Required Module tests exist
```

## Implementation Issues

PRD tracking issue는 너무 크기 때문에 직접 구현 대상으로 잡지 않는다. 아래처럼 작은 implementation issues로 나눈다.

1. `Scaffold Node 22 TypeScript ESM runtime`
2. `Implement Config Loader and validation`
3. `Implement Mention Parser`
4. `Implement JSON Session Store`
5. `Implement Claude CLI Adapter`
6. `Implement In-memory Job Queue and Worker`
7. `Implement Reply Publisher`
8. `Implement Discord Ingress`
9. `Wire v1 runtime end-to-end`
10. `Add README run/test documentation`

각 issue에는 다음 내용을 포함한다.

- PRD tracking issue link
- 관련 Module 이름
- 구현 범위
- acceptance criteria
- test expectations
- out-of-scope 항목

추천 labels:

```txt
ready-for-agent
implementation
```

테스트 중심 이슈에는 추가로 다음 label을 붙일 수 있다.

```txt
tests
```

## Branch Strategy

PRD 단위 branch보다 issue 단위 branch를 기본으로 사용한다.

PRD는 parent tracking issue와 repo 문서로 관리한다. 실제 구현은 작은 implementation issue마다 독립 branch를 만든다. PRD 전체를 하나의 branch에서 구현하면 작업 기간이 길어지고, review, conflict resolution, rollback이 무거워질 수 있다.

추천 branch naming:

```txt
issue-2-scaffold-runtime
issue-3-config-loader
issue-4-mention-parser
issue-5-session-store
issue-6-claude-cli-adapter
```

PRD 자체를 작성하거나 크게 수정할 때만 docs branch를 사용할 수 있다.

```txt
docs/prd-v1-runtime
```

구현 작업은 PRD branch에서 이어가지 않는다. 각 implementation issue는 `main`에서 새 branch를 만들고, PR은 해당 issue를 close하도록 연결한다.

## Issue Shape

좋은 implementation issue는 작고 독립적이어야 한다.

권장 template:

```md
## Context

Related PRD: `docs/prd-v1-runtime-implementation.md`
Parent issue: #<PRD_TRACKING_ISSUE_NUMBER>

## Scope

- Build or modify <Module name>
- Keep behavior aligned with the PRD and ADRs

## Acceptance Criteria

- <Observable behavior>
- <Observable behavior>
- <Failure mode or edge case>

## Testing

- Add tests through the Module Interface
- Fake external Discord, Claude CLI, and filesystem dependencies where appropriate

## Out of Scope

- <Explicit non-goal>
```

## Label Policy

Use labels as lightweight routing hints.

- `ready-for-agent`: issue is clear enough for an agent to start.
- `prd`: issue tracks a product requirements document.
- `implementation`: issue changes runtime code or app behavior.
- `tests`: issue primarily adds or changes test coverage.
- `docs`: issue primarily updates documentation.

Avoid marking an issue `ready-for-agent` until the scope, acceptance criteria, and out-of-scope items are clear.

## GitHub CLI

현재 local environment에 `gh` CLI가 없으면 GitHub web UI에서 issues를 만든다.

나중에 `gh`를 설치하면 PRD tracking issue는 다음처럼 만들 수 있다.

```bash
gh issue create \
  --title "PRD: v1 Self-hosted Mention Bridge Runtime" \
  --label ready-for-agent \
  --label prd \
  --label implementation \
  --body-file docs/prd-v1-runtime-implementation.md
```

작은 implementation issues는 web UI나 `gh issue create`로 하나씩 만든다. 각 issue body에는 PRD 전체를 붙이지 말고 PRD 문서와 parent issue를 링크한다.

## Maintenance Rules

- PRD 변경은 repo commit으로 남긴다.
- PRD tracking issue에는 중요한 PRD 변경을 comment로 남긴다.
- Implementation issue가 완료되면 PRD tracking issue checklist나 comment에 반영한다.
- 구현 중 scope가 커지면 기존 issue를 키우지 말고 새 issue로 분리한다.
- ADR과 충돌하는 구현 결정이 생기면 먼저 ADR을 추가하거나 수정한다.
- `docs/context.md`의 domain vocabulary와 `docs/architecture.md`의 Module map을 issue 설명에서도 유지한다.
