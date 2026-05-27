---
name: meeting
description: Run multi-perspective design meeting with Orchestrator + role-specialized subagents. Triggers on /meeting, "회의 진행", "다중 관점 회의", "여러 관점에서 검토". Produces brief.md, round{N}/{role}.md per subagent, and summary.md under docs/meetings/<slug>/.
---

# Meeting Skill — Orchestrator 진입점

이 Skill은 사용자의 단일 prompt(보통 `/meeting <대상> <perspective>`)를 받아 **다중 역할 회의**를 진행하고 산출물을 파일로 남긴다.

호출자(메인 세션)는 이 SKILL.md를 읽고 즉시 **Orchestrator 역할**을 수행한다. Orchestrator 책임 전체는 [roles/orchestrator.md](roles/orchestrator.md) 참조.

---

## Stage 0 — 입력 해석

사용자 prompt에서 추출:

1. **대상**: 첫 토큰이 숫자(또는 `#숫자`, `이슈 N`, `issue N`)면 GitHub issue 번호. 아니면 자유 topic 문자열.
2. **Perspective**: "개발", "PRD", "아키텍처", "보안", "운영", "UX", "DevEx" 등 키워드. 한국어/영어 모두 인식.
3. **옵션** (있으면):
   - `rounds=N` — 최대 round 수 (default 2)
   - `lead=<role>` — R2 lead 강제 지정
   - `exclude=<role1,role2>` — 자동 선정에서 제외할 역할

추출 실패 시 → `AskUserQuestion`으로 1회 확인.

## Stage 1 — 컨텍스트 수집

- **이슈인 경우**: `gh issue view <N> --json title,body,labels,comments,author,url` 실행. 결과를 파싱하여 brief 본문 자료로 사용.
- **Topic인 경우**: 사용자 prompt 본문을 그대로 사용. 관련 파일 경로는 사용자가 명시하지 않았으면 grep으로 추정.

## Stage 2 — 역할 선정

[prompt-templates.md](prompt-templates.md)의 **Perspective → 역할 매핑 hint table** 조회. 매핑이 모호하면 `AskUserQuestion`으로 사용자에게 1회 확인 (default 추천 + "Other"). 매핑이 명확하면 진행하고 brief에 선정 사유 1줄 기록.

## Stage 3 — Slug 결정 + Brief 작성

- **Slug**:
  - 이슈: `issue-<N>-<kebab-title>` (title 첫 4~6단어, kebab-case, ASCII 강제)
  - Topic: `topic-<kebab-slug>` (prompt 핵심 키워드)
  - 중복 시 `-2`, `-3` 접미
- **Brief 작성**: `docs/meetings/<slug>/brief.md` 생성. 다음 섹션 포함:
  - `## 이슈/주제` — 원본 또는 요약
  - `## 설계 질문` — 회의에서 결정할 항목 3~7개
  - `## 선정 역할` — 역할 목록 + 선정 사유 1줄
  - `## 관련 파일` — 경로 (있으면)
  - `## 옵션` — rounds, lead 강제, exclude 적용 여부

Brief 작성 후 **사용자에게 1줄 요약 보고** 후 자동 진행 (사용자가 중단 의사 표명하면 정지).

## Stage 4 — Round 1 (병렬)

선정된 각 역할에 대해 **단일 메시지 다중 Task 호출**로 병렬 실행.

각 Task prompt 조립:
```
You are the {Role} in a multi-role design meeting. Follow these rules strictly.

=== Role definition ===
[roles/{role}.md 본문 전체 inline]

=== Shared memory protocol ===
[shared-memory.md 본문 inline]

=== Brief ===
Read: docs/meetings/<slug>/brief.md

=== Task ===
Write your Round 1 contribution to: docs/meetings/<slug>/round1/{role}.md
- Use Write tool (overwrite OK if rerun)
- Follow the Round 1 output format in your role definition
- Cross-reference other roles with @architect / @dev / @qa / ... markers in 미결 사항 section

Return a 1-sentence completion confirmation.
```

호출 후 orchestrator는 `round1/` 디렉터리에 모든 역할 파일이 생성되었는지 검증.

## Stage 5 — 충돌 분석

