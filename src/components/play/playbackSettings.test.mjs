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
let gridProps;
let panelProps;
// Keep PlayPage's real effects; replace rendering and external services at their boundaries.
for (const name of ['ChainBar', 'ControlPanel', 'MainScreen', 'StoreModal', 'SkinImage', 'LaunchpadSettingsModal']) {
  stub(`./${name}.tsx`, { [name]: () => null, ConfirmDialog: () => null });
}
stub('./PadGrid.tsx', { PadGrid: props => { gridProps = props; return null; } });
stub('./OptionPanel.tsx', { OptionPanel: props => { panelProps = props; return null; } });
stub('../../lib/store.ts', { subscribeStoreCount: async () => noop });
stub('../../lib/analytics/logAnalyticsEvent.ts', { logAnalyticsEvent: noop });
let storage;
let writes;
stub('../../lib/unipack/index.ts', {
  listUniPacks: async () => [], listThemes: async () => [],
  getSetting: async key => storage.get(key) ?? null,
  setSetting: async (key, value) => { writes.push([key, value]); storage.set(key, value); },
});
let engine;
function useTestEngine() {
  const [state, setState] = React.useState({
    loaded: false, loading: false, errors: [], soundLoadReport: null, feedbackLight: true, watermark: true, volumeLevel: 7,
    slideMode: false, traceLog: false, traceLogStyle: 'numbers', chain: 0,
    unipack: null, padStates: [], chainStates: [], traceLogSequence: [], theme: { images: {}, colors: {} },
  });
  const update = React.useCallback((key, value) => setState(prev => ({ ...prev, [key]: value })), []);
  engine = { state, update, open: () => setState(prev => ({ ...prev, loaded: true,
    unipack: { keyLedExist: true, info: { buttonX: 8, buttonY: 8, chain: 2, title: 'Test pack', squareButton: true } } })) };
  const setVolumeLevel = React.useCallback(value => update('volumeLevel', value), [update]);
  const setWatermark = React.useCallback(value => update('watermark', value), [update]);
  return { state, setVolumeLevel, setWatermark, setMidiProfile: noop, setMidiUiContext: noop, setKeyboardBlocked: noop };
}
stub('./useUniPadEngine.ts', { useUniPadEngine: useTestEngine });
const { PlayPage } = require('./PlayPage.tsx');
const flush = async action => act(async () => { action?.(); });
async function mount() {
  storage = new Map([['feedbackLight', 'true'], ['watermark', 'false'], ['volumeLevel', '2']]); writes = [];
  gridProps = null; panelProps = null;
  const view = render(React.createElement(PlayPage));
  await flush();
  return view;
}
afterEach(cleanup);

test('the page leaves saved playing choices to the player and never writes them', async () => {
  await mount();
  await flush(() => engine.open());
  await flush(() => { engine.update('feedbackLight', false); engine.update('watermark', true); engine.update('volumeLevel', 5); });
  await flush(() => engine.update('loaded', false));
  await flush(() => engine.open());
  const playingKeys = new Set(['feedbackLight', 'watermark', 'volumeLevel', 'slideMode', 'traceLogStyle']);
  assert.deepEqual(writes.filter(([key]) => playingKeys.has(key)), []);
  assert.deepEqual(Object.fromEntries(storage), { feedbackLight: 'true', watermark: 'false', volumeLevel: '2' });
});

test('a stopped trace stays drawn, in the chosen style, for the chain on screen', async () => {
  await mount();
  await flush(() => engine.open());
  const chains = [[{ x: 0, y: 0 }, { x: 0, y: 1 }], [{ x: 3, y: 3 }]];
  await flush(() => { engine.update('traceLogSequence', chains); engine.update('traceLog', false); });
  assert.deepEqual(gridProps.traceLogSequence, chains[0]);
  assert.equal(gridProps.traceLogStyle, 'numbers');
  await flush(() => { engine.update('chain', 1); engine.update('traceLogStyle', 'lines'); });
  assert.deepEqual(gridProps.traceLogSequence, chains[1]);
  assert.equal(gridProps.traceLogStyle, 'lines');
  await flush(() => engine.update('hideUI', true));
  assert.deepEqual(gridProps.traceLogSequence, chains[1], 'hiding the controls lays the pads out again with the same trace');
});

test('the slide setting reaches the pads and the menu', async () => {
  await mount();
  await flush(() => engine.open());
  assert.equal(gridProps.slideMode, false);
  assert.equal(panelProps.slideMode, false);
  await flush(() => engine.update('slideMode', true));
  assert.equal(gridProps.slideMode, true);
  assert.equal(panelProps.slideMode, true);
});
