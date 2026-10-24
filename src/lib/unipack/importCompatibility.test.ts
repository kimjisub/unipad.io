import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseUniPack } from './parser';
import { INFO_2X2_2CHAIN as info, SILENT_WAV, packZip, parseWithLeds, rawNameZip } from './testUtils';

describe('archive and sound import compatibility', () => {
  for (const [written, stored] of [
    ['소리.wav', '소리.wav'.normalize('NFD')],
    ['소리.wav'.normalize('NFD'), '소리.wav'],
    ['CAFÉ.wav'.normalize('NFD'), 'café.wav'],
    ['fx\\s.wav', 'fx/s.wav'], ['./a.wav', 'a.wav'], ['/a.wav', 'a.wav'],
    ['fx//s.wav', 'fx/s.wav'], ['fx/./s.wav', 'fx/s.wav'],
  ]) {
    test(`resolves ${JSON.stringify(written)} to the stored sound ${JSON.stringify(stored)}`, async () => {
      const pack = await parseUniPack(await packZip({ info, keySound: `1 1 1 ${written}`, [`sounds/${stored}`]: SILENT_WAV }));
      assert.deepEqual(pack.errors, []);
      assert.equal(pack.soundTable[0][0][0]![0].file, `sounds/${stored}`);
      assert.deepEqual(new Uint8Array(pack.soundFiles.get(`sounds/${stored}`)!), SILENT_WAV);
    });
  }

  test('exact, then canonical, then case-insensitive sound matching uses full-path order', async () => {
    const pack = await parseUniPack(await packZip({
      info, keySound: '1 1 1 End.wav\n1 1 2 end.wav\n1 2 1 Fx/b.wav\n1 2 2 소리.wav',
      'sounds/end.wav': new Uint8Array([1]), 'sounds/END.wav': new Uint8Array([2]),
      'sounds/FX/a.wav': SILENT_WAV, 'sounds/fx/b.wav': SILENT_WAV,
      [`sounds/${'소리.wav'.normalize('NFD')}`]: new Uint8Array([3]), 'sounds/소리.wav': new Uint8Array([4]),
    }));
    assert.deepEqual(pack.errors, []);
    assert.equal(pack.soundTable[0][0][0]![0].file, 'sounds/END.wav');
    assert.equal(pack.soundTable[0][0][1]![0].file, 'sounds/end.wav');
    assert.equal(pack.soundTable[0][1][0]![0].file, 'sounds/fx/b.wav');
    assert.equal(pack.soundTable[0][1][1]![0].file, 'sounds/소리.wav');
  });

  for (const [composed, fallback] of [['소리.wav', '소리.WAV'], ['café.wav', 'CAFÉ.wav']]) {
    const decomposed = composed.normalize('NFD');
    for (const [written, selected, bytes] of [
      [composed, composed, [6, 6, 0]],
      [decomposed, decomposed, [4, 4, 0]],
      [fallback, decomposed, [4, 4, 0]],
    ] as const) {
      for (const reversed of [false, true]) {
        test(`selects the original name and bytes for ${JSON.stringify(written)} (reversed=${reversed})`, async () => {
          const sounds: [string, Uint8Array][] = [
            [`sounds/${composed}`, new Uint8Array([6, 6, 0])],
            [`sounds/${decomposed}`, new Uint8Array([4, 4, 0])],
          ];
          if (reversed) sounds.reverse();
          const pack = await parseUniPack(await packZip({ info, keySound: `1 1 1 ${written}`, ...Object.fromEntries(sounds) }));
          assert.deepEqual(pack.errors, []);
          const file = pack.soundTable[0][0][0]![0].file;
          assert.equal(file, `sounds/${selected}`);
          assert.deepEqual([...new Uint8Array(pack.soundFiles.get(file)!)], bytes);
        });
      }
    }
  }

  test('sound references cannot escape the sounds directory', async () => {
    const pack = await parseUniPack(await packZip({ info, keySound: '1 1 1 ../outside.wav\n1 1 2 ..\\outside.wav', 'outside.wav': SILENT_WAV }));
    assert.equal(pack.soundCount, 0);
    assert.equal(pack.errors.length, 2);
  });

  for (const prefix of ['', 'My Pack\\']) {
    test(`opens Windows archive paths with sounds and lights (${JSON.stringify(prefix)})`, async () => {
      const pack = await parseUniPack(await packZip({
        [`${prefix}info`]: info, [`${prefix}keySound`]: '1 1 1 fx/s.wav',
        [`${prefix}sounds\\fx\\s.wav`]: SILENT_WAV, [`${prefix}keyLed\\1 1 1`]: 'o 1 1 FF0000',
      }));
      assert.deepEqual(pack.errors, []);
      assert.equal(pack.soundCount, 1);
      assert.equal(pack.ledCount, 1);
    });
  }

  test('a root pack wins over an earlier nested backup info', async () => {
    const pack = await parseUniPack(await packZip({
      'backup/info': info.replace('title=Test', 'title=Backup'), 'backup/keySound': '',
      info, keySound: '1 1 1 a.wav', 'sounds/a.wav': SILENT_WAV,
    }));
    assert.equal(pack.info.title, 'Test');
    assert.equal(pack.soundCount, 1);
  });

  test('ignores hidden info sidecars when finding the unique pack', async () => {
    const pack = await parseUniPack(await packZip({
      '.backup/info': info, '__MACOSX/info': info,
      'Pack/info': info, 'Pack/keySound': '1 1 1 a.wav', 'Pack/sounds/a.wav': SILENT_WAV,
    }));
    assert.deepEqual(pack.errors, []);
    assert.equal(pack.soundCount, 1);
  });

  for (const names of [['A/', 'B/'], ['outer/A/', 'outer/B/']]) {
    test(`refuses multiple packs with a specific reason (${names.join(', ')})`, async () => {
      const files = Object.fromEntries(names.flatMap(prefix => [[`${prefix}info`, info], [`${prefix}keySound`, '']]));
      await assert.rejects(parseUniPack(await packZip(files)), /Invalid UniPack:.*multiple packs/i);
    });
  }

  test('decodes a CP949 name even when the archive marks it as UTF-8', async () => {
    const encoder = new TextEncoder();
    const name = new Uint8Array([...encoder.encode('sounds/'), 0xc7, 0xd1, ...encoder.encode('.wav')]);
    const archive = rawNameZip([[encoder.encode('info'), info], [encoder.encode('keySound'), '1 1 1 한.wav'], [name, SILENT_WAV]], true);
    const original = new Uint8Array(archive).slice();
    const pack = await parseUniPack(archive);
    assert.deepEqual(new Uint8Array(archive), original, 'import does not edit the saved archive');
    assert.deepEqual(pack.errors, []);
    assert.equal(pack.soundTable[0][0][0]![0].file, 'sounds/한.wav');
  });

  for (const field of ['buttonX', 'buttonY']) {
    test(`refuses a missing ${field} but preserves an explicit zero`, async () => {
      await assert.rejects(parseUniPack(await packZip({ info: info.split('\n').filter(line => !line.startsWith(`${field}=`)).join('\n'), keySound: '' })), new RegExp(`Invalid UniPack:.*${field}.*missing`));
      const pack = await parseUniPack(await packZip({ info: info.replace(`${field}=2`, `${field}=0`), keySound: '' }));
      assert.equal(pack.info[field as 'buttonX' | 'buttonY'], 0);
      assert.deepEqual(pack.errors, [`info: ${field} was missing`]);
    });
  }

  for (const change of ['chain=25', 'chain=abc', 'buttonX=-1', 'buttonY=65']) {
    test(`explains the actual info refusal (${change})`, async () => {
      const field = change.split('=')[0];
      await assert.rejects(parseUniPack(await packZip({ info: info.replace(new RegExp(`${field}=2`), change), keySound: '' })), /Invalid UniPack: info:.*out of range/);
    });
  }

  for (const line of ['o mc 99', 'o * 0 FF0000 5 6']) {
    test(`warns about column count before the round-light range (${line})`, async () => {
      const pack = await parseWithLeds({ '1 1 1': line });
      assert.deepEqual(pack.errors, [`keyLed: [1 1 1].[${line}] format is incorrect`]);
      assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, []);
    });
  }
});
