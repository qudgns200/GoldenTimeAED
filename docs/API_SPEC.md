# API 명세서

## ⚠️ 문서 상태

이 문서의 "외부 API" 섹션 중 **요청 파라미터·응답 필드는 아직 실제 응답으로 검증되지 않은 placeholder**다. safetydata.go.kr의 상세 기술 문서(요청변수/응답필드/예제)는 로그인 후 활용신청을 완료해야 열람 가능해 자동으로 가져올 수 없었다. 사용자는 이미 인증키를 발급받은 상태이므로, **Phase 1에서 아래 절차대로 실제 호출 결과를 확인한 뒤 이 문서를 확정**해야 한다.

### 검증 절차 (Phase 1)

1. `backend/scripts/probe_api.py`(Phase 1에서 작성)로 실제 인증키를 사용해 API를 1회 호출한다.
2. 원본 응답을 `docs/sample_response.json`으로 저장한다 (`.gitignore`에 포함되어 있어 커밋되지 않음 — 개인 참고용).
3. 실제 필드명·타입을 확인해 아래 "요청 파라미터"·"응답 필드" 표와 `supabase/schema.sql`을 갱신한다.
4. 이 경고 섹션을 제거한다.

---

## 1. 외부 API — safetydata.go.kr AED 위치정보

- **출처**: [https://www.safetydata.go.kr/disaster-data/view?dataSn=59](https://www.safetydata.go.kr/disaster-data/view?dataSn=59)
- **제공기관**: 행정안전부 (재난안전데이터공유플랫폼)
- **데이터 형식**: Open API (JSON/XML) 또는 파일 다운로드(최대 100건 제한 — API 사용 권장)
- **인증 방식**: 서비스 인증키(`serviceKey`)를 쿼리 파라미터로 전달 (플랫폼 마이페이지에서 활용신청 후 발급)
- **라이선스**: 공공기관 제공 데이터는 KOGL 제1유형 또는 제3유형 (페이지 하단 라이선스 표기 확인 필요)

### 엔드포인트

> TBD — Phase 1에서 실제 요청 URL로 확정 (safetydata.go.kr 마이페이지의 "API 활용" 상세 화면에서 제공되는 Endpoint URL을 그대로 사용)

```
GET https://www.safetydata.go.kr/V2/api/{서비스ID}
```

### 요청 파라미터 (placeholder — 검증 필요)

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `serviceKey` | string | Y | 발급받은 인증키 |
| `pageNo` | int | N | 페이지 번호 (기본 1) |
| `numOfRows` | int | N | 페이지당 행 수 |
| `returnType` | string | N | `json` 또는 `xml` |

### 응답 필드 (placeholder — 검증 필요)

| 필드명(추정) | 타입 | 설명 |
|---|---|---|
| 관리번호 | string | 시설 고유 식별자 |
| 설치기관명 | string | AED 설치 기관/건물명 |
| 설치장소명 | string | 상세 설치 위치 |
| 도로명주소 | string | 도로명 주소 |
| 지번주소 | string | 지번 주소 |
| 위도 | number | latitude |
| 경도 | number | longitude |
| 관리기관명 | string | 관리 책임 기관 |
| 전화번호 | string | 관리 기관 연락처 |
| 설치일자 | date | 설치일 |
| 데이터기준일자 | date | 원본 데이터 갱신 기준일 |

### 요청/응답 예제

> TBD — `docs/sample_response.json` 확보 후 대표 예시 1건을 이 문서에 옮겨 적을 것

### 에러 코드

> TBD — 실제 호출 시 발생하는 오류 응답(잘못된 키, 요청 한도 초과 등) 확인 후 기록

---

## 2. 내부 데이터 모델 — Supabase `aed_locations`

정의: `supabase/schema.sql`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | bigint (PK) | 내부 자동 증가 ID |
| `source_id` | text (unique) | 원본 API의 고유 식별자 매핑 (필드명 확정 전 placeholder) |
| `org_name` | text | 설치기관명 |
| `install_place` | text | 설치장소명 |
| `address_road` | text | 도로명주소 |
| `address_jibun` | text | 지번주소 |
| `latitude` | double precision | 위도 |
| `longitude` | double precision | 경도 |
| `phone` | text | 연락처 |
| `manage_org` | text | 관리기관명 |
| `install_date` | date | 설치일자 |
| `floor_info` | text | 설치 위치 상세(층수 등) |
| `data_base_date` | date | 원본 데이터 기준일 |
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
