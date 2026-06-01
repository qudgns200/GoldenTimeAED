import axios from 'axios';
import type { AEDApiItem, AEDApiResponse, AEDItem } from '../types/aed';

const AED_API_PATH = '/V2/api/DSSP-IF-00068';
const AED_API_BASE = `https://www.safetydata.go.kr${AED_API_PATH}`;

// 개발 환경: Vite dev server 프록시 (/api/aed → safetydata.go.kr)
// 프로덕션: CORS 프록시 순서대로 fallback
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

function buildQueryString(apiKey: string): string {
  return new URLSearchParams({
    serviceKey: apiKey,
    numOfRows: '1000',
    pageNo: '1',
    returnType: 'json',
  }).toString();
}

function normalizeItems(body: AEDApiResponse['body']): AEDApiItem[] {
  const raw = body.items;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if ('item' in raw && Array.isArray(raw.item)) return raw.item;
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

async function fetchWithFallback(apiKey: string): Promise<AEDApiResponse> {
  const qs = buildQueryString(apiKey);

  // ── 개발 환경: Vite 내장 프록시 사용 (CORS 완전 우회) ──
  if (import.meta.env.DEV) {
    const res = await axios.get<AEDApiResponse>(`/api/aed?${qs}`, { timeout: 10000 });
    return res.data;
  }

  // ── 프로덕션: 직접 호출 → CORS 프록시 순서대로 fallback ──
  const directUrl = `${AED_API_BASE}?${qs}`;

  try {
    const res = await axios.get<AEDApiResponse>(directUrl, { timeout: 8000 });
    return res.data;
  } catch {
    // CORS 또는 네트워크 오류 → 프록시 시도
  }

  let lastError: unknown;
  for (const makeProxy of CORS_PROXIES) {
    try {
      const res = await axios.get<AEDApiResponse>(makeProxy(directUrl), { timeout: 15000 });
      return res.data;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('AED API 호출 실패');
}

export async function fetchAEDList(): Promise<AEDItem[]> {
  const apiKey = import.meta.env.VITE_AED_API_KEY as string;
  if (!apiKey) throw new Error('AED API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.');

  const data = await fetchWithFallback(apiKey);

  if (data.header?.resultCode !== '00') {
    throw new Error(`AED API 오류: ${data.header?.resultMsg}`);
  }

  const rawItems = normalizeItems(data.body);
  return rawItems
    .map((item, i) => toAEDItem(item, i))
    .filter((item): item is AEDItem => item !== null);
}
