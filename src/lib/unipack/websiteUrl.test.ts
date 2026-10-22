import assert from 'node:assert/strict';
import { test } from 'node:test';
import { websiteUrl } from './websiteUrl';

for (const [value, expected] of [
  ['unipad.io', 'https://unipad.io'], ['unipad.io/packs?a=b', 'https://unipad.io/packs?a=b'],
  ['https://unipad.io', 'https://unipad.io'], ['http://unipad.io', 'http://unipad.io'],
  [' HTTPS://unipad.io ', 'HTTPS://unipad.io'], ['//unipad.io', 'https://unipad.io'],
  ['javascript:alert(1)', null], ['data:text/html,test', null], ['file:///tmp/test', null],
  ['mailto:test@example.com', null], ['https://', null], ['bad host', null], ['', null], [null, null],
] as const) {
  test(`website link ${JSON.stringify(value)} becomes ${JSON.stringify(expected)}`, () => {
    assert.equal(websiteUrl(value), expected);
  });
}
