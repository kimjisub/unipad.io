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


for (const namespace of ['firebase', 'fireperf']) {
  test(`a ${namespace} config fetch started after the navigation action returns belongs to the departing document`, async ({ page, checkedPage, browserName }, info) => {
    reportsFetchFailures(browserName);
    const url = REMOTE_CONFIG.replace('namespaces/firebase:', `namespaces/${namespace}:`);
    await openLinkPage(page);
    const destination = holdRequest(page, '**/destination');
    let actionReturned!: () => void;
    const actionDone = new Promise<void>(resolve => { actionReturned = resolve; });
    let navigationDone = false;
    const navigation = checkedPage.navigate(async () => {
      await page.evaluate(() => document.querySelector<HTMLAnchorElement>('a')!.click());
      actionReturned();
    }, { waitForDocument: true }).then(() => { navigationDone = true; });
    const destinationRoute = await destination;
    await actionDone;
    // The old document still runs after the action returns. WebKit refuses
    // its real fetch before emitting a request event, but reports a native line.
    await fetchInPage(page, url);
    await expect.poll(() => checkedPage.errors.length + checkedPage.ignored.length).toBe(1);
    await info.attach('departing-document', { body: JSON.stringify({ navigationDone, errors: checkedPage.errors, ignored: checkedPage.ignored }), contentType: 'application/json' });
    // Always release the document before asserting, including on the base collector.
    const endedEarly = navigationDone;
    await destinationRoute.fulfill({ contentType: 'text/html', body: '<p>Destination</p>' });
    await navigation;
    expect(checkedPage.ignored).toEqual([accessDenied(url)]);
    expect(checkedPage.errors).toEqual([]);
    expect(endedEarly).toBe(false);
  });
}

// Next's guide link keeps the document alive while its route response is pending.
for (const namespace of ['firebase', 'fireperf']) for (const withAppErrors of [false, true]) {
  test(`a ${namespace} failure after the guide link action returns still belongs to the current document${withAppErrors ? ' with unrelated app errors' : ''}`, async ({ page, checkedPage, browserName }, info) => {
    reportsFetchFailures(browserName);
    const url = REMOTE_CONFIG.replace('namespaces/firebase:', `namespaces/${namespace}:`);
    const pending: Route[] = [];
    let release = false;
    await page.route('**/docs/guide?*', route => {
      if (release) return route.continue();
      pending.push(route);
    });
    await page.goto('/docs');
    const link = page.getByRole('link', { name: /^(User Guide|사용 안내)$/ });
    await link.waitFor();
    await page.evaluate(() => { document.documentElement.dataset.errorProbe = 'original'; });
    const appErrors = ['app failure before navigation', 'app failure alongside the request'];
    const throwAppError = async (message: string) => {
      await page.evaluate(message => { setTimeout(() => { throw new Error(message); }, 0); }, message);
      await expect.poll(() => checkedPage.errors).toContain(message);
    };
    if (withAppErrors) await throwAppError(appErrors[0]);
    const before = { errors: checkedPage.errors.length, ignored: checkedPage.ignored.length };
    let actionReturned!: () => void;
    const actionDone = new Promise<void>(resolve => { actionReturned = resolve; });
    const navigation = checkedPage.navigate(async () => {
      await link.click();
      actionReturned();
    });
    await actionDone;
    await expect.poll(() => pending.length).toBeGreaterThan(0);
    await page.route(url, route => route.abort('accessdenied'));
    await fetchInPage(page, url);
    await expect.poll(() => checkedPage.errors.length + checkedPage.ignored.length - before.errors - before.ignored).toBeGreaterThan(0);
    if (withAppErrors) await throwAppError(appErrors[1]);
    const observed = { errors: checkedPage.errors.slice(before.errors), ignored: checkedPage.ignored.slice(before.ignored) };
    // Release before asserting so a rejected collector can finish its navigation.
    release = true;
    await Promise.all(pending.map(route => route.continue()));
    await navigation;
    const identity = await page.evaluate(() => document.documentElement.dataset.errorProbe);
    await info.attach('current-document', { body: JSON.stringify({ identity, ...observed }), contentType: 'application/json' });
    expect(identity).toBe('original');
    expect(observed.ignored).not.toContain(accessDenied(url));
    expect(observed.errors).toContain(accessDenied(url));
    // Consume this request's expected error without hiding earlier or concurrent exceptions.
    const expectedIndex = checkedPage.errors.indexOf(accessDenied(url), before.errors);
    expect(expectedIndex).toBeGreaterThanOrEqual(before.errors);
    checkedPage.errors.splice(expectedIndex, 1);
    if (withAppErrors) {
      expect(checkedPage.errors).toEqual(appErrors);
      // Only the two deliberate browser exceptions are consumed here.
      for (const message of appErrors) checkedPage.errors.splice(checkedPage.errors.indexOf(message), 1);
    }
  });
}

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

