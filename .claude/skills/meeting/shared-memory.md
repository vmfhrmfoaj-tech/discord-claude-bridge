# 공유 메모리 규약 (subagent prompt에 inline 주입)

회의 진행 중 모든 산출물은 `docs/meetings/<slug>/` 하위 파일로 관리한다. Subagent들은 메인 세션 컨텍스트를 공유하지 않으므로 **파일을 통해서만 협업**한다.

## 디렉터리 구조

```
docs/meetings/<slug>/
├── brief.md
├── round1/
│   ├── architect.md
│   ├── dev.md
│   ├── qa.md
│   └── <other-role>.md
├── round2/                  # 충돌 있을 때만 생성
│   ├── <lead>.md            # lead 먼저 작성
│   └── <conflicting>.md     # 충돌 당사자 follow-up
└── summary.md               # Moderator 작성
```

## 파일 명명 규약

- 디렉터리 slug: `issue-<N>-<kebab-title>` 또는 `topic-<kebab-slug>`. 중복 시 `-2`, `-3`.
- Round 디렉터리: `round1`, `round2`, `round3` (1-base, zero-padding 없음).
- 역할 파일: `{role}.md` — 역할 키 소문자 kebab. 매핑:
  - `architect.md`, `dev.md`, `qa.md`
  - `ux-product.md`, `pm-product.md`
  - `security.md`, `sre-ops.md`, `devex-docs.md`
  - `moderator.md` (summary 전 단계용 — 현재 흐름에서는 summary.md 직접 작성)

## 직접 쓰기 규칙 (Subagent)

**자기 역할 파일만 Write**. 위반 사례:

- ❌ Dev subagent가 `round1/architect.md`를 수정
- ❌ Architect subagent가 `summary.md`를 작성
- ❌ Subagent가 `brief.md`를 수정 (Orchestrator만 작성)

올바른 사용:

- ✅ Dev subagent → `round1/dev.md` Write
- ✅ Lead Architect subagent → `round2/architect.md` Write
- ✅ Non-lead Dev subagent → `round2/dev.md` Write

## 읽기 규칙

- **항상 읽기 허용**: `brief.md`, 이전 round의 모든 `{role}.md`
- **현재 round 읽기**: 자기 파일 외에는 읽지 않음 (병렬 실행 중이라 다른 역할 파일이 부분 작성 상태일 수 있음). R2의 6-B 페이즈에서는 `round2/{lead}.md`는 이미 작성 완료이므로 읽기 허용.
- **prompt 비대 회피**: Orchestrator는 파일 본문을 prompt에 붙이지 않고 경로만 주입. Subagent가 필요한 만큼 Read.

## 충돌 표시 형식

R1의 각 역할 파일은 마지막 섹션에 `## 미결 사항 (다른 역할에게)` 작성. 항목별로 `@role` 마커 명시:

```markdown
## 미결 사항 (다른 역할에게)

- @architect: 이 결정이 기존 Module 경계 안에 들어가나 새 Adapter가 필요한가?
- @qa: silent ignore일 때 publisher mock 미호출을 단언할지, parse 결과 유닛 단언으로 충분한지?
```

Orchestrator가 R1 완료 후 이 섹션들을 모아 충돌 항목 도출 → R2 lead/참여자 선정.

## R2 출력 분기

**Lead 역할** (R2에서 결정 주체):
```markdown
## 결정
<결정 1줄 + 핵심 근거 1~2 bullet>

## 근거
<상세 근거>

## 구현 지시 (X 역할에게)
- @dev: ...
- @qa: ...
```

**Non-lead 역할** (R2에서 lead 결정에 대한 후속):
```markdown
## 동의/이견
<lead 결정에 동의 또는 이견 명시>

## 후속 조정 필요
<자기 영역에서의 후속 작업 또는 추가 미결>
```

## Slug 생성 규칙 (Orchestrator 책임)

1. 이슈인 경우: `gh issue view N --json title` → title을 다음 변환:
   - 영문: 소문자, 공백→하이픈, 영숫자+하이픈 외 제거, 첫 4~6 단어
   - 한글 포함: 영문 단어만 추출 후 위 규칙, 영문 단어 없으면 transliteration 대신 hash 8자 (`topic-<hash>`)
2. Topic인 경우: prompt 핵심 키워드 동일 변환
3. 디렉터리 이미 존재 시 `-2`, `-3` 접미

## 동시성 안전성

- R1 병렬 N개 Task → 각 Task가 다른 파일에 Write → 충돌 없음
- R2 6-B 병렬 → 동일
- 같은 round의 같은 역할이 중복 실행되는 시나리오는 없음 (Orchestrator가 1회만 발사)

## 산출물 불변성

- 한번 작성된 round 파일은 같은 회의 내에서 재수정 금지. 재실행이 필요하면 새 slug로 새 회의 시작.
- Orchestrator는 회의 시작 전 slug 충돌 시 새 접미 부여 (기존 산출물 보호).
