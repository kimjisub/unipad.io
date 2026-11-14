import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, test, mock } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'SVGElement', 'sessionStorage']) {
  globalThis[name] = dom.window[name];
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
let reducedMotion = true;
const mediaListeners = new Set();
window.matchMedia = () => ({
  get matches() { return reducedMotion; },
  addEventListener(event, listener) { if (event === 'change') mediaListeners.add(listener); },
  removeEventListener(event, listener) { if (event === 'change') mediaListeners.delete(listener); },
});
HTMLElement.prototype.scrollIntoView = () => {};

// Node does not run Next's styled-jsx compiler. Record that known renderer notice,
// and fail the suite on any other React error or unexpected warning.
const rendererErrors = [];
const rendererWarnings = [];
mock.method(console, 'error', (...args) => rendererErrors.push(args.join(' ')));
mock.method(console, 'warn', (...args) => rendererWarnings.push(args.join(' ')));

const React = await import('react');
const { render, cleanup, fireEvent, act } = await import('@testing-library/react');
// TSX components use the CommonJS entry; share its translation context.
const { NextIntlClientProvider } = createRequire(import.meta.url)('next-intl');
const { MotionGlobalConfig } = createRequire(import.meta.url)('framer-motion');
MotionGlobalConfig.skipAnimations = true;
const { OptionPanel } = await import('./OptionPanel.tsx');
const { StoreModal } = await import('./StoreModal.tsx');
const { MainScreen } = await import('./MainScreen.tsx');
const { default: Preloader } = await import('../ui/Preloader.tsx');
const messages = JSON.parse(readFileSync(new URL('../../i18n/messages/en.json', import.meta.url)));
const noop = () => {};
const wrapped = (Component, props) => React.createElement(NextIntlClientProvider, { locale: 'en', messages }, React.createElement(Component, props));
const delay = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  mock.timers.reset();
  reducedMotion = true;
  for (const listener of mediaListeners) listener();
  for (const error of rendererErrors.splice(0)) {
    assert.ok(error.includes('non-boolean attribute') && error.includes('jsx'), error);
  }
  for (const warning of rendererWarnings.splice(0)) {
    assert.match(warning, /Reduced Motion enabled/);
  }
});

test('option panel opens, keeps its exit animation, reopens and unmounts after closing', async () => {
  const props = {
    visible: false, unipackInfo: { title: 'CI pack', squareButton: true }, theme: { colors: {} },
    onClose: noop, onVolumeChange: noop,
  };
  const view = render(wrapped(OptionPanel, props));
  assert.equal(view.queryByRole('dialog'), null);
  view.rerender(wrapped(OptionPanel, { ...props, visible: true }));
  assert.ok(view.getByRole('dialog'));
  view.rerender(wrapped(OptionPanel, props));
  assert.match(view.getByRole('dialog').className, /animate-slide-out-right/);
  await delay(100);
  view.rerender(wrapped(OptionPanel, { ...props, visible: true }));
  await delay(180);
  assert.match(view.getByRole('dialog').className, /animate-slide-in-right/);
  view.rerender(wrapped(OptionPanel, props));
  await delay(280);
  assert.equal(view.queryByRole('dialog'), null);
});

test('a theme colour with its own opacity colours the switched-on option switches, half as strong', () => {
  const props = {
    visible: true, unipackInfo: { title: 'CI pack', squareButton: true },
    theme: { colors: { checkbox: '#a6b4c9', optionWindowCheckbox: '#ff00ff80' } },
    feedbackLight: true, slideMode: false, onClose: noop, onVolumeChange: noop,
  };
  const view = render(wrapped(OptionPanel, props));
  const track = (label) => view.getByText(label, { exact: true }).closest('button').querySelector('.rounded-full').style.backgroundColor;
  assert.equal(track('Feedback Light'), 'rgba(255, 0, 255, 0.251)');
  assert.equal(track('Slide across pads'), 'color-mix(in srgb, var(--panel-ink) 10%, transparent)');
});

