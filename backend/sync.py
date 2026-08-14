"""safetydata.go.kr AED 위치 데이터를 전량 수집해 Supabase `aed_locations`에 upsert한다.

GitHub Actions cron이 이 스크립트를 직접 실행한다 (docs/DEVELOPMENT_PLAN.md Phase 3/4).

사용법:
    backend/.venv/Scripts/python.exe backend/sync.py

필요한 환경변수 (.env 또는 Actions 시크릿):
    SAFETYDATA_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

설계 원칙 — 실패 시 기존 데이터를 훼손하지 않는다:
  * delete 후 insert 하지 않고 source_id 기준 upsert만 사용한다.
  * API가 오류를 반환하거나 수집량이 비정상적으로 적으면 upsert 자체를 하지 않고 종료한다.
  * 원본에서 사라진 행 정리(sweep)는 수집 완전성 검증을 통과한 뒤에만 수행한다.

주의 — SN은 영속적인 AED 식별자가 아니다 (docs/API_SPEC.md 참조):
  한 스냅샷 안에서는 고유하지만 원본이 재발행되면 재할당된다. 실제로 2026-07 캡처의
  SN=10152는 '잠실주공5단지'(송파구)였으나 현재는 '옥수파크힐스아파트'(성동구)다.
  따라서 upsert만으로는 원본에서 빠진 AED가 DB에 영구히 남는다. 이를 막기 위해
  동기화 성공 후 synced_at이 이번 실행보다 오래된 행을 삭제한다(mark & sweep).
"""
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from supabase import create_client

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

ENDPOINT = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00068"

# API가 numOfRows를 1000으로 제한한다 (2000을 요청해도 1000건만 반환).
PAGE_SIZE = 1000
# totalCount 기준 안전 상한 — 무한 루프 방지용
MAX_PAGES = 200
# Supabase에 한 번에 보낼 행 수
UPSERT_BATCH_SIZE = 500

HTTP_ATTEMPTS = 4
HTTP_BACKOFF_BASE = 2.0
HTTP_TIMEOUT = 60.0

# 수집량이 totalCount의 이 비율에 못 미치면 부분 동기화로 간주하고 중단한다.
MIN_COLLECTED_RATIO = 0.5

# docs/API_SPEC.md 2절 매핑 표 (원본 필드 -> DB 컬럼)
FIELD_MAP = {
    "MNG_INST_NM": "org_name",
    "INSTL_PSTN": "install_place",
    "ADDR": "address_road",
    "MNGR_TELNO": "phone",
    "MNGR_NM": "manager_name",
    "MKR_NM": "maker_name",
    "MDL_NM": "model_name",
    "CTPV_NM": "sido_name",
    "SE": "sigungu_name",
}


class SyncError(Exception):
    """동기화를 중단해야 하는 오류."""


def _to_float(value):
    """좌표를 float으로 변환하되 변환 불가하면 None을 반환한다."""
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_page(client: httpx.Client, service_key: str, page: int) -> list[dict]:
    """한 페이지를 가져온다. 네트워크 오류/5xx는 지수 백오프로 재시도한다."""
    params = {
        "serviceKey": service_key,
        "returnType": "json",
        "pageNo": str(page),
        "numOfRows": str(PAGE_SIZE),
    }

    last_error = None
    for attempt in range(1, HTTP_ATTEMPTS + 1):
        try:
            response = client.get(ENDPOINT, params=params)
            if response.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"서버 오류 {response.status_code}",
                    request=response.request,
                    response=response,
                )
            response.raise_for_status()
            payload = response.json()

            header = payload.get("header") or {}
            code = header.get("resultCode")
            if code != "00":
                # 인증키 오류·한도 초과 등은 재시도해도 소용없으므로 즉시 중단한다.
                raise SyncError(
                    f"API가 오류를 반환했습니다 (pageNo={page}): "
                    f"resultCode={code}, resultMsg={header.get('resultMsg')}, "
                    f"errorMsg={header.get('errorMsg')}"
                )

            if page == 1:
                total = payload.get("totalCount")
                print(f"  totalCount={total}")

            return payload.get("body") or []

        except SyncError:
            raise
        except Exception as e:  # 네트워크 오류, 타임아웃, 5xx, JSON 파싱 실패
            last_error = e
            if attempt == HTTP_ATTEMPTS:
                break
            delay = HTTP_BACKOFF_BASE ** attempt
            print(
                f"  [재시도 {attempt}/{HTTP_ATTEMPTS - 1}] pageNo={page} "
                f"{type(e).__name__}: {e} -> {delay:.0f}초 후 재시도",
                file=sys.stderr,
            )
            time.sleep(delay)

    raise SyncError(f"pageNo={page} 요청이 {HTTP_ATTEMPTS}회 모두 실패했습니다: {last_error}")


