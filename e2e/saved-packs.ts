import { type Page } from '@playwright/test';

export interface SavedRecord { id: string; storeCode?: string; zipBytes: number }

/** The packs in browser storage. The import shows the pads before it saves the pack. */
export function savedRecords(page: Page): Promise<SavedRecord[]> {
  return page.evaluate(() => new Promise<SavedRecord[]>((resolve, reject) => {
    const open = indexedDB.open('unipad');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('unipacks').objectStore('unipacks').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db.close();
        resolve(request.result.map(({ id, storeCode, zipData }) => ({ id, storeCode, zipBytes: zipData.byteLength })));
      };
    };
  }));
}
