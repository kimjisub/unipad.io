import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseUniPack } from './parser.ts';
import { SoundEngine } from './SoundEngine.ts';
import { packZip } from './testUtils.ts';

const fixtures = 'src/lib/unipack/__fixtures__/audio-safety/';
const INFO = 'title=Test\nproducerName=Tester\nbuttonX=2\nbuttonY=2\nchain=1\nsquareButton=true';

/**
 * 8-bit PCM whose samples all equal `mark`, so a decoder can tell which file it was given. At 8 kHz
 * mono one byte is one frame and costs 12 (6 frames at 48 kHz, at least two channels): ten minutes
 * cost 57,600,000, so two fill the pack below its 134,217,728 limit and a third does not fit.
 */
function wave({ rate = 8000, frames, mark, claimedSeconds }) {
  const fact = claimedSeconds === undefined ? 0 : 12;
  const b = Buffer.alloc(44 + fact + frames, mark);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  if (fact) {
    b.write('fact', 36);
    b.writeUInt32LE(4, 40);
    b.writeUInt32LE(claimedSeconds * rate, 44);
  }
  b.write('data', 36 + fact);
  b.writeUInt32LE(frames, 40 + fact);
  return b;
}
const TEN_MINUTES = 600 * 8000;

/** What a decoder was handed, by the mark of each file; `fail` rejects the files it names. */
function fakeAudio(fail = {}) {
  const decoded = [];
  globalThis.AudioContext = class {
    state = 'running';
    destination = {};
    currentTime = 0;
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    async resume() {}
    async suspend() {}
    close() {}
    async decodeAudioData(data) {
      const bytes = new Uint8Array(data);
      const mark = bytes[bytes.length - 1];
      decoded.push(mark);
      if (fail[mark]) throw fail[mark]();
      return { duration: bytes.length / 8000, mark };
    }
  };
  return decoded;
}

async function load(keySound, sounds, fail) {
  const pack = await parseUniPack(await packZip({ info: INFO, keySound, ...Object.fromEntries(
    Object.entries(sounds).map(([name, bytes]) => [`sounds/${name}`, bytes]),
  ) }));
  const decoded = fakeAudio(fail);
  const engine = new SoundEngine(pack, () => 0, () => {});
  const report = await engine.load();
  engine.destroy();
  const buffer = (x, y) => pack.soundTable[0][x][y]?.[0].audioBuffer?.mark ?? null;
  return { report, decoded, buffer };
}
const reasons = report => report.failures.map(f => [f.file, f.reason]);
const encodingError = () => Object.assign(new Error('Unable to decode audio data'), { name: 'EncodingError' });

test('a selected file that fails to decode keeps its reservation: the file past the limit is never decoded', async () => {
  // Pads in chain, x, y order: a, b, c fill the pack past its limit at c; d is small enough to fit after.
  const { report, decoded, buffer } = await load('1 1 1 a.wav\n1 1 2 b.wav\n1 2 1 c.wav\n1 2 2 d.wav', {
    'a.wav': wave({ frames: TEN_MINUTES, mark: 1 }),
    'b.wav': wave({ frames: TEN_MINUTES, mark: 2 }),
    'c.wav': wave({ frames: TEN_MINUTES, mark: 3 }),
    'd.wav': wave({ frames: 8000, mark: 4 }),
  }, { 1: encodingError });

  assert.deepEqual([...decoded].sort(), [1, 2, 4], 'c must not take the budget a failed to use');
  assert.deepEqual(reasons(report), [['sounds/a.wav', 'decode'], ['sounds/c.wav', 'limit']]);
  assert.equal(report.failures[1].exclusion, 'PACK_LIMIT');
  assert.equal(report.usedFiles, 4);
  assert.equal(report.loadedFiles, 2);
  assert.equal(report.reservedCost, 57_600_000n * 2n + 96_000n);
  assert.deepEqual([buffer(0, 0), buffer(0, 1), buffer(1, 0), buffer(1, 1)], [null, 2, null, 4]);
});

test('an allocation failure while decoding is reported as low device memory and keeps the reservation', async () => {
  const { report, decoded } = await load('1 1 1 a.wav\n1 1 2 b.wav\n1 2 1 c.wav', {
    'a.wav': wave({ frames: TEN_MINUTES, mark: 1 }),
    'b.wav': wave({ frames: TEN_MINUTES, mark: 2 }),
    'c.wav': wave({ frames: TEN_MINUTES, mark: 3 }),
  }, { 2: () => new RangeError('Array buffer allocation failed') });

  assert.deepEqual([...decoded].sort(), [1, 2]);
  assert.deepEqual(reasons(report), [['sounds/b.wav', 'memory'], ['sounds/c.wav', 'limit']]);
});

test('the actual audio, not its advertised length, decides: real 5 s shown as 700 s plays, real 700 s shown as 60 s is left out', async () => {
  const { report, decoded, buffer } = await load('1 1 1 short.mp3\n1 1 2 long.wav', {
    'short.mp3': readFileSync(fixtures + 'claimed-700-tone.mp3'),
    'long.wav': wave({ frames: 700 * 8000, mark: 9, claimedSeconds: 60 }),
  });

  assert.equal(decoded.length, 1, 'only the admitted file is decoded');
  assert.notEqual(buffer(0, 0), null);
  assert.deepEqual(reasons(report), [['sounds/long.wav', 'limit']]);
  assert.equal(report.failures[0].exclusion, 'DURATION');
  assert.equal(buffer(0, 1), null);
});

