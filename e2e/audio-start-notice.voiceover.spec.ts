import { voiceOverTest, type VoiceOverPlaywright } from '@guidepup/playwright';
import { test as plainTest, type Page, type TestInfo } from '@playwright/test';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, expectPads, installBrowserProbe, stateTimeout } from './browser';
import { openBasicWith } from './basic-pack';
import { freezeClock, installAudioGate, notice, noticeAnnouncements, recordNoticeAnnouncements } from './audio-gate';
import en from '../src/i18n/messages/en.json';
import ko from '../src/i18n/messages/ko.json';

/**
 * What VoiceOver itself says about the audio start notice, in each of its four states. Runs only on
 * macOS with VoiceOver prepared for automation (see .github/workflows/voiceover.yml); the phrases
 * VoiceOver spoke are saved as they are, for a person to read. What VoiceOver says by itself varies
 * from run to run (it sometimes drops a polite status change), so how often each title and text was
 * spoken is recorded, not asserted; the reader staying in the notice and focus are asserted. VOICEOVER_DRY=1 walks the same page
 * steps without a screen reader, to check them on any machine.
 */
const dry = process.env.VOICEOVER_DRY === '1';

interface Reader {
  /** Moves the reader into the page. */
  enter(): Promise<void>;
  /** Moves the reader's cursor to the next item and returns what it describes. */
  next(): Promise<string>;
  /** Moves the reader's cursor to the previous item and returns what it describes. */
  previous(): Promise<string>;
  /** Everything spoken in answer to the reader's own commands so far. */
  spoken(): Promise<string[]>;
  /**
   * What the reader says by itself over `ms` (a dialog opening, focus moving, a status line), each
   * change of its last phrase once.
   */
  listen(ms: number): Promise<string[]>;
}

const messages = { 'en-US': en, 'ko-KR': ko } as const;
type Locale = keyof typeof messages;
type State = 'preparing' | 'delayed' | 'failed' | 'retrying';

/** Real time for VoiceOver to finish speaking after a change. */
const settleMs = dry ? 100 : 4000;
/** Reader steps taken each way through the notice in each state; more than its items, so leaving it would show. */
const walkSteps = 8;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** VoiceOver's last phrase, read straight from it: Guidepup logs only what follows its own commands. */
async function voiceOverLastPhrase() {
  const { stdout } = await promisify(execFile)('osascript', ['-e', 'tell application "VoiceOver" to return content of last phrase']);
  return stdout.trim();
}

async function listenToVoiceOver(ms: number) {
  const heard: string[] = [];
  let last = await voiceOverLastPhrase();
  for (const end = Date.now() + ms; Date.now() < end; await wait(150)) {
    const phrase = await voiceOverLastPhrase();
    if (phrase !== last) heard.push(phrase);
    last = phrase;
  }
  return heard;
}

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
const startName = (locale: Locale) => messages[locale].play.playMode.ariaLabel.replace('{mode}', messages[locale].play.playMode.auto);

/** Opens basic.uni with its audio output stopped and every resume held, the page clock stopped, the reader in the page. */
async function openHeld(page: Page, reader: Reader) {
  await installBrowserProbe(page);
  await installAudioGate(page);
  await recordNoticeAnnouncements(page);
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
}

/** Asks the browser once more from the notice and waits until that request has been answered. */
async function pressRetry(page: Page, locale: Locale) {
  const calls = await page.evaluate(() => window.audioGate.calls);
  await notice(page).getByRole('button', { name: messages[locale].play.audioStart.retry, exact: true }).dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => window.audioGate.calls)).toBe(calls + 1);
}

/**
 * What each phrase heard after a state change was: the state's title and text together (the status
 * line), the title alone or the text alone (the dialog's name or description read on their own), or else.
 */
function sortPhrases(said: string[], copy: { title: string; body: string }) {
  const whole = said.filter(phrase => phrase.includes(copy.title) && phrase.includes(copy.body));
  const titleAlone = said.filter(phrase => phrase.includes(copy.title) && !phrase.includes(copy.body));
  const bodyAlone = said.filter(phrase => phrase.includes(copy.body) && !phrase.includes(copy.title));
  return {
    titleSpokenTimes: whole.length + titleAlone.length,
    bodySpokenTimes: whole.length + bodyAlone.length,
    titleAlone, bodyAlone,
    other: said.filter(phrase => phrase && !whole.includes(phrase) && !titleAlone.includes(phrase) && !bodyAlone.includes(phrase)),
  };
}

