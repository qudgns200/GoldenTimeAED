import { useState, useCallback } from 'react';
import type { Coordinates } from '../types/aed';
import { getCurrentPosition } from '../services/locationService';

interface LocationState {
  coordinates: Coordinates | null;
  error: string | null;
  isLoading: boolean;
  permissionDenied: boolean;
}

interface UseLocationReturn extends LocationState {
  fetchLocation: () => Promise<Coordinates | null>;
}

export function useLocation(): UseLocationReturn {
  const [state, setState] = useState<LocationState>({
    coordinates: null,
    error: null,
    isLoading: false,
    permissionDenied: false,
  });

  const fetchLocation = useCallback(async (): Promise<Coordinates | null> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const coords = await getCurrentPosition();
      setState({ coordinates: coords, error: null, isLoading: false, permissionDenied: false });
      return coords;
    } catch (err) {
      const message = err instanceof Error ? err.message : '위치 조회 실패';
      const denied = message === 'PERMISSION_DENIED';
      setState({
        coordinates: null,
        error: denied ? '현재 위치를 확인할 수 없습니다.\n주소를 검색해주세요.' : message,
        isLoading: false,
        permissionDenied: denied,
      });
      return null;
    }
  }, []);

  return { ...state, fetchLocation };
}