test('unreadable files are told apart from files that are too long, and a duplicate follows its first decision', async () => {
  const { report, decoded } = await load('1 1 1 empty.wav\n1 1 2 empty.wav\n1 2 1 ok.wav\n1 2 2 ok.wav', {
    'empty.wav': new Uint8Array(0),
    'ok.wav': wave({ frames: 8000, mark: 5 }),
  });

  assert.deepEqual(decoded, [5], 'one decode per unique file');
  assert.deepEqual(reasons(report), [['sounds/empty.wav', 'unreadable']]);
  assert.equal(report.usedFiles, 2);
  assert.equal(report.loadedFiles, 1);
});

test('a pack whose used sounds all fail is reported as such; a pack without sounds is not', async () => {
  const failed = await load('1 1 1 a.wav', { 'a.wav': wave({ frames: 8000, mark: 1 }) }, { 1: encodingError });
  assert.equal(failed.report.usedFiles, 1);
  assert.equal(failed.report.loadedFiles, 0);

  const silent = await load('', {});
  assert.equal(silent.report.usedFiles, 0);
  assert.deepEqual(silent.report.failures, []);
});

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function pendingLoad() {
  const pack = await parseUniPack(await packZip({ info: INFO,
    keySound: '1 1 1 a.wav\n1 1 2 b.wav\n1 2 1 c.wav\n1 2 2 bad.wav',
    'sounds/a.wav': wave({ frames: 8000, mark: 1 }),
    'sounds/b.wav': wave({ frames: 8000, mark: 2 }),
    'sounds/c.wav': wave({ frames: 8000, mark: 3 }),
    'sounds/bad.wav': 'not audio',
  }));
  // The parser normally only extracts referenced sounds; a caller may retain an extra file.
  pack.soundFiles.set('unused.wav', new ArrayBuffer(1));
  const gates = [null, deferred(), deferred(), deferred()];
  const decoded = fakeAudio({ 2: encodingError });
  const decode = AudioContext.prototype.decodeAudioData;
  const entered = deferred();
  AudioContext.prototype.decodeAudioData = async function (bytes) {
    const mark = new Uint8Array(bytes).at(-1);
    entered.resolve();
    await gates[mark].promise;
    return Reflect.apply(decode, this, [bytes]);
  };
  const engine = new SoundEngine(pack, () => 0, () => {});
  const loading = engine.load();
  await entered.promise;
  return { pack, gates, loading, decoded, engine, finish: async () => {
    for (const gate of gates.slice(1)) gate.resolve();
    await loading; engine.destroy();
  } };
}

test('excluded and unused sound bytes are released before decoding begins', async () => {
  const run = await pendingLoad();
  try {
    assert.equal(run.pack.soundFiles.has('sounds/bad.wav'), false);
    assert.equal(run.pack.soundFiles.has('unused.wav'), false);
    assert.equal(run.pack.soundFiles.has('sounds/a.wav'), true, 'pending files keep their bytes');
  } finally { await run.finish(); }
});

for (const [mark, file] of [[1, 'a.wav'], [2, 'b.wav']]) {
  test(`settling ${file} releases its bytes while another decode is pending`, async () => {
    const run = await pendingLoad();
    try {
      run.gates[mark].resolve();
      await turn();
      assert.equal(run.pack.soundFiles.has(`sounds/${file}`), false);
      assert.equal(run.pack.soundFiles.has('sounds/c.wav'), true);
    } finally { await run.finish(); }
    assert.equal(run.pack.soundFiles.size, 0);
    assert.deepEqual(run.decoded.sort(), [1, 2, 3]);
  });
}

test('inspection ends before the first decode and closing again is safe', async () => {
  const { createAudioInspector } = await import('./audioInspectionWorker.ts');
  const { inspectAudio } = await import('./audioInspection.ts');
  const previousWorker = globalThis.Worker;
  const events = [];
  globalThis.Worker = class {
    postMessage({ id, bytes }) {
      // A structured copy leaves the source available for fallback and decoding.
      const copied = structuredClone(bytes);
      queueMicrotask(() => { events.push('inspect'); this.onmessage({ data: { id, inspection: inspectAudio(copied) } }); });
    }
    terminate() { events.push('close'); }
  };
  const pack = await parseUniPack(await packZip({ info: INFO, keySound: '1 1 1 a.wav\n1 1 2 b.wav',
    'sounds/a.wav': wave({ frames: 8000, mark: 1 }), 'sounds/b.wav': wave({ frames: 8000, mark: 2 }) }));
  fakeAudio();
  const decode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = function (bytes) {
    events.push('decode'); return Reflect.apply(decode, this, [bytes]);
  };
  const engine = new SoundEngine(pack, () => 0, () => {});
  const inspector = createAudioInspector();
  try {
    await engine.load(inspector);
    inspector.close(); inspector.close();
    assert.deepEqual(events, ['inspect', 'inspect', 'close', 'decode', 'decode']);
  } finally { inspector.close(); engine.destroy(); globalThis.Worker = previousWorker; }
});
