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








#### to-prd prompt example
```
[$to-prd] 프로젝트 문서들을 기준으로 v1 runtime 구현 PRD를 작성해줘.

반드시 참고할 문서:
- README.md
- PROJECT_GOAL.MD
- AGENTS.MD
- CLAUDE.MD
- CLAUDE_DIFF.MD
- config.example.yaml
- .env.example
- docs/context.md
- docs/architecture.md
- docs/adr/

목표:
- 현재 repo는 Docs + Examples Only phase야.
- 다음 phase에서 구현할 v1 Self-hosted Mention Bridge runtime PRD를 작성해줘.
- v1은 Discord mention을 host에 로그인된 Claude Code CLI 응답으로 연결하는 self-hosted bot app이야.
- Anthropic API key integration, reusable framework/library, slash command, DM, Docker, Redis, SQLite, web dashboard는 v1 scope가 아니야.

PRD에 반드시 포함할 것:
- Problem Statement
- Solution
- 아주 상세한 User Stories
- Implementation Decisions
- Testing Decisions
- Out of Scope
- Further Notes

작성 기준:
- 프로젝트 vocabulary를 따라줘: Module, Interface, Implementation, Seam, Adapter, Depth, Leverage, Locality.
- "service", "component", "boundary" 대신 Module, Adapter, Seam 용어를 우선해줘.
- ADR 결정을 지켜줘:
  - v1은 Bot App, not framework
  - Local Node Process, not Docker-first
  - Claude CLI Adapter, not Anthropic API Adapter
  - In-memory Job Queue, not Redis
  - JSON Session Store, not SQLite
  - Discord-triggered Claude tool execution은 no-tools policy
- source scaffold나 코드는 만들지 말고 PRD 문서만 작성해줘.
- PRD는 GitHub issue body로도 사용할 수 있게 issue-ready 형태로 작성해줘.
- 상단에 `Triage label: ready-for-agent`를 포함해줘.

구현 범위로 다룰 Module:
- Discord Ingress
- Mention Parser
- In-memory Job Queue
- Claude CLI Worker
- Claude CLI Adapter
- Session Store
- Reply Publisher
- Config Loader
- Structured Logger

테스트 방향:
- external Discord/Claude calls는 fake Adapter로 대체
- Mention Parser unit tests
- JSON Session Store contract tests
- Claude CLI Adapter command construction/output parsing tests
- Queue Worker timeout/failure tests
- Reply Publisher split/error response tests
- end-to-end fake adapter mention-to-reply flow

출력:
- 먼저 PRD 초안을 작성해줘.
- 가능하면 `docs/prd-v1-runtime-implementation.md`에 저장해줘.
- GitHub issue tracker가 사용 가능하면 PRD tracking issue로 등록해줘.
- issue tracker를 사용할 수 없으면 repo 문서로만 남기고, 나중에 issue로 등록할 수 있게 만들어줘.
```





#### to-issues prompt example
```
[$to-issues] GitHub issue #1의 PRD를 기준으로 v1 runtime 구현을 independently-grabbable GitHub issues로 나눠줘.

반드시 참고할 문서:
- GitHub issue #1: PRD parent issue
- docs/prd-v1-runtime-implementation.md
- docs/prd-and-issue-management.md
- docs/context.md
- docs/architecture.md
- docs/adr/

목표:
- PRD 전체를 바로 구현하는 큰 issue로 만들지 말고, agent가 하나씩 잡아 완료할 수 있는 작은 implementation issues로 쪼개줘.
- 각 issue는 parent issue #1을 링크해야 해.
- 각 issue에는 `ready-for-agent`와 `implementation` label을 붙여줘.
- test 중심 issue가 따로 필요하면 `tests` label도 붙여줘.
- issue title과 body는 프로젝트 용어를 따라 `Module`, `Interface`, `Adapter`, `Session Store`, `Claude CLI Adapter`, `Job Queue`, `Reply Publisher` 같은 vocabulary를 사용해줘.
- ADR의 결정사항을 어기지 마. 특히 v1은 Local Node Process, Claude CLI Adapter, in-memory Job Queue, JSON Session Store, no-tools policy가 기본이야.

쪼개는 방식:
- 단순히 layer별/horizontal issue로만 나누지 말고, 가능한 한 tracer bullet / vertical slice 방식으로 나눠줘.
- 각 issue는 완료 후 독립적으로 검증 가능해야 해.
- 그래도 deep Module 단위 테스트가 중요한 부분은 별도 issue로 분리해도 돼.
- 너무 큰 issue는 나누고, 너무 작은 issue는 합쳐줘.

원하는 출력/진행:
1. 먼저 issue breakdown 초안을 보여줘.
2. 각 항목에 아래 정보를 포함해줘:
   - Title
   - Type: HITL 또는 AFK
   - Blocked by
   - User stories covered
   - 왜 이 granularity가 적절한지
3. 아직 GitHub issue를 만들지 말고, 내가 승인할 때까지 기다려줘.
4. 내가 승인하면 dependency order대로 GitHub issues를 생성해줘.
5. 생성되는 issue body는 아래 구조를 사용해줘:
   - Parent
   - What to build
   - Acceptance criteria
   - Blocked by
6. parent issue #1은 수정하거나 닫지 마.

브랜치 전략:
- PRD 단위 branch를 만들지 말고 issue 단위 branch를 전제로 issue를 작성해줘.
- branch 예시는 `issue-2-scaffold-runtime`, `issue-3-config-loader`처럼 issue 번호 기반으로 안내해줘.

추가로 고려할 slice 후보:
- Minimal Node 22 TypeScript ESM runtime scaffold
- Config Loader and startup validation
- Mention-only Discord Ingress path with fake Discord input
- In-memory Job Queue and Worker path
- Claude CLI Adapter contract with fake process runner
- JSON Session Store continuity path
- Reply Publisher long/failure reply behavior
- End-to-end fake adapter mention-to-reply flow
- README run/test docs and local smoke guidance
```




