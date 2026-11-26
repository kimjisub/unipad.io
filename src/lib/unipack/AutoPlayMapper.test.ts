import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AutoPlayRunner } from './AutoPlayRunner';
import { ManualClock } from './testUtils';
import { autoPlayMap } from './AutoPlayMapper';
import { saveChainOrigins } from './autoPlayChainOrigin';
import { parseUniPack } from './parser';
import type { AutoPlay, AutoPlayElement, UniPackData } from './types';
import { SILENT_WAV, packZip } from './testUtils';

const INFO = 'title=Test\nproducerName=Tester\nbuttonX=4\nbuttonY=4\nchain=2\nsquareButton=true';

async function parse(keySound: string, autoPlay: string): Promise<UniPackData> {
  return parseUniPack(await packZip({
    info: INFO, keySound, autoPlay, 'sounds/a.wav': SILENT_WAV, 'sounds/b.wav': SILENT_WAV, 'sounds/c.wav': SILENT_WAV,
  }));
}

/** Gives each sound file the length the case names; `null` stands for a length that could not be read. */
function setLengths(pack: UniPackData, lengthsMs: Record<string, number | null>): void {
  for (const chain of pack.soundTable) for (const column of chain) for (const queue of column) for (const sound of queue ?? []) {
    const length = lengthsMs[sound.file.replace(/^(?:.*\/)?sounds\//i, '')];
    sound.audioBuffer = typeof length === 'number' ? ({ duration: length / 1000 } as AudioBuffer) : null;
  }
}

function map(pack: UniPackData): Promise<AutoPlay> {
  return new Promise((resolve, reject) => autoPlayMap(pack.autoPlay!, pack.soundTable, {
    onStart() {}, onGetWorkSize() {}, onProgress() {}, onDone: resolve, onError: reject,
  }));
}

/** Writes elements back in autoPlay grammar, a press directly followed by its release as `t`. */
function script(elements: AutoPlayElement[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    if (e.type === 'delay') lines.push(`d ${e.delay}`);
    else if (e.type === 'chain') lines.push(`c ${e.c + 1}`);
    else if (e.type === 'off') lines.push(`off ${e.x + 1} ${e.y + 1}`);
    else {
      const next = elements[i + 1];
      const touch = next?.type === 'off' && next.x === e.x && next.y === e.y && next.currChain === e.currChain;
      lines.push(`${touch ? 't' : 'on'} ${e.x + 1} ${e.y + 1}`);
      if (touch) i++;
    }
  }
  return lines;
}

async function mapScript(keySound: string, autoPlay: string, lengthsMs: Record<string, number | null>): Promise<string[]> {
  const pack = await parse(keySound, autoPlay);
  setLengths(pack, lengthsMs);
  return script((await map(pack)).elements);
}

const SHARED_KEYS = '1 1 1 a.wav\n1 2 1 b.wav\n2 1 1 b.wav';

describe('auto mapping replaces waits with the length of the sound pressed before them', () => {
  test('keeps simultaneous presses together, starts after 1000 ms and drops the trailing wait', async () => {
    const keys = '1 1 1 a.wav\n1 2 1 a.wav\n1 3 1 a.wav';
    assert.deepEqual(await mapScript(keys, 'd 20\non 1 1\non 2 1\nd 50\non 3 1\nd 99', { 'a.wav': 400 }),
      ['d 1000', 't 1 1', 't 2 1', 'd 400', 't 3 1']);
  });

  test('merges consecutive waits and replaces them once with the last pressed sound', async () => {
    assert.deepEqual(await mapScript(SHARED_KEYS, 'd 80\non 1 1\non 2 1\nd 20\nd 30\non 1 1\nd 999', { 'a.wav': 400.4, 'b.wav': 400.5 }),
      ['d 1000', 't 1 1', 't 2 1', 'd 401', 't 1 1']);
  });

  test('keeps the original wait when the sound length is unknown instead of using 0', async () => {
    assert.deepEqual(await mapScript(SHARED_KEYS, 'on 1 1\nd 30\nd 40\non 2 1\nd 999', { 'a.wav': null, 'b.wav': 900 }),
      ['d 1000', 't 1 1', 'd 70', 't 2 1']);
  });

  test('keeps the original wait after a pad that has no sound', async () => {
    assert.deepEqual(await mapScript(SHARED_KEYS, 'on 3 3\nd 25\non 1 1', { 'a.wav': 300, 'b.wav': 500 }),
      ['d 1000', 't 3 3', 'd 25', 't 1 1']);
  });

  test('rounds lengths to the nearest millisecond, an exact half up', async () => {
    assert.deepEqual(await mapScript(SHARED_KEYS, 'on 1 1\nd 80\non 2 1', { 'a.wav': 400.4, 'b.wav': 900 }),
      ['d 1000', 't 1 1', 'd 400', 't 2 1']);
    assert.deepEqual(await mapScript(SHARED_KEYS, 'on 1 1\nd 80\non 2 1', { 'a.wav': 400.5, 'b.wav': 900 }),
      ['d 1000', 't 1 1', 'd 401', 't 2 1']);
  });

  test('keeps the chain order and uses the sound of the chain the pad was pressed in', async () => {
    const pack = await parse(SHARED_KEYS, 'on 1 1\nd 50\nc 2\non 1 1\nd 50\non 1 1');
    setLengths(pack, { 'a.wav': 300, 'b.wav': 500 });
    const mapped = (await map(pack)).elements;
    assert.deepEqual(script(mapped), ['d 1000', 't 1 1', 'd 300', 'c 2', 't 1 1', 'd 500', 't 1 1']);
    assert.deepEqual(mapped.filter((e) => e.type === 'on').map((e) => [e.currChain, e.num]), [[0, 0], [1, 0], [1, 1]]);
  });

  test('follows the order of a pad\'s sounds', async () => {
    assert.deepEqual(await mapScript('1 1 1 a.wav\n1 1 1 b.wav', 'on 1 1\nd 10\non 1 1\nd 10\non 1 1', { 'a.wav': 300, 'b.wav': 500 }),
      ['d 1000', 't 1 1', 'd 300', 't 1 1', 'd 500', 't 1 1']);
  });

  test('turns a held press into a press and release, so no pad stays held', async () => {
    assert.deepEqual(await mapScript(SHARED_KEYS, 'on 1 1\nd 100\noff 1 1\nd 50\non 2 1\nd 10', { 'a.wav': 300, 'b.wav': 500 }),
      ['d 1000', 't 1 1', 'd 300', 't 2 1']);
  });

  test('does not change the autoPlay it maps', async () => {
    const pack = await parse(SHARED_KEYS, 'd 20\non 1 1\nd 30\non 2 1');
    setLengths(pack, { 'a.wav': 300, 'b.wav': 500 });
    const before = JSON.stringify(pack.autoPlay);
    await map(pack);
    assert.equal(JSON.stringify(pack.autoPlay), before);
  });
});

function timed(autoPlay: AutoPlay) {
  let time = 0;
  return autoPlay.elements.flatMap(element => {
    if (element.type === 'delay') { time += element.delay; return []; }
    return [{ time, ...element }];
  });
}

for (const length of [50, 100, 300, 500, 800]) test(`mapping keeps wormholes 100 ms after their press with a ${length} ms sound`, async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n2 1 2 a.wav', 'd 1000\ntouch 1 1\nd 500\ntouch 1 2\nd 500\ntouch 1 2');
  setLengths(pack, { 'a.wav': length });
  const original = structuredClone(pack.autoPlay);
  const mapped = timed(await map(pack));
  assert.deepEqual(mapped.filter(e => e.type === 'on').map(e => e.time), [1000, 1000 + length, 1000 + length + (length < 100 ? 500 : length)]);
  assert.equal(mapped.find(e => e.type === 'chain')?.time, 1100);
  assert.deepEqual(pack.autoPlay, original);
});

test('mapping preserves queued wormhole order and flushes the tail without adding song time', async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n1 1 2 b.wav 1 1\n2 1 2 b.wav 1 1', 'd 1000\ntouch 1 1\nd 50\ntouch 1 2\nd 450\ntouch 1 1');
  setLengths(pack, { 'a.wav': 200, 'b.wav': 400 });
  const mapped = timed(await map(pack));
  assert.deepEqual(mapped.filter(e => e.type === 'chain').map(e => [e.time, e.c]), [[1100, 1], [1300, 0], [1600, 1]]);
  assert.deepEqual(mapped.filter(e => e.type === 'on').map(e => e.time), [1000, 1200, 1600]);
});

