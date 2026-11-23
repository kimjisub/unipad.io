import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect, expectAudioOutputRunning, stateTimeout } from './browser';
import { openBasicWith } from './basic-pack';

/**
 * Replies to the app's own AudioContext.resume() calls, the request its sound engine makes before a
 * start. 'real' passes them to the browser; the others answer for it: refuse, reply without running,
 * or hold until the test settles them (a held reply that resolves runs the real resume first).
 */
interface AudioGate {
  mode: 'real' | 'hold' | 'reject' | 'idle';
  /** Resume calls answered by the gate (not 'real'). */
  calls: number;
  held: number;
  settle(outcome: 'resolve' | 'reject' | 'idle'): number;
  /** Stops the pack's audio output behind the app's back, as a device that went away. */
  dropOutput(): Promise<void>;
}

declare global {
  interface Window { audioGate: AudioGate }
}

async function installAudioGate(page: Page) {
  await page.addInitScript(() => {
    const nativeResume = AudioContext.prototype.resume;
    const nativeSuspend = AudioContext.prototype.suspend;
    const held: ((outcome: 'resolve' | 'reject' | 'idle') => void)[] = [];
    const outputs: AudioContext[] = [];
    const refused = () => new DOMException('The audio output could not start', 'NotAllowedError');
    const gate: AudioGate = {
      mode: 'real', calls: 0, held: 0,
      settle(outcome) {
        const replies = held.splice(0);
        gate.held = 0;
        for (const reply of replies) reply(outcome);
        return replies.length;
      },
      dropOutput: () => nativeSuspend.call(outputs.at(-1)!),
    };
    window.audioGate = gate;
    AudioContext.prototype.resume = function (this: AudioContext) {
      if (gate.mode === 'real') return nativeResume.call(this);
      gate.calls++;
      if (gate.mode === 'reject') return Promise.reject(refused());
      if (gate.mode === 'idle') return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        gate.held++;
        held.push(outcome => {
          if (outcome === 'resolve') nativeResume.call(this).then(resolve, reject);
          else if (outcome === 'reject') reject(refused());
          else resolve();
        });
      });
    };
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function (this: AudioContext) {
      outputs.push(this);
      return createGain.call(this);
    };
  });
}

const mode = (page: Page, name: 'Auto' | 'Guide' | 'Step') => page.getByRole('button', { name: `Play mode: ${name}`, exact: true });
const notice = (page: Page) => page.locator('[data-audio-start-notice]').getByRole('dialog');
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

/** Stops the page clock where it is (a second ahead, as a late command must still land). */
async function freezeClock(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
}

/**
 * Opens basic.uni, lets its audio output run, then stops the output from outside the app, which
 * interrupts playback; from then on every resume is answered by the gate as `gateMode`.
 */
async function openWithStoppedOutput(page: Page, gateMode: AudioGate['mode'], before?: (page: Page) => Promise<void>) {
  await installAudioGate(page);
  await page.clock.install();
  await openBasicWith(page, {});
  await expectAudioOutputRunning(page);
  await before?.(page);
  await page.evaluate(m => { window.audioGate.mode = m; }, gateMode);
  await page.evaluate(() => window.audioGate.dropOutput());
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.outputState()), { timeout: stateTimeout }).toBe('suspended');
  await freezeClock(page);
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
for (const locale of ['ko-KR', 'en-US'] as const) {
  for (const large of [false, true]) {
    test.describe(`notice layout ${locale}${large ? ' doubled text' : ''}`, () => {
      test.use({ locale });
      test('fits each screen in every state', async ({ page, browserName }, info) => {
        test.setTimeout(180_000);
        if (large) {
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
        await page.setViewportSize({ width: 844, height: 390 });
        await openWithStoppedOutput(page, 'reject');
        const modeName = locale === 'ko-KR' ? '연주 모드: 자동' : 'Play mode: Auto';
        await page.getByRole('button', { name: modeName, exact: true }).dispatchEvent('click');
        await page.clock.runFor(1);
        await expect(notice(page)).toBeVisible();
        const results = [];
        for (const state of ['failed', 'retrying', 'delayed'] as const) {
          if (state === 'retrying') {
            await page.evaluate(() => { window.audioGate.mode = 'hold'; });
            await notice(page).getByRole('button').last().dispatchEvent('click');
          }
          if (state === 'delayed') await page.clock.runFor(5000);
          for (const screen of screens) {
            await page.setViewportSize(screen);
            const measured = await measureNotice(notice(page));
            results.push({ state, screen, ...measured });
            if (state === 'failed' || screen.width === 320) {
              await info.attach(`${state}-${screen.width}x${screen.height}-${locale}-${large ? 200 : 100}.png`, { body: await page.screenshot(), contentType: 'image/png' });
            }
            const { box, viewport, buttons } = measured;
            expect.soft(box.left, `${state} ${screen.width}`).toBeGreaterThanOrEqual(15.5);
            expect.soft(viewport.width - box.right, `${state} ${screen.width}`).toBeGreaterThanOrEqual(15.5);
            expect.soft(box.top, `${state} ${screen.width}`).toBeGreaterThanOrEqual(15.5);
            expect.soft(viewport.height - box.bottom, `${state} ${screen.width}`).toBeGreaterThanOrEqual(15.5);
            expect.soft(box.right - box.left, `${state} ${screen.width}`).toBeLessThanOrEqual(420.5);
            expect.soft(measured.pageOverflow || measured.copyOverflowsSideways, `${state} ${screen.width} sideways overflow`).toBe(false);
            expect.soft(measured.copyReadToEnd, `${state} ${screen.width} text scrolls to its end`).toBe(true);
            for (const button of buttons) {
              expect.soft(button.height, `${state} ${screen.width} button height`).toBeGreaterThanOrEqual(44);
              expect.soft(button.overflows, `${state} ${screen.width} button text overflow`).toBe(false);
              expect.soft(button.top >= box.top && button.bottom <= box.bottom + 0.5, `${state} ${screen.width} button inside`).toBe(true);
            }
            if (buttons.length === 2) {
              const [first, second] = buttons;
              const apart = first.right <= second.left + 0.5 || first.bottom <= second.top + 0.5;
              expect.soft(apart, `${state} ${screen.width} buttons do not overlap`).toBe(true);
              if (large || screen.width <= 360) expect.soft(first.bottom <= second.top + 0.5, `${state} ${screen.width} stacked`).toBe(true);
            }
          }
          await page.setViewportSize({ width: 844, height: 390 });
        }
        await info.attach('notice-layout.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
      });
    });
  }
}
