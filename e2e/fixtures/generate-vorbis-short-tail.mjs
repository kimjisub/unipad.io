import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Supply a scratch directory; encoded source and PCM stay outside the repository.
const scratch = process.argv[2];
if (!scratch) throw new Error('Usage: node e2e/fixtures/generate-vorbis-short-tail.mjs <scratch-directory>');
mkdirSync(scratch, { recursive: true });
const wav = resolve(scratch, 'source.wav');
const ogg = resolve(scratch, 'source.ogg');
execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
  'sine=frequency=440:sample_rate=44100:duration=0.4', '-c:a', 'pcm_s16le', '-y', wav]);
execFileSync('oggenc', ['-Q', '-q', '4', '-o', ogg, wav]);
const source = readFileSync(ogg);
const packets = [];
let packet = Buffer.alloc(0);
for (let at = 0; at < source.length;) {
  const segments = source[at + 26];
  let payload = at + 27 + segments;
  for (const size of source.subarray(at + 27, at + 27 + segments)) {
    packet = Buffer.concat([packet, source.subarray(payload, payload + size)]);
    payload += size;
    if (size < 255) { packets.push(packet); packet = Buffer.alloc(0); }
  }
  at = payload;
}
// libvorbis emits two modes: short (0), long (1). Repeat the first short packet so the
// tail is deterministic, without depending on the encoder's transient detection.
if (packets[0][28] !== 0xb8 || (packets[3][0] & 3) !== 0)
  throw new Error('Expected 256/2048 blocks and a short first audio packet');
function page(contents, sequence, flags, granule) {
  const lacing = contents.flatMap(p => [...Array(Math.floor(p.length / 255)).fill(255), p.length % 255]);
  const header = Buffer.alloc(27);
  header.write('OggS');
  header[5] = flags;
  header.writeBigUInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(1, 14);
  header.writeUInt32LE(sequence, 18);
  header[26] = lacing.length;
  const bytes = Buffer.concat([header, Buffer.from(lacing), ...contents]);
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
  }
  bytes.writeUInt32LE(crc >>> 0, 22);
  return bytes;
}
writeFileSync('e2e/fixtures/vorbis-short-tail.ogg', Buffer.concat([
  page(packets.slice(0, 1), 0, 2, 0), page(packets.slice(1, 3), 1, 0, 0),
  page(Array(101).fill(packets[3]), 2, 0, 12800),
  page(Array(40).fill(packets[3]), 3, 4, 17640),
]));
