import type { AutoPlayElement } from './types';

const DB_NAME = 'unipad';
const DB_VERSION = 3;
const STORE_UNIPACKS = 'unipacks';
const STORE_PACK_METADATA = 'unipackMetadata';
const STORE_PACK_CHUNKS = 'unipackChunks';
const PACK_STORES = [STORE_UNIPACKS, STORE_PACK_METADATA, STORE_PACK_CHUNKS];
// Bound structured-clone and browser IPC copies to one chunk, not the entire archive.
const ARCHIVE_CHUNK_BYTES = 8 * 1024 * 1024;

interface ChunkedArchive {
  id: string;
  format: 'chunks-v1';
  byteLength: number;
  chunkCount: number;
}
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
  soundCount?: number;
  ledCount?: number;
  openCount?: number;
  bookmark?: boolean;
  zipData: ArrayBuffer;
  /** Auto mapping's result, used in place of the archive's autoPlay; the archive is never rewritten. */
  autoPlay?: StoredAutoPlay;
  addedAt: number;
  lastOpenedAt: number;
}

type UniPackMetadata = Omit<StoredUniPack, 'zipData'>;

function packMetadata(record: StoredUniPack): UniPackMetadata {
  const { zipData, ...metadata } = record;
  void zipData;
  return metadata;
}

/** The autoPlay a pack plays and the one it replaced, which restoring swaps back. */
export interface StoredAutoPlay {
  current: AutoPlayElement[];
  backup: AutoPlayElement[];
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
      if (!db.objectStoreNames.contains(STORE_PACK_METADATA)) {
        const metadata = db.createObjectStore(STORE_PACK_METADATA, { keyPath: 'id' });
        metadata.createIndex('lastOpenedAt', 'lastOpenedAt');
        // Copy only small fields. Legacy archives stay untouched, and an interrupted or failed
        // upgrade rolls back this entire store so the next open can retry without losing packs.
        const cursor = request.transaction!.objectStore(STORE_UNIPACKS).openCursor();
        cursor.onsuccess = () => {
          if (!cursor.result) return;
          try {
            metadata.put(packMetadata(cursor.result.value as StoredUniPack));
            cursor.result.continue();
          } catch {
            request.transaction!.abort();
          }
        };
      }
      if (!db.objectStoreNames.contains(STORE_PACK_CHUNKS)) {
        db.createObjectStore(STORE_PACK_CHUNKS, { keyPath: ['packId', 'index'] });
      }
      if (!db.objectStoreNames.contains(STORE_THEMES)) {
        db.createObjectStore(STORE_THEMES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
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

/**
 * Runs `write` in one readwrite transaction. Resolves only once the transaction has committed and
 * rejects when it aborts (for example, browser storage is full), in which case nothing it wrote is kept.
 * `write` calls `fail` to abort with its own reason.
 */
async function commit(
  storeName: string | string[],
  write: (transaction: IDBTransaction, fail: (error: unknown) => void) => void,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    let failure: unknown;
    const fail = (error: unknown) => {
      try {
        transaction.abort();
        failure ??= error;
      } catch {
        // Already aborted; onabort rejects.
      }
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? failure ?? new DOMException('The write was aborted.', 'AbortError'));
    };
    try {
      write(transaction, fail);
    } catch (error) {
      fail(error);
    }
  });
}

/** Updates only the requested fields from the latest record, within one transaction. */
async function updateStoredUniPack(
  id: string,
  change: (record: UniPackMetadata) => Partial<UniPackMetadata>,
  onMissing: () => void = () => {},
): Promise<UniPackMetadata | undefined> {
  let updated: UniPackMetadata | undefined;
  await commit(STORE_PACK_METADATA, (transaction, fail) => {
    const store = transaction.objectStore(STORE_PACK_METADATA);
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        const record = request.result as UniPackMetadata | undefined;
        if (!record) {
          onMissing();
          return;
        }
        updated = { ...record, ...change(record) };
        store.put(updated);
      } catch (error) {
        fail(error);
      }
    };
  });
  return updated;
}

// UniPack operations

export interface UniPackInfo {
  title: string;
  producerName: string;
  buttonX: number;
  buttonY: number;
  chain: number;
  keyLedExist?: boolean;
  autoPlayExist?: boolean;
  soundCount?: number;
  ledCount?: number;
  storeCode?: string;
}

function createUniPackRecord(zipData: ArrayBuffer, info: UniPackInfo): StoredUniPack {
  const now = Date.now();
  return {
    id: `${info.title}_${now}`,
    storeCode: info.storeCode,
    title: info.title,
    producerName: info.producerName,
    buttonX: info.buttonX,
    buttonY: info.buttonY,
    chain: info.chain,
    keyLedExist: info.keyLedExist ?? false,
    autoPlayExist: info.autoPlayExist ?? false,
    soundCount: info.soundCount ?? 0,
    ledCount: info.ledCount ?? 0,
    openCount: 0,
    zipData,
    addedAt: now,
    lastOpenedAt: now,
  };
}

/** Queue only one chunk at a time while keeping the entire replacement atomic. */
function writeArchive(
  transaction: IDBTransaction,
  fail: (error: unknown) => void,
  id: string,
  zipData: ArrayBuffer,
): void {
  const archive: ChunkedArchive = {
    id, format: 'chunks-v1', byteLength: zipData.byteLength,
    chunkCount: Math.ceil(zipData.byteLength / ARCHIVE_CHUNK_BYTES),
  };
  transaction.objectStore(STORE_UNIPACKS).put(archive);
  const chunks = transaction.objectStore(STORE_PACK_CHUNKS);
  // The timestamp-based id may be reused; a smaller replacement must not leave old tail chunks.
  chunks.delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
  let index = 0;
  const next = () => {
    if (index === archive.chunkCount) return;
    try {
      const start = index * ARCHIVE_CHUNK_BYTES;
      const request = chunks.put({ packId: id, index, data: zipData.slice(start, start + ARCHIVE_CHUNK_BYTES) });
      index++;
      request.onsuccess = next;
    } catch (error) { fail(error); }
  };
  next();
}

