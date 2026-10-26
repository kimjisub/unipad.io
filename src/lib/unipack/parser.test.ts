import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LAUNCHPAD_ARGB } from './colors';
import { parseUniPack } from './parser';
import { NO_WORMHOLE } from './types';
import { INFO_2X2_2CHAIN, KEYSOUND_1_1_1, SILENT_WAV, packZip, parseWithLeds, rawNameZip } from './testUtils';

describe('parseUniPack', () => {
  test('F-05 opens a complete pack wrapped in a top folder', async () => {
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

  test('F-05 opens a unique pack through nested folders and ignores archive sidecars', async () => {
    const files = {
      info: INFO_2X2_2CHAIN,
      keySound: '1 1 1 a.wav\n2 2 2 a.wav',
      'sounds/a.wav': SILENT_WAV,
      'keyLed/1 1 1': 'o 1 1 a 5\nd 10\nf 1 1',
      autoPlay: 'o 1 1\nd 100\nf 1 1',
    };
    const direct = await parseUniPack(await packZip(files));
    const wrapped = await parseUniPack(await packZip({
      'readme.txt': 'Not part of the pack',
      '__MACOSX/._info': 'Finder metadata',
      '.DS_Store': 'Finder metadata',
      'outer/readme.txt': 'A sibling of the next folder',
      'outer/inner/.hidden': 'Not part of the pack',
      ...Object.fromEntries(Object.entries(files).map(([name, data]) => [`outer/inner/My Pack/${name}`, data])),
    }));
    assert.deepEqual(direct.errors, []);
    assert.equal(direct.info.title, 'Test');
    assert.equal(direct.soundCount, 2);
    assert.equal(direct.ledCount, 1);
    assert.deepEqual(direct.autoPlay!.elements, [
      { type: 'on', x: 0, y: 0, currChain: 0, num: 0 },
      { type: 'delay', delay: 100 },
      { type: 'off', x: 0, y: 0, currChain: 0 },
    ]);
    const prefix = 'outer/inner/My Pack/';
    assert.deepEqual({
      ...wrapped,
      soundTable: wrapped.soundTable.map(chain => chain.map(column => column.map(sounds =>
        sounds?.map(sound => ({ ...sound, file: sound.file.slice(prefix.length) })) ?? null))),
      soundFiles: new Map([...wrapped.soundFiles].map(([name, data]) => [name.slice(prefix.length), data])),
    }, direct);
    assert.deepEqual(new Uint8Array(wrapped.soundFiles.get(`${prefix}sounds/a.wav`)!), SILENT_WAV);
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
        /Invalid UniPack: info: chain was missing; info: chain out of range/,
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

  test('numeric zero columns address round lights while zero rows stay pad coordinates', async () => {
    const pack = await parseWithLeds({ '1 1 1': [
      'on 0 1 ffa726 61', 'o 0 32 a 5', 'off 0 1', 'f 0 32',
      'on 8 0 ffa726 61', 'off 8 0', 'o 0 0 FF0000', 'f 0 0',
    ].join('\n') });
    assert.deepEqual(pack.errors, []);
    assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, [
      { type: 'on', x: -1, y: 0, color: 0xffffa726, velocity: 61 },
      { type: 'on', x: -1, y: 31, color: LAUNCHPAD_ARGB[5], velocity: 5 },
      { type: 'off', x: -1, y: 0 }, { type: 'off', x: -1, y: 31 },
      { type: 'on', x: 7, y: -1, color: 0xffffa726, velocity: 61 },
      { type: 'off', x: 7, y: -1 },
      { type: 'on', x: -1, y: -1, color: 0xffff0000, velocity: 4 },
      { type: 'off', x: -1, y: -1 },
    ]);
  });

  test('keeps an empty keyLed file as an animation with no events', async () => {
    const pack = await parseWithLeds({ '1 1 1': '' });

    assert.deepEqual(pack.errors, []);
    assert.equal(pack.ledCount, 1);
    assert.deepEqual(pack.ledAnimationTable![0][0][0], [{ ledEvents: [], loop: 1, num: 0 }]);
  });

  describe('text files saved as UTF-16 with a byte order mark (Windows Notepad "Unicode")', () => {
    const utf16 = (text: string, order: 'le' | 'be') => {
      const le = Buffer.from(`\uFEFF${text}`, 'utf16le');
      return new Uint8Array(order === 'le' ? le : le.swap16());
    };

    for (const order of ['le', 'be'] as const) {
      test(`reads info, keySound, keyLed and autoPlay in UTF-16 ${order.toUpperCase()}`, async () => {
        const pack = await parseUniPack(await packZip({
          info: utf16(INFO_2X2_2CHAIN, order),
          keySound: utf16('1 1 1 a.wav\r\n2 2 2 a.wav', order),
          'sounds/a.wav': SILENT_WAV,
          'keyLed/1 1 1': utf16('o 1 1 a 5\r\nf 1 1', order),
          autoPlay: utf16('o 1 1\r\nf 1 1', order),
        }));

        assert.deepEqual(pack.errors, []);
        assert.equal(pack.info.title, 'Test');
        assert.equal(pack.soundCount, 2);
        assert.deepEqual(pack.soundTable[0][0][0]!.map((s) => s.file), ['sounds/a.wav']);
        assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, [
          { type: 'on', x: 0, y: 0, color: LAUNCHPAD_ARGB[5], velocity: 5 },
          { type: 'off', x: 0, y: 0 },
        ]);
        assert.deepEqual(pack.autoPlay!.elements, [
          { type: 'on', x: 0, y: 0, currChain: 0, num: 0 },
          { type: 'off', x: 0, y: 0, currChain: 0 },
        ]);
      });
    }
  });

  // Korean Windows Notepad's "ANSI" and Korean Windows archivers write CP949; bytes are spelled out
  // because Node has no CP949 encoder.
  describe('old Korean packs written in CP949', () => {
    const cp949 = (...bytes: number[]) => new Uint8Array(bytes);
    const HANGUL = cp949(0xC7, 0xD1, 0xB1, 0xDB); // 한글
    const SORI_WAV = cp949(0xBC, 0xD2, 0xB8, 0xAE, 0x2E, 0x77, 0x61, 0x76); // 소리.wav
    const join = (...parts: (string | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => Array.from(typeof p === 'string' ? new TextEncoder().encode(p) : p)));

    test('reads info, keySound, keyLed and autoPlay that are not UTF-8 as CP949', async () => {
      const pack = await parseUniPack(await packZip({
        info: join('title=', HANGUL, '\nproducerName=', HANGUL, '\nbuttonX=2\nbuttonY=2\nchain=2'),
        keySound: join('1 1 1 ', SORI_WAV, '\n2 2 2 ', SORI_WAV),
        'sounds/소리.wav': SILENT_WAV,
        'keyLed/1 1 1': join('o 1 1 a 5 ', HANGUL, '\nf 1 1'),
        autoPlay: join('o 1 1\nf 1 1\n', HANGUL),
      }));

      assert.equal(pack.info.title, '한글');
      assert.equal(pack.info.producerName, '한글');
      assert.equal(pack.soundCount, 2);
      assert.deepEqual(pack.soundTable[0][0][0]!.map((s) => s.file), ['sounds/소리.wav']);
      assert.deepEqual(pack.errors, [
        'keyLed: [1 1 1].[o 1 1 a 5 한글] format is incorrect',
        'autoPlay: [한글] format is incorrect',
      ]);
    });

    test('reads a UTF-8 text file as UTF-8 even when it is also valid CP949', async () => {
      const pack = await parseUniPack(await packZip({
        info: INFO_2X2_2CHAIN.replace('title=Test', 'title=한글'),
        keySound: KEYSOUND_1_1_1,
        'sounds/a.wav': SILENT_WAV,
      }));

      assert.equal(pack.info.title, '한글');
    });

    test('F-06 reads a CP949 file name inside the archive that has no UTF-8 mark', async () => {
      const pack = await parseUniPack(rawNameZip([
        [new TextEncoder().encode('info'), INFO_2X2_2CHAIN],
        [new TextEncoder().encode('keySound'), '1 1 1 소리.wav'],
        [join('sounds/', SORI_WAV), SILENT_WAV],
      ]));

      assert.deepEqual(pack.errors, []);
      assert.deepEqual(pack.soundTable[0][0][0]!.map((s) => s.file), ['sounds/소리.wav']);
    });

    test('F-06 reads a file name explicitly marked as UTF-8', async () => {
      const pack = await parseUniPack(rawNameZip([
        [new TextEncoder().encode('info'), INFO_2X2_2CHAIN],
        [new TextEncoder().encode('keySound'), '1 1 1 소리.wav'],
        [new TextEncoder().encode('sounds/소리.wav'), SILENT_WAV],
      ], true));
      assert.deepEqual(pack.errors, []);
      assert.deepEqual(pack.soundTable[0][0][0]!.map((s) => s.file), ['sounds/소리.wav']);
      assert.deepEqual(new Uint8Array(pack.soundFiles.get('sounds/소리.wav')!), SILENT_WAV);
    });

    test('F-06 reads an unmarked file name that is valid UTF-8 as UTF-8', async () => {
      // Keep both the CP949-invalid case and bytes that strictly decode in either encoding.
      const ambiguous = new TextEncoder().encode('차카.wav');
      assert.doesNotThrow(() => new TextDecoder('euc-kr', { fatal: true }).decode(ambiguous));
      assert.notEqual(new TextDecoder('euc-kr', { fatal: true }).decode(ambiguous), '차카.wav');
      for (const name of ['소리.wav', '차카.wav']) {
        const pack = await parseUniPack(rawNameZip([
          [new TextEncoder().encode('info'), INFO_2X2_2CHAIN],
          [new TextEncoder().encode('keySound'), `1 1 1 ${name}`],
          [new TextEncoder().encode(`sounds/${name}`), SILENT_WAV],
        ]));

        assert.deepEqual(pack.errors, [], name);
        assert.deepEqual(pack.soundTable[0][0][0]!.map((s) => s.file), [`sounds/${name}`]);
        assert.deepEqual(new Uint8Array(pack.soundFiles.get(`sounds/${name}`)!), SILENT_WAV);
      }
    });
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

    const ledLine = (command: string, axis: string, token: string) =>
      `${command} ${axis === 'x' ? `${token} 1` : `1 ${token}`}${command === 'o' || command === 'on' ? ' FF0000' : ''}`;

    for (const command of ['o', 'on', 'f', 'off']) {
      for (const token of ['1b', '1.5', '1e0', '0x1', 'NaN', 'Infinity', '9'.repeat(400)]) {
        for (const axis of ['x', 'y']) {
          test(`${command} drops malformed ${axis}=${token.slice(0, 20)} with a format error and keeps valid boundary lines`, async () => {
            const line = ledLine(command, axis, token);
            const pack = await parseWithLeds({ '1 1 1': `${line}\n${validLines}` });

            assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, validEvents);
            assert.deepEqual(pack.errors, [`keyLed: [1 1 1].[${line}] format is incorrect`]);
          });
        }
      }

      // KL-024: Android and iOS keep these and skip them when lit (see LedRunner.test.ts).
      for (const [axis, token, x, y] of [['x', '-1', -2, 0], ['x', '3', 2, 0], ['y', '0', 0, -1], ['y', '-1', 0, -2], ['y', '3', 0, 2]] as const) {
        test(`${command} keeps ${axis}=${token} outside the grid as written, without a warning`, async () => {
          const pack = await parseWithLeds({ '1 1 1': `${ledLine(command, axis, token)}\n${validLines}` });

          const kept = command === 'o' || command === 'on'
            ? { type: 'on', x, y, color: 0xFFFF0000, velocity: 4 }
            : { type: 'off', x, y };
          assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, [kept, ...validEvents]);
          assert.deepEqual(pack.errors, []);
        });
      }

      test(`${command} keeps x=0 as a round light address without a warning`, async () => {
        const line = ledLine(command, 'x', '0');
        const pack = await parseWithLeds({ '1 1 1': `${line}\n${validLines}` });
        const kept = command === 'o' || command === 'on'
          ? { type: 'on', x: -1, y: 0, color: 0xFFFF0000, velocity: 4 }
          : { type: 'off', x: -1, y: 0 };
        assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, [kept, ...validEvents]);
        assert.deepEqual(pack.errors, []);
      });
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

    // Clamp an out-of-range move to the nearest chain and record a warning.
    for (const [value, chain] of [['3', 1], ['40', 1], ['-2', 0]] as const) {
      test(`moves a keySound wormhole of ${value} to the nearest chain the pack has, with a warning`, async () => {
        const line = `1 1 1 a.wav 1 ${value}`;
        const pack = await parseUniPack(await packZip({
          info: INFO_2X2_2CHAIN, keySound: line, 'sounds/a.wav': SILENT_WAV,
        }));

        assert.equal(pack.soundTable[0][0][0]![0].wormhole, chain);
        assert.deepEqual(pack.errors, [`keySound: [${line}] wormhole is incorrect`]);
      });
    }

    for (const [line, field] of [
      ['5 1 1 a.wav 1 40', 'chain'],
      ['1 5 1 a.wav 1 40', 'x'],
      ['1 1 5 a.wav 1 40', 'y'],
    ]) {
      test(`warns about the wormhole before the invalid ${field}`, async () => {
        const pack = await parseUniPack(await packZip({
          info: INFO_2X2_2CHAIN, keySound: line, 'sounds/a.wav': SILENT_WAV,
        }));

        assert.deepEqual(pack.errors, [
          `keySound: [${line}] wormhole is incorrect`,
          `keySound: [${line}] ${field} is incorrect`,
        ]);
      });
    }

    test('keeps a keySound wormhole of 0 as no chain move, without a warning', async () => {
      const pack = await parseUniPack(await packZip({
        info: INFO_2X2_2CHAIN, keySound: '1 1 1 a.wav 1 0', 'sounds/a.wav': SILENT_WAV,
      }));

      assert.equal(pack.soundTable[0][0][0]![0].wormhole, NO_WORMHOLE);
      assert.deepEqual(pack.errors, []);
    });

    // touch is on + off in one line, so its sound's wormhole moves the following lines as on does.
    for (const command of ['o', 'on', 't', 'touch']) {
      test(`moves autoPlay presses after \`${command}\` of a wormhole sound to that chain`, async () => {
        const pack = await parseUniPack(await packZip({
          info: INFO_2X2_2CHAIN,
          keySound: '1 1 1 a.wav 1 2\n2 1 1 a.wav',
          'sounds/a.wav': SILENT_WAV,
          autoPlay: `${command} 1 1\nd 100\no 1 1`,
        }));

        const touch = command.startsWith('t');
        assert.deepEqual(pack.errors, []);
        assert.deepEqual(pack.autoPlay!.elements, [
          { type: 'on', x: 0, y: 0, currChain: 0, num: 0 },
          ...(touch ? [{ type: 'off', x: 0, y: 0, currChain: 0 }] : []),
          { type: 'chain', c: 1 },
          { type: 'delay', delay: 100 },
          { type: 'on', x: 0, y: 0, currChain: 1, num: 0 },
        ]);
      });
    }
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

  // Android reads every number field with a 32-bit toInt: a value beyond it is not a number, so the line
  // or file is skipped with a format error; a 32-bit value outside the pack stays a range error.
  describe('a number beyond 32 bits', () => {
    const beyond = ['2147483648', '-2147483649', '99999999999', '9007199254740993', '9223372036854775808', '9'.repeat(400)];
    const short = (token: string) => token.slice(0, 20);

    for (const token of beyond) {
      for (const field of [0, 1, 2, 4, 5]) {
        test(`keySound field ${field} = ${short(token)} is a format error and the next sound is kept`, async () => {
          const parts = ['1', '1', '1', 'a.wav', '1', '1'];
          parts[field] = token;
          const line = parts.join(' ');
          const pack = await parseUniPack(await packZip({
            info: INFO_2X2_2CHAIN, keySound: `${line}\n${KEYSOUND_1_1_1}`, 'sounds/a.wav': SILENT_WAV,
          }));

          assert.deepEqual(pack.errors, [`keySound: [${line}] format is incorrect`]);
          assert.equal(pack.soundCount, 1);
        });
      }

      for (const field of [0, 1, 2, 3]) {
        test(`keyLed file name field ${field} = ${short(token)} is a format error and the next file is kept`, async () => {
          const parts = ['1', '1', '1', '1'];
          parts[field] = token;
          const name = parts.join(' ');
          const pack = await parseWithLeds({ [name]: 'f 1 1', '1 1 1': 'f 1 1' });

          assert.deepEqual(pack.errors, [`keyLed: [${name}] format is incorrect`]);
          assert.equal(pack.ledCount, 1);
        });
      }

      for (const line of [`o ${token} 1 a 5`, `o 1 ${token} a 5`, `o 1 1 a ${token}`, `f ${token} 1`, `f 1 ${token}`,
        `o mc ${token} a 5`, `f mc ${token}`, `d ${token}`, `c ${token}`]) {
        test(`keyLed line [${short(line)}] is a format error and the next line is kept`, async () => {
          const pack = await parseWithLeds({ '1 1 1': `${line}\nf 1 1` });

          assert.deepEqual(pack.errors, [`keyLed: [1 1 1].[${line}] format is incorrect`]);
          assert.deepEqual(pack.ledAnimationTable![0][0][0]![0].ledEvents, [{ type: 'off', x: 0, y: 0 }]);
        });
      }

      for (const line of [`o ${token} 1`, `f 1 ${token}`, `t ${token} 1`, `c ${token}`, `d ${token}`]) {
        test(`autoPlay line [${short(line)}] is a format error and the next line is kept`, async () => {
          const pack = await parseUniPack(await packZip({
            info: INFO_2X2_2CHAIN, keySound: KEYSOUND_1_1_1, 'sounds/a.wav': SILENT_WAV, autoPlay: `${line}\non 1 1`,
          }));

          assert.deepEqual(pack.errors, [`autoPlay: [${line}] format is incorrect`]);
          assert.deepEqual(pack.autoPlay!.elements, [{ type: 'on', x: 0, y: 0, currChain: 0, num: 0 }]);
        });
      }
    }

    for (const token of ['2147483647', '-2147483648']) {
      test(`${token} is read as a number: outside the pack it is a range error`, async () => {
        const pack = await parseUniPack(await packZip({
          info: INFO_2X2_2CHAIN,
          keySound: `${token} 1 1 a.wav\n1 ${token} 1 a.wav\n${KEYSOUND_1_1_1}`,
          'sounds/a.wav': SILENT_WAV,
          [`keyLed/1 1 ${token}`]: 'f 1 1',
          autoPlay: `o ${token} 1\nc ${token}`,
        }));

        assert.deepEqual(pack.errors, [
          `keySound: [${token} 1 1 a.wav] chain is incorrect`,
          `keySound: [1 ${token} 1 a.wav] x is incorrect`,
          `keyLed: [1 1 ${token}] y is incorrect`,
          `autoPlay: [o ${token} 1] coordinate is incorrect`,
          `autoPlay: [c ${token}] chain is incorrect`,
        ]);
      });
    }

    test('the largest 32-bit delay and loop are kept, and a round LED index past 32 is dropped without a warning', async () => {
      const pack = await parseWithLeds({ '1 1 1 2147483647': 'd 2147483647\nd 2147483647\no mc 2147483647 a 5\nf 1 1' });

      assert.deepEqual(pack.errors, []);
      const animation = pack.ledAnimationTable![0][0][0]![0];
      assert.equal(animation.loop, 2147483647);
      assert.deepEqual(animation.ledEvents, [
        { type: 'delay', delay: 2147483647 },
        { type: 'delay', delay: 2147483647 },
        { type: 'off', x: 0, y: 0 },
      ]);
    });
  });

});
