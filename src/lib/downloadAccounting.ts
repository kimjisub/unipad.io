const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const STORAGE_KEY = 'unipad:download-reports:v1';
const PRODUCTION = 'https://us-central1-unipad-e41ab.cloudfunctions.net/';
const EMULATOR = 'http://127.0.0.1:5051/demo-unipad/us-central1/';

export interface PendingDownloadReport {
  code: string;
  receipt: string;
  expiresAt: number;
  completedAt: number;
  attempts: number[];
}

interface Receipt { receipt: string; expiresAt: number }
interface Options {
  endpoint: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  active: () => boolean;
  now?: () => number;
  request?: typeof fetch;
  lock: (work: () => Promise<void>) => Promise<void>;
}

/** Fail closed: preview builds and automated production visits never contact the live counter. */
export function downloadAccountingEndpoint(origin: string, automated: boolean, emulator?: string): string | null {
  if (emulator) {
    return emulator === EMULATOR && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? EMULATOR : null;
  }
  return origin === 'https://unipad.io' && !automated ? PRODUCTION : null;
}

const validCode = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 128 && Array.from(value).every(char => {
    const point = char.codePointAt(0)!;
    return point > 31 && (point < 127 || point > 159);
  });
const validReceipt = (value: unknown): value is string => typeof value === 'string' && /^\d{12}\.[a-f0-9]{64}$/.test(value);
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const terminal = new Set(['counted', 'already_counted', 'expired', 'invalid']);

/** Accounting has its own bounded, best-effort queue. It never owns pack data or download success. */
export class DownloadAccounting {
  private readonly now;
  private readonly request;
  private flushing: Promise<void> | null = null;
  private flushRequested = false;

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.request = (options.request ?? fetch).bind(globalThis);
  }

  private read(): PendingDownloadReport[] {
    let rows: unknown;
    try { rows = JSON.parse(this.options.storage.getItem(STORAGE_KEY) ?? '[]'); }
    catch { return []; }
    if (!Array.isArray(rows)) return [];
    const now = this.now();
    return rows.filter((row): row is PendingDownloadReport => row && validCode(row.code) && validReceipt(row.receipt)
      && validTime(row.expiresAt) && validTime(row.completedAt) && Array.isArray(row.attempts)
      && row.attempts.every(validTime) && row.attempts.length <= 3
      && Math.min(row.expiresAt, row.completedAt + WEEK) > now)
      .sort((a, b) => a.completedAt - b.completedAt).slice(-1000);
  }

  private write(rows: PendingDownloadReport[]): boolean {
    try { this.options.storage.setItem(STORAGE_KEY, JSON.stringify(rows)); return true; }
    catch { return false; }
  }

  private async post(action: string, body: object): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.request(this.options.endpoint + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
        credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      });
      const answer: unknown = await response.json();
      return answer && typeof answer === 'object' && !Array.isArray(answer) ? answer as Record<string, unknown> : null;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  }

  /** Start issuance alongside the file request; only the returned save callback can enqueue it. */
  begin(code: string, signal?: AbortSignal): () => void {
    if (!validCode(code) || signal?.aborted || !this.options.active()) return () => {};
    const issuing = this.post('issueDownloadReceipt', { code }).then(answer =>
      answer?.status === 'issued' && validReceipt(answer.receipt) && validTime(answer.expiresAt)
        ? { receipt: answer.receipt, expiresAt: answer.expiresAt } : null);
    let saved = false;
    return () => {
      if (saved || signal?.aborted) return;
      saved = true;
      const completedAt = this.now();
      void issuing.then(async (receipt: Receipt | null) => {
        if (!receipt || signal?.aborted) return;
        await this.options.lock(async () => {
          if (signal?.aborted) return;
          const rows = this.read();
          if (Math.min(receipt.expiresAt, completedAt + WEEK) <= this.now()) return;
          if (!rows.some(row => row.receipt === receipt.receipt)) {
            rows.push({ code, ...receipt, completedAt, attempts: [] });
            this.write(rows.sort((a, b) => a.completedAt - b.completedAt).slice(-1000));
          }
        });
        await this.flush();
      }).catch(() => {});
    };
  }

  /** Called on page use, focus and reconnect only; never wakes a closed or hidden page. */
  flush(): Promise<void> {
    if (this.flushing) { this.flushRequested = true; return this.flushing; }
    this.flushing = (async () => {
      do {
        this.flushRequested = false;
        await this.sendPending();
      } while (this.flushRequested && this.options.active());
    })().catch(() => {}).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async sendPending() {
    let receipts: string[] = [];
    await this.options.lock(async () => {
      const rows = this.read();
      if (!this.write(rows)) return;
      receipts = rows.map(row => row.receipt);
    });
    for (const receipt of receipts) {
      if (!this.options.active()) break;
      let pending: PendingDownloadReport | undefined;
      await this.options.lock(async () => {
        const rows = this.read();
        const row = rows.find(row => row.receipt === receipt);
        if (!row) return;
        const now = this.now();
        // A clock rollback must not reset the budget or bypass the minimum interval.
        row.attempts = row.attempts.filter(time => time > now - DAY);
        if (row.attempts.length >= 3 || row.attempts.some(time => now - time < 60_000)) return;
        row.attempts.push(now);
        // Do not send unless other tabs and reopened pages can see the updated retry budget.
        if (!this.write(rows)) return;
        pending = row;
      });
      if (!pending) continue;
      // Do not hold the cross-tab lock during network I/O: another save can enqueue immediately.
      const answer = await this.post('completeDownload', { code: pending.code, receipt });
      if (typeof answer?.status === 'string' && terminal.has(answer.status)) {
        await this.options.lock(async () => { this.write(this.read().filter(row => row.receipt !== receipt)); });
      }
    }
  }
}

let browserAccounting: DownloadAccounting | null = null;
function accounting(): DownloadAccounting | null {
  if (typeof window === 'undefined') return null;
  const endpoint = downloadAccountingEndpoint(window.location.origin, navigator.webdriver,
    process.env.NEXT_PUBLIC_DOWNLOAD_ACCOUNTING_EMULATOR);
  // Without cross-tab locking, skip optional accounting rather than exceed the retry budget.
  if (!endpoint || !navigator.locks || (process.env.NODE_ENV !== 'production'
    && !process.env.NEXT_PUBLIC_DOWNLOAD_ACCOUNTING_EMULATOR)) return null;
  if (!browserAccounting) {
    browserAccounting = new DownloadAccounting({
      endpoint,
      storage: {
        getItem: key => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
      },
      active: () => document.visibilityState === 'visible' && navigator.onLine,
      lock: async work => { await navigator.locks.request(STORAGE_KEY, work); },
    });
  }
  return browserAccounting;
}

export function beginStoreDownloadReport(code: string, signal?: AbortSignal): () => void {
  try { return accounting()?.begin(code, signal) ?? (() => {}); } catch { return () => {}; }
}

export function retryStoreDownloadReports(): void {
  try { void accounting()?.flush(); } catch { /* Accounting cannot fail page use. */ }
}
