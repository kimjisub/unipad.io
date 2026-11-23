import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inspectAudio } from './audioInspection.ts';
import { audioCost } from './audioSafety.ts';
import { parseUniPack } from './parser.ts';
import { SoundEngine } from './SoundEngine.ts';
import { packZip } from './testUtils.ts';
import { shiftVorbisGranules, updateOggChecksum } from '../../../e2e/fixtures/vorbis-granules.ts';

const tone = readFileSync('e2e/fixtures/vorbis-short-tail.ogg');

function withTrim(trim) {
  const bytes = Buffer.from(tone);
  let at = 0;
  while (at < bytes.length) {
    const segments = bytes[at + 26];
    const size = 27 + segments + bytes.subarray(at + 27, at + 27 + segments).reduce((a, b) => a + b, 0);
    if (bytes[at + 5] & 4) {
      bytes.writeBigUInt64LE(BigInt(17920 - trim), at + 6);
      updateOggChecksum(bytes.subarray(at, at + size));
    }
    at += size;
  }
  return bytes;
}

// Put the same audio packets on one final page, where leading and trailing trims are ambiguous.
function singleAudioPage(source) {
  const pages = [];
  for (let at = 0; at < source.length;) {
    const segments = source[at + 26];
    const size = 27 + segments + source.subarray(at + 27, at + 27 + segments).reduce((a, b) => a + b, 0);
    pages.push(source.subarray(at, at + size));
    at += size;
  }
  const audio = pages.slice(2);
  const lacing = Buffer.concat(audio.map(p => p.subarray(27, 27 + p[26])));
  assert.ok(lacing.length <= 255);
  const header = Buffer.from(audio[0].subarray(0, 27));
  header[5] = 4;
  header[26] = lacing.length;
  header.writeBigUInt64LE(audio.at(-1).readBigUInt64LE(6), 6);
  const page = Buffer.concat([header, lacing, ...audio.map(p => p.subarray(27 + p[26]))]);
  updateOggChecksum(page);
  return Buffer.concat([...pages.slice(0, 2), page]);
}

test('A positive Vorbis timeline origin does not imply a leading discard', () => {
  const result = inspectAudio(shiftVorbisGranules(tone, -500));
  assert.equal(result.exclusion, null);
  assert.equal(result.facts.frames, 17640n);
  assert.equal(result.facts.vorbisEndTrimSafe, true);
});

for (const trim of [0, 256, 257, 280, 2048]) {
  test(`Vorbis ending in two short blocks admits ${trim} frames of end trim`, () => {
    const result = inspectAudio(withTrim(trim));
    assert.deepEqual(result, { exclusion: null, facts: {
      sampleRate: 44100, channels: 1, frames: BigInt(17920 - trim), format: 'ogg', vorbisEndTrimSafe: true,
    } });
    assert.equal(audioCost(result.facts).cost, BigInt(Math.ceil((17920 - trim) * 48000 / 44100)) * 2n);
  });
}
for (const trim of [-1, 2049, 6000]) {
  test(`Vorbis rejects end trim outside the long-block bound: ${trim}`, () => {
    assert.deepEqual(inspectAudio(withTrim(trim)), { exclusion: 'INVALID_FORMAT' });
  });
}

test('Vorbis still rejects a damaged page checksum', () => {
  const bytes = Buffer.from(tone);
  bytes[bytes.length - 1] ^= 1;
  assert.deepEqual(inspectAudio(bytes), { exclusion: 'INVALID_FORMAT' });
});

for (const [format, rate, decodedFrames, expectedFrames, leading = 0, allocationFails = false, singlePage = false] of [
  ['ogg', 44100, 17920, 17640],
  ['ogg', 48000, 19505, 19200],
  ['ogg', 44100, 17640, 17640],
  ['ogg', 44100, 17500, 17500],
  ['ogg', 44100, 17792, 17792, 500],
  ['ogg', 48000, 19365, 19365, 500],
  ['ogg', 44100, 17140, 17140, 500],
  ['ogg', 44100, 17920, 17920, 0, true],
  ['ogg', 44100, 17792, 17792, 0, false, true],
  ['ogg', 44100, 17792, 17792, 500, false, true],
  ['opus', 44100, 17920, 17920],
  ['wav', 44100, 17920, 17920],
]) {
  test(`${format} at ${rate} Hz: ${decodedFrames} frames play as ${expectedFrames}, leading ${leading}, allocation failure ${allocationFails}, single page ${singlePage}`, async t => {
    const originalContext = globalThis.AudioContext;
    t.after(() => { globalThis.AudioContext = originalContext; });
    const channels = [Float32Array.from({ length: decodedFrames }, (_, i) => i / decodedFrames),
      Float32Array.from({ length: decodedFrames }, (_, i) => -i / decodedFrames)];
    const decoded = { length: decodedFrames, sampleRate: rate, numberOfChannels: 2,
      duration: decodedFrames / rate, getChannelData: c => channels[c] };
    let allocated = 0;
    globalThis.AudioContext = class {
      state = 'running';
      destination = {};
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      async decodeAudioData() { return decoded; }
      createBuffer(count, length, sampleRate) {
        allocated++;
        if (allocationFails) throw new RangeError('Array buffer allocation failed');
        const samples = Array.from({ length: count }, () => new Float32Array(length));
        return { length, sampleRate, numberOfChannels: count, duration: length / sampleRate,
          getChannelData: c => samples[c], copyToChannel: (data, c) => samples[c].set(data) };
      }
      close() {}
    };
    const shifted = shiftVorbisGranules(tone, leading);
    const encoded = singlePage ? singleAudioPage(shifted) : shifted;
    const inspected = inspectAudio(encoded);
    assert.equal(inspected.exclusion, null);
    assert.equal(inspected.facts.frames, 17640n - BigInt(leading));
    assert.equal(inspected.facts.vorbisEndTrimSafe, leading === 0 && !singlePage);
    const pack = await parseUniPack(await packZip({
      info: 'title=Tone\nproducerName=Test\nbuttonX=1\nbuttonY=1\nchain=1',
      keySound: '1 1 1 tone.ogg', 'sounds/tone.ogg': encoded,
    }));
    const engine = new SoundEngine(pack, () => 0, () => {});
    t.after(() => engine.destroy());
    const report = await engine.load({ inspect: () => ({ exclusion: null,
      facts: { ...inspected.facts, format, channels: 2 } }) });
    assert.equal(report.loadedFiles, 1);
    assert.deepEqual(report.failures, []);
    const buffer = pack.soundTable[0][0][0][0].audioBuffer;
    assert.equal(buffer.length, expectedFrames);
    assert.equal(buffer.sampleRate, rate);
    assert.equal(buffer.numberOfChannels, 2);
    assert.equal(allocated, expectedFrames < decodedFrames || allocationFails ? 1 : 0);
    for (let c = 0; c < 2; c++) assert.deepEqual(buffer.getChannelData(c), channels[c].subarray(0, expectedFrames));
  });
}
