/**
 * GoldenTimeAED 프론트엔드
 *
 * 지도 뷰포트가 바뀔 때마다 Supabase에서 해당 범위의 AED만 조회해 마커로 표시한다.
 * 백엔드 API를 거치지 않고 anon 키로 직접 조회한다 (docs/API_SPEC.md 3절).
 */
const App = (() => {
  "use strict";

  // PostgREST는 요청당 기본 1000행까지만 반환한다. 실측으로 확인된 값이며,
  // 넘어가면 경고 없이 잘리므로 항상 명시적 limit + 정확한 count를 함께 요청한다.
  const MARKER_LIMIT = 500;

  // 뷰포트가 이보다 넓으면(위도 기준) 조회 자체를 하지 않는다.
  // 서울 도심은 ±0.05도(약 11km) 범위에 AED가 2,500개가 넘어 표시 의미가 없다.
  const MAX_QUERY_SPAN_DEG = 0.15;

  // 지도 이동이 멈춘 뒤 이 시간만큼 기다렸다가 조회한다 (드래그 중 연속 호출 방지).
  const DEBOUNCE_MS = 300;

  const SEOUL_CITY_HALL = { lat: 37.5665, lng: 126.978 };
  const DEFAULT_ZOOM = 15;

  let map = null;
  let supabase = null;
  let markers = [];
  let infoWindow = null;
  let debounceTimer = null;
  let myLocationMarker = null;
  let requestSeq = 0;

  const el = (id) => document.getElementById(id);

  function setStatus(message, kind = "info") {
    const node = el("status");
    node.textContent = message || "";
    node.className = message ? `status status--${kind} status--visible` : "status";
  }

  function fatal(message) {
    el("fatal-msg").textContent = message;
    el("fatal").hidden = false;
  }

  function escapeHtml(value) {
    if (value === null || value === undefined || value === "") return "";
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  /** 마커 클릭 시 띄울 상세 정보 HTML */
  function infoWindowContent(aed) {
    const name = escapeHtml(aed.org_name) || "이름 미상";
    const place = escapeHtml(aed.install_place);
    const address = escapeHtml(aed.address_road);
    const phone = escapeHtml(aed.phone);

    // 전화번호는 원본에서 일부 마스킹되어 온다(예: 02-******). 걸 수 없으므로 링크로 만들지 않는다.
    return `
      <div class="iw">
        <h3 class="iw__title">${name}</h3>
        ${place ? `<p class="iw__row"><span>설치위치</span>${place}</p>` : ""}
        ${address ? `<p class="iw__row"><span>주소</span>${address}</p>` : ""}
        ${phone ? `<p class="iw__row"><span>관리자</span>${phone}</p>` : ""}
      </div>`;
  }

  function clearMarkers() {
    markers.forEach((m) => m.setMap(null));
    markers = [];
  }

  function renderMarkers(rows) {
    clearMarkers();
    rows.forEach((aed) => {
      if (aed.latitude === null || aed.longitude === null) return;
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(aed.latitude, aed.longitude),
        map,
        title: aed.org_name || "AED",
      });
      naver.maps.Event.addListener(marker, "click", () => {
        infoWindow.setContent(infoWindowContent(aed));
        infoWindow.open(map, marker);
      });
      markers.push(marker);
    });
  }

  /** 현재 뷰포트 범위의 AED를 조회해 그린다. */
  async function loadInViewport() {
    const bounds = map.getBounds();
    const sw = bounds.getSW();
    const ne = bounds.getNE();
    const latSpan = ne.lat() - sw.lat();

    if (latSpan > MAX_QUERY_SPAN_DEG) {
      clearMarkers();
      infoWindow.close();
      setStatus("지도를 확대하면 주변 AED가 표시됩니다.", "hint");
      return;
    }

    // 조회가 늦게 도착해 최신 결과를 덮어쓰는 것을 막는다.
    const seq = ++requestSeq;
    setStatus("불러오는 중…", "info");

    const { data, error, count } = await supabase
      .from("aed_locations")
      .select("id, org_name, install_place, address_road, latitude, longitude, phone", {
        count: "exact",
      })
      .gte("latitude", sw.lat())
      .lte("latitude", ne.lat())
      .gte("longitude", sw.lng())
      .lte("longitude", ne.lng())
      .limit(MARKER_LIMIT);

    if (seq !== requestSeq) return; // 더 최근 요청이 진행 중

    if (error) {
      console.error(error);
      setStatus(`조회 실패: ${error.message}`, "error");
      return;
    }

    renderMarkers(data);

    if (count > data.length) {
      setStatus(
        `이 영역에 ${count.toLocaleString()}개 중 ${data.length}개만 표시했습니다. 확대하면 모두 볼 수 있습니다.`,
        "warn"
      );
    } else if (data.length === 0) {
      setStatus("이 영역에는 등록된 AED가 없습니다.", "hint");
    } else {
      setStatus(`${data.length.toLocaleString()}개 표시 중`, "info");
    }
  }

  function scheduleLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadInViewport, DEBOUNCE_MS);
  }

  function moveToMyLocation() {
    if (!navigator.geolocation) {
      setStatus("이 브라우저는 위치 기능을 지원하지 않습니다.", "error");
      return;
    }
    setStatus("현재 위치를 확인하는 중…", "info");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = new naver.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        if (myLocationMarker) myLocationMarker.setMap(null);
        myLocationMarker = new naver.maps.Marker({
          position: here,
          map,
          title: "내 위치",
          icon: {
            content: '<div class="me-dot" aria-label="내 위치"></div>',
            anchor: new naver.maps.Point(9, 9),
          },
          zIndex: 1000,
        });
        map.setCenter(here);
        map.setZoom(Math.max(map.getZoom(), DEFAULT_ZOOM));
        // setCenter/setZoom이 idle을 발생시켜 조회가 이어진다.
      },
      (err) => {
        const reason =
          err.code === err.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다."
            : "현재 위치를 가져오지 못했습니다.";
        setStatus(reason, "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  /** 네이버 지도 스크립트가 로드된 뒤 실행된다. */
  function initMap() {
    map = new naver.maps.Map("map", {
      center: new naver.maps.LatLng(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lng),
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      zoomControlOptions: { position: naver.maps.Position.RIGHT_CENTER },
    });

    infoWindow = new naver.maps.InfoWindow({
      content: "",
      borderWidth: 0,
      backgroundColor: "transparent",
      disableAnchor: true,
      pixelOffset: new naver.maps.Point(0, -8),
    });

    naver.maps.Event.addListener(map, "idle", scheduleLoad);
    naver.maps.Event.addListener(map, "click", () => infoWindow.close());
    el("locate-btn").addEventListener("click", moveToMyLocation);

    loadInViewport();
  }

  function bootstrap() {
    const cfg = window.APP_CONFIG;
    if (!cfg) {
      fatal("config.js가 없습니다. frontend/config.example.js를 config.js로 복사한 뒤 값을 채워주세요.");
      return;
    }

    const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "NAVER_MAP_CLIENT_ID"].filter(
      (k) => !cfg[k] || String(cfg[k]).startsWith("YOUR")
    );
    if (missing.length) {
      fatal(`config.js에 다음 값이 비어 있습니다: ${missing.join(", ")}`);
      return;
    }

    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    // 네이버 지도 인증 실패 시 호출되는 전역 콜백
    window.navermap_authFailure = () => {
      fatal(
        "네이버 지도 인증에 실패했습니다. 콘솔의 리퍼러 화이트리스트에 현재 도메인이 등록되어 있는지, " +
          `그리고 config.js의 NAVER_MAP_AUTH_PARAM("${cfg.NAVER_MAP_AUTH_PARAM}")이 키 종류와 맞는지 확인해주세요. ` +
          "신규 콘솔 키는 ncpKeyId, 구 콘솔 키는 ncpClientId를 사용합니다."
      );
    };

    const authParam = cfg.NAVER_MAP_AUTH_PARAM || "ncpKeyId";
    const script = document.createElement("script");
    script.src =
      `https://oapi.map.naver.com/openapi/v3/maps.js?${authParam}=` +
      encodeURIComponent(cfg.NAVER_MAP_CLIENT_ID);
    script.onload = initMap;
    script.onerror = () => fatal("네이버 지도 스크립트를 불러오지 못했습니다. 네트워크 상태를 확인해주세요.");
    document.head.appendChild(script);
  }

  return { bootstrap };
})();
