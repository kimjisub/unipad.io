import { get, onValue, ref } from 'firebase/database';
import { initFirebaseServices } from './firebase';

const LEGACY_DOWNLOAD_BASE_URL =
  'https://us-central1-unipad-e41ab.cloudfunctions.net/downloadUniPackLegacy';
const STORE_CACHE_KEY = 'store_items_cache_v1';
const STORE_COUNT_CACHE_KEY = 'store_count_cache_v1';

export interface StoreItem {
  code: string;
  title: string;
  producerName: string;
  isAutoPlay: boolean;
  isLED: boolean;
  downloadCount: number;
  url?: string;
}

export type StoreUnsubscribe = () => void;

export interface StoreItemsResult {
  items: StoreItem[];
  fromCache: boolean;
}

function loadCachedStoreItems(): StoreItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((it) => normalizeStoreItem(it, ''))
      .filter((it): it is StoreItem => Boolean(it));
  } catch {
    return [];
  }
}

function saveCachedStoreItems(items: StoreItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_CACHE_KEY, JSON.stringify(items));
  } catch {
    // ignore cache errors
  }
}

function loadCachedStoreCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(STORE_COUNT_CACHE_KEY);
    const value = Number(raw ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function saveCachedStoreCount(count: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_COUNT_CACHE_KEY, String(count));
  } catch {
    // ignore cache errors
  }
}

function normalizeSortAndDedupe(items: StoreItem[]): StoreItem[] {
  const byCode = new Map<string, StoreItem>();
  for (const item of items) {
    const prev = byCode.get(item.code);
    if (!prev) {
      byCode.set(item.code, item);
      continue;
    }
    // Keep richer metadata when duplicates exist.
    byCode.set(item.code, {
      ...prev,
      ...item,
      downloadCount: Math.max(prev.downloadCount, item.downloadCount),
      isAutoPlay: prev.isAutoPlay || item.isAutoPlay,
      isLED: prev.isLED || item.isLED,
      url: item.url || prev.url,
    });
  }
  return Array.from(byCode.values()).sort((a, b) => b.downloadCount - a.downloadCount);
}

function normalizeStoreItem(raw: unknown, fallbackCode: string): StoreItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const code = String(obj.code ?? fallbackCode ?? '').trim();
  if (!code) return null;

  const title = String(obj.title ?? '').trim();
  const producerName = String(obj.producerName ?? '').trim();
  if (!title || !producerName) return null;

  return {
    code,
    title,
    producerName,
    isAutoPlay: Boolean(obj.isAutoPlay),
    isLED: Boolean(obj.isLED),
    downloadCount: Number(obj.downloadCount ?? 0) || 0,
    url: (() => {
      const raw = obj.url ?? obj.URL ?? obj.downloadUrl ?? obj.downloadURL;
      if (typeof raw !== 'string') return undefined;
      const value = raw.trim();
      return value.length > 0 ? value : undefined;
    })(),
  };
}

export async function fetchStoreItems(): Promise<StoreItem[]> {
  const result = await fetchStoreItemsResult();
  return result.items;
}

export async function fetchStoreItemsResult(): Promise<StoreItemsResult> {
  const services = await initFirebaseServices();
  const db = services?.database;
  if (!db) {
    return { items: loadCachedStoreItems(), fromCache: true };
  }

  try {
    const snapshot = await get(ref(db, 'store'));
    if (!snapshot.exists()) {
      return { items: loadCachedStoreItems(), fromCache: true };
    }

    const items: StoreItem[] = [];
    snapshot.forEach((child) => {
      const normalized = normalizeStoreItem(child.val(), child.key ?? '');
      if (normalized) items.push(normalized);
    });

    const normalizedItems = normalizeSortAndDedupe(items);
    saveCachedStoreItems(normalizedItems);
    return { items: normalizedItems, fromCache: false };
  } catch {
    return { items: loadCachedStoreItems(), fromCache: true };
  }
}

export async function subscribeStoreItems(
  onItems: (items: StoreItem[]) => void,
  onError?: (message: string) => void,
): Promise<StoreUnsubscribe> {
  const services = await initFirebaseServices();
  const db = services?.database;
  if (!db) {
    onItems(loadCachedStoreItems());
    onError?.('Firebase Database is not available.');
    return () => {};
  }

  const storeRef = ref(db, 'store');
  const unsubscribe = onValue(
    storeRef,
    (snapshot) => {
      const items: StoreItem[] = [];
      snapshot.forEach((child) => {
        const normalized = normalizeStoreItem(child.val(), child.key ?? '');
        if (normalized) items.push(normalized);
      });
      const normalizedItems = normalizeSortAndDedupe(items);
      saveCachedStoreItems(normalizedItems);
      onItems(normalizedItems);
    },
    (error) => {
      onError?.(error?.message || 'Failed to subscribe store items.');
    },
  );

  return unsubscribe;
}

