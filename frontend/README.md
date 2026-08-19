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
| `data/` | AED 스냅샷 (**커밋 대상** — `backend/sync.py`가 생성) |
| `_headers` | Cloudflare 헤더 규칙 (보안 헤더 + 캐시 무효화) |
| `.assetsignore` | Workers 배포에서 제외할 파일 (README·빌드 스크립트 등) |

빌드 도구가 없으므로 각 파일은 전역 상수 하나를 노출하는 IIFE다.
`index.html`의 `<script>` 순서가 곧 의존 순서다.

## 로컬 실행

```bash
# 저장소 루트에서
set -a && . ./.env && set +a
sh frontend/build-config.sh                     # config.js 생성 (NAVER_MAP_CLIENT_ID 필요)

cd frontend && python -m http.server 8000
# http://127.0.0.1:8000 접속
```

`data/`의 스냅샷은 저장소에 커밋되어 있어 clone 직후 바로 동작한다.
최신 데이터가 필요할 때만 `python backend/sync.py`를 돌리면 된다.

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

## 배포 (Cloudflare Workers — 정적 자산)

Pages가 아니라 **Workers의 정적 자산(static assets)** 기능으로 배포한다.
서버 코드는 없고 `frontend/`를 통째로 올린다. 설정은 루트 [`wrangler.jsonc`](../wrangler.jsonc)에 있다.

대시보드 → Workers & Pages → 프로젝트 → Settings → Build:

| 항목 | 값 |
|---|---|
| Build command | `sh frontend/build-config.sh` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

**빌드 변수** (Settings → Build → Variables):

| 이름 | 용도 | 비고 |
|---|---|---|
| `NAVER_MAP_CLIENT_ID` | `config.js` 생성 | 없으면 빌드 실패 |
| `NAVER_MAP_AUTH_PARAM` | `config.js` 생성 | 선택. 기본 `ncpKeyId`, 구 콘솔 키는 `ncpClientId` |

> `wrangler.jsonc`의 `name`이 **대시보드의 Worker 이름과 같아야 한다.**
> 다르면 `wrangler deploy`가 다른 이름의 Worker를 새로 만들어버린다.

AED 데이터는 빌드가 만들지 않는다. `frontend/data/`의 스냅샷은 저장소에 커밋되어 있고
GitHub Actions가 갱신한다. 따라서 **빌드는 네트워크를 타지 않아** 빠르고 실패 지점이 없다.

배포 후 **네이버 클라우드 콘솔에 배포 도메인(`*.workers.dev` 및 커스텀 도메인)을
웹 서비스 URL로 등록**해야 지도가 뜬다. 미등록 시 앱은 목록 뷰로 폴백하고 원인을 안내한다.

`_headers`는 정적 자산 디렉토리(`frontend/`) 안에 있어야 적용된다. Workers가 이 파일을
파싱해 헤더 규칙으로 쓰고 파일 자체는 서빙하지 않는다.
`Referrer-Policy`를 `no-referrer`/`same-origin`으로 바꾸면 네이버 지도 인증이
깨지므로 건드리지 말 것.

`.assetsignore`는 업로드에서 뺄 파일 목록이다(README, 빌드 스크립트 등 공개할 이유가 없는 것).

**`not_found_handling`은 `"none"`이다.** 이 앱은 클라이언트 라우팅이 없어서 없는 경로에는
정직하게 404를 준다. `"single-page-application"`으로 바꾸면 없는 파일 요청에도 `index.html`이
200으로 돌아와, `sync-data.js`가 스냅샷 대신 HTML을 받아 파싱에서 터진다 —
실패 원인이 "파일 없음"이 아니라 "파싱 오류"로 둔갑해 디버깅이 어려워진다.

### 매일 갱신

별도 설정이 없다. GitHub Actions가 스냅샷을 갱신해 커밋하면 **push가 Workers 재배포를
자동으로 유발한다.** 데이터가 저장소 안에 있어서 가능한 구조이고, 그래서 Deploy Hook이 없다.

데이터가 바뀌지 않은 날은 커밋 자체가 없으므로 불필요한 재배포도 일어나지 않는다.

## 설계 메모

**스냅샷 기반 조회** — 프론트엔드는 어떤 API도 조회하지 않는다. 저장소에 커밋된
`data/aed-snapshot.json`(전국 61,717건, raw 10.8MB / 압축 전송 2.4MB)을 최초 1회 받아 IndexedDB에 저장하고,
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

**AED 마커는 빨간 하트** — 심장충격기라는 정체성과 맞고, 파란색 "내 위치"와 색으로 구분되어
응급 상황에서 헷갈리지 않는다. 지도에서는 `ImageIcon`(data URI SVG)을 쓰고 `HtmlIcon`(content)은
쓰지 않는다. 한 화면에 400개까지 찍는데 HTML 마커는 DOM 노드를 그만큼 만들어 모바일에서
눈에 띄게 느려지기 때문이다. 도형은 `ui-util.js`가 지도·캔버스 양쪽에 공급한다.

가까운 3개는 큰 하트 + 남색 숫자 배지로 구분한다. 배지는 하트 밖에 붙이고 **이미 놓인 배지와
내 위치 표시를 피해 자리를 찾는다** — 도심에서는 가까운 3개가 같은 건물이라 좌표가 거의 같아
고정 위치에 붙이면 세 배지가 포개져 하나만 보인다(실제로 그렇게 깨졌다).

**설치 버튼의 iOS 제약** — 상단바 '설치'는 Chromium 계열에서만 자동 설치가 된다
(`beforeinstallprompt` → `prompt()`). iOS Safari에는 프로그램적 설치 API가 아예 없어
안내 시트로 `공유 → 홈 화면에 추가` 절차를 보여주는 것이 최선이다. 분기는 UA가 아니라
prompt 이벤트를 받아뒀는지로 판단한다 — 브라우저가 바뀌거나 애플이 나중에 지원하면
자동으로 좋은 경로를 타게 하기 위해서다.

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
