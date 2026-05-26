# Development Workflow

이 문서는 `discord-claude-bridge`의 PRD 작성부터 issue 구현, PR merge, 다음 issue 반복, PRD 종료까지의 개발 흐름을 정리한다. 복사해서 쓰는 agent prompt는 `docs/agent-prompt-examples.md`에 따로 둔다.

## Workflow Overview

기본 흐름은 다음 순서를 따른다.

1. PRD 생성
2. PRD parent issue 생성
3. implementation issues 생성
4. issue별 branch 생성
5. TDD로 구현
6. uncommitted 작업 review, 검증, 보완
7. commit, push, PR 생성
8. PR review, CI 확인, merge
9. local `main`으로 복귀 후 pull
10. 다음 issue 반복
11. 필요한 시점에 architecture review
12. 구현 완료 후 runtime validation issues로 실제 동작 검증
13. 모든 acceptance와 validation이 끝나면 PRD 종료

PRD는 제품과 아키텍처 방향의 source of truth이고, GitHub Issue는 agent나 사람이 실제로 집어갈 work queue다. 큰 PRD 하나를 그대로 구현하지 않고, 독립적으로 완료 가능한 작은 implementation issue로 쪼갠다.

## Source Documents

작업자는 단계별로 필요한 문서를 먼저 읽는다.

- Product goal: `PROJECT_GOAL.MD`
- User-facing overview: `README.md`
- Agent guidance: `AGENTS.MD`, `CLAUDE.MD`, `CLAUDE_DIFF.MD`
- Runtime examples: `.env.example`, `config.example.yaml`
- Domain vocabulary: `docs/context.md`
- Module map: `docs/architecture.md`
- Accepted decisions: `docs/adr/`
- Current v1 PRD: `docs/prd-v1-runtime-implementation.md`
- Development workflow: `docs/development-workflow.md`
- Agent prompt examples: `docs/agent-prompt-examples.md`

## Stage 1: Create PRD

PRD는 repo에 versioned document로 둔다. 현재 v1 runtime 구현 PRD는 `docs/prd-v1-runtime-implementation.md`를 기준으로 한다.

PRD에는 다음 내용을 포함한다.

- Problem Statement
- Solution
- User Stories
- Implementation Decisions
- Testing Decisions
- Out of Scope
- Further Notes

PRD 작성 시 프로젝트 vocabulary를 유지한다. 이 repo에서는 `Module`, `Interface`, `Implementation`, `Seam`, `Adapter`, `Depth`, `Leverage`, `Locality` 용어를 우선한다. `service`, `component`, `boundary` 같은 일반어는 필요할 때만 쓴다.

PRD 변경은 repo commit으로 남긴다. PRD 문서가 바뀌면 관련 GitHub Issue에도 변경 내용을 comment로 남긴다. Issue body를 매번 길게 갱신하기보다, repo 문서를 source of truth로 유지하고 Issue에서는 링크와 상태를 관리한다.

## Stage 2: Create PRD Parent Issue

GitHub에는 PRD 전체를 추적하는 parent issue를 하나 만든다. Parent issue는 전체 목표와 진행 상태를 추적하지만, 직접 구현 대상으로 잡지 않는다.

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

## Stage 3: Create Implementation Issues

PRD tracking issue는 너무 크기 때문에 작은 implementation issue로 나눈다.

예시 issue sequence:

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

- PRD parent issue link
- 관련 Module 이름
- 구현 범위
- acceptance criteria
- test expectations
- blocked-by 관계
- out-of-scope 항목

권장 template:

```md
## Parent

Parent issue: #<PRD_TRACKING_ISSUE_NUMBER>

## What to build

- Build or modify <Module name>
- Keep behavior aligned with the PRD and ADRs

## Acceptance criteria

- <Observable behavior>
- <Observable behavior>
- <Failure mode or edge case>

## Testing

- Add tests through the Module Interface
- Fake external Discord, Claude CLI, and filesystem dependencies where appropriate

## Blocked by

- #<ISSUE_NUMBER> or none

## Out of scope

- <Explicit non-goal>
```

좋은 issue는 완료 후 독립적으로 검증 가능해야 한다. 단순 layer별 작업보다 tracer bullet 또는 vertical slice가 낫다. 다만 Config Loader, Session Store, Claude CLI Adapter처럼 deep Module 자체가 중요한 경우에는 Module 단위 issue가 적절하다.

## Stage 4: Start Issue Branch

PRD 단위 branch보다 issue 단위 branch를 기본으로 사용한다. 각 implementation issue는 최신 `main`에서 새 branch를 만든다.

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

