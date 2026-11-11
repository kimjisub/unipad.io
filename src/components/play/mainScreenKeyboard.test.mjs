import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mainScreenCallbacks, require, stub } from './mainScreenTestPage.mjs';

const React = await import('react');
const { render, cleanup, fireEvent, act, within, waitFor } = await import('@testing-library/react');
stub('../../lib/unipack/storage.ts', { getSetting: async () => null, setSetting: async () => {} });
const { NextIntlClientProvider } = require('next-intl');
const { MainScreen, ConfirmDialog } = require('./MainScreen.tsx');
const { LaunchpadConnectionHelp } = require('./LaunchpadConnectionHelp.tsx');
const messages = (await import('../../i18n/messages/en.json', { with: { type: 'json' } })).default;
const packs = ['Alpha', 'Bravo', 'Charlie'].map((title, index) => ({
  id: title, title, producerName: 'Tests', buttonX: 8, buttonY: 8, chain: 1,
  addedAt: index, lastOpenedAt: 0,
}));
afterEach(cleanup);

test('the confirmation owns focus, search defaults and outside keys until it unmounts', async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const background = [];
  const record = event => background.push(event.key);
  window.addEventListener('keydown', record);
  const dialog = round => React.createElement(React.StrictMode, null,
    React.createElement(NextIntlClientProvider, { locale: 'en', messages },
      React.createElement(ConfirmDialog, { message: `Question ${round}`, onConfirm() {}, onCancel() {} })));
  try {
    const view = render(dialog(0));
    const buttons = within(view.getByRole('alertdialog')).getAllByRole('button');
    assert.equal(document.activeElement, buttons[1]);
    assert.equal(fireEvent.keyDown(buttons[1], { key: 'Tab' }), false);
    assert.equal(document.activeElement, buttons[0]);
    assert.equal(fireEvent.keyDown(buttons[0], { key: 'Tab', shiftKey: true }), false);
    assert.equal(document.activeElement, buttons[1]);
    for (const shortcut of [{ key: '/' }, { key: 'k', ctrlKey: true }, { key: 'K', metaKey: true }]) {
      assert.equal(fireEvent.keyDown(buttons[1], shortcut), false);
    }
    for (const key of ['q', 'ArrowDown', 'Delete']) fireEvent.keyDown(opener, { key });
    assert.deepEqual(background, []);
    opener.focus();
    assert.equal(document.activeElement, buttons[1], 'programmatic focus cannot escape');
    buttons[0].focus();
    view.rerender(dialog(1));
    assert.equal(document.activeElement, buttons[0], 'a render preserves the chosen button');
    view.unmount();
    assert.equal(document.activeElement, opener);
    fireEvent.keyDown(opener, { key: 'q' });
    assert.deepEqual(background, ['q'], 'the guard is removed when closed');
  } finally {
    window.removeEventListener('keydown', record);
    opener.remove();
  }
});

for (const closeLowerFirst of [false, true]) test(`only the newest confirmation owns focus and keys (remove lower first: ${closeLowerFirst})`, async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const calls = [];
  const screen = (lower, upper) => React.createElement(React.StrictMode, null,
    React.createElement(NextIntlClientProvider, { locale: 'en', messages },
      lower && React.createElement(ConfirmDialog, {
        key: 'lower', message: 'Delete?', label: 'Lower',
        onConfirm: () => calls.push('delete'), onCancel: () => calls.push('cancel delete'),
      }),
      upper && React.createElement(ConfirmDialog, {
        key: 'upper', message: 'Install?', label: 'Upper',
        onConfirm: () => calls.push('install'), onCancel: () => calls.push('cancel install'),
      })));
  try {
    const view = render(screen(true, false));
    const lowerCancel = within(view.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' });
    lowerCancel.focus();
    const errors = listenerErrors(() => view.rerender(screen(true, true)));
    assert.deepEqual(errors, [], 'opening the upper dialog must not start a focus loop');
    const upper = view.getByRole('alertdialog', { name: 'Upper' });
    assert.ok(upper.contains(document.activeElement));
    for (const shiftKey of [false, true]) {
      fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey });
      assert.ok(upper.contains(document.activeElement));
    }
    if (closeLowerFirst) {
      view.rerender(screen(false, true));
      assert.ok(upper.contains(document.activeElement), 'removing a covered dialog leaves focus on the upper dialog');
    }
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    assert.deepEqual(calls, ['install', 'cancel install']);
    view.rerender(screen(!closeLowerFirst, false));
    if (!closeLowerFirst) {
      assert.equal(document.activeElement, lowerCancel);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      assert.deepEqual(calls, ['install', 'cancel install', 'cancel delete']);
    }
    view.unmount();
    assert.equal(document.activeElement, closeLowerFirst ? document.body : opener);
  } finally {
    opener.remove();
  }
});