test('mapping keeps explicit chain cancellation and remains stable on a second mapping', async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n1 1 2 b.wav', 'd 1000\ntouch 1 1\nd 50\nc 1\nd 450\ntouch 1 2');
  setLengths(pack, { 'a.wav': 300, 'b.wav': 500 });
  const first = await map(pack);
  assert.deepEqual(timed(first).filter(e => e.type === 'chain').map(e => [e.time, e.c]), [[1300, 0]]);
  pack.autoPlay = first;
  assert.deepEqual(await map(pack), first);
});

test('mapping a mapped delayed wormhole keeps its original relative deadline', async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n2 1 2 a.wav', 'd 1000\ntouch 1 1\nd 500\ntouch 1 2');
  setLengths(pack, { 'a.wav': 500 });
  const first = await map(pack);
  pack.autoPlay = first;
  assert.deepEqual(await map(pack), first);
});

test('a mapped explicit chain selection cancels a wormhole whose new deadline follows it', async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n1 1 2 b.wav', 'd 1000\ntouch 1 1\nd 500\nc 1\ntouch 1 2\nd 500\ntouch 1 2');
  setLengths(pack, { 'a.wav': 50, 'b.wav': 500 });
  const mapped = timed(await map(pack));
  assert.deepEqual(mapped.filter(e => e.type === 'chain').map(e => [e.time, e.c]), [[1050, 0]]);
  assert.deepEqual(mapped.filter(e => e.type === 'on').map(e => e.time), [1000, 1050, 1550]);
});

