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
const { render, cleanup, fireEvent, act, within } = await import('@testing-library/react');
// TSX components use the CommonJS entry; share its translation context.
const { NextIntlClientProvider } = createRequire(import.meta.url)('next-intl');
const { MotionGlobalConfig } = createRequire(import.meta.url)('framer-motion');
MotionGlobalConfig.skipAnimations = true;
const { StoreModal } = await import('./StoreModal.tsx');
const messages = JSON.parse(readFileSync(new URL('../../i18n/messages/en.json', import.meta.url)));
const noop = () => {};
const wrapped = (Component, props) => React.createElement(NextIntlClientProvider, { locale: 'en', messages }, React.createElement(Component, props));
const delay = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

afterEach(async () => {
  await delay(100);
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


const selected = (view) => view.container.querySelector('[aria-selected="true"]')?.dataset.storeCode;

for (const initiallyVisible of [false, true]) {
  test(`preferred pack is selected on first open (initially visible: ${initiallyVisible})`, () => {
    const props = { ...storeProps, visible: initiallyVisible, preferredCode: 'second' };
    const view = render(wrapped(StoreModal, props));
    if (!initiallyVisible) view.rerender(wrapped(StoreModal, { ...props, visible: true }));
    assert.equal(selected(view), 'second');
  });
}

test('preferred pack wins when the current selection disappears', async () => {
  const props = { ...storeProps, visible: true };
  const view = render(wrapped(StoreModal, props));
  await act(async () => view.rerender(wrapped(StoreModal, {
    ...props, items: [{ ...items[0], code: 'third' }, items[1]], preferredCode: 'second',
  })));
  assert.equal(selected(view), 'second');
});

test('empty and late-arriving lists recover to a valid preference or first item', () => {
  const props = { ...storeProps, visible: true, preferredCode: 'second' };
  const view = render(wrapped(StoreModal, { ...props, items: [] }));
  assert.equal(selected(view), undefined);
  view.rerender(wrapped(StoreModal, props));
  assert.equal(selected(view), 'second');
  view.rerender(wrapped(StoreModal, { ...props, preferredCode: 'missing', items: [items[0]] }));
  assert.equal(selected(view), 'first');
  view.rerender(wrapped(StoreModal, { ...props, items: [] }));
  assert.equal(selected(view), undefined);
});

test('manual selection, search, filters, sorting, keyboard and reopen stay usable', async () => {
  const downloads = [];
  const props = { ...storeProps, visible: true, preferredCode: 'second', onDownload: item => downloads.push(item.code) };
  const view = render(wrapped(StoreModal, props));
  assert.equal(selected(view), 'second');
  fireEvent.click(view.container.querySelector('[data-store-code="first"]'));
  assert.equal(selected(view), 'first');
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'Enter' });
  assert.deepEqual(downloads, ['second']);
  const search = view.getByRole('textbox');
  fireEvent.change(search, { target: { value: 'Second' } });
  assert.equal(view.getAllByRole('option').length, 1);
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.click(view.getByRole('button', { name: 'LED', exact: true }));
  assert.equal(view.getAllByRole('option').length, 1);
  fireEvent.click(view.getByRole('button', { name: 'All', exact: true }));
  fireEvent.click(view.getByRole('button', { name: 'A-Z', exact: true }));
  assert.deepEqual(view.getAllByRole('option').map(x => x.dataset.storeCode), ['first', 'second']);
  view.rerender(wrapped(StoreModal, { ...props, visible: false }));
  await delay(50);
  view.rerender(wrapped(StoreModal, props));
  assert.equal(selected(view), 'second');
});

test('a selected pack offers YouTube, download and play, and never links to its download file', () => {
  const calls = [];
  const record = (kind) => (item) => calls.push(`${kind}:${item.code}`);
  const packs = items.map((item) => ({ ...item, url: `https://unipack.unipad.io/store/${item.code}.zip` }));
  const open = mock.method(window, 'open', () => null);
  const view = render(wrapped(StoreModal, {
    ...storeProps, visible: true, items: packs,
    downloadedCodes: new Set(['second']), downloadedPackIdByCode: new Map([['second', 'pack-second']]),
    onYoutube: record('youtube'), onDownload: record('download'), onPlayDownloaded: record('play'),
  }));
  const option = (code) => view.container.querySelector(`[data-store-code="${code}"]`);

  for (const code of ['first', 'second']) {
    fireEvent.click(option(code));
    assert.equal(selected(view), code);
    assert.ok(!view.queryByRole('button', { name: /website/i }), `${code} shows a Website button`);
    assert.ok(!view.container.querySelector('[href*=".zip"]'), `${code} links to its download file`);
  }
  fireEvent.click(view.getByRole('button', { name: 'Play Downloaded Pack' }));
  fireEvent.click(option('first'));
  fireEvent.click(view.getByRole('button', { name: 'YouTube' }));
  fireEvent.click(within(option('first')).getByRole('button', { name: 'Download' }));
  fireEvent.click(within(option('second')).getByRole('button', { name: 'Play' }));
  assert.deepEqual(calls, ['play:second', 'youtube:first', 'download:first', 'play:second']);
  assert.equal(open.mock.callCount(), 0);
});
