#!/bin/sh
# 환경변수로부터 frontend/config.js를 생성한다.
#
# Cloudflare Pages의 빌드 명령으로 사용한다 (스냅샷 생성과 함께):
#   sh frontend/build-config.sh && python3 backend/scripts/build_snapshot.py
# 출력 디렉토리는 frontend/ 그대로 두면 된다 (별도 번들링 없음).
#
# 필요한 환경변수: NAVER_MAP_CLIENT_ID
# 선택: NAVER_MAP_AUTH_PARAM (기본 ncpKeyId, 구 콘솔 키는 ncpClientId)
#
# SUPABASE_URL / SUPABASE_ANON_KEY는 여기서 쓰지 않는다.
# 프론트엔드는 Supabase를 직접 조회하지 않고 build_snapshot.py가 만든 정적 스냅샷만 읽는다
# (docs/OFFLINE_DESIGN.md). 두 값은 build_snapshot.py의 빌드 시점 환경변수로만 필요하다.
set -eu

: "${NAVER_MAP_CLIENT_ID:?NAVER_MAP_CLIENT_ID가 설정되지 않았습니다}"
AUTH_PARAM="${NAVER_MAP_AUTH_PARAM:-ncpKeyId}"

OUT="$(dirname "$0")/config.js"

cat > "$OUT" <<EOF
// build-config.sh가 생성한 파일. 직접 수정하지 말 것.
window.APP_CONFIG = {
  NAVER_MAP_CLIENT_ID: "${NAVER_MAP_CLIENT_ID}",
  NAVER_MAP_AUTH_PARAM: "${AUTH_PARAM}",
};
EOF

echo "생성 완료: $OUT"
