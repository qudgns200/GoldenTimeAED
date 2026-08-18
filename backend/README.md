# backend/

- `sync.py` — safetydata.go.kr AED 데이터를 전량 수집해 `frontend/data/`에 정적 스냅샷을 쓰는 핵심 로직. GitHub Actions cron이 이 스크립트를 직접 실행하고, 내용이 바뀐 날에만 결과를 커밋한다. 데이터베이스는 쓰지 않는다.
- `main.py` — FastAPI 앱. `sync.py`의 로직을 감싼 수동 트리거/헬스체크 엔드포인트만 제공하며, 상시 구동이 필수는 아니다.
- `scripts/probe_api.py` — safetydata.go.kr API를 1회 호출해 실제 응답 구조를 확인하는 검증용 스크립트.

`sync.py`를 만질 때 지켜야 할 것:

- **정렬과 id는 결정적이어야 한다.** 좌표 기반 자연키로 정렬하고 그 sha1에서 id를 만든다. 순번을 id로 쓰거나 정렬을 흔들면 행 하나만 추가돼도 파일 전체가 바뀌어 매일 10MB짜리 커밋이 쌓인다.
- **실패하면 파일을 쓰지 않는다.** API 오류나 부분 수집 시 기존 스냅샷이 배포된 채 남아야 한다.
- `SN`은 원본 재발행 때마다 재할당되므로 정렬·식별에 쓰지 않는다 ([`docs/API_SPEC.md`](../docs/API_SPEC.md) 경고 참고).

자세한 아키텍처 설명은 루트 [`CLAUDE.md`](../CLAUDE.md), 단계별 계획은 [`docs/DEVELOPMENT_PLAN.md`](../docs/DEVELOPMENT_PLAN.md) 참고.
