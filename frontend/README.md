# frontend/

AED 위치를 안내하는 정적 프론트엔드. 빌드 도구 없이 파일만으로 동작하며, **인터넷이 없어도 동작한다.**

온라인이면 네이버 지도에 마커를 찍고, 오프라인이면 지도 타일 대신 Canvas로 그린 간이 지도와
거리순 목록을 보여준다. 왜 이런 구조인지는 [`docs/OFFLINE_DESIGN.md`](../docs/OFFLINE_DESIGN.md) 참고.

| 파일 | 역할 |
|---|---|
| `index.html` | 마크업. 네이버 지도 스크립트는 `app.js`가 상황을 보고 동적으로 삽입한다 |
| `styles.css` | 스타일 |
| `ui-util.js` | `UiUtil` — 두 뷰가 공유하는 이스케이프/상세 HTML/외부 지도 링크 |
| `geo.js` | `Geo` — 하버사인 거리, 방위각, 뷰포트/최근접 필터 |
| `data-store.js` | `DataStore` — IndexedDB 저장소 |
| `sync-data.js` | `SyncData` — 스냅샷 다운로드/갱신 |
| `map-view.js` | `MapView` — 온라인 네이버 지도 뷰 |
| `offline-view.js` | `OfflineView` — Canvas 간이 지도 + 나침반 + 목록 |
| `app.js` | `App` — 부팅, 모드 전환, 위치, PWA |
| `sw.js` | 서비스워커 (앱 셸 캐시) |
| `manifest.webmanifest` | PWA 설치 정보 |
| `icons/` | 아이콘 PNG + `make_icons.py`(재생성용, 평소엔 실행 불필요) |
| `config.example.js` | 설정 템플릿 (커밋됨) |
| `config.js` | 실제 설정 (**커밋 안 함** — `build-config.sh`가 생성) |
| `build-config.sh` | 환경변수로부터 `config.js`를 생성 |
| `data/` | AED 스냅샷 (**커밋 안 함** — `build_snapshot.py`가 생성) |
| `_headers` | Cloudflare Pages 헤더 규칙 (보안 헤더 + 캐시 무효화) |

빌드 도구가 없으므로 각 파일은 전역 상수 하나를 노출하는 IIFE다.
`index.html`의 `<script>` 순서가 곧 의존 순서다.

## 로컬 실행

```bash
# 저장소 루트에서
set -a && . ./.env && set +a
sh frontend/build-config.sh                     # config.js 생성
python backend/scripts/build_snapshot.py        # data/ 생성 (Supabase 조회)

cd frontend && python -m http.server 8000
# http://127.0.0.1:8000 접속
```

**`file://`로 직접 열지 말 것.** 서비스워커가 등록되지 않아 오프라인 지원이 동작하지 않고,
네이버 지도도 리퍼러 검사에 걸려 인증에 실패한다. 로컬 개발 시 네이버 콘솔 웹 서비스 URL에
`http://127.0.0.1:8000`을 등록해야 지도가 뜬다.

### 오프라인 동작 확인

1. 접속 후 "AED N개를 오프라인용으로 저장했습니다" 메시지 확인
2. DevTools → Application → IndexedDB → `goldentime`에 데이터가 있는지 확인
3. DevTools → Network → **Offline** 체크 → 새로고침
4. 백지나 전체 화면 오류 없이 **간이 지도 + 목록**이 떠야 한다

나침반은 실기기에서만 검증된다. iOS는 권한 요청이 사용자 제스처를 요구하므로
"나침반 켜기" 버튼을 눌러야 하고, 거부해도 북쪽 고정으로 정상 동작한다.

## 배포 (Cloudflare Pages)

Cloudflare 대시보드 → Workers & Pages → Create → Pages → Connect to Git에서
이 저장소를 연결한 뒤 아래와 같이 설정한다.

| 항목 | 값 |
|---|---|
| Framework preset | None |
| Build command | `sh frontend/build-config.sh && python3 backend/scripts/build_snapshot.py` |
| Build output directory | `frontend` |
| Root directory | (비움 — 저장소 루트) |

**환경변수** (Settings → Environment variables, Production/Preview 모두):

| 이름 | 용도 | 비고 |
|---|---|---|
| `NAVER_MAP_CLIENT_ID` | `config.js` 생성 | 없으면 빌드 실패 |
| `NAVER_MAP_AUTH_PARAM` | `config.js` 생성 | 선택. 기본 `ncpKeyId`, 구 콘솔 키는 `ncpClientId` |
| `SUPABASE_URL` | 스냅샷 생성 | |
| `SUPABASE_ANON_KEY` | 스냅샷 생성 | RLS로 SELECT만 허용되므로 공개되어도 안전. **빌드 시점에만 쓰이고 `config.js`에는 들어가지 않는다** |

