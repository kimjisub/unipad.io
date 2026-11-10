import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toastDurationMs } from './toastDuration';

function toastMessages(locale: string): Record<string, string> {
  const file = join(process.cwd(), 'src/i18n/messages', `${locale}.json`);
  return JSON.parse(readFileSync(file, 'utf8')).play.toast;
}

test('short notices keep the 2 s display time', () => {
  assert.equal(toastDurationMs('Copied'), 2000);
  assert.equal(toastDurationMs('No MIDI device found.'), 2000);
  assert.equal(toastDurationMs('복사했습니다'), 2000);
});

test('a two-sentence notice stays long enough to read the second sentence', () => {
  for (const locale of ['ko', 'en']) {
    const duration = toastDurationMs(toastMessages(locale).midiUnsupported);
    assert.ok(duration >= 4500, `${locale}: ${duration} ms`);
  }
});

test('Korean and English versions of a notice get comparable time', () => {
  const ko = toastMessages('ko');
  const en = toastMessages('en');
  for (const key of ['downloadConnectionFailed', 'fileReadFailed', 'autoPlaySaved']) {
    const ratio = toastDurationMs(ko[key]) / toastDurationMs(en[key]);
    assert.ok(ratio > 0.6 && ratio < 1.4, `${key}: ko ${toastDurationMs(ko[key])} ms, en ${toastDurationMs(en[key])} ms`);
  }
});

test('no notice stays longer than 6 s', () => {
  assert.equal(toastDurationMs('x'.repeat(500)), 6000);
  for (const message of [...Object.values(toastMessages('en')), ...Object.values(toastMessages('ko'))]) {
    const duration = toastDurationMs(message);
    assert.ok(duration >= 2000 && duration <= 6000, `${message}: ${duration} ms`);
  }
});
