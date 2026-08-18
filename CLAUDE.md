# CLAUDE.md

이 파일은 Claude Code(및 협업하는 개발자)가 GoldenTimeAED 프로젝트에서 작업할 때 참고하는 가이드다.

## 프로젝트 개요

자동심장충격기(AED) 위치를 지도와 목록으로 안내하는 웹앱. 공공데이터포털(safetydata.go.kr)의 AED 위치 데이터를 매일 배치로 수집해 정적 스냅샷 파일로 저장소에 커밋하고, 프론트엔드가 이를 받아 기기에 저장한다. **인터넷이 없어도 동작한다.**

## 아키텍처

```
[GitHub Actions cron, 매일 01~02시 KST]
        │  python backend/sync.py
        ▼
[safetydata.go.kr AED API] ──fetch 전량──▶ [변환·중복제거·안정정렬]
                                                        │
                                     행 내용이 바뀐 날에만 파일을 쓰고 커밋
                                                        ▼
                                    frontend/data/aed-snapshot.json (raw 10.8MB / 전송 2.4MB)
                                                        │
                                          push → [Cloudflare Workers 자동 재배포]
                                                        │
                                          [정적 프론트엔드 (PWA + 서비스워커)]
                                                 │
                                    최초 1회 다운로드 → IndexedDB
                                                 │
                          ┌──────────────────────┴──────────────────────┐
                     온라인일 때                                  오프라인일 때
                네이버 지도 + 마커                    Canvas 간이 지도 + 나침반 + 거리순 목록
                  (map-view.js)                            (offline-view.js)
```

**왜 상시 서버가 아닌가:** 데이터는 하루 1회만 갱신되면 충분하므로 상시 구동되는 API 서버가 필요 없다. 스케줄링은 무료·안정적인 GitHub Actions cron으로 처리하고, FastAPI는 로컬 테스트/수동 트리거용 얇은 래퍼로만 존재한다. 반드시 배포해야 하는 서버가 아니다.

**왜 데이터베이스가 없는가:** 예전에는 Supabase에 적재하고 프론트엔드가 RLS 뒤에서 뷰포트 쿼리로 조회했다. 오프라인 지원을 넣으면서 프론트엔드가 스냅샷만 읽게 되자, Supabase는 배치가 쓰고 빌드가 되읽기만 하는 중간 저장소로 전락했다. 그 대가는 컸다 — 프리티어 7일 미사용 자동 정지, 시크릿 3개의 이중 관리, 빌드마다 6만 행 재조회, 그리고 Deploy Hook이라는 배선 자체가 데이터가 저장소 밖에 있기 때문에 필요했다. 지금은 API에서 받아 바로 JSON으로 쓰고 커밋한다. **push가 곧 배포**라 훅이 필요 없고, 시크릿은 `SAFETYDATA_API_KEY` 하나뿐이다.

**왜 스냅샷을 저장소에 커밋하는가:** push가 곧 Workers 재배포가 되어 배선이 하나 사라지고, 스냅샷이 버전 관리되어 롤백과 diff 확인이 쉽다. 매일 10MB가 쌓일 걱정은 `sync.py`가 **행 내용이 실제로 바뀐 날에만 파일을 다시 쓰는 것**으로 막는다. 이 동작이 성립하려면 정렬과 id가 결정적이어야 한다(아래 주의사항 참고).

**왜 실시간 조회가 아니라 스냅샷인가:** 오프라인에서 동작해야 하기 때문이다. 오프라인일 때는 다운로드가 불가능하므로 **미리 받아두는 수밖에 없다**. 부수 효과로 PostgREST 1000행 상한 대응 코드와 뷰포트 차단 로직이 통째로 사라졌고, 프론트엔드에서 Supabase 의존성(supabase-js CDN, `SUPABASE_ANON_KEY` 노출)도 함께 없어졌다.

**왜 오프라인에서는 지도가 아닌가:** 네이버·구글·카카오 모두 웹 지도 API는 온라인 전용이다. 타일을 매 요청마다 서버에서 받아오고 약관상 저장도 제한된다. 지도 회사를 바꿔서 해결되는 문제가 아니다. 상세한 근거와 데이터 흐름은 [`docs/OFFLINE_DESIGN.md`](docs/OFFLINE_DESIGN.md)에 정리되어 있으며, **오프라인 관련 코드를 건드리기 전에 반드시 읽을 것.**

## 기술 스택

