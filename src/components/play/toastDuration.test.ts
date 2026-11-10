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
  const korean = '이 브라우저는 MIDI 기기 연결을 지원하지 않습니다. 화면 패드로 계속 연주할 수 있습니다.';
  const english = "This browser can't connect to MIDI devices. You can keep playing with the on-screen pads.";
  assert.ok(toastDurationMs(korean) >= 4500, `${toastDurationMs(korean)} ms`);
  assert.ok(toastDurationMs(english) >= 4500, `${toastDurationMs(english)} ms`);
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
