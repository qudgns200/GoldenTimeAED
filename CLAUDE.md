# CLAUDE.md

이 파일은 Claude Code(및 협업하는 개발자)가 GoldenTimeAED 프로젝트에서 작업할 때 참고하는 가이드다.

## 프로젝트 개요

자동심장충격기(AED) 위치를 네이버 지도 위에 표시하는 웹앱. 공공데이터포털(safetydata.go.kr)의 AED 위치 데이터를 매일 배치로 수집해 Supabase에 저장하고, 정적 프론트엔드가 이를 조회해 지도에 표시한다.

## 아키텍처

```
[GitHub Actions cron, 매일 01~02시 KST]
        │  python backend/sync.py 직접 실행
        ▼
[safetydata.go.kr AED API] ──fetch──▶ [Python ETL] ──upsert──▶ [Supabase (Postgres)]
                                                                        │
                                                          anon key + RLS(SELECT only)
                                                                        ▼
                                          [정적 프론트엔드: HTML + 네이버 지도 JS API]
                                          (Vercel 또는 Cloudflare Pages 배포)
```

**왜 상시 서버가 아닌가:** 데이터는 하루 1회만 갱신되면 충분하고, 프론트엔드는 Supabase에 직접 쿼리하면 되므로 상시 구동되는 API 서버가 필요 없다. 스케줄링은 무료·안정적인 GitHub Actions cron으로 처리하고, FastAPI는 로컬 테스트/수동 트리거용 얇은 래퍼로만 존재한다. 반드시 배포해야 하는 서버가 아니다.

## 기술 스택

- **백엔드**: Python, FastAPI(수동 트리거용), httpx(API 호출), supabase-py(DB 클라이언트)
- **데이터베이스**: Supabase (Postgres + RLS)
- **프론트엔드**: 순수 HTML/CSS/JS, 네이버 지도 JS API v3, `@supabase/supabase-js`(CDN)
- **스케줄링**: GitHub Actions cron
- **배포**: Vercel 또는 Cloudflare Pages (프론트엔드만 배포 대상)

## 폴더 구조

```
backend/            Python ETL(sync.py) + FastAPI(main.py, 수동 트리거)
  scripts/           probe_api.py 등 1회성 검증 스크립트
frontend/            정적 HTML/CSS/JS (네이버 지도 + Supabase 조회)
supabase/            schema.sql (테이블/RLS 정의)
docs/                API_SPEC.md, DEVELOPMENT_PLAN.md
.github/workflows/   sync-aed.yml (cron 스케줄)
```

## 환경 변수

`.env.example` 참고. `.env`는 절대 커밋하지 않는다.

| 변수 | 용도 | 공개 여부 |
|---|---|---|
| `SAFETYDATA_API_KEY` | safetydata.go.kr 인증키 | 비공개 (백엔드 전용) |
| `SUPABASE_URL` | Supabase 프로젝트 URL | 공개 가능 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 쓰기 권한 키 | **절대 비공개** — RLS 우회 권한 |
| `SUPABASE_ANON_KEY` | Supabase 읽기 전용 키 | 공개 가능 (RLS로 보호됨) |
| `NAVER_MAP_CLIENT_ID` | 네이버 지도 Client ID | 공개 가능 (네이버 콘솔 리퍼러 화이트리스트로 보호) |
| `ADMIN_TRIGGER_SECRET` | FastAPI 수동 트리거 보호용 | 비공개 |

## 로컬 실행

```bash
pip install -r requirements.txt
cp .env.example .env   # 값 채우기
python backend/scripts/probe_api.py   # API 응답 구조 확인 (Phase 1)
python backend/sync.py                # 수동 동기화 실행
```

프론트엔드는 별도 빌드 없이 정적 파일이므로 `frontend/index.html`을 브라우저로 열거나 간단한 정적 서버로 서빙하면 된다.

## 배포

- **프론트엔드**: `frontend/` 디렉토리를 Vercel 또는 Cloudflare Pages에 정적 사이트로 배포. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NAVER_MAP_CLIENT_ID`를 빌드 시점 또는 런타임에 주입.
- **배치 동기화**: 별도 호스팅 불필요. GitHub Actions 저장소 시크릿에 `SAFETYDATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 등록하고 cron이 `backend/sync.py`를 직접 실행.

## 주의사항

- `SUPABASE_SERVICE_ROLE_KEY`는 RLS를 우회하는 키이므로 프론트엔드나 공개 저장소에 절대 노출하지 않는다. GitHub Actions 시크릿에만 저장한다.
- Supabase `aed_locations` 테이블은 RLS를 활성화하고, `anon` 키는 SELECT만 허용한다 (`supabase/schema.sql` 참고).
- 네이버 지도 콘솔에 배포 도메인(Vercel/Cloudflare 도메인)을 리퍼러 화이트리스트로 등록해야 지도가 정상 동작한다.
- safetydata.go.kr API의 실제 요청/응답 필드는 `docs/API_SPEC.md`에 문서화되어 있으며, 실제 라이브 호출로 검증되기 전까지는 placeholder임을 표시해둔다. 필드를 다루는 코드를 작성하기 전에 반드시 이 문서를 확인할 것.
- 이 프로젝트 이전 버전(React SPA, 백엔드 없음)에 대한 논의가 있었으나, 현재는 Python 배치 + Supabase + 정적 프론트 구조로 대체되었다.
