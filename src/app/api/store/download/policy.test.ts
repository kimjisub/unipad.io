import { test } from 'node:test';
import assert from 'node:assert/strict';

import { envAllowRules, isAllowed, parseHttpUrl } from './policy';

/** The full check the route makes on a requested address. */
function allowed(value: string): boolean {
	const url = parseHttpUrl(value);
	return url !== null && isAllowed(url);
}

test('allows the store file hosts', () => {
	for (const value of [
		'https://unipack.unipad.io/packs/a.zip',
		'https://api.unipad.io/download/a.zip',
		'https://us-central1-unipad-e41ab.cloudfunctions.net/download?code=a',
		'https://unipad-e41ab.firebasestorage.app/a.zip',
		'https://unipad-e41ab.appspot.com/a.zip',
		'https://unipad-e41ab.web.app/a.zip',
		'http://unipack.unipad.io/a.zip',
		'https://UNIPACK.UNIPAD.IO/a.zip',
	]) {
		assert.equal(allowed(value), true, value);
	}
});

test('refuses any other host, including look-alikes of an allowed one', () => {
	for (const value of [
		'https://example.com/a.zip',
		'https://unipack.unipad.io.example.com/a.zip',
		'https://evilunipack.unipad.io/a.zip',
		'https://sub.unipack.unipad.io/a.zip',
		'http://127.0.0.1/a.zip',
		'http://169.254.169.254/latest/meta-data/',
		'http://localhost:3000/a.zip',
	]) {
		assert.equal(allowed(value), false, value);
	}
});

test('a "*." rule allows subdomains only, never a host that merely ends in the same letters', () => {
	const rules = envAllowRules(' *.a.io , b.io ,, ');
	assert.deepEqual(rules, [{ host: '*.a.io' }, { host: 'b.io' }]);

	const check = (value: string) => isAllowed(new URL(value), rules);
	assert.equal(check('https://x.a.io/p.zip'), true);
	assert.equal(check('https://x.y.A.IO/p.zip'), true);
	assert.equal(check('https://b.io/p.zip'), true);
	assert.equal(check('https://evila.io/p.zip'), false);
	assert.equal(check('https://a.io/p.zip'), false);
	assert.equal(check('https://x.b.io/p.zip'), false);
	assert.deepEqual(envAllowRules(undefined), []);
});

test('on shared storage hosts, allows this project\'s bucket only', () => {
	assert.equal(allowed('https://storage.googleapis.com/unipad-e41ab.appspot.com/packs/a.zip'), true);
	assert.equal(allowed('https://firebasestorage.googleapis.com/v0/b/unipad-e41ab.appspot.com/o/a.zip?alt=media'), true);

	for (const value of [
		'https://storage.googleapis.com/other-bucket/a.zip',
		'https://storage.googleapis.com/unipad-e41ab.appspot.com.evil/a.zip',
		'https://storage.googleapis.com/unipad-e41ab.appspot.com',
		'https://firebasestorage.googleapis.com/v0/b/other.appspot.com/o/a.zip?alt=media',
		'https://firebasestorage.googleapis.com/v0/b/unipad-e41ab.appspot.com.evil/o/a.zip',
	]) {
		assert.equal(allowed(value), false, value);
	}
});

test('a dot-dot step, plain or percent-encoded, cannot climb out of the bucket path', () => {
	for (const value of [
		'https://storage.googleapis.com/unipad-e41ab.appspot.com/../other-bucket/a.zip',
		'https://storage.googleapis.com/unipad-e41ab.appspot.com/%2e%2e/other-bucket/a.zip',
		'https://storage.googleapis.com/unipad-e41ab.appspot.com/%2E%2e/other-bucket/a.zip',
		'https://storage.googleapis.com/unipad-e41ab.appspot.com/.%2e/other-bucket/a.zip',
		'https://storage.googleapis.com/unipad-e41ab.appspot.com%2f..%2fother-bucket/a.zip',
		'https://firebasestorage.googleapis.com/v0/b/unipad-e41ab.appspot.com/%2e%2e/other.appspot.com/o/a.zip',
	]) {
		assert.equal(allowed(value), false, value);
	}
});

test('refuses addresses with user information', () => {
	for (const value of [
		'https://user:pass@unipack.unipad.io/a.zip',
		'https://user@unipack.unipad.io/a.zip',
		'https://unipack.unipad.io@example.com/a.zip',
	]) {
		assert.equal(parseHttpUrl(value), null, value);
	}
});

test('refuses anything but http and https, and text that is not an address', () => {
	for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://unipack.unipad.io/a.zip', 'data:,x', 'unipack.unipad.io/a.zip', '']) {
		assert.equal(parseHttpUrl(value), null, value);
	}
});

test('never fetches an /api/ path, on any allowed host', () => {
	assert.equal(allowed('https://api.unipad.io/api/store/download?url=x'), false);
	assert.equal(allowed('https://unipack.unipad.io/api/a.zip'), false);
});

test('never allows its own site, so the route cannot send people back into itself', () => {
	for (const value of ['https://unipad.io/a.zip', 'https://www.unipad.io/a.zip', 'https://UNIPAD.IO/a.zip']) {
		assert.equal(allowed(value), false, value);
		assert.equal(isAllowed(new URL(value), [{ host: '*.unipad.io' }, { host: 'unipad.io' }]), false, value);
	}
});
