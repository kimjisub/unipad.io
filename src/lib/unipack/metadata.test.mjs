import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import * as parser from './parser.ts';
import { packZip, INFO_2X2_2CHAIN, SILENT_WAV } from './testUtils.ts';
import { corruptSoundArchive } from './corruptArchive.testUtils.mjs';

const summary = pack => ({
  info: pack.info, soundCount: pack.soundCount, ledCount: pack.ledCount,
  keyLedExist: pack.keyLedExist, autoPlayExist: pack.autoPlayExist,
});

test('library metadata preserves parsed counts without accumulating sound bytes or changing the archive', async () => {
  const bytes = await packZip({
    'wrapped/info': INFO_2X2_2CHAIN,
    'wrapped/keySound': '1 1 1 tone.wav\n1 1 1 tone.wav\n2 2 2 TONE.WAV\n1 1 2 missing.wav\n9 1 1 tone.wav',
    'wrapped/sounds/tone.wav': SILENT_WAV,
    'wrapped/keyLed/1 1 1': 'o 1 1 a 5\nf 1 1',
    'wrapped/keyLed/9 1 1': 'o 1 1 a 5',
    'wrapped/autoPlay': 'o 1 1\nd 100\nf 1 1',
  });
  const original = Buffer.from(bytes).toString('hex');
  const expected = summary(await parser.parseUniPack(bytes));
  assert.deepEqual([expected.soundCount, expected.ledCount, expected.keyLedExist, expected.autoPlayExist], [3, 1, true, true]);
  const load = JSZip.loadAsync;
  const extracted = [];
  const streamed = [];
  JSZip.loadAsync = async function (...args) {
    const zip = await Reflect.apply(load, this, args);
    for (const file of Object.values(zip.files)) {
      const read = file.async;
      file.async = function (...options) {
        if (file.name.includes('/sounds/')) extracted.push(file.name);
        return Reflect.apply(read, this, options);
      };
      const stream = file.internalStream;
      file.internalStream = function (...options) {
        const result = Reflect.apply(stream, this, options);
        if (file.name.includes('/sounds/')) {
          streamed.push(file.name);
          const accumulate = result.accumulate;
          result.accumulate = function (...args) {
            extracted.push(file.name);
            return Reflect.apply(accumulate, this, args);
          };
        }
        return result;
      };
    }
    return zip;
  };
  try {
    const metadata = await parser.readUniPackMetadata(bytes);
    assert.deepEqual(summary(metadata), expected);
    assert.deepEqual(extracted, [], 'saving list metadata must not accumulate audio');
    assert.deepEqual(streamed, ['wrapped/sounds/tone.wav'], 'each referenced sound is validated once');
    assert.equal(Buffer.from(bytes).toString('hex'), original);
  } finally { JSZip.loadAsync = load; }
});

test('metadata keeps missing and empty optional sections distinct', async () => {
  for (const optional of [{}, { 'keyLed/': null, autoPlay: '' }]) {
    const bytes = await packZip({ info: INFO_2X2_2CHAIN, keySound: '', ...optional });
    const expected = summary(await parser.parseUniPack(bytes));
    assert.deepEqual(summary(await parser.readUniPackMetadata(bytes)), expected);
  }
});

test('metadata rejects a damaged compressed sound just as the player parser does', async () => {
  const bytes = await corruptSoundArchive();
  await assert.rejects(parser.parseUniPack(bytes), /uncompressed data size mismatch/);
  await assert.rejects(parser.readUniPackMetadata(bytes), /uncompressed data size mismatch/);
});

test('metadata and player ignore damaged sounds that no valid mapping uses', async () => {
  for (const mapping of ['', '9 1 1 a.wav', '1 1 1 missing.wav']) {
    const bytes = await corruptSoundArchive(mapping);
    assert.deepEqual(summary(await parser.readUniPackMetadata(bytes)), summary(await parser.parseUniPack(bytes)));
  }
});

test('metadata accepts empty sounds and sounds spanning many compressed chunks', async () => {
  const zip = new JSZip();
  zip.file('info', INFO_2X2_2CHAIN);
  zip.file('keySound', '1 1 1 empty.wav\n1 1 2 large.wav\n2 2 2 large.wav');
  zip.file('sounds/empty.wav', new Uint8Array());
  zip.file('sounds/large.wav', new Uint8Array(1024 * 1024));
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  assert.deepEqual(summary(await parser.readUniPackMetadata(bytes)), summary(await parser.parseUniPack(bytes)));
});
