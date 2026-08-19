/**
 * 온라인 지도 뷰 — 네이버 지도 위에 AED 마커를 표시한다.
 *
 * 데이터는 메모리에 올라온 스냅샷에서 가져온다. Supabase를 직접 조회하지 않으므로
 * 예전에 필요했던 방어 코드(PostgREST 1000행 상한 대응, 넓은 뷰포트 차단,
 * 비동기 요청 순서 경쟁 처리)가 모두 사라졌다.
 */
const MapView = (() => {
  "use strict";

  // 한 화면에 찍을 마커 상한. 데이터는 전량 메모리에 있지만 서울 도심은
  // 반경 11km에 AED가 2,500개가 넘어(frontend/README.md 밀도 표) 다 찍으면
  // 지도가 읽히지 않고 렌더링도 느려진다.
  const MARKER_LIMIT = 400;

  // 지도 이동이 멈춘 뒤 이 시간만큼 기다렸다가 다시 그린다.
  const DEBOUNCE_MS = 200;

  // 하트 마커 한 변(px). 기본 핀보다 작아 밀집 지역에서도 지도가 덜 가려진다.
  const MARKER_PX = 22;

  const SEOUL_CITY_HALL = { lat: 37.5665, lng: 126.978 };
  const DEFAULT_ZOOM = 15;

  let map = null;
  let infoWindow = null;
  let markers = [];
  let myLocationMarker = null;
  let debounceTimer = null;
  let rows = [];
  let onStatus = () => {};

  /**
   * AED 마커 아이콘 — 빨간 하트.
   *
   * ImageIcon(url)을 쓰는 이유는 ui-util.js의 HEART_SVG_URL 주석 참고 —
   * 한 화면에 400개까지 찍으므로 HtmlIcon(content)은 쓰지 않는다.
   * 네이버가 아이콘 객체를 내부에서 보관하므로 공유하지 않고 매번 새로 만든다
   * (문자열 URL은 재사용되므로 이미지 디코드는 한 번뿐이다).
   */
  function heartIcon() {
    return {
      url: UiUtil.HEART_SVG_URL,
      size: new naver.maps.Size(MARKER_PX, MARKER_PX),
      scaledSize: new naver.maps.Size(MARKER_PX, MARKER_PX),
      // 핀이 아니라 심볼이므로 좌표에 중앙을 맞춘다.
      anchor: new naver.maps.Point(MARKER_PX / 2, MARKER_PX / 2),
    };
  }

  function clearMarkers() {
    markers.forEach((m) => m.setMap(null));
    markers = [];
  }

  function render() {
    const bounds = map.getBounds();
    const sw = bounds.getSW();
    const ne = bounds.getNE();

    const result = Geo.withinBounds(
      rows, sw.lat(), sw.lng(), ne.lat(), ne.lng(), MARKER_LIMIT
    );

    clearMarkers();
    result.rows.forEach((aed) => {
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(aed.lat, aed.lng),
        map,
        title: aed.org_name || "AED",
        icon: heartIcon(),
      });
      naver.maps.Event.addListener(marker, "click", () => {
        infoWindow.setContent(UiUtil.detailHtml(aed));
        infoWindow.open(map, marker);
      });
      markers.push(marker);
    });

    if (!rows.length) {
      onStatus("AED 데이터를 아직 받지 못했습니다.", "warn");
    } else if (result.truncated) {
      onStatus(
        `이 영역의 ${result.total.toLocaleString()}개 중 가까운 ${result.rows.length}개를 표시했습니다.`,
        "warn"
      );
    } else if (!result.rows.length) {
      onStatus("이 영역에는 등록된 AED가 없습니다.", "hint");
    } else {
      onStatus(`${result.rows.length.toLocaleString()}개 표시 중`, "info");
    }
  }

  function scheduleRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, DEBOUNCE_MS);
  }

  /** 네이버 지도 스크립트가 로드된 뒤에만 호출할 것. */
  function init(options) {
    onStatus = options.onStatus || onStatus;
    rows = options.rows || [];

    map = new naver.maps.Map(options.containerId, {
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

    naver.maps.Event.addListener(map, "idle", scheduleRender);
    naver.maps.Event.addListener(map, "click", () => infoWindow.close());

    render();
  }

  function isReady() {
    return map !== null;
  }

  function setRows(nextRows) {
    rows = nextRows || [];
    if (map) scheduleRender();
  }

  /** 숨겼다가 다시 보일 때 호출. 숨은 동안 크기가 0이었으므로 지도에 알려줘야 한다. */
  function refresh() {
    if (!map) return;
    naver.maps.Event.trigger(map, "resize");
    scheduleRender();
  }

  function setMyLocation(lat, lng, { center = true } = {}) {
    if (!map) return;
    const here = new naver.maps.LatLng(lat, lng);

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

    if (center) {
      map.setCenter(here);
      map.setZoom(Math.max(map.getZoom(), DEFAULT_ZOOM));
      // setCenter/setZoom이 idle을 발생시켜 render가 이어진다.
    }
  }

  return { init, isReady, setRows, refresh, setMyLocation };
})();