test('the options panel takes the theme option_window colour, with content that reads on it', () => {
  const props = { visible: true, unipackInfo: { title: 'CI pack', squareButton: true }, onClose: noop, onVolumeChange: noop };
  const panel = (colors) => {
    const view = render(wrapped(OptionPanel, { ...props, theme: { colors } }));
    const { backgroundColor } = view.getByRole('dialog').style;
    const ink = view.getByRole('dialog').style.getPropertyValue('--panel-ink');
    view.unmount();
    return { backgroundColor, ink };
  };
  const builtIn = panel({ checkbox: '#a6b4c9', optionWindowCheckbox: '#414F66' });
  assert.equal(builtIn.backgroundColor, 'rgba(22, 30, 43, 0.94)');
  assert.equal(builtIn.ink, '#ffffff');
  const light = panel({ checkbox: '#a6b4c9', optionWindow: '#ffffff', optionWindowCheckbox: '#414F66' });
  assert.equal(light.backgroundColor, 'rgba(255, 255, 255, 0.94)');
  assert.equal(light.ink, '#161e2b');
  const dark = panel({ checkbox: '#a6b4c9', optionWindow: '#424242', optionWindowCheckbox: '#414F66' });
  assert.equal(dark.backgroundColor, 'rgba(66, 66, 66, 0.94)');
  assert.equal(dark.ink, '#ffffff');
  const faintLight = panel({ checkbox: '#a6b4c9', optionWindow: '#ffffff10', optionWindowCheckbox: '#414F66' });
  assert.equal(faintLight.backgroundColor, 'rgba(255, 255, 255, 0.94)');
  assert.equal(faintLight.ink, '#161e2b');
  const halfBlue = panel({ checkbox: '#a6b4c9', optionWindow: '#0d47a180', optionWindowCheckbox: '#414F66' });
  assert.equal(halfBlue.backgroundColor, 'rgba(13, 71, 161, 0.94)');
  assert.equal(halfBlue.ink, '#ffffff');
});

test('on a light options panel the red marks, switches and volume slider are drawn to read on it', () => {
  const props = {
    visible: true, unipackInfo: { title: 'CI pack', squareButton: true }, keyLedExist: true,
    ledEnabled: true, slideMode: false, volumeLevel: 7, traceLogStyle: 'numbers', onClose: noop, onVolumeChange: noop,
  };
  const drawn = (colors) => {
    const view = render(wrapped(OptionPanel, { ...props, theme: { colors } }));
    const dialog = view.getByRole('dialog');
    const track = (label) => view.getByText(label, { exact: true }).closest('button').querySelector('.rounded-full');
    const result = {
      quit: view.getByText('Quit', { exact: true }).closest('button').style.color,
      close: view.getByRole('button', { name: 'Close menu' }).querySelector('svg').style.color,
      on: track('LED').style.backgroundColor,
      onThumb: track('LED').firstElementChild.style.backgroundColor,
      chosen: view.getByRole('button', { name: /Numbers/, pressed: true }).style.color,
      slider: dialog.querySelector('input[type=range]'),
    };
    view.unmount();
    return result;
  };
  const builtIn = drawn({ checkbox: '#a6b4c9', optionWindowCheckbox: '#414F66' });
  assert.equal(builtIn.quit, 'rgb(255, 107, 107)');
  assert.equal(builtIn.close, 'rgb(255, 107, 107)');
  assert.equal(builtIn.on, 'rgba(65, 79, 102, 0.5)');
  assert.equal(builtIn.onThumb, 'var(--panel-ink)');
  assert.equal(builtIn.chosen, 'rgb(0, 0, 0)');
  assert.doesNotMatch(builtIn.slider.className, /drawn-volume/);
  const light = drawn({ checkbox: '#a6b4c9', optionWindow: '#ffffff', optionWindowCheckbox: '#414F66' });
  assert.equal(light.quit, 'rgb(228, 95, 95)');
  assert.equal(light.close, 'rgb(228, 95, 95)');
  assert.equal(light.on, 'rgb(132, 138, 148)');
  assert.equal(light.onThumb, 'rgb(22, 30, 43)');
  assert.equal(light.chosen, 'rgb(255, 255, 255)');
  assert.match(light.slider.className, /drawn-volume/);
  assert.equal(light.slider.style.getPropertyValue('--volume-fill'), '100%');
});

test('on a mid blue options panel the volume level, the Open hint, unchosen segments and the link icons on the pack info card are drawn to read where they sit', () => {
  const props = {
    visible: true, unipackInfo: { title: 'CI pack', producerName: 'CI', squareButton: true },
    volumeLevel: 3, traceLogStyle: 'numbers', onClose: noop, onVolumeChange: noop,
  };
  const drawn = (colors) => {
    const view = render(wrapped(OptionPanel, { ...props, theme: { colors } }));
    fireEvent.click(view.getByRole('button', { name: 'Toggle pack info' }));
    const result = {
      volume: view.getByText('3', { exact: true }).style.color,
      hint: view.getByText('Open', { exact: true }).style.color,
      idle: view.getByRole('button', { name: /Lines/, pressed: false }).style.color,
      link: view.getByRole('dialog').style.getPropertyValue('--panel-link'),
      card: view.getByRole('dialog').style.getPropertyValue('--panel-card'),
      producer: view.getByText('CI', { exact: true }).className,
      linkClass: view.getByRole('link', { name: 'YouTube' }).className,
    };
    view.unmount();
    return result;
  };
  const faint = (percent) => `color-mix(in srgb, var(--panel-ink) ${percent}%, transparent)`;
  const builtIn = drawn({ checkbox: '#a6b4c9', optionWindowCheckbox: '#414F66' });
  assert.equal(builtIn.volume, faint(40));
  assert.equal(builtIn.hint, faint(35));
  assert.equal(builtIn.idle, faint(70));
  assert.equal(builtIn.link, faint(30));
  assert.match(builtIn.linkClass, /text-\[color:var\(--panel-link\)\]/);
  assert.equal(builtIn.card, faint(6));
  assert.match(builtIn.producer, /text-\[color:var\(--panel-card-secondary\)\]/);
  const blue = drawn({ checkbox: '#a6b4c9', optionWindow: '#2196f3', optionWindowCheckbox: '#414F66' });
  assert.equal(blue.volume, 'rgb(5, 35, 60)');
  assert.equal(blue.hint, 'rgb(5, 35, 61)');
  assert.equal(blue.idle, 'rgb(7, 27, 46)');
  assert.equal(blue.link, '#0c3a61');
});