/**
 * Walks the notice through its states with the reader: opening, taking longer, refused, refused again
 * at once, preparing again, closed.
 */
async function readNotice(page: Page, info: TestInfo, locale: Locale, reader: Reader) {
  const text = messages[locale].play.audioStart;
  await openHeld(page, reader);

  // Strings that belong to the notice: an item the reader reaches outside them is the page behind it.
  const own = (state: State) => {
    const copy = text[state];
    const buttons = state === 'preparing' || state === 'retrying' ? [text.cancel] : [text.dismiss, text.retry];
    return [copy.title, copy.body, ...buttons];
  };

  const record: unknown[] = [];
  let announced = 0;
  const observe = async (state: State | 'closed', action: string, listening: Promise<string[]>) => {
    const said = await listening;
    const focus = await focusedItem(page);
    // What the page put in its status line meanwhile: told apart from what the reader then said.
    const announcements = await noticeAnnouncements(page);
    // Which request to the browser this state answers: each Try again is a new one.
    const request = await page.evaluate(() => window.audioGate.calls);
    const entry: Record<string, unknown> = { state, action, request, spoken: said, pageAnnounced: announcements.slice(announced), focus };
    announced = announcements.length;
    if (state !== 'closed') {
      Object.assign(entry, sortPhrases(said, text[state]));
      const items: string[] = [];
      for (let step = 0; step < walkSteps; step++) items.push(await reader.previous());
      for (let step = 0; step < walkSteps; step++) items.push(await reader.next());
      entry.walk = items;
      // The walk leaves the reader's cursor on the status line; a player's is on the focused button,
      // and a cursor resting on the status line hides its next change.
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        active?.blur();
        active?.focus();
      });
      await wait(dry ? 0 : 2000);
      entry.outsideNotice = items.filter(item => item && !own(state).some(part => item.includes(part)));
      if (!dry) {
        expect.soft(entry.outsideNotice, `${state}: the reader stays in the notice`).toEqual([]);
      }
      expect.soft(focus.insideNotice, `${state}: focus is in the notice`).toBe(true);
    }
    record.push(entry);
  };

  let listening = reader.listen(settleMs);
  await page.getByRole('button', { name: startName(locale), exact: true }).dispatchEvent('click');
  await page.clock.runFor(300);
  await expect(notice(page).getByRole('heading')).toHaveText(text.preparing.title);
  // The page clock stands still: the notice's own 0.5 s before it adds its text runs in real time here.
  await wait(500);
  await page.clock.runFor(500);
  await observe('preparing', 'pressed the Auto start; 0.3 s passed', listening);

  listening = reader.listen(settleMs);
  await page.clock.runFor(4200);
  await expect(notice(page).getByRole('heading')).toHaveText(text.delayed.title);
  // The notice announces a state once it has held 0.25 s, on the standing page clock.
  await page.clock.runFor(300);
  await observe('delayed', '5 s passed without an answer', listening);

  await page.evaluate(() => { window.audioGate.mode = 'reject'; });
  listening = reader.listen(settleMs);
  await pressRetry(page, locale);
  await expect(notice(page).getByRole('heading')).toHaveText(text.failed.title);
  await page.clock.runFor(300);
  await observe('failed', 'pressed Try again; the browser refused', listening);

  // The same refusal again at once: the same text, which must be heard again, once.
  listening = reader.listen(settleMs);
  await pressRetry(page, locale);
  await expect(notice(page).getByRole('heading')).toHaveText(text.failed.title);
  await page.clock.runFor(300);
  await observe('failed', 'pressed Try again again; the browser refused again', listening);

  await page.evaluate(() => { window.audioGate.mode = 'hold'; });
  listening = reader.listen(settleMs);
  await pressRetry(page, locale);
  await expect(notice(page).getByRole('heading')).toHaveText(text.retrying.title);
  await page.clock.runFor(300);
  await observe('retrying', 'pressed Try again a third time', listening);

  listening = reader.listen(settleMs);
  await notice(page).getByRole('button', { name: text.cancel, exact: true }).dispatchEvent('click');
  await expect(notice(page)).toHaveCount(0);
  await observe('closed', 'pressed Cancel', listening);
  expect.soft(await focusedItem(page), 'closing returns focus to the start button').toEqual({ role: 'button', name: startName(locale), insideNotice: false });

  const log = { locale, browser: info.project.name, dryRun: dry, steps: record, fullSpokenLog: await reader.spoken() };
  const body = JSON.stringify(log, null, 2);
  await writeFile(info.outputPath(`voiceover-${info.project.name}-${locale}.json`), body);
  await info.attach(`voiceover-${info.project.name}-${locale}.json`, { body, contentType: 'application/json' });
}


