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
  const namespaces = new Map(
    [...source.matchAll(/const (\w+) = useTranslations\('([^']+)'\)/g)].map((m) => [m[1], m[2]]),
  );
  assert.ok(namespaces.size > 0);

  const missing = [];
  for (const [binding, namespace] of namespaces) {
    for (const [, key] of source.matchAll(new RegExp(`\\b${binding}\\('([^'$]+)'\\)`, 'g'))) {
      for (const [locale, messages] of Object.entries(locales)) {
        if (typeof lookup(messages, `${namespace}.${key}`) !== 'string') missing.push(`${locale}:${namespace}.${key}`);
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
