import axios from 'axios';
import type { AEDApiItem, AEDApiResponse, AEDItem } from '../types/aed';

// 로컬(DEV): Vite 프록시 → safetydata.go.kr
// 프로덕션(Cloudflare Pages): Pages Function → safetydata.go.kr
// 두 환경 모두 /api/aed 경로를 사용하므로 분기 불필요
const AED_PROXY_PATH = '/api/aed';

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

export async function fetchAEDList(): Promise<AEDItem[]> {
  const apiKey = import.meta.env.VITE_AED_API_KEY as string;
  if (!apiKey) throw new Error('AED API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.');

  const qs = buildQueryString(apiKey);
  const res = await axios.get<AEDApiResponse>(`${AED_PROXY_PATH}?${qs}`, {
    timeout: 10000,
  });

  const data = res.data;
  if (data.header?.resultCode !== '00') {
    throw new Error(`AED API 오류: ${data.header?.resultMsg}`);
  }

  const rawItems = normalizeItems(data.body);
  return rawItems
    .map((item, i) => toAEDItem(item, i))
    .filter((item): item is AEDItem => item !== null);
}