test('retiming a wormhole preserves a negative wait and its authored press order', async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n1 1 2 b.wav', 'd 1000\ntouch 1 1\nd -50\ntouch 1 2\nd 500\ntouch 1 2');
  setLengths(pack, { 'a.wav': null, 'b.wav': 500 });
  const mapped = timed(await map(pack));
  assert.deepEqual(mapped.filter(e => e.type === 'on').map(e => [e.time, e.y]), [[1000, 0], [950, 1], [1450, 1]]);
  assert.deepEqual(mapped.filter(e => e.type === 'chain').map(e => [e.time, e.c]), [[1100, 1]]);
});

for (const length of [50, 99, 100, 101, 800]) test(`mapped playback selects the actual chain and queue with a ${length} ms sound`, async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n1 1 2 c.wav\n1 1 2 a.wav\n2 1 2 b.wav',
    'd 1000\ntouch 1 1\nd 500\ntouch 1 2\nd 500\ntouch 1 2');
  setLengths(pack, { 'a.wav': length, 'b.wav': 500, 'c.wav': 200 });
  pack.autoPlay = await map(pack);
  // Saved arrays must play the same way after serialization, without parser-only state.
  pack.autoPlay = JSON.parse(JSON.stringify(pack.autoPlay));
  const presses = timed(pack.autoPlay!).filter(e => e.type === 'on');
  const early = length < 100;
  assert.deepEqual(presses.map(e => [e.time, e.currChain, e.num]),
    [[1000, 0, 0], [1000 + length, early ? 0 : 1, 0], [1000 + length + (early ? 200 : 500), 1, early ? 0 : 1]]);
  assert.deepEqual(timed(pack.autoPlay!).filter(e => e.type === 'off').map(e => e.currChain), [0, early ? 0 : 1, 1]);
  const clock = new ManualClock(); clock.install();
  let chain = 0;
  const events: [number, number][] = [], queues: number[] = [], files: string[] = [];
  const started = clock.now;
  const runner = new AutoPlayRunner(pack, {
    onStart() {}, onEnd() {}, onProgressUpdate() {}, onGuideLedUpdate() {}, onGuideChainOn() {},
    onGuidePadOn() {}, onGuidePadOff() {}, onRemoveGuide() {}, onPadTouchOff() {},
    onChainChange(c) { chain = c; events.push([clock.now - started, c]); },
    onPadTouchOn(x, y) { files.push(pack.soundTable[chain][x][y]![queues.at(-1)! % pack.soundTable[chain][x][y]!.length].file); },
  }, () => chain, () => {}, (_c, _x, _y, n) => { queues.push(n); }, () => {});
  try {
    runner.launch(); for (let i = 0; i < 3000; i++) clock.tick(1);
    assert.equal(events.some(([time, c]) => time < 1100 && c === 1), false);
    assert.deepEqual(files.map(f => f.split('/').at(-1)), ['a.wav', early ? 'c.wav' : 'b.wav', 'b.wav']);
  } finally { runner.stop(); clock.uninstall(); }
});

test('a shortened mapped wait can leave the next pad silent until the wormhole is due', async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n2 1 2 b.wav', 'd 1000\ntouch 1 1\nd 500\ntouch 1 2\nd 500\ntouch 1 2');
  setLengths(pack, { 'a.wav': 50, 'b.wav': 500 });
  const mapped = timed(await map(pack));
  assert.deepEqual(mapped.filter(e => e.type === 'on').map(e => [e.time, e.currChain, e.num]), [[1000, 0, 0], [1050, 0, 0], [1550, 1, 0]]);
});

