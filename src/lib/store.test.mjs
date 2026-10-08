import { test } from 'node:test';
import { setTimeout as wallTimeout, clearTimeout as clearWallTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { downloadStoreItem } from './store.ts';

const item = { code: 'test', title: 'Test Pack', producerName: 'Tests', isAutoPlay: false, isLED: false, downloadCount: 0 };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

for (const stage of ['headers', 'body', 'direct']) {
  test(`rejects a store download stalled at ${stage}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    let signal;
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      calls++;
      signal = options.signal;
      if (stage === 'direct' && calls === 1) return new Response(null, { status: 403 });
      if (stage === 'body') return new Response(new ReadableStream({
        start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); },
      }));
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const caller = new AbortController();
    const download = downloadStoreItem(item, undefined, caller.signal);
    let watchdog;
    const outcome = Promise.race([download.then(() => 'completed', error => error.message), new Promise(resolve => { watchdog = wallTimeout(() => resolve('still waiting'), 50); })]);
    await flush();
    t.mock.timers.tick(5000);
    const result = await outcome;
    clearWallTimeout(watchdog);
    const transferAborted = signal.aborted;
    caller.abort();
    assert.match(result, /timed out/i);
    assert.equal(transferAborted, true, 'the stalled transfer must stop');
  });
}

test('allows a download to take longer than the idle limit while chunks keep arriving', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let body;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { body = controller; } })));
  const progress = [];
  const download = downloadStoreItem(item, percent => progress.push(percent));
  await flush();
  for (const value of [1, 2, 3]) {
    t.mock.timers.tick(4000);
    body.enqueue(new Uint8Array([value]));
    await flush();
  }
  body.close();
  assert.deepEqual(new Uint8Array(await download), new Uint8Array([1, 2, 3]));
  assert.equal(progress.at(-1), 100);
});

test('still cancels a pending download immediately', async t => {
  const caller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const download = downloadStoreItem(item, undefined, caller.signal);
  const rejected = assert.rejects(download, /canceled/i);
  caller.abort();
  await rejected;
});
