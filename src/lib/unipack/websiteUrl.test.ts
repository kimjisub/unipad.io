import assert from 'node:assert/strict';
import { test } from 'node:test';
import { websiteUrl } from './websiteUrl';

for (const [value, expected] of [
  ['unipad.io', 'https://unipad.io/'], ['unipad.io/packs?a=b', 'https://unipad.io/packs?a=b'],
  ['https://unipad.io', 'https://unipad.io/'], ['http://unipad.io', 'http://unipad.io/'],
  [' HTTPS://unipad.io ', 'https://unipad.io/'], ['//unipad.io', 'https://unipad.io/'],
  ['https:unipad.io', 'https://unipad.io/'], ['http:unipad.io/x', 'http://unipad.io/x'],
  ['example.com:8080/pack', 'https://example.com:8080/pack'], ['localhost:3000', 'https://localhost:3000/'],
  ['javascript:alert(1)', null], ['data:text/html,test', null], ['file:///tmp/test', null],
  ['mailto:test@example.com', null], ['tel:911', null], ['mailto:12345', null], ['javascript:0', null],
  ['javascript:0/alert(1)', null], ['data:1', null], ['file:1', null], ['LOCALHOST:3000', 'https://localhost:3000/'],
  // An http(s) scheme is always the scheme, never a host named `https` or `http`.
  ['https:443/x', 'https://0.0.1.187/x'], ['http:8080', 'http://0.0.31.144/'],
  ['https://', null], ['bad host', null], ['', null], [null, null],
] as const) {
  test(`website link ${JSON.stringify(value)} becomes ${JSON.stringify(expected)}`, () => {
    assert.equal(websiteUrl(value), expected);
  });
}

test('website link is absolute when resolved against a page of the site', () => {
  for (const value of ['https:unipad.io', 'http:unipad.io/x', 'unipad.io']) {
    const href = websiteUrl(value);
    assert.ok(href);
    assert.equal(new URL(href, 'https://unipad.io/play').href, href);
  }
});

test('a long website value is checked in linear time', () => {
  for (const value of ['.'.repeat(50_000), 'a.'.repeat(50_000), `${'a.'.repeat(50_000)}com:8080`]) {
    const started = performance.now();
    websiteUrl(value);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 200, `${value.length} characters took ${elapsed.toFixed(1)} ms`);
  }
});
