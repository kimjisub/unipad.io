import { rm, readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { test as restartTest, type BrowserContext, type BrowserType, type Page, type TestInfo } from '@playwright/test';
import { test, expect, expectPads, installBrowserProbe } from './browser';

const pressed = (page: Page, position: string) => page.locator(`[data-pad="${position}"] img[src="/theme/btn_.png"]`);

async function playbackSettings(page: Page, values?: Record<string, string | null>) {
  return page.evaluate(async values => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('unipad');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const keys = ['feedbackLight', 'watermark', 'volumeLevel'];
      if (values) await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        for (const [key, value] of Object.entries(values)) {
          if (value === null) tx.objectStore('settings').delete(key);
          else tx.objectStore('settings').put({ key, value });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return Object.fromEntries(await Promise.all(keys.map(key => new Promise<[string, string | null]>((resolve, reject) => {
        const request = db.transaction('settings').objectStore('settings').get(key);
        request.onsuccess = () => resolve([key, request.result?.value ?? null]);
        request.onerror = () => reject(request.error);
      }))));
    } finally { db.close(); }
  }, values);
}

async function expectPlaybackSettings(page: Page, feedback: boolean, stored: string | null = String(feedback)) {
  await expectPads(page);
  await expect.poll(() => playbackSettings(page)).toEqual({ feedbackLight: stored, watermark: 'false', volumeLevel: '2' });
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Feedback Light', exact: true }).locator('div.absolute')).toHaveCSS('left', feedback ? '18px' : '2px');
  await expect(page.getByRole('button', { name: 'Watermark', exact: true }).locator('div.absolute')).toHaveCSS('left', '2px');
  await expect(page.locator('input[type=range][max="7"]')).toHaveValue('2');
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Menu', exact: true })).toHaveCount(0);
  // The actual press overlay uses feedbackLightRef, while the switch uses React state.
  await page.keyboard.down('q');
  await expect(pressed(page, '1,0')).toHaveCount(feedback ? 1 : 0);
  await page.keyboard.up('q');
}

async function expectFeedback(page: Page, enabled: boolean, stored: string | null) {
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Feedback Light', exact: true }).locator('div.absolute')).toHaveCSS('left', enabled ? '18px' : '2px');
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Menu', exact: true })).toHaveCount(0);
  await page.keyboard.down('q');
  try { await expect(pressed(page, '1,0')).toHaveCount(enabled ? 1 : 0); }
  finally { await page.keyboard.up('q'); }
  await expect.poll(async () => (await playbackSettings(page)).feedbackLight).toBe(stored);
}

