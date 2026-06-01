import { useEffect, useRef, useState, useCallback } from 'react';
import type { Coordinates } from '../types/aed';
import { useLocation } from '../hooks/useLocation';
import { useAED } from '../hooks/useAED';
import { MapView } from '../components/MapView';
import { SearchBar } from '../components/SearchBar';
import { LocationButton } from '../components/LocationButton';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { geocodeAddress } from '../services/geocodingService';

export function HomePage() {
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const [mapCenter, setMapCenter] = useState<Coordinates | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const { fetchLocation, isLoading: locationLoading, permissionDenied } = useLocation();
  const { items: aedItems, isLoading: aedLoading, error: aedError, loadAED } = useAED();

  const isLoading = locationLoading || aedLoading || searchLoading;

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  async function moveToAndLoad(coords: Coordinates) {
    setMapCenter(coords);
    await loadAED(coords);
  }

  // 앱 시작 시 위치 조회
  useEffect(() => {
    fetchLocation().then((coords) => {
      if (coords) moveToAndLoad(coords);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // AED 없음 / 에러 토스트
  useEffect(() => {
    if (aedError) {
      showToast(aedError);
    } else if (!aedLoading && mapCenter && aedItems.length === 0) {
      showToast('주변 300m 내 AED가 없습니다.');
    }
  }, [aedItems, aedError, aedLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(async (query: string) => {
    setSearchLoading(true);
    try {
      const coords = await geocodeAddress(query);
      await moveToAndLoad(coords);
    } catch {
      showToast('검색 결과가 없습니다.');
    } finally {
      setSearchLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMyLocation = useCallback(async () => {
    const coords = await fetchLocation();
    if (coords) await moveToAndLoad(coords);
  }, [fetchLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app-container">
      <SearchBar onSearch={handleSearch} isLoading={isLoading} />

      {permissionDenied && (
        <div className="permission-notice">
          현재 위치를 확인할 수 없습니다. 주소를 검색해주세요.
        </div>
      )}

      <MapView
        center={mapCenter}
        aedItems={aedItems}
        onMapReady={(map: kakao.maps.Map) => {
          mapRef.current = map;
        }}
      />

      <LocationButton onClick={handleMyLocation} isLoading={isLoading} />

      {isLoading && <LoadingOverlay />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
