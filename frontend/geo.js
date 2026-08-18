/**
 * 좌표 계산 — 거리, 방위, 뷰포트/최근접 필터.
 *
 * 오프라인에서도 동작해야 하므로 네트워크에 의존하는 계산은 하나도 없다.
 * 전량(약 62,000건)을 선형 스캔하지만 지도 idle이나 위치 변경 시에만 실행되고
 * 수 ms 수준이라 별도 공간 인덱스를 두지 않는다.
 */
const Geo = (() => {
  "use strict";

  const EARTH_RADIUS_M = 6371000;
  const DEG_TO_RAD = Math.PI / 180;

  // 16방위는 응급 상황에서 오히려 읽기 어렵다. 8방위로 단순화한다.
  const COMPASS_LABELS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  const COMPASS_ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

  /** 두 좌표 사이의 대권 거리(미터). 하버사인. */
  function distanceMeters(lat1, lng1, lat2, lng2) {
    const dLat = (lat2 - lat1) * DEG_TO_RAD;
    const dLng = (lng2 - lng1) * DEG_TO_RAD;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** 1번 지점에서 2번 지점을 바라보는 방위각(도). 북=0, 시계방향. */
  function bearingDeg(lat1, lng1, lat2, lng2) {
    const φ1 = lat1 * DEG_TO_RAD;
    const φ2 = lat2 * DEG_TO_RAD;
    const Δλ = (lng2 - lng1) * DEG_TO_RAD;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) / DEG_TO_RAD + 360) % 360;
  }

  function compassIndex(deg) {
    // 45도 구간의 경계가 아니라 중앙에 라벨이 오도록 22.5도를 더해 반올림한다.
    return Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  }

  function bearingLabel(deg) {
    return COMPASS_LABELS[compassIndex(deg)];
  }

  function bearingArrow(deg) {
    return COMPASS_ARROWS[compassIndex(deg)];
  }

  /** 사람이 읽는 거리 문자열. 1km 미만은 10m 단위로 끊어 과한 정밀도를 피한다. */
  function formatDistance(meters) {
    // 반올림을 먼저 한다. 나중에 하면 999m가 "1000m"로 나와 "1.0km"와 나란히 보인다.
    const rounded = Math.round(meters / 10) * 10;
    if (rounded < 1000) return `${rounded}m`;
    if (rounded < 10000) return `${(rounded / 1000).toFixed(1)}km`;
    return `${Math.round(rounded / 1000)}km`;
  }

  /**
   * 기준점에서 가까운 순으로 최대 limit개를 반환한다.
   * 각 항목에 distance(m)와 bearing(도)을 붙여준다.
   */
  function nearest(rows, lat, lng, limit, maxMeters) {
    const scored = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const distance = distanceMeters(lat, lng, row.lat, row.lng);
      if (maxMeters && distance > maxMeters) continue;
      scored.push({ row, distance, bearing: bearingDeg(lat, lng, row.lat, row.lng) });
    }
    scored.sort((a, b) => a.distance - b.distance);
    return limit ? scored.slice(0, limit) : scored;
  }

  /**
   * 뷰포트(남서~북동) 안의 AED를 반환한다.
   * 개수가 limit을 넘으면 뷰포트 중심에서 가까운 순으로 자른다 —
   * 무작위로 자르면 지도를 조금만 움직여도 표시되는 마커가 튄다.
   */
  function withinBounds(rows, swLat, swLng, neLat, neLng, limit) {
    const inside = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.lat >= swLat && row.lat <= neLat && row.lng >= swLng && row.lng <= neLng) {
        inside.push(row);
      }
    }
    if (!limit || inside.length <= limit) return { rows: inside, truncated: false };

    const centerLat = (swLat + neLat) / 2;
    const centerLng = (swLng + neLng) / 2;
    inside.sort(
      (a, b) =>
        distanceMeters(centerLat, centerLng, a.lat, a.lng) -
        distanceMeters(centerLat, centerLng, b.lat, b.lng)
    );
    return { rows: inside.slice(0, limit), truncated: true, total: inside.length };
  }

  return {
    distanceMeters,
    bearingDeg,
    bearingLabel,
    bearingArrow,
    formatDistance,
    nearest,
    withinBounds,
  };
})();
