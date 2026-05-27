---
description: 다중 관점 회의 진행 (Orchestrator + 역할별 subagent)
argument-hint: "<issue#|topic> <perspective> [rounds=N] [lead=<role>] [exclude=<roles>]"
---

`meeting` Skill을 invoke한다.

인자: $ARGUMENTS

Skill이 다음을 수행한다:
1. 인자 해석 (issue# 또는 topic, perspective, rounds 옵션)
2. `gh issue view` 또는 topic 직접 사용으로 컨텍스트 수집
3. perspective → 역할 선정 (hint table + LLM judge)
4. brief.md 작성 후 Round 진행 (R1 병렬 → 충돌 시 R2 부분 참여 → Moderator summary)
5. 산출물을 `docs/meetings/<slug>/` 하위에 저장

자세한 규약: `.claude/skills/meeting/SKILL.md`
