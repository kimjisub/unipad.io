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

  // Android and iOS call a value that is not a whole number a format error and a number outside the
  // pack a range error; the warning a user sees says which.
  describe('a keyLed file name with a malformed or out-of-range number', () => {
    for (const name of ['a 1 1', '1 b 1', '1 1 c', '1 1 1 d', '1 1 1 1.5', `1 ${'9'.repeat(400)} 1`]) {
      test(`[${name.slice(0, 20)}] is a format error`, async () => {
        const pack = await parseWithLeds({ [name]: 'f 1 1' });

        assert.deepEqual(pack.errors, [`keyLed: [${name}] format is incorrect`]);
        assert.equal(pack.ledCount, 0);
      });
    }

    for (const [name, field] of [['3 1 1', 'chain'], ['1 3 1', 'x'], ['1 1 0', 'y'], ['1 1 1 -1', 'loop']]) {
      test(`[${name}] is still a ${field} range error`, async () => {
        const pack = await parseWithLeds({ [name]: 'f 1 1' });

        assert.deepEqual(pack.errors, [`keyLed: [${name}] ${field} is incorrect`]);
      });
    }
  });

  describe('an autoPlay line with a malformed or out-of-range number', () => {
    const parseAutoPlay = async (autoPlay: string) => parseUniPack(await packZip({
      info: INFO_2X2_2CHAIN, keySound: KEYSOUND_1_1_1, 'sounds/a.wav': SILENT_WAV, autoPlay,
    }));

    for (const line of ['on a 1', 'on 1', 'off x y', 'touch 1', 'on 1 1b', 'on 0 bad', `o ${'9'.repeat(400)} 1`, `f 1 ${'9'.repeat(400)}`, `t ${'9'.repeat(400)} 1`, `c ${'9'.repeat(400)}`, `d ${'9'.repeat(400)}`, 'chain z', 'chain', 'delay x', 'delay', 'delay 1.5']) {
      test(`[${line.slice(0, 20)}] is a format error and the next line is kept`, async () => {
        const pack = await parseAutoPlay(`${line}\non 1 1`);

        assert.deepEqual(pack.errors, [`autoPlay: [${line}] format is incorrect`]);
        assert.deepEqual(pack.autoPlay!.elements, [{ type: 'on', x: 0, y: 0, currChain: 0, num: 0 }]);
      });
    }

    for (const [line, field] of [['on 3 1', 'coordinate'], ['off 1 0', 'coordinate'], ['chain 0', 'chain']]) {
      test(`[${line}] is still a ${field} range error`, async () => {
        const pack = await parseAutoPlay(line);

        assert.deepEqual(pack.errors, [`autoPlay: [${line}] ${field} is incorrect`]);
      });
    }
  });
  describe('keySound integer validation', () => {
    for (const token of ['9'.repeat(400), `-${'9'.repeat(400)}`]) {
      for (const field of [0, 1, 2, 4, 5]) {
        test(`non-finite field ${field} (${token[0] === '-' ? 'negative' : 'positive'}) is a format error and the next sound is kept`, async () => {
          const parts = ['1', '1', '1', 'a.wav', '1', '1'];
          parts[field] = token;
          const line = parts.join(' ');
          const pack = await parseUniPack(await packZip({
            info: INFO_2X2_2CHAIN, keySound: `${line}\n${KEYSOUND_1_1_1}`, 'sounds/a.wav': SILENT_WAV,
          }));

          assert.deepEqual(pack.errors, [`keySound: [${line}] format is incorrect`]);
          assert.equal(pack.soundCount, 1);
          assert.equal(pack.soundTable[0][0][0]![0].file, 'sounds/a.wav');
        });
      }
    }
    for (const [line, field] of [['3 1 1 a.wav', 'chain'], ['1 3 1 a.wav', 'x'], ['1 1 0 a.wav', 'y']]) {
      test(`${field} outside the pack remains a range error`, async () => {
        const pack = await parseUniPack(await packZip({
          info: INFO_2X2_2CHAIN, keySound: line, 'sounds/a.wav': SILENT_WAV,
        }));

        assert.deepEqual(pack.errors, [`keySound: [${line}] ${field} is incorrect`]);
        assert.equal(pack.soundCount, 0);
      });
    }
  });

});
