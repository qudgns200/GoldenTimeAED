export interface Coordinates {
  lat: number;
  lng: number;
}

// 안전데이터포털 AED API 원본 응답 아이템
export interface AEDApiItem {
  org: string;        // 관리기관명
  clerkTel: string;   // 관리기관 전화번호
  buildPlace: string; // 설치위치 (건물명/장소)
  buildAddress: string; // 설치주소
  lat: string;        // 위도 (문자열)
  lon: string;        // 경도 (문자열)
}

// 안전데이터포털 AED API 응답 전체 구조
export interface AEDApiResponse {
  header: {
    resultCode: string;
    resultMsg: string;
  };
  body: {
    items: AEDApiItem[] | { item: AEDApiItem[] } | AEDApiItem;
    numOfRows: number;
    pageNo: number;
    totalCount: number;
  };
}

// 앱 내부에서 사용하는 정제된 AED 데이터
export interface AEDItem {
  id: string;
  coordinates: Coordinates;
  buildPlace: string;   // 설치위치
  org: string;          // 관리기관명
  buildAddress: string; // 설치주소
  distance?: number;    // 사용자로부터의 거리 (미터)
}
