import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  getUniPack,
  saveUniPackAutoPlay,
  toggleUniPackBookmark,
  updateUniPackLastOpened,
  type StoredAutoPlay,
  type StoredUniPack,
} from './storage';

type Request = { result?: unknown; error?: DOMException; onsuccess?: () => void; onerror?: () => void };

/** Serializes transactions and clones reads/writes, including rollback on abort. */
function fakeIndexedDB(initial?: StoredUniPack) {
  let record = structuredClone(initial);
  let nextRead: (() => void) | undefined;
  let abortWrite = false;
  let readFailure: DOMException | undefined;
  let putFailure: DOMException | undefined;
  let explicitAborts = 0;
  const pending: (() => void)[] = [];
  let active = false;
  const startNext = () => {
    active = false;
    pending.shift()?.();
  };
  const db = {
    close() {},
    transaction(_name: string, mode: IDBTransactionMode) {
      const operations: (() => void)[] = [];
      let draft: StoredUniPack | undefined;
      let aborted = false;
      let running = false;
      const transaction = {
        error: null as DOMException | null,
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        abort() { explicitAborts++; aborted = true; },
        objectStore() {
          return {
            get(id: string) {
              const request: Request = {};
              operations.push(() => {
                if (readFailure) {
                  request.error = transaction.error = readFailure;
                  readFailure = undefined;
                  request.onerror?.();
                  aborted = true;
                  return;
                }
                request.result = structuredClone(draft?.id === id ? draft : undefined);
                const hook = nextRead;
                nextRead = undefined;
                hook?.();
                request.onsuccess?.();
              });
              return request;
            },
            put(value: StoredUniPack) {
              assert.equal(mode, 'readwrite');
              if (putFailure) {
                const error = putFailure;
                putFailure = undefined;
                throw error;
              }
              const copy = structuredClone(value);
              const request: Request = {};
              operations.push(() => {
                draft = copy;
                request.result = copy.id;
                request.onsuccess?.();
              });
              return request;
            },
          };
        },
      };
      const step = () => {
        if (aborted) {
          transaction.onabort?.();
          startNext();
          return;
        }
        const operation = operations.shift();
        if (operation) {
          operation();
          setImmediate(step);
        } else if (mode === 'readwrite' && abortWrite) {
          abortWrite = false;
          transaction.error = new DOMException('Storage is full.', 'QuotaExceededError');
          aborted = true;
          setImmediate(step);
        } else {
          if (mode === 'readwrite') record = draft;
          transaction.oncomplete?.();
          startNext();
        }
      };
      const start = () => {
        assert.equal(running, false);
        running = true;
        active = true;
        draft = structuredClone(record);
        setImmediate(step);
      };
      if (active) pending.push(start);
      else start();
      return transaction;
    },
  };
  return {
    factory: {
      open() {
        const request: Request = { result: db };
        setImmediate(() => request.onsuccess?.());
        return request;
      },
    } as unknown as IDBFactory,
    afterNextRead(hook: () => void) { nextRead = hook; },
    abortNextWrite() { abortWrite = true; },
    failNextRead() { readFailure = new DOMException('Read failed.', 'UnknownError'); },
    throwOnNextPut() { putFailure = new DOMException('Cannot clone value.', 'DataCloneError'); },
    explicitAbortCount() { return explicitAborts; },
  };
}

function installDB(t: TestContext, db: ReturnType<typeof fakeIndexedDB>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: db.factory });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });
}

const original: StoredUniPack = {
  id: 'saved-pack', title: 'Test pack', producerName: 'Tests',
  buttonX: 8, buttonY: 8, chain: 1, zipData: new Uint8Array([1, 2, 3]).buffer,
  addedAt: 10, lastOpenedAt: 20, openCount: 3, bookmark: false,
};
const mapped: StoredAutoPlay = {
  current: [{ type: 'delay', delay: 100 }],
  backup: [{ type: 'delay', delay: 1000 }],
};

