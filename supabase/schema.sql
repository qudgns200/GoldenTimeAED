-- GoldenTimeAED: aed_locations 테이블 초안 스키마
-- 주의: 아래 컬럼은 safetydata.go.kr AED API의 "추정" 필드다.
-- Phase 1(docs/API_SPEC.md 검증)에서 실제 응답 필드가 확정되면 이 스키마도 함께 갱신할 것.

create table if not exists aed_locations (
    id bigint generated always as identity primary key,
    source_id text unique,           -- 원본 데이터의 관리번호 (실제 필드명 확정 전 placeholder)
    org_name text,                   -- 설치기관명
    install_place text,              -- 설치장소명
    address_road text,               -- 도로명주소
    address_jibun text,              -- 지번주소
    latitude double precision,
    longitude double precision,
    phone text,
    manage_org text,                 -- 관리기관명
    install_date date,
    floor_info text,                 -- 설치 위치 상세(층수 등)
    data_base_date date,             -- 데이터 기준일자 (원본 API 기준)
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
