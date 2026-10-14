// Shared pieces of the conformance corpus: generated sound assets, the input fingerprint, and the
// builders that write expected results in the normalized form every platform harness emits.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const SCHEMA = 'unipad-conformance/1';

// ---------------------------------------------------------------------------------------------
// Sound assets. Only synthesized signals: a 10 ms sine at two pitches and 10 ms of silence,
// 8 kHz mono unsigned 8-bit PCM, and the 440 Hz sine encoded as MP3. Nothing is taken from a pack, a
// song or the internet.
// ---------------------------------------------------------------------------------------------

const SAMPLE_RATE = 8000;
const DURATION_MS = 10;

function wav(samples) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE, 28); // byte rate: 1 byte per sample
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(8, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, Buffer.from(samples)]);
}

function sine(hz) {
  const count = (SAMPLE_RATE * DURATION_MS) / 1000;
  return wav(Uint8Array.from({ length: count }, (_, i) => 128 + Math.round(100 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE))));
}

function silence() {
  return wav(new Uint8Array((SAMPLE_RATE * DURATION_MS) / 1000).fill(128));
}

// The MP3 is kept as encoded bytes (assets/tone-440.mp3) rather than encoded at build time, so a machine
// without the encoder builds the same corpus. To make it again from the tone-440 bytes above:
//   lame --silent --resample 44.1 -b 64 --cbr --noreplaygain tone-440.wav tone-440.mp3   (LAME 3.100)
const MP3_SOURCE_SHA256 = 'c92bf9a21f15a6d98067e19814d8c12724b8eeae3b5fda492b82391e32b11f0d';
const MP3_SHA256 = '3feed8a87e71a319e76ffb515dff4aed66185fc93028634a89e717b80c5fd013';

