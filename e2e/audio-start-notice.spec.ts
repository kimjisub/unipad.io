import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Locator, type Page, type TestInfo } from '@playwright/test';
import { test, expect, expectAudioOutputRunning, installBrowserProbe, stateTimeout } from './browser';
import { themeFile, themeSetting } from './saved-packs';
import { longTone, openBasicWith } from './basic-pack';
import { freezeClock, installAudioGate, notice, noticeAnnouncements, openWithStoppedOutput, recordNoticeAnnouncements } from './audio-gate';

const mode = (page: Page, name: 'Auto' | 'Guide' | 'Step') => page.getByRole('button', { name: `Play mode: ${name}`, exact: true });
const starts = (page: Page) => page.evaluate(() => window.browserProbe.audio.starts.length);
const gateCalls = (page: Page) => page.evaluate(() => window.audioGate.calls);
const settle = (page: Page, outcome: 'resolve' | 'reject' | 'idle') => page.evaluate(o => window.audioGate.settle(o), outcome);

const titles = {
  preparing: 'Preparing audio', retrying: 'Preparing audio again', failed: 'Couldn’t start audio', delayed: 'Audio is taking longer',
};

async function expectNotice(page: Page, state: keyof typeof titles) {
  const dialog = notice(page);
  await expect(dialog.getByRole('heading')).toHaveText(titles[state]);
  const pending = state === 'preparing' || state === 'retrying';
  await expect(dialog.getByRole('button')).toHaveText(pending ? ['Cancel'] : ['Dismiss', 'Try again']);
}

/** Runs page time in steps; nothing is playing, so each step is quick. */
async function advance(page: Page, ms: number) {
  for (let run = 0; run < ms; run += 500) await page.clock.runFor(Math.min(500, ms - run));
}

/**
 * Autoplay started: the mode is on and its first press sounds (basic.uni presses after 1 s). The
 * timing being tested has passed by then, and stepping a playing song's timers takes seconds per
 * step on a busy machine, so the page clock runs on by itself from here.
 */
async function expectAutoplayStarted(page: Page, before: number) {
  await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.resume();
  await expect.poll(() => starts(page), { timeout: stateTimeout }).toBeGreaterThan(before);
}

/** Nothing started: no mode on, no sound, over `ms` of page time. */
async function expectNothingStarted(page: Page, before: number, ms = 6000) {
  await advance(page, ms);
  for (const name of ['Auto', 'Guide', 'Step'] as const) await expect(mode(page, name)).toHaveAttribute('aria-pressed', 'false');
  expect(await starts(page), 'sounds started after the request ended').toBe(before);
}

async function attachState(page: Page, info: TestInfo, name: string) {
  await info.attach(`${name}.png`, { body: await page.screenshot(), contentType: 'image/png' });
}

