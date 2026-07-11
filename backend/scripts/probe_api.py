"""safetydata.go.kr AED 데이터 API를 1회 호출해 원본 응답을 docs/sample_response.json에 저장한다.

사용법: backend/.venv의 python으로 실행
    backend/.venv/Scripts/python.exe backend/scripts/probe_api.py
"""
import json
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
import os

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

ENDPOINT = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00068"
OUTPUT_PATH = ROOT_DIR / "docs" / "sample_response.json"


def main() -> None:
    service_key = os.environ.get("SAFETYDATA_API_KEY")
    if not service_key:
        print("SAFETYDATA_API_KEY가 .env에 설정되어 있지 않습니다.", file=sys.stderr)
        sys.exit(1)

    params = {
        "serviceKey": service_key,
        "returnType": "json",
        "pageNo": "1",
        "numOfRows": "5",
    }

    # safetydata.go.kr 서버 인증서 체인 문제로 verify=False 필요 (공식 샘플 코드도 SSL 검증을 끄고 호출함)
    response = httpx.get(ENDPOINT, params=params, timeout=30.0, verify=False)
    response.raise_for_status()
    data = response.json()

    OUTPUT_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"저장 완료: {OUTPUT_PATH}")
    print(json.dumps(data, ensure_ascii=False, indent=2)[:2000])


if __name__ == "__main__":
    main()
