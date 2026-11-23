import type { Page } from '@playwright/test';
import { expect, expectAudioOutputRunning, stateTimeout } from './browser';
import { openBasicWith } from './basic-pack';

/**
 * Replies to the app's own AudioContext.resume() calls, the request its sound engine makes before a
 * start. 'real' passes them to the browser; the others answer for it: refuse, reply without running,
 * or hold until the test settles them (a held reply that resolves runs the real resume first).
 */
export interface AudioGate {
  mode: 'real' | 'hold' | 'reject' | 'idle';
  /** Resume calls answered by the gate (not 'real'). */
  calls: number;
  held: number;
  settle(outcome: 'resolve' | 'reject' | 'idle'): number;
  /** Stops the pack's audio output behind the app's back, as a device that went away. */
  dropOutput(): Promise<void>;
}

declare global {
  interface Window { audioGate: AudioGate; noticeAnnouncements: string[] }
}

export async function installAudioGate(page: Page) {
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

/** The audio start notice's dialog. */
export const notice = (page: Page) => page.locator('[data-audio-start-notice]').getByRole('dialog');

/** Stops the page clock where it is (a second ahead, as a late command must still land). */
export async function freezeClock(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
}

/**
 * Opens basic.uni, lets its audio output run, then stops the output from outside the app, which
 * interrupts playback; from then on every resume is answered by the gate as `gateMode`.
 */
export async function openWithStoppedOutput(page: Page, gateMode: AudioGate['mode'], before?: (page: Page) => Promise<void>, files: Record<string, string | Uint8Array> = {}) {
  await installAudioGate(page);
  await page.clock.install();
  await openBasicWith(page, files);
  await expectAudioOutputRunning(page);
  await before?.(page);
  await page.evaluate(m => { window.audioGate.mode = m; }, gateMode);
  await page.evaluate(() => window.audioGate.dropOutput());
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.outputState()), { timeout: stateTimeout }).toBe('suspended');
  await freezeClock(page);
}

/**
 * Records each text the notice puts in its status line, in order: what the page asks a screen reader
 * to announce, apart from the dialog's own name and description.
 */
export async function recordNoticeAnnouncements(page: Page) {
  await page.addInitScript(() => {
    window.noticeAnnouncements = [];
    let last = '';
    new MutationObserver(() => {
      const status = document.querySelector('[data-audio-start-notice] [role=status]');
      const text = status?.textContent ?? '';
      if (text && text !== last) window.noticeAnnouncements.push(text);
      last = text;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

export const noticeAnnouncements = (page: Page) => page.evaluate(() => window.noticeAnnouncements);
