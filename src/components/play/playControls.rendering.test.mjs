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

test('a theme colour with its own opacity still colours the unchecked dots, only fainter', () => {
  const noop = () => {};
  const view = render(createElement(ControlPanel, {
    squareButton: true, keyLedExist: true, feedbackLight: false, ledEnabled: true,
    autoPlayControlsVisible: false, autoPlayExist: false, recording: false, traceLog: false,
    playMode: 'manual', autoPlayPlaying: false, autoPlayProgress: 0, autoPlayTotal: 0,
    themeColors: { checkbox: '#ff00ff80', optionWindow: '#ffffff', optionWindowCheckbox: '#414f66' },
    onOpenMenu: noop, onToggleFeedbackLight: noop, onToggleLed: noop, onSwitchPlayMode: noop,
    onAutoPlayPlayPause: noop, onAutoPlayPrev: noop, onAutoPlayNext: noop,
    onToggleRecording: noop, onToggleTraceLog: noop, onClearTraceLog: noop,
  }));
  const dot = name => view.getByRole('button', { name, exact: true }).querySelector('div').style;
  assert.equal(dot('feedback').backgroundColor, dot('led').backgroundColor);
  assert.match(dot('feedback').backgroundColor, /^rgba\(255, 0, 255, 0\.5/);
  assert.equal(dot('feedback').opacity, '0.25');
  assert.equal(dot('led').opacity, '1');
});

test('a theme without chainled draws its chain images and no light layer', () => {
  const chainStates = Array.from({ length: 8 }, (_, i) => ({ color: i === 2 ? 'rgb(239, 83, 80)' : 'transparent', active: false, guide: i === 3 }));
  const theme = { btn: 'button.png', chainled: null, isChainLed: false, chain: 'chain.png', chainSelected: 'chain_.png', chainGuide: 'chain__.png' };
  const view = render(createElement(ChainBar, { chainCount: 8, chainStates, currentChain: 1, theme, onChainSelect() {} }));
  const sources = name => [...view.getByRole('button', { name, exact: true }).querySelectorAll('img')].map(img => img.getAttribute('src'));
  assert.deepEqual(sources('Chain 1'), ['chain.png', 'chain.png']);
  assert.deepEqual(sources('Chain 2'), ['chain_.png', 'chain.png']);
  assert.deepEqual(sources('Chain 4'), ['chain__.png', 'chain.png']);
  assert.equal(view.getByRole('button', { name: 'Chain 3', exact: true }).querySelector('.z-10'), null);
});
