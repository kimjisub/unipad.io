import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSearchShortcut, isTextEntryTarget } from './keyboardShortcuts';

const key = (value: unknown, modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}) => (
  { key: value as string, metaKey: false, ctrlKey: false, ...modifiers }
);

test('slash and Cmd or Ctrl with K are search shortcuts', () => {
  assert.equal(isSearchShortcut(key('/')), true);
  assert.equal(isSearchShortcut(key('k', { metaKey: true })), true);
  assert.equal(isSearchShortcut(key('k', { ctrlKey: true })), true);
  assert.equal(isSearchShortcut(key('K', { ctrlKey: true })), true);
});

test('K without a command modifier and other keys are not search shortcuts', () => {
  assert.equal(isSearchShortcut(key('k')), false);
  assert.equal(isSearchShortcut(key('j', { metaKey: true })), false);
  assert.equal(isSearchShortcut(key('Enter')), false);
  assert.equal(isSearchShortcut(key('')), false);
});

test('a keydown without a key, as autofill sends, is not a shortcut and does not throw', () => {
  assert.equal(isSearchShortcut(key(undefined, { ctrlKey: true })), false);
  assert.equal(isSearchShortcut(key(null, { metaKey: true })), false);
});

test('only text fields count as text entry', () => {
  const target = (tagName: string) => ({ target: { tagName } as unknown as EventTarget });
  assert.equal(isTextEntryTarget(target('INPUT')), true);
  assert.equal(isTextEntryTarget(target('TEXTAREA')), true);
  assert.equal(isTextEntryTarget(target('BUTTON')), false);
  assert.equal(isTextEntryTarget({ target: null }), false);
});
