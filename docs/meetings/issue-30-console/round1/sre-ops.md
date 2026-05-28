## [SRE/Ops] Round 1

### 입장

v1 로컬 프로세스라는 운영 복잡도가 낮은 환경에서 파일 로그로의 전환은 타당하나, **stderr/stdout을 완전히 버리면 안 된다.** systemd나 PM2로 프로세스를 관리할 때 프로세스 매니저가 stdout/stderr을 캡처하므로, 파일과 콘솔을 동시에 출력하는 멀티플렉싱이 운영상 안전하다. 로그 경로는 `config.yaml`의 `logging` 섹션에서 선언하되, 환경변수 `LOG_FILE`로도 오버라이드 가능하게 하면 기존 설정 패턴(`CONFIG_PATH`, `RESPONSE_MODE`)과 일관성을 유지할 수 있다. v1에서 로그 회전(rotation)은 필수가 아니며, 외부 도구(logrotate 또는 PM2 log-rotate)에 위임하는 것이 구현 복잡도를 최소화하는 현실적 선택이다.

### 관측성 요구사항

- **로그**: 파일 쓰기 실패 시 `warn` 레벨로 stderr에 fallback 이벤트 기록 (`event: "log_write_failed"`, `path`, `error`). 로그 파일 오픈/초기화 성공 시 `info` 레벨로 1회 기록 (`event: "log_file_opened"`, `path`).
- **메트릭**: v1 범위에서는 별도 메트릭 수집 없음. 디스크 사용량은 외부 OS 모니터링(df, du)으로 충분.
- **알람**: 파일 쓰기 fallback이 연속 발생하면 운영자가 인지할 수 있도록 stderr로 출력 유지. 별도 알람 시스템 없음(v1 범위 초과).

### 장애 시나리오

| # | 시나리오 | 영향 | 복구 방법 |
|---|---|---|---|
| 1 | 로그 디렉토리 미존재 (`ENOENT`) | 파일 쓰기 전체 실패 | 기동 시 디렉토리 자동 생성 (`mkdir -p`); 실패 시 stderr fallback으로 계속 동작 |
| 2 | 디스크 풀 (`ENOSPC`) | 파일 쓰기 실패, 이후 모든 로그 손실 | stderr fallback 활성화; 프로세스는 계속 동작. 운영자가 디스크 정리 후 재시작 |
| 3 | 로그 파일 권한 없음 (`EACCES`) | 파일 쓰기 전체 실패 | stderr fallback; 운영자가 경로/권한 수정 후 재시작 |
| 4 | 프로세스 비정상 종료 (mid-write) | 마지막 로그 라인 잘림 가능 | 비동기 쓰기 특성상 일부 유실 허용. 각 이벤트가 단일 JSON 라인으로 출력되므로 파싱 내결함성 필요 |
| 5 | 로그 파일 외부 삭제/이동 (logrotate 등) | 삭제 후 쓰기 시 `ENOENT` 또는 파일 핸들 유지로 디스크 해제 안 됨 | `copytruncate` 방식 logrotate 사용 권장. 또는 SIGHUP으로 핸들 재오픈하는 시그널 핸들러 추가 (v2 고려) |

### 리소스 영향

- **CPU/메모리**: JSON 직렬화는 이미 현재 구현에서 수행 중. 추가 오버헤드 미미. 비동기 쓰기(`appendFile` 비동기 버전)를 사용하면 이벤트 루프 블로킹 없음.
- **디스크/IO**: 동기 쓰기(`appendFileSync`)는 이벤트 루프를 블로킹하므로 **금지**. 비동기 쓰기 사용 시 로그 트래픽(초당 수십 건 수준)에서 디스크 IO는 문제 없음. 별도 버퍼링/배치 불필요.
- **네트워크/외부 의존성**: 없음. 로컬 파일 IO만 해당.

### 미결 사항 (다른 역할에게)

- @dev: `appendFile`(비동기) 사용 필수. `appendFileSync`는 이벤트 루프 블로킹으로 Discord 응답 지연을 유발하므로 사용 금지. 파일 쓰기 실패 시 프로세스 종료가 아닌 **stderr fallback + 계속 동작** 전략 구현 요청.
- @dev: 프로세스 기동 시 로그 디렉토리가 없으면 `mkdir -p` 자동 생성 처리 필요 (기존 `.data/` 디렉토리 자동 생성 선례 참고).
- @dev: `reply-publisher.ts`, `main.ts`, `smoke-claude.ts`의 직접 `console` 호출도 동일 파일 대상으로 통합해야 운영 시 로그 분산 문제가 없음.
- @architect: 로그 파일 경로(`logging.filePath`)를 `RuntimeConfig`의 `logging` 섹션에 추가하는 것을 검토 요청. 현재 `logging: { level, format }`으로만 정의되어 있으므로 인터페이스 확장 필요 여부 판단 요청.
- @architect: stdout/stderr 병행 출력 여부를 환경(`NODE_ENV` 또는 별도 설정)으로 제어하는 경우, 그 설정 seam의 위치 및 책임 경계 명확화 요청.
