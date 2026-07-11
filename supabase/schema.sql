-- GoldenTimeAED: aed_locations 테이블
-- safetydata.go.kr AED API(DSSP-IF-00068) 실제 응답 필드 기준 (docs/API_SPEC.md 참조, 2026-07-12 검증)

create table if not exists aed_locations (
    id bigint generated always as identity primary key,
    source_id text unique,           -- 원본 SN (일련번호)
    org_name text,                   -- MNG_INST_NM: 관리기관명
    install_place text,              -- INSTL_PSTN: 설치위치 상세
    address_road text,               -- ADDR: 도로명주소(전체)
    latitude double precision,       -- LAT
    longitude double precision,      -- LOT
    phone text,                      -- MNGR_TELNO: 관리자 전화번호 (일부 마스킹됨)
    manager_name text,               -- MNGR_NM: 관리자명 (일부 마스킹됨)
    maker_name text,                 -- MKR_NM: 제조사명
    model_name text,                 -- MDL_NM: 모델명
    sido_name text,                  -- CTPV_NM: 시도명
    sigungu_name text,               -- SE: 시군구명
    synced_at timestamptz not null default now()
);

create index if not exists idx_aed_locations_lat_lng
    on aed_locations (latitude, longitude);

alter table aed_locations enable row level security;

-- 프론트엔드(anon key)는 조회만 가능
create policy "Public read access"
    on aed_locations for select
    using (true);

-- 쓰기는 service_role(백엔드 ETL)만 가능 — 별도 정책 불필요
-- (service_role은 RLS를 우회하므로 정책을 추가하지 않아야 함)