for (const kind of ['prefetch', 'Firebase'] as const) {
  test(`an uncaught ${kind} rejection during a checked link still counts`, async ({ page, checkedPage, browserName, baseURL }) => {
    reportsFetchFailures(browserName);
    const url = kind === 'Firebase' ? REMOTE_CONFIG : `${baseURL}/docs/terms?_rsc=uncaught`;
    const request = holdRequest(page, url);
    await openLinkPage(page);
    await page.evaluate(({ url, kind }) => {
      void fetch(url, kind === 'Firebase' ? { method: 'POST' } : { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } });
    }, { url, kind });
    const held = await request;
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
}

// The name alone must not hide an application exception with different text.
test('a Firebase-shaped application exception during navigation still counts', async ({ page, checkedPage }) => {
  await openLinkPage(page);
  const message = '/firebaseremoteconfig.googleapis.com/application failure';
  await page.evaluate(message => document.querySelector('a')!.addEventListener('click', () => {
    const error = new Error(message);
    error.name = 'Fetch API cannot load https';
    throw error;
  }), message);
  await checkedPage.navigate(() => page.getByRole('link', { name: 'Leave', exact: true }).click());
  expect(checkedPage.errors).toEqual([message]);
  expect(checkedPage.ignored).toEqual([]);
  checkedPage.errors.length = 0;
});

// A rejected action never committed a new document, so it must end either exception interval.
for (const waitForDocument of [false, true]) {
  test(`a failed navigation action does not hide a later Firebase failure (document wait: ${waitForDocument})`, async ({ page, checkedPage, browserName }) => {
    reportsFetchFailures(browserName);
    await openBlankPage(page);
    await expect(checkedPage.navigate(async () => { throw new Error('action failed'); }, { waitForDocument })).rejects.toThrow('action failed');
    const request = holdRequest(page, REMOTE_CONFIG);
    await fetchInPage(page, REMOTE_CONFIG);
    await (await request).abort('accessdenied');
    await expect.poll(() => checkedPage.errors).toEqual([accessDenied(REMOTE_CONFIG)]);
    expect(checkedPage.ignored).toEqual([]);
    checkedPage.errors.length = 0;
  });
}

// WebKit can report an aborted segment before its request event. Replay the recorded error
// after an observed tree prefetch completes, with the segment's different cache key.
for (const kind of ['same route', 'different route', 'different query', 'missing marker'] as const) {
  test(`an early segment error for the ${kind} is classified narrowly`, async ({ page, checkedPage, browserName, baseURL }) => {
    reportsFetchFailures(browserName);
    await openLinkPage(page);
    const treeUrl = `${baseURL}/docs/terms?mode=compact&_rsc=tree`;
    await page.route(treeUrl, route => route.fulfill({ body: 'tree' }));
    const segmentUrl = kind === 'different route' ? `${baseURL}/docs/privacy?mode=compact&_rsc=segment`
      : `${baseURL}/docs/terms?mode=${kind === 'different query' ? 'full' : 'compact'}${kind === 'missing marker' ? '' : '&_rsc=segment'}`;
    await checkedPage.navigate(async () => {
      await page.evaluate(async url => {
        await fetch(url, { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } });
      }, treeUrl);
      await page.evaluate(({ message, name }) => {
        setTimeout(() => { const error = new Error(message); error.name = name; throw error; }, 0);
      }, { message: accessDenied(segmentUrl), name: `Fetch API cannot load ${new URL(segmentUrl).protocol.slice(0, -1)}` });
      await expect.poll(() => checkedPage.errors.length + checkedPage.ignored.length).toBe(1);
      await page.getByRole('link', { name: 'Leave', exact: true }).click();
    });
    expect(checkedPage.ignored).toEqual(kind === 'same route' ? [accessDenied(segmentUrl)] : []);
    expect(checkedPage.errors).toEqual(kind === 'same route' ? [] : [accessDenied(segmentUrl)]);
    checkedPage.errors.length = 0;
  });
}

for (const navigation of ['stay', 'language switch'] as const) {
  test(`a rejected installation is handled during ${navigation}`, async ({ page, checkedPage, browserName }, info) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const pending: Route[] = [];
    let rejectInstallations = false;
    let requests = 0;
    await page.route('**/firebaseinstallations.googleapis.com/**', route => {
      requests++;
      if (rejectInstallations) return route.abort('accessdenied');
      pending.push(route);
    });
    let performanceFailed = false;
    const failures: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
    page.on('console', message => {
      if (message.text().includes('Performance: Could not fetch config, will use default configs')) performanceFailed = true;
      if (message.type() === 'error' && message.text().includes('TypeError')) failures.push(message.text());
    });
    await page.goto('/docs/guide#launchpad');
    await expect.poll(() => pending.length).toBeGreaterThan(0);
    await expect(page.locator('h2#launchpad')).toBeVisible();
    const language = await page.locator('html').getAttribute('lang');
    const fail = async () => {
      rejectInstallations = true;
      await Promise.all(pending.map(route => route.abort('accessdenied')));
      // Registration waiters retry after the first failure. Reject those requests
      // too, so Performance's token consumer observes a failure of its own.
      await expect.poll(() => requests).toBeGreaterThan(1);
      // Wait for the real Performance consumer to handle its token failure,
      // then let the browser report any orphaned promise on the next task.
      await expect.poll(() => performanceFailed).toBe(true);
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
      rejectInstallations = false;
    };
    if (navigation === 'language switch') {
      await checkedPage.navigate(async () => {
        await fail();
        await page.getByRole('button', { name: /한국어로 전환|Switch to English/ }).press('Enter');
      }, { waitForDocument: true });
      await expect(page.locator('html')).toHaveAttribute('lang', language === 'ko' ? 'en' : 'ko');
      await expect(page).toHaveURL('/docs/guide#launchpad');
    } else {
      await fail();
      // WebKit's access-control console line is distinct from the rejection.
      const accessLines = checkedPage.errors.filter(message => /^\/firebaseinstallations\.googleapis\.com\/.* due to access control checks\.$/.test(message));
      if (browserName === 'webkit') expect(accessLines.length).toBeGreaterThan(0);
      else expect(accessLines).toEqual([]);
      for (const line of accessLines) checkedPage.errors.splice(checkedPage.errors.indexOf(line), 1);
    }
    await info.attach('installation-failure', { body: JSON.stringify({ requests, performanceFailed, failures, pageErrors, errors: checkedPage.errors, ignored: checkedPage.ignored }), contentType: 'application/json' });
    await info.attach('guide', { body: await page.screenshot(), contentType: 'image/png' });
    expect(checkedPage.errors).toEqual([]);
  });
}