구현 작업은 PRD branch에서 이어가지 않는다. PR은 해당 issue를 close하도록 연결한다.

## Stage 5: Work With TDD

Issue 구현은 가능하면 TDD로 진행한다.

기본 루프:

1. Issue, PRD, `docs/context.md`, `docs/architecture.md`, `docs/adr/`를 읽는다.
2. 구현할 public Interface와 observable behavior를 짧게 정리한다.
3. 한 번에 하나의 behavior test를 RED로 만든다.
4. 최소 구현으로 GREEN을 만든다.
5. 중복과 이름을 정리한다.
6. 다음 behavior로 넘어간다.
7. 마지막에 전체 검증을 돌린다.

테스트는 private implementation detail이 아니라 Module의 public Interface와 observable behavior를 검증한다. Discord, Claude CLI, filesystem 같은 external dependency는 fake Adapter나 test seam으로 대체한다.

Issue scope 밖으로 나가지 않는다. 구현 중 scope가 커지면 기존 issue를 키우지 말고 새 issue로 분리한다.

## Stage 6: Review Uncommitted Work

구현이 끝나면 commit하기 전에 uncommitted 작업을 review하고 검증하며 필요한 보완을 끝낸다. 이 단계의 목표는 “PR로 올려도 되는 변경인지”를 판단하는 것이다. commit, push, PR 생성은 다음 단계에서 한다.

먼저 작업 범위를 확인한다.

```bash
git status --short --branch
git diff --stat
git diff
```

검토 기준:

- 변경이 issue acceptance criteria를 모두 만족하는지 확인한다.
- issue scope 밖 변경이 섞였는지 확인한다.
- secrets, local-only file, generated noise가 포함됐는지 확인한다.
- public Interface와 tests가 PRD, ADR, `docs/context.md`, `docs/architecture.md` vocabulary와 맞는지 확인한다.
- tests가 private implementation detail보다 observable behavior를 검증하는지 확인한다.
- error message와 validation failure가 operator에게 충분히 명확한지 확인한다.

기본 검증:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
git diff --check
```

검증 중 실패가 나오면 이 단계에서 보완한다. 보완 후 같은 검증을 다시 실행한다. 불확실한 scope 확장이나 예상 밖 unrelated change가 있으면 commit하지 말고 먼저 분리하거나 보고한다.

Stage 6 완료 조건:

- issue acceptance criteria가 충족됐다.
- tests, typecheck, lint, format, build가 통과했다.
- `git diff --check`가 통과했다.
- PR에 포함할 파일과 제외할 파일이 명확하다.
- 남은 리스크가 PR body에 쓸 수 있을 정도로 정리됐다.

## Stage 7: Commit, Push, Open PR

Stage 6이 통과하면 issue 관련 파일만 stage한다. unrelated local change는 섞지 않는다.

```bash
git status --short
git add <issue-related-files>
git diff --cached --check
git commit -m "feat: <short issue summary>"
git push -u origin <branch-name>
```

PR body에는 다음 내용을 담는다.

- Summary
- Validation
- Linked issue with `Closes #<ISSUE_NUMBER>`
- Remaining risk, if any

## Stage 8: Review, Merge, Return To Main

PR은 scope, diff, tests, CI/checks 기준으로 review한다. 예상 밖 파일 변경, failed check, stale base, unrelated changes가 있으면 merge하지 않고 먼저 정리한다.

문제가 없으면 repository policy에 맞춰 merge한다. 이 repo에서는 작은 issue PR을 squash merge해도 좋다.

Merge 후 local workspace는 다음 issue를 위해 `main`으로 복귀한다.

```bash
git switch main
git pull --ff-only origin main
git status --short --branch
```

로컬에 남은 branch는 필요 없으면 정리할 수 있지만, 사용자 변경이 섞였는지 먼저 확인한다.

## Stage 9: Continue Issues

Parent PRD issue의 checklist나 comment를 갱신하고 다음 unblocked issue를 선택한다.

다음 issue를 시작하기 전에 확인할 것:

- Parent PRD issue가 아직 open인지
- 현재 issue의 blocked-by가 해소됐는지
- `main`이 최신인지
- 기존 PR에서 follow-up이 새 issue로 분리됐는지
- ADR과 PRD가 현재 구현 방향을 여전히 설명하는지

이 과정을 issue가 끝날 때까지 반복한다.

## Stage 10: Architecture Review

`improve-codebase-architecture` 스킬은 codebase에 실제 Implementation이 쌓인 뒤 사용한다. 너무 이른 scaffold 단계에서는 대부분 Interface placeholder라서 얕은 Module처럼 보일 수 있다.

