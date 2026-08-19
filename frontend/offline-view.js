/**
 * 오프라인 뷰 — 지도 타일 없이 동작하는 대체 화면.
 *
 * 왜 지도가 아닌가: 네이버·구글·카카오 등 상용 지도 API는 웹에서 전부 온라인 전용이다.
 * 타일을 매 요청마다 서버에서 받아오고 약관상 저장도 제한된다(docs/OFFLINE_DESIGN.md).
 * 그래서 오프라인에서는 타일 대신 Canvas에 직접 그린다:
 *   - 내 위치를 중심에 두고 주변 AED를 점으로
 *   - 거리 동심원과 방위 눈금
 *   - 나침반(기기 방향)에 따라 회전
 * 아래에는 거리순 목록을 붙인다. 도로는 안 보이지만 "어느 방향으로 몇 m"는 전달된다.
 *
 * 이 뷰는 온라인에서도 토글로 볼 수 있다. 오프라인 전용 코드는 검증되지 않은 채 남아
 * 정작 필요할 때 깨지기 때문이다.
 */
const OfflineView = (() => {
  "use strict";

  // 표시 반경 단계. rings는 그릴 동심원의 반지름(m)으로, 맨 마지막이 표시 반경이다.
  const SCALES = [
    { radius: 200, rings: [50, 100, 200] },
    { radius: 500, rings: [100, 300, 500] },
    { radius: 1000, rings: [250, 500, 1000] },
    { radius: 2000, rings: [500, 1000, 2000] },
  ];
  const DEFAULT_SCALE_INDEX = 1;

  // 캔버스에 찍을 점의 상한. 서울 도심 반경 2km면 수천 개가 잡혀 화면이 뭉개진다.
  const MAX_DOTS = 300;
  // 목록에 올릴 개수. 응급 상황에 스크롤을 오래 하지 않도록 짧게 끊는다.
  const MAX_LIST = 30;
  // 캔버스에 이름표를 붙일 개수.
  const LABELED = 3;

  const COLORS = {
    ring: "#d8dde5",
    ringText: "#8a94a6",
    axis: "#eceff4",
    // AED는 빨간 하트. 가까운 3개도 같은 색이고 크기와 배지로만 구분한다.
    dot: "#d92d20",
    // 순위 배지 — 빨강이 "AED"만을 뜻하도록 역할을 분리한다.
    badge: "#101828",
    me: "#1971c2",
    label: "#212529",
  };

  // 하트 크기(대략 가로 반지름). 가까운 3개는 크게 그려 눈에 먼저 들어오게 한다.
  const DOT_SIZE = 5;
  const DOT_SIZE_NEAR = 8;
  // 순위 배지 반지름. 겹침 판정과 그리기가 같은 값을 써야 한다.
  const BADGE_R = 7;

  let canvas = null;
  let ctx = null;
  let listEl = null;
  let bannerEl = null;
  let scaleEl = null;
  let compassBtn = null;

  let rows = [];
  let meta = null;
  let myPos = null; // { lat, lng }
  let heading = null; // 도(북=0). null이면 나침반 미사용 → 북쪽 고정
  let scaleIndex = DEFAULT_SCALE_INDEX;
  let offline = true;
  let visible = false;

  let hits = []; // 캔버스에 그려진 점의 화면 좌표 (탭 판정용)
  let listItems = []; // 현재 목록에 올라간 { row, distance, bearing }
  let expandedId = null;
  let rafToken = null;
  let compassHandler = null;

  const el = (id) => document.getElementById(id);

  /* ---------------------------------------------------------------- 캔버스 */

  /** 캔버스 해상도를 CSS 크기 × devicePixelRatio로 맞춘다. 안 하면 고밀도 화면에서 뭉갠다. */
  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    rafToken = null;
    if (!ctx || !visible) return;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);
    hits = [];

    const cx = w / 2;
    const cy = h / 2;
    const scale = SCALES[scaleIndex];
    // 가장자리에 이름표가 잘리지 않도록 여백을 둔다.
    const maxPx = Math.min(w, h) / 2 - 26;
    const pxPerMeter = maxPx / scale.radius;

    // 나침반이 켜져 있으면 기기가 향한 쪽이 화면 위가 되도록 지도를 반대로 돌린다.
    const rotation = heading === null ? 0 : -heading * (Math.PI / 180);

    // 그리는 순서 = 겹칠 때의 우선순위. 읽어야 하는 것일수록 나중에 그린다.
    // 점을 먼저 다 찍고 라벨과 내 위치를 그 위에 올려야 밀집 지역에서도 가려지지 않는다.
    drawRings(cx, cy, scale, pxPerMeter);
    drawAxes(cx, cy, maxPx, rotation);

    if (!myPos) {
      drawCenterNotice(cx, cy, "위치를 확인할 수 없습니다");
      return;
    }

    const badges = drawDots(cx, cy, scale, pxPerMeter, rotation);
    drawRingLabels(cx, cy, scale, pxPerMeter);
    drawMe(cx, cy);

    // 순위 배지는 내 위치보다도 나중에 그린다. 도심에서는 가까운 3개가 20m 안쪽에
    // 몰려 중앙의 내 위치 표시에 깔리는데, 그러면 목록과 이어주는 번호가
    // 정작 필요한 상황에서 안 보인다.
    badges.forEach(({ x, y, rank }) => drawRankBadge(x, y, rank));
  }

  function drawRings(cx, cy, scale, pxPerMeter) {
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = COLORS.ring;

    scale.rings.forEach((meters) => {
      ctx.beginPath();
      ctx.arc(cx, cy, meters * pxPerMeter, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.setLineDash([]);
  }

  /** 거리 라벨은 북동 대각선에 둔다. 수직축 위에 두면 N 방위 라벨과 겹친다. */
  function drawRingLabels(cx, cy, scale, pxPerMeter) {
    ctx.font = "11px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    scale.rings.forEach((meters) => {
      const diagonal = Math.SQRT1_2 * meters * pxPerMeter;
      drawHaloText(Geo.formatDistance(meters), cx + diagonal, cy - diagonal, COLORS.ringText);
    });
  }

  /** 점 위에 글자를 얹을 때 흰 테두리를 둘러 배경과 겹쳐도 읽히게 한다. */
  function drawHaloText(text, x, y, color) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** 8방위 눈금. 지도와 함께 회전하므로 N은 항상 실제 북쪽을 가리킨다. */
  function drawAxes(cx, cy, maxPx, rotation) {
    const marks = [
      { label: "N", deg: 0 },
      { label: "E", deg: 90 },
      { label: "S", deg: 180 },
      { label: "W", deg: 270 },
    ];

    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - maxPx, cy);
    ctx.lineTo(cx + maxPx, cy);
    ctx.moveTo(cx, cy - maxPx);
    ctx.lineTo(cx, cy + maxPx);
    ctx.stroke();

    ctx.fillStyle = COLORS.ringText;
    ctx.font = "600 12px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    marks.forEach(({ label, deg }) => {
      const angle = deg * (Math.PI / 180) + rotation;
      const r = maxPx + 13;
      ctx.fillText(label, cx + Math.sin(angle) * r, cy - Math.cos(angle) * r);
    });
  }

  function drawDots(cx, cy, scale, pxPerMeter, rotation) {
    const near = Geo.nearest(rows, myPos.lat, myPos.lng, MAX_DOTS, scale.radius);

    const placed = near.map((item) => {
      const angle = item.bearing * (Math.PI / 180) + rotation;
      const r = item.distance * pxPerMeter;
      const point = { x: cx + Math.sin(angle) * r, y: cy - Math.cos(angle) * r, item };
      hits.push(point);
      return point;
    });

    // 먼 것부터 그린다. 가까운 3개를 먼저 그리면 나머지 수백 개에 덮여 버려,
    // AED가 밀집한 도심에서 정작 필요한 순간에 안 보인다.
    ctx.fillStyle = COLORS.dot;
    for (let i = placed.length - 1; i >= LABELED; i--) {
      UiUtil.heartPath(ctx, placed[i].x, placed[i].y, DOT_SIZE);
      ctx.fill();
    }

    // 가까운 3개는 맨 위에. 큰 하트 + 흰 테두리로 먼저 눈에 들어오게 한다.
    const badges = [];
    // 배지가 피해야 할 것들. 화면 중앙의 내 위치 표시를 먼저 넣어둔다 —
    // 가장 가까운 AED는 중앙 바로 옆이라 그냥 두면 배지가 내 위치를 덮어버린다.
    const obstacles = [{ x: cx, y: cy }];
    placed.slice(0, LABELED).forEach((point, index) => {
      UiUtil.heartPath(ctx, point.x, point.y, DOT_SIZE_NEAR);
      ctx.fillStyle = COLORS.dot;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      const badge = placeBadge(point, obstacles, index + 1);
      obstacles.push(badge);
      badges.push(badge);
    });

    return badges;
  }

  /**
   * 배지를 하트 주변의 빈 자리에 놓는다.
   *
   * 도심에서는 가까운 3개가 같은 건물 안이라 좌표가 거의 같다(예: 셋 다 "남서 20m").
   * 고정 위치에 붙이면 세 배지가 완전히 포개져 하나만 보인다.
   * 그래서 하트를 중심으로 반지름을 넓혀가며 빈 자리를 찾는다 — 좁은 후보만 두면
   * 세 번째 배지가 갈 곳이 없어 첫 배지 위에 얹히게 된다(실제로 그렇게 깨졌다).
   */
  function placeBadge(point, obstacles, rank) {
    const step = BADGE_R * 2 + 2; // 배지끼리 닿지 않는 최소 간격
    const base = DOT_SIZE_NEAR * 0.9;

    // 오른쪽 위를 우선하도록 각도를 -45도에서 시작해 한 바퀴 돈다.
    for (let ring = 0; ring < 4; ring++) {
      const radius = base + ring * step;
      for (let i = 0; i < 8; i++) {
        const angle = (-45 + i * 45) * (Math.PI / 180);
        const x = point.x + Math.cos(angle) * radius;
        const y = point.y + Math.sin(angle) * radius;
        const clash = obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < step);
        if (!clash) return { x, y, rank };
      }
    }
    // 반지름 4단계까지 막히는 일은 배지가 3개뿐이라 일어나지 않는다.
    return { x: point.x + base, y: point.y - base, rank };
  }

  /**
   * 순위 배지. 하트 안이 아니라 오른쪽 위에 붙인다 — 이 크기의 하트 안에 숫자를 넣으면
   * 곡선에 묻혀 읽히지 않는다. 목록의 .aed-item__rank와 같은 색이어야
   * "캔버스의 ②"와 "목록의 ②"가 같은 것으로 이어진다.
   */
  function drawRankBadge(x, y, rank) {
    ctx.beginPath();
    ctx.arc(x, y, BADGE_R, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.badge;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "700 10px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(rank), x, y + 0.5);
  }

  /** 나침반이 켜져 있으면 진행 방향을 나타내는 삼각형, 아니면 방향 없는 원. */
  function drawMe(cx, cy) {
    if (heading === null) {
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.me;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 11);
      ctx.lineTo(cx + 7, cy + 8);
      ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx - 7, cy + 8);
      ctx.closePath();
      ctx.fillStyle = COLORS.me;
      ctx.fill();
    }
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawCenterNotice(cx, cy, text) {
    ctx.fillStyle = COLORS.ringText;
    ctx.font = "13px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy);
  }

  function scheduleDraw() {
    // deviceorientation은 초당 수십 번 발생한다. 프레임당 한 번으로 줄인다.
    if (rafToken !== null) return;
    rafToken = requestAnimationFrame(draw);
  }

  /* ------------------------------------------------------------------ 목록 */

  function renderList() {
    if (!listEl) return;

    if (!rows.length) {
      listEl.innerHTML =
        '<p class="offline-empty">저장된 AED 데이터가 없습니다.<br>인터넷에 연결한 상태로 한 번 열어주세요.</p>';
      listItems = [];
      return;
    }
    if (!myPos) {
      listEl.innerHTML =
        '<p class="offline-empty">위치 권한을 허용하면 가까운 순으로 정렬됩니다.</p>';
      listItems = [];
      return;
    }

    listItems = Geo.nearest(rows, myPos.lat, myPos.lng, MAX_LIST);
    if (!listItems.length) {
      listEl.innerHTML = '<p class="offline-empty">주변에 등록된 AED가 없습니다.</p>';
      return;
    }

    const items = listItems
      .map(({ row, distance, bearing }, index) => {
        const expanded = row.id === expandedId;
        // 간이 지도에 숫자로 표시된 상위 항목과 목록을 눈으로 잇기 위한 배지.
        const rank = index < LABELED ? `<span class="aed-item__rank">${index + 1}</span>` : "";
        return `
        <li class="aed-item${expanded ? " aed-item--open" : ""}" data-id="${row.id}">
          <button class="aed-item__head" type="button" aria-expanded="${expanded}">
            <span class="aed-item__dir">
              <span class="aed-item__arrow">${Geo.bearingArrow(bearing)}</span>
              <span class="aed-item__bearing">${Geo.bearingLabel(bearing)}</span>
            </span>
            ${rank}
            <span class="aed-item__body">
              <span class="aed-item__name">${UiUtil.escapeHtml(row.org_name) || "이름 미상"}</span>
              <span class="aed-item__place">${UiUtil.escapeHtml(row.install_place)}</span>
            </span>
            <span class="aed-item__dist">${Geo.formatDistance(distance)}</span>
          </button>
          ${expanded ? detailBlock(row) : ""}
        </li>`;
      })
      .join("");

    listEl.innerHTML = `<ul class="aed-list">${items}</ul>`;
  }

  function detailBlock(row) {
    return `
      <div class="aed-item__detail">
        ${UiUtil.detailHtml(row)}
        <a class="aed-item__external" href="${UiUtil.externalMapUrl(row)}">지도 앱에서 열기</a>
      </div>`;
  }

  /* ---------------------------------------------------------------- 나침반 */

  function headingFromEvent(event) {
    // iOS는 webkitCompassHeading이 이미 진북 기준 시계방향 각도다.
    if (typeof event.webkitCompassHeading === "number") return event.webkitCompassHeading;
    // 그 외 브라우저는 alpha가 반시계방향이라 뒤집어야 한다. 절대 방위일 때만 신뢰한다.
    if (event.absolute && typeof event.alpha === "number") return (360 - event.alpha) % 360;
    return null;
  }

  function attachCompass() {
    if (compassHandler) return;
    compassHandler = (event) => {
      const next = headingFromEvent(event);
      if (next === null) return;
      heading = next;
      scheduleDraw();
    };
    // absolute 이벤트를 지원하면 그쪽이 진북 기준이라 더 정확하다.
    const type =
      "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(type, compassHandler, true);
    if (compassBtn) {
      compassBtn.hidden = true;
    }
  }

  /** iOS 13+는 사용자 제스처 안에서 권한을 요청해야 한다. 그래서 버튼이 필요하다. */
  async function enableCompass() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return;

    if (typeof DOE.requestPermission === "function") {
      try {
        const result = await DOE.requestPermission();
        if (result !== "granted") return;
      } catch {
        return; // 사용자 제스처 밖에서 호출되면 예외가 난다. 북쪽 고정으로 계속 동작한다.
      }
    }
    attachCompass();
  }

  function detachCompass() {
    if (!compassHandler) return;
    window.removeEventListener("deviceorientationabsolute", compassHandler, true);
    window.removeEventListener("deviceorientation", compassHandler, true);
    compassHandler = null;
    heading = null;
  }

  /* ------------------------------------------------------------------ 배너 */

  function renderBanner() {
    if (!bannerEl) return;
    const updated = meta ? UiUtil.formatUpdatedAt(meta.generated_at) : "";
    const suffix = updated ? ` · 마지막 갱신 ${updated}` : "";

    if (offline) {
      bannerEl.className = "offline-banner offline-banner--warn";
      bannerEl.textContent = `오프라인 — 저장된 데이터로 표시 중${suffix}`;
    } else {
      bannerEl.className = "offline-banner";
      bannerEl.textContent = `목록 보기 — 저장된 데이터${suffix}`;
    }
  }

  function renderScale() {
    if (!scaleEl) return;
    scaleEl.innerHTML = SCALES.map(
      (s, i) =>
        `<button type="button" class="scale-btn${i === scaleIndex ? " scale-btn--on" : ""}" data-index="${i}">${Geo.formatDistance(
          s.radius
        )}</button>`
    ).join("");
  }

  /* ------------------------------------------------------------------- API */

  function init(options) {
    canvas = el(options.canvasId);
    ctx = canvas.getContext("2d");
    listEl = el(options.listId);
    bannerEl = el(options.bannerId);
    scaleEl = el(options.scaleId);
    compassBtn = el(options.compassBtnId);

    scaleEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-index]");
      if (!button) return;
      scaleIndex = Number(button.dataset.index);
      renderScale();
      scheduleDraw();
    });

    compassBtn.addEventListener("click", enableCompass);

    canvas.addEventListener("click", (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      let closest = null;
      let closestDistance = Infinity;
      hits.forEach((hit) => {
        const d = Math.hypot(hit.x - x, hit.y - y);
        if (d < closestDistance) {
          closestDistance = d;
          closest = hit;
        }
      });
      // 손가락 오차를 감안한 판정 반경.
      if (!closest || closestDistance > 18) return;

      expandedId = closest.item.row.id;
      renderList();
      const node = listEl.querySelector(`[data-id="${expandedId}"]`);
      if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    listEl.addEventListener("click", (event) => {
      const head = event.target.closest(".aed-item__head");
      if (!head) return;
      const id = Number(head.closest(".aed-item").dataset.id);
      expandedId = expandedId === id ? null : id;
      renderList();
    });

    window.addEventListener("resize", () => {
      resizeCanvas();
      scheduleDraw();
    });

    // 나침반을 쓸 수 없는 기기에서는 버튼을 숨긴다.
    if (!window.DeviceOrientationEvent) compassBtn.hidden = true;

    renderScale();
    renderBanner();
  }

  function setRows(nextRows) {
    rows = nextRows || [];
    renderList();
    scheduleDraw();
  }

  function setMeta(nextMeta) {
    meta = nextMeta;
    renderBanner();
  }

  function setOffline(isOffline) {
    offline = isOffline;
    renderBanner();
  }

  function setMyLocation(lat, lng) {
    myPos = { lat, lng };
    renderList();
    scheduleDraw();
  }

  function show() {
    visible = true;
    // 숨어 있는 동안에는 크기가 0이라 캔버스 해상도를 잡을 수 없다. 보인 뒤에 맞춘다.
    resizeCanvas();
    renderList();
    scheduleDraw();
  }

  function hide() {
    visible = false;
  }

  return {
    init, setRows, setMeta, setOffline, setMyLocation, show, hide,
    enableCompass, detachCompass,
  };
})();
