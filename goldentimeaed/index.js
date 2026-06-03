//#endregion
//#region \0virtual:cloudflare/worker-entry
var worker_entry_default = { async fetch(request, env) {
	const url = new URL(request.url);
	if (url.pathname === "/api/aed") {
		const targetUrl = "http://www.safetydata.go.kr/V2/api/DSSP-IF-00068" + url.search;
		try {
			const response = await fetch(targetUrl);
			const data = await response.text();
			if (!response.ok) return new Response(JSON.stringify({
				error: `업스트림 오류: ${response.status}`,
				body: data
			}), {
				status: 502,
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*"
				}
			});
			return new Response(data, {
				status: 200,
				headers: {
					"Content-Type": "application/json;charset=utf-8",
					"Access-Control-Allow-Origin": "*"
				}
			});
		} catch (err) {
			console.error("[Worker] AED API 호출 실패:", err);
			return new Response(JSON.stringify({
				error: "AED API 호출 실패",
				detail: String(err)
			}), {
				status: 502,
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*"
				}
			});
		}
	}
	return env.ASSETS.fetch(request);
} };
//#endregion
export { worker_entry_default as default };