- **백엔드**: Python, FastAPI(수동 트리거용), httpx(API 호출)
- **데이터 저장**: 없음. 정적 JSON 스냅샷을 저장소에 커밋한다
- **프론트엔드**: 순수 HTML/CSS/JS (빌드 도구 없음), 네이버 지도 JS API v3, Canvas 2D, 서비스워커 + IndexedDB
- **스케줄링**: GitHub Actions cron
- **배포**: Cloudflare Workers 정적 자산 (`wrangler.jsonc`, 프론트엔드만 배포 대상)

## 폴더 구조

```
backend/            sync.py — API 수집 → 정적 스냅샷 생성 (전체 파이프라인)
  scripts/           probe_api.py 등 1회성 검증 스크립트
frontend/            정적 HTML/CSS/JS. 빌드 도구 없이 전역 네임스페이스 IIFE 패턴
  data/              AED 스냅샷 — 커밋 대상. sync.py가 생성
  icons/             PWA 아이콘 + make_icons.py (재생성용)
docs/                API_SPEC.md, DEVELOPMENT_PLAN.md, OFFLINE_DESIGN.md
.github/workflows/   sync-aed.yml (cron 스케줄 + 스냅샷 커밋)
```

### 프론트엔드 모듈

빌드 도구가 없으므로 각 파일은 전역 상수 하나를 노출하는 IIFE다. `index.html`의 `<script>` 순서가 곧 의존 순서다.

| 파일 | 역할 |
|---|---|
| `ui-util.js` | `UiUtil` — 두 뷰가 공유하는 이스케이프/상세 HTML/외부 지도 링크 |
| `geo.js` | `Geo` — 하버사인 거리, 방위각, 뷰포트/최근접 필터 |
| `data-store.js` | `DataStore` — IndexedDB. 전량을 **단일 레코드에 배열 통째로** 저장 |
| `sync-data.js` | `SyncData` — meta 비교 후 필요할 때만 스냅샷 다운로드 |
| `map-view.js` | `MapView` — 온라인 네이버 지도 |
| `offline-view.js` | `OfflineView` — Canvas 간이 지도 + 나침반 + 목록 |
| `app.js` | `App` — 부팅, 모드 전환, 위치, PWA |
| `sw.js` | 서비스워커 (앱 셸만 캐시. `/data/*`와 네이버 요청은 가로채지 않음) |

## 환경 변수

`.env.example` 참고. `.env`는 절대 커밋하지 않는다.

| 변수 | 용도 | 공개 여부 |
|---|---|---|
| `SAFETYDATA_API_KEY` | safetydata.go.kr 인증키. **GitHub Actions 시크릿은 이것 하나뿐이다** | 비공개 (백엔드 전용) |
| `NAVER_MAP_CLIENT_ID` | 네이버 지도 Client ID. Workers 빌드 변수로 주입해 `config.js` 생성 | 공개 가능 (네이버 콘솔 웹 서비스 URL 등록으로 보호) |
| `NAVER_MAP_AUTH_PARAM` | 인증 파라미터 이름. 선택, 기본 `ncpKeyId` (구 콘솔 키는 `ncpClientId`) | 공개 가능 |
| `ADMIN_TRIGGER_SECRET` | FastAPI 수동 트리거 보호용 | 비공개 |

## 로컬 실행

가상환경은 `backend/.venv`에 둔다 (루트가 아님).

```powershell
python -m venv backend/.venv
backend\.venv\Scripts\python.exe -m pip install -r requirements.txt
cp .env.example .env   # 값 채우기

backend\.venv\Scripts\python.exe backend\scripts\probe_api.py       # API 응답 구조 확인 (Phase 1)
backend\.venv\Scripts\python.exe backend\sync.py                   # 스냅샷 생성/갱신
```

`requirements.txt`에는 배치 실행에 실제로 필요한 것(httpx, python-dotenv)만 둔다. GitHub Actions cron이 이 목록만 설치하면 되도록 유지할 것. FastAPI 수동 트리거(`backend/main.py`)를 만지는 경우에만 `requirements-dev.txt`를 설치한다.

프론트엔드는 별도 빌드가 없지만 **`file://`로 열면 안 된다.** 서비스워커가 등록되지 않고 네이버 지도 리퍼러 검사도 실패한다. 반드시 HTTP로 서빙할 것:

```powershell
sh frontend/build-config.sh                      # config.js 생성 (NAVER_MAP_CLIENT_ID 필요)
cd frontend; python -m http.server 8000          # http://127.0.0.1:8000
```

