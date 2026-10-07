import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('./LaunchpadSettingsModal.tsx');
const locales = {
  en: JSON.parse(read('../../i18n/messages/en.json')),
  ko: JSON.parse(read('../../i18n/messages/ko.json')),
};

const lookup = (messages, path) => path.split('.').reduce((node, key) => node?.[key], messages);

// A key missing from a namespace makes next-intl render the raw key path
// (e.g. "play.launchpad.close") on screen instead of the translated text.
test('launchpad settings modal only uses translation keys that exist', () => {
  const missing = [];
  for (const component of [source, read('./LaunchpadConnectionHelp.tsx')]) {
    const namespaces = new Map(
      [...component.matchAll(/const (\w+) = useTranslations\('([^']+)'\)/g)].map((m) => [m[1], m[2]]),
    );
    assert.ok(namespaces.size > 0);
    for (const [binding, namespace] of namespaces) {
      for (const [, key] of component.matchAll(new RegExp(`\\b${binding}\\('([^'$]+)'`, 'g'))) {
        for (const [locale, messages] of Object.entries(locales)) {
          if (typeof lookup(messages, `${namespace}.${key}`) !== 'string') missing.push(`${locale}:${namespace}.${key}`);
        }
      }
    }
  }

  assert.deepEqual(missing, []);
});

// Profile notes and descriptive labels are looked up through computed keys,
// which the literal-key scan above cannot see.
test('every launchpad profile option has its note and label translations', () => {
  const values = [...source.matchAll(/\{ value: '([^']+)'/g)].map((m) => m[1]);
  const labelKeys = [...source.matchAll(/labelKey: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(values.length > 0);

  const missing = [];
  for (const key of [...values.map((v) => `notes.${v}`), ...labelKeys]) {
    for (const [locale, messages] of Object.entries(locales)) {
      if (typeof lookup(messages, `play.launchpad.${key}`) !== 'string') missing.push(`${locale}:play.launchpad.${key}`);
    }
  }

  assert.deepEqual(missing, []);
});

// Exercise the rendered settings rather than a copy of its state logic.
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/play' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'localStorage']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { createRequire } = await import('node:module');
const { NextIntlClientProvider } = createRequire(import.meta.url)('next-intl');
const { render, cleanup, fireEvent, act } = await import('@testing-library/react');
const { LaunchpadSettingsModal } = await import('./LaunchpadSettingsModal.tsx');
const { afterEach, mock } = await import('node:test');
afterEach(async () => {
  cleanup();
  await act(() => new Promise(resolve => setTimeout(resolve, 30)));
  localStorage.clear();
  mock.restoreAll();
});
const props = {
  visible: true, midiConnected: false, midiInputName: null, midiOutputName: null,
  requestedProfile: 'auto', resolvedProfile: 'launchpad_mini_mk3',
  onClose: () => {}, onChangeProfile: () => {}, onConnect: () => {}, onDisconnect: () => {},
};
const wrapped = (overrides = {}, locale = 'en') => React.createElement(NextIntlClientProvider,
  { locale, messages: locales[locale] }, React.createElement(LaunchpadSettingsModal, { ...props, ...overrides }));
const openHelp = view => {
  const entry = view.getByRole('button', { name: 'Connection and light help' });
  fireEvent.click(entry);
  return { entry, help: view.getByRole('dialog', { name: 'Connection and light help' }) };
};

test('reading help preserves requested model, storage, settings scroll and every device callback', async () => {
  const calls = [];
  const callbacks = Object.fromEntries(['onClose', 'onChangeProfile', 'onConnect', 'onDisconnect'].map(name => [name, () => calls.push(name)]));
  localStorage.setItem('existing-setting', 'unchanged');
  const writes = mock.method(dom.window.Storage.prototype, 'setItem');
  const view = render(wrapped(callbacks));
  const scroller = view.getByRole('combobox').parentElement.parentElement.parentElement;
  scroller.scrollTop = 45;
  const { entry, help } = openHelp(view);
  assert.match(help.textContent, /Selected model: Auto Detect/);
  assert.doesNotMatch(help.textContent, /In Programmer mode|manufacturer's guide/);
  assert.match(help.textContent, /do not choose a different model/);
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(view.queryByRole('dialog', { name: 'Connection and light help' }), null);
  assert.equal(document.activeElement === entry, true, 'focus returns to the help entry');
  assert.equal(scroller.scrollTop, 45);
  assert.equal(view.getByRole('combobox').value, 'auto');
  assert.equal(localStorage.getItem('existing-setting'), 'unchanged');
  assert.equal(writes.mock.callCount(), 0);
  assert.deepEqual(calls, []);
  assert.ok(view.getByRole('button', { name: 'Connect', exact: true }));
});

test('Mini help traps both Tab directions, prevents parent Escape and preserves help on failed external open', async () => {
  const view = render(wrapped({ requestedProfile: 'launchpad_mini_mk3', midiConnected: true }));
  const { entry, help } = openHelp(view);
  assert.match(help.textContent, /In Programmer mode/);
  const close = view.getByRole('button', { name: 'Close help' });
  const guide = view.getByRole('button', { name: "Read the manufacturer's guide" });
  assert.equal(document.activeElement === close, true, 'close receives initial focus');
  guide.focus();
  fireEvent.keyDown(guide, { key: 'Tab' });
  assert.equal(document.activeElement === close, true, 'Tab wraps to close');
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  assert.equal(document.activeElement === guide, true, 'Shift+Tab wraps to the guide');
  mock.method(window, 'open', () => null);
  fireEvent.click(guide);
  assert.match(help.textContent, /Could not open the manufacturer's guide/);
  assert.ok(view.getByRole('dialog', { name: 'Connection and light help' }));
  let parentEscapes = 0;
  const parent = () => { parentEscapes++; };
  window.addEventListener('keydown', parent);
  fireEvent.keyDown(window, { key: 'Escape' });
  window.removeEventListener('keydown', parent);
  await act(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(parentEscapes, 0);
  assert.equal(document.activeElement === entry, true, 'focus returns to the help entry');
  assert.ok(view.getByRole('button', { name: 'Reconnect', exact: true }));
});

test('model-specific text follows explicit selection and Korean uses the approved web copy', () => {
  const view = render(wrapped({ requestedProfile: 'launchpad_pro' }, 'ko'));
  fireEvent.click(view.getByRole('button', { name: '연결·불빛 도움말' }));
  const help = view.getByRole('dialog', { name: '연결·불빛 도움말' });
  assert.match(help.textContent, /Launchpad Pro와 Launchpad Pro MK3는 서로 다른 기종이에요\./);
  assert.match(help.textContent, /브라우저 이름과 버전/);
  assert.doesNotMatch(help.textContent, /프로그래머 모드|Android의 USB/);
  view.rerender(wrapped({ requestedProfile: 'launchpad_x' }, 'ko'));
  assert.doesNotMatch(help.textContent, /서로 다른 기종|다른 기종을 대신/);
  view.rerender(wrapped({ requestedProfile: 'auto' }, 'ko'));
  assert.match(help.textContent, /선택한 기종: 자동 감지/);
  assert.match(help.textContent, /다른 기종을 대신 고르지/);
  assert.match(help.textContent, /기종을 바꾸면 이미 연결된 장치에 바로 적용돼요\. 연결 전이면 기종을 고른 뒤 ‘연결’을 눌러 주세요\. 도움말은 자동으로 연결하지 않아요\./);
  assert.doesNotMatch(help.textContent, /다음 연결부터/);
});

test('English web copy says a model change applies immediately to a connected device', () => {
  const { help } = openHelp(render(wrapped({ midiConnected: true })));
  assert.match(help.textContent, /Changing the model applies it immediately to devices that are already connected\. If disconnected, choose a model and press Connect\. This guide does not connect automatically\./);
  assert.doesNotMatch(help.textContent, /next connection/);
});

test('all existing models get only their approved additional help', () => {
  const view = render(wrapped());
  const { help } = openHelp(view);
  for (const profile of ['auto', 'launchpad_s', 'launchpad_mk2', 'launchpad_pro', 'launchpad_x', 'launchpad_mini_mk3', 'launchpad_pro_mk3', 'midifighter', 'matrix', 'master_keyboard', 'none']) {
    view.rerender(wrapped({ requestedProfile: profile }));
    assert.equal(help.textContent.includes(locales.en.play.launchpad.help.mini), profile === 'launchpad_mini_mk3', profile);
    assert.equal(help.textContent.includes(locales.en.play.launchpad.help.pro), ['launchpad_pro', 'launchpad_pro_mk3'].includes(profile), profile);
    assert.equal(help.textContent.includes(locales.en.play.launchpad.help.other), ['auto', 'midifighter', 'matrix', 'master_keyboard', 'none'].includes(profile), profile);
  }
});

test('successful external open detaches its opener and leaves help and selection intact', () => {
  const view = render(wrapped({ requestedProfile: 'launchpad_mini_mk3' }));
  const { help } = openHelp(view);
  const external = { opener: window, location: { href: 'about:blank' } };
  mock.method(window, 'open', () => external);
  fireEvent.click(view.getByRole('button', { name: "Read the manufacturer's guide" }));
  assert.equal(external.opener, null);
  assert.equal(external.location.href, 'https://userguides.novationmusic.com/hc/en-gb/articles/23731330721682-Launchpad-Mini-MK3-s-Settings-menu');
  assert.equal(view.getByRole('dialog', { name: 'Connection and light help' }), help);
  assert.equal(view.container.querySelector('select').value, 'launchpad_mini_mk3');
  assert.equal(view.queryByRole('alert'), null);
});

test('help keyboard input does not reach the background player shortcuts', () => {
  const view = render(wrapped());
  const { help } = openHelp(view);
  let backgroundKeys = 0;
  const background = () => { backgroundKeys++; };
  window.addEventListener('keydown', background);
  fireEvent.keyDown(help.querySelector('[role="region"]'), { key: 'q', code: 'KeyQ' });
  fireEvent.keyDown(view.getByRole('button', { name: 'Close help' }), { key: ' ', code: 'Space' });
  window.removeEventListener('keydown', background);
  assert.equal(backgroundKeys, 0, 'reading/activating help must not play pads or toggle auto-play');
});


test('help entry keyboard activation preserves the native button action and stops player shortcuts', () => {
  const view = render(wrapped());
  const entry = view.getByRole('button', { name: 'Connection and light help' });
  let backgroundKeys = 0;
  const background = () => { backgroundKeys++; };
  window.addEventListener('keydown', background);
  try {
    const nativeActionAllowed = fireEvent.keyDown(entry, { key: ' ', code: 'Space' });
    assert.equal(backgroundKeys, 0, 'Space on the help entry must not toggle auto-play');
    assert.equal(nativeActionAllowed, true, 'the browser must still activate the button');
  } finally {
    window.removeEventListener('keydown', background);
  }
});

test('help entry passes Escape and modified shortcuts to the settings handler', () => {
  const view = render(wrapped());
  const entry = view.getByRole('button', { name: 'Connection and light help' });
  const keys = [];
  const background = event => keys.push(event.key);
  window.addEventListener('keydown', background);
  try {
    fireEvent.keyDown(entry, { key: 'Escape' });
    fireEvent.keyDown(entry, { key: 'o', code: 'KeyO', altKey: true });
    assert.deepEqual(keys, ['Escape', 'o']);
    fireEvent.keyDown(entry, { key: 'q', code: 'KeyQ' });
    assert.deepEqual(keys, ['Escape', 'o'], 'unmodified pad keys stay out of the player');
  } finally {
    window.removeEventListener('keydown', background);
  }
});

for (const action of ['click', 'Escape']) {
  test(`rapid repeated help ${action} requests exactly one asynchronous history traversal`, async () => {
    const view = render(wrapped());
    openHelp(view);
    const back = mock.method(window.history, 'back', () => {});
    const close = view.getByRole('button', { name: 'Close help' });
    for (let i = 0; i < 2; i++) {
      if (action === 'click') fireEvent.click(close);
      else fireEvent.keyDown(close, { key: 'Escape' });
    }
    assert.equal(back.mock.callCount(), 1);
    view.unmount();
    await act(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(back.mock.callCount(), 1, 'unmount must not traverse again while Back is pending');
    window.history.replaceState({}, '');
  });
}

test('Strict Mode effect replay keeps one help history entry and help stays open', async () => {
  const view = render(React.createElement(React.StrictMode, null, wrapped()));
  const push = mock.method(window.history, 'pushState');
  const back = mock.method(window.history, 'back');
  const { entry } = openHelp(view);
  await act(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.ok(view.queryByRole('dialog', { name: 'Connection and light help' }));
  assert.equal(push.mock.callCount(), 1);
  assert.equal(back.mock.callCount(), 0);
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(view.queryByRole('dialog', { name: 'Connection and light help' }), null);
  assert.equal(document.activeElement === entry, true, 'Strict Mode close restores entry focus');
  assert.equal(back.mock.callCount(), 1);
});

test('unmounting open settings removes its help history entry once', async () => {
  window.history.replaceState({ testBase: true }, '');
  const view = render(wrapped());
  openHelp(view);
  const back = mock.method(window.history, 'back');
  view.unmount();
  await act(() => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(back.mock.callCount(), 1);
  assert.equal(window.history.state?.testBase, true);
});
