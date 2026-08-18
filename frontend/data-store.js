/**
 * IndexedDB 저장소 — 오프라인에서 읽을 AED 스냅샷을 기기에 보관한다.
 *
 * 62,000행을 개별 레코드로 넣지 않고 단일 레코드에 배열 통째로 저장한다.
 * 앱은 항상 전량을 메모리에 올려 공간 필터링하므로 행 단위 인덱스가 쓸모없고,
 * 벌크 put(6만 회 트랜잭션)보다 구조화 복제 한 번이 훨씬 빠르다.
 *
 * meta는 별도 스토어에 둔다. 갱신 여부만 확인할 때 6만 행을 역직렬화하지 않기 위해서다.
 */
const DataStore = (() => {
  "use strict";

  const DB_NAME = "goldentime";
  const DB_VERSION = 1;
  const STORE_ROWS = "snapshot";
  const STORE_META = "meta";
  const KEY = "current";

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("이 브라우저는 IndexedDB를 지원하지 않습니다."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_ROWS)) db.createObjectStore(STORE_ROWS);
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      // 사파리 사생활 보호 모드 등에서 응답 없이 멈추는 경우가 있어 무한 대기를 막는다.
      request.onblocked = () => reject(new Error("IndexedDB가 다른 탭에 의해 차단되었습니다."));
    });

    return dbPromise;
  }

  function tx(storeName, mode, run) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          const request = run(transaction.objectStore(storeName));
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        })
    );
  }

  /** 저장본의 generated_at/count. 없으면 null. */
  function getMeta() {
    return tx(STORE_META, "readonly", (store) => store.get(KEY)).catch(() => null);
  }

  /** 저장된 AED 배열. 없으면 빈 배열 — 호출부가 오프라인에서도 안전하게 진행하도록. */
  function loadRows() {
    return tx(STORE_ROWS, "readonly", (store) => store.get(KEY))
      .then((rows) => rows || [])
      .catch(() => []);
  }

  /**
   * 스냅샷을 저장하고 영구 저장소 권한을 요청한다.
   * rows는 이미 객체 배열로 펼쳐진 상태여야 한다 (sync-data.js가 변환).
   */
  async function saveSnapshot(rows, meta) {
    await tx(STORE_ROWS, "readwrite", (store) => store.put(rows, KEY));
    await tx(STORE_META, "readwrite", (store) =>
      store.put({ ...meta, saved_at: new Date().toISOString() }, KEY)
    );
    await requestPersistence();
  }

  /**
   * 저장소 자동 삭제를 막아달라고 요청한다.
   *
   * AED 앱은 "며칠~몇 주 미사용"이 기본 상태라 저장소 정리 대상이 되기 쉽다.
   * 특히 iOS Safari는 7일간 미방문 시 서비스워커/IndexedDB를 지운다(홈 화면 설치 시 예외).
   * 거부되어도 앱 동작에는 문제가 없으므로 실패를 삼킨다.
   */
  async function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }

  async function clear() {
    await tx(STORE_ROWS, "readwrite", (store) => store.delete(KEY));
    await tx(STORE_META, "readwrite", (store) => store.delete(KEY));
  }

  return { getMeta, loadRows, saveSnapshot, requestPersistence, clear };
})();
