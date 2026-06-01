import { useState, useCallback, useRef } from 'react';
import type { AEDItem, Coordinates } from '../types/aed';
import { fetchAEDList } from '../services/aedService';
import { filterByRadius } from '../utils/distance';

interface AEDState {
  items: AEDItem[];
  isLoading: boolean;
  error: string | null;
}

interface UseAEDReturn extends AEDState {
  loadAED: (center: Coordinates) => Promise<void>;
}

export function useAED(): UseAEDReturn {
  const [state, setState] = useState<AEDState>({
    items: [],
    isLoading: false,
    error: null,
  });

  const abortRef = useRef(false);

  const loadAED = useCallback(async (center: Coordinates) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    abortRef.current = false;

    try {
      // center를 전달해 서버에서 좌표 범위로 1차 필터링
      const allAED = await fetchAEDList(center);

      if (abortRef.current) return;

      // geolib로 정확한 300m 반경 2차 필터링
      const nearby = filterByRadius(allAED, center);
      setState({ items: nearby, isLoading: false, error: null });
    } catch (err) {
      if (abortRef.current) return;
      setState({
        items: [],
        isLoading: false,
        error: 'AED 정보를 불러오지 못했습니다.',
      });
    }
  }, []);

  return { ...state, loadAED };
}
