import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'KeyboardEvent']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.requestAnimationFrame = globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
window.cancelAnimationFrame = globalThis.cancelAnimationFrame = clearTimeout;
const { renderHook, cleanup, act } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
// Reading an archive and decoding its audio each wait, in call order, on the steps a test holds.
// A step left unheld runs at once.
let held = { parse: [], decode: [] };
const step = async (kind, run) => {
  const waiting = held[kind].shift();
  if (waiting) { waiting.entered.resolve(); await waiting.promise; }
  return run();
};
const real = require('../../lib/unipack/index.ts');
stub('../../lib/unipack/index.ts', { ...real,
  parseUniPack: (...args) => step('parse', () => real.parseUniPack(...args)),
  getSetting: async () => null,
  setSetting: async () => {},
  SoundEngine: class {
    context = { state: 'running' };
    async setSuspended(suspended) { this.context.state = suspended ? 'suspended' : 'running'; }
    load() { return step('decode', () => []); }
    setVolume() {} soundPushToNum() {} soundOn() {} soundOff() {} stopAll() {} destroy() {} resume() {} cancelPendingChainChanges() {}
  },
  MidiConnection: class {
    async connect() { return false; }
    getStatus() { return { connected: false, requestedProfile: 'auto', resolvedProfile: 'none', inputName: null, outputName: null }; }
    release() {} sendPadLed() {} sendChainLed() {} sendFunctionKeyLed() {} clearAllLeds() {}
  },
});
stub('../../lib/analytics/logAnalyticsEvent.ts', { logAnalyticsEvent() {} });
const { useUniPadEngine } = require('./useUniPadEngine.ts');
afterEach(() => { held = { parse: [], decode: [] }; cleanup(); });
const flush = async action => act(async () => { await action?.(); await new Promise(resolve => setTimeout(resolve, 5)); });
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: () => resolve() }; };
const hold = kind => {
  const waiting = { ...deferred(), entered: deferred() };
  held[kind].push(waiting);
  return waiting;
};

async function pack(keyLedExist) {
  const zip = await JSZip.loadAsync(readFileSync(new URL('../../../e2e/fixtures/basic.uni', import.meta.url)));
  if (!keyLedExist) zip.remove('keyLED');
  return zip.generateAsync({ type: 'arraybuffer' });
}
const pressedPads = result => result.current.state.padStates.flat().filter(pad => pad.pressed).length;
const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code.slice(-1).toLowerCase() }));

test('a load replaced by a later one leaves the later pack playing from the keyboard', async () => {
  const { result } = renderHook(useUniPadEngine);
  const [first, second] = await Promise.all([pack(true), pack(false)]);
  const decoding = hold('decode');
  let firstLoad, secondLoad;
  await flush(() => { firstLoad = result.current.loadUniPack(first); return decoding.entered.promise; });
  const reading = hold('parse');
  await flush(() => { secondLoad = result.current.loadUniPack(second); return reading.entered.promise; });
  // The replaced load finishes while the later one still reads its archive, as when a pack is
  // opened twice in quick succession.
  await flush(() => { decoding.resolve(); return firstLoad; });
  await flush(() => { reading.resolve(); return secondLoad; });

  assert.equal(result.current.state.loaded, true);
  assert.equal(result.current.state.unipack.keyLedExist, false);
  await flush(() => key('keydown', 'KeyQ'));
  assert.equal(pressedPads(result), 1);
  await flush(() => key('keyup', 'KeyQ'));
  assert.equal(pressedPads(result), 0);
});

test('quitting while a pack loads leaves the player empty', async () => {
  const { result } = renderHook(useUniPadEngine);
  const data = await pack(true);
  const decoding = hold('decode');
  let load;
  await flush(() => { load = result.current.loadUniPack(data); return decoding.entered.promise; });
  await flush(() => { result.current.unload(); decoding.resolve(); });
  await flush(() => load);

  assert.equal(result.current.state.loaded, false);
  assert.equal(result.current.state.loading, false);
  assert.equal(result.current.state.unipack, null);
});