``` tdd prompt example
[$tdd] GitHub issue #<ISSUE_NUMBER>를 구현해줘.

반드시 참고:
- GitHub issue #<ISSUE_NUMBER>
- Parent issue #1
- docs/prd-v1-runtime-implementation.md
- docs/context.md
- docs/architecture.md
- docs/adr/

작업 방식:
- issue scope 밖으로 나가지 마.
- 먼저 관련 문서와 현재 codebase를 읽고, 구현할 public Interface와 테스트할 behavior 목록을 짧게 정리해줘.
- 그 다음 TDD로 진행해줘: 한 번에 하나의 behavior test를 RED로 만들고, 최소 구현으로 GREEN을 만든 뒤 다음 behavior로 넘어가.
- tests는 private implementation detail이 아니라 Module의 public Interface / observable behavior를 검증해야 해.
- Discord, Claude CLI, filesystem 같은 external dependency는 fake 또는 test seam으로 대체해줘.
- 모든 구현 후 refactor하고 test/lint/typecheck를 실행해줘.

ADR 제약:
- v1은 Bot App, not framework.
- Local Node Process, not Docker-first.
- Claude CLI Adapter, not Anthropic API Adapter.
- in-memory Job Queue, not Redis.
- JSON Session Store, not SQLite.
- Discord-triggered Claude execution은 no-tools policy가 기본.
- slash command, DM, Docker, Redis, SQLite, Anthropic API key integration은 구현하지 마.

완료 조건:
- issue acceptance criteria를 모두 만족해야 해.
- issue-sized branch를 전제로 작업해. 예: `issue-<ISSUE_NUMBER>-<short-name>`.
- 마지막에 변경 요약, 실행한 검증 명령, 남은 리스크를 알려줘.
```











``` 작업종료(commit) 및 push/PR 프롬프트
Issue #2 branch `issue-2-scaffold-runtime`의 uncommitted scaffold 작업을 review하고, 검증 통과 후 commit/push/PR 생성해줘. 
```


``` PR머지하고 종료 프롬프트
PR #14를 scope/CI/checks 기준으로 검토하고, 문제가 없으면 squash merge해줘. merge 후 local main으로 전환해서 pull까지 해줘. 단, 예상 밖 파일 변경이나 failed check가 있으면 merge하지 말고 보고해줘.

```


```
추천 순서는 이겁니다.

먼저 issue #2 마무리
지금 branch issue-2-scaffold-runtime에 구현은 되어 있지만 아직 uncommitted 상태입니다. 먼저 git status, 최종 검증, commit, 필요하면 push/PR까지 해서 #2를 닫는 게 맞습니다. issue #3가 “Blocked by #2”라서, #2가 완료된 상태를 만들어야 흐름이 깔끔합니다.

그 다음 issue #3 진행
#3는 Config Loader라서 지금 scaffold 다음에 아주 자연스러운 vertical slice입니다. Tdd로 가는 게 맞고, 테스트 surface는 ConfigLoader.load() public Interface가 좋습니다. .env/YAML/filesystem은 fake 또는 temp file seam으로 두고, real Discord/Claude는 건드리지 않으면 됩니다.

handoff 스킬은 “세션 넘길 때”만
지금 바로 내가 이어서 #3를 할 거면 handoff는 굳이 필요 없습니다. 다만 다른 agent나 새 세션에서 이어갈 거면 /tmp에 handoff 문서를 남기는 게 좋습니다. 특히 #2 변경 요약, 검증 명령, #3 시작점이 담기면 다음 agent가 덜 헤맵니다.

improve-codebase-architecture는 아직 이릅니다
지금 코드는 의도적으로 scaffold라서 대부분 Interface placeholder입니다. 이 시점에 architecture review를 돌리면 “shallow Module”이 많이 보일 텐데, 그건 버그가 아니라 issue #2의 목적입니다. 최소한 Config Loader, Mention Parser, Session Store 중 하나 이상 실제 Implementation이 생긴 뒤에 쓰는 게 더 생산적입니다.

제 선택은: #2 commit/PR → issue #3를 Tdd로 진행입니다.
handoff는 세션을 끊을 때만 만들고, architecture review는 #3 이후나 #4/#5 정도에서 한 번 돌리는 게 좋아 보여요.
```