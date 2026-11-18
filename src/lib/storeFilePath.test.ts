import { test } from 'node:test';
import assert from 'node:assert/strict';

import { storeFileSitePath } from './storeFilePath';

test('only plain pack files on the store file host take the CDN path', () => {
  assert.equal(storeFileSitePath('https://unipack.unipad.io/store/Pack-1_v2.zip'), '/store-files/Pack-1_v2.zip');
  for (const url of [
    'http://unipack.unipad.io/store/a.zip',
    'https://unipack.unipad.io:8443/store/a.zip',
    'https://unipack.unipad.io/store/a.zip?v=1',
    'https://unipack.unipad.io/store/a.zip#x',
    'https://unipack.unipad.io/store/sub/a.zip',
    'https://unipack.unipad.io/store/%ED%8C%A9.zip',
    'https://unipack.unipad.io/store/a.uni',
    'https://unipack.unipad.io/store/A.ZIP',
    'https://unipack.unipad.io/other/a.zip',
    'https://evil.unipack.unipad.io/store/a.zip',
    'https://us-central1-unipad-e41ab.cloudfunctions.net/downloadUniPackLegacy?code=a',
    'not a url',
  ]) {
    assert.equal(storeFileSitePath(url), null, url);
  }
});