/** Which of the dialog's own links to its text are kept while its states change. */
type Links = 'name and description' | 'name only' | 'none';
const repeatRounds = 5;

/**
 * Takes the notice round the states the player meets again and again, in the same order each round:
 * refused at once, preparing again, taking longer. What VoiceOver says after each change is sorted into
 * the state's whole sentence and its title or text read alone. `links` drops the dialog's links to its
 * title and text in the page after it opened (the app does not set them again), to tell which of them
 * makes VoiceOver read a changed title or text by itself, besides the status line.
 */
async function repeatChanges(page: Page, info: TestInfo, locale: Locale, reader: Reader, links: Links) {
  const text = messages[locale].play.audioStart;
  await openHeld(page, reader);
  await page.getByRole('button', { name: startName(locale), exact: true }).dispatchEvent('click');
  await page.clock.runFor(300);
  await wait(500);
  await page.clock.runFor(500);
  await page.clock.runFor(4200);
  await expect(notice(page).getByRole('heading')).toHaveText(text.delayed.title);
  await page.clock.runFor(300);
  await page.evaluate(drop => {
    const dialog = document.querySelector('[data-audio-start-notice] [role=dialog]')!;
    if (drop !== 'name and description') dialog.removeAttribute('aria-describedby');
    if (drop === 'none') dialog.removeAttribute('aria-labelledby');
  }, links);
  await wait(settleMs);

  const record: Record<string, unknown>[] = [];
  let announced = (await noticeAnnouncements(page)).length;
  const change = async (state: State, mode: 'reject' | 'hold' | null, act: () => Promise<void>) => {
    if (mode) await page.evaluate(m => { window.audioGate.mode = m; }, mode);
    const listening = reader.listen(settleMs);
    await act();
    await expect(notice(page).getByRole('heading')).toHaveText(text[state].title);
    await page.clock.runFor(300);
    const said = await listening;
    const announcements = await noticeAnnouncements(page);
    record.push({ state, spoken: said, pageAnnounced: announcements.slice(announced), ...sortPhrases(said, text[state]) });
    announced = announcements.length;
  };
  for (let round = 0; round < repeatRounds; round++) {
    await change('failed', 'reject', () => pressRetry(page, locale));
    await change('retrying', 'hold', () => pressRetry(page, locale));
    await change('delayed', null, () => page.clock.runFor(4700));
  }

  const count = (key: 'titleAlone' | 'bodyAlone') => record.reduce((sum, entry) => sum + (entry[key] as string[]).length, 0);
  const summary = {
    changes: record.length,
    wholeHeardOnce: record.filter(entry => entry.titleSpokenTimes === 1 && entry.bodySpokenTimes === 1).length,
    titleReadAlone: count('titleAlone'),
    bodyReadAlone: count('bodyAlone'),
    pageAnnouncedOnce: record.filter(entry => (entry.pageAnnounced as string[]).length === 1).length,
  };
  const name = `voiceover-repeat-${info.project.name}-${locale}-${links.replaceAll(' ', '-')}.json`;
  const body = JSON.stringify({ locale, browser: info.project.name, dryRun: dry, links, summary, record }, null, 2);
  await writeFile(info.outputPath(name), body);
  await info.attach(name, { body, contentType: 'application/json' });
}


