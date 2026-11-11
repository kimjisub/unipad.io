import { test, type Page } from '@playwright/test';

export interface RollbackReport {
  phase: string;
  chunks: number;
  replacementError: string;
  failure?: { name: string; message: string };
}

export class StorageRollbackError extends Error {
  constructor(readonly report: RollbackReport) {
    super(`Archive rollback check failed during ${report.phase} (${report.chunks} replacement chunks attempted): ${report.failure!.name}: ${report.failure!.message}`);
    this.name = 'StorageRollbackError';
  }
}

/** Keep setup failures distinct from failures after the replacement has actually been interrupted. */
export async function checkArchiveRollback(page: Page, saving: 'import' | 'store', failure: 'quota' | 'abort' | 'exception') {
  const outcome = await page.evaluate(async ({ saving, failure }) => {
    const report: RollbackReport = { phase: 'import-module', chunks: 0, replacementError: '' };
    const put = IDBObjectStore.prototype.put;
    try {
      const path = '/storage-module.mjs';
      const api = await import(path) as typeof import('../src/lib/unipack/storage');
      const info = { title: 'Existing archive', producerName: 'Tests', buttonX: 8, buttonY: 8, chain: 1, storeCode: 'test-store' };
      report.phase = 'save-previous';
      const oldId = await api.saveStoreUniPack(new Uint8Array([1, 2, 3]).buffer, info);
      report.phase = 'bookmark-previous';
      await api.toggleUniPackBookmark(oldId);
      report.phase = 'read-previous';
      const previous = await api.getUniPack(oldId);
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === 'unipackChunks' && report.chunks === 1) {
          report.chunks++;
          if (failure !== 'abort') throw new DOMException('Injected storage failure.', failure === 'quota' ? 'QuotaExceededError' : 'DataCloneError');
          const request = put.call(this, value, key);
          request.addEventListener('success', () => this.transaction.abort(), { once: true });
          return request;
        }
        const request = put.call(this, value, key);
        if (this.name === 'unipackChunks') report.chunks++;
        return request;
      };
      report.phase = 'save-replacement';
      try {
        const bytes = new Uint8Array(16 * 1024 * 1024 + 7).buffer;
        if (saving === 'store') await api.saveStoreUniPack(bytes, info);
        else await api.saveUniPack(bytes, info);
      } catch (cause) { report.replacementError = (cause as Error).name; }
      report.phase = 'read-previous-after-failure';
      const after = await api.getUniPack(oldId);
      report.phase = 'list-after-failure';
      const records = await api.listUniPacks();
      const sameBytes = after && Array.from(new Uint8Array(after.zipData));
      report.phase = 'complete';
      return { report, result: { error: report.replacementError, chunks: report.chunks, sameBytes,
        unchanged: JSON.stringify(previous) === JSON.stringify(after), ids: records.map(r => r.id), oldId } };
    } catch (cause) {
      const error = cause as Error;
      report.failure = { name: error.name, message: error.message };
      return { report };
    } finally {
      IDBObjectStore.prototype.put = put;
    }
  }, { saving, failure });
  await test.info().attach('storage-rollback', { body: JSON.stringify(outcome.report, null, 2), contentType: 'application/json' });
  if (!outcome.result) throw new StorageRollbackError(outcome.report);
  return outcome.result;
}
