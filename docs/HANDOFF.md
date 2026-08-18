# 이어서 할 일 (인수인계)

다른 PC에서 작업을 이어받기 위한 문서. 마지막 갱신: 2026-08-18

**현재 상태**: 오프라인 지원(Phase 8) 구현 완료, `main`에 푸시됨(`5e2af0c`).
**남은 것**: 코드가 아니라 **대시보드 설정과 실기기 검증**이 대부분이다.

> 아래 체크박스 중 이미 해두신 게 있으면 그대로 체크하고 넘어가면 된다.
> [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md)의 체크박스 기준으로 옮겨온 것이라
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

`.env`에 채워야 하는 값과 발급처:

| 변수 | 어디서 얻나 | 없으면 |
|---|---|---|
| `SAFETYDATA_API_KEY` | safetydata.go.kr 마이페이지 → 인증키 | `sync.py` 실행 불가 |
| `SUPABASE_URL` | Supabase 대시보드 → Settings → API | 전부 불가 |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 화면. **절대 공개 금지** | `sync.py` 쓰기 불가 |
| `SUPABASE_ANON_KEY` | 같은 화면 | 스냅샷 생성 불가 |
| `NAVER_MAP_CLIENT_ID` | 네이버 클라우드 콘솔 → Maps | 지도 표시 불가 (목록은 동작) |
| `NAVER_MAP_AUTH_PARAM` | 선택. 기본 `ncpKeyId`, 구 콘솔 키면 `ncpClientId` | 기본값 사용 |

`CLOUDFLARE_DEPLOY_HOOK_URL`은 GitHub Actions 시크릿 전용이라 로컬 `.env`에는 필요 없다.

로컬 실행:

```bash
set -a && . ./.env && set +a          # Windows PowerShell이면 각 변수를 $env:로 설정
sh frontend/build-config.sh                        # config.js 생성
python backend/scripts/build_snapshot.py           # data/ 생성 (Supabase 조회)
cd frontend && python -m http.server 8000          # http://127.0.0.1:8000
```

> **`file://`로 열지 말 것.** 서비스워커가 등록되지 않아 오프라인 기능이 아예 동작하지 않고,
> 네이버 지도도 리퍼러 검사에 걸린다.
>
> Supabase 프리티어는 **7일 미사용 시 자동 일시중지**된다. `build_snapshot.py`가 DNS 오류로
> 실패하면 대시보드에서 프로젝트 상태부터 확인할 것.

---

## 1. 최우선 — 배포가 실제로 동작하게 만들기

**지금 배포본은 오프라인 기능이 꺼져 있다.** 코드는 올라갔지만 Cloudflare Pages의
빌드 명령이 아직 예전 것이라 `data/aed-snapshot.json`이 생성되지 않고,
그러면 앱이 데이터를 받지 못해 목록이 빈 채로 뜬다.

### 1-1. Pages 빌드 명령 변경

Cloudflare → Workers & Pages → 프로젝트 → Settings → Builds & deployments

```
sh frontend/build-config.sh && python3 backend/scripts/build_snapshot.py
```

- [ ] 빌드 명령 변경
- [ ] 출력 디렉토리가 `frontend`인지 확인
- [ ] Root directory는 비워둘 것 (저장소 루트)

> **미검증 사항**: Cloudflare Pages 빌드 이미지에 `python3`가 있다고 보고 작성했지만
> 실제로 확인하지 못했다. 빌드 로그에 `python3: command not found`가 뜨면
> `python`으로 바꿔보고, 그래도 없으면 `build_snapshot.py`를 Node로 다시 써야 한다
> (stdlib만 쓰므로 포팅은 어렵지 않다).

### 1-2. Pages 환경변수 추가

Settings → Environment variables (Production/Preview 모두)

- [ ] `SUPABASE_URL` — 스냅샷 생성용 (신규)
- [ ] `SUPABASE_ANON_KEY` — 스냅샷 생성용 (신규)
- [ ] `NAVER_MAP_CLIENT_ID` — config.js 생성용 (기존)
- [ ] `NAVER_MAP_AUTH_PARAM` — 선택

