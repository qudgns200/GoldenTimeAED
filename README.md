# 골든타임 AED — 내 주변 자동심장충격기 찾기

응급상황 발생 시 현재 위치 기준 반경 300m 내 AED(자동심장충격기)를 빠르게 찾아주는 모바일 중심 웹앱입니다.

## 주요 기능

- 현재 위치 기반 주변 AED 표시 (반경 300m)
- 카카오맵에 AED 마커 표시 및 상세 정보 확인
- 주소/장소명 검색으로 위치 변경 (카카오 Places + Geocoder)
- 내 위치 버튼으로 즉시 복귀

## 시작하기

### 1. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열고 아래 두 값을 입력합니다.

| 변수명 | 발급처 | 설명 |
|--------|--------|------|
| `VITE_KAKAO_APP_KEY` | [Kakao Developers](https://developers.kakao.com) → 내 애플리케이션 → JavaScript 앱 키 | 카카오맵 앱 키 |
| `VITE_AED_API_KEY` | [안전데이터포털](https://www.safetydata.go.kr) → API 활용 신청 → DSSP-IF-10941 | AED 위치 데이터 API 키 |

> **카카오 앱 키 등록 시**: Kakao Developers → 내 애플리케이션 → 플랫폼 → Web 도메인에 `http://localhost:5173`과 배포 도메인을 등록해야 합니다.

### 2. 설치 및 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속 후 위치 권한을 허용합니다.

### 3. 빌드

```bash
npm run build
```

## GitHub Pages 배포

### 방법 1: npm 스크립트

```bash
npm run deploy
```

### 방법 2: GitHub Actions

`.github/workflows/deploy.yml` 설정 예시:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
        env:
          VITE_KAKAO_APP_KEY: ${{ secrets.VITE_KAKAO_APP_KEY }}
          VITE_AED_API_KEY: ${{ secrets.VITE_AED_API_KEY }}
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

배포 완료 후 `https://{username}.github.io/GoldenTimeAED/` 에서 접근합니다.

## 기술 스택

- React 19 + TypeScript (Strict Mode)
- Vite 8
- Kakao Maps JavaScript API (services: Places, Geocoder)
- Axios, geolib
- GitHub Pages

## 프로젝트 구조

```
src/
├── components/
│   ├── AEDMarker.ts        # 카카오맵 마커/InfoWindow 유틸
│   ├── LoadingOverlay.tsx
│   ├── LocationButton.tsx
│   ├── MapView.tsx         # 카카오맵 초기화
│   └── SearchBar.tsx
├── hooks/
│   ├── useAED.ts
│   └── useLocation.ts
├── pages/
│   └── HomePage.tsx
├── services/
│   ├── aedService.ts
│   ├── geocodingService.ts # kakao.maps.services.Places + Geocoder
│   └── locationService.ts
├── types/
│   ├── aed.ts
│   └── kakao.d.ts          # 카카오맵 TypeScript 타입 선언
└── utils/
    └── distance.ts
```
