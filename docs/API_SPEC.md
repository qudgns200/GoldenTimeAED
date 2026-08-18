# API 명세서

## 1. 외부 API — safetydata.go.kr AED 위치정보

- **출처**: [https://www.safetydata.go.kr/disaster-data/view?dataSn=59](https://www.safetydata.go.kr/disaster-data/view?dataSn=59)
- **제공기관**: 행정안전부 (재난안전데이터공유플랫폼)
- **데이터 형식**: Open API (JSON/XML) 또는 파일 다운로드(최대 100건 제한 — API 사용 권장)
- **인증 방식**: 서비스 인증키(`serviceKey`)를 쿼리 파라미터로 전달 (플랫폼 마이페이지에서 활용신청 후 발급)
- **라이선스**: 공공기관 제공 데이터는 KOGL 제1유형 또는 제3유형 (페이지 하단 라이선스 표기 확인 필요)

### 엔드포인트

```
GET https://www.safetydata.go.kr/V2/api/DSSP-IF-00068
```

### 요청 파라미터 (검증 완료)

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `serviceKey` | string | Y | 발급받은 인증키 |
| `pageNo` | int | N | 페이지 번호 (기본 1) |
| `numOfRows` | int | N | 페이지당 행 수 |
| `returnType` | string | N | `json` 또는 `xml` |

### 응답 필드 (검증 완료 — `docs/sample_response.json` 기준)

| 필드명 | 타입 | 설명 |
|---|---|---|
| `SN` | int | 일련번호 — **스냅샷 내에서만 고유. 영속 식별자가 아니다** (아래 경고 참조) |
| `MKR_NM` | string | 제조사명 |
| `MDL_NM` | string | 모델명 |
| `MNG_INST_NM` | string | 관리기관명 |
| `MNGR_NM` | string | 관리자명 (일부 마스킹) |
| `MNGR_TELNO` | string | 관리자 전화번호 (일부 마스킹, 예: `02-******`) |
| `CTPV_NM` | string | 시도명 |
| `SE` | string | 시군구명 |
| `ADDR` | string | 도로명주소(전체) |
| `INSTL_ADDR` | string | 설치 도로명주소(시/도·구 생략된 축약형) |
| `INSTL_PSTN` | string | 설치위치 상세 (예: "529동", "경로당 내") |
| `LAT` | number | 위도 |
| `LOT` | number | 경도 (필드명은 LOT이지만 값은 경도) |
| `XMAP_CRTS` | number | TM좌표계 X |
| `YMAP_CRTS` | number | TM좌표계 Y |
| `ZIP_1` | string | 우편번호 앞 3자리 |
| `ZIP_2` | string | 우편번호 뒤 3자리 |

> ⚠️ 원래 예상했던 "설치일자", "데이터기준일자", "지번주소" 필드는 실제 응답에 존재하지 않는다. `supabase/schema.sql`에서 해당 컬럼을 제외했다.

### ⚠️ `SN`은 영속적인 AED 식별자가 아니다 (2026-08 검증)

원본이 재발행되면 `SN`이 다른 AED에 재할당된다. 실제로 확인한 사례:

| `SN` | 2026-07 캡처 | 2026-08 재확인 |
|---|---|---|
| 10152 | 잠실주공5단지 (송파구) | 옥수파크힐스아파트 (성동구) |
| 10153 | 성현동아아파트1단지경로당 (관악구) | 국립재활원 (강북구) |

- 한 스냅샷 안에서는 고유하다 (5,000건 표본에서 중복 0건).
- 같은 시점에 여러 번 호출하면 순서·값이 동일하다.
- 그러나 **재발행 시점을 넘으면 동일한 `SN`이 다른 AED를 가리킨다.** 사실상 스냅샷 내 행 번호에 가깝다.

**영향**: `source_id` 기준 upsert만으로는 원본에서 사라진 AED가 DB에 영구히 남는다.
`backend/sync.py`는 이를 막기 위해 모든 행에 동일한 `synced_at`을 찍고, 수집 완전성 검증을
통과한 뒤 `synced_at`이 이번 실행보다 오래된 행을 삭제한다(mark & sweep).

### 요청/응답 예제

`pageNo=1, numOfRows=5`로 호출한 실제 응답(개인정보 마스킹은 API 원본 그대로):

```json
{
  "header": { "resultMsg": "NORMAL SERVICE", "resultCode": "00", "errorMsg": null },
  "numOfRows": 5,
  "pageNo": 1,
  "totalCount": 62000,
  "body": [
    {
      "ZIP_2": "03", "ZIP_1": "055",
      "MKR_NM": "(주)나눔테크",
      "INSTL_ADDR": "송파대로 567 (잠실동, 잠실주공아파트)",
      "MDL_NM": "NT-381.O",
      "CTPV_NM": "서울특별시",
      "ADDR": "서울특별시 송파구 송파대로 567 (잠실동, 잠실주공아파트)",
      "LOT": 127.0930486801,
      "MNG_INST_NM": "잠실주공5단지",
      "SE": "송파구",
      "YMAP_CRTS": 4510875.04039,
      "MNGR_TELNO": "02-******",
      "XMAP_CRTS": 14147933.46243,
      "SN": 10152,
      "MNGR_NM": "김**",
      "INSTL_PSTN": "529동",
      "LAT": 37.5131381759
    }
  ]
}
```

전체 응답 원본은 `docs/sample_response.json` 참고 (커밋 대상 아님, 개인 참고용).

### 에러 코드

- `header.resultCode`가 `"00"`이 아니면 오류. `resultMsg`/`errorMsg`에 상세 메시지 포함.
- 잘못된 `serviceKey` 등 인증 오류/요청 한도 초과 케이스는 아직 실제로 재현/기록하지 않았음 — Phase 3(ETL 스크립트) 작성 시 재시도/에러 핸들링 구현하며 함께 확인할 것.

---

## 2. 내부 데이터 모델 — 정적 스냅샷

데이터베이스는 없다. `backend/sync.py`가 위 API 응답을 변환해
`frontend/data/aed-snapshot.json`으로 쓰고, 이 파일이 저장소에 커밋된다.

키 이름을 매 행마다 반복하지 않는 배열 포맷이라 객체 배열보다 약 40% 작다.
컬럼 순서는 파일의 `fields`가 선언하며, `frontend/sync-data.js`가 그 순서를 읽어 쓴다
(하드코딩하지 않으므로 컬럼이 추가·재배치되어도 조용히 어긋나지 않는다).

```json
{
  "generated_at": "2026-08-18T14:35:57+00:00",
  "count": 61717,
  "fields": ["id", "org_name", "install_place", "address_road", "lat", "lng", "phone"],
  "rows": [[86302289748278, "제주보건소", "1층 로비", "제주특별자치도 …", 33.11653, 126.26719, "064*******"]]
}
```

| 필드 | 원본 | 비고 |
|---|---|---|
| `id` | (파생) | 자연키 `lat\|lng\|org_name\|install_place`의 sha1 앞 12자리를 정수로. **원본 `SN`을 쓰지 않는다** |
| `org_name` | `MNG_INST_NM` | 관리기관명 |
| `install_place` | `INSTL_PSTN` | 설치위치 상세 |
| `address_road` | `ADDR` | 도로명주소 전체 |
| `lat` / `lng` | `LAT` / `LOT` | 소수점 5자리(약 1.1m)로 반올림 |
| `phone` | `MNGR_TELNO` | 일부 마스킹된 원본 그대로 |

`MNGR_NM`·`MKR_NM`·`MDL_NM`·`CTPV_NM`·`SE`는 화면에서 쓰지 않아 스냅샷에 넣지 않는다.
좌표가 없는 행은 지도에도 거리순 목록에도 올릴 수 없으므로 제외한다.
자연키가 같은 행은 중복으로 보고 하나만 남긴다(실측 283건).

`aed-meta.json`은 `generated_at`과 `count`만 담은 수백 바이트 파일로, 앱이 이것만 먼저 받아
갱신 여부를 판단한다.

### id를 원본 `SN`으로 만들지 않는 이유

위 경고대로 `SN`은 재발행 때마다 재할당된다. 또한 **정렬과 id가 결정적이어야**
내용이 같은 날 파일이 바이트 단위로 동일해지고, 그래야 불필요한 커밋과 재배포가 없다.
순번을 id로 쓰면 행 하나만 추가돼도 이후 전체가 밀려 파일 전체가 바뀐다.

---

## 3. 프론트엔드 조회 방식

프론트엔드는 어떤 API도 조회하지 않는다. 같은 도메인의 정적 파일만 읽는다.

1. `data/aed-meta.json`(수백 바이트)을 먼저 받아 저장본의 `generated_at`과 비교
2. 다르면 `data/aed-snapshot.json`(raw 10.8MB / 전송 2.4MB)을 받아 IndexedDB에 저장
3. 이후 온라인·오프라인 상관없이 저장본에서 읽음

구현은 `frontend/sync-data.js`(다운로드 판단)와 `frontend/data-store.js`(IndexedDB)에 있다.
설계 근거는 [`OFFLINE_DESIGN.md`](OFFLINE_DESIGN.md) 참고.

## 4. 참고 링크

- [safetydata.go.kr AED 데이터셋](https://www.safetydata.go.kr/disaster-data/view?dataSn=59)
- [네이버 지도 JS API v3 문서](https://navermaps.github.io/maps.js.ncp/)
