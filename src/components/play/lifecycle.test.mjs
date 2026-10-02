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
const { TypewriterEffect } = await import('../TypewriterEffect.tsx');
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

const items = [
  { code: 'first', title: 'First', producerName: 'CI', isLED: false, isAutoPlay: false, downloadCount: 10 },
  { code: 'second', title: 'Second', producerName: 'CI', isLED: true, isAutoPlay: true, downloadCount: 5 },
];
const storeProps = {
  visible: false, loading: false, error: null, items,
  downloadedCodes: new Set(), downloadedPackIdByCode: new Map(),
  downloadingCode: null, failedCode: null, downloadProgress: 0,
  onClose: noop, onReload: noop, onDownload: noop, onRetryFailed: noop,
  onPlayDownloaded: noop, onCancelDownload: noop, onYoutube: noop, onWebsite: noop,
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
  fireEvent.keyDown(window, { key: 'Delete' });
  assert.ok(view.getByRole('alertdialog', { name: 'Confirm deletion' }));
  assert.deepEqual(deleted, []);
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'Cancel' })));
  assert.deepEqual(deleted, []);
  fireEvent.keyDown(window, { key: 'Delete' });
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'Delete', exact: true })));
  assert.deepEqual(deleted, ['ci']);
});

test('reduced motion shows the first typewriter text without animation', () => {
  const view = render(React.createElement(TypewriterEffect, { texts: ['First', 'Second'] }));
  assert.equal(view.container.textContent, 'First');
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


test('typewriter keeps typing, pausing, deleting and advancing at the configured speeds', () => {
  reducedMotion = false;
  for (const listener of mediaListeners) listener();
  mock.timers.enable({ apis: ['setTimeout'] });
  const view = render(React.createElement(TypewriterEffect, {
    texts: ['A', 'B'], typingSpeed: 20, deletingSpeed: 10, pauseTime: 40,
  }));
  act(() => mock.timers.tick(20));
  assert.equal(view.container.textContent, 'A');
  act(() => mock.timers.tick(39));
  assert.equal(view.container.textContent, 'A');
  act(() => mock.timers.tick(1));
  act(() => mock.timers.tick(10));
  assert.equal(view.container.textContent, '\u00a0');
  act(() => mock.timers.tick(20));
  assert.equal(view.container.textContent, 'B');
});
