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

/** `wave` with empty chunks before its data: too many headers to count as a header read. */
function layeredWave({ frames, mark, chunks = 70 }) {
  const plain = wave({ frames, mark });
  const junk = Buffer.alloc(chunks * 8);
  for (let i = 0; i < chunks; i++) junk.write('junk', i * 8);
  const b = Buffer.concat([plain.subarray(0, 36), junk, plain.subarray(36)]);
  b.writeUInt32LE(b.length - 8, 4);
  return b;
}

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

async function pendingLoad(shared = false) {
  const pack = await parseUniPack(await packZip({ info: INFO,
    keySound: '1 1 1 a.wav\n1 1 2 b.wav\n1 2 1 c.wav\n1 2 2 bad.wav',
    'sounds/a.wav': wave({ frames: 8000, mark: 1 }),
    'sounds/b.wav': wave({ frames: 8000, mark: 2 }),
    'sounds/c.wav': wave({ frames: 8000, mark: 3 }),
    'sounds/bad.wav': 'not audio',
  }));
  // The parser normally only extracts referenced sounds; a caller may retain an extra file.
  pack.soundFiles.set('unused.wav', shared ? pack.soundFiles.get('sounds/a.wav') : new ArrayBuffer(1));
  const encoded = new Map(pack.soundFiles);
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
  return { pack, encoded, gates, loading, decoded, engine, finish: async () => {
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
    assert.equal(run.encoded.get('sounds/bad.wav').byteLength, 0);
    assert.equal(run.encoded.get('unused.wav').byteLength, 0);
  } finally { await run.finish(); }
});

test('an excluded alias cannot discard bytes still owned by a selected sound', async () => {
  const run = await pendingLoad(true);
  try {
    assert.equal(run.pack.soundFiles.has('unused.wav'), false);
    assert.ok(run.encoded.get('sounds/a.wav').byteLength > 0);
    run.gates[1].resolve();
    await turn();
    assert.ok(run.encoded.get('sounds/a.wav').byteLength > 0, 'shared buffers keep their original lifetime');
  } finally { await run.finish(); }
  assert.deepEqual(run.decoded.sort(), [1, 2, 3]);
});

