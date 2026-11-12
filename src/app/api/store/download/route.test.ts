import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { GET } from './route';

const PACK = 'https://unipack.unipad.io/packs/pack.zip';
const MB = 1024 * 1024;

type Call = { url: string; init?: RequestInit };

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Replaces `fetch` with one that answers each call with the next response, and records the calls. */
function stubFetch(responses: Array<Response | Error>): Call[] {
	const calls: Call[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		const next = responses.shift();
		if (!next) throw new Error(`unexpected fetch of ${String(input)}`);
		if (next instanceof Error) throw next;
		return next;
	}) as typeof fetch;
	return calls;
}

function redirect(location: string, status = 302): Response {
	return new Response(null, { status, headers: { location } });
}

function file(headers: Record<string, string> = {}, status = 200): Response {
	return new Response('zip-bytes', { status, headers: { 'content-type': 'application/zip', ...headers } });
}

function download(url: string | null, headers?: Record<string, string>): Promise<Response> {
	const address = new URL('https://unipad.io/api/store/download');
	if (url !== null) address.searchParams.set('url', url);
	return GET(new NextRequest(address, { headers }));
}

test('streams an allowed file back as a download, fetching redirects by hand', async () => {
	const calls = stubFetch([file({ 'content-length': '9', etag: '"e"' })]);
	const response = await download(PACK);

	assert.equal(response.status, 200);
	assert.equal(await response.text(), 'zip-bytes');
	assert.equal(response.headers.get('content-disposition'), 'attachment; filename="pack.zip"; filename*=UTF-8\'\'pack.zip');
	assert.equal(response.headers.get('content-length'), '9');
	assert.equal(response.headers.get('etag'), '"e"');
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
	assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
	assert.deepEqual(calls.map((c) => c.url), [PACK]);
	assert.equal(calls[0].init?.redirect, 'manual');
});

test('refuses a missing or non-http address without fetching', async () => {
	const calls = stubFetch([]);
	for (const url of [null, 'javascript:alert(1)', 'not a url', 'https://user:pw@unipack.unipad.io/a.zip']) {
		assert.equal((await download(url)).status, 400, String(url));
	}
	assert.equal(calls.length, 0);
});

test('refuses a host or path that is not allowed without fetching', async () => {
	const calls = stubFetch([]);
	for (const url of [
		'https://example.com/a.zip',
		'https://evilunipad.io/a.zip',
		'https://storage.googleapis.com/other-bucket/a.zip',
		'https://storage.googleapis.com/unipad-e41ab.appspot.com/%2e%2e/other-bucket/a.zip',
		'https://api.unipad.io/api/store/download?url=x',
		'https://unipad.io/api/store/download?url=x',
	]) {
		assert.equal((await download(url)).status, 403, url);
	}
	assert.equal(calls.length, 0);
});

test('follows a redirect to another allowed address and names the file after it', async () => {
	const final = 'https://storage.googleapis.com/unipad-e41ab.appspot.com/packs/final.zip';
	const calls = stubFetch([redirect(final, 307), file()]);
	const response = await download(PACK);

	assert.equal(response.status, 200);
	assert.deepEqual(calls.map((c) => c.url), [PACK, final]);
	assert.ok(calls.every((c) => c.init?.redirect === 'manual'));
	assert.match(response.headers.get('content-disposition') ?? '', /filename="final\.zip"/);
});

test('checks every redirect target and stops at one that is not allowed', async () => {
	for (const location of [
		'https://example.com/a.zip',
		'http://169.254.169.254/latest/meta-data/',
		'https://storage.googleapis.com/other-bucket/a.zip',
		'/api/store/download?url=x',
		'https://unipad.io/a.zip',
		'javascript:alert(1)',
	]) {
		const calls = stubFetch([redirect(location)]);
		assert.equal((await download(PACK)).status, 403, location);
		assert.equal(calls.length, 1, `${location} is never fetched`);
	}
});

test('follows up to three redirects and refuses the fourth', async () => {
	const hop = (n: number) => `https://unipack.unipad.io/hop${n}.zip`;

	let calls = stubFetch([redirect(hop(1)), redirect(hop(2)), redirect(hop(3)), file()]);
	assert.equal((await download(PACK)).status, 200);
	assert.equal(calls.length, 4);

	calls = stubFetch([redirect(hop(1)), redirect(hop(2)), redirect(hop(3)), redirect(hop(4))]);
	assert.equal((await download(PACK)).status, 502);
	assert.deepEqual(calls.map((c) => c.url), [PACK, hop(1), hop(2), hop(3)]);
});

test('refuses a file larger than 200 MB and serves one of exactly 200 MB', async () => {
	stubFetch([file({ 'content-length': String(200 * MB + 1) })]);
	assert.equal((await download(PACK)).status, 413);

	stubFetch([file({ 'content-length': String(200 * MB) })]);
	assert.equal((await download(PACK)).status, 200);
});

test('passes on missing-file answers, turns other upstream failures into 502, and hides their text', async () => {
	for (const [upstream, expected] of [[403, 403], [404, 404], [410, 410], [416, 416], [500, 502], [401, 502]] as const) {
		stubFetch([new Response('secret upstream text', { status: upstream })]);
		const response = await download(PACK);
		assert.equal(response.status, expected, `upstream ${upstream}`);
		assert.doesNotMatch(await response.text(), /secret/);
	}

	stubFetch([new Error('connect ECONNREFUSED 10.0.0.1')]);
	const originalError = console.error;
	console.error = () => {};
	try {
		const response = await download(PACK);
		assert.equal(response.status, 502);
		assert.doesNotMatch(await response.text(), /ECONNREFUSED/);
	} finally {
		console.error = originalError;
	}
});

test('forwards a range request and never caches a partial answer', async () => {
	const calls = stubFetch([file({ 'content-range': 'bytes 0-3/9', 'content-length': '4' }, 206)]);
	const response = await download(PACK, { range: 'bytes=0-3' });

	assert.equal(response.status, 206);
	assert.equal(new Headers(calls[0].init?.headers).get('range'), 'bytes=0-3');
	assert.equal(response.headers.get('content-range'), 'bytes 0-3/9');
	assert.equal(response.headers.get('cache-control'), 'no-store');
});