const items = [
  { code: 'first', title: 'First', producerName: 'CI', isLED: false, isAutoPlay: false, downloadCount: 10 },
  { code: 'second', title: 'Second', producerName: 'CI', isLED: true, isAutoPlay: true, downloadCount: 5 },
];
const storeProps = {
  visible: false, loading: false, error: null, items,
  downloadedCodes: new Set(), downloadedPackIdByCode: new Map(),
  downloadingCode: null, failedCode: null, downloadProgress: 0,
  onClose: noop, onReload: noop, onDownload: noop, onRetryFailed: noop,
  onPlayDownloaded: noop, onCancelDownload: noop, onYoutube: noop,
};

test('store restores and keeps session filter and sort preferences', () => {
  sessionStorage.setItem('store_ui_pref_v1', JSON.stringify({ filter: 'led', sort: 'title' }));
  const view = render(wrapped(StoreModal, storeProps));
  view.rerender(wrapped(StoreModal, { ...storeProps, visible: true }));
  assert.equal(view.container.querySelectorAll('[data-store-code]').length, 1);
  assert.equal(view.container.querySelector('[data-store-code]').dataset.storeCode, 'second');
  assert.deepEqual(JSON.parse(sessionStorage.getItem('store_ui_pref_v1')), { filter: 'led', sort: 'title' });
});

test('store keeps keyboard selection, honors a preferred item and recovers when it disappears', () => {
  const downloads = [];
  const props = { ...storeProps, onDownload: (item) => downloads.push(item.code) };
  const view = render(wrapped(StoreModal, props));
  view.rerender(wrapped(StoreModal, { ...props, visible: true }));
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'Enter' });
  assert.deepEqual(downloads, ['second']);
  view.rerender(wrapped(StoreModal, { ...props, visible: true, preferredCode: 'first' }));
  fireEvent.keyDown(window, { key: 'Enter' });
  assert.deepEqual(downloads, ['second', 'first']);
  view.rerender(wrapped(StoreModal, { ...props, visible: true, items: [items[1]] }));
  fireEvent.keyDown(window, { key: 'Enter' });
  assert.deepEqual(downloads, ['second', 'first', 'second']);
  view.rerender(wrapped(StoreModal, { ...props, visible: true, items: [] }));
  fireEvent.keyDown(window, { key: 'Enter' });
  assert.equal(downloads.length, 3);
});

test('Delete opens confirmation without deleting the selected saved pack', async () => {
  const deleted = [];
  const pack = { id: 'ci', title: 'CI pack', producerName: 'CI', buttonX: 8, buttonY: 8, chain: 1, addedAt: 0 };
  const view = render(wrapped(MainScreen, {
    savedPacks: [pack], savedThemes: [], lastPlayedPackId: pack.id,
    onPlay: noop, onOpenStore: noop, onImport: noop, onImportTheme: noop,
    onDeletePack: (id) => deleted.push(id), onDeleteTheme: noop, onApplyTheme: noop,
    onClearTheme: noop, onToggleBookmark: noop,
  }));
  await view.findByRole('option', { name: 'CI pack by CI' });
  fireEvent.keyDown(window, { key: 'Delete' });
  assert.ok(view.getByRole('alertdialog', { name: 'Confirm deletion' }));
  assert.deepEqual(deleted, []);
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'Cancel' })));
  assert.deepEqual(deleted, []);
  fireEvent.keyDown(window, { key: 'Delete' });
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'Delete', exact: true })));
  assert.deepEqual(deleted, ['ci']);
});

test('preloader appears only on the first visit and dismisses on its original timer', async () => {
  const view = render(React.createElement(Preloader));
  assert.ok(view.getByText('Play Rhythm'));
  assert.equal(sessionStorage.getItem('unipad_preloader_shown'), '1');
  await delay(1650);
  assert.equal(view.queryByText('Play Rhythm'), null);
  view.unmount();
  const second = render(React.createElement(Preloader));
  assert.equal(second.queryByText('Play Rhythm'), null);
});
