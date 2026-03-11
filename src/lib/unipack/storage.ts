const DB_NAME = 'unipad';
const DB_VERSION = 1;
const STORE_UNIPACKS = 'unipacks';
const STORE_THEMES = 'themes';
const STORE_SETTINGS = 'settings';

export interface StoredUniPack {
  id: string;
  storeCode?: string;
  title: string;
  producerName: string;
  buttonX: number;
  buttonY: number;
  chain: number;
  keyLedExist?: boolean;
  autoPlayExist?: boolean;
  zipData: ArrayBuffer;
  addedAt: number;
  lastOpenedAt: number;
}

export interface StoredTheme {
  id: string;
  name: string;
  author: string;
  zipData: ArrayBuffer;
  addedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_UNIPACKS)) {
        const store = db.createObjectStore(STORE_UNIPACKS, { keyPath: 'id' });
        store.createIndex('lastOpenedAt', 'lastOpenedAt');
      }
      if (!db.objectStoreNames.contains(STORE_THEMES)) {
        db.createObjectStore(STORE_THEMES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

// UniPack operations

export async function saveUniPack(
  zipData: ArrayBuffer,
  info: {
    title: string;
    producerName: string;
    buttonX: number;
    buttonY: number;
    chain: number;
    keyLedExist?: boolean;
    autoPlayExist?: boolean;
    storeCode?: string;
  },
): Promise<string> {
  const id = `${info.title}_${Date.now()}`;
  const record: StoredUniPack = {
    id,
    storeCode: info.storeCode,
    title: info.title,
    producerName: info.producerName,
    buttonX: info.buttonX,
    buttonY: info.buttonY,
    chain: info.chain,
    keyLedExist: info.keyLedExist ?? false,
    autoPlayExist: info.autoPlayExist ?? false,
    zipData,
    addedAt: Date.now(),
    lastOpenedAt: Date.now(),
  };
  await tx(STORE_UNIPACKS, 'readwrite', (store) => store.put(record));
  return id;
}

export async function getUniPack(id: string): Promise<StoredUniPack | undefined> {
  return tx(STORE_UNIPACKS, 'readonly', (store) => store.get(id));
}

export async function listUniPacks(): Promise<StoredUniPack[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_UNIPACKS, 'readonly');
    const store = transaction.objectStore(STORE_UNIPACKS);
    const index = store.index('lastOpenedAt');
    const request = index.openCursor(null, 'prev');
    const results: StoredUniPack[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const record = cursor.value as StoredUniPack;
        results.push({
          ...record,
          zipData: null as unknown as ArrayBuffer, // 목록 조회 시 ZIP 데이터 제외
        });
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function deleteUniPack(id: string): Promise<void> {
  await tx(STORE_UNIPACKS, 'readwrite', (store) => store.delete(id));
}

export async function updateUniPackLastOpened(id: string): Promise<void> {
  const record = await getUniPack(id);
  if (record) {
    record.lastOpenedAt = Date.now();
    await tx(STORE_UNIPACKS, 'readwrite', (store) => store.put(record));
  }
}

// Theme operations

export async function saveTheme(
  zipData: ArrayBuffer,
  meta: { name: string; author: string },
): Promise<string> {
  const id = `${meta.name}_${Date.now()}`;
  const record: StoredTheme = {
    id,
    name: meta.name,
    author: meta.author,
    zipData,
    addedAt: Date.now(),
  };
  await tx(STORE_THEMES, 'readwrite', (store) => store.put(record));
  return id;
}

export async function getTheme(id: string): Promise<StoredTheme | undefined> {
  return tx(STORE_THEMES, 'readonly', (store) => store.get(id));
}

export async function listThemes(): Promise<StoredTheme[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_THEMES, 'readonly');
    const store = transaction.objectStore(STORE_THEMES);
    const request = store.getAll();
    request.onsuccess = () => {
      resolve(
        (request.result as StoredTheme[]).map((t) => ({
          ...t,
          zipData: null as unknown as ArrayBuffer,
        })),
      );
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function deleteTheme(id: string): Promise<void> {
  await tx(STORE_THEMES, 'readwrite', (store) => store.delete(id));
}

// Settings operations

export async function setSetting(key: string, value: string): Promise<void> {
  await tx(STORE_SETTINGS, 'readwrite', (store) => store.put({ key, value }));
}

export async function getSetting(key: string): Promise<string | null> {
  const result = await tx(STORE_SETTINGS, 'readonly', (store) => store.get(key));
  return (result as { key: string; value: string } | undefined)?.value ?? null;
}
