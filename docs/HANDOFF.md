# 이어서 할 일 (인수인계)

다른 PC에서 작업을 이어받기 위한 문서. 마지막 갱신: 2026-08-18

**현재 상태**: 오프라인 지원(Phase 8)에 이어 **Supabase 제거(Phase 9)까지 완료**.
이제 데이터베이스가 없다. API에서 받아 바로 정적 스냅샷을 만들어 저장소에 커밋한다.

**남은 것**: 코드가 아니라 **대시보드 설정 한 줄과 실기기 검증**이다.

> 아래 체크박스 중 이미 해두신 게 있으면 그대로 체크하고 넘어가면 된다.
> 실제 콘솔 상태와 다를 수 있다.

---

## 0. 새 PC 환경 셋업

```bash
git clone https://github.com/qudgns200/GoldenTimeAED.git
cd GoldenTimeAED

python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# source backend/.venv/bin/activate && pip install -r requirements.txt  # macOS/Linux

cp .env.example .env   # 아래 표를 보고 값 채우기
```

`.env`에 채워야 하는 값은 두 개뿐이다:

| 변수 | 어디서 얻나 | 없으면 |
|---|---|---|
| `SAFETYDATA_API_KEY` | safetydata.go.kr 마이페이지 → 인증키 | `sync.py` 실행 불가 (스냅샷은 커밋되어 있으니 앱은 동작) |
| `NAVER_MAP_CLIENT_ID` | 네이버 클라우드 콘솔 → Maps | 지도 표시 불가 (목록은 동작) |
| `NAVER_MAP_AUTH_PARAM` | 선택. 기본 `ncpKeyId`, 구 콘솔 키면 `ncpClientId` | 기본값 사용 |

로컬 실행:

```bash
set -a && . ./.env && set +a          # Windows PowerShell이면 각 변수를 $env:로 설정
sh frontend/build-config.sh           # config.js 생성
cd frontend && python -m http.server 8000          # http://127.0.0.1:8000
```

**AED 데이터는 이미 저장소에 있다** (`frontend/data/`). clone 직후 바로 동작하며,
최신 데이터가 필요할 때만 `python backend/sync.py`를 돌리면 된다.

> **`file://`로 열지 말 것.** 서비스워커가 등록되지 않아 오프라인 기능이 아예 동작하지 않고,
> 네이버 지도도 리퍼러 검사에 걸린다.

---

## 1. 최우선 — Workers 빌드 설정 고치기

배포는 **Pages가 아니라 Workers 정적 자산**으로 한다(이미 그렇게 연결되어 있다).
대시보드 기본값이 아직 React 템플릿 기준(`npm run build`)이라 그대로 두면 **빌드가 실패한다** —
`main`에는 `package.json`이 없다.

Cloudflare → Workers & Pages → 프로젝트 → Settings → Build:

| 항목 | 값 |
|---|---|
| Build command | `sh frontend/build-config.sh` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

- [ ] 위 세 값으로 변경 (Version command는 비우거나 그대로 둬도 무방)
- [ ] **`wrangler.jsonc`의 `name`이 대시보드의 Worker 이름과 같은지 확인.**
      다르면 `wrangler deploy`가 다른 이름의 Worker를 새로 만든다. 현재 값은 `goldentimeaed`
- [ ] 빌드 변수(Settings → Build → Variables)에 `NAVER_MAP_CLIENT_ID` 등록

정적 자산 설정은 저장소의 [`wrangler.jsonc`](../wrangler.jsonc)에 있다 —
`assets.directory`가 `./frontend`를 가리키고, 서버 코드가 없으므로 `main`이 없다.
빌드가 네트워크를 타지 않아 빠르고 실패 지점이 없다.

> 저장소에 `cloudflare/workers-autoconfig` 브랜치가 있는데, 이건 **예전 React SPA 버전**
> (Vite + 카카오맵)이라 현재 `main`과 무관하다. 배포 브랜치가 `main`인지 확인할 것.

### 1-2. 네이버 콘솔 도메인 등록

- [ ] 네이버 클라우드 콘솔 → Maps → 웹 서비스 URL에 `*.workers.dev`(및 커스텀 도메인) 등록
- [ ] 로컬 개발용으로 `http://127.0.0.1:8000`도 등록

미등록이면 지도가 안 뜨지만 앱이 죽지는 않는다 — 목록 뷰로 폴백하고 원인을 안내한다.

### 1-3. 정리 (선택)

