import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { autoPlayMap } from './AutoPlayMapper';
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
