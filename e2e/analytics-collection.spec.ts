import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { installationResponse } from './browser';

// Use Google's executable tag rather than the common fixture, which blocks it.
// The fake ID intentionally differs from the build's G-FAKE-CI configuration.
const MEASUREMENT_ID = 'G-FAKECI';
let tagScript: string;
let collector: Server;
let collectorURL: string;
const received: { url: string; body: string }[] = [];

test.beforeAll(async ({ request }) => {
  const response = await request.get(`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
  expect(response.ok(), 'Google tag script must be available for the transmission test').toBe(true);
  tagScript = await response.text();
  collector = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push({ url: req.url!, body });
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
      res.end();
    });
  });
  await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', resolve));
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('collector did not bind');
  collectorURL = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (collector) await new Promise<void>((resolve, reject) => collector.close(error => error ? reject(error) : resolve()));
});

async function prepare(context: BrowserContext, baseURL: string, ordinary: boolean) {
  received.length = 0;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL || url.origin === collectorURL) return route.continue();
    if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
      return route.fulfill({ contentType: 'application/javascript', body: tagScript });
    }
    if (url.hostname === 'firebase.googleapis.com') {
      return route.fulfill({ json: { appId: '1:000000000000:web:fake-ci-placeholder', measurementId: MEASUREMENT_ID } });
    }
    if (url.hostname === 'firebaseinstallations.googleapis.com') return route.fulfill({ json: installationResponse(url) });
    if (url.hostname === 'firebaseremoteconfig.googleapis.com') return route.fulfill({ json: { entries: {} } });
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.addInitScript(({ ordinary, collectorURL }) => {
    // All engines normally expose webdriver=true. Only the control/marker cases
    // shadow the navigator getter before application code to model ordinary Safari.
    if (ordinary) Object.defineProperty(navigator, 'webdriver', { get: () => false });
    const state = window as unknown as { dataLayer: IArguments[]; gtag: (...args: unknown[]) => void };
    // Independent native tail probes prove this collector sees requests made
    // while a document leaves, beyond Playwright's routing lifetime.
    addEventListener('pagehide', () => {
      const path = encodeURIComponent(location.pathname);
      navigator.sendBeacon(`${collectorURL}/tail?kind=beacon&path=${path}`, 'tail');
      void fetch(`${collectorURL}/tail?kind=keepalive&path=${path}`, {
        method: 'POST', body: 'tail', keepalive: true, mode: 'no-cors',
      }).catch(() => {});
    });
    state.dataLayer = [];
    state.gtag = function (...args: unknown[]) {
      if (args[0] === 'config') {
        Object.assign(args[2] as object, { transport_url: collectorURL });
      }
      // Match the native gtag queue format consumed by Google's script.
      // eslint-disable-next-line prefer-rest-params
      state.dataLayer.push(arguments);
    };
  }, { ordinary, collectorURL });
}

const queued = (page: Page) => page.evaluate(() =>
  ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
    .map(entry => Array.from(entry)));
const hits = () => received.filter(request => request.url.startsWith('/g/collect'));

for (const condition of ['ordinary', 'webdriver', 'marker'] as const) {
  test(`${condition}: real Google tag collection through navigation and page close`, async ({ page, context, baseURL }, testInfo) => {
    test.setTimeout(60_000);
    await prepare(context, baseURL!, condition !== 'webdriver');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const destinations = ['/play' + (condition === 'marker' ? '?no_analytics=1' : ''), '/docs'];
    const observations = [];
    for (const destination of destinations) {
      // goto forces a new document, proving the opt-out survives full navigation.
      const previousHits = hits().length;
      await page.goto(destination);
      await expect.poll(async () => (await queued(page)).some(([cmd, name]) => cmd === 'event' && name === 'page_view')).toBe(true);
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { google_tag_manager?: unknown }).google_tag_manager))).toBe(true);
      const state = await page.evaluate(id => ({
        webdriver: navigator.webdriver,
        url: location.href,
        disabled: Reflect.get(window, `ga-disable-${id}`) === true,
      }), MEASUREMENT_ID);
      observations.push({ ...state, queue: await queued(page) });
      expect(state.webdriver).toBe(condition === 'webdriver');
      if (condition === 'ordinary') await expect.poll(() => hits().length).toBeGreaterThan(previousHits);
      // Let the actual tag's event batching/engagement timers run before leaving.
      await page.waitForTimeout(1_200);
    }
    await page.close();
    // Page teardown requests bypass Playwright routing in some engines; the HTTP
    // server remains alive and observes those native beacon/keepalive deliveries.
    await new Promise(resolve => setTimeout(resolve, 1_200));
    await testInfo.attach('collection', { body: JSON.stringify({ condition, observations, received }, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
    for (const kind of ['beacon', 'keepalive']) {
      expect(received.some(hit => hit.url === `/tail?kind=${kind}&path=%2Fdocs`), `native ${kind} on page close`).toBe(true);
    }
    if (condition === 'ordinary') {
      expect(hits().length).toBeGreaterThan(0);
      expect(hits().some(hit => (hit.url + hit.body).includes('en=page_view'))).toBe(true);
    } else {
      expect(received.filter(hit => !hit.url.startsWith('/tail?'))).toEqual([]);
      expect(observations.every(state => state.disabled)).toBe(true);
    }
  });
}