for (const [name, update] of [
  ['recent opening', updateUniPackLastOpened],
  ['bookmark', toggleUniPackBookmark],
] as const) {
  for (const autoPlay of [undefined, { current: mapped.backup, backup: mapped.current }]) {
    test(`${name} preserves a concurrent autoPlay save (${autoPlay ? 'existing' : 'first'} mapping)`, async (t) => {
      const initial = { ...original, ...(autoPlay ? { autoPlay } : {}) };
      const db = fakeIndexedDB(initial);
      installDB(t, db);
      let saving: Promise<void> | undefined;
      // Queue the competing write after the metadata read takes its snapshot. A split read/write
      // lets this save commit before its stale put; one readwrite transaction keeps both changes.
      db.afterNextRead(() => { saving = saveUniPackAutoPlay(original.id, mapped); });
      const startedAt = Date.now();
      const result = await update(original.id);
      const completedAt = Date.now();
      await saving;
      const saved = await getUniPack(original.id);
      assert.deepEqual(saved?.autoPlay, mapped);
      assert.deepEqual(saved, {
        ...initial,
        autoPlay: mapped,
        ...(name === 'bookmark'
          ? { bookmark: true }
          : { openCount: 4, lastOpenedAt: saved?.lastOpenedAt }),
      });
      if (name === 'bookmark') assert.equal(result, true);
      else {
        assert.ok(saved!.lastOpenedAt >= startedAt);
        assert.ok(saved!.lastOpenedAt <= completedAt);
      }
    });
  }

  test(`${name} leaves a missing pack absent`, async (t) => {
    const db = fakeIndexedDB();
    installDB(t, db);
    assert.equal(await update('missing'), name === 'bookmark' ? false : undefined);
    assert.equal(await getUniPack('missing'), undefined);
  });

  test(`${name} rejects an aborted commit without changing the pack`, async (t) => {
    const db = fakeIndexedDB({ ...original, autoPlay: mapped });
    installDB(t, db);
    db.abortNextWrite();
    await assert.rejects(update(original.id), { name: 'QuotaExceededError' });
    assert.deepEqual(await getUniPack(original.id), { ...original, autoPlay: mapped });
  });
}

test('opening initializes a missing count and bookmarking can be toggled off', async (t) => {
  const db = fakeIndexedDB({ ...original, openCount: undefined, bookmark: undefined, autoPlay: mapped });
  installDB(t, db);
  await updateUniPackLastOpened(original.id);
  assert.equal(await toggleUniPackBookmark(original.id), true);
  assert.equal(await toggleUniPackBookmark(original.id), false);
  const saved = await getUniPack(original.id);
  assert.equal(saved?.openCount, 1);
  assert.equal(saved?.bookmark, false);
  assert.deepEqual(saved?.autoPlay, mapped);
});

for (const [name, update] of [
  ['recent opening', updateUniPackLastOpened],
  ['bookmark', toggleUniPackBookmark],
  ['autoPlay', (id: string) => saveUniPackAutoPlay(id, mapped)],
] as const) {
  for (const failure of ['read error', 'put exception'] as const) {
    test(`${name} rolls back a ${failure} and reports the cause`, async (t) => {
      const db = fakeIndexedDB(original);
      installDB(t, db);
      if (failure === 'read error') db.failNextRead();
      else db.throwOnNextPut();
      await assert.rejects(update(original.id), {
        name: failure === 'read error' ? 'UnknownError' : 'DataCloneError',
      });
      assert.equal(db.explicitAbortCount(), failure === 'put exception' ? 1 : 0);
      assert.deepEqual(await getUniPack(original.id), original);
    });
  }
}

test('autoPlay saving rejects a missing pack', async (t) => {
  const db = fakeIndexedDB();
  installDB(t, db);
  await assert.rejects(saveUniPackAutoPlay('missing', mapped), { name: 'NotFoundError' });
  assert.equal(db.explicitAbortCount(), 1);
  assert.equal(await getUniPack('missing'), undefined);
});
