export interface Coordinates {
  lat: number;
  lng: number;
}

// 안전데이터포털 AED API 원본 응답 아이템 (필드명 대문자 — API 스펙 기준)
export interface AEDApiItem {
  SN: string;          // 일련번호
  INSTL_ADDR: string;  // 설치주소
  INSTL_PSTN: string;  // 설치위치
  SE: string;          // 구분
  MNGR_NM: string;     // 관리자명
  MNGR_TELNO: string;  // 관리자전화번호
  MKR_NM: string;      // 제조사명
  MDL_NM: string;      // 모델명
  MNG_INST_NM: string; // 관리기관명
  CTPV_NM: string;     // 시도명
  ZIP_1: string;       // 우편번호1
  ZIP_2: string;       // 우편번호2
  XMAP_CRTS: string;   // X지도좌표
  YMAP_CRTS: string;   // Y지도좌표
  LAT: string;         // 위도
  LOT: string;         // 경도
  ADDR: string;        // 주소
}

// 안전데이터포털 AED API 응답 전체 구조
// 실제 응답: body가 items 객체가 아닌 배열로 직접 반환됨
export interface AEDApiResponse {
  header: {
    resultCode: string;
    resultMsg: string;
    errorMsg: string | null;
  };
  numOfRows: number;
  pageNo: number;
  totalCount: number;
  body: AEDApiItem[];
}

// 앱 내부에서 사용하는 정제된 AED 데이터
export interface AEDItem {
  id: string;
  coordinates: Coordinates;
  buildPlace: string;   // 설치위치 (INSTL_PSTN)
  org: string;          // 관리기관명 (MNG_INST_NM)
  buildAddress: string; // 설치주소 (INSTL_ADDR)
  distance?: number;    // 사용자로부터의 거리 (미터)
}
