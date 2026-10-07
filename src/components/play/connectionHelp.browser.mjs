// Local Chromium regression and before/after captures. No physical MIDI or network.
// PLAYER_URL=http://localhost:3195 SCREENSHOT_DIR=<run scratch> BASELINE=1 node ...
import { chromium, expect } from '@playwright/test';
import { resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
const url = process.env.PLAYER_URL;
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Use a local PLAYER_URL');
const captures = process.env.SCREENSHOT_DIR;
if (captures) await mkdir(captures, { recursive: true });
const browser = await chromium.launch({ args: ['--mute-audio'] });
try {
  for (const locale of ['en', 'ko']) for (const [width, height] of [[1440, 900], [844, 390]]) {
    if (process.env.REGRESSION_CASE && (locale !== 'en' || width !== 844)) continue;
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const request = new URL(route.request().url());
      if (request.hostname === 'firebaseinstallations.googleapis.com') return route.fulfill({ json: { fid: 'cAAAAAAAAAAAAAAAAAAAAA', refreshToken: 'FAKE_REFRESH_TOKEN', authToken: { token: 'FAKE_INSTALLATION_TOKEN', expiresIn: '604800s' } } });
      if (request.hostname === 'firebase.googleapis.com') return route.fulfill({ json: { appId: '1:000000000000:web:fake-ci-placeholder', measurementId: 'G-FAKE-CI' } });
      return request.origin === new URL(url).origin ? route.continue() : route.abort('blockedbyclient');
    });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined, configurable: true });
      window.helpWrites = [];
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...args) { window.helpWrites.push(args); return setItem.apply(this, args); };
    });
    await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: new URL(url).origin }]);
    await page.goto(url);
    await page.locator('input[accept=".zip,.uni"]').setInputFiles(resolve('e2e/fixtures/basic.uni'));
    await expect(page.locator('[data-pad]')).toHaveCount(64);
    await page.getByRole('button', { name: locale === 'en' ? 'Open menu' : '메뉴 열기', exact: true }).click();
    const settingsName = locale === 'en' ? 'Launchpad Settings' : '런치패드 설정';
    await page.getByText(settingsName, { exact: true }).click();
    const settings = page.getByRole('dialog', { name: settingsName, exact: true });
    await expect(settings).toBeVisible();
    if (captures) await page.screenshot({ path: join(captures, `${process.env.BASELINE ? 'before' : 'after'}-${locale}-${width}.png`) });
    if (!process.env.BASELINE) {
      const helpName = locale === 'en' ? 'Connection and light help' : '연결·불빛 도움말';
      const entry = settings.getByRole('button', { name: helpName, exact: true });
      await entry.scrollIntoViewIfNeeded();
      const scroll = await settings.locator('div.overflow-y-auto').evaluate(e => e.scrollTop);
      const storage = await page.evaluate(() => ({ ...localStorage }));
      const writes = await page.evaluate(() => window.helpWrites.length);
      const help = page.getByRole('dialog', { name: helpName, exact: true });
      if (process.env.REGRESSION_CASE !== 'reverse-tab') {
        await entry.focus();
        await page.keyboard.press('Space');
        if (captures) await page.screenshot({ path: join(captures, `entry-space-${process.env.CAPTURE_PHASE ?? 'after'}-${locale}-${width}.png`) });
        await expect(help).toBeVisible();
        const autoPlay = page.getByRole('button', { name: locale === 'en' ? 'Play mode: Auto' : '연주 모드: 자동', exact: true });
        await expect(autoPlay.first()).toBeAttached();
        await expect(autoPlay.and(page.locator('[aria-pressed="true"]'))).toHaveCount(0);
        if (process.env.REGRESSION_CASE === 'entry-space') {
          console.log('PASS help entry opens with Space without starting auto-play');
          await context.close();
          continue;
        }
      } else {
        await entry.click();
      }
      const close = help.getByRole('button', { name: locale === 'en' ? 'Close help' : '도움말 닫기', exact: true });
      await expect(close).toBeFocused();
      await expect(help).toContainText(locale === 'en' ? 'Selected model: Auto Detect' : '선택한 기종: 자동 감지');
      await expect(help.getByRole('button')).toHaveCount(1);
      await page.keyboard.press('Tab');
      await expect(help.getByRole('region')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(help.getByRole('region')).toBeFocused();
      // Only the body scrolls: its last paragraph and the fixed header stay reachable.
      if (captures) await page.screenshot({ path: join(captures, `help-auto-start-${locale}-${width}.png`) });
      const body = help.getByRole('region');
      await body.evaluate(e => { e.scrollTop = e.scrollHeight; });
      await expect(body.locator('p').last()).toBeInViewport({ ratio: 1 });
      await expect(help.getByRole('heading').first()).toBeInViewport({ ratio: 1 });
      await expect(close).toBeInViewport({ ratio: 1 });
      if (captures) await page.screenshot({ path: join(captures, `help-auto-${locale}-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(help).toHaveCount(0);
      await expect(entry).toBeFocused();
      expect(await settings.locator('div.overflow-y-auto').evaluate(e => e.scrollTop)).toBe(scroll);
      expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(storage);
      expect(await page.evaluate(() => window.helpWrites.length)).toBe(writes);
      await expect(settings.getByRole('button', { name: locale === 'en' ? 'Connect' : '연결', exact: true })).toBeVisible();
      await settings.getByRole('combobox').selectOption('launchpad_mini_mk3');
      await entry.click();
      const guide = help.getByRole('button', { name: locale === 'en' ? "Read the manufacturer's guide" : '제조사 설명 보기', exact: true });
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(guide).toBeFocused();
      if (captures) await page.screenshot({ path: join(captures, `reverse-tab-${process.env.CAPTURE_PHASE ?? 'after'}-${locale}-${width}.png`) });
      const guideVisible = await guide.evaluate(button => {
        const bounds = button.getBoundingClientRect();
        const body = button.closest('[role=region]').getBoundingClientRect();
        return bounds.top >= body.top && bounds.bottom <= body.bottom && bounds.left >= body.left && bounds.right <= body.right;
      });
      expect(guideVisible, 'Shift+Tab must scroll the manufacturer button inside the help body').toBe(true);
      await expect(guide).toBeInViewport({ ratio: 1 });
      if (process.env.REGRESSION_CASE === 'reverse-tab') {
        console.log('PASS immediate Shift+Tab reveals the manufacturer button');
        await context.close();
        continue;
      }
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(guide).toBeFocused();
      await page.evaluate(() => { window.open = () => null; });
      await guide.click();
      await expect(help.getByRole('alert')).toBeVisible();
      await expect(page.locator('select')).toHaveValue('launchpad_mini_mk3');
      // Large text still leaves the selected model, close and body accessible.
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await body.evaluate(e => { e.scrollTop = 0; });
      await close.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(guide).toBeFocused();
      expect(await guide.evaluate(button => {
        const bounds = button.getBoundingClientRect();
        const body = button.closest('[role=region]').getBoundingClientRect();
        return bounds.top >= body.top && bounds.bottom <= body.bottom;
      }), 'large-text keyboard focus must reveal the full button').toBe(true);
      await expect(guide).toBeInViewport({ ratio: 1 });
      await expect(close).toBeInViewport({ ratio: 1 });
      await expect(help.getByRole('heading').first()).toBeInViewport({ ratio: 1 });
      await expect(help.locator('p').first()).toBeInViewport({ ratio: 1 });
      if (captures) await page.screenshot({ path: join(captures, `help-mini-large-${locale}-${width}.png`) });
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await page.goBack();
      await expect(help).toHaveCount(0);
      await expect(entry).toBeFocused();
      if (locale === 'en' && width === 1440) {
        // Connect only on an explicit user click, using inert browser MIDI.
        await page.evaluate(() => {
          window.helpMidi = { requests: 0, messages: [] };
          const output = { id: 'mini', name: 'Launchpad Mini MK3 Test Output', send: data => window.helpMidi.messages.push(Array.from(data)) };
          const input = { id: 'mini-input', name: 'Launchpad Mini MK3 Test Input', onmidimessage: null };
          const access = { inputs: new Map([['mini-input', input]]), outputs: new Map([['mini', output]]), onstatechange: null };
          Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { window.helpMidi.requests++; return access; } });
        });
        await settings.getByRole('button', { name: 'Connect', exact: true }).click();
        await expect(settings.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
        await expect(settings.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
        await settings.getByRole('combobox').selectOption('auto');
        await expect(settings).toContainText('Resolved Type: launchpad_mini_mk3');
        // Existing explicit model selection sends delayed init bytes; let those
        // finish before comparing the help-only interval.
        await page.waitForTimeout(250);
        const before = await page.evaluate(() => JSON.stringify({ midi: window.helpMidi, storage: { ...localStorage }, writes: window.helpWrites }));
        await entry.click();
        await expect(help).toContainText('Selected model: Auto Detect');
        await expect(help).not.toContainText('In Programmer mode');
        const otherPage = await context.newPage();
        await otherPage.goto('about:blank');
        await page.bringToFront();
        await expect(help).toBeVisible();
        await otherPage.close();
        await close.focus();
        await page.keyboard.press('Space');
        await expect(help).toHaveCount(0);
        await expect(entry).toBeFocused();
        expect(await page.evaluate(() => JSON.stringify({ midi: window.helpMidi, storage: { ...localStorage }, writes: window.helpWrites }))).toBe(before);
        console.log('PASS connected auto resolving to Mini: no new MIDI request/message/storage write; tab return preserves help');
      }
      await settings.getByRole('button', { name: locale === 'en' ? 'Close' : '닫기', exact: true }).click();
      await expect(page.locator('[data-pad]')).toHaveCount(64);
    }
    expect(errors).toEqual([]);
    console.log(`PASS ${process.env.BASELINE ? 'before capture' : 'help, keyboard, scroll, storage, Mini, back and large text'} ${locale} ${width}x${height}`);
    await context.close();
  }
} finally { await browser.close(); }
