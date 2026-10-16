import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StoreDownloadError } from '../../lib/store';
import { describeStoreError } from './storeError';

function toastMessages(locale: string): Record<string, string> {
  const file = join(process.cwd(), 'src/i18n/messages', `${locale}.json`);
  return JSON.parse(readFileSync(file, 'utf8')).play.toast;
}

const missingPack = new StoreDownloadError('http_404', 'Store download failed (HTTP 404).');

test('a pack missing on the server is shown in the person\'s language', () => {
  const failure = describeStoreError(missingPack);
  assert.equal(failure.toastKey, 'packNotFound');
  assert.equal(toastMessages('en')[failure.toastKey!], 'Pack not found on server.');
  assert.equal(toastMessages('ko')[failure.toastKey!], '서버에서 팩을 찾을 수 없습니다.');
});

test('analytics keep the English message whatever the page language', () => {
  assert.equal(describeStoreError(missingPack).message, 'Pack not found on server.');
  assert.deepEqual(describeStoreError(new Error('Store download failed (HTTP 503).')), {
    message: 'Store server is temporarily unavailable.',
  });
  assert.deepEqual(describeStoreError('something else'), { message: 'something else' });
});
