import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const directory = 'src/lib/unipack/__fixtures__/audio-safety/';
const corpus = JSON.parse(readFileSync(directory + 'cases.json', 'utf8'));
// Keep tests runnable on the base commit: a missing implementation is an explicit failure.
const implementation = await import('./audioSafety.ts').catch(() => ({}));
const reader = await import('./audioInspection.ts').catch(() => ({}));

for (const c of corpus.costs)
  test(`common cost: ${c.id}`, () => {
    assert.equal(
      typeof implementation.audioCost,
      'function',
      'integer admission is missing',
    );
    assert.deepEqual(
      implementation.audioCost({
        sampleRate: c.rate,
        channels: c.channels,
        frames: BigInt(c.frames),
      }),
      c.exclusion
        ? { cost: 0n, exclusion: c.exclusion }
        : { cost: BigInt(c.cost), exclusion: null },
    );
  });
for (const c of corpus.files)
  test(`common physical file: ${c.file}`, () => {
    const bytes = readFileSync(directory + c.file);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      c.sha256,
      'shared input bytes changed',
    );
    assert.equal(
      typeof reader.inspectAudio,
      'function',
      'physical file inspection is missing',
    );
    const result = reader.inspectAudio(bytes);
    if (c.exclusion) assert.deepEqual(result, { exclusion: c.exclusion });
    else {
      assert.equal(result.exclusion, null);
      assert.equal(result.facts.sampleRate, c.rate);
      assert.equal(result.facts.channels, c.channels);
      assert.equal(result.facts.frames, BigInt(c.frames));
    }
  });
