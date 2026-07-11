# frontend/

정적 HTML/CSS/JS로 구성된 지도 프론트엔드가 위치할 폴더 (Phase 5에서 구현 예정).

- 네이버 지도 JS API v3로 지도를 렌더링하고, `@supabase/supabase-js`(CDN)로 `aed_locations` 테이블을 직접 조회해 마커를 표시한다.
- 별도 빌드 도구 없이 Vercel 또는 Cloudflare Pages에 정적 사이트로 배포한다.

자세한 아키텍처 설명은 루트 [`CLAUDE.md`](../CLAUDE.md), 단계별 계획은 [`docs/DEVELOPMENT_PLAN.md`](../docs/DEVELOPMENT_PLAN.md) 참고.
