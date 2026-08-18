/**
 * 스냅샷 동기화 — 서버의 정적 스냅샷을 기기(IndexedDB)로 가져온다.
 *
 * 오프라인일 때는 다운로드가 불가능하므로, 오프라인이 되기 전에 미리 받아두는 것이
 * 오프라인 지원의 전부다. 그래서 사용자 조작 없이 앱 시작 시 백그라운드로 실행한다.
 * 버튼에 의존하면 안 누른 사용자는 정작 응급 상황에 빈 화면을 본다.
 *
 * 큰 파일(2~3MB)을 매번 받지 않도록 수백 바이트짜리 aed-meta.json을 먼저 받아
 * generated_at을 비교하고, 달라졌을 때만 본 파일을 받는다.
 *
 * 실패하거나 오프라인이어도 절대 앱을 막지 않는다. 저장본이 있으면 그대로 쓴다.
 */
const SyncData = (() => {
  "use strict";

  const META_URL = "data/aed-meta.json";
  const SNAPSHOT_URL = "data/aed-snapshot.json";

  const META_TIMEOUT_MS = 8000;
  const SNAPSHOT_TIMEOUT_MS = 120000; // 느린 모바일 회선에서 2~3MB를 받을 여유

  function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
      signal: controller.signal,
      // 서버가 매일 갱신하므로 항상 재검증한다. 변경이 없으면 304로 끝나 전송량이 0이다.
      cache: "no-cache",
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .finally(() => clearTimeout(timer));
  }

  /**
   * 스냅샷의 배열 포맷을 객체 배열로 펼친다.
   * fields 순서를 하드코딩하지 않고 파일이 선언한 순서를 읽어, 나중에 컬럼이
   * 추가·재배치되어도 조용히 어긋나지 않게 한다.
   */
  function expand(payload) {
    const fields = payload.fields || [];
    const idx = {};
    fields.forEach((name, i) => {
      idx[name] = i;
    });

    for (const required of ["id", "lat", "lng"]) {
      if (idx[required] === undefined) {
        throw new Error(`스냅샷에 필수 필드 '${required}'가 없습니다.`);
      }
    }

    return payload.rows.map((row) => ({
      id: row[idx.id],
      org_name: row[idx.org_name] || "",
      install_place: row[idx.install_place] || "",
      address_road: row[idx.address_road] || "",
      lat: row[idx.lat],
      lng: row[idx.lng],
      phone: row[idx.phone] || "",
    }));
  }

  /**
   * 저장본이 최신인지 확인하고, 아니면 받아서 저장한다.
   * onProgress(phase) — "checking" | "downloading" | "saving"
   * 반환: { status: "fresh"|"updated"|"failed", rows?, meta?, error? }
   */
  async function ensureFresh(onProgress = () => {}) {
    const stored = await DataStore.getMeta();

    try {
      onProgress("checking");
      const remote = await fetchJson(META_URL, META_TIMEOUT_MS);

      if (stored && stored.generated_at === remote.generated_at) {
        return { status: "fresh", meta: stored };
      }

      onProgress("downloading");
      const payload = await fetchJson(SNAPSHOT_URL, SNAPSHOT_TIMEOUT_MS);

      onProgress("saving");
      const rows = expand(payload);
      if (!rows.length) throw new Error("스냅샷이 비어 있습니다.");

      const meta = { generated_at: payload.generated_at, count: rows.length };
      await DataStore.saveSnapshot(rows, meta);

      return { status: "updated", rows, meta };
    } catch (error) {
      // 오프라인·타임아웃·배포 중 등 어떤 이유든 앱을 막지 않는다.
      return { status: "failed", meta: stored, error };
    }
  }

  return { ensureFresh };
})();
