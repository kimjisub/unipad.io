import { test, type Page } from '@playwright/test';

export interface SeedStore {
  name: string;
  keyPath: string;
  indexes?: string[];
  records: Record<string, unknown>[];
  /** Record fields given as byte arrays and stored as ArrayBuffer. */
  binaryFields?: string[];
}

/** Which request failed: opening the database, the upgrade transaction itself, or one record's write. */
export type SeedRequest = 'open' | 'upgrade' | 'write';

export interface SeedReport {
  ok: boolean;
  upgradeEntered: boolean;
  failure?: { request: SeedRequest; target?: string; name: string; message: string };
  /** Each request event in order, with milliseconds since the open was requested. */
  events: string[];
}

export class SeedError extends Error {
  constructor(readonly report: SeedReport) {
    const { request, target, name, message } = report.failure!;
    super(`Seeding IndexedDB failed on the ${request} request${target ? ` (${target})` : ''} `
      + `${report.upgradeEntered ? 'after' : 'before'} the upgrade started: ${name}: ${message}`);
    this.name = 'SeedError';
  }
}

/**
 * Creates `database` at `version` on an empty fixture page of the app's origin, so no app code runs.
 * A failure is attached as `storage-seed-failure` (error name, failing request, whether the upgrade
 * started, every request event) and thrown as a SeedError.
 */
export async function seedDatabase(page: Page, database: string, version: number, stores: SeedStore[]) {
  await page.route('**/storage-seed', route => route.fulfill({ contentType: 'text/html', body: '<p>Storage fixture</p>' }));
  await page.goto('/storage-seed');
  const report = await page.evaluate(({ database, version, stores }) => new Promise<SeedReport>(resolve => {
    const started = performance.now();
    const report: SeedReport = { ok: false, upgradeEntered: false, events: [] };
    const note = (event: string) => report.events.push(`${Math.round(performance.now() - started)} ms ${event}`);
    // The first failure is the cause; later ones (the abort it triggers) only add events.
    const fail = (request: SeedRequest, error: unknown, target?: string) => {
      const { name = 'unknown', message = String(error) } = (error ?? {}) as Partial<DOMException>;
      note(`${request}${target ? ` ${target}` : ''} failed: ${name}: ${message}`);
      report.failure ??= { request, target, name, message };
    };
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open(database, version);
    } catch (error) {
      fail('open', error);
      return resolve(report);
    }
    note(`open ${database} v${version} requested`);
    open.onblocked = () => note('open blocked by another connection');
    open.onupgradeneeded = event => {
      report.upgradeEntered = true;
      note(`upgrade entered from v${event.oldVersion}`);
      const upgrade = open.transaction!;
      // A browser-started abort (a request error, a quota error at commit) carries its cause only here:
      // the open request that settles afterwards reports a plain AbortError.
      upgrade.onabort = () => {
        note(`upgrade aborted: ${upgrade.error?.name ?? 'no error'}`);
        if (upgrade.error) fail('upgrade', upgrade.error);
      };
      upgrade.oncomplete = () => note('upgrade committed');
      try {
        for (const store of stores) {
          const objects = open.result.createObjectStore(store.name, { keyPath: store.keyPath });
          for (const index of store.indexes ?? []) objects.createIndex(index, index);
          for (const record of store.records) {
            const target = `${store.name}/${String(record[store.keyPath])}`;
            const value = { ...record };
            for (const field of store.binaryFields ?? []) value[field] = new Uint8Array(record[field] as number[]).buffer;
            try {
              const write = objects.put(value);
              write.onerror = () => fail('write', write.error, target);
            } catch (error) {
              fail('write', error, target);
              upgrade.abort();
              return;
            }
          }
        }
      } catch (error) {
        fail('upgrade', error);
        upgrade.abort();
      }
    };
    // The open request settles last, after the upgrade transaction has committed or aborted.
    open.onerror = () => {
      fail(report.upgradeEntered ? 'upgrade' : 'open', open.error);
      resolve(report);
    };
    open.onsuccess = () => {
      note('open succeeded');
      open.result.close();
      report.ok = !report.failure;
      resolve(report);
    };
  }), { database, version, stores });
  if (report.ok) return;
  await test.info().attach('storage-seed-failure', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  throw new SeedError(report);
}
