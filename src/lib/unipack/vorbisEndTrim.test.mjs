import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inspectAudio } from './audioInspection.ts';
import { audioCost } from './audioSafety.ts';
import { parseUniPack } from './parser.ts';
import { SoundEngine } from './SoundEngine.ts';
import { packZip } from './testUtils.ts';

const tone = readFileSync('e2e/fixtures/vorbis-short-tail.ogg');

function withTrim(trim) {
  const bytes = Buffer.from(tone);
  let at = 0;
  while (at < bytes.length) {
    const segments = bytes[at + 26];
    const size = 27 + segments + bytes.subarray(at + 27, at + 27 + segments).reduce((a, b) => a + b, 0);
    if (bytes[at + 5] & 4) {
      bytes.writeBigUInt64LE(BigInt(17920 - trim), at + 6);
      bytes.fill(0, at + 22, at + 26);
      let crc = 0;
      for (const byte of bytes.subarray(at, at + size)) {
        crc ^= byte << 24;
        for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
      }
      bytes.writeUInt32LE(crc >>> 0, at + 22);
    }
    at += size;
  }
  return bytes;
}

for (const trim of [0, 256, 257, 280, 2048]) {
  test(`Vorbis ending in two short blocks admits ${trim} frames of end trim`, () => {
    const result = inspectAudio(withTrim(trim));
    assert.deepEqual(result, { exclusion: null, facts: {
      sampleRate: 44100, channels: 1, frames: BigInt(17920 - trim), format: 'ogg',
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

for (const [format, rate, decodedFrames, expectedFrames] of [
  ['ogg', 44100, 17920, 17640],
  ['ogg', 48000, 19505, 19200],
  ['ogg', 44100, 17640, 17640],
  ['ogg', 44100, 17500, 17500],
  ['opus', 44100, 17920, 17920],
  ['wav', 44100, 17920, 17920],
]) {
  test(`${format} decoded at ${rate} Hz: ${decodedFrames} frames play as ${expectedFrames}`, async t => {
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
        const samples = Array.from({ length: count }, () => new Float32Array(length));
        return { length, sampleRate, numberOfChannels: count, duration: length / sampleRate,
          getChannelData: c => samples[c], copyToChannel: (data, c) => samples[c].set(data) };
      }
      close() {}
    };
    const pack = await parseUniPack(await packZip({
      info: 'title=Tone\nproducerName=Test\nbuttonX=1\nbuttonY=1\nchain=1',
      keySound: '1 1 1 tone.ogg', 'sounds/tone.ogg': tone,
    }));
    const engine = new SoundEngine(pack, () => 0, () => {});
    t.after(() => engine.destroy());
    const report = await engine.load({ inspect: () => ({ exclusion: null,
      facts: { format, sampleRate: 44100, channels: 2, frames: 17640n } }) });
    assert.equal(report.loadedFiles, 1);
    assert.deepEqual(report.failures, []);
    const buffer = pack.soundTable[0][0][0][0].audioBuffer;
    assert.equal(buffer.length, expectedFrames);
    assert.equal(buffer.sampleRate, rate);
    assert.equal(buffer.numberOfChannels, 2);
    assert.equal(allocated, expectedFrames < decodedFrames ? 1 : 0);
    for (let c = 0; c < 2; c++) assert.deepEqual(buffer.getChannelData(c), channels[c].subarray(0, expectedFrames));
  });
}
