# frontend/

네이버 지도 위에 AED 위치를 표시하는 정적 프론트엔드. 빌드 도구 없이 파일만으로 동작한다.

| 파일 | 역할 |
|---|---|
| `index.html` | 마크업. 네이버 지도 스크립트는 `config.js`의 키가 필요하므로 `app.js`가 동적으로 삽입한다 |
| `app.js` | 지도 초기화, 뷰포트 조회, 마커/정보창, 내 위치 |
| `styles.css` | 스타일 |
| `config.example.js` | 설정 템플릿 (커밋됨) |
| `config.js` | 실제 설정 (**커밋 안 함** — `build-config.sh`가 생성) |
| `build-config.sh` | 환경변수로부터 `config.js`를 생성 |
| `_headers` | Cloudflare Pages 헤더 규칙 (보안 헤더 + 캐시 무효화) |

## 로컬 실행

```bash
# 저장소 루트에서
set -a && . ./.env && set +a
sh frontend/build-config.sh

cd frontend && python -m http.server 8000
# http://127.0.0.1:8000 접속
```

`file://`로 직접 열지 말고 반드시 HTTP로 서빙할 것. 네이버 지도는 리퍼러를 검사하므로
`file://`에서는 인증에 실패한다. 로컬 개발 시 네이버 콘솔 웹 서비스 URL에
`http://127.0.0.1:8000`을 등록해야 한다.

## 배포 (Cloudflare Pages)

Cloudflare 대시보드 → Workers & Pages → Create → Pages → Connect to Git에서
이 저장소를 연결한 뒤 아래와 같이 설정한다.

| 항목 | 값 |
|---|---|
| Framework preset | None |
| Build command | `sh frontend/build-config.sh` |
| Build output directory | `frontend` |
| Root directory | (비움 — 저장소 루트) |

**환경변수** (Settings → Environment variables, Production/Preview 모두):

| 이름 | 비고 |
|---|---|
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | RLS로 SELECT만 허용되므로 공개되어도 안전 |
| `NAVER_MAP_CLIENT_ID` | |
| `NAVER_MAP_AUTH_PARAM` | 선택. 기본 `ncpKeyId`, 구 콘솔 키는 `ncpClientId` |

셋 중 하나라도 없으면 `build-config.sh`가 exit 1로 빌드를 실패시킨다.
설정이 빠진 채 배포되는 일은 없다.

배포 후 **네이버 클라우드 콘솔에 배포 도메인(`*.pages.dev` 및 커스텀 도메인)을
웹 서비스 URL로 등록**해야 지도가 뜬다. 미등록 시 인증 실패 안내 화면이 표시된다.

`_headers`는 빌드 출력 디렉토리(`frontend/`) 안에 있어야 적용된다.
`Referrer-Policy`를 `no-referrer`/`same-origin`으로 바꾸면 네이버 지도 인증이
깨지므로 건드리지 말 것.

## 설계 메모

**뷰포트 조회와 1000건 상한** — PostgREST는 요청당 기본 1000행까지만 반환하며 초과분은
경고 없이 잘린다. 전국 범위를 요청하면 62,000건 중 정확히 1,000건만 온다(실측).
그래서 `app.js`는 항상 `limit`(500)과 정확한 `count`를 함께 요청하고,
`count > 반환량`이면 "N개 중 500개만 표시" 배너를 띄운다. 조용히 잘리는 일은 없다.

**넓은 뷰포트 차단** — 위도 스팬이 `MAX_QUERY_SPAN_DEG`(0.15도, 약 16km)를 넘으면
조회하지 않고 "확대하세요"만 안내한다. 서울 도심은 ±0.05도 범위에 AED가 2,545개라
마커를 찍어도 의미가 없기 때문이다.

지역별 실측 밀도 (뷰포트 반경 기준):

| 반경 | 서울시청 | 강남역 | 부산 서면 | 제주시청 | 강원 정선 |
|---|---|---|---|---|---|
| ±0.005도 (~1km) | 133 | 79 | 18 | 8 | 7 |
| ±0.02도 (~4km) | 752 | 560 | 229 | 106 | 20 |
| ±0.05도 (~11km) | 2,545 | 1,811 | 894 | 322 | 21 |

향후 마커 클러스터링을 도입하면 넓은 뷰포트도 의미 있게 보여줄 수 있다(계획서 Phase 7).

**네이버 인증 파라미터** — 신규 콘솔 키는 `ncpKeyId`, 구 콘솔 키는 `ncpClientId`를 쓴다.
`config.js`의 `NAVER_MAP_AUTH_PARAM`으로 바꿀 수 있고, 인증 실패 시 안내 화면이 뜬다.

자세한 아키텍처는 루트 [`CLAUDE.md`](../CLAUDE.md), 단계별 계획은
[`docs/DEVELOPMENT_PLAN.md`](../docs/DEVELOPMENT_PLAN.md) 참고.
