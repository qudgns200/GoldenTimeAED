# 개발계획서

GoldenTimeAED — AED 위치 지도 웹앱. 단계별(Phase) 진행 순서와 각 단계의 완료 기준을 정의한다.

> **작업을 이어받는 중이라면** [`HANDOFF.md`](HANDOFF.md)를 먼저 볼 것.
> 이 문서의 미완료 항목을 우선순위와 구체적 절차로 정리해두었다.

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

검증은 `backend/scripts/verify_rls.py`로 자동화했다. anon INSERT가 `42501 new row violates row-level security policy`로 거부되는 것이 정상 동작이었다.

> **Phase 9에서 대체됨** — Supabase를 걷어내면서 이 단계의 산출물이 모두 삭제되었다:
> `supabase/schema.sql`, `backend/scripts/verify_rls.py`, 그리고 `SUPABASE_*` 환경변수 3개.
> 지금은 데이터베이스가 없고 `sync.py`가 API에서 받아 바로 정적 스냅샷을 만들어 커밋한다.
> 프리티어 7일 미사용 자동 정지에 시달릴 이유도 함께 사라졌다(그게 제거 이유 중 하나였다).
> **이 절은 기록으로만 남긴다 — 지금 따라 할 절차가 아니다.**

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
- [x] 저장소 시크릿 등록 (8/14 워크플로가 실제로 성공한 것으로 확인)
      — **Phase 9 이후 필요한 시크릿은 `SAFETYDATA_API_KEY` 하나뿐이다**
- [ ] 워크플로우 수동 실행(`workflow_dispatch`)으로 1회 테스트

**완료 기준**: Actions 탭에서 워크플로우 성공 실행 확인, 스냅샷 갱신 확인.

## Phase 5 — 프론트엔드

- [x] `frontend/index.html`: 네이버 지도 JS API v3 초기화
- [x] Supabase JS client 연동, 뷰포트 기준 AED 조회(`docs/API_SPEC.md` 3절 쿼리 패턴)
- [x] 마커 렌더링 + 클릭 시 상세 정보(기관명/주소/전화번호) 표시
- [x] 브라우저 Geolocation으로 "내 위치" 표시
- [ ] **브라우저에서 지도 렌더링 최종 확인** (네이버 콘솔에 `http://127.0.0.1:8000` 등록 필요)

**완료 기준**: 로컬에서 `frontend/index.html` 열었을 때 실제 AED 마커가 지도에 표시됨.

구현 시 확인된 사항:

- **PostgREST는 요청당 1000행 상한**이며 초과분은 경고 없이 잘린다(전국 요청 시 62,000건 중 1,000건만 반환).
  `app.js`는 `limit`(500) + 정확한 `count`를 함께 요청해 "N개 중 500개만 표시" 배너로 알렸다.
- 위도 스팬이 0.15도를 넘으면 조회하지 않는다. 서울 도심은 ±0.05도에 AED가 2,545개라 마커 표시가 무의미하다.
- 네이버 지도 인증 파라미터는 신규 콘솔 키 `ncpKeyId` / 구 콘솔 키 `ncpClientId`로 갈린다.
  `config.js`에서 전환 가능하며 인증 실패 시 안내가 뜬다.
- `file://`로 열면 리퍼러 검사에 걸려 지도가 뜨지 않는다. 반드시 HTTP로 서빙할 것.

> **Phase 8에서 대체됨** — 실시간 Supabase 조회를 스냅샷 기반으로 바꾸면서 위 두 항목
> (1000행 상한 대응, 뷰포트 차단)은 코드에서 제거되었다. 전량이 메모리에 있으므로 더 이상
> 필요 없다. 프론트엔드의 Supabase 조회와 supabase-js CDN 의존성도 함께 사라졌다.

## Phase 6 — 배포

- [x] **Cloudflare로 결정.** 헤더는 [`frontend/_headers`](../frontend/_headers), 빌드는 [`frontend/build-config.sh`](../frontend/build-config.sh)
      (Pages로 시작했으나 Phase 9에서 **Workers 정적 자산**으로 정리됨 — [`wrangler.jsonc`](../wrangler.jsonc))
- [x] Cloudflare 대시보드에서 저장소 연결 (프로젝트 생성·배포 완료)
- [ ] 대시보드 빌드 설정을 Workers 기준으로 변경 (Phase 9 항목 참고).
      기본값(`npm run build`)이 남아 있으면 `package.json`이 없어 **빌드가 실패한다**