for (const [mark, file] of [[1, 'a.wav'], [2, 'b.wav']]) {
  test(`settling ${file} releases its bytes while another decode is pending`, async () => {
    const run = await pendingLoad();
    try {
      run.gates[mark].resolve();
      await turn();
      assert.equal(run.pack.soundFiles.has(`sounds/${file}`), false);
      assert.equal(run.pack.soundFiles.has('sounds/c.wav'), true);
      assert.equal(run.encoded.get(`sounds/${file}`).byteLength, 0);
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
    'sounds/a.wav': layeredWave({ frames: 8000, mark: 1 }), 'sounds/b.wav': layeredWave({ frames: 8000, mark: 2 }) }));
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

async function costRun(costs) {
  const { PACK_AUDIO_LIMIT } = await import('./audioSafety.ts');
  const names = costs.map((_, i) => `${i + 1}.wav`);
  const pack = await parseUniPack(await packZip({ info: INFO,
    keySound: names.map(name => `1 1 1 ${name}`).join('\n'),
    ...Object.fromEntries(names.map((name, i) => [`sounds/${name}`, new Uint8Array([i + 1])])),
  }));
  fakeAudio();
  const decode = AudioContext.prototype.decodeAudioData;
  const gates = costs.map(() => deferred());
  const started = [];
  AudioContext.prototype.decodeAudioData = async function (bytes) {
    const mark = new Uint8Array(bytes).at(-1);
    started.push(mark); await gates[mark - 1].promise;
    return Reflect.apply(decode, this, [bytes]);
  };
  const engine = new SoundEngine(pack, () => 0, () => {});
  const loading = engine.load({ inspect: async bytes => ({ exclusion: null,
    facts: { sampleRate: 48000, channels: 2, frames: costs[new Uint8Array(bytes)[0] - 1] / 2n } }) });
  await turn();
  return { engine, pack, gates, started, loading, limit: PACK_AUDIO_LIMIT / 4n, finish: async () => {
    gates.forEach(g => g.resolve()); await loading; engine.destroy();
  } };
}

test('decode batches follow admitted audio cost, including a file larger than one batch', async () => {
  const { PACK_AUDIO_LIMIT } = await import('./audioSafety.ts');
  const limit = PACK_AUDIO_LIMIT / 4n;
  const run = await costRun([limit / 2n, limit / 2n, 2n, limit + 2n, 2n, limit, 2n]);
  try {
    assert.deepEqual(run.started, [1, 2], 'the cost boundary is inclusive');
    run.gates[0].resolve(); await turn();
    assert.deepEqual(run.started, [1, 2], 'finish the batch before starting another');
    for (let index = 1; index < 7; index++) {
      run.gates[index].resolve(); await turn();
      assert.deepEqual(run.started, Array.from({ length: Math.min(index + 2, 7) }, (_, i) => i + 1));
    }
    const report = await run.loading;
    assert.equal(report.loadedFiles, 7, 'an oversize batch file is decoded alone, never omitted');
    assert.deepEqual(report.failures, []);
    assert.equal(report.reservedCost, 3n * limit + 8n);
  } finally { await run.finish(); }
});

test('small sounds still decode ten at once', async () => {
  const run = await costRun(Array(12).fill(2n));
  try {
    assert.deepEqual(run.started, Array.from({ length: 10 }, (_, i) => i + 1));
    for (const gate of run.gates.slice(0, 10)) gate.resolve();
    await turn();
    assert.deepEqual(run.started, Array.from({ length: 12 }, (_, i) => i + 1));
  } finally { await run.finish(); }
});


test('replacing a pack stops before the next decode batch and drops late results', async () => {
  const run = await costRun(Array(12).fill(2n));
  try {
    assert.equal(run.started.length, 10);
    run.engine.destroy();
    for (const gate of run.gates.slice(0, 10)) gate.resolve();
    await turn();
    assert.deepEqual(run.started, Array.from({ length: 10 }, (_, i) => i + 1));
    const report = await run.loading;
    assert.equal(report.loadedFiles, 0);
    assert.equal(run.pack.soundFiles.size, 0);
    assert.ok(run.pack.soundTable.flat(2).flat().every(sound => !sound || sound.audioBuffer === null));
  } finally { await run.finish(); }
});


test('replacing a pack during inspection never starts a decode', async () => {
  const pack = await parseUniPack(await packZip({ info: INFO, keySound: '1 1 1 a.wav', 'sounds/a.wav': wave({ frames: 800, mark: 1 }) }));
  const decoded = fakeAudio();
  const gate = deferred();
  const engine = new SoundEngine(pack, () => 0, () => {});
  const loading = engine.load({ inspect: async () => { await gate.promise; return { exclusion: null,
    facts: { sampleRate: 8000, channels: 1, frames: 800n } }; } });
  engine.destroy();
  gate.resolve();
  await loading;
  assert.deepEqual(decoded, []);
  assert.equal(pack.soundFiles.size, 0);
});


test('a replaced pack discards an in-flight sound buffer when decoding settles after its map was cleared', async () => {
  const run = await costRun([2n]);
  const bytes = run.pack.soundFiles.get('sounds/1.wav');
  try {
    run.engine.destroy();
    assert.equal(run.pack.soundFiles.size, 0);
    run.gates[0].resolve();
    await run.loading;
    assert.equal(bytes.byteLength, 0, 'late decoding still releases its exclusively owned encoded bytes');
  } finally { await run.finish(); }
});

test('the inspection worker discards its copy of a sound once it has read it', async () => {
  const previousSelf = globalThis.self;
  const responses = [];
  globalThis.self = { postMessage: response => responses.push(response) };
  try {
    await import('./audioInspection.worker.ts');
    const copy = wave({ frames: 8000, mark: 1 });
    const bytes = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
    globalThis.self.onmessage({ data: { id: 7, bytes } });
    assert.equal(responses.length, 1);
    assert.equal(responses[0].id, 7);
    assert.notEqual(responses[0].inspection, null);
    assert.equal(bytes.byteLength, 0, 'the worker no longer holds the sound until it is collected');
  } finally { globalThis.self = previousSelf; }
});

test('a worker that fails after discarding its copies leaves every sound loadable from the page', async () => {
  const { createAudioInspector } = await import('./audioInspectionWorker.ts');
  const previousWorker = globalThis.Worker;
  const previousWarn = console.warn;
  console.warn = () => {};
  globalThis.Worker = class {
    postMessage({ bytes }) {
      const copied = structuredClone(bytes);
      queueMicrotask(() => { copied.transfer(0); this.onerror({ preventDefault() {}, message: 'worker crashed' }); });
    }
    terminate() {}
  };
  const pack = await parseUniPack(await packZip({ info: INFO, keySound: '1 1 1 a.wav\n1 1 2 b.wav',
    'sounds/a.wav': layeredWave({ frames: 8000, mark: 1 }), 'sounds/b.wav': layeredWave({ frames: 8000, mark: 2 }) }));
  const decoded = fakeAudio();
  const engine = new SoundEngine(pack, () => 0, () => {});
  const inspector = createAudioInspector();
  try {
    const report = await engine.load(inspector);
    assert.deepEqual([report.loadedFiles, report.failures], [2, []]);
    assert.deepEqual(decoded.sort(), [1, 2]);
  } finally { inspector.close(); engine.destroy(); globalThis.Worker = previousWorker; console.warn = previousWarn; }
});

test('only WAV files read from their headers stay off the worker', async () => {
  const { readsFromHeadersOnly } = await import('./audioInspection.ts');
  const float = wave({ frames: 800, mark: 1 });
  float.writeUInt16LE(3, 20);
  const extensibleMpeg = Buffer.concat([wave({ frames: 0, mark: 0 }).subarray(0, 12), Buffer.alloc(48)]);
  extensibleMpeg.write('fmt ', 12);
  extensibleMpeg.writeUInt32LE(40, 16);
  extensibleMpeg.writeUInt16LE(0xfffe, 20);
  extensibleMpeg.writeUInt16LE(85, 44);
  const cases = [
    ['8-bit PCM', wave({ frames: 800, mark: 1 }), true],
    ['float', float, true],
    ['PCM with a trailing chunk', readFileSync(fixtures + 'trailing-junk.wav'), true],
    ['PCM with empty chunks within the limit', layeredWave({ frames: 800, mark: 1, chunks: 10 }), true],
    ['PCM with more chunks than a header read', layeredWave({ frames: 800, mark: 1 }), false],
    ['MPEG frames in WAV', readFileSync(fixtures + 'mp3-in-wave.wav'), false],
    ['extensible WAV carrying MPEG', extensibleMpeg, false],
    ['MP3 named .wav', readFileSync(fixtures + 'mp3-named.wav'), false],
    ['Ogg', readFileSync('e2e/fixtures/tone.ogg'), false],
    ['not audio', Buffer.from('not audio'), false],
  ];
  for (const [name, bytes, expected] of cases)
    assert.equal(readsFromHeadersOnly(new Uint8Array(bytes)), expected, name);
});

test('a plain WAV is read on the page with no copy posted to the worker', async () => {
  const { createAudioInspector } = await import('./audioInspectionWorker.ts');
  const { inspectAudio } = await import('./audioInspection.ts');
  const previousWorker = globalThis.Worker;
  const posted = [];
  globalThis.Worker = class {
    postMessage({ id, bytes }) {
      posted.push(bytes.byteLength);
      const copied = structuredClone(bytes);
      queueMicrotask(() => this.onmessage({ data: { id, inspection: inspectAudio(copied) } }));
    }
    terminate() {}
  };
  const inspector = createAudioInspector();
  const plain = wave({ frames: 8000, mark: 1 });
  const layered = layeredWave({ frames: 8000, mark: 2 });
  const ogg = readFileSync('e2e/fixtures/tone.ogg');
  const own = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  try {
    const results = await Promise.all([plain, layered, ogg].map(bytes => inspector.inspect(own(bytes))));
    assert.deepEqual(results.map(result => result.facts?.format), ['wav', 'wav', 'ogg']);
    assert.deepEqual(posted, [layered.byteLength, ogg.byteLength]);
  } finally { inspector.close(); globalThis.Worker = previousWorker; }
});
