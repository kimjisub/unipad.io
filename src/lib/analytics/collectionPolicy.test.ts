import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareAnalyticsCollection } from './collectionPolicy';

function browser(url = 'https://unipad.io/play', webdriver = false) {
  const stored = new Map<string, string>();
  const dataLayer: IArguments[] = [];
  const state = {
    navigator: { webdriver },
    location: { href: url },
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
    dataLayer,
  };
  return state as unknown as Window & typeof globalThis & {
    gtag: (...args: unknown[]) => void;
    dataLayer: IArguments[];
  };
}

test('ordinary visits keep the existing analytics function and queue untouched', () => {
  const page = browser();
  prepareAnalyticsCollection(page, 'G-LOCAL');
  assert.equal(page.gtag, undefined);
  assert.deepEqual(page.dataLayer, []);
  assert.equal(Reflect.get(page, 'ga-disable-G-LOCAL'), undefined);
});

test('webdriver disables the configured ID before initialization and the fetched ID before config', () => {
  const page = browser(undefined, true);
  const seen: unknown[] = [];
  page.gtag = (...args) => {
    seen.push([Reflect.get(page, 'ga-disable-G-SERVER'), ...args]);
  };
  prepareAnalyticsCollection(page, 'G-LOCAL');
  assert.equal(Reflect.get(page, 'ga-disable-G-LOCAL'), true);
  page.gtag('config', 'G-SERVER', {});
  assert.deepEqual(seen, [[true, 'config', 'G-SERVER', {}]]);
});

test('marked visits stay disabled across full internal navigation and retain queued events', () => {
  const page = browser('https://unipad.io/play?no_analytics=1&pack=local');
  prepareAnalyticsCollection(page, 'G-LOCAL');
  page.gtag('config', 'G-SERVER', {});
  page.gtag('event', 'page_view', { page_path: '/play?no_analytics=1&pack=local' });
  assert.equal(Reflect.get(page, 'ga-disable-G-SERVER'), true);
  assert.deepEqual(Array.from(page.dataLayer[1]), ['event', 'page_view', { page_path: '/play?no_analytics=1&pack=local' }]);
  page.location.href = 'https://unipad.io/docs';
  delete (page as Partial<typeof page>).gtag;
  Reflect.deleteProperty(page, 'ga-disable-G-LOCAL');
  prepareAnalyticsCollection(page, 'G-LOCAL');
  assert.equal(Reflect.get(page, 'ga-disable-G-LOCAL'), true);
});

test('other marker values do not disable ordinary visits', () => {
  const page = browser('https://unipad.io/?no_analytics=0');
  prepareAnalyticsCollection(page, 'G-LOCAL');
  assert.equal(page.gtag, undefined);
});

test('a marked visit still disables analytics when session storage is denied', () => {
  const page = browser('https://unipad.io/?no_analytics=1');
  Object.defineProperty(page, 'sessionStorage', { get() { throw new Error('denied'); } });
  prepareAnalyticsCollection(page, 'G-LOCAL');
  page.gtag('config', 'G-SERVER');
  assert.equal(Reflect.get(page, 'ga-disable-G-SERVER'), true);
});
