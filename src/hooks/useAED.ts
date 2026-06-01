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

// 전체 AED 목록 캐시 (페이지 생애주기 동안 재사용)
let cachedAllAED: AEDItem[] | null = null;

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
      if (!cachedAllAED) {
        cachedAllAED = await fetchAEDList();
      }

      if (abortRef.current) return;

      const nearby = filterByRadius(cachedAllAED, center);
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
