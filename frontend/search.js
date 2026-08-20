/**
 * 기관명·주소 검색 — 기기에 저장된 스냅샷만으로 동작한다.
 *
 * 왜 지오코딩 API를 쓰지 않는가: 외부 API를 붙이면 오프라인에서 검색이 죽는다.
 * 이 앱은 인터넷 없이 동작하는 것이 존재 이유이므로, 이미 메모리에 올라온 61,717건을
 * 직접 훑는다. 대가는 "AED가 없는 임의 주소는 찾을 수 없다"는 것인데,
 * AED를 찾는 것이 목적이므로 AED 레코드를 검색하는 편이 오히려 자연스럽다.
 *
 * PC 브라우저는 GPS가 없어 위치 추정이 부정확하거나 거부되기 쉽다. 그때 이 검색이
 * 유일한 진입 경로가 된다.
 */
const Search = (() => {
  "use strict";

  // 타이핑이 멈춘 뒤 이만큼 기다렸다가 훑는다.
  const DEBOUNCE_MS = 150;
  // 한 글자로는 후보가 수천 개라 의미가 없다.
  const MIN_QUERY = 2;
  const MAX_RESULTS = 20;

  let rows = [];
  let inputEl = null;
  let clearEl = null;
  let resultsEl = null;
  let onPick = () => {};
  let onClear = () => {};

  // 결과 정렬 기준점. 없으면(위치 권한 없는 PC 등) 필드 우선순위로 정렬한다.
  let origin = null;

  let debounceTimer = null;
  let current = []; // 지금 화면에 뜬 후보

  const el = (id) => document.getElementById(id);

  /**
   * 부분일치 검색.
   *
   * 공백 정규화는 하지 않는다 — 실제 질의("강남구", "테헤란로", "덕수궁")는 데이터에
   * 그대로 들어 있는 토큰이고, 공백을 지워도 "서울시청"↔"서울특별시청"은 어차피
   * 매칭되지 않는다. 61,717행 × 정규화 문자열을 캐시하면 수 MB를 더 쓰는데 이득이 없다.
   *
   * **상한에 걸리면 스캔을 멈추지 않고 전량을 훑은 뒤 정렬한다.** 스냅샷이 좌표순
   * (남→북)이라 조기 종료하면 서울에 있는 사용자가 "중구"를 검색해도 부산 중구만
   * 나온다(실제로 그렇게 깨졌다). 61,717행 선형 스캔은 수 ms라 전량을 보는 편이 낫다.
   */
  function find(query) {
    const q = query.trim().toLowerCase();
    if (q.length < MIN_QUERY) return [];

    const found = [];
    // 같은 기관에 AED가 여러 대 있다. 중복 제거 없이는 "서울특별시청"이 수십 줄로 도배된다.
    const seen = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const org = row.org_name || "";
      const addr = row.address_road || "";
      const place = row.install_place || "";

      // 어느 필드에서 맞았는지 기억한다. 위치를 모를 때의 정렬 기준이 된다.
      let field = 0;
      let at = org.toLowerCase().indexOf(q);
      if (at === -1) {
        field = 1;
        at = place.toLowerCase().indexOf(q);
      }
      if (at === -1) {
        field = 2;
        at = addr.toLowerCase().indexOf(q);
      }
      if (at === -1) continue;

      // 같은 기관·같은 건물을 한 줄로 묶는다.
      //
      // 주소로 묶으면 안 된다 — address_road에 층 표기까지 들어 있어
      // "…세종대로 110, 서울특별시청 지하 1층"과 "…시민청 지하 1,2층"이 다른 문자열이 되고,
      // 좌표도 5~8m 어긋나 같은 '서울갤러리'가 두 줄로 나온다(실제로 그렇게 깨졌다).
      // 소수점 3자리(약 100m)로 뭉개면 같은 건물은 합쳐지고, 같은 이름의 다른 지점은
      // 좌표가 충분히 떨어져 있어 그대로 남는다. 여기 목록은 '갈 곳'을 고르는 용도이고
      // 건물 안의 개별 AED는 이동한 뒤 아래 목록에서 전부 볼 수 있다.
      const key = `${org}|${row.lat.toFixed(3)}|${row.lng.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ row, field, at });
    }

    sortByRelevance(found);
    return found.slice(0, MAX_RESULTS).map((m) => m.row);
  }

  /**
   * 기준점을 알면 거리순이 답이다 — AED는 가까운 것이 쓸모 있는 것이다.
   * 모를 때(위치 권한 없는 PC 등)는 기관명에서 맞은 것을 주소에서 맞은 것보다 앞에 둔다.
   * "시청"을 쳤을 때 이름이 시청인 곳이 먼저 나와야 하고, 주소에 우연히 들어간 곳이
   * 앞을 차지하면 안 된다.
   */
  function sortByRelevance(matches) {
    if (origin) {
      matches.forEach((m) => {
        m.distance = Geo.distanceMeters(origin.lat, origin.lng, m.row.lat, m.row.lng);
      });
      matches.sort((a, b) => a.distance - b.distance);
      return;
    }
    matches.sort((a, b) => a.field - b.field || a.at - b.at);
  }

  function render(results, query) {
    current = results;

    if (!results.length) {
      const tooShort = query.trim().length > 0 && query.trim().length < MIN_QUERY;
      resultsEl.innerHTML = `<li class="search__empty">${
        tooShort ? `${MIN_QUERY}글자 이상 입력해주세요.` : "검색 결과가 없습니다."
      }</li>`;
      resultsEl.hidden = false;
      return;
    }

    resultsEl.innerHTML = results
      .map(
        (row, index) => `
        <li class="search__item" role="option" data-index="${index}" tabindex="-1">
          <span class="search__name">${UiUtil.escapeHtml(row.org_name) || "이름 미상"}</span>
          <span class="search__addr">${UiUtil.escapeHtml(row.address_road)}</span>
        </li>`
      )
      .join("");
    resultsEl.hidden = false;
  }

  function close() {
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    current = [];
  }

  function pick(index) {
    const row = current[index];
    if (!row) return;
    // 어느 지점을 기준으로 보고 있는지 입력창에 남겨둔다.
    inputEl.value = row.org_name || row.address_road || "";
    clearEl.hidden = false;
    close();
    onPick(row);
  }

  /** 입력창만 비운다. onClear는 부르지 않는다 — 호출부가 기준점을 직접 정할 때 쓴다. */
  function clearInput() {
    inputEl.value = "";
    clearEl.hidden = true;
    close();
  }

  /** 사용자가 × 를 눌렀을 때. 기준점을 되돌리라고 호출부에 알린다. */
  function reset() {
    clearInput();
    onClear();
  }

  function handleInput() {
    const query = inputEl.value;
    clearEl.hidden = query.length === 0;

    clearTimeout(debounceTimer);
    if (!query.trim()) {
      close();
      return;
    }
    debounceTimer = setTimeout(() => render(find(query), query), DEBOUNCE_MS);
  }

  function init(options) {
    inputEl = el(options.inputId);
    clearEl = el(options.clearId);
    resultsEl = el(options.resultsId);
    onPick = options.onPick || onPick;
    onClear = options.onClear || onClear;

    inputEl.addEventListener("input", handleInput);

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        // 디바운스가 아직 안 끝났을 수 있으니 즉시 훑어서 첫 후보를 고른다.
        if (!current.length) render(find(inputEl.value), inputEl.value);
        pick(0);
      } else if (event.key === "Escape") {
        close();
      }
    });

    resultsEl.addEventListener("click", (event) => {
      const item = event.target.closest("[data-index]");
      if (item) pick(Number(item.dataset.index));
    });

    clearEl.addEventListener("click", reset);

    // 바깥을 누르면 후보 목록을 닫는다. 지도를 조작하려는 것을 방해하지 않기 위해서다.
    document.addEventListener("click", (event) => {
      if (!resultsEl.hidden && !event.target.closest(".search")) close();
    });
  }

  function setRows(nextRows) {
    rows = nextRows || [];
  }

  /** 결과를 거리순으로 정렬할 기준점. app.js가 기준점을 옮길 때마다 알려준다. */
  function setOrigin(lat, lng) {
    origin = lat === null || lng === null ? null : { lat, lng };
  }

  return { init, setRows, setOrigin, reset, clearInput };
})();
