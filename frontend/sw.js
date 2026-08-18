/**
 * 서비스워커 — 앱 셸을 캐시해 오프라인에서도 앱이 뜨게 한다.
 *
 * 역할 분담:
 *   여기(Cache Storage)  HTML/CSS/JS/아이콘 = 앱이 실행되기 위한 것
 *   IndexedDB            AED 데이터 = 앱이 보여줄 것 (sync-data.js가 담당)
 *
 * 스냅샷(data/*)은 일부러 가로채지 않는다. IndexedDB가 이미 갖고 있어 여기서도
 * 캐시하면 2~3MB를 이중으로 저장하게 되고, 갱신 시점을 앱이 통제하기 어려워진다.
 *
 * 네이버 지도(oapi.map.naver.com)도 가로채지 않는다. 타일 저장은 약관상 제한되고,
 * 어차피 오프라인에서는 지도 대신 offline-view.js가 뜬다.
 */
const CACHE_VERSION = "v1";
const CACHE_NAME = `goldentime-shell-${CACHE_VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "ui-util.js",
  "geo.js",
  "data-store.js",
  "sync-data.js",
  "map-view.js",
  "offline-view.js",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll은 하나라도 실패하면 전체가 실패한다. 아이콘 하나 때문에 오프라인
      // 지원 전체가 무너지지 않도록 개별적으로 담고 실패는 넘긴다.
      Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch((error) => {
            console.warn("[sw] 캐시 실패:", url, error);
          })
        )
      )
    )
  );
  // 새 버전을 배포했을 때 기존 탭이 닫힐 때까지 기다리지 않는다.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 다른 출처(네이버 지도 스크립트/타일)는 손대지 않는다.
  if (url.origin !== self.location.origin) return;
  // 스냅샷은 IndexedDB가 담당한다.
  if (url.pathname.includes("/data/")) return;

  // network-first + cache fallback.
  // _headers가 must-revalidate라 온라인에서는 항상 최신이 뜨고(배포 즉시 반영),
  // 오프라인에서는 캐시가 대신 응답한다.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // SPA는 아니지만 주소가 "/"든 "/index.html"이든 앱 셸로 응답해야
          // 오프라인 새로고침이 실패하지 않는다.
          if (request.mode === "navigate") return caches.match("index.html");
          return Response.error();
        })
      )
  );
});
