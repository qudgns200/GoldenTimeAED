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

## 2. 내부 데이터 모델 — Supabase `aed_locations`

정의: `supabase/schema.sql`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | bigint (PK) | 내부 자동 증가 ID |
| `source_id` | text (unique) | 원본 `SN`(일련번호) |
| `org_name` | text | 원본 `MNG_INST_NM` (관리기관명) |
| `install_place` | text | 원본 `INSTL_PSTN` (설치위치 상세) |
| `address_road` | text | 원본 `ADDR` (도로명주소 전체) |
| `latitude` | double precision | 원본 `LAT` |
| `longitude` | double precision | 원본 `LOT` |
| `phone` | text | 원본 `MNGR_TELNO` (일부 마스킹) |
| `manager_name` | text | 원본 `MNGR_NM` (일부 마스킹) |
| `maker_name` | text | 원본 `MKR_NM` (제조사명) |
| `model_name` | text | 원본 `MDL_NM` (모델명) |
| `sido_name` | text | 원본 `CTPV_NM` (시도명) |
| `sigungu_name` | text | 원본 `SE` (시군구명) |
| `synced_at` | timestamptz | 마지막 동기화 시각 |

**RLS 정책**: `anon`/`authenticated` 역할은 SELECT만 허용. INSERT/UPDATE/UPSERT는 `service_role`(백엔드 ETL)만 가능 — RLS를 우회하므로 별도 정책 불필요.

---

## 3. 프론트엔드 조회 방식

정적 프론트엔드는 백엔드 API를 거치지 않고 Supabase JS client로 직접 조회한다.

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function loadAEDInBounds(swLat, swLng, neLat, neLng) {
    const { data, error } = await supabase
      .from('aed_locations')
      .select('id, org_name, install_place, latitude, longitude, phone')
      .gte('latitude', swLat).lte('latitude', neLat)
      .gte('longitude', swLng).lte('longitude', neLng);

    if (error) throw error;
    return data; // 네이버 지도 마커 렌더링에 사용
  }
</script>
```

지도 이동/줌 변경(`bounds_changed`) 이벤트마다 현재 뷰포트 범위로 위 쿼리를 다시 호출해 마커를 갱신하는 방식을 권장한다.

## 4. 참고 링크

- [safetydata.go.kr AED 데이터셋](https://www.safetydata.go.kr/disaster-data/view?dataSn=59)
- [네이버 지도 JS API v3 문서](https://navermaps.github.io/maps.js.ncp/)
- [Supabase JS client 문서](https://supabase.com/docs/reference/javascript/introduction)
