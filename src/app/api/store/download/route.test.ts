import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { GET } from './route';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Fails the test on any fetch: the route only checks the address and redirects. */
function forbidFetch(): string[] {
	const calls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		calls.push(String(input));
		throw new Error(`unexpected fetch of ${String(input)}`);
	}) as typeof fetch;
	return calls;
}

function download(url: string | null, headers?: Record<string, string>): Response {
	const address = new URL('https://unipad.io/api/store/download');
	if (url !== null) address.searchParams.set('url', url);
	return GET(new NextRequest(address, { headers }));
}

test('sends an allowed address to the file host with a 302 and no body, without fetching it', async () => {
	const calls = forbidFetch();
	for (const url of [
		'https://unipack.unipad.io/store/_Love_U.zip',
		'https://unipack.unipad.io/store/a.zip?v=1',
		'https://us-central1-unipad-e41ab.cloudfunctions.net/downloadUniPackLegacy?code=_Faded',
		'https://storage.googleapis.com/unipad-e41ab.appspot.com/packs/final.zip',
	]) {
		for (const headers of [undefined, { range: 'bytes=0-3' }]) {
			const response = download(url, headers);
			assert.equal(response.status, 302, url);
			assert.equal(response.headers.get('location'), url);
			assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
			assert.equal(await response.text(), '');
		}
	}
	assert.equal(calls.length, 0);
});

test('refuses a missing or non-http address', () => {
	forbidFetch();
	for (const url of [null, 'javascript:alert(1)', 'not a url', 'https://user:pw@unipack.unipad.io/a.zip']) {
		const response = download(url);
		assert.equal(response.status, 400, String(url));
		assert.equal(response.headers.get('location'), null);
	}
});

test('refuses a host or path that is not allowed, so it is not an open redirect', () => {
	forbidFetch();
	for (const url of [
		'https://example.com/a.zip',
		'https://evilunipad.io/a.zip',
		'http://169.254.169.254/latest/meta-data/',
		'https://storage.googleapis.com/other-bucket/a.zip',
		'https://storage.googleapis.com/unipad-e41ab.appspot.com/%2e%2e/other-bucket/a.zip',
		'https://api.unipad.io/api/store/download?url=x',
		'https://unipad.io/api/store/download?url=x',
		'https://unipad.io/a.zip',
	]) {
		const response = download(url);
		assert.equal(response.status, 403, url);
		assert.equal(response.headers.get('location'), null);
	}
});
