# Agent Prompt Examples

이 문서는 `discord-claude-bridge` 개발 workflow에서 반복해서 쓰는 agent prompt 예제를 모은다. 장기 workflow는 `docs/development-workflow.md`를 기준으로 한다.

## Create PRD

```txt
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
- docs/development-workflow.md

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
- GitHub issue tracker가 사용 가능하면 PRD parent issue로 등록해줘.
- issue tracker를 사용할 수 없으면 repo 문서로만 남기고, 나중에 issue로 등록할 수 있게 만들어줘.
```

## Create Implementation Issues

```txt
[$to-issues] GitHub issue #<PRD_PARENT_ISSUE_NUMBER>의 PRD를 기준으로 v1 runtime 구현을 independently-grabbable GitHub issues로 나눠줘.

반드시 참고할 문서:
- GitHub issue #<PRD_PARENT_ISSUE_NUMBER>: PRD parent issue
- docs/prd-v1-runtime-implementation.md
- docs/development-workflow.md
- docs/context.md
- docs/architecture.md
- docs/adr/

목표:
- PRD 전체를 바로 구현하는 큰 issue로 만들지 말고, agent가 하나씩 잡아 완료할 수 있는 작은 implementation issues로 쪼개줘.
- 각 issue는 parent issue #<PRD_PARENT_ISSUE_NUMBER>를 링크해야 해.
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
   - Testing
   - Blocked by
   - Out of scope
6. parent issue #<PRD_PARENT_ISSUE_NUMBER>는 수정하거나 닫지 마.

브랜치 전략:
- PRD 단위 branch를 만들지 말고 issue 단위 branch를 전제로 issue를 작성해줘.
- branch 예시는 `issue-<ISSUE_NUMBER>-<short-name>` 형식으로 안내해줘.

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

## Implement Issue With TDD

```txt
[$tdd] GitHub issue #<ISSUE_NUMBER>를 구현해줘.

반드시 참고:
- GitHub issue #<ISSUE_NUMBER>
- Parent issue #<PRD_PARENT_ISSUE_NUMBER>
- docs/prd-v1-runtime-implementation.md
- docs/development-workflow.md
- docs/context.md
- docs/architecture.md
- docs/adr/

작업 방식:
- issue scope 밖으로 나가지 마.
- 먼저 관련 문서와 현재 codebase를 읽고, 구현할 public Interface와 테스트할 behavior 목록을 짧게 정리해줘.
- 그 다음 TDD로 진행해줘: 한 번에 하나의 behavior test를 RED로 만들고, 최소 구현으로 GREEN을 만든 뒤 다음 behavior로 넘어가.
- tests는 private implementation detail이 아니라 Module의 public Interface / observable behavior를 검증해야 해.
- Discord, Claude CLI, filesystem 같은 external dependency는 fake 또는 test seam으로 대체해줘.
- 모든 구현 후 refactor하고 test/lint/typecheck/build를 실행해줘.

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

## Review Uncommitted Work

```txt
Issue #<ISSUE_NUMBER> branch `issue-<ISSUE_NUMBER>-<short-name>`의 uncommitted 작업을 review하고 검증해줘. 검증 중 문제가 있으면 issue scope 안에서 보완하고 다시 검증해줘. 아직 commit/push/PR은 하지 마.

반드시 확인:
- GitHub issue #<ISSUE_NUMBER>
- parent PRD issue
- docs/development-workflow.md
- 관련 PRD/ADR/context 문서

작업 방식:
- 먼저 git status와 diff를 확인해줘.
- issue acceptance criteria를 기준으로 변경을 review해줘.
- issue scope 밖의 변경, secret, generated noise, local-only file이 있으면 구분해줘.
- tests가 public Interface와 observable behavior를 검증하는지 확인해줘.
- tests/typecheck/lint/format/build와 `git diff --check`를 실행해줘.
- 실패가 있으면 issue scope 안에서 보완하고 같은 검증을 다시 실행해줘.
- 마지막에 변경 요약, 검증 결과, PR에 포함할 파일, 제외할 파일, 남은 리스크를 알려줘.
```