사용하기 좋은 시점:

- Config Loader, Mention Parser, Session Store, Claude CLI Adapter 같은 deep Module이 하나 이상 구현된 뒤
- 여러 issue가 merge되어 Module 사이의 friction이 보이기 시작할 때
- 테스트가 어려운 구간, shallow Module, tightly-coupled Module을 의심할 때
- PRD 구현 중 “이건 구조를 다시 봐야 한다”는 냄새가 반복될 때

스킬 실행 전 읽어야 할 문서:

- `docs/context.md`
- `docs/architecture.md`
- `docs/adr/`
- 관련 PRD와 최근 merged PR

스킬의 기대 산출물:

- repo 밖 temp directory에 생성되는 architecture review HTML report
- deepening opportunity 후보
- 각 후보의 Files, Problem, Solution, Benefits, Before/After diagram, Recommendation strength
- Top recommendation

이 스킬은 즉시 코드를 고치는 단계가 아니라 후보를 찾고 선택하는 단계다. 사용자가 후보를 고르면 grilling loop로 들어가 Module 이름, Interface, Adapter, test surface, ADR 충돌 여부를 정리한다.

Architecture review 결과 처리:

- 선택한 후보가 PRD scope 안이면 새 implementation issue로 만든다.
- PRD scope 밖이면 follow-up 또는 future issue로 분리한다.
- 새 domain term이 생기면 `docs/context.md`에 추가한다.
- 기존 ADR과 충돌하면 ADR을 추가하거나 수정한 뒤 구현한다.

## Stage 11: Validate Runtime With Smoke Issues

> 이 3-tier 구조의 설계 근거는 [ADR-0004](adr/0004-smoke-test-strategy.md)를 참조한다.

PRD implementation issues가 모두 끝난 뒤에는 새 PRD를 만들기보다 validation issue 묶음으로 실제 동작을 확인한다. 이 단계는 제품 방향을 다시 정의하는 단계가 아니라, 구현된 runtime이 실제 환경에서 기대한 경로로 도는지 검증하는 단계다.

v1 runtime validation은 다음 순서로 진행한다.

1. Discord echo smoke test
2. Claude CLI Adapter standalone test
3. Discord to Claude integrated smoke test

각 validation item은 독립 issue로 만들고, 각 issue마다 최신 `main`에서 branch를 만든다. 이 repo에서는 issue 생성 자체는 사용자가 명시적으로 요청할 때만 진행한다.

추천 labels:

```txt
ready-for-agent
tests
implementation
```

추천 branch naming:

```txt
issue-<number>-discord-echo-smoke
issue-<number>-claude-cli-smoke
issue-<number>-integrated-smoke
```

### Discord Echo Smoke Test

목표는 Claude CLI를 완전히 제외하고 Discord 연결만 검증하는 것이다.

Acceptance 예시:

- `npm run dev`로 runtime이 시작된다.
- 실제 Discord에서 bot mention을 보내면 같은 채널에 `[에코] <원문>` 형태로 응답한다.
- bot 자신의 메시지에는 반응하지 않는다.
- mention parsing, channel routing, reply publishing이 구조화 로그에 남는다.
- Claude CLI는 호출되지 않는다.

이 검증은 runtime mode로 분리하는 것이 좋다.

```env
RESPONSE_MODE=echo
```

`RESPONSE_MODE=echo`는 Discord ingress와 reply publisher를 실제로 사용하고, Claude CLI Adapter만 우회한다. 나중에 `mock`, `dry-run` 같은 mode가 필요해져도 같은 축으로 확장할 수 있다.

### Claude CLI Adapter Standalone Test

목표는 Discord와 무관하게 Claude CLI 호출부만 검증하는 것이다.

Acceptance 예시:

- 고정 prompt를 Claude CLI Adapter에 전달할 수 있다.
- stdout, stderr, exit code가 예상대로 수집된다.
- timeout과 실패 exit가 operator에게 이해 가능한 error로 정리된다.
- Discord token, channel, mention event가 없어도 실행 가능하다.

이 검증은 별도 script나 test entrypoint로 둘 수 있다.

```bash
npm run smoke:claude
```

### Integrated Smoke Test

앞의 두 validation issue가 통과한 뒤 Discord mention에서 Claude CLI 응답까지 전체 경로를 검증한다.

Acceptance 예시:

