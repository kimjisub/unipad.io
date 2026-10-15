// Tests of number-warnings.mjs on warnings written by hand for this file, not collected from a parser
// run. The same classification of warnings the real web parser wrote is checked in
// src/lib/unipack/conformance.test.ts. `pnpm test:unipack` runs this file too.
// Alone: node --test meta/unipack-conformance/diagnostics/selftest.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAPTURE_KIND, classifyCapture, classifyWarning, FORMAT, INSUFFICIENT, NOT_A_NUMBER_WARNING, RANGE,
} from './number-warnings.mjs';

const PACK = { buttonX: 4, buttonY: 3, chain: 2 };
const causeOf = (raw, pack = PACK) => classifyWarning({ raw, pack }).cause;

test('a missing value, letters, a decimal or characters after the digits are a format failure', () => {
  for (const raw of [
    'autoPlay: [on a 1] coordinate is incorrect', 'autoPlay: [on 1] coordinate is incorrect', 'autoPlay: [o 1 1b] coordinate is incorrect',
    'autoPlay: [chain] chain is incorrect', 'autoPlay: [c z] chain is incorrect', 'autoPlay: [delay 1.5] delay is incorrect', 'autoPlay: [d x] delay is incorrect',
    'keyLed: [a 1 1] chain is incorrect', 'keyLed: [1 b 1] x is incorrect', 'keyLed: [1 1 c] y is incorrect', 'keyLed: [1 1 1 1.5] loop is incorrect',
  ]) assert.equal(causeOf(raw), FORMAT, raw);
  assert.deepEqual(classifyWarning({ raw: 'autoPlay: [on 1] coordinate is incorrect', pack: PACK }).tokens, [
    { position: 1, value: '1', problem: null }, { position: 2, value: null, problem: 'missing' },
  ]);
});

test('the parser\'s own "format is incorrect" for an autoPlay line or keyLed file name is read the same way', () => {
  for (const raw of ['autoPlay: [on a 1] format is incorrect', 'autoPlay: [c z] format is incorrect', 'autoPlay: [d 1.5] format is incorrect',
    'keyLed: [1 b 1] format is incorrect', 'keyLed: [1 1 1 1.5] format is incorrect']) assert.equal(causeOf(raw), FORMAT, raw);
  assert.deepEqual(classifyWarning({ raw: 'keyLed: [1 1 1 x] format is incorrect', pack: PACK }).tokens.map((t) => t.problem), [null, null, null, 'not-a-number']);
  assert.deepEqual(classifyWarning({ raw: 'keyLed: [1 1 x] format is incorrect', pack: PACK }).tokens.map((t) => t.position), [0, 1, 2]);
});

test('a format failure needs no pack size, so a missing one does not hide it', () => {
  assert.equal(causeOf('keyLed: [1 b 1] x is incorrect', null), FORMAT);
});

test('a valid integer outside the pack stays a range failure', () => {
  for (const raw of ['autoPlay: [on 5 1] coordinate is incorrect', 'autoPlay: [chain 3] chain is incorrect', 'keyLed: [3 1 1] chain is incorrect',
    'keyLed: [1 5 1] x is incorrect', 'keyLed: [1 1 1 -1] loop is incorrect', 'keySound: [1 1 4 a.wav] y is incorrect']) assert.equal(causeOf(raw), RANGE, raw);
});

test('the same sentence end is format or range depending on the input, not on the words', () => {
  assert.equal(causeOf('keyLed: [1 b 1] x is incorrect'), FORMAT);
  assert.equal(causeOf('keyLed: [1 5 1] x is incorrect'), RANGE);
  assert.equal(causeOf('autoPlay: [on a 1] coordinate is incorrect'), FORMAT);
  assert.equal(causeOf('autoPlay: [on 5 1] coordinate is incorrect'), RANGE);
});

test('the pack size decides range: the same warning in a wider pack is not explained', () => {
  assert.equal(causeOf('autoPlay: [on 5 1] coordinate is incorrect', { ...PACK, buttonX: 8 }), INSUFFICIENT);
});

