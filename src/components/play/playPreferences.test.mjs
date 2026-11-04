import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.requestAnimationFrame = globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
window.cancelAnimationFrame = globalThis.cancelAnimationFrame = clearTimeout;
const { renderHook, cleanup, act, waitFor } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let storage, writes, read, sounds;
const real = require('../../lib/unipack/index.ts');
// Run the real parser, runners, channels and hook. Only device I/O and storage are replaced.
stub('../../lib/unipack/index.ts', { ...real,
  getSetting: key => read(key),
  setSetting: async (key, value) => { writes.push([key, value]); storage.set(key, value); },
  SoundEngine: class {
    context = { state: 'running' };
    constructor(_unipack, getChain) { this.getChain = getChain; sounds.engine = this; }
    async setSuspended(suspended) { this.context.state = suspended ? 'suspended' : 'running'; }
    async load() { return { usedFiles: 0, loadedFiles: 0, failures: [], reservedCost: 0n }; }
    setVolume(level) { sounds.volume = level; }
    soundOn(x, y) { sounds.played.push(`chain ${this.getChain() + 1} pad ${x},${y}`); }
    soundPushToNum() {} soundOff() {} stopAll() {} destroy() {} resume() {} cancelPendingChainChanges() {}
  },
  MidiConnection: class {
    async connect() { return false; }
    getStatus() { return { connected: false, requestedProfile: 'auto', resolvedProfile: 'none', inputName: null, outputName: null }; }
    release() {} sendPadLed() {} sendChainLed() {} sendFunctionKeyLed() {} clearAllLeds() {}
  },
});
stub('../../lib/analytics/logAnalyticsEvent.ts', { logAnalyticsEvent() {} });
const { useUniPadEngine } = require('./useUniPadEngine.ts');
afterEach(cleanup);
const flush = async action => act(async () => { await action?.(); await new Promise(resolve => setTimeout(resolve, 5)); });
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: value => resolve(value) }; };

async function pack({ keyLedExist = true, autoPlay = 'd 10000\no 1 1\nf 1 1\n'.repeat(20) } = {}) {
  const zip = await JSZip.loadAsync(readFileSync(new URL('../../../e2e/fixtures/basic.uni', import.meta.url)));
  zip.file('autoPlay', autoPlay);
  if (!keyLedExist) zip.remove('keyLED');
  // A second chain, so a chain change can be heard.
  zip.file('info', (await zip.file('info').async('text')).replace('chain=1', 'chain=2'));
  zip.file('keySound', `${await zip.file('keySound').async('text')}\n2 1 1 tone.wav 0\n`);
  return zip.generateAsync({ type: 'arraybuffer' });
}
/** A fresh hook is a fresh visit: what it reads comes only from the saved settings. */
function start(saved = {}, keepStorage = false) {
  if (!keepStorage) storage = new Map(Object.entries(saved));
  writes = []; sounds = { played: [], volume: null };
  read = async key => storage.get(key) ?? null;
  return renderHook(useUniPadEngine).result;
}
async function open(result, options) {
  const data = await pack(options);
  await flush(() => result.current.loadUniPack(data));
  assert.equal(result.current.state.loaded, true);
}
async function pressLight(result) {
  await flush(() => result.current.padTouchOn(2, 2));
  const lit = result.current.state.padStates[2][2].pressedIsWinning;
  await flush(() => result.current.padTouchOff(2, 2));
  return lit;
}
const traceOf = (result, chain = 0) => result.current.state.traceLogSequence[chain].map(({ x, y }) => `${x},${y}`);

// Press light: each pack opens with its own rule, whatever was chosen before.

for (const saved of [null, 'true', 'false']) {
  test(`press light follows the pack on opening and after auto-play, not an old choice (saved ${saved})`, async () => {
    const result = start(saved === null ? {} : { feedbackLight: saved });
    for (const keyLedExist of [true, false, true]) {
      await flush(() => result.current.unload());
      await open(result, { keyLedExist, autoPlay: 'd 20\no 1 1\nf 1 1\n' });
      assert.equal(result.current.state.feedbackLight, !keyLedExist);
      assert.equal(await pressLight(result), !keyLedExist);
      // A direct choice holds while this pack plays.
      await flush(() => result.current.toggleFeedbackLight());
      assert.equal(await pressLight(result), keyLedExist);
      await flush(() => result.current.switchPlayMode('autoPlay'));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
      await waitFor(() => assert.equal(result.current.playMode, 'none'));
      assert.equal(result.current.state.feedbackLight, !keyLedExist, 'auto-play end goes back to the pack rule');
      assert.equal(await pressLight(result), !keyLedExist);
    }
    assert.deepEqual(writes.filter(([key]) => key === 'feedbackLight'), []);
  });
}