Orchestrator가 모든 `round1/*.md`를 Read. 다음을 식별:

- **충돌**: `미결 사항 (@X)` 섹션의 cross-reference 추출. 같은 결정 항목에 대해 둘 이상의 역할이 다른 입장을 명시한 경우.
- **수렴**: 같은 항목에 모든 역할이 동의한 경우.

`rounds=1`이거나 **충돌 0건**이면 Stage 6 skip → Stage 7로.

충돌이 있으면 R2 lead 선정:

| 충돌 유형 | Lead 역할 |
|---|---|
| 구조/계약/모듈 경계 | Architect |
| 우선순위/범위/일정 | PM/Product |
| 테스트 전략/품질 게이트 | QA |
| 사용자 흐름/UX | UX/Product |
| 보안/abuse | Security |
| 운영/배포/SLO | SRE/Ops |
| DX/문서/API 사용성 | DevEx/Docs |
| 구현 디테일 | Dev |

`lead=<role>` 옵션이 있으면 그것 우선.

## Stage 6 — Round 2 (충돌 당사자만)

R2 참여자 = {lead 역할} ∪ {R1에서 lead와 충돌난 역할들}. R1 비충돌 역할은 R2 미참여.

흐름 (두 페이즈):

**6-A. Lead 결정 (sequential, single Task)**
```
[role/{lead}.md inline]
[shared-memory.md inline]

=== Inputs ===
- brief: docs/meetings/<slug>/brief.md
- round1 전체: docs/meetings/<slug>/round1/*.md (각 역할별 파일)
- 충돌 요약: [orchestrator가 식별한 충돌 항목 bullet list]

=== Task ===
Write round2/{lead}.md as the decision lead. Use R2 lead output format from your role definition.
- 결정 / 근거 / 구현 지시 섹션 강제
```

**6-B. Non-lead follow-up (병렬, 충돌 당사자 N개 Task)**
```
[role/{role}.md inline]
[shared-memory.md inline]

=== Inputs ===
- brief, round1 전체, round2/{lead}.md

=== Task ===
Write round2/{your-role}.md as non-lead. Use R2 non-lead output format.
- 동의/이견 / 후속 조정 필요 섹션
```

## Stage 7 — Summary (Moderator)

Moderator subagent 단일 Task 호출.

```
[roles/moderator.md inline]
[shared-memory.md inline]

=== Inputs ===
- brief.md
- round1/*.md (모든 역할)
- round2/*.md (있는 경우)

=== Task ===
Write docs/meetings/<slug>/summary.md.
Sections (POC pattern):
- 결정 사항
- 합의된 구현 방향
- 테스트 커버리지 계획 (테스트 관련 회의일 때)
- 위험 엣지케이스
- 미합의 / 추가 논의 필요
- 액션 아이템 (체크박스)

If 결정 사항 < 3 or 미합의 잔존 → 출력 상단에 ⚠️ 경고 박스 추가.
```

## Stage 8 — 사용자 보고

Orchestrator가 메인 세션으로 다음을 출력:

```
회의 종료. 산출물:
- brief:   docs/meetings/<slug>/brief.md
- round1:  <역할 개수>개 파일
- round2:  <역할 개수>개 파일 또는 "skip (충돌 없음)"
- summary: docs/meetings/<slug>/summary.md

결정 요약: <summary.md의 결정 사항 헤더 N개 1줄 bullet>
미합의: <건수 또는 "없음">
```

---

## 보조 문서

- [README.md](README.md) — 사용법 + 예시
- [prompt-templates.md](prompt-templates.md) — perspective 매핑, 호출 prompt 추천
- [shared-memory.md](shared-memory.md) — 파일 규약 (subagent에 inline 주입)
- [roles/](roles/) — 역할별 정의 (subagent prompt에 inline 주입)

## 호출자 주의

- **Subagent는 자기 역할 파일만 Write**. 남의 파일/다른 round 파일 절대 수정 금지.
- **Subagent는 추가 Task 호출 불가** (Claude Code 제약). Orchestrator만 Task 사용.
- **병렬 호출 필수**: R1 전체, R2 6-B는 단일 메시지에 다중 Task로 발사.
