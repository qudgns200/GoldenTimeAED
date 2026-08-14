"""Phase 2 완료 기준 검증: Supabase에서 schema.sql 실행 후 RLS 정책이 의도대로 동작하는지 확인한다.

사전 조건: Supabase 대시보드 SQL Editor에서 supabase/schema.sql을 먼저 실행해야 한다.

확인 항목:
1. anon 키로 SELECT 가능
2. anon 키로 INSERT 시도 시 RLS에 의해 거부됨
3. service_role 키로 INSERT/UPSERT 가능 (테스트 후 삭제까지 확인)

사용법: backend/.venv의 python으로 실행
    backend/.venv/Scripts/python.exe backend/scripts/verify_rls.py
"""
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client
import os

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

TEST_SOURCE_ID = "__RLS_VERIFY_TEST__"


def main() -> None:
    url = os.environ.get("SUPABASE_URL")
    anon_key = os.environ.get("SUPABASE_ANON_KEY")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    missing = [name for name, val in [
        ("SUPABASE_URL", url),
        ("SUPABASE_ANON_KEY", anon_key),
        ("SUPABASE_SERVICE_ROLE_KEY", service_key),
    ] if not val]
    if missing:
        print(f".env에 다음 값이 비어있습니다: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    anon_client = create_client(url, anon_key)
    service_client = create_client(url, service_key)

    ok = True

    # 1. anon SELECT 가능 확인
    try:
        anon_client.table("aed_locations").select("id").limit(1).execute()
        print("[OK] anon 키로 SELECT 가능")
    except Exception as e:
        ok = False
        print(f"[FAIL] anon SELECT 실패: {e}")

    # 2. anon INSERT 거부 확인
    try:
        anon_client.table("aed_locations").insert(
            {"source_id": TEST_SOURCE_ID, "org_name": "RLS 테스트"}
        ).execute()
        ok = False
        print("[FAIL] anon 키로 INSERT가 성공했습니다 — RLS 정책이 잘못 설정되었을 수 있습니다.")
        # 잘못 들어간 테스트 데이터 정리
        service_client.table("aed_locations").delete().eq("source_id", TEST_SOURCE_ID).execute()
    except Exception as e:
        print(f"[OK] anon 키로 INSERT가 거부됨 (예상된 동작): {e}")

    # 3. service_role INSERT/UPSERT 가능 확인
    try:
        service_client.table("aed_locations").upsert(
            {"source_id": TEST_SOURCE_ID, "org_name": "RLS 테스트"},
            on_conflict="source_id",
        ).execute()
        print("[OK] service_role 키로 INSERT/UPSERT 가능")
        service_client.table("aed_locations").delete().eq("source_id", TEST_SOURCE_ID).execute()
        print("[OK] 테스트 데이터 정리 완료")
    except Exception as e:
        ok = False
        print(f"[FAIL] service_role INSERT/UPSERT 실패: {e}")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