test('leaving auto-play by hand also goes back to the pack rule', async () => {
  const result = start({ feedbackLight: 'true' });
  await open(result, { keyLedExist: true });
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await flush(() => result.current.toggleFeedbackLight());
  assert.equal(await pressLight(result), true);
  await flush(() => result.current.switchPlayMode('autoPlay'));
  assert.equal(result.current.playMode, 'none');
  assert.equal(await pressLight(result), false);
});

// Volume and watermark: the last choice is kept, and opening a pack never raises the volume.

test('a lowered volume is read before the pack can play', async () => {
  const result = start({ volumeLevel: '2' });
  const pending = deferred();
  read = key => key === 'volumeLevel' ? pending.promise : Promise.resolve(storage.get(key) ?? null);
  const data = await pack();
  let loading;
  await flush(() => { loading = result.current.loadUniPack(data); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  assert.equal(result.current.state.loaded, false, 'nothing may play before the saved volume is known');
  await flush(async () => { pending.resolve('2'); await loading; });
  assert.equal(result.current.state.loaded, true);
  assert.equal(result.current.state.volumeLevel, 2);
  assert.equal(sounds.volume, 2);
});

test('volume and watermark choices survive another pack and a new visit', async () => {
  let result = start({ volumeLevel: '2', watermark: 'false' });
  await open(result);
  assert.equal(result.current.state.volumeLevel, 2);
  assert.equal(result.current.state.watermark, false);
  await flush(() => result.current.setVolumeLevel(1));
  await flush(() => result.current.toggleWatermark());
  assert.deepEqual(writes, [['volumeLevel', '1'], ['watermark', 'true']]);
  await flush(() => result.current.unload());
  await open(result, { keyLedExist: false });
  assert.equal(result.current.state.volumeLevel, 1);
  assert.equal(sounds.volume, 1);
  assert.equal(result.current.state.watermark, true);
  cleanup();
  result = start({}, true);
  await open(result);
  assert.equal(result.current.state.volumeLevel, 1);
  assert.equal(sounds.volume, 1);
  assert.equal(result.current.state.watermark, true);
  assert.deepEqual(writes, []);
});

test('without saved choices the volume is 7 and the watermark is on, and nothing is saved', async () => {
  const result = start();
  await open(result);
  assert.equal(result.current.state.volumeLevel, 7);
  assert.equal(sounds.volume, 7);
  assert.equal(result.current.state.watermark, true);
  await flush(() => result.current.unload());
  await open(result);
  assert.deepEqual(writes, []);
});

test('a read that fails keeps the defaults, and the player still opens', async () => {
  const result = start({ volumeLevel: '2' });
  read = async () => { throw new Error('storage unavailable'); };
  await open(result);
  assert.equal(result.current.state.volumeLevel, 7);
  assert.equal(storage.get('volumeLevel'), '2');
  assert.deepEqual(writes, []);
});

test('a late read does not replace a choice made before it arrived', async () => {
  const result = start({ volumeLevel: '2', watermark: 'true', traceLogStyle: 'numbers', slideMode: 'false' });
  const pending = deferred();
  read = () => pending.promise;
  const data = await pack();
  let loading;
  await flush(() => { loading = result.current.loadUniPack(data); });
  try {
    await flush(() => {
      result.current.setVolumeLevel(5);
      result.current.toggleWatermark();
      result.current.setTraceLogStyle('lines');
      result.current.setSlideMode(true);
    });
  } finally {
    await flush(async () => { pending.resolve(null); await loading; });
  }
  assert.equal(result.current.state.volumeLevel, 5);
  assert.equal(sounds.volume, 5);
  assert.equal(result.current.state.watermark, false);
  assert.equal(result.current.state.traceLogStyle, 'lines');
  assert.equal(result.current.state.slideMode, true);
});

// Slide setting: off unless the player chose it.

for (const [saved, expected] of [[undefined, false], ['true', true], ['false', false]]) {
  test(`slide across pads reads ${saved ?? 'nothing'} as ${expected}`, async () => {
    const result = start(saved === undefined ? {} : { slideMode: saved });
    await open(result);
    assert.equal(result.current.state.slideMode, expected);
    await flush(() => result.current.setSlideMode(!expected));
    assert.deepEqual(writes, [['slideMode', String(!expected)]]);
    cleanup();
    const again = start({}, true);
    await open(again);
    assert.equal(again.current.state.slideMode, !expected);
  });
}

// Chain buttons change the chain at the press.

test('a pad hit while the chain button is still held plays the new chain', async () => {
  const result = start();
  await open(result);
  await flush(() => result.current.setChain(1));
  await flush(() => result.current.padTouchOn(0, 0, 'pointer-2'));
  await flush(() => result.current.padTouchOff(0, 0, 'pointer-2'));
  assert.equal(result.current.state.chain, 1);
  assert.deepEqual(sounds.played, ['chain 2 pad 0,0']);
});

// Trace: numbers by default, stopping keeps what is drawn, clearing empties every chain.

for (const [saved, expected] of [[undefined, 'numbers'], ['numbers', 'numbers'], ['lines', 'lines']]) {
  test(`trace style reads ${saved ?? 'nothing'} as ${expected} and keeps a new choice`, async () => {
    const result = start(saved === undefined ? {} : { traceLogStyle: saved });
    await open(result);
    assert.equal(result.current.state.traceLogStyle, expected);
    const next = expected === 'numbers' ? 'lines' : 'numbers';
    await flush(() => result.current.setTraceLogStyle(next));
    assert.deepEqual(writes, [['traceLogStyle', next]]);
    cleanup();
    const again = start({}, true);
    await open(again);
    assert.equal(again.current.state.traceLogStyle, next);
  });
}

test('stopping the trace keeps its order and later presses are not added until it is on again', async () => {
  const result = start();
  await open(result);
  assert.equal(result.current.state.traceLog, false);
  await flush(() => result.current.padTouchOn(7, 7));
  assert.deepEqual(traceOf(result), [], 'nothing is recorded before the trace is turned on');
  await flush(() => result.current.toggleTraceLog());
  for (const [x, y] of [[0, 0], [0, 1], [0, 0]]) await flush(() => result.current.padTouchOn(x, y));
  await flush(() => result.current.toggleTraceLog());
  await flush(() => result.current.padTouchOn(0, 2));
  assert.equal(result.current.state.traceLog, false);
  assert.deepEqual(traceOf(result), ['0,0', '0,1', '0,0']);
  await flush(() => result.current.toggleProLightMode());
  await flush(() => result.current.toggleHideUI());
  await flush(() => result.current.setTraceLogStyle('lines'));
  await flush(() => result.current.setTraceLogStyle('numbers'));
  assert.deepEqual(traceOf(result), ['0,0', '0,1', '0,0']);
  await flush(() => result.current.toggleTraceLog());
  await flush(() => result.current.padTouchOn(0, 3));
  assert.deepEqual(traceOf(result), ['0,0', '0,1', '0,0', '0,3']);
});

test('clearing the trace empties every chain and keeps recording as it was', async () => {
  const result = start();
  await open(result);
  await flush(() => result.current.toggleTraceLog());
  await flush(() => result.current.padTouchOn(0, 0));
  await flush(() => result.current.setChain(1));
  await flush(() => result.current.padTouchOn(1, 1));
  await flush(() => result.current.clearTraceLog());
  assert.deepEqual(traceOf(result, 0), []);
  assert.deepEqual(traceOf(result, 1), []);
  assert.equal(result.current.state.traceLog, true);
  await flush(() => result.current.padTouchOn(2, 2));
  assert.deepEqual(traceOf(result, 1), ['2,2']);
});

test('a pack opened again starts with an empty trace that is not recording', async () => {
  const result = start();
  await open(result);
  await flush(() => result.current.toggleTraceLog());
  await flush(() => result.current.padTouchOn(0, 0));
  await flush(() => result.current.unload());
  await open(result);
  assert.equal(result.current.state.traceLog, false);
  assert.deepEqual(traceOf(result), []);
});
