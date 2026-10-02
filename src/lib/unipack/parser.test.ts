import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LAUNCHPAD_ARGB } from './colors';
import { parseUniPack } from './parser';
import { INFO_2X2_2CHAIN, KEYSOUND_1_1_1, SILENT_WAV, packZip, parseWithLeds } from './testUtils';

describe('parseUniPack', () => {
  test('opens a complete pack wrapped in a top folder', async () => {
    const pack = await parseUniPack(await packZip({
      'My Pack/info': INFO_2X2_2CHAIN,
      'My Pack/keySound': '1 1 1 a.wav\n2 2 2 a.wav',
      'My Pack/sounds/a.wav': SILENT_WAV,
      'My Pack/keyLed/1 1 1': 'o 1 1 a 5\nd 10\nf 1 1',
      'My Pack/autoPlay': 'o 1 1\nd 100\nf 1 1',
    }));

    assert.deepEqual(pack.errors, []);
    assert.deepEqual(pack.info, {
      title: 'Test',
      producerName: 'Tester',
      buttonX: 2,
      buttonY: 2,
      chain: 2,
      squareButton: true,
      website: null,
    });
    assert.equal(pack.soundCount, 2);
    assert.equal(pack.ledCount, 1);
    assert.equal(pack.keyLedExist, true);
    assert.equal(pack.autoPlayExist, true);
    assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, [
      { type: 'on', x: 0, y: 0, color: LAUNCHPAD_ARGB[5], velocity: 5 },
      { type: 'delay', delay: 10 },
      { type: 'off', x: 0, y: 0 },
    ]);
  });

  describe('required information', () => {
    test('rejects a pack without an info file', async () => {
      await assert.rejects(
        parseUniPack(await packZip({ keySound: KEYSOUND_1_1_1, 'sounds/a.wav': SILENT_WAV })),
        { message: 'Invalid UniPack: missing info file' },
      );
    });

    test('rejects an info file without a chain count', async () => {
      await assert.rejects(
        parseUniPack(await packZip({
          info: 'title=Test\nproducerName=Tester\nbuttonX=2\nbuttonY=2',
          keySound: KEYSOUND_1_1_1,
          'sounds/a.wav': SILENT_WAV,
        })),
        { message: 'Invalid UniPack: missing info file' },
      );
    });

    test('rejects a pack without a keySound file', async () => {
      await assert.rejects(
        parseUniPack(await packZip({ info: INFO_2X2_2CHAIN })),
        { message: "Invalid UniPack: keySound doesn't exist" },
      );
    });

    test('opens a pack missing only its title and says so', async () => {
      const pack = await parseUniPack(await packZip({
        info: 'producerName=Tester\nbuttonX=2\nbuttonY=2\nchain=1',
        keySound: KEYSOUND_1_1_1,
        'sounds/a.wav': SILENT_WAV,
      }));

      assert.deepEqual(pack.errors, ['info: title was missing']);
      assert.equal(pack.soundCount, 1);
    });
  });

  test('keeps an empty keyLed file as an animation with no events', async () => {
    const pack = await parseWithLeds({ '1 1 1': '' });

    assert.deepEqual(pack.errors, []);
    assert.equal(pack.ledCount, 1);
    assert.deepEqual(pack.ledAnimationTable![0][0][0], [{ ledEvents: [], loop: 1, num: 0 }]);
  });

  describe('keyLed pad coordinates', () => {
    const validLines = 'o 1 1 FF0000\nf 1 1\non 2 2 a 5\noff 2 2';
    const validEvents = [
      { type: 'on', x: 0, y: 0, color: 0xFFFF0000, velocity: 4 },
      { type: 'off', x: 0, y: 0 },
      { type: 'on', x: 1, y: 1, color: LAUNCHPAD_ARGB[5], velocity: 5 },
      { type: 'off', x: 1, y: 1 },
    ];

    test('KL-M05 drops a suffixed x coordinate and keeps the next valid line', async () => {
      const pack = await parseWithLeds({ '1 1 1': `o 1b 1 FF0000\n${validLines}` });

      assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, validEvents);
      assert.deepEqual(pack.errors, ['keyLed: [1 1 1].[o 1b 1 FF0000] format is incorrect']);
    });

    for (const command of ['o', 'on', 'f', 'off']) {
      for (const token of ['1b', '1.5', '1e0', '0x1', 'NaN', 'Infinity', '0', '-1', '3', '9'.repeat(400)]) {
        for (const axis of ['x', 'y']) {
          test(`${command} drops invalid ${axis}=${token.slice(0, 20)} and keeps valid boundary lines`, async () => {
            const coordinate = axis === 'x' ? `${token} 1` : `1 ${token}`;
            const line = `${command} ${coordinate}${command === 'o' || command === 'on' ? ' FF0000' : ''}`;
            const pack = await parseWithLeds({ '1 1 1': `${line}\n${validLines}` });

            assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, validEvents);
          });
        }
      }
    }

    test('preserves signed and zero-padded complete integers', async () => {
      const pack = await parseWithLeds({ '1 1 1': 'o +1 01 FF0000\nf 01 +1\non 02 +2 a 5\noff +2 02' });

      assert.deepEqual(pack.errors, []);
      assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, validEvents);
    });
  });

  describe('chain switching', () => {
    test('files a keyLed animation under the chain in its file name', async () => {
      const pack = await parseWithLeds({ '2 1 1': 'o 1 1 a 5' });

      assert.equal(pack.ledAnimationTable![0][0][0], null);
      assert.equal(pack.ledAnimationTable![1][0][0]!.length, 1);
    });

    test('reads a keyLed chain event as a zero-based chain', async () => {
      const pack = await parseWithLeds({ '1 1 1': 'c 2' });

      assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, [{ type: 'chain', chain: 1 }]);
    });

    test('moves autoPlay presses after a chain line to that chain', async () => {
      const pack = await parseUniPack(await packZip({
        info: INFO_2X2_2CHAIN,
        keySound: KEYSOUND_1_1_1,
        'sounds/a.wav': SILENT_WAV,
        autoPlay: 'o 1 1\nc 2\no 1 1\nc 3',
      }));

      assert.deepEqual(pack.autoPlay!.elements, [
        { type: 'on', x: 0, y: 0, currChain: 0, num: 0 },
        { type: 'chain', c: 1 },
        { type: 'on', x: 0, y: 0, currChain: 1, num: 0 },
      ]);
      assert.deepEqual(pack.errors, ['autoPlay: [c 3] chain is incorrect']);
    });
  });
});
