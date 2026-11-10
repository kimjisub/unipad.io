import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'SVGElement']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: value => value };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
HTMLElement.prototype.scrollIntoView = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const React = await import('react');
const { render, cleanup, fireEvent, act, within } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const storageId = require.resolve('../../lib/unipack/storage.ts');
require.cache[storageId] = { id: storageId, filename: storageId, loaded: true, exports: {
  getSetting: async () => null, setSetting: async () => {},
} };
const { NextIntlClientProvider } = require('next-intl');
require('framer-motion').MotionGlobalConfig.skipAnimations = true;
const { MainScreen } = require('./MainScreen.tsx');
const messages = (await import('../../i18n/messages/en.json', { with: { type: 'json' } })).default;
const packs = ['Alpha', 'Bravo', 'Charlie'].map((title, index) => ({
  id: title, title, producerName: 'Tests', buttonX: 8, buttonY: 8, chain: 1,
  addedAt: index, lastOpenedAt: 0,
}));
const noop = () => {};
afterEach(cleanup);

async function mount(theme = false) {
  const deletedPacks = [], deletedThemes = [], played = [];
  const view = render(React.createElement(React.StrictMode, null,
    React.createElement(NextIntlClientProvider, { locale: 'en', messages }, React.createElement(MainScreen, {
      savedPacks: packs, savedThemes: [{ id: 'theme', name: 'Test theme', author: 'Tests' }],
      lastPlayedPackId: theme ? null : 'Bravo', onPlay: id => played.push(id),
      onDeletePack: id => deletedPacks.push(id), onDeleteTheme: id => deletedThemes.push(id),
      onOpenStore: noop, onImport: noop, onImportTheme: noop, onApplyTheme: noop,
      onClearTheme: noop, onToggleBookmark: noop,
    }))));
  await view.findByRole('option', { name: 'Bravo by Tests' });
  await act(async () => {});
  if (theme) fireEvent.click(view.getByRole('button', { name: 'Delete theme' }));
  else fireEvent.keyDown(view.getByRole('option', { name: 'Bravo by Tests' }), { key: 'Delete' });
  return { view, deletedPacks, deletedThemes, played };
}
const shortcuts = [
  { key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: '/' },
  { key: 'k', ctrlKey: true }, { key: 'k', metaKey: true },
  { key: 'Delete' }, { key: 'Backspace' },
];

for (const theme of [false, true]) for (const shortcut of shortcuts) {
  test(`${theme ? 'theme' : 'pack'} deletion keeps the background unchanged on ${JSON.stringify(shortcut)}`, async () => {
    const { view, deletedPacks, deletedThemes, played } = await mount(theme);
    const dialog = view.getByRole('alertdialog');
    for (const name of ['Delete', 'Cancel']) {
      const button = within(dialog).getByRole('button', { name, exact: true });
      button.focus();
      fireEvent.keyDown(button, shortcut);
      assert.ok(document.activeElement === button, 'search must not take focus from the confirmation');
      assert.deepEqual(view.getAllByRole('option').filter(row => row.getAttribute('aria-selected') === 'true').map(row => row.dataset.packId), theme ? [] : ['Bravo']);
      assert.ok(view.getByRole('alertdialog') === dialog);
    }
    assert.deepEqual([deletedPacks, deletedThemes, played], [[], [], []]);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    await act(async () => {});
    assert.equal(view.queryByRole('alertdialog'), null);
    fireEvent.keyDown(window, { key: '/' });
    assert.ok(document.activeElement === view.getByRole('textbox'));
  });
}

for (const theme of [false, true]) test(`${theme ? 'theme' : 'pack'} deletion still confirms the original item after blocked arrows`, async () => {
  const { deletedPacks, deletedThemes, played } = await mount(theme);
  fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'Enter' });
  await act(async () => {});
  assert.deepEqual(deletedPacks, theme ? [] : ['Bravo']);
  assert.deepEqual(deletedThemes, theme ? ['theme'] : []);
  assert.deepEqual(played, []);
});
