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

  /**
   * 외부 지도 앱으로 좌표를 넘기는 링크.
   *
   * 오프라인이어도 사용자가 그 앱에 오프라인 지도를 받아뒀다면 열린다.
   * 우리가 보장할 수 없는 조건이라 "되면 좋은" 보조 수단으로만 제공한다.
   * geo: 스킴은 안드로이드/일부 데스크톱에서 기본 지도 앱을 연다.
   */
  function externalMapUrl(aed) {
    const label = encodeURIComponent(aed.org_name || "AED");
    return `geo:${aed.lat},${aed.lng}?q=${aed.lat},${aed.lng}(${label})`;
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

  return { escapeHtml, detailHtml, externalMapUrl, formatUpdatedAt };
})();
