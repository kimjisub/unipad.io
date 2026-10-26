import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, mock, test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://unipad-ci.invalid/play' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'SVGElement']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const errors = [];
mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
const React = await import('react');
const { render, cleanup, fireEvent, act } = await import('@testing-library/react');
const require = createRequire(import.meta.url);
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
stub('next-intl', { useTranslations: () => key => key });
require('framer-motion').MotionGlobalConfig.skipAnimations = true;
let storage, writes, readGate, failRead;
stub('../../lib/unipack/storage.ts', {
  getSetting: async key => {
    const value = storage.get(key) ?? null;
    await readGate;
    if (failRead) throw new Error('storage unavailable');
    return value;
  },
  setSetting: async (key, value) => { writes.push([key, value]); storage.set(key, value); },
});
const { MainScreen } = require('./MainScreen.tsx');
const noop = () => {};
const packs = [
  { id: 'a', title: 'Alpha', producerName: 'Charlie', addedAt: 20 },
  { id: 'b', title: 'Bravo', producerName: 'Alpha', addedAt: 30 },
  { id: 'c', title: 'Charlie', producerName: 'Bravo', addedAt: 10 },
  { id: 'favorite', title: 'Zulu', producerName: 'Zulu', addedAt: 40, bookmark: true },
].map(pack => ({ buttonX: 8, buttonY: 8, chain: 1, lastOpenedAt: 0, zipData: new ArrayBuffer(0), ...pack }));
const props = { savedPacks: packs, savedThemes: [], onPlay: noop, onOpenStore: noop,
  onImport: noop, onImportTheme: noop, onDeletePack: noop, onDeleteTheme: noop,
  onApplyTheme: noop, onClearTheme: noop, onToggleBookmark: noop };
const flush = async action => act(async () => { action?.(); });
const rows = view => view.getAllByRole('option').map(row => row.dataset.packId);
function mount(values = {}, failed = false) {
  storage = new Map(Object.entries(values)); writes = []; failRead = failed;
  let release;
  readGate = new Promise(resolve => { release = resolve; });
  const view = render(React.createElement(React.StrictMode, null, React.createElement(MainScreen, props)));
  return { view, release };
}
function choose(view, method) {
  fireEvent.click(view.getByRole('button', { name: /^(Title|Producer|Date)$/ }));
  fireEvent.click(view.getAllByRole('button', { name: method, exact: true }).at(-1));
}
afterEach(() => {
  cleanup();
  assert.deepEqual(errors.splice(0), []);
});

const cases = [
  ['title', true, ['favorite', 'a', 'b', 'c']],
  ['title', false, ['favorite', 'c', 'b', 'a']],
  ['producer', true, ['favorite', 'b', 'c', 'a']],
  ['producer', false, ['favorite', 'a', 'c', 'b']],
  ['date', true, ['favorite', 'c', 'a', 'b']],
  ['date', false, ['favorite', 'b', 'a', 'c']],
];
for (const [method, asc, expected] of cases) {
  test(`slow restoration preserves ${method}/${asc} without writing defaults`, async () => {
    const values = { sortMethod: method, sortOrder: String(asc) };
    const { view, release } = mount(values);
    assert.deepEqual(writes, [], 'mount must not overwrite saved sorting while reads are pending');
    await flush(release);
    assert.deepEqual(rows(view), expected);
    assert.ok(view.getByRole('button', { name: method[0].toUpperCase() + method.slice(1), exact: true }));
    assert.ok(view.getByRole('button', { name: asc ? 'sortAscending' : 'sortDescending' }));
    assert.deepEqual(Object.fromEntries(storage), values);
    assert.deepEqual(writes, [], 'restoration itself must not save');
  });
}

for (const action of ['method', 'direction']) {
  test(`a ${action} change during restoration wins over the late saved value`, async () => {
    const { view, release } = mount({ sortMethod: 'producer', sortOrder: 'false' });
    if (action === 'method') choose(view, 'Title');
    else fireEvent.click(view.getByRole('button', { name: 'sortDescending' }));
    await flush(release);
    assert.deepEqual(rows(view), action === 'method' ? ['favorite', 'a', 'b', 'c'] : ['favorite', 'c', 'a', 'b']);
    assert.deepEqual(Object.fromEntries(storage), { sortMethod: action === 'method' ? 'title' : 'date', sortOrder: 'true' });
  });
}

test('changes after restoration are saved and survive a remount', async () => {
  const { view, release } = mount({ sortMethod: 'producer', sortOrder: 'false' });
  await flush(release);
  choose(view, 'Title');
  fireEvent.click(view.getByRole('button', { name: 'sortAscending' }));
  await flush();
  assert.deepEqual(Object.fromEntries(storage), { sortMethod: 'title', sortOrder: 'false' });
  view.unmount();
  const reopened = render(React.createElement(MainScreen, props));
  await flush();
  assert.deepEqual(rows(reopened), ['favorite', 'c', 'b', 'a']);
});

for (const [name, values, failed] of [
  ['missing', {}, false],
  ['invalid', { sortMethod: 'unknown', sortOrder: 'yes' }, false],
  ['failed', { sortMethod: 'title', sortOrder: 'true' }, true],
]) {
  test(`${name} reads leave defaults visible and existing storage untouched`, async () => {
    const { view, release } = mount(values, failed);
    await flush(release);
    assert.deepEqual(rows(view), ['favorite', 'b', 'a', 'c']);
    assert.deepEqual(Object.fromEntries(storage), values);
    assert.deepEqual(writes, []);
    // A read failure does not disable later user changes.
    choose(view, 'Title');
    await flush();
    assert.deepEqual(Object.fromEntries(storage), { sortMethod: 'title', sortOrder: 'true' });
  });
}
