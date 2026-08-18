"""safetydata.go.kr AED 위치 데이터를 전량 수집해 정적 스냅샷 파일로 내보낸다.

GitHub Actions cron이 이 스크립트를 직접 실행하고, 내용이 바뀐 날에만 결과를 커밋한다.
커밋이 push되면 Cloudflare Pages가 자동으로 재빌드한다 (docs/OFFLINE_DESIGN.md).

사용법:
    backend/.venv/Scripts/python.exe backend/sync.py

필요한 환경변수 (.env 또는 Actions 시크릿):
    SAFETYDATA_API_KEY

출력 (frontend/data/, 커밋 대상):
    aed-snapshot.json  전량. 키 이름 반복을 없앤 배열 포맷 (raw ~10MB, brotli 전송 2~3MB)
    aed-meta.json      generated_at/count만. 앱이 이것만 먼저 받아 갱신 여부를 판단한다.

설계 원칙 — 실패해도 기존 스냅샷을 훼손하지 않는다:
  * API가 오류를 반환하거나 수집량이 비정상적으로 적으면 파일을 쓰지 않고 종료한다.
    직전 스냅샷이 그대로 배포된 채 남으므로 사용자는 어제 데이터를 계속 볼 수 있다.
  * 행 내용이 이전과 같으면 파일을 건드리지 않는다. generated_at만 바뀐 10MB 커밋이
    매일 쌓이는 것을 막기 위해서다.

주의 — SN은 영속적인 AED 식별자가 아니다 (docs/API_SPEC.md 참조):
  한 스냅샷 안에서는 고유하지만 원본이 재발행되면 재할당된다. 그래서 정렬과 id에
  쓰지 않고, 좌표 기반 자연키를 쓴다.
"""
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

# 한국어 Windows 콘솔은 기본이 cp949라 출력에 쓰인 문자 하나(예: em dash)에도
# UnicodeEncodeError로 죽는다. GitHub Actions(UTF-8)에서는 드러나지 않으므로
# 로컬에서만 터지는 함정이 된다. 출력 인코딩을 고정해 막는다.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

OUT_DIR = ROOT_DIR / "frontend" / "data"
SNAPSHOT_PATH = OUT_DIR / "aed-snapshot.json"
META_PATH = OUT_DIR / "aed-meta.json"

ENDPOINT = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00068"

# API가 numOfRows를 1000으로 제한한다 (2000을 요청해도 1000건만 반환).
PAGE_SIZE = 1000
# totalCount 기준 안전 상한 — 무한 루프 방지용
MAX_PAGES = 200

HTTP_ATTEMPTS = 4
HTTP_BACKOFF_BASE = 2.0
HTTP_TIMEOUT = 60.0

# 수집량이 totalCount의 이 비율에 못 미치면 부분 수집으로 간주하고 중단한다.
MIN_COLLECTED_RATIO = 0.5

# 좌표 소수점 자릿수. 5자리면 약 1.1m 정확도로 AED 안내에 충분하고 용량이 줄어든다.
COORD_PRECISION = 5

# 스냅샷 rows 배열의 컬럼 순서. frontend/sync-data.js가 이 순서를 파일에서 읽어 쓴다.
FIELDS = ["id", "org_name", "install_place", "address_road", "lat", "lng", "phone"]

# docs/API_SPEC.md 2절 매핑 표 (원본 필드 -> 스냅샷 필드)
SRC_ORG = "MNG_INST_NM"
SRC_PLACE = "INSTL_PSTN"
SRC_ADDR = "ADDR"
SRC_PHONE = "MNGR_TELNO"
SRC_LAT = "LAT"
SRC_LNG = "LOT"  # 필드명은 LOT이지만 값은 경도


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
            raise SyncError(f"totalCount가 {total_count}입니다. 기존 스냅샷을 보존하고 중단합니다.")
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


def _natural_key(lat: float, lng: float, org: str, place: str) -> str:
    """한 대의 AED를 가리키는 자연키.

    SN은 원본 재발행 때마다 재할당되므로 쓸 수 없다. 좌표와 이름은 실제 설치 위치를
    가리키므로 날짜가 지나도 같은 AED에 같은 키가 나온다.
    """
    return f"{lat:.{COORD_PRECISION}f}|{lng:.{COORD_PRECISION}f}|{org}|{place}"


def _stable_id(natural_key: str) -> int:
    """자연키에서 안정적인 숫자 id를 만든다.

    순번을 쓰면 행 하나만 추가돼도 이후 전체 id가 밀려 파일 전체가 바뀌고,
    git이 delta를 잡지 못해 매일 10MB가 통째로 쌓인다.

    sha1 앞 12자리 = 48비트. Number.MAX_SAFE_INTEGER(2^53) 안이라 JS에서 안전하고
    (offline-view.js가 Number()로 읽는다) 62,000건 기준 충돌 확률은 무시할 수준이다.
    """
    return int(hashlib.sha1(natural_key.encode("utf-8")).hexdigest()[:12], 16)


