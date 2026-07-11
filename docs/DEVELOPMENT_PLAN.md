# 개발계획서

GoldenTimeAED — AED 위치 지도 웹앱. 단계별(Phase) 진행 순서와 각 단계의 완료 기준을 정의한다.

## Phase 0 — 프로젝트 초기화

- [ ] `git init` 및 최초 커밋
- [ ] 폴더 구조 확정 (`backend/`, `frontend/`, `supabase/`, `docs/`, `.github/workflows/`) — 완료
- [ ] `.env.example`, `requirements.txt`, `.gitignore` — 완료
- [ ] `.env` 로컬 생성 후 실제 키 값 채우기 (`SAFETYDATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `NAVER_MAP_CLIENT_ID`)

**완료 기준**: `pip install -r requirements.txt`가 로컬에서 성공.

## Phase 1 — 공공데이터 API 검증

- [ ] `backend/scripts/probe_api.py` 작성: `SAFETYDATA_API_KEY`로 실제 엔드포인트 호출
- [ ] 응답을 `docs/sample_response.json`에 저장 (커밋 제외)
- [ ] 실제 필드명/타입을 [`docs/API_SPEC.md`](API_SPEC.md)에 반영해 placeholder 제거
- [ ] 확정된 필드에 맞춰 `supabase/schema.sql` 컬럼명 조정

**완료 기준**: `API_SPEC.md`의 "⚠️ 문서 상태" 경고 섹션 제거 가능.

## Phase 2 — Supabase 스키마 설계/생성

- [ ] Supabase 프로젝트에서 `supabase/schema.sql` 실행 (테이블 + 인덱스 + RLS 정책)
- [ ] `anon` 키로 SELECT 가능, INSERT/UPDATE 불가 확인
- [ ] `service_role` 키로 INSERT/UPSERT 가능 확인

**완료 기준**: Supabase 대시보드 SQL Editor 또는 REST API로 정책 동작 확인 완료.

## Phase 3 — Python ETL 스크립트

- [ ] `backend/sync.py`: fetch(safetydata.go.kr) → transform(스키마 매핑) → upsert(Supabase, `source_id` 기준 conflict 처리)
- [ ] 페이지네이션 처리 (전체 데이터 수집)
- [ ] 실패 시 재시도/로깅

**완료 기준**: `python backend/sync.py` 로컬 실행 시 Supabase `aed_locations`에 전체 데이터가 채워짐.

## Phase 4 — GitHub Actions 스케줄러

- [ ] `.github/workflows/sync-aed.yml` 작성: cron `17 16 * * *` (KST 01:17) 또는 원하는 새벽 1~2시대 시각
- [ ] 저장소 시크릿 등록: `SAFETYDATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] 워크플로우 수동 실행(`workflow_dispatch`)으로 1회 테스트

**완료 기준**: Actions 탭에서 워크플로우 성공 실행 확인, Supabase 데이터 갱신 확인.

## Phase 5 — 프론트엔드

- [ ] `frontend/index.html`: 네이버 지도 JS API v3 초기화
- [ ] Supabase JS client 연동, 뷰포트 기준 AED 조회(`docs/API_SPEC.md` 3절 쿼리 패턴)
- [ ] 마커 렌더링 + 클릭 시 상세 정보(기관명/주소/전화번호) 표시
- [ ] 브라우저 Geolocation으로 "내 위치" 표시 및 주변 AED 정렬(선택)

**완료 기준**: 로컬에서 `frontend/index.html` 열었을 때 실제 AED 마커가 지도에 표시됨.

## Phase 6 — 배포

- [ ] Vercel 또는 Cloudflare Pages 중 택1 (둘 다 정적 사이트 호스팅으로 동일하게 동작 — 팀 선호에 따라 결정)
- [ ] 배포 환경에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NAVER_MAP_CLIENT_ID` 주입
- [ ] 네이버 클라우드 콘솔에 배포 도메인을 리퍼러 화이트리스트로 등록

**완료 기준**: 배포된 URL에서 지도와 마커가 정상 표시됨.

## Phase 7 — QA

- [ ] GitHub Actions 배치 실행 로그 정상 확인 (며칠간 모니터링)
- [ ] 빈 응답/API 다운 시 ETL 스크립트가 기존 데이터를 삭제하지 않고 안전하게 실패하는지 확인
- [ ] 지도 초기 로딩 속도, 대량 마커 시 성능(클러스터링 필요 여부) 점검
- [ ] 모바일 브라우저 반응형 확인

**완료 기준**: 1주일간 배치 정상 동작 + 주요 시나리오(정상/빈 데이터/API 오류) 수동 테스트 통과.

---

## 진행 순서 요약

```
Phase 0 (초기화) → Phase 1 (API 검증) → Phase 2 (DB 스키마)
   → Phase 3 (ETL) → Phase 4 (스케줄러) → Phase 5 (프론트엔드)
   → Phase 6 (배포) → Phase 7 (QA)
```

Phase 1은 다른 모든 단계(스키마, ETL, 문서)의 전제 조건이므로 가장 먼저 실제 키로 검증할 것을 권장한다.
