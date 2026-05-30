import type { Coordinates } from '../types/aed';

// 키워드 검색(장소명/주소 모두 지원) → 좌표 반환
export function geocodeAddress(query: string): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!window.kakao?.maps?.services) {
      reject(new Error('카카오맵 서비스가 초기화되지 않았습니다.'));
      return;
    }

    const places = new kakao.maps.services.Places();
    places.keywordSearch(query, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result.length > 0) {
        resolve({
          lat: parseFloat(result[0].y),
          lng: parseFloat(result[0].x),
        });
        return;
      }

      // 키워드 검색 실패 시 주소 검색으로 폴백
      const geocoder = new kakao.maps.services.Geocoder();
      geocoder.addressSearch(query, (addrResult, addrStatus) => {
        if (
          addrStatus === kakao.maps.services.Status.OK &&
          addrResult.length > 0
        ) {
          resolve({
            lat: parseFloat(addrResult[0].y),
            lng: parseFloat(addrResult[0].x),
          });
        } else {
          reject(new Error('검색 결과가 없습니다.'));
        }
      });
    });
  });
}
