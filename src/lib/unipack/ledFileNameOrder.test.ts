import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWithLeds } from './testUtils';

for (const [label, earlier, later] of [
  ['decomposed Latin', 'o', 'n\u0303'],
  ['composed Latin', 'o', '\u00f1'],
  ['decomposed Hangul', '\u3131', '\u1100\u1161'],
  ['composed Hangul', '\u3131', '\uac00'],
  ['UTF-16 order', '\ud83d\ude00', '\ufffd'],
  ['letter case', 'A', 'b'],
]) {
  for (const reversed of [false, true]) {
    test(`LED queue uses NFC lower-case UTF-16 order: ${label}, reversed=${reversed}`, async () => {
      const entries: [string, string][] = [
        [`1 1 1 1 ${earlier}`, 'd 10'],
        [`1 1 1 1 ${later}`, 'd 20'],
      ];
      if (reversed) entries.reverse();
      const pack = await parseWithLeds(Object.fromEntries(entries));
      assert.deepEqual(pack.errors, []);
      assert.deepEqual(pack.ledAnimationTable![0][0][0]!.map(a => a.ledEvents), [
        [{ type: 'delay', delay: 10 }],
        [{ type: 'delay', delay: 20 }],
      ]);
    });
  }
}