export async function subscribeStoreCount(
  onCount: (count: number, fromCache: boolean) => void,
  onError?: (message: string) => void,
): Promise<StoreUnsubscribe> {
  onCount(loadCachedStoreCount(), true);
  const services = await initFirebaseServices();
  const db = services?.database;
  if (!db) {
    onError?.('Firebase Database is not available.');
    return () => {};
  }

  const storeCountRef = ref(db, 'storeCount');
  const unsubscribe = onValue(
    storeCountRef,
    (snapshot) => {
      const value = Number(snapshot.val() ?? 0);
      const resolved = Number.isFinite(value) ? value : 0;
      saveCachedStoreCount(resolved);
      onCount(resolved, false);
    },
    (error) => {
      onError?.(error?.message || 'Failed to subscribe store count.');
    },
  );

  return unsubscribe;
}

function getStoreDownloadUrl(item: StoreItem): string {
  if (item.url && /^https?:\/\//i.test(item.url)) {
    return item.url;
  }
  return `${LEGACY_DOWNLOAD_BASE_URL}?code=${encodeURIComponent(item.code)}`;
}

function getStoreProxyUrl(item: StoreItem): string {
  const upstream = getStoreDownloadUrl(item);
  return `/api/store/download?url=${encodeURIComponent(upstream)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Why a store download did not end with a saved pack. Sent as the `error_type` parameter of
 * `store_download_fail`, so the values are categorical and must stay stable.
 */
export type StoreDownloadErrorType =
  | 'network'
  | 'http_403'
  | 'http_404'
  | 'http_5xx'
  | 'http_other'
  | 'invalid_pack'
  | 'storage'
  | 'other';

/** A store download failure that knows its `StoreDownloadErrorType`; the message is what people see. */
export class StoreDownloadError extends Error {
  readonly type: StoreDownloadErrorType;

  constructor(type: StoreDownloadErrorType, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoreDownloadError';
    this.type = type;
  }
}

export function httpStatusErrorType(status: number): StoreDownloadErrorType {
  if (status === 403) return 'http_403';
  if (status === 404) return 'http_404';
  if (status >= 500 && status <= 599) return 'http_5xx';
  return 'http_other';
}

export function storeDownloadErrorType(error: unknown): StoreDownloadErrorType {
  return error instanceof StoreDownloadError ? error.type : 'other';
}

/**
 * Runs one step after the download (reading the pack, saving it) and tags what it throws
 * with `type`, keeping the original message.
 */
export async function runStoreDownloadStep<T>(
  type: StoreDownloadErrorType,
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof StoreDownloadError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new StoreDownloadError(type, message, { cause: error });
  }
}

/**
 * Analytics parameters for a download that threw, or null when the person canceled it:
 * a cancel is counted by `store_download_cancel` alone, not as a failure.
 */
export function storeDownloadFailParams(
  error: unknown,
  canceled: boolean,
): { error_type: StoreDownloadErrorType } | null {
  if (canceled) return null;
  return { error_type: storeDownloadErrorType(error) };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function downloadStoreItem(
  item: StoreItem,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const proxyUrl = getStoreProxyUrl(item);
  const directUrl = getStoreDownloadUrl(item);
  let response: Response | null = null;
  let lastError: unknown = null;
  // Set when the proxy refused the URL, so a failing direct fetch is reported as that refusal.
  let proxyRejectedStatus: number | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(proxyUrl, {
        method: 'GET',
        signal,
        cache: 'no-store',
      });
      if ([429, 502, 503, 504].includes(response.status) && attempt === 0) {
        await sleep(350);
        continue;
      }
      if ([400, 401, 403].includes(response.status)) {
        // Fallback to direct download if proxy rejects host/url.
        proxyRejectedStatus = response.status;
        response = await fetch(directUrl, {
          method: 'GET',
          signal,
          cache: 'no-store',
        });
      }
      break;
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error('Download was canceled.');
      }
      lastError = error;
      if (attempt === 0) {
        await sleep(350);
        continue;
      }
      const message =
        error instanceof Error ? error.message : String(error);
      throw new StoreDownloadError(
        proxyRejectedStatus === null ? 'network' : httpStatusErrorType(proxyRejectedStatus),
        `Network error while downloading store item: ${message}`,
        { cause: error },
      );
    }
  }

  if (!response) {
    const message = lastError instanceof Error ? lastError.message : 'Unknown network error';
    throw new StoreDownloadError('network', `Store download failed: ${message}`);
  }

  if (!response.ok) {
    throw new StoreDownloadError(
      httpStatusErrorType(response.status),
      `Store download failed (HTTP ${response.status}).`,
    );
  }

  try {
    return await readStoreResponse(response, onProgress);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Download was canceled.');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new StoreDownloadError('network', `Network error while downloading store item: ${message}`, {
      cause: error,
    });
  }
}

async function readStoreResponse(
  response: Response,
  onProgress?: (percent: number) => void,
): Promise<ArrayBuffer> {
  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body?.getReader();
  if (!reader) {
    return response.arrayBuffer();
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  let pseudoProgress = 3;
  onProgress?.(pseudoProgress);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) {
      onProgress?.(Math.min(100, Math.floor((received / total) * 100)));
    } else {
      // Unknown content-length: keep UI alive with a bounded pseudo progress.
      pseudoProgress = Math.min(
        95,
        pseudoProgress + Math.max(1, Math.floor(value.byteLength / (128 * 1024))),
      );
      onProgress?.(pseudoProgress);
    }
  }

  onProgress?.(100);

  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

export function getStoreYoutubeSearchUrl(item: StoreItem): string {
  const q = `UniPad ${item.title} ${item.producerName}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}
