"""Supabase의 aed_locations 전량을 정적 스냅샷 파일로 내보낸다.

프론트엔드는 이 파일을 한 번 받아 IndexedDB에 저장하고, 이후로는 오프라인에서도
저장본으로 동작한다 (docs/OFFLINE_DESIGN.md).

Cloudflare Pages 빌드 명령에서 build-config.sh 다음에 실행한다:
    sh frontend/build-config.sh && python3 backend/scripts/build_snapshot.py

로컬 실행:
    backend/.venv/Scripts/python.exe backend/scripts/build_snapshot.py

필요한 환경변수: SUPABASE_URL, SUPABASE_ANON_KEY
    조회만 하므로 service_role 키가 아니라 anon 키를 쓴다. RLS가 SELECT만 허용한다
    (supabase/schema.sql).

의존성을 쓰지 않고 stdlib urllib만 사용하는 이유:
    Cloudflare Pages 빌드 환경에 pip 설치 단계를 추가하지 않기 위해서다.
    requirements.txt는 CLAUDE.md 지침대로 배치 ETL에 필요한 것만 유지한다.

출력 (frontend/data/, .gitignore로 커밋 제외):
    aed-snapshot.json  전량. 키 이름 반복을 없앤 배열 포맷 (raw ~9MB, brotli 전송 ~2-3MB)
    aed-meta.json      generated_at/count만. 앱이 이것만 먼저 받아 갱신 여부를 판단한다.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT_DIR / "frontend" / "data"

# .env는 로컬 실행 편의용이다. python-dotenv가 없는 환경(Pages 빌드)에서도
# 동작해야 하므로 import 실패를 무시한다.
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT_DIR / ".env")
except ImportError:
    pass

# PostgREST는 요청당 1000행까지만 반환한다 (frontend/README.md 설계 메모 참조).
PAGE_SIZE = 1000
# 안전 상한 — 무한 루프 방지. 62,000건 기준 63페이지면 충분하다.
MAX_PAGES = 300
HTTP_TIMEOUT = 60.0

# 좌표 소수점 자릿수. 5자리면 약 1.1m 정확도로 AED 안내에는 충분하고 용량이 줄어든다.
COORD_PRECISION = 5

# 실제 수집량이 count의 이 비율에 못 미치면 잘린 스냅샷으로 보고 빌드를 실패시킨다.
# 빈/부분 스냅샷이 배포되면 오프라인 사용자가 조용히 잘못된 데이터를 갖게 된다.
MIN_COLLECTED_RATIO = 0.9

# 스냅샷 rows 배열의 컬럼 순서. 프론트엔드 data-store.js가 이 순서에 의존한다.
FIELDS = ["id", "org_name", "install_place", "address_road", "lat", "lng", "phone"]

SELECT_COLUMNS = "id,org_name,install_place,address_road,latitude,longitude,phone"


class SnapshotError(Exception):
    """스냅샷 생성을 중단해야 하는 오류."""


def _request(url: str, headers: dict) -> tuple[bytes, dict]:
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
            return response.read(), dict(response.headers)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:500]
        raise SnapshotError(f"HTTP {e.code} {url}\n  {body}") from e
    except urllib.error.URLError as e:
        raise SnapshotError(f"요청 실패 {url}: {e.reason}") from e


def _credentials() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_ANON_KEY", "")
    if not url or not key:
        raise SnapshotError(
            "SUPABASE_URL 또는 SUPABASE_ANON_KEY가 설정되어 있지 않습니다.\n"
            "  로컬: .env에 설정  /  Cloudflare Pages: 환경변수에 설정"
        )
    return url, key


def fetch_count(base_url: str, key: str) -> int:
    """전체 건수를 먼저 조회해 수집 완전성 검증의 기준으로 삼는다."""
    query = urllib.parse.urlencode({"select": "id", "limit": "1"})
    _, headers = _request(
        f"{base_url}/rest/v1/aed_locations?{query}",
        {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            # count=exact를 요청하면 Content-Range 헤더에 "0-0/62431" 형태로 총계가 온다.
            "Prefer": "count=exact",
            "Range-Unit": "items",
        },
    )
    content_range = headers.get("Content-Range", "")
    total = content_range.rsplit("/", 1)[-1] if "/" in content_range else ""
    if not total.isdigit():
        raise SnapshotError(f"Content-Range에서 총 건수를 읽지 못했습니다: {content_range!r}")
    return int(total)


def fetch_all(base_url: str, key: str) -> list[dict]:
    """offset 페이지네이션으로 전량을 모은다. id 정렬로 페이지 경계를 안정시킨다."""
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    rows: list[dict] = []

    for page in range(MAX_PAGES):
        query = urllib.parse.urlencode(
            {
                "select": SELECT_COLUMNS,
                "order": "id.asc",
                "limit": str(PAGE_SIZE),
                "offset": str(page * PAGE_SIZE),
            }
        )
        body, _ = _request(f"{base_url}/rest/v1/aed_locations?{query}", headers)
        batch = json.loads(body)
        if not batch:
            break
        rows.extend(batch)
        print(f"  {len(rows):,}건 수집", end="\r", flush=True)
        if len(batch) < PAGE_SIZE:
            break
    else:
        raise SnapshotError(f"MAX_PAGES({MAX_PAGES})에 도달했습니다. 페이지네이션을 확인하세요.")

    print()
    return rows


def to_compact_rows(records: list[dict]) -> tuple[list[list], int]:
    """DB 행을 FIELDS 순서의 배열로 변환한다. 좌표가 없는 행은 제외한다.

    키 이름을 매 행마다 반복하지 않으므로 JSON 크기가 약 40% 줄어든다.
    """
    compact: list[list] = []
    dropped = 0

    for record in records:
        lat = record.get("latitude")
        lng = record.get("longitude")
        if lat is None or lng is None:
            # 좌표가 없으면 지도에도 목록(거리순)에도 올릴 수 없다.
            dropped += 1
            continue
        compact.append(
            [
                record.get("id"),
                record.get("org_name") or "",
                record.get("install_place") or "",
                record.get("address_road") or "",
                round(float(lat), COORD_PRECISION),
                round(float(lng), COORD_PRECISION),
                record.get("phone") or "",
            ]
        )

    return compact, dropped


def write_json(path: Path, payload: dict) -> int:
    """JSON을 최소 크기로 쓴다. 한글은 이스케이프하지 않아야 용량이 3배 작다."""
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def main() -> None:
    try:
        base_url, key = _credentials()

        print(f"Supabase 조회: {base_url}")
        total = fetch_count(base_url, key)
        if total <= 0:
            raise SnapshotError("aed_locations가 비어 있습니다. 스냅샷을 만들지 않고 중단합니다.")
        print(f"  총 {total:,}건")

        records = fetch_all(base_url, key)
        if len(records) < total * MIN_COLLECTED_RATIO:
            raise SnapshotError(
                f"수집량이 비정상적으로 적습니다 ({len(records):,} < {total:,}의 "
                f"{MIN_COLLECTED_RATIO:.0%}). 잘린 스냅샷 배포를 막기 위해 중단합니다."
            )

        rows, dropped = to_compact_rows(records)
        if not rows:
            raise SnapshotError("좌표가 있는 행이 하나도 없습니다. 중단합니다.")

        generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        OUT_DIR.mkdir(parents=True, exist_ok=True)

        snapshot_bytes = write_json(
            OUT_DIR / "aed-snapshot.json",
            {
                "generated_at": generated_at,
                "count": len(rows),
                "fields": FIELDS,
                "rows": rows,
            },
        )
        # 앱은 이 작은 파일만 먼저 받아 저장본과 비교한다. 같으면 큰 파일을 받지 않는다.
        write_json(
            OUT_DIR / "aed-meta.json",
            {"generated_at": generated_at, "count": len(rows)},
        )

    except SnapshotError as e:
        print(f"\n[중단] {e}", file=sys.stderr)
        sys.exit(1)

    if dropped:
        print(f"  좌표 없음 {dropped:,}건 제외")
    print(
        f"생성 완료: {OUT_DIR / 'aed-snapshot.json'}\n"
        f"  {len(rows):,}건, {snapshot_bytes / 1024 / 1024:.1f}MB (압축 전)"
    )


if __name__ == "__main__":
    main()