> `SUPABASE_ANON_KEY`는 이제 **빌드 시점에만** 쓰인다. `config.js`에는 더 이상
> 들어가지 않으므로 브라우저에 노출되지 않는다.

**여기까지 하고 재배포하면 오프라인 기능이 살아난다.**

### 1-3. 매일 자동 갱신 연결

- [ ] Pages → Settings → Deploy hooks에서 훅 생성 (브랜치 `main`)
- [ ] 생성된 URL을 GitHub → Settings → Secrets → Actions에
      `CLOUDFLARE_DEPLOY_HOOK_URL`로 등록

이걸 해야 매일 새벽 ETL이 끝난 뒤 Pages가 재빌드되어 스냅샷이 갱신된다.
안 하면 스냅샷이 마지막 커밋 시점에 멈춘다.

### 1-4. 네이버 콘솔 도메인 등록

- [ ] 네이버 클라우드 콘솔 → Maps → 웹 서비스 URL에 `*.pages.dev`(및 커스텀 도메인) 등록
- [ ] 로컬 개발용으로 `http://127.0.0.1:8000`도 등록

미등록이면 지도가 안 뜨지만 앱이 죽지는 않는다 — 목록 뷰로 폴백하고 원인을 안내한다.

---

## 2. GitHub Actions 배치 (Phase 4)

- [ ] 저장소 시크릿 등록: `SAFETYDATA_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Actions 탭 → Sync AED data → **Run workflow**로 1회 수동 실행
- [ ] 로그에서 62,000행 적재 확인
- [ ] Deploy Hook 단계가 성공하는지 확인 (시크릿 없으면 "건너뜁니다" 출력 후 정상 종료)

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

## 4. 실측이 필요한 값

개발 중에는 합성 데이터(2,000~2,500건)로만 검증했다. **실데이터 62,000건 기준으로
아래를 확인해야 한다.**

- [ ] `python backend/scripts/build_snapshot.py` 실행 후 실제 파일 크기
      (예상 raw ~9MB / brotli 전송 2~3MB)
- [ ] 배포본에서 DevTools → Network로 실제 전송량 확인
- [ ] 첫 로딩 체감 속도 — 모바일 LTE에서 몇 초 걸리는지
- [ ] IndexedDB 저장/로드 시간 (DevTools → Application → Storage 사용량)

**너무 느리면**: `sido_name` 컬럼이 있으므로 시도별 17개 파일로 분할하는 게 다음 수순이다.
서울만 받으면 ~1.5MB로 줄어든다. 지금은 단일 파일로 시작했다.

---

## 5. QA (Phase 7)

- [ ] 배치 실행 로그 며칠간 모니터링
- [ ] API 다운/빈 응답 시 ETL이 기존 데이터를 지우지 않고 안전하게 실패하는지
      (`sync.py`에 안전장치가 있지만 실제로 겪어본 적은 없다)
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

지켜야 할 제약 세 가지:

1. **어떤 실패도 앱을 잠그면 안 된다.** 전체 화면 오버레이(`fatal`)는 제거했다.
   모든 실패는 오프라인 뷰로 흡수된다.
2. **오프라인 뷰는 온라인에서도 '목록' 버튼으로 볼 수 있게 유지한다.**
   평소에 실행되지 않는 코드는 검증되지 않은 채 남아 정작 필요할 때 깨진다.
3. **`build_snapshot.py`는 stdlib만 쓴다.** Cloudflare Pages 빌드에 pip 설치
   단계를 추가하지 않기 위해서다.

### 로컬 테스트 방법

자동화 테스트는 저장소에 없다(개발 중 임시로 작성해 검증만 하고 커밋하지 않았다).
수동 확인 절차는 [`../frontend/README.md`](../frontend/README.md)의 "오프라인 동작 확인" 절 참고.

핵심 회귀 시나리오 하나만 기억하면 된다:

> 온라인 접속 → 데이터 저장 확인 → DevTools Network를 **Offline**으로 → 새로고침
> → **백지나 전체 화면 오류 없이 간이 지도 + 목록이 떠야 한다.**

이게 원래 깨져 있던 동작이라 무엇을 바꾸든 이것만은 확인할 것.