for (const wait of [0, 50, 100, 101]) test(`mapping retains explicit same-destination then different-destination tail at ${wait} ms`, async () => {
  const pack = await parseUniPack(await packZip({ info: INFO.replace('chain=2', 'chain=3'),
    keySound: '1 1 1 a.wav 1 2', 'sounds/a.wav': SILENT_WAV,
    autoPlay: `d 1000\ntouch 1 1\nd ${wait}\nc 2\nc 3`,
  }));
  setLengths(pack, { 'a.wav': 50 });
  assert.equal(pack.errors.length, 0);
  const mapped = await map(pack);
  assert.deepEqual(mapped.elements.filter(e => e.type === 'chain').map(e => e.c), [1, 2]);
  pack.autoPlay = mapped;
  assert.deepEqual(await map(pack), mapped);
});

test('old serialized explicit tail selections are preserved when remapped', async () => {
  const pack = await parseUniPack(await packZip({ info: INFO.replace('chain=2', 'chain=3'),
    keySound: '1 1 1 a.wav 1 2', 'sounds/a.wav': SILENT_WAV,
    autoPlay: 'd 1000\ntouch 1 1\nd 50\nc 2\nc 3',
  }));
  setLengths(pack, { 'a.wav': 50 });
  pack.autoPlay = JSON.parse(JSON.stringify(pack.autoPlay));
  assert.deepEqual((await map(pack)).elements.filter(e => e.type === 'chain').map(e => e.c), [1, 2]);
});

for (const length of [50, 100, 800]) test(`saved mapped wormholes can be remapped with a ${length} ms sound`, async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n2 1 2 b.wav', 'd 1000\ntouch 1 1\nd 500\ntouch 1 2\nd 500\ntouch 1 2');
  setLengths(pack, { 'a.wav': length, 'b.wav': 500 });
  const mapped = await map(pack);
  pack.autoPlay = JSON.parse(JSON.stringify(mapped));
  assert.deepEqual(await map(pack), mapped);
});

for (const source of [
  'touch 1 1\nd 50\ntouch 1 2\nc 2',
  'd 1000\ntouch 1 1\nd 50\nc 2\nd 450\ntouch 1 2',
]) test(`serialized remapping preserves authored same-destination selections: ${source}`, async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n1 1 2 b.wav', source);
  setLengths(pack, { 'a.wav': source.startsWith('d') ? 500 : 300, 'b.wav': 300 });
  const first = await map(pack);
  pack.autoPlay = first;
  assert.deepEqual(await map(pack), first);
  pack.autoPlay = JSON.parse(JSON.stringify(first));
  assert.deepEqual(await map(pack), first);
});

test('a new sound selected on the mapped chain gets its own wormhole despite the old sound cancellation', async () => {
  const pack = await parseUniPack(await packZip({ info: INFO.replace('chain=2', 'chain=4'),
    keySound: '1 1 1 a.wav 1 2\n1 1 2 b.wav 1 4\n2 1 2 b.wav 1 3',
    'sounds/a.wav': SILENT_WAV, 'sounds/b.wav': SILENT_WAV,
    autoPlay: 'touch 1 1\nd 150\ntouch 1 2\nd 50\nc 1\ntouch 2 1',
  }));
  setLengths(pack, { 'a.wav': 50, 'b.wav': 300 });
  const mapped = timed(await map(pack));
  assert.deepEqual(mapped.filter(e => e.type === 'chain').map(e => [e.time, e.c]), [[1100, 1], [1150, 3], [1350, 0]]);
});

test('saving and restoring the parsed backup retains exact chain provenance without changing the parser array', async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n1 1 2 b.wav', 'touch 1 1\nd 50\ntouch 1 2\nc 2');
  setLengths(pack, { 'a.wav': 300, 'b.wav': 300 });
  const original = structuredClone(pack.autoPlay);
  const expected = await map(pack);
  const saved = JSON.parse(JSON.stringify(saveChainOrigins(pack.autoPlay!.elements)));
  assert.deepEqual(pack.autoPlay, original);
  assert.equal(saved.find((e: AutoPlayElement) => e.type === 'chain').fromSound, false);
  pack.autoPlay = { elements: saved };
  assert.deepEqual(await map(pack), expected);
});

test('an old unmarked custom tail remains an authored selection rather than a guessed wormhole', async () => {
  const pack = await parse('1 1 1 a.wav 1 2\n1 1 2 b.wav', 'touch 1 1\nd 50\ntouch 1 2\nc 2');
  setLengths(pack, { 'a.wav': 300, 'b.wav': 300 });
  const first = await map(pack);
  const old = JSON.parse(JSON.stringify(first)) as AutoPlay;
  for (const e of old.elements) if (e.type === 'chain') delete e.fromSound;
  pack.autoPlay = old;
  assert.deepEqual(script((await map(pack)).elements), script(first.elements));
  assert.deepEqual(pack.autoPlay, old);
});