`build_snapshot.py`는 stdlib만 사용하므로 Pages 빌드에 pip 설치 단계가 필요 없다.
값이 없거나 조회 결과가 비면 exit 1로 빌드를 실패시킨다 — 빈 스냅샷이 배포되면
오프라인 사용자가 조용히 빈 화면을 보게 되기 때문이다.

배포 후 **네이버 클라우드 콘솔에 배포 도메인(`*.pages.dev` 및 커스텀 도메인)을
웹 서비스 URL로 등록**해야 지도가 뜬다. 미등록 시 앱은 목록 뷰로 폴백하고 원인을 안내한다.

`_headers`는 빌드 출력 디렉토리(`frontend/`) 안에 있어야 적용된다.
`Referrer-Policy`를 `no-referrer`/`same-origin`으로 바꾸면 네이버 지도 인증이
깨지므로 건드리지 말 것.

### 매일 갱신

Pages는 커밋 푸시 때만 빌드하므로, GitHub Actions ETL이 끝나면 Deploy Hook으로 재빌드를 건다.
Settings → Builds & deployments → Deploy hooks에서 훅을 만들고 그 URL을 저장소 시크릿
`CLOUDFLARE_DEPLOY_HOOK_URL`에 등록한다 (`.github/workflows/sync-aed.yml` 마지막 단계).

## 설계 메모

**스냅샷 기반 조회** — 프론트엔드는 Supabase를 직접 조회하지 않는다. 하루 1회 생성되는
`data/aed-snapshot.json`(전국 62,000건, 압축 전송 2~3MB)을 최초 1회 받아 IndexedDB에 저장하고,
이후에는 온라인/오프라인 상관없이 저장본에서 읽는다. 갱신 여부는 수백 바이트짜리
`data/aed-meta.json`을 먼저 받아 판단하므로, 데이터가 그대로면 큰 파일을 다시 받지 않는다.

이 전환으로 예전 방어 코드가 통째로 사라졌다 — PostgREST 1000행 상한 대응(`count` 비교 배너),
넓은 뷰포트 차단("확대하세요" 안내), 비동기 요청 순서 경쟁 처리. 전량이 메모리에 있으므로
뷰포트 필터링이 즉시 되고 supabase-js CDN 의존성도 없어졌다.

**마커 상한** — 데이터는 전량 있지만 한 화면에 400개까지만 찍는다. 서울 도심은 AED 밀도가
높아 다 찍으면 지도가 읽히지 않는다. 초과 시 뷰포트 중심에서 가까운 순으로 자른다 —
무작위로 자르면 지도를 조금만 움직여도 표시되는 마커가 튄다.

지역별 실측 밀도 (뷰포트 반경 기준):

| 반경 | 서울시청 | 강남역 | 부산 서면 | 제주시청 | 강원 정선 |
|---|---|---|---|---|---|
| ±0.005도 (~1km) | 133 | 79 | 18 | 8 | 7 |
| ±0.02도 (~4km) | 752 | 560 | 229 | 106 | 20 |
| ±0.05도 (~11km) | 2,545 | 1,811 | 894 | 322 | 21 |

향후 마커 클러스터링을 도입하면 넓은 뷰포트도 의미 있게 보여줄 수 있다.
전량이 메모리에 올라오면서 구현이 훨씬 쉬워졌다.

**오프라인 뷰를 온라인에서도 노출하는 이유** — 오프라인 전용 코드는 평소에 실행되지 않아
검증되지 않은 채 남고, 정작 필요할 때 깨진다. 상단 '목록' 버튼으로 항상 볼 수 있게 두어
이를 막는다. 온라인에서도 "가까운 순 목록"은 그 자체로 유용하다.

**네이버 인증 파라미터** — 신규 콘솔 키는 `ncpKeyId`, 구 콘솔 키는 `ncpClientId`를 쓴다.
`config.js`의 `NAVER_MAP_AUTH_PARAM`으로 바꿀 수 있다. 키가 무효하면 네이버 SDK는
스크립트 로드에 "성공"한 뒤 내부에서 터지므로, `app.js`는 `script.onload`만 믿지 않고
`naver.maps.Map` 존재를 확인하고 초기화를 try/catch로 감싼다.

자세한 아키텍처는 루트 [`CLAUDE.md`](../CLAUDE.md), 오프라인 설계는
[`docs/OFFLINE_DESIGN.md`](../docs/OFFLINE_DESIGN.md), 단계별 계획은
[`docs/DEVELOPMENT_PLAN.md`](../docs/DEVELOPMENT_PLAN.md) 참고.
