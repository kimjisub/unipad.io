import { voiceOverTest } from '@guidepup/playwright';
import { test as plainTest, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, expectPads, installBrowserProbe, stateTimeout } from './browser';
import { openBasicWith } from './basic-pack';
import { freezeClock, installAudioGate, notice } from './audio-gate';
import en from '../src/i18n/messages/en.json';
import ko from '../src/i18n/messages/ko.json';

/**
 * What VoiceOver itself says about the audio start notice, in each of its four states. Runs only on
 * macOS with VoiceOver prepared for automation (see .github/workflows/voiceover.yml); the phrases
 * VoiceOver spoke are saved as they are, for a person to read. VOICEOVER_DRY=1 walks the same page
 * steps without a screen reader, to check them on any machine.
 */
const dry = process.env.VOICEOVER_DRY === '1';

interface Reader {
  /** Moves the reader into the page. */
  enter(): Promise<void>;
  /** Moves the reader's cursor to the next item and returns what it describes. */
  next(): Promise<string>;
  /** Everything spoken so far. */
  spoken(): Promise<string[]>;
}

const messages = { 'en-US': en, 'ko-KR': ko } as const;
type Locale = keyof typeof messages;
type State = 'preparing' | 'delayed' | 'failed' | 'retrying';

/** Real time for VoiceOver to finish speaking after a change. */
const settleMs = dry ? 100 : 4000;
/** Reader steps taken through the notice in each state; more than its items, so leaving it would show. */
const walkSteps = 8;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function focusedItem(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      role: active?.getAttribute('role') ?? active?.tagName.toLowerCase() ?? null,
      name: active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? null,
      insideNotice: !!active?.closest('[data-audio-start-notice] [role=dialog]'),
    };
  });
}

/**
 * Opens basic.uni with its audio output stopped and every resume held, and walks the notice through its
 * four states with the reader.
 */
async function readNotice(page: Page, info: TestInfo, locale: Locale, reader: Reader) {
  const text = messages[locale].play.audioStart;
  const startName = messages[locale].play.playMode.ariaLabel.replace('{mode}', messages[locale].play.playMode.auto);
  await installBrowserProbe(page);
  await installAudioGate(page);
  await page.addInitScript(() => { window.audioGate.mode = 'hold'; });
  await page.clock.install();
  await openBasicWith(page, {});
  await expectPads(page);
  // Where the browser runs the output without asking (a machine with a sound device), stop it from
  // outside the app, as a device that went away; where it never runs, the held resume keeps it stopped.
  const outputState = () => page.evaluate(() => window.browserProbe.audio.outputState());
  await expect.poll(outputState, { timeout: 5000 }).toBe('running').catch(() => {});
  if (await outputState() === 'running') {
    await page.evaluate(() => window.audioGate.dropOutput());
    await expect.poll(outputState, { timeout: stateTimeout }).toBe('suspended');
  }
  await freezeClock(page);
  await reader.enter();

  // Strings that belong to the notice: an item the reader reaches outside them is the page behind it.
  const own = (state: State) => {
    const copy = text[state];
    const buttons = state === 'preparing' || state === 'retrying' ? [text.cancel] : [text.dismiss, text.retry];
    return [copy.title, copy.body, ...buttons];
  };

  let heard = 0;
  const record: unknown[] = [];
  const observe = async (state: State | 'closed', action: string) => {
    await wait(settleMs);
    const spoken = await reader.spoken();
    const said = spoken.slice(heard);
    heard = spoken.length;
    const focus = await focusedItem(page);
    const entry: Record<string, unknown> = { state, action, spoken: said, focus };
    if (state !== 'closed') {
      const copy = text[state];
      entry.titleSpokenTimes = said.filter(phrase => phrase.includes(copy.title)).length;
      entry.bodySpokenTimes = said.filter(phrase => phrase.includes(copy.body)).length;
      const items: string[] = [];
      for (let step = 0; step < walkSteps; step++) items.push(await reader.next());
      heard = (await reader.spoken()).length;
      entry.walk = items;
      entry.outsideNotice = items.filter(item => item && !own(state).some(part => item.includes(part)));
      if (!dry) {
        expect.soft(said.join(' '), `${state}: the title is spoken`).toContain(copy.title);
        expect.soft(entry.outsideNotice, `${state}: the reader stays in the notice`).toEqual([]);
      }
      expect.soft(focus.insideNotice, `${state}: focus is in the notice`).toBe(true);
    }
    record.push(entry);
  };

  await page.getByRole('button', { name: startName, exact: true }).dispatchEvent('click');
  await page.clock.runFor(300);
  await expect(notice(page).getByRole('heading')).toHaveText(text.preparing.title);
  await observe('preparing', 'pressed the Auto start; 0.3 s passed');

  await page.clock.runFor(4700);
  await expect(notice(page).getByRole('heading')).toHaveText(text.delayed.title);
  await observe('delayed', '5 s passed without an answer');

  await page.evaluate(() => { window.audioGate.mode = 'reject'; });
  await notice(page).getByRole('button', { name: text.retry, exact: true }).dispatchEvent('click');
  await expect(notice(page).getByRole('heading')).toHaveText(text.failed.title);
  await observe('failed', 'pressed Try again; the browser refused');

  await page.evaluate(() => { window.audioGate.mode = 'hold'; });
  await notice(page).getByRole('button', { name: text.retry, exact: true }).dispatchEvent('click');
  await expect(notice(page).getByRole('heading')).toHaveText(text.retrying.title);
  await observe('retrying', 'pressed Try again again');

  await notice(page).getByRole('button', { name: text.cancel, exact: true }).dispatchEvent('click');
  await expect(notice(page)).toHaveCount(0);
  await observe('closed', 'pressed Cancel');

  const log = { locale, browser: info.project.name, dryRun: dry, steps: record, fullSpokenLog: await reader.spoken() };
  const body = JSON.stringify(log, null, 2);
  await writeFile(info.outputPath(`voiceover-${info.project.name}-${locale}.json`), body);
  await info.attach(`voiceover-${info.project.name}-${locale}.json`, { body, contentType: 'application/json' });
}

for (const locale of ['en-US', 'ko-KR'] as const) {
  if (dry) {
    plainTest.describe(`audio start notice with a reader (dry run, ${locale})`, () => {
      plainTest.use({ locale });
      plainTest('every state can be walked', async ({ page }, info) => {
        await readNotice(page, info, locale, { enter: async () => {}, next: async () => '', spoken: async () => [] });
      });
    });
  } else {
    voiceOverTest.describe(`audio start notice read by VoiceOver (${locale})`, () => {
      voiceOverTest.use({ locale });
      voiceOverTest('VoiceOver reads each state, its buttons and stays in the notice', async ({ page, voiceOver }, info) => {
        await readNotice(page, info, locale, {
          enter: () => voiceOver.navigateToWebContent(),
          next: async () => {
            await voiceOver.next();
            return voiceOver.itemText();
          },
          spoken: async () => [...await voiceOver.spokenPhraseLog()],
        });
      });
    });
  }
}
