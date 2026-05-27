# Meeting Skill

다중 관점 설계 회의를 자동 진행한다. Orchestrator + 역할별 subagent가 brief → round1(병렬) → round2(충돌 시 부분 참여) → summary 흐름으로 결정을 도출하고 산출물을 파일로 남긴다.

## 호출

```
/meeting <issue#|topic> <perspective>
```

또는 자연어:
```
/meeting 8 개발 관점에서 회의 진행해줘
/meeting 이슈 10 PRD 관점, 추가 범위 결정
/meeting "mention-parser 리팩터링 방향" 아키텍처 관점
/meeting 15 보안 관점, rounds=3
```

## 산출물

`docs/meetings/<slug>/` 하위:
- `brief.md` — Orchestrator가 작성한 이슈/주제 요약 + 설계 질문 + 선정 역할
- `round1/{role}.md` — 각 역할의 초기 입장/근거/미결사항
- `round2/{role}.md` — 충돌 당사자만 참여 (lead 결정 + 나머지 follow-up). 충돌 0건이면 미생성.
- `summary.md` — Moderator가 작성한 최종 결정 + 구현 방향 + 액션 아이템

## 역할 라이브러리

- **Dev** — 구현, 코드 스케치, 파일별 변경
- **Architect** — Module/Interface/Seam, 패턴 일관성
- **QA** — 테스트 케이스, 엣지케이스, 계약 보호
- **UX/Product** — 사용자 흐름, 사용성, 메시지 톤
- **Security** — auth, 데이터 노출, abuse 면
- **SRE/Ops** — 장애 대응, 관측성, 배포/롤백
- **PM/Product** — 우선순위, 범위, 트레이드오프 결정
- **DevEx/Docs** — 개발자 경험, 문서화, onboarding
- **Moderator** — 최종 summary 작성 (Orchestrator가 자동 호출)

추가 후보 (필요 시 roles/에 같은 템플릿으로 추가): `docs/meetings/PLAN.md` 하단 표 참조.

## Perspective → 역할 매핑

[prompt-templates.md](prompt-templates.md) 참조.

## 공유 메모리 규약

- 각 subagent는 자기 역할 파일만 Write. 남의 파일 / 다른 round 파일 수정 금지.
- 이전 round 참조는 경로 주입 + Read tool로 직접 읽음 (prompt 비대 회피).
- 충돌 표시는 `미결 사항 (@otherrole)` 섹션 + `@role` 마커.

자세히: [shared-memory.md](shared-memory.md).

## 검증

POC 재현 smoke 테스트:
```
/meeting "blocked-user-ids 기능 추가" 개발 관점
```
→ `docs/meetings/topic-blocked-user-ids-*/` 생성 후 기존 `blocked-user-ids/` 산출물과 정성 비교.