test('what the warning and the pack size cannot decide is insufficient information', () => {
  const cases = {
    'keyLed: [1 [2] 1] x is incorrect': 'bracket',
    'keyLed: [1 b] 1] x is incorrect': 'bracket',
    'autoPlay: [bogus 1 1] coordinate is incorrect': 'not a command',
    'autoPlay: [delay 5] chain is incorrect': 'not a command',
    'autoPlay: [on 99999999999 1] coordinate is incorrect': '32-bit',
    'autoPlay: [delay 3000000000] delay is incorrect': '32-bit',
    'autoPlay: [on 1 1] coordinate is incorrect': 'does not explain',
    'autoPlay: [delay 10] delay is incorrect': 'does not explain',
    'keyLed: [1 1 1 c] coordinate is incorrect': 'has no coordinate',
    'keyLed: [1 [2] 1] format is incorrect': 'bracket',
    'autoPlay: [on 99999999999 1] format is incorrect': '32-bit',
    'autoPlay: [on 1 1] format is incorrect': 'does not explain',
  };
  for (const [raw, reason] of Object.entries(cases)) {
    const result = classifyWarning({ raw, pack: PACK });
    assert.equal(result.cause, INSUFFICIENT, raw);
    assert.ok(result.reason.includes(reason), `${raw}: ${result.reason}`);
  }
  assert.equal(causeOf('autoPlay: [on 5 1] coordinate is incorrect', null), INSUFFICIENT);
  assert.equal(causeOf('keyLed: [3 1 1] chain is incorrect', { buttonX: 4, buttonY: 3 }), INSUFFICIENT);
  // The parser itself reports a zero size as missing (`info: buttonX was missing`).
  assert.equal(causeOf('keySound: [1 1 1 a.wav] x is incorrect', { ...PACK, buttonX: 0 }), INSUFFICIENT);
});

test('warnings that are not about a number are left alone', () => {
  for (const raw of [
    'autoPlay: [bogus 1 1] format is incorrect', 'keyLed: [1 1 1].[o 1 x] format is incorrect', 'keySound: [1 1 1] format is incorrect',
    'keySound: [1 1 1 x.wav] sound was not found', 'info: chain out of range', "info doesn't exist",
  ]) {
    assert.equal(causeOf(raw), NOT_A_NUMBER_WARNING, raw);
  }
});

test('a capture is classified from each raw warning and its pack only, never from the case id or other fields', () => {
  const raw = 'autoPlay: [on a 1] coordinate is incorrect';
  const capture = {
    kind: CAPTURE_KIND, platform: 'web', corpusSha256: 'c', generatedAt: 't', source: { commit: null }, method: 'm',
    cases: [
      { id: 'AP-M01', fingerprint: 'f1', warnings: [raw], pack: PACK, expected: { errors: ['autoPlay:range'] } },
      { id: 'ZZ-999', fingerprint: 'f2', warnings: [raw], pack: PACK },
      { id: 'KL-N02', fingerprint: 'f3', warnings: ['autoPlay: [on 5 1] coordinate is incorrect'], pack: PACK },
      { id: 'X', fingerprint: 'f4', warnings: null, pack: null, refused: 'Invalid UniPack: missing info file' },
    ],
  };
  const out = classifyCapture(capture, 'sha');
  const [first, second, third] = out.warnings;
  assert.deepEqual({ ...first, id: null, fingerprint: null }, { ...second, id: null, fingerprint: null });
  assert.equal(first.cause, FORMAT);
  assert.equal(first.raw, raw);
  assert.equal(third.cause, RANGE);
  assert.deepEqual(out.counts, { format: 2, range: 1, 'insufficient-information': 0, 'not-a-number-warning': 0 });
  assert.deepEqual(out.from, { sha256: 'sha', platform: 'web', corpusSha256: 'c', generatedAt: 't', source: { commit: null }, method: 'm' });
});

test('a file that is not a raw warning capture is refused', () => {
  assert.throws(() => classifyCapture({ platform: 'web', cases: [] }), /not a raw warning capture/);
});
