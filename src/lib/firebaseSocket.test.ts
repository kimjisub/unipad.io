import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { forgetEarlierSocketFailure } from './firebaseSocket';

const realWindow = globalThis.window;

afterEach(() => {
  globalThis.window = realWindow;
});

function useLocalStorage(localStorage: Pick<Storage, 'removeItem'>) {
  globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
}

test('forgets only the SDK record of an earlier socket failure', () => {
  const removed: string[] = [];
  useLocalStorage({ removeItem: (key) => removed.push(key) });

  forgetEarlierSocketFailure();

  assert.deepEqual(removed, ['firebase:previous_websocket_failure']);
});

test('leaves the page working when storage is unavailable', () => {
  useLocalStorage({
    removeItem: () => {
      throw new Error('storage disabled');
    },
  });

  assert.doesNotThrow(forgetEarlierSocketFailure);
});

test('the installed database SDK still keeps its record under that name', () => {
  const fromFirebase = createRequire(createRequire(__filename).resolve('firebase/package.json'));
  const sdk = readFileSync(fromFirebase.resolve('@firebase/database'), 'utf8');

  assert.match(sdk, /'firebase:'/);
  assert.match(sdk, /'previous_websocket_failure'/);
});