for (const helpFirst of [true, false]) test(`help and confirmation share focus, keys and visible order (help first: ${helpFirst})`, async () => {
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const calls = [];
  const returnFocusRef = { current: opener };
  function Screen() {
    const [both, setBoth] = React.useState(false);
    const [help, setHelp] = React.useState(true);
    const [confirmation, setConfirmation] = React.useState(true);
    return React.createElement(NextIntlClientProvider, { locale: 'en', messages },
      React.createElement('button', { onClick: () => setBoth(true) }, 'Open second'),
      help && (helpFirst || both) && React.createElement(LaunchpadConnectionHelp, {
        requestedProfile: 'auto', modelLabel: 'Auto Detect', returnFocusRef,
        onClose: () => { calls.push('help'); setHelp(false); },
      }),
      confirmation && (!helpFirst || both) && React.createElement(ConfirmDialog, {
        message: 'Install?', onConfirm: () => calls.push('install'),
        onCancel: () => { calls.push('confirmation'); setConfirmation(false); },
      }));
  }
  try {
    const view = render(React.createElement(React.StrictMode, null, React.createElement(Screen)));
    const lower = view.getByRole(helpFirst ? 'dialog' : 'alertdialog');
    const previous = helpFirst ? within(lower).getByRole('region') : within(lower).getByRole('button', { name: 'Cancel' });
    previous.focus();
    const errors = listenerErrors(() => fireEvent.click(view.getByText('Open second')));
    assert.deepEqual(errors, [], 'mixed dialogs must not fight for focus');
    const upper = view.getByRole(helpFirst ? 'alertdialog' : 'dialog');
    assert.ok(upper.contains(document.activeElement), 'the newest dialog owns focus');
    assert.ok(Number(upper.parentElement.style.zIndex) > Number(lower.parentElement.style.zIndex), 'keyboard order matches visible order');
    for (const shiftKey of [false, true]) {
      assert.deepEqual(listenerErrors(() => fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey })), []);
      assert.ok(upper.contains(document.activeElement));
    }
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => assert.equal(upper.isConnected, false));
    assert.deepEqual(calls, [helpFirst ? 'confirmation' : 'help']);
    assert.equal(document.activeElement, previous, 'closing the upper dialog restores the lower selection');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => assert.equal(lower.isConnected, false));
    assert.equal(document.activeElement, opener);
  } finally {
    cleanup();
    await waitFor(() => assert.equal(Boolean(window.history.state?.connectionHelp), false));
    opener.remove();
  }
});

test('outside keys keep browser defaults while search defaults and page listeners stay blocked', () => {
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages },
    React.createElement(ConfirmDialog, { message: 'Question', onConfirm() {}, onCancel() {} })));
  const received = [];
  const record = event => received.push(event.key);
  window.addEventListener('keydown', record);
  try {
    for (const shortcut of [
      { key: 'r', ctrlKey: true }, { key: 'F5' }, { key: '=', ctrlKey: true },
      { key: '-', ctrlKey: true }, { key: 'c', ctrlKey: true },
      { key: 'c', metaKey: true }, { key: 'p', ctrlKey: true },
    ]) assert.equal(fireEvent.keyDown(document.body, shortcut), true, JSON.stringify(shortcut));
    for (const shortcut of [{ key: '/' }, { key: 'k', ctrlKey: true }, { key: 'k', metaKey: true }]) {
      assert.equal(fireEvent.keyDown(document.body, shortcut), false);
    }
    assert.deepEqual(received, []);
  } finally {
    window.removeEventListener('keydown', record);
  }
});

