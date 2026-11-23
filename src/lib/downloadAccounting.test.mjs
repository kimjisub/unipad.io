import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DownloadAccounting, downloadAccountingEndpoint } from './downloadAccounting.ts';

const DAY = 86400000;
const KEY = 'unipad:download-reports:v1';
const EMULATOR = 'http://127.0.0.1:5051/demo-unipad/us-central1/';
const receipt = n => `000000000001.${n.toString(16).padStart(64, '0')}`;
const settle = async () => { for (let n = 0; n < 6; n++) await new Promise(resolve => setImmediate(resolve)); };
function fixture() {
  const values = new Map();
  const calls = [];
  let now = 1800000000000, serial = 0, active = true;
  let complete = 'counted', issue = 'issued', tail = Promise.resolve();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const options = {
    endpoint: EMULATOR, storage, active: () => active, now: () => now,
    lock: work => { const next = tail.then(work); tail = next.catch(() => {}); return next; },
    request: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return Response.json(url.endsWith('issueDownloadReceipt')
        ? { status: issue, receipt: receipt(++serial), expiresAt: now + 7 * DAY }
        : { status: complete });
    },
  };
  return { options, values, calls, queue: () => JSON.parse(values.get(KEY) ?? '[]'),
    now: () => now, advance: ms => now += ms, active: value => active = value,
    complete: value => complete = value, issue: value => issue = value,
    reports: () => calls.filter(c => c.url.endsWith('completeDownload')),
    row: (n = 1, overrides = {}) => ({ code: 'pack', receipt: receipt(n), expiresAt: now + 7 * DAY,
      completedAt: now, attempts: [], ...overrides }),
  };
}

test('live accounting requires the exact public origin and excludes automation; emulator never falls back', () => {
  assert.match(downloadAccountingEndpoint('https://unipad.io', false), /^https:/);
  for (const origin of ['https://www.unipad.io', 'http://unipad.io', 'https://unipad.io.evil.example', 'https://preview.vercel.app', 'http://localhost:3000', 'null', '']) {
    assert.equal(downloadAccountingEndpoint(origin, false), null);
  }
  assert.equal(downloadAccountingEndpoint('https://unipad.io', true), null);
  assert.equal(downloadAccountingEndpoint('http://localhost:3000', true, EMULATOR), EMULATOR);
  assert.equal(downloadAccountingEndpoint('http://127.0.0.1:3000', true, EMULATOR), EMULATOR);
  assert.equal(downloadAccountingEndpoint('https://unipad.io', false, EMULATOR), null);
  assert.equal(downloadAccountingEndpoint('http://localhost:3000', false, 'https://live.example'), null);
});

test('issuance starts independently and only a saved download sends one completion with minimal fields', async () => {
  const f = fixture(); const client = new DownloadAccounting(f.options);
  const saved = client.begin('pack');
  await settle();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].body, { code: 'pack' });
  assert.equal(f.queue().length, 0);
  saved(); saved(); await settle();
  assert.equal(f.reports().length, 1);
  assert.deepEqual(f.reports()[0].body, { code: 'pack', receipt: receipt(1) });
  for (const call of f.calls) {
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.referrerPolicy, 'no-referrer');
    assert.equal(call.options.cache, 'no-store');
  }
  assert.deepEqual(f.queue(), []);
  client.begin('pack')(); await settle();
  assert.equal(f.reports().length, 2);
  assert.notEqual(f.reports()[0].body.receipt, f.reports()[1].body.receipt);
});

test('a late receipt still accounts for a saved download, without waiting to save', async () => {
  const f = fixture(); let reply;
  const client = new DownloadAccounting({ ...f.options, request: (url, options) => url.endsWith('issueDownloadReceipt')
    ? new Promise(resolve => { reply = resolve; }) : f.options.request(url, options) });
  const saved = client.begin('pack'); saved();
  assert.equal(f.reports().length, 0);
  reply(Response.json({ status: 'issued', receipt: receipt(1), expiresAt: f.now() + DAY }));
  await settle(); assert.equal(f.reports().length, 1);
});

for (const status of ['disabled', 'deferred', 'invalid', 'unknown']) {
  test(`issuance ${status} never creates a pending completion`, async () => {
    const f = fixture(); f.issue(status); new DownloadAccounting(f.options).begin('pack')();
    await settle(); assert.equal(f.reports().length, 0); assert.deepEqual(f.queue(), []);
  });
}

test('a failed or canceled download never calls its save callback or sends a completion', async () => {
  const f = fixture(); const client = new DownloadAccounting(f.options);
  for (const code of ['failed', 'canceled', 'invalid-zip', 'storage-error']) client.begin(code);
  await settle(); await client.flush(); assert.equal(f.reports().length, 0);
});

for (const status of ['counted', 'already_counted', 'expired', 'invalid']) {
  test(`${status} removes its pending report and does not skip the next queued report`, async () => {
    const f = fixture(); f.complete(status); f.values.set(KEY, JSON.stringify([f.row(1), f.row(2)]));
    await new DownloadAccounting(f.options).flush();
    assert.equal(f.reports().length, 2); assert.deepEqual(f.queue(), []);
  });
}

