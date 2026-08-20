/**
 * GoldenTimeAED — 부팅과 모드 전환.
 *
 * 데이터 흐름 (docs/OFFLINE_DESIGN.md):
 *   1) IndexedDB의 저장본을 즉시 읽어 화면을 띄운다 (네트워크를 기다리지 않는다).
 *   2) 네이버 지도 스크립트를 시도한다. 성공하면 지도 뷰, 실패하면 오프라인 뷰.
 *   3) 백그라운드로 스냅샷 갱신을 확인하고, 새 데이터가 오면 뷰에 반영한다.
 *
 * 설계 원칙 — 어떤 실패도 앱을 잠그지 않는다.
 * 예전에는 지도 스크립트가 실패하면 전체 화면 오버레이로 앱을 막았고, 그 전에
 * supabase-js CDN이 실패하면 TypeError로 백지 화면이 됐다. 둘 다 오프라인에서
 * 반드시 일어나는 일이었다. 이제 모든 실패는 오프라인 뷰로 흡수된다.
 */
const App = (() => {
  "use strict";

  const LAST_POSITION_KEY = "goldentime.lastPosition";

  let rows = [];
  let mode = "offline"; // "map" | "offline"
  let mapAvailable = false;
  let mapScriptTried = false;
  let deferredInstallPrompt = null;
  let currentPos = null;   // 지금 화면 기준점 (GPS 또는 검색)
  let gpsPos = null;       // 마지막 GPS 측위값 — 검색을 지웠을 때 복귀 대상
  let posSource = "gps";   // 지금 기준점을 무엇으로 잡았는지 ("gps" | "search")
  let syncing = false;

  const el = (id) => document.getElementById(id);

  function setStatus(message, kind = "info") {
    const node = el("status");
    node.textContent = message || "";
    node.className = message ? `status status--${kind} status--visible` : "status";
  }

  /* ------------------------------------------------------------- 모드 전환 */

  function applyMode(next) {
    mode = next;
    const showMap = next === "map";

    el("map").hidden = !showMap;
    el("offline").hidden = showMap;
    el("toggle-btn").textContent = showMap ? "목록" : "지도";
    // 지도를 쓸 수 없으면 토글할 곳이 없으므로 버튼을 숨긴다.
    el("toggle-btn").hidden = !mapAvailable;

    if (showMap) {
      OfflineView.hide();
      MapView.refresh();
    } else {
      OfflineView.setOffline(!mapAvailable || !navigator.onLine);
      OfflineView.show();
      setStatus("");
    }
  }

  function toggleMode() {
    applyMode(mode === "map" ? "offline" : "map");
  }

  /* ------------------------------------------------------------------ 위치 */

  function rememberPosition(lat, lng) {
    try {
      localStorage.setItem(LAST_POSITION_KEY, JSON.stringify({ lat, lng }));
    } catch {
      // 사생활 보호 모드 등에서 실패할 수 있다. 위치 기억은 부가 기능이라 무시한다.
    }
  }

  function lastKnownPosition() {
    try {
      const raw = localStorage.getItem(LAST_POSITION_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return typeof value.lat === "number" && typeof value.lng === "number" ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * 화면 기준점을 옮긴다.
   *
   * source는 "gps" 또는 "search"다. 두 뷰가 이 값에 따라 중앙 표시를 달리 그린다 —
   * 검색으로 찍은 지점을 파란 "내 위치"로 보여주면 사용자를 속이는 것이다.
   * GPS 좌표만 gpsPos에 따로 남겨, 검색을 지웠을 때 원래 위치로 돌아갈 수 있게 한다.
   */
  function applyPosition(lat, lng, { center, source = "gps" }) {
    currentPos = { lat, lng };
    posSource = source;
    if (source === "gps") {
      gpsPos = { lat, lng };
      rememberPosition(lat, lng);
    }
    OfflineView.setMyLocation(lat, lng, source);
    if (mapAvailable) MapView.setMyLocation(lat, lng, { center, source });
    // 검색 결과도 이 지점 기준 거리순으로 정렬되게 한다.
    Search.setOrigin(lat, lng);
  }

  function requestLocation({ center }) {
    if (!navigator.geolocation) {
      setStatus("이 브라우저는 위치 기능을 지원하지 않습니다.", "error");
      return;
    }
    if (center) setStatus("현재 위치를 확인하는 중…", "info");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyPosition(position.coords.latitude, position.coords.longitude, { center });
        // 지도 모드라면 곧 render()가 건수를 다시 써준다. 목록 모드에서는
        // 여기서 지우지 않으면 "확인하는 중…"이 화면에 계속 남는다.
        if (center) setStatus("");
      },
      (error) => {
        const reason =
          error.code === error.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다."
            : "현재 위치를 가져오지 못했습니다.";
        // 권한을 못 받아도 마지막 위치가 있으면 목록은 여전히 쓸모가 있다.
        if (center) setStatus(reason, "error");
      },
      // GPS는 네트워크 없이도 동작하지만 첫 측위는 오래 걸릴 수 있다.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  /* ------------------------------------------------------------ 지도 스크립트 */

  /** 지도를 포기하고 목록으로 내려앉는다. 어떤 이유든 앱이 멈추지는 않게 한다. */
  function fallbackToOffline(message) {
    mapAvailable = false;
    applyMode("offline");
    if (message) setStatus(message, "warn");
  }

  function loadMapScript() {
    if (mapScriptTried) return;
    const cfg = window.APP_CONFIG;
    if (!cfg || !cfg.NAVER_MAP_CLIENT_ID || String(cfg.NAVER_MAP_CLIENT_ID).startsWith("YOUR")) {
      setStatus(
        "config.js에 NAVER_MAP_CLIENT_ID가 없어 지도를 표시할 수 없습니다. 목록으로 표시합니다.",
        "error"
      );
      return;
    }
    mapScriptTried = true;

    window.navermap_authFailure = () => {
      fallbackToOffline();
      setStatus(
        "네이버 지도 인증에 실패했습니다. 콘솔의 웹 서비스 URL에 현재 도메인이 등록되어 있는지, " +
          `config.js의 NAVER_MAP_AUTH_PARAM("${cfg.NAVER_MAP_AUTH_PARAM}")이 키 종류와 맞는지 확인해주세요. ` +
          "신규 콘솔 키는 ncpKeyId, 구 콘솔 키는 ncpClientId를 사용합니다.",
        "error"
      );
    };

    const authParam = cfg.NAVER_MAP_AUTH_PARAM || "ncpKeyId";
    const script = document.createElement("script");
    script.src =
      `https://oapi.map.naver.com/openapi/v3/maps.js?${authParam}=` +
      encodeURIComponent(cfg.NAVER_MAP_CLIENT_ID);

    script.onload = () => {
      // 스크립트 파일 자체는 받아졌어도 SDK를 쓸 수 있다는 보장이 없다.
      // 키가 유효하지 않으면 네이버 SDK는 내부 모듈 로드에 실패한 채 로드가 "성공"하고,
      // 이후 생성자 호출에서 터진다. mapAvailable을 미리 켜두면 목록/지도 토글이
      // 깨진 지도로 넘어가므로, 실제로 초기화에 성공한 뒤에만 켠다.
      if (!window.naver || !naver.maps || !naver.maps.Map) {
        fallbackToOffline("지도를 불러오지 못했습니다. 목록으로 표시합니다.");
        return;
      }
      try {
        MapView.init({ containerId: "map", rows, onStatus: setStatus });
      } catch (error) {
        console.warn("지도 초기화 실패 — 목록으로 표시합니다.", error);
        fallbackToOffline("지도를 초기화하지 못했습니다. 목록으로 표시합니다.");
        return;
      }
      mapAvailable = true;
      applyMode("map");
      // 이미 기준점이 있으면 다시 측위하지 않고 그 값을 지도에 얹는다.
      if (currentPos) {
        MapView.setMyLocation(currentPos.lat, currentPos.lng, {
          center: false,
          source: posSource,
        });
      } else {
        requestLocation({ center: false });
      }
    };

    // 오프라인이면 여기로 온다. 예전에는 전체 화면 오버레이로 앱을 막던 지점이다.
    script.onerror = () => {
      // 실패한 태그를 남겨두면 온라인 복귀 때마다 죽은 <script>가 쌓인다.
      script.remove();
      mapScriptTried = false; // 온라인으로 돌아오면 다시 시도할 수 있게 둔다
      mapAvailable = false;
      applyMode("offline");
    };

    document.head.appendChild(script);
  }

  /* ------------------------------------------------------------ 데이터 갱신 */

  async function syncInBackground() {
    // online 이벤트는 연달아 여러 번 올 수 있다. 2~3MB를 중복으로 받지 않게 막는다.
    if (syncing) return;
    syncing = true;

    const firstRun = rows.length === 0;
    try {
      const result = await SyncData.ensureFresh((phase) => {
        if (!firstRun) return; // 이미 데이터가 있으면 조용히 갱신한다
        if (phase === "downloading") setStatus("AED 데이터를 내려받는 중…", "info");
        if (phase === "saving") setStatus("저장하는 중…", "info");
      });

      if (result.status === "updated") {
        rows = result.rows;
        MapView.setRows(rows);
        OfflineView.setRows(rows);
        Search.setRows(rows);
        OfflineView.setMeta(result.meta);
        setStatus(
          `AED ${result.meta.count.toLocaleString()}개를 오프라인용으로 저장했습니다.`,
          "info"
        );
      } else if (result.status === "fresh") {
        OfflineView.setMeta(result.meta);
        if (firstRun) setStatus("");
      } else if (firstRun && !rows.length) {
        setStatus("AED 데이터를 받지 못했습니다. 인터넷 연결을 확인해주세요.", "error");
      }
    } finally {
      // 여기서 풀지 않으면 예외 한 번에 이후 갱신이 영영 막힌다.
      syncing = false;
    }
  }

  /* -------------------------------------------------------------- PWA 설치 */

  function isInstalled() {
    return (
      window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true
    );
  }

  /** 설치 안 한 사용자에게만 상단바 버튼을 보여준다. */
  function refreshInstallButton() {
    el("install-btn").hidden = isInstalled();
  }

  /**
   * 설치 버튼 동작.
   *
   * 자동 설치는 Chromium 계열만 가능하다. iOS Safari에는 프로그램적 설치 API가
   * 아예 없어서(beforeinstallprompt는 Chromium 전용) 안내 시트로 수동 절차를 보여준다.
   * UA를 보고 나누지 않고 prompt 이벤트를 받아뒀는지로 나누는 이유는, 같은 iOS라도
   * 브라우저가 바뀌거나 애플이 나중에 지원하면 자동으로 좋은 경로를 타게 하기 위해서다.
   */
  async function handleInstallClick() {
    if (!deferredInstallPrompt) {
      openInstallSheet();
      return;
    }

    const prompt = deferredInstallPrompt;
    // prompt 이벤트는 일회용이다. 다시 쓰면 예외가 나므로 먼저 비운다.
    // 사용자가 거절해도 Chromium이 나중에 다시 발생시키면 아래 리스너가 재캡처한다.
    deferredInstallPrompt = null;
    try {
      prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome !== "accepted") {
        // 거절한 경우 버튼은 그대로 둔다. 다음에 눌렀을 때는 안내 시트가 뜬다.
        setStatus("설치를 취소했습니다. 언제든 다시 누를 수 있습니다.", "info");
      }
    } catch (error) {
      console.warn("설치 프롬프트 실패 — 수동 안내로 대체합니다.", error);
      openInstallSheet();
    }
  }

  /**
   * 수동 설치 안내. 브라우저마다 경로가 달라 문구만 갈라준다.
   * (여기서만 UA를 본다 — 어떤 메뉴를 누르라고 알려주려면 방법이 없다.)
   */
  function openInstallSheet() {
    const steps = UiUtil.isIOS()
      ? [
          '사파리 아래쪽의 공유 버튼<span class="sheet__key">￪</span>을 누릅니다.',
          '메뉴를 내려 <span class="sheet__key">홈 화면에 추가</span>를 누릅니다.',
          "오른쪽 위 <b>추가</b>를 누르면 끝입니다.",
        ]
      : [
          '브라우저 메뉴<span class="sheet__key">⋮</span>를 엽니다.',
          '<span class="sheet__key">앱 설치</span> 또는 <span class="sheet__key">홈 화면에 추가</span>를 누릅니다.',
        ];

    el("install-steps").innerHTML = steps.map((step) => `<li>${step}</li>`).join("");
    el("install-sheet").hidden = false;
  }

  function closeInstallSheet() {
    el("install-sheet").hidden = true;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    // file://에서는 등록할 수 없다. 로컬 테스트는 HTTP로 서빙할 것.
    navigator.serviceWorker.register("sw.js").catch((error) => {
      console.warn("서비스워커 등록 실패 — 오프라인 지원이 제한됩니다.", error);
    });
  }

  /* ------------------------------------------------------------------ 부팅 */

  async function bootstrap() {
    OfflineView.init({
      canvasId: "offline-canvas",
      listId: "offline-list",
      bannerId: "offline-banner",
      scaleId: "offline-scale",
      compassBtnId: "compass-btn",
    });

    Search.init({
      inputId: "search-input",
      clearId: "search-clear",
      resultsId: "search-results",
      onPick: (row) => {
        // 검색 지점을 기준으로 삼는다. source가 "search"라서 두 뷰가 파란
        // "내 위치"가 아닌 별도 표시로 그린다.
        applyPosition(row.lat, row.lng, { center: true, source: "search" });
        if (mode === "map") setStatus("");
      },
      onClear: () => {
        // 검색을 지우면 GPS 위치로 돌아간다. 없으면 다시 측위를 시도한다 —
        // 기준점이 없는 빈 화면으로 떨어지지 않게 한다.
        if (gpsPos) applyPosition(gpsPos.lat, gpsPos.lng, { center: true, source: "gps" });
        else requestLocation({ center: true });
      },
    });

    el("locate-btn").addEventListener("click", () => {
      // 검색 기준점을 버리고 새로 측위한다. Search.reset()을 쓰면 onClear가
      // 저장된 GPS 좌표로 되돌려버려 "새로 위치를 잡는다"는 기대와 어긋난다.
      Search.clearInput();
      requestLocation({ center: true });
    });
    el("toggle-btn").addEventListener("click", toggleMode);
    el("install-btn").addEventListener("click", handleInstallClick);
    el("install-sheet-close").addEventListener("click", closeInstallSheet);
    // 배경을 눌러도 닫히게 한다 (시트 내부 클릭은 통과시키지 않는다).
    el("install-sheet").addEventListener("click", (event) => {
      if (event.target === el("install-sheet")) closeInstallSheet();
    });

    window.addEventListener("beforeinstallprompt", (event) => {
      // 기본 미니 인포바를 막고 우리 버튼이 시점을 통제한다.
      event.preventDefault();
      deferredInstallPrompt = event;
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      closeInstallSheet();
      refreshInstallButton();
      setStatus("홈 화면에 추가되었습니다.", "info");
    });

    refreshInstallButton();

    // 저장본을 먼저 띄운다. 네트워크를 기다리지 않으므로 오프라인에서도 즉시 화면이 나온다.
    const [storedRows, meta] = await Promise.all([DataStore.loadRows(), DataStore.getMeta()]);
    rows = storedRows;
    OfflineView.setRows(rows);
    OfflineView.setMeta(meta);
    Search.setRows(rows);

    // 위치 권한을 아직 못 받았어도 마지막 위치가 있으면 목록을 정렬해 보여줄 수 있다.
    const last = lastKnownPosition();
    if (last) applyPosition(last.lat, last.lng, { center: false, source: "gps" });

    applyMode("offline");
    loadMapScript();
    requestLocation({ center: false });

    registerServiceWorker();
    syncInBackground();

    window.addEventListener("online", () => {
      if (!mapAvailable) loadMapScript();
      syncInBackground();
    });
    window.addEventListener("offline", () => {
      OfflineView.setOffline(true);
      if (mode === "map") applyMode("offline");
    });
  }

  return { bootstrap };
})();
