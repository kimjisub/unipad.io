import { test, expect } from './browser';
import type { Page, Route } from '@playwright/test';

const REMOTE_CONFIG = 'https://firebaseremoteconfig.googleapis.com/v1/projects/test/namespaces/firebase:fetch';
const OTHER_SERVICE = 'https://service.example.test/data';
const accessDenied = (url: string) => `${url.slice(url.indexOf(':/') + 2)} due to access control checks.`;
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

// Match Next's GET prefetch, including its request headers, without depending on a race in Next's scheduler.
const prefetchInPage = (page: Page, url: string, headers: Record<string, string> = { RSC: '1', 'Next-Router-Prefetch': '1' }) =>
  page.evaluate(({ url, headers }) => void fetch(url, { headers }).catch(() => {}), { url, headers });

const openLinkPage = async (page: Page) => {
  await page.route('**/destination', route => route.fulfill({ contentType: 'text/html', body: '<p>Destination</p>' }));
  await page.route('**/blank', route => route.fulfill({ contentType: 'text/html', body: '<a href="/destination">Leave</a>' }));
  await page.goto('/blank');
};

const failDuringLink = (page: Page, held: Route) => Promise.all([
  held.abort('accessdenied'), page.getByRole('link', { name: 'Leave', exact: true }).click(),
]);

test('a same-origin prefetch cut off by a checked link is not an app error', async ({ page, checkedPage, browserName, baseURL }) => {
  reportsFetchFailures(browserName);
  const url = `${baseURL}/docs/terms?_rsc=prefetch`;
  const prefetch = holdRequest(page, url);
  await openLinkPage(page);
  await prefetchInPage(page, url);
  const held = await prefetch;
  await checkedPage.navigate(() => failDuringLink(page, held));
  await expect(page).toHaveURL('/destination');
  expect(checkedPage.ignored).toHaveLength(1);
  expect(checkedPage.errors).toEqual([]);
});

for (const kind of ['stationary', 'unchecked link', 'other origin', 'ordinary fetch', 'missing RSC header', 'missing prefetch header', 'missing query'] as const) {
  test(`${kind}: the fetch failure still counts`, async ({ page, checkedPage, browserName, baseURL }) => {
    reportsFetchFailures(browserName);
    const url = kind === 'other origin' ? `${OTHER_SERVICE}?_rsc=prefetch`
      : `${baseURL}/docs/terms${kind === 'missing query' ? '' : '?_rsc=prefetch'}`;
    const headers = kind === 'ordinary fetch' ? {} : {
      ...(kind === 'missing RSC header' ? {} : { RSC: '1' }),
      ...(kind === 'missing prefetch header' ? {} : { 'Next-Router-Prefetch': '1' }),
    };
    const prefetch = holdRequest(page, url);
    await openLinkPage(page);
    await prefetchInPage(page, url, headers);
    const held = await prefetch;
    if (kind === 'stationary') await held.abort('accessdenied');
    else if (kind === 'unchecked link') await failDuringLink(page, held);
    else await checkedPage.navigate(() => failDuringLink(page, held));
    await expect.poll(() => checkedPage.errors).toEqual([accessDenied(url)]);
    expect(checkedPage.ignored).toEqual([]);
    checkedPage.errors.length = 0;
  });
}

test('a prefetch failure in the new document still counts before navigation completes', async ({ page, checkedPage, browserName, baseURL }) => {
  reportsFetchFailures(browserName);
  const url = `${baseURL}/docs/terms?_rsc=new-page`;
  const prefetch = holdRequest(page, url);
  const image = holdRequest(page, '**/held.png');
  await page.route('**/blank', route => route.fulfill({ contentType: 'text/html', body:
    `<script>fetch('${url}', { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } }).catch(() => {})</script><img src="/held.png">`,
  }));
  const opened = page.goto('/blank');
  await (await prefetch).abort('accessdenied');
  await expect.poll(() => checkedPage.errors).toEqual([accessDenied(url)]);
  await (await image).abort();
  await opened;
  expect(checkedPage.ignored).toEqual([]);
  checkedPage.errors.length = 0;
});

test('an app exception during a checked link still counts', async ({ page, checkedPage }) => {
  await openLinkPage(page);
  await page.evaluate(() => document.querySelector('a')!.addEventListener('click', () => {
    throw new Error('thrown while leaving');
  }));
  await checkedPage.navigate(() => page.getByRole('link', { name: 'Leave', exact: true }).click());
  await expect(page).toHaveURL('/destination');
  expect(checkedPage.errors).toEqual(['thrown while leaving']);
  checkedPage.errors.length = 0;
});

test('an uncaught prefetch rejection during a checked link still counts', async ({ page, checkedPage, browserName, baseURL }) => {
  reportsFetchFailures(browserName);
  const url = `${baseURL}/docs/terms?_rsc=uncaught`;
  const prefetch = holdRequest(page, url);
  await openLinkPage(page);
  await page.evaluate(url => { void fetch(url, { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } }); }, url);
  const held = await prefetch;
  await checkedPage.navigate(async () => {
    await held.abort('accessdenied');
    // Let the real rejection surface while the old document still exists.
    await expect.poll(() => checkedPage.errors).toHaveLength(1);
    await page.getByRole('link', { name: 'Leave', exact: true }).click();
  });
  expect(checkedPage.ignored).toEqual([accessDenied(url)]);
  expect(checkedPage.errors[0]).toContain('Load failed');
  checkedPage.errors.length = 0;
});