function deleteArchive(transaction: IDBTransaction, id: string): void {
  transaction.objectStore(STORE_UNIPACKS).delete(id);
  transaction.objectStore(STORE_PACK_METADATA).delete(id);
  transaction.objectStore(STORE_PACK_CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
}

export async function saveUniPack(zipData: ArrayBuffer, info: UniPackInfo): Promise<string> {
  const record = createUniPackRecord(zipData, info);
  await commit(PACK_STORES, (transaction, fail) => {
    writeArchive(transaction, fail, record.id, zipData);
    transaction.objectStore(STORE_PACK_METADATA).put(packMetadata(record));
  });
  return record.id;
}

/**
 * Saves a store download in place of any earlier copy of the same store pack.
 *
 * The new record is written and the earlier copies are deleted in one transaction, so
 * when the write fails (for example, browser storage is full) nothing is deleted and
 * the copy the user already had stays.
 */
export async function saveStoreUniPack(
  zipData: ArrayBuffer,
  info: UniPackInfo & { storeCode: string },
): Promise<string> {
  const previousIds = (await listUniPacks())
    .filter((pack) => pack.storeCode === info.storeCode)
    .map((pack) => pack.id);
  const record = createUniPackRecord(zipData, info);
  await commit(PACK_STORES, (transaction, fail) => {
    writeArchive(transaction, fail, record.id, zipData);
    transaction.objectStore(STORE_PACK_METADATA).put(packMetadata(record));
    for (const id of previousIds) {
      if (id !== record.id) deleteArchive(transaction, id);
    }
  });
  return record.id;
}

/**
 * Stores `autoPlay` as the pack's autoPlay and its backup together, in place of the earlier pair.
 * Only one backup is kept. When the write fails the pack keeps the autoPlay it had.
 */
export async function saveUniPackAutoPlay(id: string, autoPlay: StoredAutoPlay): Promise<void> {
  await updateStoredUniPack(id, () => ({ autoPlay }), () => {
    throw new DOMException('The pack is no longer stored.', 'NotFoundError');
  });
}

export async function getUniPack(id: string): Promise<StoredUniPack | undefined> {
  const db = await openDB();
  const transaction = db.transaction(PACK_STORES, 'readonly');
  return new Promise((resolve, reject) => {
    const archive = transaction.objectStore(STORE_UNIPACKS).get(id);
    const metadata = transaction.objectStore(STORE_PACK_METADATA).get(id);
    let zipData: ArrayBuffer | undefined;
    let failure: unknown;
    let reads = 0;
    const fail = (error: unknown) => { failure = error; transaction.abort(); };
    const loaded = () => {
      if (++reads !== 2 || !archive.result || !metadata.result) return;
      // Read old archives in place; never rewrite or bulk-migrate the user's saved packs.
      if (archive.result.zipData instanceof ArrayBuffer) {
        zipData = archive.result.zipData;
        return;
      }
      try {
        const record = archive.result as ChunkedArchive;
        if (record.format !== 'chunks-v1' || !Number.isSafeInteger(record.byteLength) || record.byteLength < 0 ||
          record.chunkCount !== Math.ceil(record.byteLength / ARCHIVE_CHUNK_BYTES)) {
          throw new Error('Invalid archive storage record.');
        }
        const bytes = new Uint8Array(record.byteLength);
        zipData = bytes.buffer;
        let index = 0;
        const next = () => {
          if (index === record.chunkCount) return;
          const request = transaction.objectStore(STORE_PACK_CHUNKS).get([id, index]);
          request.onsuccess = () => {
            try {
              const chunk = request.result?.data;
              const offset = index * ARCHIVE_CHUNK_BYTES;
              if (!(chunk instanceof ArrayBuffer) || chunk.byteLength !== Math.min(ARCHIVE_CHUNK_BYTES, record.byteLength - offset)) {
                throw new Error('Missing or incomplete archive chunk.');
              }
              bytes.set(new Uint8Array(chunk), offset);
              index++;
              next();
            } catch (error) { fail(error); }
          };
        };
        next();
      } catch (error) { fail(error); }
    };
    archive.onsuccess = loaded;
    metadata.onsuccess = loaded;
    transaction.oncomplete = () => {
      db.close();
      resolve(zipData && metadata.result ? { ...metadata.result, zipData } as StoredUniPack : undefined);
    };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? failure); };
  });
}

export async function listUniPacks(): Promise<StoredUniPack[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_PACK_METADATA, 'readonly');
    const store = transaction.objectStore(STORE_PACK_METADATA);
    const index = store.index('lastOpenedAt');
    const request = index.openCursor(null, 'prev');
    const results: StoredUniPack[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const record = cursor.value as UniPackMetadata;
        results.push({
          ...record,
          zipData: null as unknown as ArrayBuffer, // Lists never read archives.
          autoPlay: undefined,
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
  await commit(PACK_STORES, (transaction) => {
    deleteArchive(transaction, id);
  });
}

export async function updateUniPackLastOpened(id: string): Promise<void> {
  await updateStoredUniPack(id, (record) => ({
    lastOpenedAt: Date.now(),
    openCount: (record.openCount ?? 0) + 1,
  }));
}

export async function toggleUniPackBookmark(id: string): Promise<boolean> {
  const updated = await updateStoredUniPack(id, (record) => ({
    bookmark: !(record.bookmark ?? false),
  }));
  return updated?.bookmark ?? false;
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