## Commit, Push, And Open PR

```txt
Issue #<ISSUE_NUMBER> branch `issue-<ISSUE_NUMBER>-<short-name>`에서 review와 검증이 통과한 변경만 commit/push/PR 생성해줘.

반드시 확인:
- GitHub issue #<ISSUE_NUMBER>
- docs/development-workflow.md의 Stage 7
- 직전 review/검증 결과

작업 방식:
- git status를 확인하고 issue 관련 파일만 stage해줘.
- unrelated local change는 stage하지 마.
- staged diff와 `git diff --cached --check`를 확인해줘.
- commit message는 issue 내용을 짧게 요약해줘.
- push 후 PR을 생성해줘.
- PR body에는 Summary, Validation, Closes #<ISSUE_NUMBER>, Remaining risk를 포함해줘.
```

## Review And Merge PR

```txt
PR #<PR_NUMBER>를 scope/CI/checks 기준으로 검토하고, 문제가 없으면 squash merge해줘.

merge 전 확인:
- PR이 의도한 issue만 닫는지 확인
- 예상 밖 파일 변경이 없는지 확인
- CI/checks가 통과했는지 확인
- failed check나 merge conflict가 있으면 merge하지 말고 보고

merge 후:
- local main으로 전환
- `git pull --ff-only origin main`
- local status 확인
- 다음 unblocked issue 후보를 알려줘
```

## Architecture Review

```txt
[$improve-codebase-architecture] 현재 codebase에서 deepening opportunity를 찾아줘.

반드시 참고:
- docs/development-workflow.md
- docs/context.md
- docs/architecture.md
- docs/adr/
- docs/prd-v1-runtime-implementation.md
- 최근 merge된 PR과 구현된 Module

목표:
- shallow Module, tightly-coupled Module, test하기 어려운 seam, domain vocabulary와 어긋난 naming을 찾아줘.
- Module, Interface, Implementation, Seam, Adapter, Depth, Leverage, Locality vocabulary를 사용해줘.
- ADR과 충돌하는 후보는 명확히 표시해줘.

출력:
- repo를 수정하지 말고 temp directory에 HTML architecture review report를 만들어줘.
- 각 후보에 Files, Problem, Solution, Benefits, Before/After diagram, Recommendation strength를 포함해줘.
- 마지막에 Top recommendation을 제안해줘.
- report 생성 후 어떤 후보를 더 탐색할지 물어봐줘.
```

## Close PRD

```txt
PRD parent issue #<PRD_PARENT_ISSUE_NUMBER>를 종료할 준비가 됐는지 검토해줘.

반드시 확인:
- docs/prd-v1-runtime-implementation.md acceptance
- 완료된 implementation issues와 merged PR
- README run/test docs
- docs/context.md
- docs/architecture.md
- docs/adr/
- open follow-up issues

작업 방식:
- PRD acceptance별 충족 여부를 표로 정리해줘.
- 남은 open issue가 PRD 종료 blocker인지 future work인지 분류해줘.
- blocker가 없으면 parent issue에 완료 comment를 남기고 close해줘.
- blocker가 있으면 close하지 말고 필요한 next issue를 제안해줘.
```

## Handoff

```txt
[$handoff] 현재 작업 상태를 다음 agent가 이어받을 수 있게 handoff 문서로 정리해줘.

포함할 것:
- 현재 branch와 git status
- 진행 중인 issue와 parent PRD issue
- 방금 읽은 문서와 중요한 결정
- 변경한 파일과 아직 변경하지 않은 파일
- 실행한 검증 명령과 결과
- 다음 agent가 바로 실행할 수 있는 next steps
- 주의해야 할 unrelated local changes
```
