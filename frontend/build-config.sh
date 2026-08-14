#!/bin/sh
# 환경변수로부터 frontend/config.js를 생성한다.
#
# Vercel / Cloudflare Pages의 빌드 명령으로 사용한다:
#   sh frontend/build-config.sh
# 출력 디렉토리는 frontend/ 그대로 두면 된다 (별도 번들링 없음).
#
# 필요한 환경변수: SUPABASE_URL, SUPABASE_ANON_KEY, NAVER_MAP_CLIENT_ID
# 선택: NAVER_MAP_AUTH_PARAM (기본 ncpKeyId, 구 콘솔 키는 ncpClientId)
set -eu

: "${SUPABASE_URL:?SUPABASE_URL이 설정되지 않았습니다}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY가 설정되지 않았습니다}"
: "${NAVER_MAP_CLIENT_ID:?NAVER_MAP_CLIENT_ID가 설정되지 않았습니다}"
AUTH_PARAM="${NAVER_MAP_AUTH_PARAM:-ncpKeyId}"

OUT="$(dirname "$0")/config.js"

cat > "$OUT" <<EOF
// build-config.sh가 생성한 파일. 직접 수정하지 말 것.
window.APP_CONFIG = {
  SUPABASE_URL: "${SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY}",
  NAVER_MAP_CLIENT_ID: "${NAVER_MAP_CLIENT_ID}",
  NAVER_MAP_AUTH_PARAM: "${AUTH_PARAM}",
};
EOF

echo "생성 완료: $OUT"
