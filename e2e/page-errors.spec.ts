import { test, expect } from './browser';
import type { Page, Route } from '@playwright/test';

const REMOTE_CONFIG = 'https://firebaseremoteconfig.googleapis.com/v1/projects/test/namespaces/firebase:fetch';
const OTHER_SERVICE = 'https://service.example.test/data';
const accessDenied = (url: string) => `${url.slice('https:/'.length)} due to access control checks.`;
const reportsFetchFailures = (browserName: string) => test.skip(browserName !== 'webkit', 'only WebKit reports a failed fetch as a page error');

/** Holds the first matching request; `accessdenied` makes WebKit log what a reload's cut-off fetch logs. */
const holdRequest = (page: Page, url: string) => new Promise<Route>((resolve, reject) => {
  let first = true;
  page.route(url, route => {
    if (!first) return route.fallback();
    first = false;
    resolve(route);
  }).catch(reject);
});

const openBlankPage = async (page: Page) => {
  await page.route('**/blank', route => route.fulfill({ contentType: 'text/html', body: '<p>Blank</p>' }));
  await page.goto('/blank');
};

const fetchInPage = (page: Page, url: string) => page.evaluate(url => void fetch(url, { method: 'POST' }).catch(() => {}), url);

/** A reload cancels the page's fetches itself within milliseconds, so the failure is sent first: its line then always arrives between the two. */
const failDuringReload = (page: Page, held: Route) => Promise.all([held.abort('accessdenied'), page.reload()]);

test('a Firebase request cut off by a reload is not an app error', async ({ page, checkedPage, browserName }) => {
  reportsFetchFailures(browserName);
  const remoteConfig = holdRequest(page, '**/firebaseremoteconfig.googleapis.com/**');
  await page.goto('/play');
  await failDuringReload(page, await remoteConfig);
  expect(checkedPage.ignored).not.toEqual([]);
  expect(checkedPage.errors).toEqual([]);
});

test('the same Firebase failure counts while the page stays', async ({ page, checkedPage, browserName }) => {
  reportsFetchFailures(browserName);
  const remoteConfig = holdRequest(page, REMOTE_CONFIG);
  await openBlankPage(page);
  await fetchInPage(page, REMOTE_CONFIG);
  await (await remoteConfig).abort('accessdenied');
  await expect.poll(() => checkedPage.errors).toEqual([accessDenied(REMOTE_CONFIG)]);
  checkedPage.errors.length = 0;
});

test('a Firebase failure of the page being opened still counts', async ({ page, checkedPage, browserName }) => {
  reportsFetchFailures(browserName);
  const remoteConfig = holdRequest(page, REMOTE_CONFIG);
  const image = holdRequest(page, '**/held.png');
  const body = `<script>fetch('${REMOTE_CONFIG}', { method: 'POST' }).catch(() => {})</script><img src="/held.png">`;
  await page.route('**/blank', route => route.fulfill({ contentType: 'text/html', body }));
  const opened = page.goto('/blank');
  await (await remoteConfig).abort('accessdenied');
  await expect.poll(() => checkedPage.errors).toEqual([accessDenied(REMOTE_CONFIG)]);
  await (await image).abort();
  await opened;
  checkedPage.errors.length = 0;
});

test('another service cut off by a reload still counts', async ({ page, checkedPage, browserName }) => {
  reportsFetchFailures(browserName);
  const service = holdRequest(page, OTHER_SERVICE);
  await openBlankPage(page);
  await fetchInPage(page, OTHER_SERVICE);
  await failDuringReload(page, await service);
  await expect.poll(() => checkedPage.errors).toEqual([accessDenied(OTHER_SERVICE)]);
  checkedPage.errors.length = 0;
});

test('an app error thrown during a reload still counts', async ({ page, checkedPage }) => {
  await openBlankPage(page);
  await page.route('**/blank', route => route.fulfill({ contentType: 'text/html', body: '<script>throw new Error("thrown while reloading")</script>' }));
  await page.reload();
  expect(checkedPage.errors).toEqual(['thrown while reloading']);
  checkedPage.errors.length = 0;
});