- 실제 Discord mention이 job으로 들어간다.
- Claude CLI Adapter가 prompt를 받고 응답을 반환한다.
- Discord reply가 원래 channel 또는 thread 정책에 맞게 발행된다.
- 실패 시 사용자에게 적절한 failure reply가 가고, 구조화 로그로 lifecycle을 추적할 수 있다.
- 중복 응답이나 self-reply loop가 없다.

통합 검증은 다음 mode를 사용한다.

```env
RESPONSE_MODE=claude
```

### Bug Handling During Validation

Validation 중 발견한 문제는 scope에 따라 처리한다.

현재 validation issue의 acceptance를 막는 직접 버그는 같은 issue branch에서 고친다. 예를 들어 `issue-20-discord-echo-smoke`에서 bot mention을 받지 못한다면, Discord ingress 설정이나 mention parser wiring 문제는 그 branch에서 수정하고 같은 PR에 포함한다. 이 경우 PR은 validation과 그 validation을 통과하기 위한 최소 runtime fix를 함께 담는다.

현재 issue scope 밖의 문제는 별도 bug issue로 분리한다. 예를 들어 Discord echo 검증 중 Claude CLI timeout 정책 문제가 눈에 띄었지만 echo mode에서는 Claude CLI를 호출하지 않는다면, 현재 branch에서 고치지 않고 bug issue를 만든다. 해당 bug는 나중에 최신 `main`에서 별도 branch를 만들어 처리한다.

추천 bug branch naming:

```txt
bug-<number>-claude-timeout-handling
bug-<number>-discord-self-reply-loop
```

기준은 다음과 같다.

- Same branch: 현재 issue acceptance를 만족하려면 반드시 고쳐야 하는 문제
- Separate bug issue: 현재 issue를 통과하는 데 필요 없거나, 다른 Module/Interface의 behavior를 바꾸는 문제
- Separate bug issue: 원인 분석이 길어져 현재 validation PR을 크게 만들 위험이 있는 문제
- Separate bug issue: 이미 merge된 기능의 regression이고 독립적으로 재현 가능한 문제

별도 bug issue를 만들 때는 재현 절차, 기대 동작, 실제 동작, 관련 로그, 발견한 validation issue를 적는다. PR은 `Closes #<BUG_ISSUE_NUMBER>`로 bug issue를 닫고, 필요하면 원래 validation issue에는 follow-up link만 남긴다.

Validation issue PR을 merge한 뒤에는 local `main`으로 돌아와 pull한 다음 다음 validation issue를 시작한다.

## Stage 12: Close PRD

모든 implementation issue와 runtime validation issue가 완료되면 PRD parent issue를 닫기 전에 최종 확인을 한다.

PRD 종료 checklist:

- PRD acceptance가 구현과 테스트로 충족됐다.
- Runtime validation issues가 통과했다.
- README run/test documentation이 최신이다.
- `docs/context.md`, `docs/architecture.md`, `docs/adr/`가 최종 구조와 충돌하지 않는다.
- open follow-up issue가 PRD 종료를 막는 항목인지 future work인지 분류됐다.
- known limitations가 README나 PRD notes에 남았다.
- local `main`이 origin과 동기화됐다.

PRD parent issue에는 완료 comment를 남긴다.

```md
Completed.

Implemented through:
- #<issue>
- #<issue>
- #<issue>

Final docs:
- `docs/prd-v1-runtime-implementation.md`
- `README.md`
- `docs/architecture.md`
- `docs/context.md`
- `docs/adr/`

Known follow-ups:
- #<issue> or none
```

## Label Policy

Use labels as lightweight routing hints.

- `ready-for-agent`: issue is clear enough for an agent to start.
- `prd`: issue tracks a product requirements document.
- `implementation`: issue changes runtime code or app behavior.
- `tests`: issue primarily adds or changes test coverage.
- `docs`: issue primarily updates documentation.
- `architecture`: issue changes Module shape, Interface, Adapter placement, or ADR-backed structure.

Avoid marking an issue `ready-for-agent` until the scope, acceptance criteria, dependencies, and out-of-scope items are clear.

## Maintenance Rules

- PRD 변경은 repo commit으로 남긴다.
- PRD parent issue에는 중요한 PRD 변경을 comment로 남긴다.
- Implementation issue가 완료되면 parent issue checklist나 comment에 반영한다.
- 구현 중 scope가 커지면 기존 issue를 키우지 말고 새 issue로 분리한다.
- ADR과 충돌하는 구현 결정이 생기면 먼저 ADR을 추가하거나 수정한다.
- `docs/context.md`의 domain vocabulary와 `docs/architecture.md`의 Module map을 issue 설명에서도 유지한다.
- Prompt examples는 `docs/agent-prompt-examples.md`에만 둔다.
