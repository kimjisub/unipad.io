import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
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

async function expectPlaybackSettings(page: Page, feedback: boolean) {
  await expectPads(page);
  await expect.poll(() => playbackSettings(page)).toEqual({ feedbackLight: String(feedback), watermark: 'false', volumeLevel: '2' });
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Feedback Light', exact: true }).locator('div.absolute')).toHaveCSS('left', feedback ? '18px' : '2px');
  await expect(page.getByRole('button', { name: 'Watermark', exact: true }).locator('div.absolute')).toHaveCSS('left', '2px');
  await expect(page.locator('input[type=range][max="7"]')).toHaveValue('2');
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  // The actual press overlay uses feedbackLightRef, while the switch uses React state.
  await page.keyboard.down('q');
  await expect(pressed(page, '1,0')).toHaveCount(feedback ? 1 : 0);
  await page.keyboard.up('q');
}

for (const keyLedExist of [true, false]) {
  for (const saved of [null, 'true', 'false']) {
    for (const lifecycle of ['direct', 'reload', 'reopen', 'changed'] as const) {
      test(`saved feedback ${saved ?? 'default'} survives ${lifecycle} with pack LEDs ${keyLedExist}`, async ({ page }, info) => {
        await page.goto('/play', { waitUntil: 'domcontentloaded' });
        const input = page.locator('input[type=file][accept=".zip,.uni"]');
        await input.waitFor({ state: 'attached' });
        await playbackSettings(page, { feedbackLight: saved, watermark: 'false', volumeLevel: '2' });
        await input.setInputFiles(resolve(`e2e/fixtures/${keyLedExist ? 'basic' : 'multi-touch'}.uni`));
        await expect(page).toHaveURL(/pack=/);
        const url = page.url();
        const initial = saved === null ? !keyLedExist : saved === 'true';
        await expectPlaybackSettings(page, initial);

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
        await expectPlaybackSettings(page, lifecycle === 'changed' ? !initial : initial);
        await info.attach(`${lifecycle}-screen`, { body: await page.screenshot(), contentType: 'image/png' });
        await info.attach(`${lifecycle}-storage`, { body: JSON.stringify(await playbackSettings(page)), contentType: 'application/json' });
      });
    }
  }
}

for (const keyLedExist of [true, false]) {
  for (const enabled of [true, false]) {
    test(`browser restart preserves feedback ${enabled} with pack LEDs ${keyLedExist}`, async ({ browser, baseURL }, info) => {
      test.skip(info.project.name !== 'chromium', 'Persistent-profile restart is checked in Chromium');
      const profile = info.outputPath('browser-profile');
      const errors: string[] = [];
      const open = async () => {
        const context = await browser.browserType().launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.hostname === 'firebaseinstallations.googleapis.com') return route.fulfill({ json: { fid: 'cAAAAAAAAAAAAAAAAAAAAA', refreshToken: 'FAKE_REFRESH_TOKEN', authToken: { token: 'FAKE_INSTALLATION_TOKEN', expiresIn: '604800s' } } });
          if (url.hostname === 'firebase.googleapis.com') return route.fulfill({ json: { appId: '1:000000000000:web:fake-ci-placeholder', measurementId: 'G-FAKE-CI' } });
          return url.origin === baseURL ? route.continue() : route.abort('blockedbyclient');
        });
        await context.routeWebSocket(/.*/, socket => socket.close());
        const page = context.pages()[0];
        page.on('pageerror', error => errors.push(error.message));
        await installBrowserProbe(page);
        return { context, page };
      };
      let current = await open();
      try {
        await current.page.goto(`${baseURL}/play`, { waitUntil: 'domcontentloaded' });
        const input = current.page.locator('input[type=file][accept=".zip,.uni"]');
        await input.waitFor({ state: 'attached' });
        await playbackSettings(current.page, { feedbackLight: String(enabled), watermark: 'false', volumeLevel: '2' });
        await input.setInputFiles(resolve(`e2e/fixtures/${keyLedExist ? 'basic' : 'multi-touch'}.uni`));
        await expect(current.page).toHaveURL(/pack=/);
        const url = current.page.url();
        await expectPlaybackSettings(current.page, enabled);
        await current.context.close();
        current = await open();
        await current.page.goto(url, { waitUntil: 'domcontentloaded' });
        await expectPlaybackSettings(current.page, enabled);
        await info.attach(`restart-${enabled}-screen`, { body: await current.page.screenshot(), contentType: 'image/png' });
        await info.attach(`restart-${enabled}-storage`, { body: JSON.stringify(await playbackSettings(current.page)), contentType: 'application/json' });
        expect(errors).toEqual([]);
      } finally {
        await current.context.close();
        await rm(profile, { recursive: true, force: true });
      }
    });
  }
}
