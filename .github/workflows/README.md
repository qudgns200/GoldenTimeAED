# .github/workflows/

`sync-aed.yml` 워크플로우가 위치할 폴더 (Phase 4에서 구현 예정).

매일 새벽 1~2시(KST) `backend/sync.py`를 GitHub Actions cron으로 직접 실행해 safetydata.go.kr AED 데이터를 Supabase에 동기화한다. cron 표현식은 UTC 기준이므로 KST 01:00~02:00은 `17 16 * * *` ~ `17 17 * * *` 범위로 설정한다.