async function openFeedbackModePack(page: Page, leds: boolean, saved: string | null, short = false) {
  await page.goto('/play', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file][accept=".zip,.uni"]').waitFor({ state: 'attached' });
  await playbackSettings(page, { feedbackLight: saved, watermark: 'false', volumeLevel: '2' });
  const zip = await JSZip.loadAsync(await readFile('e2e/fixtures/basic.uni'));
  if (!leds) zip.remove('keyLED');
  zip.file('autoPlay', short ? 'd 1000\no 1 1\nd 50\nf 1 1\n' : 'd 1000\no 1 1\nd 50\nf 1 1\n'.repeat(30));
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({ name: 'feedback.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expectPads(page);
  await expect(page).toHaveURL(/pack=/);
}
const playMode = (page: Page, label: string) => page.getByRole('button', { name: `Play mode: ${label}`, exact: true });

for (const leds of [true, false]) for (const saved of [null, 'true', 'false']) {
  test(`mode transitions preserve feedback: LEDs ${leds}, saved ${saved}`, async ({ page }, info) => {
    await openFeedbackModePack(page, leds, saved);
    await playMode(page, 'Auto').click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await info.attach('mode-screen', { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach('mode-storage', { body: JSON.stringify(await playbackSettings(page)), contentType: 'application/json' });
    await expectFeedback(page, !leds, saved);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await playMode(page, 'Guide').click();
    await expectFeedback(page, !leds, saved);
    await playMode(page, 'Step').click();
    await expectFeedback(page, !leds, saved);
    await playMode(page, 'Step').click();
    await expectFeedback(page, saved === null ? !leds : saved === 'true', saved);
    await info.attach('exit-screen', { body: await page.screenshot(), contentType: 'image/png' });
  });
  test(`direct feedback choice survives pause restart exit and reload: LEDs ${leds}, saved ${saved}`, async ({ page }, info) => {
    await openFeedbackModePack(page, leds, saved);
    await playMode(page, 'Auto').click();
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    await expectFeedback(page, leds, String(leds));
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expectFeedback(page, leds, String(leds));
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expectFeedback(page, !leds, String(leds));
    await playMode(page, 'Auto').click();
    await expectFeedback(page, leds, String(leds));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectPads(page);
    await expectFeedback(page, leds, String(leds));
    await info.attach('choice-screen', { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach('choice-storage', { body: JSON.stringify(await playbackSettings(page)), contentType: 'application/json' });
  });
  test(`natural mode end restores feedback: LEDs ${leds}, saved ${saved}`, async ({ page }, info) => {
    await openFeedbackModePack(page, leds, saved, true);
    await playMode(page, 'Auto').click();
    await expect(playMode(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
    await expect(playMode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
    await expectFeedback(page, saved === null ? !leds : saved === 'true', saved);
    await info.attach('natural-end-screen', { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach('natural-end-storage', { body: JSON.stringify(await playbackSettings(page)), contentType: 'application/json' });
  });
}

async function importPlaybackPack(page: Page, keyLedExist: boolean) {
  const zip = await JSZip.loadAsync(await readFile(`e2e/fixtures/${keyLedExist ? 'basic' : 'multi-touch'}.uni`));
  if (!keyLedExist) zip.file('autoPlay', 'd 1000\no 1 1\nd 50\nf 1 1\n'.repeat(10));
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({ name: 'settings.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  // Import decodes audio before saving the pack and updating its URL.
  // Keep the URL assertion focused on persistence after loading completes.
  await expectPads(page);
  await expect(page).toHaveURL(/pack=/);
  return page.url();
}

for (const order of [[true, false], [false, true]]) {
  test(`absent feedback preference follows each pack in order ${order}`, async ({ page }, info) => {
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await page.locator('input[type=file][accept=".zip,.uni"]').waitFor({ state: 'attached' });
    await playbackSettings(page, { feedbackLight: null });
    for (const leds of order) {
      await importPlaybackPack(page, leds);
      await expectFeedback(page, !leds, null);
      await info.attach(`pack-leds-${leds}`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.getByRole('button', { name: 'Quit', exact: true }).click();
    }
    expect((await playbackSettings(page)).feedbackLight).toBeNull();
  });
}

test('settings import waits for native audio decoding before checking the saved URL', async ({ page }, info) => {
  await page.addInitScript(() => {
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (...args: Parameters<typeof decode>) {
      const buffer = await decode.apply(this, args);
      await new Promise(resolve => setTimeout(resolve, 6000));
      return buffer;
    };
  });
  await page.goto('/play', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=file][accept=".zip,.uni"]').waitFor({ state: 'attached' });
  await playbackSettings(page, { feedbackLight: 'false', watermark: 'false', volumeLevel: '2' });
  await importPlaybackPack(page, true);
  await expectPlaybackSettings(page, false);
  await info.attach('delayed-import-storage', { body: JSON.stringify(await playbackSettings(page)), contentType: 'application/json' });
});

async function launchRestartProfile(browserType: BrowserType, profile: string, args: string[] = []) {
  return browserType.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1280, height: 800 }, serviceWorkers: 'block',
    // Once started, best-effort file work can block shutdown at background priority.
    // Defer it so Chromium skips nonessential queued work when shutting down.
    args: ['--disable-best-effort-tasks', ...args],
  });
}

function recordProfilePhase(info: TestInfo, phase: string) {
  info.annotations.push({ type: 'profile-lifecycle', description: JSON.stringify({ phase, atMs: performance.now() }) });
}

async function closeRestartProfile(page: Page, info: TestInfo, captureFailure = info.status !== info.expectedStatus) {
  if (captureFailure) {
    await restartTest.step('Capture the failed page before browser exit', async () => {
      try {
        await info.attach('before-browser-exit-screen', { body: await page.screenshot({ timeout: 5000 }), contentType: 'image/png' });
      } catch (error) {
        // A diagnostic must not replace the assertion that failed, or prevent browser cleanup.
        info.annotations.push({ type: 'browser-exit-screenshot', description: String(error) });
      }
    });
  }
  // Persistent context.close() waits for its browser process to exit.
  recordProfilePhase(info, 'close-requested');
  await restartTest.step('Exit the persistent browser process', () => page.context().close());
  recordProfilePhase(info, 'process-exit-confirmed');
}

type NativeTask = {
  name: string;
  args?: { thread_pool_task?: { task_priority: string }; src_file?: string; src_func?: string };
};

async function startProfileTaskTrace(context: BrowserContext) {
  const session = await context.browser()!.newBrowserCDPSession();
  const chunks: unknown[] = [];
  session.on('Tracing.dataCollected', ({ value }) => chunks.push(...value));
  try {
    await session.send('Tracing.start', { transferMode: 'ReportEvents' });
  } catch (error) {
    // Chromium adopts the startup session before reporting that it is already running.
    // Tracing.end must still deliver that session without data loss.
    if (!String(error).includes('Tracing has already been started')) throw error;
  }
  return async () => {
    const complete = new Promise<{ dataLossOccurred?: boolean }>(resolve => session.once('Tracing.tracingComplete', resolve));
    await session.send('Tracing.end');
    const result = await complete;
    await session.detach();
    const traceEvents = chunks.flatMap(value => {
      const chunk = value as NativeTask | { traceEvents: NativeTask[] };
      return 'traceEvents' in chunk ? chunk.traceEvents : [chunk];
    });
    return { traceEvents, dataLossOccurred: result.dataLossOccurred };
  };
}

function restartProfileTest(traceStartup = false) {
  let profile: string | undefined;
  let profileClosed = true;
  const profileTest = restartTest.extend<{ restartContext: BrowserContext }>({
    restartContext: [async ({ playwright, browserName }, provide, info) => {
      restartTest.skip(browserName !== 'chromium', 'Persistent-profile restart is checked in Chromium');
      profile ??= info.outputPath('browser-profile');
      const args = traceStartup ? ['--trace-startup=toplevel,scheduler', '--trace-startup-owner=devtools', '--trace-startup-format=json', '--trace-startup-duration=0'] : [];
      profileClosed = false;
      recordProfilePhase(info, 'launch-requested');
      const context = await restartTest.step('Launch the persistent browser', () => launchRestartProfile(playwright[browserName], profile!, args));
      recordProfilePhase(info, 'launch-ready');
      context.browser()!.once('disconnected', () => recordProfilePhase(info, 'browser-disconnected'));
      const page = context.pages()[0];
      let stopTrace: Awaited<ReturnType<typeof startProfileTaskTrace>> | undefined;
      let trace: { traceEvents: NativeTask[]; dataLossOccurred?: boolean } | undefined;
      try {
        if (traceStartup) stopTrace = await startProfileTaskTrace(context);
        await provide(context);
      } finally {
        recordProfilePhase(info, 'body-finished');
        try {
          if (stopTrace) {
            trace = await stopTrace();
            recordProfilePhase(info, 'native-trace-finished');
            await info.attach('browser-startup-tasks', { body: JSON.stringify(trace), contentType: 'application/json' });
          }
        } finally {
          await closeRestartProfile(page, info);
          profileClosed = true;
        }
      }
      if (trace) {
        // Check recorded work, not the command-line switch we supplied. Reject incomplete traces.
        expect(trace.dataLossOccurred).toBe(false);
        const tasks = trace.traceEvents.filter(event => event.name === 'ThreadPool_RunTask');
        expect(tasks.some(event => event.args?.thread_pool_task)).toBe(true);
        expect(tasks.filter(event => event.args?.thread_pool_task?.task_priority === 'PRIORITY_BEST_EFFORT').map(event => event.args)).toEqual([]);
      }
    }, { timeout: 30_000 }],
  });
  // Startup, assertions, and shutdown each retain a 30-second deadline.
  // Starting the real browser must not consume the assertion body's budget.
  profileTest.afterAll(async () => {
    // A timed-out close must not delete files still owned by the browser.
    if (profile && profileClosed) await rm(profile, { recursive: true, force: true });
  });
  return profileTest;
}

for (const keyLedExist of [true, false]) {
  for (const saved of [null, 'true', 'false']) {
    for (const lifecycle of ['direct', 'reload', 'reopen', 'changed'] as const) {
      test(`saved feedback ${saved ?? 'default'} survives ${lifecycle} with pack LEDs ${keyLedExist}`, async ({ page }, info) => {
        await page.goto('/play', { waitUntil: 'domcontentloaded' });
        const input = page.locator('input[type=file][accept=".zip,.uni"]');
        await input.waitFor({ state: 'attached' });
        await playbackSettings(page, { feedbackLight: saved, watermark: 'false', volumeLevel: '2' });
        const url = await importPlaybackPack(page, keyLedExist);
        const initial = saved === null ? !keyLedExist : saved === 'true';
        await expectPlaybackSettings(page, initial, saved);

        if (lifecycle === 'direct') {
          await page.goto('about:blank');
          await page.goto(url, { waitUntil: 'domcontentloaded' });
        } else if (lifecycle === 'reload') {
          await page.reload({ waitUntil: 'domcontentloaded' });
        } else if (lifecycle === 'reopen') {
          await page.getByRole('button', { name: 'Open menu', exact: true }).click();
          await page.getByRole('button', { name: 'Quit', exact: true }).click();
          await page.getByRole('option', { name: keyLedExist ? 'Browser Test Pack by UniPad Tests' : 'Multi Touch Test Pack by UniPad Tests', exact: true }).dblclick();
        } else {
          await page.getByRole('button', { name: 'Feedback', exact: true }).click();
          await expect.poll(() => playbackSettings(page)).toEqual({ feedbackLight: String(!initial), watermark: 'false', volumeLevel: '2' });
          await page.reload({ waitUntil: 'domcontentloaded' });
        }
        await expectPlaybackSettings(page, lifecycle === 'changed' ? !initial : initial, lifecycle === 'changed' ? String(!initial) : saved);
        await info.attach(`${lifecycle}-screen`, { body: await page.screenshot(), contentType: 'image/png' });
        await info.attach(`${lifecycle}-storage`, { body: JSON.stringify(await playbackSettings(page)), contentType: 'application/json' });
      });
    }
  }
}

for (const keyLedExist of [true, false]) {
  for (const enabled of [null, 'true', 'false']) {
    // Importing a pack and restoring an existing profile are separate operations.
    // Each keeps the normal test deadline, without creating an unused page/context.
    restartTest.describe.serial(`browser restart preserves feedback ${enabled} with pack LEDs ${keyLedExist}`, () => {
      let url: string;
      const prepare = async (context: BrowserContext, baseURL: string) => {
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.hostname === 'firebaseinstallations.googleapis.com') return route.fulfill({ json: { fid: 'cAAAAAAAAAAAAAAAAAAAAA', refreshToken: 'FAKE_REFRESH_TOKEN', authToken: { token: 'FAKE_INSTALLATION_TOKEN', expiresIn: '604800s' } } });
          if (url.hostname === 'firebase.googleapis.com') return route.fulfill({ json: { appId: '1:000000000000:web:fake-ci-placeholder', measurementId: 'G-FAKE-CI' } });
          return url.origin === baseURL ? route.continue() : route.abort('blockedbyclient');
        });
        await context.routeWebSocket(/.*/, socket => socket.close());
        const page = context.pages()[0];
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await installBrowserProbe(page);
        return { context, page, errors };
      };
      const profileTest = restartProfileTest().extend<{ current: Awaited<ReturnType<typeof prepare>> }>({
        current: async ({ restartContext, baseURL }, provide) => {
          await provide(await prepare(restartContext, baseURL!));
        },
      });
      profileTest('imports and saves the starting profile', async ({ current, baseURL }, info) => {
        await current.page.goto(`${baseURL}/play`, { waitUntil: 'domcontentloaded' });
        await current.page.locator('input[type=file][accept=".zip,.uni"]').waitFor({ state: 'attached' });
        await playbackSettings(current.page, { feedbackLight: enabled, watermark: 'false', volumeLevel: '2' });
        url = await importPlaybackPack(current.page, keyLedExist);
        await expectPlaybackSettings(current.page, enabled === null ? !keyLedExist : enabled === 'true', enabled);
        await current.page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
        await current.page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
        await expectPlaybackSettings(current.page, enabled === null ? !keyLedExist : enabled === 'true', enabled);
        await info.attach('before-restart-storage', { body: JSON.stringify(await playbackSettings(current.page)), contentType: 'application/json' });
        expect(current.errors).toEqual([]);
      });
      profileTest('restores the profile after the browser process exits', async ({ current }, info) => {
        await current.page.goto(url, { waitUntil: 'domcontentloaded' });
        await expectPlaybackSettings(current.page, enabled === null ? !keyLedExist : enabled === 'true', enabled);
        await info.attach(`restart-${enabled}-screen`, { body: await current.page.screenshot(), contentType: 'image/png' });
        await info.attach(`restart-${enabled}-storage`, { body: JSON.stringify(await playbackSettings(current.page)), contentType: 'application/json' });
        expect(current.errors).toEqual([]);
      });
    });
  }
}

restartTest('cleanup exits the profile when its diagnostic screenshot fails', async ({ playwright, browserName }, info) => {
  restartTest.skip(browserName !== 'chromium', 'Persistent-profile restart is checked in Chromium');
  const profile = info.outputPath('closed-page-profile');
  const context = await launchRestartProfile(playwright.chromium, profile);
  const page = context.pages()[0];
  await page.close();
  await closeRestartProfile(page, info, true);
  await rm(profile, { recursive: true, force: true });
  expect(context.browser()!.isConnected()).toBe(false);
  expect(info.annotations).toContainEqual(expect.objectContaining({ type: 'browser-exit-screenshot' }));
});

restartTest.describe.serial('restart profiles preserve IndexedDB without background maintenance', () => {
  const profileTest = restartProfileTest(true);
  for (const restore of [false, true]) {
    profileTest(restore ? 'restores the saved settings after process exit' : 'saves settings and exits the process', async ({ restartContext }, info) => {
      // A local synthetic page isolates browser bookkeeping from the application and its audio.
      await restartContext.route('http://profile.test/**', route => route.fulfill({ contentType: 'text/html', body: '<button>Save</button>' }));
      const page = restartContext.pages()[0];
      await page.goto('http://profile.test/');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      if (!restore) {
        await page.evaluate(() => new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('unipad', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('settings', { keyPath: 'key' });
          request.onsuccess = () => { request.result.close(); resolve(); };
          request.onerror = () => reject(request.error);
        }));
        await playbackSettings(page, { feedbackLight: 'true', watermark: 'false', volumeLevel: '2' });
      }
      expect(await playbackSettings(page)).toEqual({ feedbackLight: 'true', watermark: 'false', volumeLevel: '2' });
      await info.attach('native-profile-storage', { body: JSON.stringify(await playbackSettings(page)), contentType: 'application/json' });
    });
  }
});
