import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement } = await import('react');
const { render, cleanup, fireEvent } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let labels = 0;
let images = 0;
stub('next-intl', { useTranslations: () => key => { labels++; return key; } });
stub('./SkinImage.tsx', { SkinImage: props => { images++; return createElement('img', { ...props, alt: '' }); } });
const { ControlPanel } = require('./ControlPanel.tsx');
const { ChainBar } = require('./ChainBar.tsx');
afterEach(() => { cleanup(); labels = 0; images = 0; });

test('a pad-only redraw leaves unchanged transport controls alone and still updates progress and input', () => {
  let toggles = 0;
  const noop = () => {};
  const props = {
    squareButton: true, keyLedExist: true, feedbackLight: true, ledEnabled: true,
    autoPlayControlsVisible: true, autoPlayExist: true, recording: false, traceLog: false,
    playMode: 'autoPlay', autoPlayPlaying: true, autoPlayProgress: 1, autoPlayTotal: 4,
    onOpenMenu: noop, onToggleFeedbackLight: noop, onToggleLed: noop, onSwitchPlayMode: noop,
    onAutoPlayPlayPause: () => { toggles++; }, onAutoPlayPrev: noop, onAutoPlayNext: noop,
    onToggleRecording: noop, onToggleTraceLog: noop, onClearTraceLog: noop,
  };
  const Parent = ({ light, controls = props }) => createElement('div', { 'data-light': light }, createElement(ControlPanel, controls));
  const view = render(createElement(Parent, { light: 'red' }));
  assert.ok(labels > 0);
  labels = 0;
  view.rerender(createElement(Parent, { light: 'green' }));
  assert.equal(labels, 0, 'pad lights must not rebuild the unchanged control tree');
  view.rerender(createElement(Parent, { light: 'green', controls: { ...props, autoPlayProgress: 2, autoPlayPlaying: false } }));
  assert.equal(view.getByRole('progressbar').getAttribute('aria-valuenow'), '50');
  fireEvent.click(view.getByRole('button', { name: 'play', exact: true }));
  assert.equal(toggles, 1);
});

test('a pad-only redraw leaves unchanged chain skins alone and still updates changed chain lights', () => {
  const selected = [];
  const chainStates = Array.from({ length: 8 }, () => ({ color: 'transparent', active: false }));
  const props = { chainCount: 8, chainStates, currentChain: 0, theme: { btn: 'button.png', chainled: 'ring.png', isChainLed: true }, onChainSelect: c => selected.push(c) };
  const Parent = ({ light, chains = chainStates }) => createElement('div', { 'data-light': light }, createElement(ChainBar, { ...props, chainStates: chains }));
  const view = render(createElement(Parent, { light: 'red' }));
  assert.equal(images, 16);
  images = 0;
  view.rerender(createElement(Parent, { light: 'green' }));
  assert.equal(images, 0, 'pad lights must not redraw the unchanged chain skins');
  const changed = chainStates.map((state, index) => index === 1 ? { ...state, color: 'rgb(239, 83, 80)' } : state);
  view.rerender(createElement(Parent, { light: 'green', chains: changed }));
  assert.equal(view.getByRole('button', { name: 'Chain 2', exact: true }).querySelector('.z-10').style.backgroundColor, 'rgb(239, 83, 80)');
  fireEvent.pointerDown(view.getByRole('button', { name: 'Chain 2', exact: true }));
  assert.deepEqual(selected, [1]);
});
