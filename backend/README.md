# backend/

Python ETL + FastAPI 코드가 위치할 폴더 (Phase 3에서 구현 예정).

- `sync.py` — safetydata.go.kr AED 데이터를 가져와 Supabase에 upsert하는 핵심 로직. GitHub Actions cron이 이 스크립트를 직접 실행한다.
- `main.py` — FastAPI 앱. `sync.py`의 로직을 감싼 수동 트리거/헬스체크 엔드포인트만 제공하며, 상시 구동이 필수는 아니다.
- `scripts/probe_api.py` — Phase 1에서 safetydata.go.kr API를 1회 호출해 실제 응답 구조를 확인하는 검증용 스크립트.

자세한 아키텍처 설명은 루트 [`CLAUDE.md`](../CLAUDE.md), 단계별 계획은 [`docs/DEVELOPMENT_PLAN.md`](../docs/DEVELOPMENT_PLAN.md) 참고.
