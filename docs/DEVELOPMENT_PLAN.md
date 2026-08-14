# 개발계획서

GoldenTimeAED — AED 위치 지도 웹앱. 단계별(Phase) 진행 순서와 각 단계의 완료 기준을 정의한다.

## Phase 0 — 프로젝트 초기화

- [x] `git init` 및 최초 커밋
- [x] 폴더 구조 확정 (`backend/`, `frontend/`, `supabase/`, `docs/`, `.github/workflows/`) — 완료
- [x] `.env.example`, `requirements.txt`, `.gitignore` — 완료
- [x] `.env` 로컬 생성 (파일 생성 완료, 실제 키 값(`SAFETYDATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `NAVER_MAP_CLIENT_ID`)은 각자 로컬에서 채워야 함)

**완료 기준**: `pip install -r requirements.txt`가 로컬에서 성공.

## Phase 1 — 공공데이터 API 검증

- [x] `backend/scripts/probe_api.py` 작성: `SAFETYDATA_API_KEY`로 실제 엔드포인트 호출
- [x] 응답을 `docs/sample_response.json`에 저장 (커밋 제외)
- [x] 실제 필드명/타입을 [`docs/API_SPEC.md`](API_SPEC.md)에 반영해 placeholder 제거
- [x] 확정된 필드에 맞춰 `supabase/schema.sql` 컬럼명 조정

**완료 기준**: `API_SPEC.md`의 "⚠️ 문서 상태" 경고 섹션 제거 가능.

## Phase 2 — Supabase 스키마 설계/생성

- [x] Supabase 프로젝트에서 `supabase/schema.sql` 실행 (테이블 + 인덱스 + RLS 정책)
- [x] `anon` 키로 SELECT 가능, INSERT/UPDATE 불가 확인
- [x] `service_role` 키로 INSERT/UPSERT 가능 확인

**완료 기준**: Supabase 대시보드 SQL Editor 또는 REST API로 정책 동작 확인 완료.

검증은 [`backend/scripts/verify_rls.py`](../backend/scripts/verify_rls.py)로 자동화되어 있다. anon INSERT는 `42501 new row violates row-level security policy`로 거부되는 것이 정상 동작이다.

> 프리티어 프로젝트는 7일간 미사용 시 자동 일시중지(pause)되며, 이때 `<project-ref>.supabase.co` 서브도메인이 DNS에서 사라진다. 배치가 갑자기 실패하면 대시보드에서 프로젝트 상태부터 확인할 것.

## Phase 3 — Python ETL 스크립트

- [x] `backend/sync.py`: fetch(safetydata.go.kr) → transform(스키마 매핑) → upsert(Supabase, `source_id` 기준 conflict 처리)
- [x] 페이지네이션 처리 (전체 데이터 수집)
- [x] 실패 시 재시도/로깅

**완료 기준**: `python backend/sync.py` 로컬 실행 시 Supabase `aed_locations`에 전체 데이터가 채워짐.
→ 62,000행 적재 확인 (약 43초). 재실행해도 62,000행 유지(멱등).

구현 시 확인된 사항:

- `numOfRows`는 **1000이 상한**이다 (2000을 요청해도 1000건만 반환). 전체 62페이지.
- 종료 조건은 빈 `body`다. 마지막 페이지 다음 페이지는 오류가 아니라 `resultCode=00` + 빈 배열.
- **`SN`은 영속 식별자가 아니다** — 재발행 시 다른 AED에 재할당된다 ([`API_SPEC.md`](API_SPEC.md) 경고 참조).
  upsert만으로는 사라진 AED가 남으므로, 수집 완전성 검증 통과 후 `synced_at` 기준으로 오래된 행을 삭제한다.
- 안전장치: `resultCode != "00"`이면 즉시 중단, 수집량이 `totalCount`의 50% 미만이면 upsert 없이 실패 종료.
  어떤 경우에도 delete 후 insert 방식은 쓰지 않는다.

## Phase 4 — GitHub Actions 스케줄러

- [x] `.github/workflows/sync-aed.yml` 작성: cron `17 16 * * *` (KST 01:17) 또는 원하는 새벽 1~2시대 시각
- [ ] 저장소 시크릿 등록: `SAFETYDATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] 워크플로우 수동 실행(`workflow_dispatch`)으로 1회 테스트

**완료 기준**: Actions 탭에서 워크플로우 성공 실행 확인, Supabase 데이터 갱신 확인.

## Phase 5 — 프론트엔드

- [x] `frontend/index.html`: 네이버 지도 JS API v3 초기화
- [x] Supabase JS client 연동, 뷰포트 기준 AED 조회(`docs/API_SPEC.md` 3절 쿼리 패턴)
- [x] 마커 렌더링 + 클릭 시 상세 정보(기관명/주소/전화번호) 표시
- [x] 브라우저 Geolocation으로 "내 위치" 표시
- [ ] **브라우저에서 지도 렌더링 최종 확인** (네이버 콘솔에 `http://127.0.0.1:8000` 등록 필요)

**완료 기준**: 로컬에서 `frontend/index.html` 열었을 때 실제 AED 마커가 지도에 표시됨.

구현 시 확인된 사항:

- **PostgREST는 요청당 1000행 상한**이며 초과분은 경고 없이 잘린다(전국 요청 시 62,000건 중 1,000건만 반환).
  `app.js`는 `limit`(500) + 정확한 `count`를 함께 요청해 "N개 중 500개만 표시" 배너로 알린다.
- 위도 스팬이 0.15도를 넘으면 조회하지 않는다. 서울 도심은 ±0.05도에 AED가 2,545개라 마커 표시가 무의미하다.
- 네이버 지도 인증 파라미터는 신규 콘솔 키 `ncpKeyId` / 구 콘솔 키 `ncpClientId`로 갈린다.
  `config.js`에서 전환 가능하며 인증 실패 시 안내 화면이 뜬다.
- `file://`로 열면 리퍼러 검사에 걸려 지도가 뜨지 않는다. 반드시 HTTP로 서빙할 것.

## Phase 6 — 배포

- [x] **Cloudflare Pages로 결정.** 설정 파일은 [`frontend/_headers`](../frontend/_headers), 빌드는 [`frontend/build-config.sh`](../frontend/build-config.sh)
- [ ] Cloudflare 대시보드에서 저장소 연결 + 빌드 설정 (`sh frontend/build-config.sh` / 출력 `frontend`)
- [ ] 배포 환경에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NAVER_MAP_CLIENT_ID` 주입
- [ ] 네이버 클라우드 콘솔에 배포 도메인(`*.pages.dev`)을 웹 서비스 URL로 등록

**완료 기준**: 배포된 URL에서 지도와 마커가 정상 표시됨.

설정 상세는 [`frontend/README.md`](../frontend/README.md) 배포 절 참고. 주의점:

- `_headers`는 빌드 출력 디렉토리(`frontend/`) 안에 있어야 적용된다.
- `Referrer-Policy`를 `no-referrer`/`same-origin`으로 바꾸면 **네이버 지도 인증이 깨진다**
  (네이버가 Referer로 웹 서비스 URL을 검증하기 때문).
- 파일명에 해시가 없으므로 `Cache-Control: max-age=0, must-revalidate`로 항상 재검증시킨다.
  캐시가 남으면 배포해도 구버전이 보이고 `config.js`의 키 교체가 반영되지 않는다.
- 환경변수가 하나라도 없으면 `build-config.sh`가 exit 1로 빌드를 실패시킨다(검증 완료).

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