/** An MPEG audio frame header starts with 11 set sync bits; a renamed WAV or a text file does not. */
export function startsWithMpegFrame(bytes) {
  return bytes.length >= 4 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function storedMp3() {
  if (sha256(sine(440)) !== MP3_SOURCE_SHA256) throw new Error('tone-440 changed; encode assets/tone-440.mp3 again from it (see lib.mjs)');
  const bytes = readFileSync(new URL('./assets/tone-440.mp3', import.meta.url));
  if (sha256(bytes) !== MP3_SHA256) throw new Error(`assets/tone-440.mp3 hashes to ${sha256(bytes)}, lib.mjs records ${MP3_SHA256}`);
  if (!startsWithMpegFrame(bytes)) throw new Error('assets/tone-440.mp3 does not start with an MPEG audio frame');
  return bytes;
}

export const ASSET_GENERATORS = {
  'tone-440': { describe: '10 ms sine, 440 Hz, 8 kHz mono u8 PCM WAV', make: () => sine(440) },
  'tone-660': { describe: '10 ms sine, 660 Hz, 8 kHz mono u8 PCM WAV', make: () => sine(660) },
  'silence-10ms': { describe: '10 ms of silence (u8 value 128), 8 kHz mono u8 PCM WAV', make: silence },
  'tone-440-mp3': {
    describe: `tone-440 (sha256 ${MP3_SOURCE_SHA256}) encoded by LAME 3.100: lame --silent --resample 44.1 -b 64 --cbr --noreplaygain; MPEG-1 Layer III, 44.1 kHz mono, stored bytes`,
    make: storedMp3,
  },
};

export function buildAssets() {
  return Object.fromEntries(
    Object.entries(ASSET_GENERATORS).map(([name, g]) => {
      const bytes = g.make();
      return [name, { generator: g.describe, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') }];
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Fingerprint. sha256 over the input files sorted by the UTF-8 bytes of their path; per file:
//   UTF8(path) 0x00 decimal(length) 0x00 bytes 0x0A
// A file is either `text` (UTF-8 encoded as written, so BOM and CRLF are kept), `base64`, or an
// `asset` reference whose bytes come from the corpus assets. The Kotlin and Swift harnesses
// recompute this from the copied corpus and refuse a case whose files no longer hash to it.
// ---------------------------------------------------------------------------------------------

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function fileBytes(file, assets) {
  if (file.text !== undefined) return Buffer.from(file.text, 'utf8');
  if (file.base64 !== undefined) return Buffer.from(file.base64, 'base64');
  if (file.asset !== undefined) {
    const asset = assets[file.asset];
    if (!asset) throw new Error(`unknown asset ${file.asset}`);
    return Buffer.from(asset.base64, 'base64');
  }
  throw new Error(`file ${file.path} has no content`);
}

export function fingerprint(files, assets) {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  const hash = createHash('sha256');
  for (const file of sorted) {
    const bytes = fileBytes(file, assets);
    hash.update(Buffer.concat([Buffer.from(file.path, 'utf8'), Buffer.from([0]), Buffer.from(String(bytes.length), 'ascii'), Buffer.from([0]), bytes, Buffer.from([10])]));
  }
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------------------------
// Pack builder. Coordinates written in files are 1-based; results are 0-based (internal).
// ---------------------------------------------------------------------------------------------

export const STD_INFO = ['title=Conformance', 'producerName=UniPad Conformance', 'buttonX=4', 'buttonY=3', 'chain=2', 'squareButton=true'].join('\n');
export const DEFAULT_INFO = { title: 'Conformance', producerName: 'UniPad Conformance', buttonX: 4, buttonY: 3, chain: 2, squareButton: true };

const SOUND_ASSETS = { 'a.wav': 'tone-440', 'b.wav': 'tone-660', 'c.wav': 'silence-10ms', 'fx/s.wav': 'tone-440', 'a.mp3': 'tone-440-mp3' };

/**
 * `info`/`keySound`: string, or null to leave the file out. `sounds`: names under sounds/ (default
 * a.wav b.wav c.wav). `keyLed`: `fileName -> content`. `autoPlay`: string. `extra`: raw file entries.
 */
export function pack({ info = STD_INFO, keySound = '1 1 1 a.wav', sounds = ['a.wav', 'b.wav', 'c.wav'], keyLed, autoPlay, extra = [] } = {}) {
  const files = [];
  if (info !== null) files.push(typeof info === 'string' ? { path: 'info', text: info } : { path: 'info', ...info });
  if (keySound !== null) files.push(typeof keySound === 'string' ? { path: 'keySound', text: keySound } : { path: 'keySound', ...keySound });
  for (const name of sounds) files.push({ path: `sounds/${name}`, asset: SOUND_ASSETS[name] });
  for (const [name, content] of Object.entries(keyLed ?? {})) files.push({ path: `keyLed/${name}`, text: content });
  if (autoPlay !== undefined) files.push({ path: 'autoPlay', text: autoPlay });
  return [...files, ...extra];
}

export const lines = (...l) => l.join('\n');

// ---------------------------------------------------------------------------------------------
// Expected-result builders (normalized form, see README "Normalized result").
// ---------------------------------------------------------------------------------------------

export function paletteColor(palette, velocity) {
  return palette.argb[velocity];
}

export const q = (file, loop = 0, wormhole = -1) => ({ file, loop, wormhole });
export const cell = (c, x, y, queue) => ({ c, x, y, queue });
export const ledCell = (c, x, y, queue) => ({ c, x, y, queue });
export const anim = (loop, events) => ({ loop, events });

export const ev = {
  on: (x, y, color, velocity = 4) => ['on', x, y, color, velocity],
  off: (x, y) => ['off', x, y],
  delay: (ms) => ['delay', ms],
  chain: (c) => ['chain', c],
};
export const ap = {
  on: (x, y, chain, num) => ['on', x, y, chain, num],
  off: (x, y, chain) => ['off', x, y, chain],
  chain: (c) => ['chain', c],
  delay: (ms) => ['delay', ms],
};

/** The parse result of a pack that loads, with every part the case does not mention at its default. */
export function loaded(over = {}) {
  const { info, ...rest } = over;
  return { loaded: true, info: { ...DEFAULT_INFO, ...(info ?? {}) }, sounds: [], keyLedExist: false, leds: [], autoPlay: null, errors: [], ...rest };
}

export const refused = () => ({ loaded: false });

// Basis entries. `doc` is checked against content/docs/en/unipack at build time. `agreed` is no
// statement of what is right: no doc or intent decides the case, and the three platforms gave the same
// result when it was observed (`ref`), so that result is held to catch a change on any one of them.
// `decision` is a result the maintainers chose where the platforms differed and no doc decides; the
// platforms that do not give it yet are pinned in divergences.json until they are changed.
export const doc = (file, note) => ({ type: 'doc', ref: `content/docs/en/unipack/${file}`, note });
export const intent = (ref, note) => ({ type: 'intent', ref, note });
export const reference = (ref, note) => ({ type: 'reference', ref, note });
export const agreed = (ref, note) => ({ type: 'agreed', ref, note });
export const decision = (ref, note) => ({ type: 'decision', ref, note });

const restsOn = (type) => (c) => (c.basis ?? []).some((b) => b.type === type);
/** A case whose expected result is only what the three platforms agreed on (an `agreed` basis). */
export const restsOnAgreement = restsOn('agreed');
/** A case whose expected result is a maintainers' decision that no doc states (a `decision` basis). */
export const restsOnDecision = restsOn('decision');
