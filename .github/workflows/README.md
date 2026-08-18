# .github/workflows/

`sync-aed.yml` — 매일 새벽 1시대(KST) `backend/sync.py`를 실행해 safetydata.go.kr AED 데이터를 수집하고, `frontend/data/`의 정적 스냅샷을 갱신한다. cron 표현식은 UTC 기준이므로 KST 01:17은 `17 16 * * *`이다.

동작 방식:

1. `sync.py`가 API 전량을 받아 스냅샷을 만든다. 실패하면 파일을 쓰지 않고 종료하므로 기존 스냅샷이 그대로 배포된 채 남는다.
2. 행 내용이 실제로 바뀐 날에만 파일이 갱신되고, 그때만 커밋·push한다.
3. **push가 Cloudflare Workers 재배포를 자동으로 유발한다.** Deploy Hook은 필요 없다.

필요한 저장소 시크릿은 `SAFETYDATA_API_KEY` 하나뿐이다. 스냅샷을 커밋해야 하므로 워크플로에 `permissions: contents: write`가 있다.