def transform(records: list[dict]) -> tuple[list[list], dict]:
    """원본 레코드를 스냅샷 행 배열로 변환한다.

    좌표가 없는 행은 버린다 — 지도에도 거리순 목록에도 올릴 수 없다.
    자연키로 중복을 제거하고 결정적 순서로 정렬한다. 정렬이 흔들리면 내용이 같아도
    파일이 달라져 매일 커밋이 발생한다.
    """
    by_key: dict[str, list] = {}
    dropped_no_coords = 0

    for raw in records:
        lat = _to_float(raw.get(SRC_LAT))
        lng = _to_float(raw.get(SRC_LNG))
        if lat is None or lng is None:
            dropped_no_coords += 1
            continue

        lat = round(lat, COORD_PRECISION)
        lng = round(lng, COORD_PRECISION)
        org = raw.get(SRC_ORG) or ""
        place = raw.get(SRC_PLACE) or ""

        key = _natural_key(lat, lng, org, place)
        by_key[key] = [
            _stable_id(key),
            org,
            place,
            raw.get(SRC_ADDR) or "",
            lat,
            lng,
            raw.get(SRC_PHONE) or "",
        ]

    # 좌표 우선 정렬. 지리적으로 가까운 행이 모여 압축에도 유리하다.
    rows = sorted(by_key.values(), key=lambda r: (r[4], r[5], r[1], r[2]))

    stats = {
        "dropped_no_coords": dropped_no_coords,
        "duplicates": len(records) - dropped_no_coords - len(rows),
    }
    return rows, stats


def load_existing_rows() -> list[list] | None:
    """이미 커밋된 스냅샷의 행 배열을 읽는다. 없거나 깨졌으면 None."""
    if not SNAPSHOT_PATH.exists():
        return None
    try:
        payload = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return payload.get("rows")


def write_json(path: Path, payload: dict) -> int:
    """JSON을 최소 크기로 쓴다. 한글은 이스케이프하지 않아야 용량이 3배 작다."""
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def main() -> None:
    service_key = os.environ.get("SAFETYDATA_API_KEY")
    if not service_key:
        print("SAFETYDATA_API_KEY가 .env에 설정되어 있지 않습니다.", file=sys.stderr)
        sys.exit(1)

    started = time.monotonic()
    try:
        records, total_count = fetch_all(service_key)
        rows, stats = transform(records)

        print(
            f"\n변환 완료: {len(rows):,}건 "
            f"(원본 {len(records):,}건, 중복 {stats['duplicates']:,}건 제거, "
            f"좌표 없음 {stats['dropped_no_coords']:,}건 제외)"
        )

        # 안전장치: 부분 수집분을 쓰면 기존 스냅샷의 멀쩡한 데이터가 사라진다.
        if len(rows) < total_count * MIN_COLLECTED_RATIO:
            raise SyncError(
                f"수집량이 비정상적으로 적습니다 "
                f"({len(rows):,} < totalCount {total_count:,}의 "
                f"{MIN_COLLECTED_RATIO:.0%}). 기존 스냅샷을 보존하고 중단합니다."
            )
        if not rows:
            raise SyncError("좌표가 있는 행이 하나도 없습니다. 중단합니다.")

    except SyncError as e:
        print(f"\n[중단] {e}", file=sys.stderr)
        sys.exit(1)

    # 내용이 그대로면 아무것도 쓰지 않는다. generated_at만 바뀐 10MB 커밋을 막는다.
    if load_existing_rows() == rows:
        elapsed = time.monotonic() - started
        print(f"\n변경 없음: 기존 스냅샷과 동일하다. 파일을 쓰지 않는다. ({elapsed:.1f}초)")
        return

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    snapshot_bytes = write_json(
        SNAPSHOT_PATH,
        {
            "generated_at": generated_at,
            "count": len(rows),
            "fields": FIELDS,
            "rows": rows,
        },
    )
    # 앱은 이 작은 파일만 먼저 받아 저장본과 비교한다. 같으면 큰 파일을 받지 않는다.
    write_json(META_PATH, {"generated_at": generated_at, "count": len(rows)})

    elapsed = time.monotonic() - started
    print(
        f"\n스냅샷 갱신: {len(rows):,}건, "
        f"{snapshot_bytes / 1024 / 1024:.1f}MB (압축 전), {elapsed:.1f}초 소요\n"
        f"  {SNAPSHOT_PATH}\n"
        f"  {META_PATH}"
    )


if __name__ == "__main__":
    main()
