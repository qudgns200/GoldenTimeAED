/**
 * 지도 뷰와 오프라인 뷰가 함께 쓰는 표시용 헬퍼.
 */
const UiUtil = (() => {
  "use strict";

  function escapeHtml(value) {
    if (value === null || value === undefined || value === "") return "";
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  /**
   * AED 상세 정보 HTML. 지도의 정보창과 오프라인 목록의 상세가 같은 내용을 보여준다.
   *
   * 전화번호는 원본에서 일부 마스킹되어 온다(예: 02-******). 걸 수 없으므로 링크로 만들지 않는다.
   */
  function detailHtml(aed) {
    const name = escapeHtml(aed.org_name) || "이름 미상";
    const place = escapeHtml(aed.install_place);
    const address = escapeHtml(aed.address_road);
    const phone = escapeHtml(aed.phone);

    return `
      <div class="iw">
        <h3 class="iw__title">${name}</h3>
        ${place ? `<p class="iw__row"><span>설치위치</span>${place}</p>` : ""}
        ${address ? `<p class="iw__row"><span>주소</span>${address}</p>` : ""}
        ${phone ? `<p class="iw__row"><span>관리자</span>${phone}</p>` : ""}
      </div>`;
  }

  /** iPadOS 13+는 데스크톱 Safari로 위장하므로 터치 지원 여부로 가려낸다. */
  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function isAndroid() {
    return /Android/.test(navigator.userAgent);
  }

  /**
   * 외부 지도 앱으로 좌표를 넘기는 링크.
   *
   * 오프라인이어도 사용자가 그 앱에 오프라인 지도를 받아뒀다면 열린다.
   * 우리가 보장할 수 없는 조건이라 "되면 좋은" 보조 수단으로만 제공한다.
   *
   * 플랫폼마다 받아주는 형식이 다르다. 하나로 통일할 수 없다:
   *   iOS      geo: 스킴을 아예 등록하지 않아 Safari가 "주소가 유효하지 않습니다"를 낸다.
   *            애플이 문서화한 maps.apple.com 링크를 쓰면 Maps 앱이 열린다.
   *   안드로이드 geo:가 표준이고, 설치된 지도 앱 중에서 고르는 창이 뜬다.
   *   데스크톱   지도 앱이 없으므로 웹 지도로 보낸다.
   */
  function externalMapUrl(aed) {
    const label = encodeURIComponent(aed.org_name || "AED");
    if (isIOS()) {
      return `https://maps.apple.com/?ll=${aed.lat},${aed.lng}&q=${label}`;
    }
    if (isAndroid()) {
      return `geo:${aed.lat},${aed.lng}?q=${aed.lat},${aed.lng}(${label})`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${aed.lat},${aed.lng}`;
  }

  /* ------------------------------------------------------------------ 하트 도형
     AED = 심장충격기라는 정체성과 맞고, 파란색 "내 위치"와 색으로 구분된다.
     지도 뷰와 오프라인 캔버스가 같은 모양을 써야 하므로 여기 모아둔다. */

  const HEART_COLOR = "#d92d20"; // styles.css의 --accent와 같은 값

  // Material Design의 favorite 아이콘 경로. 24x24 viewBox 기준.
  const HEART_PATH =
    "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3" +
    "c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5" +
    "c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";

  /**
   * 네이버 지도 마커용 하트 아이콘 (data URI).
   *
   * HtmlIcon(content)이 아니라 ImageIcon(url)으로 쓰기 위한 것이다. 한 화면에 최대
   * 400개를 찍는데 HTML 마커는 DOM 노드를 그만큼 만들어 모바일에서 눈에 띄게 느려진다.
   * 문자열 상수 하나를 재사용하므로 브라우저가 이미지를 한 번만 디코드한다.
   *
   * encodeURIComponent는 필수다. fill="#d92d20"의 #을 그대로 두면 URI가 거기서 잘린다.
   */
  const HEART_SVG_URL =
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22">` +
        `<path d="${HEART_PATH}" fill="${HEART_COLOR}" stroke="#fff" stroke-width="1.6"` +
        ` stroke-linejoin="round"/></svg>`
    );

  /**
   * Canvas에 하트 경로를 만든다. beginPath까지만 하고 fill/stroke는 호출부가 정한다.
   * (x, y)가 하트의 시각적 중심, size는 대략 가로 반지름이다.
   */
  function heartPath(ctx, x, y, size) {
    const s = size;
    ctx.beginPath();
    // 아래 꼭짓점에서 시작해 좌우 곡선을 그린다.
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.5, y - s * 0.15, x - s * 0.85, y - s * 1.25, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.85, y - s * 1.25, x + s * 1.5, y - s * 0.15, x, y + s * 0.9);
    ctx.closePath();
  }

  /** "8월 18일 01:30" 형태. 갱신 시각을 배너에 짧게 보여주기 위한 것. */
  function formatUpdatedAt(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes()
    ).padStart(2, "0")}`;
  }

  return {
    escapeHtml, detailHtml, externalMapUrl, formatUpdatedAt, isIOS, isAndroid,
    HEART_COLOR, HEART_SVG_URL, heartPath,
  };
})();