function wave(c) {
  const size = c.frames * c.channels * 2;
  const b = Buffer.alloc(56 + size);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(c.channels, 22);
  b.writeUInt32LE(c.rate, 24);
  b.writeUInt32LE(c.rate * c.channels * 2, 28);
  b.writeUInt16LE(c.channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('fact', 36);
  b.writeUInt32LE(4, 40);
  b.writeUInt32LE(c.claimedSeconds * c.rate, 44);
  b.write('data', 48);
  b.writeUInt32LE(size, 52);
  return b;
}
for (const c of corpus.wavRecipes)
  test(`common generated file: ${c.id}`, () => {
    assert.equal(
      typeof reader.inspectAudio,
      'function',
      'physical file inspection is missing',
    );
    const result = reader.inspectAudio(wave(c));
    assert.equal(result.exclusion, null);
    assert.equal(result.facts.frames, BigInt(c.frames));
    assert.deepEqual(implementation.audioCost(result.facts), {
      cost: BigInt(c.expectedCost),
      exclusion: c.exclusion,
    });
  });
for (const c of corpus.selections)
  test(`common selection: ${c.id}`, async () => {
    assert.equal(
      typeof implementation.selectAudio,
      'function',
      'ordered admission is missing',
    );
    const calls = [];
    const plan = await implementation.selectAudio(
      c.references.map(([chain, x, y, line, identity]) => ({
        chain,
        x,
        y,
        line,
        identity,
      })),
      { chains: c.bounds[0], width: c.bounds[1], height: c.bounds[2] },
      async identity => {
        calls.push(identity);
        const f = c.facts[identity];
        return f
          ? {
              exclusion: null,
              facts: { sampleRate: f[0], channels: f[1], frames: BigInt(f[2]) },
            }
          : { exclusion: 'READ_FAILURE' };
      },
    );
    assert.deepEqual(calls, c.order);
    assert.deepEqual(
      plan.files.map(f => f.identity),
      c.order,
    );
    assert.deepEqual(
      plan.files.map(f => f.exclusion),
      c.exclusions,
    );
    assert.deepEqual(
      plan.files.filter(f => !f.exclusion).map(f => f.identity),
      c.selected,
    );
    assert.equal(plan.reservedCost, BigInt(c.reservedCost));
    assert.ok(
      Object.isFrozen(plan) &&
        Object.isFrozen(plan.files) &&
        plan.files.every(Object.isFrozen),
    );
    // A rejected decoder cannot return a reservation to a subsequent file.
    const before = plan.reservedCost;
    await Promise.allSettled(
      plan.files
        .filter(f => !f.exclusion)
        .reverse()
        .map(async () => {
          throw Error('decode failure');
        }),
    );
    assert.equal(plan.reservedCost, before);
    assert.deepEqual(
      plan.files.filter(f => !f.exclusion).map(f => f.identity),
      c.selected,
    );
  });
for (const [rate, frames, accepted] of [
  [48000, 9508864, true],
  [48000, 9508865, false],
  [44100, 8736268, true],
  [44100, 8736269, false],
]) {
  test(`remaining budget boundary ${rate}/${frames}`, async () => {
    assert.equal(
      typeof implementation.selectAudio,
      'function',
      'ordered admission is missing',
    );
    const facts = [28800000, 28800000, frames];
    const result = await implementation.selectAudio(
      facts.map((_, line) => ({
        chain: 0,
        x: 0,
        y: 0,
        line,
        identity: String(line),
      })),
      { chains: 1, width: 1, height: 1 },
      id => ({
        exclusion: null,
        facts: {
          sampleRate: id === '2' ? rate : 48000,
          channels: 2,
          frames: BigInt(facts[Number(id)]),
        },
      }),
    );
    assert.equal(result.files[2].exclusion, accepted ? null : 'PACK_LIMIT');
    assert.equal(result.reservedCost, accepted ? 134217728n : 115200000n);
  });
}
test('invalid exact-integer inputs never become cheap reservations', () => {
  assert.equal(
    typeof implementation.audioCost,
    'function',
    'integer admission is missing',
  );
  for (const frames of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(
      implementation.audioCost({ sampleRate: 48000, channels: 2, frames })
        .exclusion,
      'INVALID_FORMAT',
    );
  }
});
test('a thrown read failure is final for duplicate identities and later files still run', async () => {
  assert.equal(
    typeof implementation.selectAudio,
    'function',
    'ordered admission is missing',
  );
  const calls = [];
  const result = await implementation.selectAudio(
    ['bad', 'bad', 'good'].map((identity, line) => ({
      chain: 0,
      x: 0,
      y: 0,
      line,
      identity,
    })),
    { chains: 1, width: 1, height: 1 },
    id => {
      calls.push(id);
      if (id === 'bad') throw Error('read failed');
      return {
        exclusion: null,
        facts: { sampleRate: 48000, channels: 2, frames: 1n },
      };
    },
  );
  assert.deepEqual(calls, ['bad', 'good']);
  assert.deepEqual(
    result.files.map(f => f.exclusion),
    ['READ_FAILURE', null],
  );
  assert.equal(result.reservedCost, 2n);
});

test('the common manifest is the unchanged third revision', () => {
  assert.equal(
    createHash('sha256')
      .update(readFileSync(directory + 'cases.json'))
      .digest('hex'),
    'b16e4f635d671b3ab2d20222cea55bec72cce91e496d6b2ea87ccf6525c193c4',
  );
});
const words = (...values) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((n, i) => b.writeUInt32BE(n >>> 0, i * 4));
  return b;
};
const box = (type, ...parts) => {
  const data = Buffer.concat(parts);
  return Buffer.concat([words(data.length + 8), Buffer.from(type), data]);
};
function pcmChunks(count) {
  const entry = Buffer.alloc(28);
  entry[7] = 1;
  entry[17] = 1;
  entry[19] = 16;
  words(48000 << 16).copy(entry, 24);
  const stsd = box('stsd', words(0, 1), box('sowt', entry));
  const offsets = Buffer.alloc(8 + count * 4);
  offsets.writeUInt32BE(count, 4);
  for (let i = 0; i < count; i++) offsets.writeUInt32BE(8 + i * 2, 8 + i * 4);
  const stbl = box(
    'stbl',
    stsd,
    box('stts', words(0, 1, count, 1)),
    box('stsz', words(0, 2, count)),
    box('stsc', words(0, 1, 1, 1, 1)),
    box('stco', offsets),
  );
  const mdhd = box('mdhd', words(0, 0, 0, 48000, count)),
    hdlr = box('hdlr', words(0, 0), Buffer.from('soun'));
  return Buffer.concat([
    box('mdat', Buffer.alloc(count * 2)),
    box('moov', box('trak', box('mdia', mdhd, hdlr, box('minf', stbl)))),
  ]);
}
test('MP4 excessive boxes fail as read capacity, not partial admission', () => {
  const input = Buffer.concat([
    readFileSync(directory + 'tone.m4a'),
    ...Array.from({ length: 4097 }, () => box('free')),
  ]);
  assert.deepEqual(reader.inspectAudio(input), { exclusion: 'READ_FAILURE' });
});
test('MP4 excessive physical chunk table fails before allocating extents', () => {
  assert.deepEqual(reader.inspectAudio(pcmChunks(262145)), {
    exclusion: 'READ_FAILURE',
  });
});
test('MP4 bounded tables inspect every physical PCM frame', () => {
  const result = reader.inspectAudio(pcmChunks(4096));
  assert.equal(result.exclusion, null);
  assert.equal(result.facts.frames, 4096n);
});
test('MPEG repeated unrelated headers fail within a shared probe budget', () => {
  const input = Buffer.concat([
    readFileSync(directory + 'tone.mp3'),
    Buffer.concat(
      Array.from({ length: 1024 }, () => Buffer.from([255, 231, 232, 192, 0])),
    ),
  ]);
  assert.deepEqual(reader.inspectAudio(input), { exclusion: 'READ_FAILURE' });
});
test('numeric chain, x, y, then line ordering precedes deduplication', async () => {
  const refs = [
    [1, 0, 0, 0, 'chain'],
    [0, 1, 0, 0, 'x'],
    [0, 0, 1, 0, 'y'],
    [0, 0, 0, 2, 'line2'],
    [0, 0, 0, 1, 'first'],
    [2, 0, 0, 0, 'first'],
    [0, -1, 0, 0, 'outside'],
    [0, 0, 2, 0, 'outside'],
    [0, 0, 0, 3, 'line2'],
  ];
  const calls = [];
  const plan = await implementation.selectAudio(
    refs.map(([chain, x, y, line, identity]) => ({
      chain,
      x,
      y,
      line,
      identity,
    })),
    { chains: 2, width: 2, height: 2 },
    async identity => {
      calls.push(identity);
      return {
        exclusion: null,
        facts: { sampleRate: 48000, channels: 2, frames: 1n },
      };
    },
  );
  assert.deepEqual(calls, ['first', 'line2', 'y', 'x', 'chain']);
  assert.equal(plan.reservedCost, 10n);
});
