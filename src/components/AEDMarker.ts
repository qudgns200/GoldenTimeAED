import type { AEDItem } from '../types/aed';

let activeInfoWindow: kakao.maps.InfoWindow | null = null;

function buildInfoContent(item: AEDItem): string {
  const distance = item.distance !== undefined
    ? `<p class="iw-distance">${item.distance}m</p>`
    : '';
  return `
    <div class="iw-container">
      <p class="iw-label">설치위치</p>
      <p class="iw-value">${item.buildPlace}</p>
      <p class="iw-label">관리기관</p>
      <p class="iw-value">${item.org}</p>
      ${distance}
    </div>
  `;
}

export function createAEDMarker(
  map: kakao.maps.Map,
  item: AEDItem
): kakao.maps.Marker {
  const position = new kakao.maps.LatLng(item.coordinates.lat, item.coordinates.lng);

  // 커스텀 마커 이미지 (SVG 인라인 → data URL)
  const markerSize = new kakao.maps.Size(36, 36);
  const markerImage = new kakao.maps.MarkerImage(
    'data:image/svg+xml;charset=UTF-8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="17" fill="#e53e3e" stroke="#ffffff" stroke-width="2"/>
          <text x="18" y="22" text-anchor="middle" fill="#ffffff" font-size="9" font-weight="bold" font-family="sans-serif">AED</text>
        </svg>`
      ),
    markerSize,
    { offset: new kakao.maps.Point(18, 18) }
  );

  const marker = new kakao.maps.Marker({
    position,
    map,
    image: markerImage,
    title: item.buildPlace,
    clickable: true,
  });

  const infoWindow = new kakao.maps.InfoWindow({
    content: buildInfoContent(item),
    removable: false,
  });

  kakao.maps.event.addListener(marker, 'click', () => {
    if (activeInfoWindow) {
      activeInfoWindow.close();
    }
    if (activeInfoWindow === infoWindow) {
      activeInfoWindow = null;
      return;
    }
    infoWindow.open(map, marker);
    activeInfoWindow = infoWindow;
  });

  return marker;
}

export function clearMarkers(markers: kakao.maps.Marker[]): void {
  if (activeInfoWindow) {
    activeInfoWindow.close();
    activeInfoWindow = null;
  }
  markers.forEach((m) => m.setMap(null));
}