async function mount(theme = false) {
  const deletedPacks = [], deletedThemes = [], played = [];
  const view = render(React.createElement(React.StrictMode, null,
    React.createElement(NextIntlClientProvider, { locale: 'en', messages }, React.createElement(MainScreen, {
      ...mainScreenCallbacks,
      savedPacks: packs, savedThemes: [{ id: 'theme', name: 'Test theme', author: 'Tests' }],
      lastPlayedPackId: theme ? null : 'Bravo', onPlay: id => played.push(id),
      onDeletePack: id => deletedPacks.push(id), onDeleteTheme: id => deletedThemes.push(id),
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
      const defaultAllowed = fireEvent.keyDown(button, shortcut);
      if (shortcut.key === '/' || shortcut.key === 'k') {
        assert.equal(defaultAllowed, false, 'native browser search must not steal focus either');
      }
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

/** Exceptions thrown inside window listeners while `action` runs; jsdom reports them as error events. */
function listenerErrors(action) {
  const errors = [];
  const record = event => { errors.push(event.error?.message ?? event.message); event.preventDefault(); };
  window.addEventListener('error', record);
  try { action(); } finally { window.removeEventListener('error', record); }
  return errors;
}

/** Counts window keydown listeners attached and removed while `action` runs. */
async function countKeyDownListeners(action) {
  const counts = { added: 0, removed: 0 };
  const { addEventListener, removeEventListener } = window;
  window.addEventListener = function (type, ...rest) {
    if (type === 'keydown') counts.added++;
    return addEventListener.call(this, type, ...rest);
  };
  window.removeEventListener = function (type, ...rest) {
    if (type === 'keydown') counts.removed++;
    return removeEventListener.call(this, type, ...rest);
  };
  try { await action(); } finally {
    window.addEventListener = addEventListener;
    window.removeEventListener = removeEventListener;
  }
  return counts;
}

for (const confirming of [false, true]) test(`a keydown without a key, as autofill sends, is ignored ${confirming ? 'during deletion' : 'by the list'}`, async () => {
  const { view } = await mount(false);
  if (!confirming) fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  await act(async () => {});
  const errors = listenerErrors(() => {
    window.dispatchEvent(new window.Event('keydown', { bubbles: true }));
    view.getByRole('textbox').dispatchEvent(new window.Event('keydown', { bubbles: true }));
  });
  assert.deepEqual(errors, []);
});

test('moving the selection 50 times keeps the list\'s window key handler attached once', async () => {
  const { view } = await mount(false);
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  await act(async () => {});
  const counts = await countKeyDownListeners(async () => {
    for (let step = 0; step < 50; step++) {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      await act(async () => {});
    }
  });
  assert.deepEqual(counts, { added: 0, removed: 0 });
  // Newest first the rows are Charlie, Bravo, Alpha; 50 steps down from Bravo wrap round to Charlie.
  const selected = view.getAllByRole('option').filter(row => row.getAttribute('aria-selected') === 'true');
  assert.deepEqual(selected.map(row => row.dataset.packId), ['Charlie']);
});

test('a confirmation re-rendered 50 times keeps one listener, answers with the latest callbacks and still goes first', async () => {
  const calls = [];
  const background = [];
  const onBackground = event => background.push(event.key);
  window.addEventListener('keydown', onBackground);
  const dialog = round => React.createElement(NextIntlClientProvider, { locale: 'en', messages },
    React.createElement(ConfirmDialog, {
      message: 'Delete?', onConfirm: () => calls.push(`confirm ${round}`), onCancel: () => calls.push(`cancel ${round}`),
    }));
  try {
    let view;
    const counts = await countKeyDownListeners(async () => {
      view = render(dialog(0));
      for (let round = 1; round <= 50; round++) view.rerender(dialog(round));
      fireEvent.keyDown(document.body, { key: 'Enter' });
      fireEvent.keyDown(document.body, { key: 'Escape' });
      view.unmount();
    });
    assert.deepEqual(counts, { added: 1, removed: 1 });
    assert.deepEqual(calls, ['confirm 50', 'cancel 50']);
  } finally {
    window.removeEventListener('keydown', onBackground);
  }
  assert.deepEqual(background, [], 'page listeners attached before the dialog must not see its keys');
});

test('while the store is open the list ignores its keys, and takes them again once it closes', async () => {
  const played = [], deleted = [];
  const screen = keyboardDisabled => React.createElement(NextIntlClientProvider, { locale: 'en', messages },
    React.createElement(MainScreen, {
      ...mainScreenCallbacks, savedPacks: packs, savedThemes: [], lastPlayedPackId: 'Bravo', keyboardDisabled,
      onPlay: id => played.push(id), onDeletePack: id => deleted.push(id),
    }));
  const view = render(screen(false));
  await view.findByRole('option', { name: 'Bravo by Tests' });
  await act(async () => {});
  const selectedIds = () => view.getAllByRole('option').filter(row => row.getAttribute('aria-selected') === 'true').map(row => row.dataset.packId);
  view.rerender(screen(true));
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Delete', '/']) fireEvent.keyDown(window, { key });
  await act(async () => {});
  assert.deepEqual(selectedIds(), ['Bravo']);
  assert.equal(view.queryByRole('alertdialog'), null);
  assert.ok(document.activeElement !== view.getByRole('textbox'));
  assert.deepEqual([played, deleted], [[], []]);
  view.rerender(screen(false));
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  await act(async () => {});
  assert.deepEqual(selectedIds(), ['Alpha']);
});
