import axios from 'axios';
import type { AEDApiItem, AEDApiResponse, AEDItem } from '../types/aed';

const AED_API_BASE = 'https://www.safetydata.go.kr/V2/api/DSSP-IF-10941';

// CORS 프록시 목록 (순서대로 fallback 시도)
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

function buildApiUrl(apiKey: string): string {
  const params = new URLSearchParams({
    serviceKey: apiKey,
    numOfRows: '1000',
    pageNo: '1',
    returnType: 'json',
  });
  return `${AED_API_BASE}?${params.toString()}`;
}

function normalizeItems(body: AEDApiResponse['body']): AEDApiItem[] {
  const raw = body.items;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if ('item' in raw && Array.isArray(raw.item)) return raw.item;
  // 단일 아이템인 경우
  return [raw as AEDApiItem];
}

function toAEDItem(raw: AEDApiItem, index: number): AEDItem | null {
  const lat = parseFloat(raw.lat);
  const lng = parseFloat(raw.lon);
  if (isNaN(lat) || isNaN(lng)) return null;

  return {
    id: `aed-${index}-${lat}-${lng}`,
    coordinates: { lat, lng },
    buildPlace: raw.buildPlace ?? '설치위치 정보 없음',
    org: raw.org ?? '관리기관 정보 없음',
    buildAddress: raw.buildAddress ?? '',
  };
}

async function fetchWithFallback(url: string): Promise<AEDApiResponse> {
  // 1. 직접 호출 시도
  try {
    const res = await axios.get<AEDApiResponse>(url, { timeout: 10000 });
    return res.data;
  } catch {
    // CORS 또는 네트워크 오류 → 프록시 fallback
  }

  // 2. 프록시 순서대로 시도
  let lastError: unknown;
  for (const makeProxyUrl of CORS_PROXIES) {
    try {
      const res = await axios.get<AEDApiResponse>(makeProxyUrl(url), { timeout: 15000 });
      return res.data;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

export async function fetchAEDList(): Promise<AEDItem[]> {
  const apiKey = import.meta.env.VITE_AED_API_KEY;
  if (!apiKey) throw new Error('AED API 키가 설정되지 않았습니다.');

  const url = buildApiUrl(apiKey);
  const data = await fetchWithFallback(url);

  if (data.header?.resultCode !== '00') {
    throw new Error(`AED API 오류: ${data.header?.resultMsg}`);
  }

  const rawItems = normalizeItems(data.body);
  return rawItems
    .map((item, i) => toAEDItem(item, i))
    .filter((item): item is AEDItem => item !== null);
}
