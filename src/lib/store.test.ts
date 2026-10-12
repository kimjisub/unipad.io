import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadStoreItem,
  runStoreDownloadStep,
  storeDownloadErrorType,
  storeDownloadFailParams,
  StoreDownloadError,
  type StoreItem,
} from './store';

const ITEM: StoreItem = {
  code: 'pack-1',
  title: 'Pack',
  producerName: 'Producer',
  isAutoPlay: false,
  isLED: false,
  downloadCount: 0,
};

type FetchStep = Response | Error;

const realFetch = globalThis.fetch;

/** Replaces `fetch` with one that answers each call with the next step, and records the URLs. */
function stubFetch(steps: FetchStep[]): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    if (init?.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    const step = steps.shift();
    if (!step) throw new Error('unexpected fetch');
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  return calls;
}

function status(code: number): Response {
  return new Response(code === 204 ? null : 'body', { status: code });
}

async function downloadErrorType(steps: FetchStep[]): Promise<string> {
  stubFetch(steps);
  try {
    await downloadStoreItem(ITEM);
  } catch (error) {
    return storeDownloadErrorType(error);
  }
  throw new Error('download did not fail');
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a successful download returns the body', async () => {
  stubFetch([new Response(new Uint8Array([1, 2, 3]), { status: 200 })]);
  const data = await downloadStoreItem(ITEM);
  assert.deepEqual(Array.from(new Uint8Array(data)), [1, 2, 3]);
});

test('HTTP failures are typed by status', async () => {
  assert.equal(await downloadErrorType([status(404)]), 'http_404');
  assert.equal(await downloadErrorType([status(500)]), 'http_5xx');
  assert.equal(await downloadErrorType([status(503), status(503)]), 'http_5xx');
  assert.equal(await downloadErrorType([status(429), status(429)]), 'http_other');
  assert.equal(await downloadErrorType([status(413)]), 'http_other');
});

test('a proxy refusal falls back to the direct URL and reports its status', async () => {
  const calls = stubFetch([status(403), status(404)]);
  await assert.rejects(downloadStoreItem(ITEM), (error) => storeDownloadErrorType(error) === 'http_404');
  assert.match(calls[0], /^\/api\/store\/download\?url=/);
  assert.match(calls[1], /^https:\/\//);

  // The direct URL is usually blocked by the browser (CORS), which surfaces as a thrown fetch.
  assert.equal(
    await downloadErrorType([status(403), new TypeError('Failed to fetch'), status(403), new TypeError('Failed to fetch')]),
    'http_403',
  );
});

test('a fetch that keeps throwing is a network failure, with the message people saw before', async () => {
  stubFetch([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
  await assert.rejects(downloadStoreItem(ITEM), (error) => {
    assert.equal(storeDownloadErrorType(error), 'network');
    assert.equal((error as Error).message, 'Network error while downloading store item: Failed to fetch');
    return true;
  });
});

test('a body that breaks off mid-download is a network failure', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.error(new TypeError('network error'));
    },
  });
  assert.equal(await downloadErrorType([new Response(body, { status: 200 })]), 'network');
});

test('canceling the download reports a cancel, not a failure', async () => {
  const controller = new AbortController();
  controller.abort();
  stubFetch([]);
  await assert.rejects(downloadStoreItem(ITEM, undefined, controller.signal), (error) => {
    assert.equal((error as Error).message, 'Download was canceled.');
    assert.equal(storeDownloadFailParams(error, controller.signal.aborted), null);
    return true;
  });
});

test('steps after the download are typed and keep their message', async () => {
  await assert.rejects(
    runStoreDownloadStep('invalid_pack', async () => {
      throw new Error('Invalid UniPack: missing info file');
    }),
    (error) => {
      assert.equal(storeDownloadErrorType(error), 'invalid_pack');
      assert.equal((error as Error).message, 'Invalid UniPack: missing info file');
      return true;
    },
  );
  await assert.rejects(
    runStoreDownloadStep('storage', async () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }),
    (error) => storeDownloadErrorType(error) === 'storage',
  );
  assert.equal(await runStoreDownloadStep('storage', async () => 7), 7);
});

test('a typed error passes through a later step unchanged', async () => {
  const original = new StoreDownloadError('http_404', 'Store download failed (HTTP 404).');
  await assert.rejects(
    runStoreDownloadStep('storage', async () => {
      throw original;
    }),
    (error) => error === original,
  );
});

test('fail parameters carry the failure type, and untyped errors are "other"', () => {
  assert.deepEqual(storeDownloadFailParams(new StoreDownloadError('http_5xx', 'x'), false), { error_type: 'http_5xx' });
  assert.deepEqual(storeDownloadFailParams(new Error('boom'), false), { error_type: 'other' });
  assert.equal(storeDownloadFailParams(new Error('boom'), true), null);
});
