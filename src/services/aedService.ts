import axios from 'axios';
import type { AEDApiItem, AEDApiResponse, AEDItem, Coordinates } from '../types/aed';

// 로컬(DEV): Vite 프록시 → safetydata.go.kr
// 프로덕션(Cloudflare Pages): Pages Function → safetydata.go.kr
const AED_PROXY_PATH = '/api/aed';

// 300m 반경을 위경도 차이로 환산 (여유있게 0.01 ≈ 약 1km)
const COORD_MARGIN = 0.01;

function buildQueryString(apiKey: string, center?: Coordinates): string {
  const params: Record<string, string> = {
    serviceKey: apiKey,
    numOfRows: '1000',
    pageNo: '1',
    returnType: 'json',
  };

  // 좌표 범위 파라미터로 서버 측 1차 필터링 (전국 데이터 대신 주변만 요청)
  if (center) {
    params.startLat = String(center.lat - COORD_MARGIN);
    params.endLat   = String(center.lat + COORD_MARGIN);
    params.startLot = String(center.lng - COORD_MARGIN);
    params.endLot   = String(center.lng + COORD_MARGIN);
  }

  return new URLSearchParams(params).toString();
}

function normalizeItems(body: AEDApiResponse['body']): AEDApiItem[] {
  if (!body || !Array.isArray(body)) return [];
  return body;
}

function toAEDItem(raw: AEDApiItem, index: number): AEDItem | null {
  const lat = parseFloat(raw.LAT);
  const lng = parseFloat(raw.LOT);
  if (isNaN(lat) || isNaN(lng)) return null;

  return {
    id: `aed-${raw.SN ?? index}`,
    coordinates: { lat, lng },
    buildPlace: raw.INSTL_PSTN ?? '설치위치 정보 없음',
    org: raw.MNG_INST_NM ?? '관리기관 정보 없음',
    buildAddress: raw.INSTL_ADDR ?? '',
  };
}

export async function fetchAEDList(center?: Coordinates): Promise<AEDItem[]> {
  const apiKey = import.meta.env.VITE_AED_API_KEY as string;
  if (!apiKey) throw new Error('AED API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.');

  const qs = buildQueryString(apiKey, center);
  const res = await axios.get<AEDApiResponse>(`${AED_PROXY_PATH}?${qs}`, {
    timeout: 10000,
  });

  const data = res.data;
  if (data.header?.resultCode !== '00') {
    throw new Error(`AED API 오류: ${data.header?.resultMsg}`);
  }

  const rawItems = normalizeItems(data.body);
  if (rawItems.length === 0 && data.totalCount > 0) {
    // body 파싱 실패 시 경고 (구조 변경 감지용)
    console.warn('AED body 파싱 실패. 실제 응답 구조:', JSON.stringify(data).slice(0, 200));
  }
  return rawItems
    .map((item, i) => toAEDItem(item, i))
    .filter((item): item is AEDItem => item !== null);
}
