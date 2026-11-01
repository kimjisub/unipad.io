import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { dropSocketFailureRecordedWhileLeaving } from './firebaseSocket';

const RECORD = 'firebase:previous_websocket_failure';
const realWindow = globalThis.window;
const realWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.window = realWindow;
  globalThis.WebSocket = realWebSocket;
});

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

function fakeWindow(localStorage = fakeStorage()) {
  const listeners = new Map<string, () => void>();
  globalThis.window = {
    localStorage,
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
  } as unknown as Window & typeof globalThis;
  return {
    items: localStorage.items,
    fire: (type: string) => listeners.get(type)?.(),
    listeners,
  };
}

test('drops a record that appeared after the page began to leave', () => {
  const page = fakeWindow();
  dropSocketFailureRecordedWhileLeaving();

  page.fire('beforeunload');
  page.items.set(RECORD, 'true');
  page.fire('pagehide');

  assert.equal(page.items.has(RECORD), false);
});

test('keeps a record that was there before the page began to leave', () => {
  const page = fakeWindow();
  dropSocketFailureRecordedWhileLeaving();

  page.items.set(RECORD, 'true');
  page.fire('beforeunload');
  page.fire('pagehide');

  assert.equal(page.items.has(RECORD), true);
});

test('keeps the record when the page is hidden without beforeunload', () => {
  const page = fakeWindow();
  dropSocketFailureRecordedWhileLeaving();

  page.items.set(RECORD, 'true');
  page.fire('pagehide');

  assert.equal(page.items.has(RECORD), true);
});

test('does not reuse an earlier departure for a page restored from history', () => {
  const page = fakeWindow();
  dropSocketFailureRecordedWhileLeaving();

  page.fire('beforeunload');
  page.fire('pagehide');
  page.items.set(RECORD, 'true');
  page.fire('pagehide');

  assert.equal(page.items.has(RECORD), true);
});

test('leaves other storage alone', () => {
  const page = fakeWindow();
  dropSocketFailureRecordedWhileLeaving();

  page.fire('beforeunload');
  page.items.set('firebase:other', 'true');
  page.fire('pagehide');

  assert.equal(page.items.has('firebase:other'), true);
});

test('does nothing when storage is unavailable', () => {
  const page = fakeWindow();
  Object.defineProperty(globalThis.window, 'localStorage', {
    get() {
      throw new Error('storage disabled');
    },
  });

  assert.doesNotThrow(dropSocketFailureRecordedWhileLeaving);
  assert.equal(page.listeners.size, 0);
});

test('the installed database SDK writes that record to localStorage before a socket attempt', async () => {
  const requireFromFirebase = createRequire(createRequire(__filename).resolve('firebase/package.json'));
  const sdkPath = path.join(path.dirname(requireFromFirebase.resolve('@firebase/database')), 'index.cjs.js');
  const requireFromSdk = createRequire(sdkPath);
  const page = fakeWindow();
  const written: boolean[] = [];
  globalThis.WebSocket = class {
    constructor() {
      written.push(page.items.get(RECORD) === 'true');
    }
    close() {}
  } as unknown as typeof WebSocket;

  // The SDK picks its storage and socket class on load, so it loads with the fakes above in place.
  const { deleteApp, initializeApp } = requireFromSdk('@firebase/app');
  const { getDatabase, onValue, ref } = requireFromSdk(sdkPath);
  const app = initializeApp({ databaseURL: 'https://record-name-test.firebaseio.com', projectId: 'test' });
  onValue(ref(getDatabase(app), 'storeCount'), () => {});
  for (let waited = 0; written.length === 0 && waited < 5000; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await deleteApp(app);

  assert.deepEqual(written, [true]);
});