def fetch_total_count(client: httpx.Client, service_key: str) -> int:
    """전체 건수를 미리 조회해 수집 완전성 검증의 기준으로 삼는다."""
    response = client.get(
        ENDPOINT,
        params={
            "serviceKey": service_key,
            "returnType": "json",
            "pageNo": "1",
            "numOfRows": "1",
        },
    )
    response.raise_for_status()
    payload = response.json()
    header = payload.get("header") or {}
    if header.get("resultCode") != "00":
        raise SyncError(
            f"totalCount 조회 실패: resultCode={header.get('resultCode')}, "
            f"resultMsg={header.get('resultMsg')}"
        )
    return int(payload.get("totalCount") or 0)


def fetch_all(service_key: str) -> tuple[list[dict], int]:
    """전 페이지를 순회해 원본 레코드를 모은다. (레코드, totalCount)를 반환."""
    # safetydata.go.kr 인증서 체인 문제로 verify=False 필요
    # (probe_api.py와 동일 — 공식 샘플 코드도 SSL 검증을 끄고 호출한다)
    with httpx.Client(timeout=HTTP_TIMEOUT, verify=False) as client:
        total_count = fetch_total_count(client, service_key)
        if total_count <= 0:
            raise SyncError(f"totalCount가 {total_count}입니다. 기존 데이터를 보존하고 중단합니다.")
        print(f"수집 시작: totalCount={total_count:,}, 페이지 크기={PAGE_SIZE}")

        records: list[dict] = []
        for page in range(1, MAX_PAGES + 1):
            body = fetch_page(client, service_key, page)
            if not body:
                print(f"  pageNo={page}: 빈 응답 — 수집 종료")
                break
            records.extend(body)
            print(f"  pageNo={page}: {len(body)}건 (누적 {len(records):,})")
        else:
            raise SyncError(f"MAX_PAGES({MAX_PAGES})에 도달했습니다. 페이지네이션 로직을 확인하세요.")

    return records, total_count


def transform(records: list[dict], synced_at: str) -> tuple[list[dict], dict]:
    """원본 레코드를 DB 스키마로 변환하고 source_id 기준으로 중복을 제거한다.

    synced_at은 이번 실행을 식별하는 값이다. 모든 행에 동일하게 찍어두면
    나중에 이 값보다 오래된 행 = 원본에서 사라진 행으로 판별할 수 있다.
    """
    by_source_id: dict[str, dict] = {}
    skipped_no_sn = 0
    missing_coords = 0

    for raw in records:
        sn = raw.get("SN")
        if sn in (None, ""):
            # source_id가 없으면 upsert 키를 만들 수 없다.
            skipped_no_sn += 1
            continue

        latitude = _to_float(raw.get("LAT"))
        longitude = _to_float(raw.get("LOT"))  # 필드명은 LOT이지만 값은 경도
        if latitude is None or longitude is None:
            missing_coords += 1

        row = {
            "source_id": str(sn),  # API는 int로 주지만 source_id 컬럼은 text
            "latitude": latitude,
            "longitude": longitude,
            "synced_at": synced_at,
        }
        for src, dest in FIELD_MAP.items():
            row[dest] = raw.get(src)

        # 페이지 순회 중 원본이 바뀌어 같은 SN이 두 번 올 수 있다.
        # 배치 안에 중복 키가 있으면 upsert가 실패하므로 여기서 제거한다.
        by_source_id[row["source_id"]] = row

    stats = {
        "skipped_no_sn": skipped_no_sn,
        "missing_coords": missing_coords,
        "duplicates": len(records) - skipped_no_sn - len(by_source_id),
    }
    return list(by_source_id.values()), stats


