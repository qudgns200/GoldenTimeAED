# GoldenTimeAED

자동심장충격기(AED) 위치 안내 웹앱. **인터넷이 없어도 동작한다.**

심정지 대응이 필요한 곳(지하 주차장, 엘리베이터, 지하철역)일수록 네트워크가 약하다.
그래서 전국 AED 데이터를 미리 기기에 받아두고, 오프라인에서는 지도 대신
간이 지도와 거리순 목록으로 안내한다.

| 상태 | 화면 |
|---|---|
| 온라인 | 네이버 지도 + 마커 |
| 오프라인 | Canvas 간이 지도(거리 동심원 + 나침반) + 거리순 목록 |

## 구조

```
[GitHub Actions cron, 매일 01시 KST]
   safetydata.go.kr API → 정적 스냅샷(JSON) → 저장소에 커밋 → Cloudflare Pages
                                                              │
                                        사용자가 온라인으로 접속 시 1회 다운로드
                                                              ▼
                                                    기기 IndexedDB에 저장
                                                              │
                                                  이후 오프라인에서도 동작
```

상시 구동되는 API 서버도, 데이터베이스도 없다. 데이터는 하루 1회만 갱신되면 충분하고,
프론트엔드는 정적 파일과 기기에 저장된 데이터만으로 동작한다.
스냅샷이 저장소에 있으므로 push가 곧 배포이고, 필요한 시크릿은 `SAFETYDATA_API_KEY` 하나다.

## 문서

- [`docs/HANDOFF.md`](docs/HANDOFF.md) — **다음에 할 일.** 다른 PC에서 이어받을 때 여기부터
- [`CLAUDE.md`](CLAUDE.md) — 아키텍처, 환경변수, 로컬 실행, 주의사항
- [`docs/OFFLINE_DESIGN.md`](docs/OFFLINE_DESIGN.md) — 오프라인 설계. **오프라인 코드를 건드리기 전에 필독**
- [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md) — 단계별 진행 계획과 완료 기준
- [`docs/API_SPEC.md`](docs/API_SPEC.md) — safetydata.go.kr API 요청/응답 필드
- [`frontend/README.md`](frontend/README.md) — 프론트엔드 파일 구성과 배포 설정