- [ ] GitHub 시크릿에서 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDFLARE_DEPLOY_HOOK_URL` 제거
      — 워크플로가 더 이상 참조하지 않는다. 남은 필수 시크릿은 `SAFETYDATA_API_KEY` 하나
- [ ] Cloudflare의 Deploy hook 삭제 (push가 재배포를 유발하므로 불필요)
- [ ] Supabase 프로젝트는 **당분간 지우지 말 것** — 되돌릴 일이 생기면 스키마를 다시 만들지 않아도 된다

---

## 2. GitHub Actions 배치

- [x] 저장소 시크릿 `SAFETYDATA_API_KEY` 등록 (8/14 워크플로가 실제로 성공한 것으로 확인)
- [ ] Actions 탭 → Sync AED data → **Run workflow**로 1회 수동 실행
- [ ] 로그에서 62,000건 수집 확인
- [ ] 스냅샷이 바뀌었으면 커밋이 생기고 Workers가 재배포되는지 확인
      (변경이 없으면 "스냅샷 변경 없음 — 커밋하지 않습니다" 출력 후 정상 종료)

워크플로에는 커밋 권한(`permissions: contents: write`)이 있어야 한다. 이미 설정되어 있다.

---

## 3. 실기기 검증 (헤드리스로는 불가능)

브라우저 자동화로는 확인할 수 없어 남겨둔 항목들이다. **휴대폰이 필요하다.**

- [ ] **나침반** — 간이 지도에서 "나침반 켜기" → 폰을 돌리면 지도가 회전하는지
      - iOS는 권한 팝업이 뜬다. **거부해도 북쪽 고정으로 정상 동작해야 한다**
      - 안드로이드는 권한 없이 바로 동작
- [ ] **오프라인 실동작** — 온라인으로 1회 접속 → 비행기 모드 → 앱 실행
      → 간이 지도 + 목록이 뜨고 거리/방위가 맞는지
- [ ] **iOS 홈 화면 설치** — 공유 → 홈 화면에 추가 → 비행기 모드에서 아이콘으로 실행
- [ ] **안드로이드 설치 배너** — `beforeinstallprompt`로 "설치" 버튼이 뜨는지
- [ ] 모바일 반응형 (Phase 7)

> iOS Safari는 7일 미방문 시 서비스워커/IndexedDB를 지운다(홈 화면 설치 시 예외).
> 며칠 뒤 다시 열어보면 이 동작을 실제로 확인할 수 있다.

---

## 4. 실측된 값 (2026-08-18)

로컬에서 실데이터로 확인한 값들이다.

| 항목 | 값 |
|---|---|
| 수집 건수 | 62,000건 → 중복 283건 제거 → **61,717건** |
| 스냅샷 크기 | raw **10.8MB** / gzip 2.4MB |
| `aed-meta.json` | 58 bytes |
| `sync.py` 소요 | 13.4초 |
| 재실행 시 | 파일 변경 없음 (mtime·sha256 동일) |

아직 확인 못 한 것:

- [ ] 배포본에서 DevTools → Network로 실제 전송량 (brotli 적용 후)
- [ ] 첫 로딩 체감 속도 — 모바일 LTE에서 몇 초 걸리는지
- [ ] IndexedDB 저장/로드 시간

**너무 느리면**: 원본에 `CTPV_NM`(시도명)이 있으므로 시도별 17개 파일로 분할하는 게 다음 수순이다.
서울만 받으면 ~1.5MB로 줄어든다. 지금은 단일 파일로 시작했다.

---

## 5. QA (Phase 7)

- [ ] 배치 실행 로그 며칠간 모니터링
- [ ] API 다운/빈 응답 시 `sync.py`가 스냅샷을 덮어쓰지 않고 안전하게 실패하는지
      (안전장치는 있지만 실제로 겪어본 적은 없다)
- [ ] **git 저장소 크기 추이** — 데이터가 매일 바뀐다면 커밋이 매일 쌓인다.
      몇 주 지켜보고 과하면 gzip 커밋이나 wrangler 직접 업로드로 선회
- [ ] 지도 초기 로딩 속도, 대량 마커 시 성능

---

## 6. 다음에 해볼 만한 것 (선택)

우선순위 순:

1. **마커 클러스터링** — 전량이 메모리에 올라와 있어 구현이 쉬워졌다.
   현재는 뷰포트당 400개 상한으로 자르고 있는데, 클러스터링하면 넓은 화면도
   의미 있게 보여줄 수 있다.
2. **시도별 스냅샷 분할** — 위 4번에서 느리다고 판단되면.
3. **오프라인 실지도** — MapLibre GL JS + PMTiles 자체 호스팅.
   한국 전역 타일이 수백 MB라 R2 등 별도 스토리지가 필요하고 지도 스택을
   전면 교체해야 한다. 범위가 크니 신중히.

---

## 참고: 코드를 건드리기 전에

- [`OFFLINE_DESIGN.md`](OFFLINE_DESIGN.md) — **오프라인 관련 코드를 만지기 전 필독.**
  왜 오프라인 지도가 불가능한지, 다운로드가 왜 두 번 일어나는지가 여기 있다.
- [`../CLAUDE.md`](../CLAUDE.md) — 아키텍처, 환경변수, 지켜야 할 제약
- [`../frontend/README.md`](../frontend/README.md) — 프론트엔드 파일 구성

지켜야 할 제약 네 가지:

1. **어떤 실패도 앱을 잠그면 안 된다.** 전체 화면 오버레이(`fatal`)는 제거했다.
   모든 실패는 오프라인 뷰로 흡수된다.
2. **오프라인 뷰는 온라인에서도 '목록' 버튼으로 볼 수 있게 유지한다.**
   평소에 실행되지 않는 코드는 검증되지 않은 채 남아 정작 필요할 때 깨진다.
3. **스냅샷의 정렬과 id는 결정적이어야 한다.** 좌표 기반 자연키로 정렬하고 그 sha1에서
   id를 만든다. 순번을 id로 쓰거나 정렬을 흔들면 행 하나만 추가돼도 파일 전체가 바뀌어
   매일 10MB짜리 커밋이 쌓이고 git이 delta를 잡지 못한다.
4. **`sync.py`는 실패하면 파일을 쓰지 않는다.** 기존 스냅샷이 배포된 채 남아야
   사용자가 어제 데이터라도 계속 볼 수 있다.

### 로컬 테스트 방법

자동화 테스트는 저장소에 없다. 수동 확인 절차는
[`../frontend/README.md`](../frontend/README.md)의 "오프라인 동작 확인" 절 참고.

핵심 회귀 시나리오 두 개만 기억하면 된다:

> **① 오프라인** 온라인 접속 → 데이터 저장 확인 → DevTools Network를 **Offline**으로 →
> 새로고침 → **백지나 전체 화면 오류 없이 간이 지도 + 목록이 떠야 한다.**
>
> **② 멱등성** `python backend/sync.py`를 연속 두 번 실행 → 두 번째는
> "변경 없음"을 출력하고 `git status`가 깨끗해야 한다.