def _service_client():
    url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        raise SyncError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.")
    return create_client(url, service_key)


def upsert_all(rows: list[dict]) -> int:
    """service_role 키로 배치 upsert한다. source_id 충돌 시 갱신."""
    client = _service_client()
    written = 0
    total_batches = (len(rows) + UPSERT_BATCH_SIZE - 1) // UPSERT_BATCH_SIZE

    for index in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows[index : index + UPSERT_BATCH_SIZE]
        batch_no = index // UPSERT_BATCH_SIZE + 1
        try:
            client.table("aed_locations").upsert(batch, on_conflict="source_id").execute()
        except Exception as e:
            raise SyncError(f"upsert 실패 (배치 {batch_no}/{total_batches}): {e}") from e
        written += len(batch)
        print(f"  배치 {batch_no}/{total_batches}: {written:,}/{len(rows):,}건 반영")

    return written


def delete_stale(synced_at: str) -> int:
    """이번 실행에서 갱신되지 않은 행(= 원본 스냅샷에서 사라진 AED)을 삭제한다.

    SN이 재발행 때마다 재할당되므로 upsert만으로는 없어진 AED를 지울 수 없다.
    수집 완전성 검증을 통과한 뒤에만 호출해야 한다.
    """
    client = _service_client()
    response = client.table("aed_locations").delete().lt("synced_at", synced_at).execute()
    return len(response.data or [])


def main() -> None:
    service_key = os.environ.get("SAFETYDATA_API_KEY")
    if not service_key:
        print("SAFETYDATA_API_KEY가 .env에 설정되어 있지 않습니다.", file=sys.stderr)
        sys.exit(1)

    started = time.monotonic()
    run_synced_at = datetime.now(timezone.utc).isoformat()
    try:
        records, total_count = fetch_all(service_key)
        rows, stats = transform(records, run_synced_at)

        print(
            f"\n변환 완료: {len(rows):,}건 "
            f"(원본 {len(records):,}건, 중복 {stats['duplicates']:,}건 제거, "
            f"SN 없음 {stats['skipped_no_sn']:,}건 제외)"
        )
        if stats["missing_coords"]:
            print(f"  참고: 좌표 결측 {stats['missing_coords']:,}건 — 저장하되 지도에는 표시되지 않는다.")

        # 안전장치: 부분 수집 상태로 upsert하면 오래된 데이터가 남아 혼란을 준다.
        if len(rows) < total_count * MIN_COLLECTED_RATIO:
            raise SyncError(
                f"수집량이 비정상적으로 적습니다 "
                f"({len(rows):,} < totalCount {total_count:,}의 "
                f"{MIN_COLLECTED_RATIO:.0%}). 기존 데이터를 보존하고 중단합니다."
            )

        print(f"\nupsert 시작: {len(rows):,}건")
        written = upsert_all(rows)

        # 완전성 검증과 upsert가 모두 끝난 뒤에만 청소한다.
        removed = delete_stale(run_synced_at)
        if removed:
            print(f"\n원본에서 사라진 행 {removed:,}건 삭제")

    except SyncError as e:
        print(f"\n[중단] {e}", file=sys.stderr)
        sys.exit(1)

    elapsed = time.monotonic() - started
    print(f"\n동기화 완료: {written:,}건 반영, {removed:,}건 삭제, {elapsed:.1f}초 소요")


if __name__ == "__main__":
    main()