`frontend/data/`는 커밋되어 있으므로 clone 직후에도 그대로 동작한다. 최신 데이터가 필요할 때만 `sync.py`를 돌리면 된다.

## 배포

- **프론트엔드**: **Cloudflare Workers 정적 자산**. 설정은 루트 [`wrangler.jsonc`](wrangler.jsonc)에 있고 `assets.directory`가 `./frontend`를 가리킨다. 서버 코드가 없으므로 `main`(Worker 스크립트)을 두지 않는다. 대시보드 빌드 명령은 `sh frontend/build-config.sh`, 배포 명령은 `npx wrangler deploy`. 빌드 변수는 `NAVER_MAP_CLIENT_ID`(+선택 `NAVER_MAP_AUTH_PARAM`)만 필요하다. 빌드가 네트워크를 타지 않으므로 빠르고 실패 지점이 없다. 설정 상세는 [`frontend/README.md`](frontend/README.md) 참고.
- **배치 동기화**: 별도 호스팅 불필요. GitHub Actions 저장소 시크릿에 `SAFETYDATA_API_KEY` **하나만** 등록한다. cron이 `backend/sync.py`로 스냅샷을 만들고, 내용이 바뀌었으면 커밋·push한다. **push가 Workers 재배포를 자동으로 유발하므로 Deploy Hook은 필요 없다.**

## 주의사항

- **스냅샷의 정렬과 id는 결정적이어야 한다.** `sync.py`는 좌표 기반 자연키로 정렬하고 그 sha1에서 id를 만든다. 순번을 id로 쓰거나 정렬을 흔들면 행 하나만 추가돼도 파일 전체가 바뀌어, 매일 10MB짜리 커밋이 쌓이고 git이 delta를 잡지 못한다. 이 규칙을 깨지 말 것.
- `SN`(원본 일련번호)은 재발행 때마다 다른 AED에 재할당되므로 정렬·식별에 쓰지 않는다 (`docs/API_SPEC.md` 경고 참고).
- 네이버 지도 콘솔에 배포 도메인(`*.workers.dev` 및 커스텀 도메인)을 웹 서비스 URL로 등록해야 지도가 정상 동작한다. 미등록 시 앱은 오프라인 뷰(목록)로 폴백하고 원인을 안내한다.
- `frontend/_headers`의 `Referrer-Policy`를 `no-referrer`/`same-origin`으로 바꾸면 네이버 지도 인증이 깨진다. 건드리지 말 것.
- safetydata.go.kr API의 실제 요청/응답 필드는 `docs/API_SPEC.md`에 문서화되어 있다. 필드를 다루는 코드를 작성하기 전에 반드시 이 문서를 확인할 것.

### 오프라인 관련 (docs/OFFLINE_DESIGN.md 필독)

- **오프라인에서 지도 타일은 표시할 수 없다.** 네이버·구글·카카오 모두 웹 API는 온라인 전용이며 지도 회사를 바꿔도 해결되지 않는다. "오프라인 지도를 넣어달라"는 요청이 오면 이 제약부터 확인할 것.
- **어떤 실패도 앱을 잠그면 안 된다.** 전체 화면 오버레이(`fatal`)는 제거했다. 모든 실패는 오프라인 뷰로 흡수된다. 새 실패 경로를 만들 때 이 원칙을 지킬 것.
- **오프라인 뷰는 온라인에서도 '목록' 버튼으로 볼 수 있게 유지한다.** 오프라인 전용 코드는 평소에 실행되지 않으면 검증되지 않은 채 남아 정작 필요할 때 깨진다.
- 서비스워커는 `/data/*`(스냅샷)와 `oapi.map.naver.com`을 **일부러 가로채지 않는다.** 각각 IndexedDB 이중 저장과 약관 문제 때문이다.
- `frontend/data/`는 **커밋한다.** raw 10.8MB지만 `sync.py`가 내용이 바뀐 날에만 파일을 다시 쓰므로 매일 쌓이지 않는다. 데이터가 저장소에 있어야 push가 곧 배포가 된다.
- 이 프로젝트는 두 번 구조가 바뀌었다: React SPA(백엔드 없음) → Python 배치 + Supabase + 정적 프론트 → **현재의 Python 배치 + 커밋된 정적 스냅샷 + 정적 프론트**. 오래된 문서나 대화에서 Supabase 이야기가 나오면 이 맥락을 감안할 것.
