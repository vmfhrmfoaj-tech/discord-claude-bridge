# 호출 Prompt 추천 + Perspective 매핑

## 기본형

```
/meeting <issue번호 또는 topic> <perspective 키워드> 회의 진행해줘
```

## 옵션 확장

```
/meeting <대상> <perspective> [rounds=N] [lead=<role>] [exclude=<role1,role2>]
```

- `rounds=1` — R1만 진행 (충돌 분석 skip, Moderator가 R1만 합성)
- `rounds=2` — default. R2는 충돌 있을 때만 실행.
- `rounds=3+` — R2 이후에도 잔존 충돌이 있으면 R3 진행 (Orchestrator가 같은 알고리즘 반복).
- `lead=architect` — R2 lead 강제 지정. 자동 추론 무시.
- `exclude=ux-product,devex-docs` — 자동 선정 시 제외.

## Perspective → 역할 매핑 (Hint table)

| Perspective 키워드 | 추천 역할 조합 | R2 default lead |
|---|---|---|
| 개발 / 구현 / 코드 | Dev, Architect, QA | Architect |
| PRD / 제품 / 범위 / 우선순위 | PM/Product, UX/Product, Architect | PM/Product |
| 아키텍처 / 설계 / 구조 / 모듈 | Architect, Dev, (관련 도메인 1개) | Architect |
| 보안 / abuse / auth / 권한 | Security, Architect, Dev | Security |
| 운영 / 배포 / 장애 / SLO | SRE/Ops, Dev, Architect | SRE/Ops |
| UX / 사용자 경험 / 메시지 | UX/Product, PM/Product, Dev | UX/Product |
| 개발자 경험 / 문서 / API 사용성 | DevEx/Docs, Dev, Architect | DevEx/Docs |
| 테스트 / 품질 / 회귀 방지 | QA, Dev, Architect | QA |

**복합 perspective**: 두 개 이상 키워드면 합집합으로 역할 선정 (중복 제거). 예: "보안 + 운영" → Security, SRE/Ops, Architect, Dev.

**모호한 perspective**: 매핑에 없으면 Orchestrator가 LLM judge로 추정 후 `AskUserQuestion`으로 1회 확인.

## 추천 표현 예시

구체적 perspective + 결정 목적 명시:
- `/meeting 이슈 8 개발 관점에서 회의 진행해줘`
- `/meeting 이슈 10 PRD 관점, 추가 범위 어디까지 할지 결정`
- `/meeting "mention-parser 리팩터링" 아키텍처 관점, 모듈 경계 재정의`
- `/meeting 15 보안 관점, 충돌 시 Security lead`
- `/meeting "Redis Queue Adapter 도입 시점" 운영 관점, rounds=3`

## 안티패턴

- ❌ `/meeting 8 회의` — perspective 누락 → Orchestrator가 사용자에게 재질문
- ❌ `/meeting 8 Dev 관점` — 단일 역할 의도 → 회의 의미 없음, Orchestrator가 경고 후 일반 prompt 권장 또는 Architect/QA 자동 보강
- ❌ `/meeting 8 좋은 회의` — 모호한 perspective → Orchestrator 확인
- ❌ `/meeting "토큰 한도 늘리기" 개발 관점 rounds=10` — 과도한 round → Orchestrator가 비용 경고 후 진행 여부 확인

## 결정 권한 강조

호출자가 특정 역할 결정 권한 강조 시 prompt에 명시:
- "Architect 결정 우선으로"
- "QA가 테스트 케이스 최종 확정"
- "PM이 범위 컷오프"

→ Orchestrator가 R2 lead로 자동 반영.
