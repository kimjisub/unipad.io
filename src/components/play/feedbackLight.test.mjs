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
let storage, writes, read;
const real = require('../../lib/unipack/index.ts');
// Run the real parser, runners, channels and hook. Only device I/O and storage are replaced.
stub('../../lib/unipack/index.ts', { ...real,
  getSetting: key => read(key),
  setSetting: async (key, value) => { writes.push([key, value]); storage.set(key, value); },
  SoundEngine: class {
    context = { state: 'running' };
    async setSuspended(suspended) { this.context.state = suspended ? 'suspended' : 'running'; }
    async load() { return []; }
    setVolume() {} soundPushToNum() {} soundOn() {} soundOff() {} stopAll() {} destroy() {} resume() {}
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

async function pack(keyLedExist, autoPlay = 'd 10000\no 1 1\nf 1 1\n'.repeat(20)) {
  const zip = await JSZip.loadAsync(readFileSync(new URL('../../../e2e/fixtures/basic.uni', import.meta.url)));
  zip.file('autoPlay', autoPlay);
  if (!keyLedExist) zip.remove('keyLED');
  return zip.generateAsync({ type: 'arraybuffer' });
}
async function mount(saved = null) {
  storage = new Map(saved === null ? [] : [['feedbackLight', saved]]); writes = [];
  read = async key => storage.get(key) ?? null;
  return renderHook(useUniPadEngine).result;
}
async function open(result, leds, autoPlay) {
  const data = await pack(leds, autoPlay);
  await flush(() => result.current.loadUniPack(data));
  assert.equal(result.current.state.loaded, true);
}
async function expectFeedback(result, enabled) {
  assert.equal(result.current.state.feedbackLight, enabled);
  await flush(() => result.current.padTouchOn(2, 2));
  await waitFor(() => assert.equal(result.current.state.padStates[2][2].pressedIsWinning, enabled));
  await flush(() => result.current.padTouchOff(2, 2));
}

for (const leds of [true, false]) for (const saved of [null, 'true', 'false']) {
  test(`only explicit feedback choices persist: LEDs ${leds}, saved ${saved}`, async () => {
    const result = await mount(saved);
    await open(result, leds);
    const preference = saved === null ? !leds : saved === 'true';
    await expectFeedback(result, preference);
    assert.deepEqual(writes, []);
    for (const mode of ['autoPlay', 'guidePlay', 'stepPractice']) {
      await flush(() => result.current.switchPlayMode(mode));
      await expectFeedback(result, !leds);
      await flush(() => result.current.toggleFeedbackLight());
      await expectFeedback(result, leds);
      assert.equal(storage.get('feedbackLight'), String(leds));
      await flush(() => result.current.switchPlayMode(mode));
      await expectFeedback(result, leds);
    }
    assert.equal(writes.length, 3);
  });
  test(`mode changes and pause preserve preference: LEDs ${leds}, saved ${saved}`, async () => {
    const result = await mount(saved);
    await open(result, leds);
    for (const mode of ['autoPlay', 'guidePlay', 'stepPractice', 'autoPlay']) {
      await flush(() => result.current.switchPlayMode(mode));
      await expectFeedback(result, !leds);
    }
    await flush(() => result.current.toggleFeedbackLight());
    await flush(() => result.current.autoPlayPlayPause());
    await expectFeedback(result, leds); // pause is not exit
    await flush(() => result.current.autoPlayPlayPause());
    await expectFeedback(result, !leds); // restart keeps its temporary behaviour
    await flush(() => result.current.switchPlayMode('autoPlay'));
    await expectFeedback(result, leds);
    assert.deepEqual(writes, [['feedbackLight', String(leds)]]);
  });
  test(`natural end restores preference: LEDs ${leds}, saved ${saved}`, async () => {
    const result = await mount(saved);
    await open(result, leds, 'd 20\no 1 1\nf 1 1\n');
    await flush(() => result.current.switchPlayMode('autoPlay'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    await waitFor(() => assert.equal(result.current.playMode, 'none'));
    await expectFeedback(result, saved === null ? !leds : saved === 'true');
    assert.deepEqual(writes, []);
  });
}

test('packs without a preference keep their own defaults in either order', async () => {
  const result = await mount();
  for (const leds of [true, false, true]) {
    await flush(() => result.current.unload());
    await open(result, leds);
    await expectFeedback(result, !leds);
  }
  assert.deepEqual(writes, []);
  assert.equal(storage.has('feedbackLight'), false);
});

test('natural completion restores the choice made while playing', async () => {
  const result = await mount('false');
  await open(result, true, 'd 100\no 1 1\nf 1 1\n');
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await flush(() => result.current.toggleFeedbackLight());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  await waitFor(() => assert.equal(result.current.playMode, 'none'));
  await expectFeedback(result, true);
  assert.deepEqual(writes, [['feedbackLight', 'true']]);
});

test('late reads cannot overwrite a direct choice or its end-of-mode restoration', async () => {
  const result = await mount('false');
  const pending = deferred(); read = () => pending.promise;
  await open(result, true);
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await flush(() => result.current.toggleFeedbackLight());
  await flush(() => pending.resolve('false'));
  await expectFeedback(result, true);
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await expectFeedback(result, true);
  assert.equal(storage.get('feedbackLight'), 'true');
});

test('a restored preference waits until mode exit to replace the temporary value', async () => {
  const result = await mount('true');
  const pending = deferred(); read = () => pending.promise;
  await open(result, true);
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await flush(() => pending.resolve('true'));
  await expectFeedback(result, false);
  await flush(() => result.current.switchPlayMode('autoPlay'));
  await expectFeedback(result, true);
  assert.deepEqual(writes, []);
});

test('reopening a pack keeps the direct choice even if a new read would return an old write', async () => {
  const result = await mount('false');
  await open(result, true);
  await flush(() => result.current.setFeedbackLight(true));
  read = async () => 'false';
  await flush(() => result.current.unload());
  await open(result, true);
  await expectFeedback(result, true);
});

test('failed and abandoned reads never write defaults or replace the next pack choice', async () => {
  const result = await mount('true');
  read = async () => { throw new Error('storage unavailable'); };
  await open(result, true);
  assert.equal(storage.get('feedbackLight'), 'true');
  const pending = deferred(); read = () => pending.promise;
  await flush(() => result.current.unload());
  await open(result, true);
  await flush(() => result.current.unload());
  read = async () => 'false';
  await open(result, false);
  await flush(() => pending.resolve('true'));
  await expectFeedback(result, false);
  assert.deepEqual(writes, []);
});
