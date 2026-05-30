import axios from 'axios';
import type { AEDApiItem, AEDApiResponse, AEDItem } from '../types/aed';

const AED_API_BASE = 'https://www.safetydata.go.kr/V2/api/DSSP-IF-10941';
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

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
  try {
    const res = await axios.get<AEDApiResponse>(url, { timeout: 10000 });
    return res.data;
  } catch (directError) {
    // CORS 에러 또는 네트워크 에러 시 프록시로 재시도
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
    const res = await axios.get<AEDApiResponse>(proxyUrl, { timeout: 15000 });
    return res.data;
  }
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