for (const status of ['deferred', 'disabled', 'unknown']) {
  test(`${status} persists the same receipt across reopen with a one-minute and rolling daily budget`, async () => {
    const f = fixture(); f.complete(status);
    new DownloadAccounting(f.options).begin('pack')(); await settle();
    assert.equal(f.reports().length, 1);
    let reopened = new DownloadAccounting(f.options);
    await reopened.flush(); assert.equal(f.reports().length, 1);
    f.advance(59999); await reopened.flush(); assert.equal(f.reports().length, 1);
    f.advance(1); await reopened.flush(); assert.equal(f.reports().length, 2);
    f.advance(60000); await reopened.flush(); assert.equal(f.reports().length, 3);
    f.advance(60000); reopened = new DownloadAccounting(f.options);
    await reopened.flush(); assert.equal(f.reports().length, 3);
    f.advance(-DAY); await reopened.flush(); assert.equal(f.reports().length, 3);
    f.advance(2 * DAY); await reopened.flush(); assert.equal(f.reports().length, 4);
    assert.ok(f.reports().every(call => call.body.receipt === receipt(1)));
  });
}

test('offline and hidden pages retain pending reports until used again', async () => {
  const f = fixture(); f.active(false); f.values.set(KEY, JSON.stringify([f.row()]));
  const client = new DownloadAccounting(f.options); await client.flush();
  assert.equal(f.reports().length, 0); assert.equal(f.queue().length, 1);
  client.begin('offline')(); await settle(); assert.equal(f.calls.length, 0);
  f.active(true); await client.flush(); assert.equal(f.reports().length, 1);
});

test('expiry is the earlier of server expiration and seven days since save; oldest overflow is discarded', async () => {
  const f = fixture(); f.active(false);
  f.values.set(KEY, JSON.stringify([f.row(1, { expiresAt: f.now() }), f.row(2, { completedAt: f.now() - 7 * DAY }),
    ...Array.from({ length: 1001 }, (_, n) => f.row(n + 3, { completedAt: f.now() - 1001 + n }))]));
  await new DownloadAccounting(f.options).flush();
  assert.equal(f.queue().length, 1000); assert.equal(f.queue()[0].receipt, receipt(4));
  f.advance(8 * DAY); await new DownloadAccounting(f.options).flush(); assert.deepEqual(f.queue(), []);
});

test('two tabs share the retry budget and concurrent triggers do not resend', async () => {
  const f = fixture(); f.complete('deferred'); f.values.set(KEY, JSON.stringify([f.row()]));
  const a = new DownloadAccounting(f.options), b = new DownloadAccounting(f.options);
  await Promise.all([a.flush(), a.flush(), b.flush()]); assert.equal(f.reports().length, 1);
});

test('denied storage and malformed records never reject a download callback', async () => {
  const f = fixture(); f.complete('deferred');
  const storage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  const client = new DownloadAccounting({ ...f.options, storage }); client.begin('pack')(); await settle();
  assert.equal(f.reports().length, 0); f.advance(60000); await client.flush(); assert.equal(f.reports().length, 0);
  for (const invalid of ['null', '{bad', '[{}]', '[{"code":"pack","attempts":[-1]}]']) {
    f.values.set(KEY, invalid); await new DownloadAccounting(f.options).flush();
  }
});

test('hung headers and bodies are aborted at five seconds and keep the same pending record', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const stage of ['headers', 'body']) {
    const f = fixture(); f.values.set(KEY, JSON.stringify([f.row()])); let signal;
    const client = new DownloadAccounting({ ...f.options, request: async (_url, options) => {
      signal = options.signal;
      if (stage === 'body') return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      } }));
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    const flushing = client.flush(); await settle();
    t.mock.timers.tick(4999); assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); await flushing; assert.equal(signal.aborted, true);
    assert.equal(f.queue().length, 1); assert.equal(f.queue()[0].attempts.length, 1);
  }
});


test('a second save while a report is in flight is sent when that flush finishes', async () => {
  const f = fixture(); let release;
  const client = new DownloadAccounting({ ...f.options, request: async (url, options) => {
    if (url.endsWith('completeDownload') && !release) await new Promise(resolve => { release = resolve; });
    return f.options.request(url, options);
  } });
  client.begin('first')(); await settle();
  assert.equal(typeof release, 'function');
  client.begin('second')(); await settle();
  assert.equal(f.queue().length, 2);
  release(); await settle();
  assert.equal(f.reports().length, 2); assert.deepEqual(f.queue(), []);
});

test('a full store that still allows reads omits a report it cannot durably queue', async () => {
  const f = fixture(); f.complete('deferred');
  const client = new DownloadAccounting({ ...f.options, storage: { getItem: () => null, setItem() { throw Error('quota'); } } });
  client.begin('pack')(); await settle();
  assert.equal(f.reports().length, 0);
  f.advance(60000); await client.flush(); assert.equal(f.reports().length, 0);
});

test('a persisted report is not sent when its retry attempt cannot be recorded', async () => {
  const now = 1800000000000;
  const rows = [{ code: 'pack', receipt: '000000000001.' + '1'.repeat(64), expiresAt: now + 86400000, completedAt: now, attempts: [] }];
  let sent = 0;
  const client = new DownloadAccounting({ endpoint: 'http://127.0.0.1:5051/demo-unipad/us-central1/',
    storage: { getItem: () => JSON.stringify(rows), setItem() { throw Error('quota'); } },
    active: () => true, now: () => now, lock: async work => { await work(); },
    request: async () => { sent++; return Response.json({ status: 'deferred' }); },
  });
  await client.flush();
  assert.equal(sent, 0);
});
