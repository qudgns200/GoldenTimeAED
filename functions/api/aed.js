// Cloudflare Pages Function — AED API CORS 프록시
// /api/aed?... 요청을 안전데이터포털로 전달하고 CORS 헤더를 추가합니다.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetUrl =
    'https://www.safetydata.go.kr/V2/api/DSSP-IF-00068' + url.search;

  const response = await fetch(targetUrl);
  const data = await response.text();

  return new Response(data, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