/**
 * The same reader and listener on a bare page: a polite status line (as the notice uses) and an alert,
 * each changed six times with the focus left on one button. How many of the changes are heard tells
 * what the listener and VoiceOver drop on their own, apart from the app.
 */
async function calibrate(page: Page, info: TestInfo, reader: Reader) {
  await page.goto('about:blank');
  await page.setContent(`<main><h1>Reader check</h1><button>Stay here</button>
    <div id="polite" role="status" aria-live="polite" aria-atomic="true"></div>
    <div id="assertive" role="alert" aria-atomic="true"></div></main>`);
  await reader.enter();
  await page.getByRole('button').focus();
  await wait(dry ? 0 : 2000);
  const result: Record<string, { sent: string; heard: string[] }[]> = { polite: [], assertive: [] };
  for (const kind of ['polite', 'assertive'] as const) {
    for (let round = 1; round <= 6; round++) {
      const sent = `${kind} check ${round}: the reader says this once.`;
      const listening = reader.listen(settleMs);
      await page.evaluate(({ kind, sent }) => { document.getElementById(kind)!.textContent = sent; }, { kind, sent });
      result[kind].push({ sent, heard: await listening });
    }
  }
  const summary = Object.fromEntries(Object.entries(result).map(([kind, rounds]) => [kind,
    `${rounds.filter(({ sent, heard }) => heard.filter(phrase => phrase.includes(sent)).length === 1).length}/${rounds.length} heard once`]));
  const body = JSON.stringify({ browser: info.project.name, dryRun: dry, summary, result }, null, 2);
  await writeFile(info.outputPath(`voiceover-calibration-${info.project.name}.json`), body);
  await info.attach(`voiceover-calibration-${info.project.name}.json`, { body, contentType: 'application/json' });
}

const voiceOverReader = (voiceOver: VoiceOverPlaywright): Reader => ({
  enter: () => voiceOver.navigateToWebContent(),
  next: async () => {
    await voiceOver.next();
    return voiceOver.itemText();
  },
  previous: async () => {
    await voiceOver.previous();
    return voiceOver.itemText();
  },
  spoken: async () => [...await voiceOver.spokenPhraseLog()],
  listen: listenToVoiceOver,
});

const dryReader: Reader = { enter: async () => {}, next: async () => '', previous: async () => '', spoken: async () => [], listen: async ms => { await wait(ms); return []; } };

for (const locale of ['en-US', 'ko-KR'] as const) {
  if (dry) {
    plainTest.describe(`audio start notice with a reader (dry run, ${locale})`, () => {
      plainTest.use({ locale });
      plainTest('every state can be walked', async ({ page }, info) => {
        await readNotice(page, info, locale, dryReader);
      });
    });
  } else {
    voiceOverTest.describe(`audio start notice read by VoiceOver (${locale})`, () => {
      voiceOverTest.use({ locale });
      voiceOverTest('VoiceOver reads each state, its buttons and stays in the notice', async ({ page, voiceOver }, info) => {
        await readNotice(page, info, locale, voiceOverReader(voiceOver));
      });
    });
  }
}


for (const links of ['name and description', 'name only', 'none'] as const) {
  if (dry) {
    plainTest(`the notice can be taken round its states again and again, dialog linked to ${links} (dry run)`, async ({ page }, info) => {
      await repeatChanges(page, info, 'en-US', dryReader, links);
    });
  } else {
    voiceOverTest.describe(`what VoiceOver says over repeated state changes (dialog linked to ${links})`, () => {
      voiceOverTest.use({ locale: 'en-US' });
      voiceOverTest('each change is recorded', async ({ page, voiceOver }, info) => {
        await repeatChanges(page, info, 'en-US', voiceOverReader(voiceOver), links);
      });
    });
  }
}

if (dry) {
  plainTest('a bare status line and alert can be changed (dry run)', async ({ page }, info) => {
    await calibrate(page, info, dryReader);
  });
} else {
  voiceOverTest('how often VoiceOver reads a bare status line and alert', async ({ page, voiceOver }, info) => {
    await calibrate(page, info, voiceOverReader(voiceOver));
  });
}
