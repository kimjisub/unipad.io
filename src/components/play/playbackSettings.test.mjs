import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'SVGElement', 'screen']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const React = await import('react');
const { render, cleanup, act } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const noop = () => {};
const translate = key => key;
stub('next-intl', { useTranslations: () => translate });
stub('framer-motion', { AnimatePresence: ({ children }) => children, motion: { div: 'div' } });
// Keep PlayPage's real effects; replace rendering and external services at their boundaries.
for (const name of ['PadGrid', 'ChainBar', 'ControlPanel', 'OptionPanel', 'MainScreen', 'StoreModal', 'SkinImage', 'LaunchpadSettingsModal']) {
  stub(`./${name}.tsx`, { [name]: () => null, ConfirmDialog: () => null });
}
stub('../../lib/store.ts', { subscribeStoreCount: async () => noop });
stub('../../lib/analytics/logAnalyticsEvent.ts', { logAnalyticsEvent: noop });
let storage;
let pendingReads;
let failedReads;
let writes;
stub('../../lib/unipack/index.ts', {
  listUniPacks: async () => [], listThemes: async () => [],
  getSetting: async key => {
    if (failedReads.has(key)) throw new Error('storage unavailable');
    const value = storage.get(key) ?? null;
    if (pendingReads && ['volumeLevel', 'feedbackLight', 'watermark'].includes(key)) await pendingReads.promise;
    return value;
  },
  setSetting: async (key, value) => { writes.push([key, value]); storage.set(key, value); },
});
let engine;
function useTestEngine() {
  const [state, setState] = React.useState({
    loaded: false, loading: false, errors: [], feedbackLight: true, watermark: true, volumeLevel: 7,
    unipack: null, padStates: [], chainStates: [], traceLogSequence: [], theme: { images: {}, colors: {} },
  });
  const update = React.useCallback((key, value) => setState(prev => ({ ...prev, [key]: value })), []);
  const setFeedbackLight = React.useCallback(value => update('feedbackLight', value), [update]);
  const setWatermark = React.useCallback(value => update('watermark', value), [update]);
  const setVolumeLevel = React.useCallback(value => update('volumeLevel', value), [update]);
  const toggleFeedbackLight = React.useCallback(() => setState(prev => ({ ...prev, feedbackLight: !prev.feedbackLight })), []);
  const toggleWatermark = React.useCallback(() => setState(prev => ({ ...prev, watermark: !prev.watermark })), []);
  engine = { state, update, open: keyLedExist => setState(prev => ({ ...prev, loaded: true,
    unipack: { keyLedExist, info: { buttonX: 8, buttonY: 8, chain: 1, title: 'Test pack' } }, feedbackLight: !keyLedExist })) };
  return { state, setFeedbackLight, setWatermark, setVolumeLevel, toggleFeedbackLight, toggleWatermark,
    setMidiProfile: noop, setMidiUiContext: noop, setKeyboardBlocked: noop };
}
stub('./useUniPadEngine.ts', { useUniPadEngine: useTestEngine });
const { PlayPage } = require('./PlayPage.tsx');
const flush = async action => act(async () => { action?.(); });
async function mount(values = {}) {
  storage = new Map(Object.entries(values)); writes = []; failedReads = new Set(); pendingReads = null;
  const view = render(React.createElement(PlayPage));
  await flush();
  return view;
}
afterEach(cleanup);

for (const keyLedExist of [true, false]) {
  for (const saved of [null, 'true', 'false']) {
    test(`restores feedback ${saved ?? 'default'} with pack LEDs ${keyLedExist}`, async () => {
      await mount(saved === null ? {} : { feedbackLight: saved });
      await flush(() => engine.open(keyLedExist));
      assert.equal(engine.state.feedbackLight, saved === null ? !keyLedExist : saved === 'true');
      assert.equal(storage.get('feedbackLight'), String(engine.state.feedbackLight));
    });
  }
}

test('waits for slow reads before saving feedback, watermark and volume', async () => {
  await mount({ feedbackLight: 'true', watermark: 'false', volumeLevel: '2' });
  let release;
  pendingReads = { promise: new Promise(resolve => { release = resolve; }) };
  await flush(() => engine.open(true));
  assert.deepEqual(writes, [], 'pack defaults must not overwrite pending saved settings');
  await flush(release);
  assert.equal(engine.state.feedbackLight, true);
  assert.equal(engine.state.watermark, false);
  assert.equal(engine.state.volumeLevel, 2);
  assert.deepEqual(Object.fromEntries(storage), { feedbackLight: 'true', watermark: 'false', volumeLevel: '2' });
});

test('reopening packs restores the latest user choices instead of pack defaults', async () => {
  await mount({ feedbackLight: 'false', watermark: 'false', volumeLevel: '2' });
  await flush(() => engine.open(true));
  await flush(() => { engine.update('feedbackLight', true); engine.update('watermark', true); engine.update('volumeLevel', 3); });
  await flush(() => engine.update('loaded', false));
  await flush(() => engine.open(true));
  assert.equal(engine.state.feedbackLight, true);
  assert.equal(engine.state.watermark, true);
  assert.equal(engine.state.volumeLevel, 3);
  assert.deepEqual(Object.fromEntries(storage), { feedbackLight: 'true', watermark: 'true', volumeLevel: '3' });
});

test('failed reads preserve unread settings and do not stop the player', async () => {
  await mount({ feedbackLight: 'true', watermark: 'false', volumeLevel: '2' });
  failedReads.add('feedbackLight');
  await flush(() => engine.open(true));
  assert.equal(engine.state.loaded, true);
  assert.equal(engine.state.watermark, false);
  assert.equal(engine.state.volumeLevel, 2);
  assert.equal(storage.get('feedbackLight'), 'true');
});

test('an abandoned pack read cannot overwrite the next pack', async () => {
  const view = await mount({ feedbackLight: 'false' });
  let release;
  pendingReads = { promise: new Promise(resolve => { release = resolve; }) };
  await flush(() => engine.open(true));
  await flush(() => engine.update('loaded', false));
  pendingReads = null;
  storage.set('feedbackLight', 'true');
  await flush(() => engine.open(false));
  await flush(release);
  assert.equal(engine.state.feedbackLight, true);
  view.unmount();
});
