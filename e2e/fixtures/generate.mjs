import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

// Original, deterministic 100 ms, 440 Hz mono PCM tone; no downloaded assets.
const rate = 44100;
const samples = rate / 10;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 4000), 44 + i * 2);
}
const date = new Date('2020-01-01T00:00:00Z');
async function writePack(name, files) {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(files)) zip.file(path, data, { date });
  writeFileSync(new URL(name, import.meta.url), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
await writePack('basic.uni', {
  info: 'title=Browser Test Pack\nproducerName=UniPad Tests\nbuttonX=8\nbuttonY=8\nchain=1\nsquareButton=true\n',
  keySound: '1 1 1 tone.wav 0\n1 2 1 tone.wav 0\n',
  'keyLED/1 1 1 1': 'o 1 2 a 5\nd 1200\nf 1 2\n',
  'keyLED/1 2 1 1': 'o 2 2 a 21\nd 1200\nf 2 2\n',
  autoPlay: 'd 1000\no 1 1\nd 200\nf 1 1\nd 3000\no 2 1\nd 200\nf 2 1\nd 3000\no 1 1\nd 200\nf 1 1\n',
  'sounds/tone.wav': wav,
});
// Every pad loops until released and there is no keyLED, so the press light is on: each
// held finger shows as a lit pad and a started-but-not-stopped sound.
const everyPad = Array.from({ length: 64 }, (_, i) => `1 ${Math.floor(i / 8) + 1} ${i % 8 + 1} tone.wav 0\n`).join('');
await writePack('multi-touch.uni', {
  info: 'title=Multi Touch Test Pack\nproducerName=UniPad Tests\nbuttonX=8\nbuttonY=8\nchain=1\nsquareButton=true\n',
  keySound: everyPad,
  'sounds/tone.wav': wav,
});
