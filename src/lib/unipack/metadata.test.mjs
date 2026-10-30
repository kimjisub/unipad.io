import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import * as parser from './parser.ts';
import { packZip, INFO_2X2_2CHAIN, SILENT_WAV } from './testUtils.ts';

const summary = pack => ({
  info: pack.info, soundCount: pack.soundCount, ledCount: pack.ledCount,
  keyLedExist: pack.keyLedExist, autoPlayExist: pack.autoPlayExist,
});

test('library metadata preserves parsed counts without extracting any sound bytes or changing the archive', async () => {
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
  JSZip.loadAsync = async function (...args) {
    const zip = await Reflect.apply(load, this, args);
    for (const file of Object.values(zip.files)) {
      const read = file.async;
      file.async = function (...options) {
        if (file.name.includes('/sounds/')) extracted.push(file.name);
        return Reflect.apply(read, this, options);
      };
    }
    return zip;
  };
  try {
    const metadata = await (parser.readUniPackMetadata ?? parser.parseUniPack)(bytes);
    assert.deepEqual(summary(metadata), expected);
    assert.deepEqual(extracted, [], 'saving list metadata must not decompress audio');
    assert.equal(Buffer.from(bytes).toString('hex'), original);
  } finally { JSZip.loadAsync = load; }
});

test('metadata keeps missing and empty optional sections distinct', async () => {
  for (const optional of [{}, { 'keyLed/': null, autoPlay: '' }]) {
    const bytes = await packZip({ info: INFO_2X2_2CHAIN, keySound: '', ...optional });
    const expected = summary(await parser.parseUniPack(bytes));
    assert.deepEqual(summary(await (parser.readUniPackMetadata ?? parser.parseUniPack)(bytes)), expected);
  }
});
