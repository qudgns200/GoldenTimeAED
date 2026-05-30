import type { Coordinates } from '../types/aed';

export function getCurrentPosition(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저는 위치 서비스를 지원하지 않습니다.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(new Error('PERMISSION_DENIED'));
            break;
          case error.POSITION_UNAVAILABLE:
            reject(new Error('위치 정보를 확인할 수 없습니다.'));
            break;
          case error.TIMEOUT:
            reject(new Error('위치 조회 시간이 초과되었습니다.'));
            break;
          default:
            reject(new Error('위치 조회 중 오류가 발생했습니다.'));
        }
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  });
}
