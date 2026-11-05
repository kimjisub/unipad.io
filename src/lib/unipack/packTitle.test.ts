import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packDisplayTitle, packNameFromFileName } from './packTitle';

test('a pack with an empty title shows the name of its file', () => {
  assert.equal(packDisplayTitle({ title: '', fileName: 'INF-008' }), 'INF-008');
});

test('a pack whose title is only spaces shows the name of its file', () => {
  assert.equal(packDisplayTitle({ title: ' \t ', fileName: 'INF-008-copy' }), 'INF-008-copy');
});

test('a pack with a title shows its title, not its file name', () => {
  assert.equal(packDisplayTitle({ title: 'Browser Test Pack', fileName: 'INF-008' }), 'Browser Test Pack');
  assert.equal(packDisplayTitle({ title: ' Spaced ', fileName: 'INF-008' }), ' Spaced ');
});

test('a pack saved without a file name keeps its blank title', () => {
  assert.equal(packDisplayTitle({ title: '' }), '');
  assert.equal(packDisplayTitle({ title: '  ' }), '  ');
});

test('only the last extension is taken off a file name, in any case', () => {
  assert.equal(packNameFromFileName('INF-008.zip'), 'INF-008');
  assert.equal(packNameFromFileName('pack.UNI'), 'pack');
  assert.equal(packNameFromFileName('my.pack.v2.zip'), 'my.pack.v2');
  assert.equal(packNameFromFileName('no-extension'), 'no-extension');
});

test('a file name with nothing left after its extension gives no name', () => {
  assert.equal(packNameFromFileName('.zip'), undefined);
  assert.equal(packNameFromFileName(' .uni'), undefined);
  assert.equal(packNameFromFileName(''), undefined);
});