test.describe('audio start notice', () => {
  test('a refused start shows the failure at once; Try again prepares anew and starts once', async ({ page }, info) => {
    await openWithStoppedOutput(page, 'reject');
    const before = await starts(page);
    await mode(page, 'Auto').dispatchEvent('click');
    await page.clock.runFor(1);
    await expectNotice(page, 'failed');
    await attachState(page, info, 'failed');
    await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
    expect(await gateCalls(page)).toBe(1);
    await page.evaluate(() => { window.audioGate.mode = 'hold'; });
    await notice(page).getByRole('button', { name: 'Try again' }).dispatchEvent('click');
    await expectNotice(page, 'retrying');
    await expect(notice(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    expect(await gateCalls(page)).toBe(2);
    expect(await settle(page, 'resolve')).toBe(1);
    await expect(notice(page)).toHaveCount(0);
    await expectAutoplayStarted(page, before);
    expect(await gateCalls(page)).toBe(2);
  });

  test('a reply whose output still does not run fails the same way', async ({ page }) => {
    await openWithStoppedOutput(page, 'idle');
    const before = await starts(page);
    await mode(page, 'Guide').dispatchEvent('click');
    await page.clock.runFor(1);
    await expectNotice(page, 'failed');
    await notice(page).getByRole('button', { name: 'Dismiss' }).dispatchEvent('click');
    await expect(notice(page)).toHaveCount(0);
    await expectNothingStarted(page, before);
  });

  test('a preparation that never ends shows at 0.3 s, expires at 5 s, and its late reply starts nothing', async ({ page }, info) => {
    await openWithStoppedOutput(page, 'hold');
    const before = await starts(page);
    await mode(page, 'Auto').dispatchEvent('click');
    await expect(mode(page, 'Auto')).toHaveAttribute('aria-busy', 'true');
    await page.clock.runFor(299);
    await expect(notice(page)).toHaveCount(0);
    await page.clock.runFor(1);
    await expectNotice(page, 'preparing');
    await expect(notice(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await attachState(page, info, 'preparing');
    await page.clock.runFor(4699);
    await expectNotice(page, 'preparing');
    await page.clock.runFor(1);
    await expectNotice(page, 'delayed');
    await expect(notice(page).getByRole('button', { name: 'Dismiss' })).toBeFocused();
    await attachState(page, info, 'delayed');
    await settle(page, 'resolve');
    await page.clock.runFor(2000);
    await expectNotice(page, 'delayed');
    expect(await starts(page)).toBe(before);
    await notice(page).getByRole('button', { name: 'Dismiss' }).dispatchEvent('click');
    await expectNothingStarted(page, before);
    expect(await gateCalls(page)).toBe(1);
  });

  for (const [at, outcome] of [[299, 'starts without a notice'], [300, 'starts and closes the notice'], [4999, 'starts'], [5000, 'is late'], [5001, 'is late']] as const) {
    test(`a reply at ${at / 1000} s ${outcome}`, async ({ page }) => {
      await openWithStoppedOutput(page, 'hold');
      const before = await starts(page);
      await mode(page, 'Auto').dispatchEvent('click');
      await page.clock.runFor(at);
      await settle(page, 'resolve');
      if (at < 5000) {
        await expect(notice(page)).toHaveCount(0);
        await expectAutoplayStarted(page, before);
        // The notice timer was dropped with the request: nothing appears afterwards.
        await page.waitForTimeout(1000);
        await expect(notice(page)).toHaveCount(0);
      } else {
        await page.clock.runFor(1000);
        await expectNotice(page, 'delayed');
        await expectNothingStarted(page, before, 1000);
      }
      expect(await gateCalls(page)).toBe(1);
    });
  }

  const endings: { name: string; beforeNotice?: boolean; end: (page: Page) => Promise<void> }[] = [
    { name: 'Cancel', end: page => notice(page).getByRole('button', { name: 'Cancel' }).click() },
    { name: 'Escape', end: page => page.keyboard.press('Escape') },
    { name: 'a hidden page', end: page => page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }) },
    { name: 'lost window focus', end: page => page.evaluate(() => { window.dispatchEvent(new Event('blur')); }) },
    { name: 'another dialog', beforeNotice: true, end: async page => {
      await page.getByRole('button', { name: 'Open menu', exact: true }).dispatchEvent('click');
      // The menu row, named with its "Open" hint; the "MIDI ON" badge opens the same dialog only with a controller.
      await page.getByRole('button', { name: 'Launchpad Settings Open', exact: true }).dispatchEvent('click');
      await expect(page.getByRole('dialog', { name: 'Launchpad Settings', exact: true })).toBeVisible();
    } },
    { name: 'leaving the pack', beforeNotice: true, end: async page => {
      await page.getByRole('button', { name: 'Open menu', exact: true }).dispatchEvent('click');
      await page.getByRole('button', { name: 'Quit', exact: true }).dispatchEvent('click');
      await expect(page.locator('[data-pad]')).toHaveCount(0);
    } },
  ];
  for (const { name, beforeNotice, end } of endings) {
    for (const reply of ['resolve', 'reject'] as const) {
      test(`${name} ends the preparation; a late ${reply === 'resolve' ? 'success' : 'refusal'} changes nothing`, async ({ page }) => {
        await openWithStoppedOutput(page, 'hold');
        const before = await starts(page);
        await mode(page, 'Auto').dispatchEvent('click');
        await page.clock.runFor(beforeNotice ? 100 : 300);
        if (!beforeNotice) await expectNotice(page, 'preparing');
        await end(page);
        await page.clock.runFor(1);
        await expect(notice(page)).toHaveCount(0);
        await settle(page, reply);
        await page.clock.runFor(6000);
        await expect(notice(page)).toHaveCount(0);
        if (await page.locator('[data-pad]').count() > 0) await expectNothingStarted(page, before, 1000);
        expect(await starts(page)).toBe(before);
      });
    }
  }

  test('turning the playing mode off drops a preparation for another mode', async ({ page }) => {
    await openWithStoppedOutput(page, 'hold', async page => {
      await mode(page, 'Auto').click();
      await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
    });
    await mode(page, 'Guide').dispatchEvent('click');
    await page.clock.runFor(100);
    await mode(page, 'Auto').dispatchEvent('click');
    await expect(mode(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
    const before = await starts(page);
    await settle(page, 'resolve');
    await expect(notice(page)).toHaveCount(0);
    await expectNothingStarted(page, before);
  });

  test('repeated starts add no request; input behind the notice does nothing', async ({ page, browserName }) => {
    await openWithStoppedOutput(page, 'hold');
    const before = await starts(page);
    await mode(page, 'Auto').dispatchEvent('click');
    await page.clock.runFor(100);
    await mode(page, 'Auto').dispatchEvent('click');
    await page.keyboard.press(' ');
    await page.keyboard.press('Alt+a');
    expect(await gateCalls(page), 'presses before the notice').toBe(1);
    await page.clock.runFor(200);
    await expectNotice(page, 'preparing');
    // The wait is not extended: it still expires 5 s after the first press.
    await page.clock.runFor(4699);
    await expectNotice(page, 'preparing');
    const autoBox = (await mode(page, 'Auto').boundingBox())!;
    await page.mouse.click(autoBox.x + autoBox.width / 2, autoBox.y + autoBox.height / 2);
    const padBox = (await page.locator('[data-pad="0,0"]').boundingBox())!;
    await page.mouse.click(padBox.x + padBox.width / 2, padBox.y + padBox.height / 2);
    await page.keyboard.press('Alt+a');
    // Pad keys of the computer keyboard.
    for (const key of ['1', 'q', 'a', 'z']) await page.keyboard.press(key);
    if (browserName === 'chromium') {
      await page.evaluate(() => {
        window.browserProbe.midi.emit([0x90, 81, 100]);
        window.browserProbe.midi.emit([0x80, 81, 0]);
      });
    }
    expect(await gateCalls(page), 'presses behind the notice').toBe(1);
    expect(await starts(page), 'pads behind the notice').toBe(before);
    await page.clock.runFor(1);
    await expectNotice(page, 'delayed');
    // Holding Enter on Try again asks once.
    const retry = notice(page).getByRole('button', { name: 'Try again' });
    await retry.focus();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expectNotice(page, 'retrying');
    expect(await gateCalls(page)).toBe(2);
    await expect(notice(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(notice(page)).toHaveCount(0);
    await settle(page, 'resolve');
    await expectNothingStarted(page, before);
  });

  test('the status line announces each state once: the first text after opening, then each change whole', async ({ page }) => {
    await recordNoticeAnnouncements(page);
    await openWithStoppedOutput(page, 'hold');
    await mode(page, 'Auto').dispatchEvent('click');
    await page.clock.runFor(300);
    await expectNotice(page, 'preparing');
    const dialog = notice(page);
    // The dialog itself is named by its title and described by its text.
    await expect(dialog).toHaveAccessibleName('Preparing audio');
    await expect(dialog).toHaveAccessibleDescription('Playback will start when audio is ready.');
    expect(await noticeAnnouncements(page), 'nothing more while the name is read').toEqual([]);
    await page.clock.runFor(500);
    await expect.poll(() => noticeAnnouncements(page)).toEqual(['Playback will start when audio is ready.']);
    await page.clock.runFor(4200);
    await expectNotice(page, 'delayed');
    await page.clock.runFor(300);
    // Refused at once: the notice passes through "preparing again", which is not announced.
    await page.evaluate(() => { window.audioGate.mode = 'reject'; });
    await dialog.getByRole('button', { name: 'Try again' }).dispatchEvent('click');
    await expectNotice(page, 'failed');
    await page.clock.runFor(300);
    // Refused at once again: the same failure is announced again, so the second try is heard to fail too.
    await dialog.getByRole('button', { name: 'Try again' }).dispatchEvent('click');
    await expectNotice(page, 'failed');
    expect(await gateCalls(page), 'the second Try again asked').toBe(3);
    await page.clock.runFor(300);
    await page.evaluate(() => { window.audioGate.mode = 'hold'; });
    await dialog.getByRole('button', { name: 'Try again' }).dispatchEvent('click');
    await expectNotice(page, 'retrying');
    await page.clock.runFor(300);
    expect(await noticeAnnouncements(page)).toEqual([
      'Playback will start when audio is ready.',
      'Audio is taking longer. We stopped waiting. Try again to prepare audio.',
      'Couldn’t start audio. Playback hasn’t started. Please try again.',
      'Couldn’t start audio. Playback hasn’t started. Please try again.',
      'Preparing audio again. Your requested playback will continue when ready.',
    ]);
  });

  test('keyboard stays in the notice; closing returns to the button that asked', async ({ page }) => {
    await openWithStoppedOutput(page, 'reject');
    await mode(page, 'Step').click();
    await page.clock.runFor(1);
    await expectNotice(page, 'failed');
    const dialog = notice(page);
    await expect(dialog.getByRole('button', { name: 'Dismiss' })).toBeFocused();
    for (const [key, focused] of [['Tab', 'Try again'], ['Tab', 'Dismiss'], ['Shift+Tab', 'Try again'], ['Shift+Tab', 'Dismiss']] as const) {
      await page.keyboard.press(key);
      await expect(dialog.getByRole('button', { name: focused })).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(mode(page, 'Step')).toBeFocused();
    await expect(mode(page, 'Step')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a notice already open stays over the rotate hint and returns focus to it', async ({ page }, info) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openWithStoppedOutput(page, 'reject');
    await mode(page, 'Auto').click();
    await page.clock.runFor(1);
    await expectNotice(page, 'failed');
    const calls = await gateCalls(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNotice(page, 'failed');
    await expect(notice(page)).toBeInViewport({ ratio: 1 });
    await attachState(page, info, 'portrait-failed');
    await notice(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('Rotate to landscape')).toBeFocused();
    expect(await gateCalls(page), 'turning the screen and closing ask nothing').toBe(calls);
  });

  test('guide and step start in their own mode after a failed first try', async ({ page }) => {
    await openWithStoppedOutput(page, 'reject');
    for (const name of ['Guide', 'Step'] as const) {
      await page.evaluate(() => { window.audioGate.mode = 'reject'; });
      await mode(page, name).dispatchEvent('click');
      await page.clock.runFor(1);
      await expectNotice(page, 'failed');
      await page.evaluate(() => { window.audioGate.mode = 'hold'; });
      await notice(page).getByRole('button', { name: 'Try again' }).dispatchEvent('click');
      await settle(page, 'resolve');
      await expect(notice(page)).toHaveCount(0);
      await expect(mode(page, name)).toHaveAttribute('aria-pressed', 'true');
      await mode(page, name).dispatchEvent('click');
      await expect(mode(page, name)).toHaveAttribute('aria-pressed', 'false');
      await page.evaluate(() => window.audioGate.dropOutput());
      await expect.poll(() => page.evaluate(() => window.browserProbe.audio.outputState())).toBe('suspended');
    }
  });

  test('Play after a pause continues from where it stopped once the audio is prepared', async ({ page }) => {
    let progress = 0;
    await openWithStoppedOutput(page, 'hold', async page => {
      await mode(page, 'Auto').click();
      await expect.poll(() => starts(page), { timeout: stateTimeout }).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      progress = Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'));
    });
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await play.dispatchEvent('click');
    await expect(play).toHaveAttribute('aria-busy', 'true');
    await page.clock.runFor(300);
    await expectNotice(page, 'preparing');
    expect(Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'))).toBe(progress);
    await settle(page, 'resolve');
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.clock.resume();
    await expect.poll(async () => Number(await page.getByRole('progressbar').getAttribute('aria-valuenow')), { timeout: stateTimeout }).toBeGreaterThan(progress);
  });

  for (const name of ['Auto', 'Guide'] as const) {
    test(`after leaving the page, Play continues ${name} from where it stopped once the audio is prepared`, async ({ page }) => {
      await installAudioGate(page);
      await page.clock.install();
      await openBasicWith(page, {});
      await expectAudioOutputRunning(page);
      await mode(page, name).click();
      const position = async () => Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'));
      if (name === 'Auto') await expect.poll(() => starts(page), { timeout: stateTimeout }).toBeGreaterThan(0);
      else await expect.poll(position, { timeout: stateTimeout }).toBeGreaterThan(0);
      // The page is left: playback stops at its place, and the browser keeps the output stopped on return.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const play = page.getByRole('button', { name: 'Play', exact: true });
      await expect(play).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.browserProbe.audio.outputState()), { timeout: stateTimeout }).toBe('suspended');
      const progress = await position();
      await page.evaluate(() => { window.audioGate.mode = 'reject'; });
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => page.evaluate(() => window.browserProbe.audio.outputState())).toBe('suspended');
      await page.evaluate(() => { window.audioGate.mode = 'hold'; });
      await freezeClock(page);
      const before = await starts(page);
      const calls = await gateCalls(page);
      await play.dispatchEvent('click');
      await page.clock.runFor(300);
      await expectNotice(page, 'preparing');
      expect(await gateCalls(page), 'one request for the press').toBe(calls + 1);
      expect(await position()).toBe(progress);
      await settle(page, 'resolve');
      await expect(notice(page)).toHaveCount(0);
      await expect(mode(page, name)).toHaveAttribute('aria-pressed', 'true');
      for (const other of (['Auto', 'Guide', 'Step'] as const).filter(other => other !== name)) {
        await expect(mode(page, other)).toHaveAttribute('aria-pressed', 'false');
      }
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      // With the page clock still stopped, the song is back at the place it was left.
      expect(await position()).toBe(progress);
      await page.clock.resume();
      // Both modes follow the song's own timing in this pack, so it moves on from there, never from the start.
      const seen: number[] = [];
      await expect.poll(async () => { const at = await position(); seen.push(at); return at; }, { timeout: stateTimeout }).toBeGreaterThan(progress);
      expect(Math.min(...seen), `went back before ${progress}: ${seen.join(', ')}`).toBeGreaterThanOrEqual(progress);
      expect(await starts(page)).toBeGreaterThanOrEqual(before);
    });
  }

  test('a held pad, key and long sound end when the output stops; the notice closing brings none back', async ({ page }) => {
    const lit = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[data-pad] div.z-10')]
      .filter(light => !['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(light).backgroundColor)).length);
    let held = 0;
    await openWithStoppedOutput(page, 'hold', async page => {
      const pad = (await page.locator('[data-pad="0,0"]').boundingBox())!;
      await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
      await page.mouse.down();
      await page.keyboard.down('q');
      await expect.poll(() => starts(page), { timeout: stateTimeout }).toBeGreaterThan(0);
      // The pad's own light chain (1.2 s) is on, and the 8 s sound plays.
      await expect.poll(() => lit(page), { timeout: stateTimeout }).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(() => window.browserProbe.audio.outputRms() ?? 0), { timeout: stateTimeout }).toBeGreaterThan(0.01);
      held = await starts(page);
    }, { 'sounds/tone.wav': longTone(8) });
    // The stopped output ended the held sound and the light chain.
    await page.clock.runFor(50);
    await expect.poll(() => lit(page)).toBe(0);
    expect(await page.evaluate(() => window.browserProbe.audio.stops.length), 'the held sound was stopped').toBeGreaterThan(0);
    await mode(page, 'Auto').dispatchEvent('click');
    await page.clock.runFor(300);
    await expectNotice(page, 'preparing');
    // Releasing behind the notice, then dismissing it after the request expired.
    await page.mouse.up();
    await page.keyboard.up('q');
    await page.clock.runFor(4700);
    await expectNotice(page, 'delayed');
    await notice(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice(page)).toHaveCount(0);
    await settle(page, 'resolve');
    await expectNothingStarted(page, held);
    expect(await lit(page), 'no light came back').toBe(0);
    expect(await page.evaluate(() => window.browserProbe.audio.outputRms() ?? 0), 'no sound came back').toBeLessThan(0.001);
  });

  test('with the controls hidden, Alt+A shows the notice over the pads and starts after Try again', async ({ page }, info) => {
    await openWithStoppedOutput(page, 'reject');
    await page.keyboard.press('Alt+h');
    await expect(mode(page, 'Auto')).toHaveCount(0);
    const before = await starts(page);
    await page.keyboard.press('Alt+a');
    await page.clock.runFor(1);
    await expectNotice(page, 'failed');
    await expect(notice(page)).toBeInViewport({ ratio: 1 });
    await expect(notice(page).getByRole('button', { name: 'Dismiss' })).toBeFocused();
    await attachState(page, info, 'hidden-controls-failed');
    // Escape belongs to the notice: it closes it and leaves the controls hidden.
    await page.keyboard.press('Escape');
    await expect(notice(page)).toHaveCount(0);
    await expect(mode(page, 'Auto')).toHaveCount(0);
    await page.keyboard.press('Alt+a');
    await page.clock.runFor(1);
    await expectNotice(page, 'failed');
    // Pads behind the notice stay silent.
    const padBox = (await page.locator('[data-pad="0,0"]').boundingBox())!;
    await page.mouse.click(padBox.x + padBox.width / 2, padBox.y + padBox.height / 2);
    expect(await starts(page)).toBe(before);
    await page.evaluate(() => { window.audioGate.mode = 'hold'; });
    await notice(page).getByRole('button', { name: 'Try again' }).click();
    await expectNotice(page, 'retrying');
    await settle(page, 'resolve');
    await expect(notice(page)).toHaveCount(0);
    await expect(mode(page, 'Auto')).toHaveCount(0);
    await page.clock.resume();
    await expect.poll(() => starts(page), { timeout: stateTimeout }).toBeGreaterThan(before);
  });
});

/** The notice's box, text and buttons fit the screen; its text scrolls to the end. */
async function measureNotice(dialog: Locator) {
  return dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    const copy = element.firstElementChild as HTMLElement;
    copy.scrollTop = copy.scrollHeight;
    const buttons = [...element.querySelectorAll('button')].map(button => {
      const rect = button.getBoundingClientRect();
      return { height: rect.height, width: rect.width, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflows: button.scrollWidth > button.clientWidth };
    });
    const style = (selector: string) => getComputedStyle(element.querySelector(selector)!);
    return {
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      copyOverflowsSideways: copy.scrollWidth > copy.clientWidth,
      copyReadToEnd: Math.abs(copy.scrollTop + copy.clientHeight - copy.scrollHeight) <= 1,
      buttons,
      colors: {
        background: getComputedStyle(element).backgroundColor,
        title: style('h2').color, body: style('p').color,
      },
    };
  });
}

const screens = [
  { width: 1440, height: 900 }, { width: 844, height: 390 }, { width: 667, height: 375 },
  { width: 390, height: 844 }, { width: 320, height: 568 },
];

/** WCAG contrast of two computed colours; a translucent one is laid over `under` first. */
function contrast(fore: string, back: string, under = 'rgb(0, 0, 0)') {
  const parse = (color: string) => color.match(/[\d.]+/g)!.map(Number);
  const [ur, ug, ub] = parse(under);
  const solid = (color: string) => {
    const [r, g, b, a = 1] = parse(color);
    return [r * a + ur * (1 - a), g * a + ug * (1 - a), b * a + ub * (1 - a)];
  };
  const luminance = (color: string) => {
    const [r, g, b] = solid(color).map(value => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(fore), luminance(back)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** The colours the notice is drawn with, as the browser computed them. */
async function noticeColors(dialog: Locator) {
  return dialog.evaluate(element => {
    const style = (target: Element) => getComputedStyle(target);
    const [first, second] = [...element.querySelectorAll('button')];
    return {
      background: style(element).backgroundColor,
      title: style(element.querySelector('h2')!).color,
      body: style(element.querySelector('p')!).color,
      buttons: [first, second].filter(Boolean).map(button => ({
        text: style(button).color, background: style(button).backgroundColor, border: style(button).borderTopColor,
      })),
      // The ring a keyboard user sees on the focused button.
      focusRing: document.activeElement?.matches('[role=dialog] button:focus-visible') ? style(document.activeElement).outlineColor : null,
    };
  });
}

type NoticeState = 'preparing' | 'delayed' | 'failed' | 'retrying';

/**
 * Shows each of the four states in turn (the open pack's audio output stopped, the gate holding) and
 * measures the notice on each screen. `stacked` says when the buttons must sit one above the other.
 */
async function checkNoticeLayout(page: Page, info: TestInfo, { label, startName, sizes = screens, stacked }: {
  label: string; startName: string; sizes?: typeof screens; stacked: (screen: typeof screens[number]) => boolean;
}) {
  const results = [];
  const enter: Record<NoticeState, () => Promise<void>> = {
    preparing: async () => {
      await page.getByRole('button', { name: startName, exact: true }).dispatchEvent('click');
      await page.clock.runFor(300);
    },
    delayed: () => page.clock.runFor(4700),
    failed: async () => {
      await page.evaluate(() => { window.audioGate.mode = 'reject'; });
      await notice(page).getByRole('button').last().dispatchEvent('click');
    },
    retrying: async () => {
      await page.evaluate(() => { window.audioGate.mode = 'hold'; });
      await notice(page).getByRole('button').last().dispatchEvent('click');
    },
  };
  const home = { width: 844, height: 390 };
  for (const state of ['preparing', 'delayed', 'failed', 'retrying'] as const) {
    await page.setViewportSize(home);
    await enter[state]();
    await expect(notice(page)).toHaveAttribute('aria-labelledby', /.+/);
    await expect(page.locator(`[data-audio-start-notice="${state === 'retrying' ? 'preparing' : state}"]`)).toHaveCount(1);
    // Moving focus by keyboard shows the focus ring; one button or two, it ends where it began.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    for (const screen of sizes) {
      await page.setViewportSize(screen);
      const measured = await measureNotice(notice(page));
      const colors = await noticeColors(notice(page));
      results.push({ state, screen, ...measured, colors });
      await info.attach(`${state}-${screen.width}x${screen.height}-${label}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      const at = `${label} ${state} ${screen.width}x${screen.height}`;
      const { box, viewport, buttons } = measured;
      expect.soft(box.left, at).toBeGreaterThanOrEqual(15.5);
      expect.soft(viewport.width - box.right, at).toBeGreaterThanOrEqual(15.5);
      expect.soft(box.top, at).toBeGreaterThanOrEqual(15.5);
      expect.soft(viewport.height - box.bottom, at).toBeGreaterThanOrEqual(15.5);
      expect.soft(box.right - box.left, at).toBeLessThanOrEqual(420.5);
      expect.soft(measured.pageOverflow || measured.copyOverflowsSideways, `${at} sideways overflow`).toBe(false);
      expect.soft(measured.copyReadToEnd, `${at} text scrolls to its end`).toBe(true);
      for (const button of buttons) {
        expect.soft(button.height, `${at} button height`).toBeGreaterThanOrEqual(44);
        expect.soft(button.overflows, `${at} button text overflow`).toBe(false);
        expect.soft(button.top >= box.top && button.bottom <= box.bottom + 0.5, `${at} button inside`).toBe(true);
      }
      if (buttons.length === 2) {
        const [first, second] = buttons;
        const apart = first.right <= second.left + 0.5 || first.bottom <= second.top + 0.5;
        expect.soft(apart, `${at} buttons do not overlap`).toBe(true);
        if (stacked(screen)) expect.soft(first.bottom <= second.top + 0.5, `${at} stacked`).toBe(true);
      }
      expect.soft(contrast(colors.title, colors.background), `${at} title contrast`).toBeGreaterThanOrEqual(4.5);
      expect.soft(contrast(colors.body, colors.background), `${at} text contrast`).toBeGreaterThanOrEqual(4.5);
      for (const button of colors.buttons) {
        const fill = contrast(button.background, 'rgb(0, 0, 0)', colors.background) > 1.01 ? button.background : colors.background;
        expect.soft(contrast(button.text, fill, colors.background), `${at} button text contrast`).toBeGreaterThanOrEqual(4.5);
      }
      expect.soft(colors.focusRing, `${at} focus ring shown`).not.toBeNull();
      if (colors.focusRing) expect.soft(contrast(colors.focusRing, colors.background), `${at} focus ring contrast`).toBeGreaterThanOrEqual(3);
    }
  }
  await info.attach(`notice-layout-${label}.json`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  return results;
}

const startName = { 'ko-KR': '연주 모드: 자동', 'en-US': 'Play mode: Auto' };

/** Doubles the root text size the way each engine allows: Chromium's own font setting, else a style. */
async function doubleText(page: Page, browserName: string) {
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
  } else {
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'html { font-size: 200% !important; }';
      document.head.append(style);
    }));
  }
}

for (const locale of ['ko-KR', 'en-US'] as const) {
  for (const large of [false, true]) {
    test.describe(`notice layout ${locale}${large ? ' doubled text' : ''}`, () => {
      test.use({ locale });
      test('fits each screen in every state', async ({ page, browserName }, info) => {
        test.setTimeout(240_000);
        if (large) await doubleText(page, browserName);
        await page.setViewportSize({ width: 844, height: 390 });
        await openWithStoppedOutput(page, 'hold');
        await checkNoticeLayout(page, info, {
          label: `${locale}-${large ? 200 : 100}`, startName: startName[locale],
          stacked: screen => large || screen.width <= 360,
        });
      });
    });
  }
}

// A saved theme, the most chains a pack may have (24; the format refuses 32) and a title longer than any screen line, in Korean with doubled text.
test.describe('notice layout over a themed 24-chain pack with a long title', () => {
  test.use({ locale: 'ko-KR' });
  test('fits each screen in every state', async ({ page, browserName }, info) => {
    test.setTimeout(240_000);
    await doubleText(page, browserName);
    await page.setViewportSize({ width: 844, height: 390 });
    const title = '아주 긴 제목의 연주 팩 '.repeat(8) + 'A very long pack title that wraps on every screen';
    await openWithStoppedOutput(page, 'hold', async page => {
      await page.locator('input[type=file][accept=".zip"]').setInputFiles(await themeFile('Notice theme'));
      await expect.poll(() => themeSetting(page), { timeout: stateTimeout }).toMatch(/.+/);
    }, { info: `title=${title}\nproducerName=UniPad Tests\nbuttonX=8\nbuttonY=8\nchain=24\nsquareButton=true\n` });
    await expect(page).toHaveTitle(new RegExp(`^${title.slice(0, 20)}`));
    await checkNoticeLayout(page, info, { label: 'theme-24chains-long-title-ko-200', startName: startName['ko-KR'], stacked: () => true });
  });
});

// The browser's own zoom (Chrome's page zoom, set through an extension), not an emulated screen.
test.describe('notice layout at 200% browser zoom', () => {
  for (const locale of ['ko-KR', 'en-US'] as const) {
    test(`fits each screen in every state, ${locale}`, async ({ browserName }, info) => {
      test.skip(browserName !== 'chromium', 'only Chromium can set its page zoom from a test');
      test.setTimeout(300_000);
      const extension = info.outputPath('zoom-extension');
      await mkdir(extension, { recursive: true });
      await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({
        manifest_version: 3, name: 'Zoom', version: '1', permissions: ['tabs'], background: { service_worker: 'worker.js' },
      }));
      await writeFile(path.join(extension, 'worker.js'), '');
      const context = await chromium.launchPersistentContext(info.outputPath('profile'), {
        channel: 'chromium', headless: true, locale, baseURL: process.env.E2E_SERVER_URL,
        viewport: { width: 844, height: 390 },
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        const page = context.pages()[0] ?? await context.newPage();
        await installBrowserProbe(page);
        await openWithStoppedOutput(page, 'hold');
        await worker.evaluate(async () => {
          type Tabs = { query(filter: object): Promise<{ id?: number }[]>; setZoom(tab: number, factor: number): Promise<void> };
          const { tabs } = (globalThis as unknown as { chrome: { tabs: Tabs } }).chrome;
          const [tab] = await tabs.query({});
          await tabs.setZoom(tab.id!, 2);
        });
        await expect.poll(() => page.evaluate(() => ({ width: innerWidth, ratio: devicePixelRatio }))).toEqual({ width: 422, ratio: 2 });
        const results = await checkNoticeLayout(page, info, { label: `${locale}-zoom-200`, startName: startName[locale], stacked: () => false });
        for (const { screen, viewport } of results) expect(viewport.width, 'the zoom halves the page width').toBe(Math.floor(screen.width / 2));
      } finally {
        await context.close();
      }
    });
  }
});
