import { useEffect, useRef } from 'react';
import type { AEDItem, Coordinates } from '../types/aed';
import { createAEDMarker, clearMarkers } from './AEDMarker';

interface Props {
  center: Coordinates | null;
  aedItems: AEDItem[];
  onMapReady: (map: kakao.maps.Map) => void;
}

const DEFAULT_CENTER: Coordinates = { lat: 37.5665, lng: 126.978 }; // 서울 시청
const DEFAULT_LEVEL = 4; // 카카오맵 레벨 (낮을수록 확대, 4 ≈ 300m 반경)

function loadKakaoMapsScript(appKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.kakao?.maps) {
      resolve();
      return;
    }

    const existing = document.getElementById('kakao-maps-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('카카오맵 로드 실패')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'kakao-maps-script';
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = () => {
      kakao.maps.load(() => resolve());
    };
    script.onerror = () => reject(new Error('카카오맵 스크립트 로드 실패'));
    document.head.appendChild(script);
  });
}

export function MapView({ center, aedItems, onMapReady }: Props) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const markersRef = useRef<kakao.maps.Marker[]>([]);
  const myOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null);

  // 지도 초기화 (최초 1회)
  useEffect(() => {
    const appKey = import.meta.env.VITE_KAKAO_APP_KEY as string;
    if (!appKey || !mapDivRef.current) return;

    loadKakaoMapsScript(appKey)
      .then(() => {
        if (!mapDivRef.current || mapRef.current) return;

        const map = new kakao.maps.Map(mapDivRef.current, {
          center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
          level: DEFAULT_LEVEL,
        });

        mapRef.current = map;
        onMapReady(map);
      })
      .catch((err: unknown) => {
        console.error('카카오맵 초기화 실패:', err);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 중심 좌표 변경 시 지도 이동 + 내 위치 오버레이 갱신
  useEffect(() => {
    if (!mapRef.current || !center) return;

    const latlng = new kakao.maps.LatLng(center.lat, center.lng);
    mapRef.current.setCenter(latlng);

    if (myOverlayRef.current) {
      myOverlayRef.current.setMap(null);
    }
    myOverlayRef.current = new kakao.maps.CustomOverlay({
      position: latlng,
      content: '<div class="my-location-marker"></div>',
      map: mapRef.current,
      zIndex: 10,
    });
  }, [center]);

  // AED 마커 갱신
  useEffect(() => {
    if (!mapRef.current) return;

    clearMarkers(markersRef.current);
    markersRef.current = aedItems.map((item) =>
      createAEDMarker(mapRef.current!, item)
    );
  }, [aedItems]);

  return <div ref={mapDivRef} className="map-container" />;
}