- [ ] 빌드 변수에 `NAVER_MAP_CLIENT_ID` 주입 (`SUPABASE_*`는 더 이상 쓰이지 않음)
- [ ] 네이버 클라우드 콘솔에 배포 도메인(`*.workers.dev`)을 웹 서비스 URL로 등록

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

## Phase 8 — 오프라인 지원

기획 의도에 있던 "오프라인에서도 동작"이 Phase 0~7 어디에도 반영되지 않은 것을 발견해 추가한 단계.
지하 주차장·엘리베이터처럼 **네트워크가 약한 곳일수록 심정지 대응이 필요**하므로 필수 기능으로 다룬다.
설계 근거와 데이터 흐름은 [`docs/OFFLINE_DESIGN.md`](OFFLINE_DESIGN.md)에 별도 문서로 정리했다.

**실시간 조회 → 스냅샷 기반 전환**

- [x] `backend/scripts/build_snapshot.py`: Supabase 전량 → `data/aed-snapshot.json` + `aed-meta.json`
      (배포 빌드 환경에 의존성을 추가하지 않도록 stdlib만 사용)
- [x] 프론트엔드에서 Supabase 직접 조회 제거 — supabase-js CDN 및 `SUPABASE_ANON_KEY` 노출 제거
- [x] `data-store.js`(IndexedDB) + `sync-data.js`(meta 비교 후 조건부 다운로드)
- [x] `build-config.sh`에서 Supabase 키 제거, `.gitignore`에 `frontend/data/` 추가

**오프라인 화면**

- [x] `geo.js`: 하버사인 거리 / 방위각 / 최근접·뷰포트 필터
- [x] `offline-view.js`: Canvas 간이 지도(거리 동심원 + 방위 눈금 + 나침반 회전) + 거리순 목록
- [x] `map-view.js` 분리, `app.js`는 부팅·모드 전환만 담당
- [x] 모든 실패를 오프라인 뷰로 흡수 — 전체 화면 오버레이(`fatal`) 제거

**PWA**

- [x] `sw.js`(앱 셸 캐시), `manifest.webmanifest`, 아이콘 3종(`icons/make_icons.py`로 재생성 가능)
- [x] `navigator.storage.persist()` 요청 + 설치 안내 1회 노출

**배포 연동**

- [x] `sync-aed.yml`에 Cloudflare Pages Deploy Hook 호출 단계 추가
- [ ] 실기기 검증: 나침반(iOS 권한 버튼), 홈 화면 설치 후 비행기 모드 실행

> **Phase 9에서 대체됨** — Deploy Hook과 `CLOUDFLARE_DEPLOY_HOOK_URL` 시크릿, 그리고
> 빌드에서 스냅샷을 만들던 단계가 모두 사라졌다. 스냅샷이 저장소에 커밋되므로
> push가 곧 재배포다. 빌드 명령은 `sh frontend/build-config.sh`로 되돌아갔다.

**완료 기준**: 온라인 1회 방문 후 비행기 모드에서 앱이 뜨고, 저장된 데이터로 주변 AED가 거리순으로 표시됨.

구현 시 확인된 사항:

- **오프라인 지도 타일은 불가능하다.** 네이버·구글·카카오 모두 웹 API는 온라인 전용이고
  약관상 타일 저장도 제한된다. 구글 지도 *앱*의 오프라인 기능은 그 앱 안에만 존재해
  웹페이지가 꺼내 쓸 수 없다. 지도 회사를 바꿔서 해결되는 문제가 아니라,
  타일을 직접 호스팅(MapLibre + PMTiles)해야만 가능하다 → 범위 밖으로 두었다.
- **다운로드는 두 번 일어난다.** 서버 쪽(매일 자정 스냅샷 생성)과 사용자 기기 쪽(온라인 방문 시
  IndexedDB 저장)은 별개다. 오프라인일 때는 다운로드가 불가능하므로 **미리 받아두는 것**이 핵심이고,
  버튼에 의존하면 안 누른 사용자는 응급 시 빈 화면을 본다 → 첫 방문 시 자동 다운로드.
- **설치는 오프라인의 필수 조건이 아니다.** 서비스워커는 일반 탭에서도 동작한다. 그럼에도 설치를
  권하는 이유는 iOS Safari가 **7일 미방문 시 서비스워커/IndexedDB를 삭제**하기 때문이다
  (홈 화면 설치 시 예외). AED 앱은 "오래 안 씀"이 기본 상태라 이 차이가 크다.
