// 이 파일을 config.js로 복사한 뒤 실제 값을 채운다. config.js는 커밋하지 않는다.
//   cp frontend/config.example.js frontend/config.js
//
// Supabase 키는 여기에 없다. 프론트엔드는 Supabase를 직접 조회하지 않고
// backend/scripts/build_snapshot.py가 만든 정적 스냅샷(data/aed-snapshot.json)만 읽는다.
// 자세한 구조는 docs/OFFLINE_DESIGN.md 참고.
//
// 아래 값은 공개되어도 안전하다 — 네이버 콘솔의 리퍼러 화이트리스트로 보호된다.
// 그럼에도 커밋하지 않는 이유는 키 교체와 환경별 분리를 쉽게 하기 위해서다.
window.APP_CONFIG = {
  NAVER_MAP_CLIENT_ID: "YOUR_NAVER_CLIENT_ID",
  // 네이버 지도 스크립트의 인증 파라미터 이름.
  // 신규 콘솔에서 발급한 키는 "ncpKeyId", 구 콘솔 키는 "ncpClientId"를 쓴다.
  // 지도가 인증 오류를 내면 다른 값으로 바꿔볼 것.
  NAVER_MAP_AUTH_PARAM: "ncpKeyId",
};
