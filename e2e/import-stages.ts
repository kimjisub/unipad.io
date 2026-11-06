import { expect, type Page } from '@playwright/test';

export interface ImportStage { stage: string; time: number }

/** Delays real import work without holding native database transactions open. */
export function delayImportStages() {
  const stages: { stage: string; time: number }[] = [];
  Object.assign(window, { importStages: stages });
  const read = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = async function () {
    File.prototype.arrayBuffer = read;
    stages.push({ stage: 'read started', time: performance.now() });
    await new Promise(resolve => setTimeout(resolve, 8000));
    stages.push({ stage: 'read released', time: performance.now() });
    return read.call(this);
  };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args);
    if (this.name === 'settings' && args[0].key === 'lastUniPackId') {
      request.addEventListener('success', event => {
        event.stopImmediatePropagation();
        stages.push({ stage: 'saved setting held', time: performance.now() });
        setTimeout(() => {
          stages.push({ stage: 'saved setting released', time: performance.now() });
          request.onsuccess?.call(request, event);
        }, 8000);
      }, { once: true });
      IDBObjectStore.prototype.put = put;
    }
    return request;
  };
}

export const readImportStages = (page: Page) => page.evaluate(() =>
  (window as unknown as { importStages: ImportStage[] }).importStages);

export function expectImportStageDelays(stages: ImportStage[]) {
  expect(stages.map(({ stage }) => stage)).toEqual(['read started', 'read released', 'saved setting held', 'saved setting released']);
  // Allow timer precision rounding while keeping the combined delay beyond one state budget.
  expect(stages[1].time - stages[0].time).toBeGreaterThanOrEqual(7950);
  expect(stages[3].time - stages[2].time).toBeGreaterThanOrEqual(7950);
}