- **오프라인 뷰는 온라인에서도 토글로 노출한다.** 평소에 실행되지 않는 코드는 검증되지 않은 채
  남아 정작 필요할 때 깨진다.
- 캔버스에서 가까운 3개는 **이름 대신 숫자(1·2·3)** 로 표시한다. 도심은 AED가 한곳에 몰려 있어
  이름표를 붙이면 서로 겹쳐 읽을 수 없다. 이름은 같은 순서의 아래 목록에서 확인한다.
- 네이버 SDK는 **키가 무효여도 스크립트 로드는 "성공"한 뒤 내부에서 터진다.** `script.onload`만
  믿으면 안 되므로 `naver.maps.Map` 존재를 확인하고 `MapView.init`을 try/catch로 감싼다.

## Phase 9 — Supabase 제거

Phase 8에서 프론트엔드가 Supabase를 직접 조회하지 않게 되면서, Supabase는 배치가 쓰고
빌드가 되읽기만 하는 중간 저장소로 남았다. 존재 이유가 사라진 반면 비용은 그대로였다 —
프리티어 7일 미사용 자동 정지, 시크릿 3개의 이중 관리, 빌드마다 6만 행 재조회,
그리고 **Deploy Hook이라는 배선 자체가 데이터가 저장소 밖에 있기 때문에** 필요했다.

- [x] `backend/sync.py`를 API → 정적 스냅샷 직행으로 전환 (`build_snapshot.py` 흡수)
- [x] 행 내용이 바뀐 날에만 파일을 쓰도록 해 매일 10MB 커밋이 쌓이는 것을 방지
- [x] 좌표 기반 자연키로 안정 정렬 + sha1 기반 안정 id (delta 압축이 먹게)
- [x] `frontend/data/`를 커밋 대상으로 전환 (`.gitignore`에서 제거)
- [x] 워크플로에 커밋·push 단계 추가, Deploy Hook 단계 제거
- [x] `supabase/schema.sql`, `verify_rls.py`, `build_snapshot.py` 삭제, `requirements.txt`에서 `supabase` 제거
- [x] Workers 정적 자산 설정(`wrangler.jsonc`, `frontend/.assetsignore`) 추가
- [ ] 대시보드 빌드 설정 변경: Build `sh frontend/build-config.sh` / Deploy `npx wrangler deploy` / Root `/`
- [ ] `wrangler.jsonc`의 `name`이 대시보드 Worker 이름과 같은지 확인
- [ ] GitHub 시크릿에서 `SUPABASE_*`·`CLOUDFLARE_DEPLOY_HOOK_URL` 제거 (선택)

**완료 기준**: `python backend/sync.py`가 스냅샷을 만들고, 연속 재실행 시 파일을 건드리지 않으며,
Actions가 변경분만 커밋해 Workers가 자동 재배포된다.

검증 결과 (2026-08-18 실측):

- 61,717건 / raw **10.8MB** / gzip 2.4MB, 수집 13.4초 (원본 62,000건 중 중복 283건 제거)
- **연속 2회 실행 시 두 번째가 파일을 바이트 단위로 건드리지 않음** (mtime·sha256 동일) —
  이 설계의 핵심 가정이 검증되었다
- id 61,717개 전부 정수·중복 0건, 최대값이 `2^53` 안 (JS `Number` 안전)
- 시크릿이 `SAFETYDATA_API_KEY` 하나로 줄고, 배포 빌드가 네트워크를 타지 않게 됨

> 되돌릴 필요가 생기면 삭제된 파일은 git 히스토리에 남아 있다. Supabase 프로젝트 자체도
> 당분간 지우지 않는 것을 권한다.

---

## 진행 순서 요약

```
Phase 0 (초기화) → Phase 1 (API 검증) → Phase 2 (DB 스키마)
   → Phase 3 (ETL) → Phase 4 (스케줄러) → Phase 5 (프론트엔드)
   → Phase 6 (배포) → Phase 7 (QA) → Phase 8 (오프라인 지원)
   → Phase 9 (Supabase 제거)
```

Phase 1은 다른 모든 단계의 전제 조건이므로 가장 먼저 실제 키로 검증할 것을 권장한다.

**Phase 2와 Phase 3의 upsert 부분은 Phase 9에서 폐기되었다.** Phase 5의 데이터 조회 방식은
Phase 8에서 대체되었고, Phase 6·8의 배포 배선은 Phase 9에서 단순화되었다.
과거 Phase의 체크박스는 그 시점의 기록으로 남겨두었으니, **현재 구조는 Phase 8·9 기준으로 읽을 것.**
