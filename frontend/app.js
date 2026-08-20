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

  /*
   * 측위 파라미터 — "내 위치가 바로 안 잡힌다"의 정체.
   *
   * enableHighAccuracy:true 하나만 쓰면 브라우저는 GPS 칩이 위성을 잡을 때까지
   * 기다린다. 실내나 콜드 스타트에서는 10~30초가 예사고, 그동안 화면에는 아무
   * 위치도 찍히지 않는다. 그래서 두 단계로 나눈다.
   *
   *   1) 대략 측위(기지국·Wi-Fi) — 보통 1초 안에 온다. 오차 수백 m지만
   *      "지금 화면을 어디에 놓을지"를 정하기에는 충분하다.
   *   2) 정밀 측위(GPS) — 뒤에서 watch로 돌리며 좌표를 조여간다.
   *
   * 둘을 동시에 쏴서 먼저 오는 쪽으로 화면을 띄우고, 더 정확한 값이 오면 갈아끼운다.
   * 권한 프롬프트는 둘이 공유하므로 사용자에게 두 번 뜨지 않는다.
   */
  const COARSE_OPTIONS = { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 };
  const FINE_OPTIONS = { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 };
  // 이만큼 정확해지면 목적을 달성했다고 보고 watch를 끊는다 (m).
  const GOOD_ACCURACY_M = 40;
  // 정밀 측위를 붙잡고 있을 최대 시간. 계속 켜두면 배터리를 먹는다.
  const REFINE_BUDGET_MS = 30000;
  // 정밀화된 좌표가 이만큼 어긋났을 때만 지도를 다시 옮긴다 (m).
  // 매 갱신마다 옮기면 사용자가 지도를 만지는 중에 화면이 튄다.
  const RECENTER_THRESHOLD_M = 120;

  let rows = [];
  let mode = "offline"; // "map" | "offline"
  let mapAvailable = false;
  let mapScriptTried = false;
  let deferredInstallPrompt = null;
  let currentPos = null;   // 지금 화면 기준점 (GPS 또는 검색)
  let gpsPos = null;       // 마지막 GPS 측위값 — 검색을 지웠을 때 복귀 대상
  let posSource = "gps";   // 지금 기준점을 무엇으로 잡았는지 ("gps" | "search")
  let syncing = false;
  let watchId = null;      // 정밀 측위 watch 핸들
  let refineTimer = null;  // 정밀 측위 제한 시간
  let attempt = null;      // 진행 중인 측위 시도 (아래 requestLocation 참고)
  let lastFixAt = 0;       // 마지막으로 실제 측위에 성공한 시각

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

  function stopRefining() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    clearTimeout(refineTimer);
    refineTimer = null;
  }

  /** 시도를 닫는다. 여기서 attempt를 비우지 않으면 다음 '내 위치'가 먹히지 않는다. */
  function finishAttempt() {
    stopRefining();
    attempt = null;
  }

  /** 두 단계 중 하나가 좌표를 들고 왔다. 더 정확한 값만 채택한다. */
  function acceptFix(position) {
    if (!attempt) return;
    const { latitude: lat, longitude: lng } = position.coords;
    const accuracy =
      typeof position.coords.accuracy === "number" ? position.coords.accuracy : Infinity;

    // 대략 측위와 정밀 측위가 뒤섞여 도착하므로, 이미 더 좋은 값을 받았으면 무시한다.
    if (attempt.bestAccuracy !== null && accuracy > attempt.bestAccuracy) return;
    attempt.bestAccuracy = accuracy;
    lastFixAt = Date.now();

    // 첫 좌표에서는 무조건 옮기고, 이후에는 눈에 띄게 어긋났을 때만 옮긴다.
    const centeredAt = attempt.centeredAt;
    const center =
      attempt.center &&
      (!centeredAt ||
        Geo.distanceMeters(centeredAt.lat, centeredAt.lng, lat, lng) > RECENTER_THRESHOLD_M);
    if (center) attempt.centeredAt = { lat, lng };

    applyPosition(lat, lng, { center });
    // 지도 모드라면 곧 render()가 건수를 다시 써준다. 목록 모드에서는
    // 여기서 지우지 않으면 "확인하는 중…"이 화면에 계속 남는다.
    if (attempt.notify) setStatus("");

    if (accuracy <= GOOD_ACCURACY_M) finishAttempt();
  }

  /**
   * 한쪽 단계가 실패했다. 다른 쪽이 아직 살아 있거나 이미 좌표를 받았으면 조용히 넘긴다.
   * 둘 다 실패했을 때만 사용자에게 이유를 알린다.
   */
  function handleFixError(error) {
    if (!attempt) return;
    attempt.pending -= 1;
    if (error.code === error.PERMISSION_DENIED) {
      // 권한이 없으면 나머지 한쪽도 같은 이유로 실패한다. 기다릴 필요가 없다.
      attempt.denied = true;
      attempt.pending = 0;
    }
    if (attempt.pending > 0) return;

    // 권한을 못 받아도 마지막 위치가 있으면 목록은 여전히 쓸모가 있다.
    if (attempt.bestAccuracy === null && attempt.notify) {
      setStatus(
        attempt.denied
          ? "위치 권한이 거부되었습니다. 주소창의 자물쇠 또는 휴대폰 설정에서 위치 접근을 허용해주세요."
          : "현재 위치를 가져오지 못했습니다. 실내라면 창가나 야외에서 다시 눌러주세요.",
        "error"
      );
    }
    finishAttempt();
  }

  /**
   * 현재 위치를 잡는다.
   *
   * center: 잡히면 지도를 그 위로 옮길지. notify: 진행 상황을 상태줄에 쓸지
   * (부팅 때는 데이터 다운로드 안내와 겹치므로 끈다).
   */
  function requestLocation({ center, notify = center }) {
    if (!navigator.geolocation) {
      setStatus("이 브라우저는 위치 기능을 지원하지 않습니다.", "error");
      return;
    }

    // 이미 측위 중이면 새로 쏘지 않고 진행 중인 시도의 목표만 올린다.
    // (부팅 직후 지도 로드가 끝나 다시 요청하는 경우가 여기 걸린다.)
    if (attempt) {
      attempt.center = attempt.center || center;
      attempt.notify = attempt.notify || notify;
      // 다음 좌표에서 반드시 한 번 옮기게 한다. 사용자가 지도를 옮겨놓고
      // '내 위치'를 누른 경우 이걸 비우지 않으면 화면이 그대로 있는다.
      if (center) attempt.centeredAt = null;
      if (notify && attempt.bestAccuracy === null) setStatus("현재 위치를 확인하는 중…", "info");
      return;
    }

    stopRefining();
    attempt = {
      center,
      notify,
      pending: 2,          // 대략 측위 + 정밀 측위
      bestAccuracy: null,  // 지금까지 채택한 좌표의 오차(m)
      centeredAt: null,    // 마지막으로 지도를 옮긴 좌표
      denied: false,
    };
    if (notify) setStatus("현재 위치를 확인하는 중…", "info");

    // 1단계 — 기지국·Wi-Fi 기반. 화면에 뭐라도 빨리 띄우는 게 목적이다.
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (attempt) attempt.pending -= 1;
        acceptFix(position);
      },
      handleFixError,
      COARSE_OPTIONS
    );

    // 2단계 — GPS. watch로 받아 좌표가 조여질 때마다 갱신한다.
    watchId = navigator.geolocation.watchPosition(acceptFix, handleFixError, FINE_OPTIONS);

    refineTimer = setTimeout(() => {
      // 시간이 다 됐다. 지금까지 받은 값이 있으면 그걸로 충분하다고 본다.
      if (attempt && attempt.bestAccuracy === null && attempt.notify) {
        setStatus("현재 위치를 가져오지 못했습니다. 잠시 후 다시 눌러주세요.", "error");
      }
      finishAttempt();
    }, REFINE_BUDGET_MS);
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
      // 지도는 부팅 뒤에 늦게 뜬다. 그 사이에 잡힌 기준점이 있으면 그 위에서
      // 시작한다 — 여기서 center를 끄면 사용자가 '내 위치'를 누를 때까지
      // 지도가 서울시청에 머물러 "위치가 안 잡힌다"로 보인다.
      if (currentPos) {
        MapView.setMyLocation(currentPos.lat, currentPos.lng, {
          center: true,
          source: posSource,
        });
      }
      // 측위가 진행 중이면 requestLocation이 그 시도에 center만 켜준다.
      // 방금 잡은 좌표가 있으면(위에서 이미 그 위에 지도를 놓았다) 다시 쏘지 않는다.
      const stale = Date.now() - lastFixAt > 60000;
      if (posSource !== "search" && (attempt || stale)) {
        requestLocation({ center: true, notify: false });
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
      // 새 좌표는 몇 초 뒤에 온다. 이미 아는 위치가 있으면 먼저 그리로 옮겨
      // 버튼이 즉시 반응하게 한다. 갱신되면 그 위에서 미세하게 움직일 뿐이다.
      if (gpsPos) applyPosition(gpsPos.lat, gpsPos.lng, { center: true, source: "gps" });
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

    // 측위를 가장 먼저 쏜다. 아래 IndexedDB 읽기는 스냅샷이 10MB라 모바일에서
    // 1~2초가 걸리는데, 그동안 권한 프롬프트조차 뜨지 않으면 첫 좌표가 그만큼
    // 늦어진다. 측위는 화면 준비 상태와 무관하게 진행할 수 있다.
    requestLocation({ center: true, notify: false });

    // 저장본을 먼저 띄운다. 네트워크를 기다리지 않으므로 오프라인에서도 즉시 화면이 나온다.
    const [storedRows, meta] = await Promise.all([DataStore.loadRows(), DataStore.getMeta()]);
    rows = storedRows;
    OfflineView.setRows(rows);
    OfflineView.setMeta(meta);
    Search.setRows(rows);

    // 위치 권한을 아직 못 받았어도 마지막 위치가 있으면 목록을 정렬해 보여줄 수 있다.
    // 이미 측위가 끝났으면(위에서 먼저 쏜다) 그 좌표를 오래된 값으로 덮지 않는다.
    if (!currentPos) {
      const last = lastKnownPosition();
      if (last) applyPosition(last.lat, last.lng, { center: true, source: "gps" });
    }

    applyMode("offline");
    loadMapScript();

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
