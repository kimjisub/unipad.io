import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { test, expect } from './browser';

const pack = resolve('e2e/fixtures/basic.uni');
const pad = (page: Page, position: string) => page.locator(`[data-pad="${position}"]`);
const led = (page: Page, position: string) => pad(page, position).locator('div[style*="background-color"]');
const pressed = (page: Page, position: string) => pad(page, position).locator('img[src="/theme/btn_.png"]');
const starts = (page: Page) => page.evaluate(() => window.browserProbe.audio.starts.length);

async function loadPack(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer } = pack) {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(file);
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect(page.getByRole('button', { name: 'Play mode: Auto', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page).toHaveTitle(/^Browser Test Pack \|/);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
  const supportsMidi = await hasWebMidi(page);
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.requests)).toEqual(supportsMidi ? [{ sysex: true }] : []);
}

// Launchpad tests need the browser's own Web MIDI API (WebKit has none); there they are
// skipped as not applicable so the skip shows in the results instead of a failure.
const hasWebMidi = (page: Page) => page.evaluate(() => window.browserProbe.midi.supported);

const noWebMidi = 'Not applicable: this browser has no native Web MIDI API';

async function skipWithoutWebMidi(page: Page) {
  await page.goto('/play');
  test.skip(!await hasWebMidi(page), noWebMidi);
}

test('imports a local pack and restores the saved pack after reload', async ({ page }) => {
  await loadPack(page);
  await expect(page).toHaveURL(/\/play\?pack=.+/);
  await expect.poll(() => starts(page)).toBe(0);
  await page.reload();
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
  expect(await starts(page)).toBe(0);
});

test('pointer press/release plays/stops a loop and runs keyLed on another pad', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect.poll(() => starts(page)).toBe(1);
  expect(await page.evaluate(() => window.browserProbe.audio.starts[0])).toEqual({ id: 1, duration: 0.1, loop: true });
  await expect(led(page, '0,1')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await page.mouse.up();
  await expect(pressed(page, '0,0')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  await expect(led(page, '0,1')).toHaveCount(0);
});

test('keyboard down/up reaches the mapped pad and ignores repeated keydown', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.keyboard.down('q');
  await expect(pressed(page, '1,0')).toBeVisible();
  await expect.poll(() => starts(page)).toBe(1);
  await expect(led(page, '1,1')).toHaveCSS('background-color', 'rgb(0, 206, 60)');
  await page.keyboard.down('q');
  expect(await starts(page)).toBe(1);
  await page.keyboard.up('q');
  await expect(pressed(page, '1,0')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
});

test('pad audio reaches the output after volume control and becomes silent on release or mute', async ({ page, browser }, info) => {
  await loadPack(page);
  const rms = () => page.evaluate(() => window.browserProbe.audio.outputRms());
  await expect.poll(rms, 'a connected, idle output must be silent').toBe(0);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  let playingRms: number | null = null;
  await expect.poll(async () => {
    playingRms = await rms();
    return playingRms;
  }, 'the held pad must produce a nonzero post-volume audio signal').toBeGreaterThan(0.001);
  // Preserve the positive measurement even if a later control check fails.
  await info.attach('output-signal', {
    body: JSON.stringify({ playingRms, browser: info.project.name, browserVersion: browser.version(),
      measurement: 'RMS after application output gain, before native audio destination', humanListening: false }),
    contentType: 'application/json',
  });
  await page.mouse.up();
  await expect.poll(rms, 'release must silence the output').toBe(0);
  const releasedRms = await rms();

  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('input[type=range][max="7"]').fill('0');
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  await page.keyboard.down('q');
  await expect.poll(() => starts(page)).toBe(2);
  // Still playing a looping source: a pre-volume probe would incorrectly report sound.
  await expect.poll(rms, 'zero application volume must silence a running source').toBe(0);
  const mutedRms = await rms();
  await page.keyboard.up('q');
  await info.attach('output-signal-controls', {
    body: JSON.stringify({ playingRms, releasedRms, mutedRms,
      measurement: 'RMS after application output gain, before native audio destination',
      humanListening: false }),
    contentType: 'application/json',
  });
});

test('a chain change preserves the held loop until release and quit stops playback', async ({ page }) => {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(resolve('meta/unipack-conformance/chain-release-v1/packs/manual.uni'));
  await expect(page.locator('[data-pad]')).toHaveCount(64);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded.length)).toBe(3);
  await page.keyboard.down('1');
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect.poll(() => starts(page)).toBe(1);
  const chain = page.getByRole('button', { name: 'Chain 10', exact: true });
  await chain.click();
  await expect(chain.locator('div[style*="background-color"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.browserProbe.audio.stops)).toEqual([]);
  await page.keyboard.up('1');
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  await page.keyboard.down('q');
  await expect.poll(() => starts(page)).toBe(2);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Quit', exact: true }).click();
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Chain Release v1 manual by UniPad Tests', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1, 2]);
  await page.keyboard.up('q');
  await expect(page).not.toHaveURL(/pack=/);
});

test('auto-play starts, pauses without advancing, resumes, and stops', async ({ page }) => {
  await loadPack(page);
  const auto = page.getByRole('button', { name: 'Play mode: Auto', exact: true });
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => starts(page)).toBe(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const progress = await page.getByRole('progressbar').getAttribute('aria-valuenow');
  // Cross the next note deadline: a paused/stopped runner must emit nothing.
  await page.waitForTimeout(3500);
  expect(await starts(page)).toBe(1);
  expect(await page.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(progress);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => starts(page)).toBe(2);
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  // Cross the next note deadline: a paused/stopped runner must emit nothing.
  await page.waitForTimeout(3500);
  expect(await starts(page)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1, 2]);
});

test('Web MIDI discovers devices, receives notes, emits LED bytes and disconnects', async ({ page }) => {
  await skipWithoutWebMidi(page);
  test.setTimeout(90_000); // Keep connection checks bounded even on projects with a longer setup budget.
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages)).toContainEqual([0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x0e, 1, 0xf7]);
  await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
  await expect(dialog).toContainText('Input: Launchpad X Test Input');
  await expect(dialog).toContainText('Output: Launchpad X Test Output');
  await expect(dialog).toContainText('Resolved Type: launchpad_x');
  // The hint promises what the model picker does: a connected device is re-initialised at once.
  await expect(dialog).toContainText('Changing the model applies it immediately to devices that are already connected.');
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
  await dialog.locator('select').selectOption('launchpad_mini_mk3');
  await expect(dialog).toContainText('Resolved Type: launchpad_mini_mk3');
  // As on Android and iOS: lights off in the old layout, the new mode switch, then the whole board again.
  const modelChange = await midiMessages(page);
  const firstSysEx = modelChange.findIndex(m => m[0] === 0xf0);
  expect(firstSysEx, 'lights go off before the mode switch').toBeGreaterThan(0);
  expect(modelChange.slice(0, firstSysEx).every(m => m[2] === 0), 'only lights off before the mode switch').toBe(true);
  expect(modelChange.slice(firstSysEx, firstSysEx + 2)).toEqual([[0xf0, 0, 0x20, 0x29, 2, 0x0d, 0x10, 0, 0xf7], [0xf0, 0, 0x20, 0x29, 2, 0x0d, 0x0e, 1, 0xf7]]);
  const redrawn = modelChange.slice(firstSysEx + 2);
  expect(redrawn.filter(m => m[0] === 0xf0), 'one mode switch only').toEqual([]);
  expect(new Set(redrawn.filter(m => (m[0] & 0xe0) === 0x80).map(m => m[1])).size, 'every pad redrawn').toBeGreaterThanOrEqual(64);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
  await dialog.locator('select').selectOption('auto');
  await expect(dialog).toContainText('Resolved Type: launchpad_x');
  expect((await midiMessages(page)).filter(m => m[0] === 0xf0)).toEqual([[0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x10, 0, 0xf7], [0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x0e, 1, 0xf7]]);
  expect(await page.evaluate(() => window.browserProbe.midi.requests.length)).toBe(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; window.browserProbe.midi.emit([0x90, 81, 127]); });
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect.poll(() => starts(page)).toBe(1);
  await expect(led(page, '0,1')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages)).toContainEqual([0x90, 82, 5]);
  await page.evaluate(() => window.browserProbe.midi.emit([0x80, 81, 0]));
  await expect(pressed(page, '0,0')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.messages)).toContainEqual([0x80, 82, 0]);
  await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(dialog).toContainText('Disconnected');
  await expect(dialog.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
  // With nothing connected the choice waits for the next connect; no model is shown as in use.
  await dialog.locator('select').selectOption('launchpad_mini_mk3');
  await expect(dialog).toContainText('Requested Type: launchpad_mini_mk3');
  await expect(dialog).toContainText('Resolved Type: none');
  await dialog.locator('select').selectOption('auto');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.browserProbe.midi.requests.length)).toBe(2);
});

// CoreFW keeps the stock product name but names its ports "<model> (MIDI)", and plays and lights the
// drum-rack layout on channel 1: pad 0,0 is note 64, pad 0,1 note 65 (its src/utils/layout.rs).
test('a Launchpad running CoreFW is played and lit in its own layout', async ({ page }) => {
  test.slow();
  await skipWithoutWebMidi(page);
  await page.addInitScript(() => {
    const request = navigator.requestMIDIAccess.bind(navigator);
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async (options: MIDIOptions) => {
        const access = await request(options);
        for (const port of [...access.inputs.values(), ...access.outputs.values()]) {
          (port as { name: string }).name = 'LPX (MIDI)';
        }
        return access;
      },
    });
  });
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Launchpad Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Launchpad Settings', exact: true });
  await expect(dialog).toContainText('Output: LPX (MIDI)');
  await expect(dialog).toContainText('Resolved Type: launchpad_corefw');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await midiMessages(page)).filter(m => m[0] === 0xf0), 'no stock mode switch').toEqual([]);

  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; window.browserProbe.midi.emit([0x90, 64, 127]); });
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect(led(page, '0,1')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
  await expect.poll(() => padNoteMessages(page, 64)).toEqual([[0x90, 64, 3]]);
  await expect.poll(() => midiMessages(page)).toContainEqual([0x90, 65, 5]);
  await page.evaluate(() => window.browserProbe.midi.emit([0x80, 64, 0]));
  await expect(pressed(page, '0,0')).toHaveCount(0);
  await expect.poll(() => padNoteMessages(page, 64)).toEqual([[0x90, 64, 3], [0x80, 64, 0]]);
  await expect.poll(() => midiMessages(page)).toContainEqual([0x80, 65, 0]);
});

// Analytics calls are queued in gtag's dataLayer; the next event read after an input proves
// that the input was handled, since the events pass through Firebase in order.
const analyticsEvents = (page: Page) => page.evaluate(() =>
  ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
    .map(entry => Array.from(entry))
    .filter(([command]) => command === 'event')
    .map(([, name, params]) => ({ name, inputSource: (params as Record<string, unknown> | undefined)?.input_source })));

const padInputs: Record<'screen' | 'keyboard' | 'midi', (page: Page) => Promise<void>> = {
  screen: async page => { await pad(page, '0,0').hover(); await page.mouse.down(); await page.mouse.up(); },
  keyboard: async page => { await page.keyboard.down('q'); await page.keyboard.up('q'); },
  midi: page => page.evaluate(() => { window.browserProbe.midi.emit([0x90, 81, 127]); window.browserProbe.midi.emit([0x80, 81, 0]); }),
};

for (const [source, press] of Object.entries(padInputs)) {
  test(`the first pad press after a load is recorded once as ${source} input`, async ({ page }) => {
    await loadPack(page);
    const midi = await hasWebMidi(page);
    test.skip(source === 'midi' && !midi, noWebMidi);
    await press(page);
    for (const [other, otherPress] of Object.entries(padInputs)) if (other !== 'midi' || midi) await otherPress(page);
    await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
    await expect.poll(() => analyticsEvents(page).then(events => events.map(e => e.name))).toContain('autoplay_start');
    expect((await analyticsEvents(page)).filter(e => e.name === 'pad_press')).toEqual([{ name: 'pad_press', inputSource: source }]);
  });
}

test('autoplay pressing pads is not recorded as a player pad press', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  await expect.poll(() => starts(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  await padInputs.screen(page);
  await expect.poll(() => analyticsEvents(page).then(events => events.filter(e => e.name === 'pad_press'))).toEqual([{ name: 'pad_press', inputSource: 'screen' }]);
});

const midiMessages = (page: Page) => page.evaluate(() => window.browserProbe.midi.messages);
const padNoteMessages = async (page: Page, note: number) => (await midiMessages(page)).filter(m => (m[0] & 0xe0) === 0x80 && m[1] === note);

async function connectLaunchpadAndClear(page: Page) {
  test.skip(!await hasWebMidi(page), noWebMidi);
  await expect.poll(() => midiMessages(page)).toContainEqual([0xf0, 0, 0x20, 0x29, 2, 0x0c, 0x0e, 1, 0xf7]);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
}

// Android and iOS light a pressed pad red (velocity 3) on the launchpad as well as on screen.
test('the press light reaches the launchpad when it is on', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await connectLaunchpadAndClear(page);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect(pressed(page, '0,0')).toBeVisible();
  await expect.poll(() => padNoteMessages(page, 81)).toEqual([[0x90, 81, 3]]);
  await expect.poll(() => midiMessages(page)).toContainEqual([0x90, 82, 5]);
  await page.mouse.up();
  await expect(pressed(page, '0,0')).toHaveCount(0);
  await expect.poll(() => padNoteMessages(page, 81)).toEqual([[0x90, 81, 3], [0x80, 81, 0]]);
});

test('a pressed pad sends nothing to the launchpad while the press light is off', async ({ page }) => {
  await loadPack(page);
  await connectLaunchpadAndClear(page);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect.poll(() => starts(page)).toBe(1);
  await expect.poll(() => midiMessages(page)).toContainEqual([0x90, 82, 5]);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  expect(await padNoteMessages(page, 81)).toEqual([]);
});

test('with the pack lights and the press light off, no pad light reaches the launchpad', async ({ page }) => {
  await loadPack(page);
  await page.getByRole('button', { name: 'LED', exact: true }).click();
  await connectLaunchpadAndClear(page);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  await expect.poll(() => starts(page)).toBe(1);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.stops)).toEqual([1]);
  const padNotes = (await midiMessages(page)).filter(m => (m[0] & 0xe0) === 0x80 && m[1] % 10 >= 1 && m[1] % 10 <= 8 && m[1] >= 11 && m[1] <= 88);
  expect(padNotes).toEqual([]);
});

// The basic pack with two chains, where its two sound pads (rows 1 and 2 of column 1) light round
// button 9 (chain 1's button) and round button 10 (chain 2's button), each for a second.
async function roundLightPack(chains = 2, keyLeds: Record<string, string> = {
  '1 1 1 1': 'o mc 9 a 5\nd 1000\nf mc 9\n',
  '1 2 1 1': 'o mc 10 a 21\nd 1000\nf mc 10\n',
}) {
  const zip = await JSZip.loadAsync(await readFile(pack));
  zip.file('info', (await zip.file('info')!.async('string')).replace('chain=1', `chain=${chains}`));
  zip.remove('keyLED');
  for (const [name, script] of Object.entries(keyLeds)) zip.file(`keyLED/${name}`, script);
  return { name: 'round-lights.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

// On a Launchpad X the round buttons are control changes; button 9 is CC 89, button 10 is CC 79.
const roundLightMessages = async (page: Page, cc: number) => (await midiMessages(page)).filter(m => m[0] === 0xb0 && m[1] === cc);

async function tapPad(page: Page, position: string, presses: number) {
  await pad(page, position).hover();
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => starts(page)).toBe(presses);
}

// Android and iOS send a round button its highest remaining light whenever one of its lights
// changes: the selected chain's light (velocity 3) outranks pack lights, which reach round buttons
// only in Pro light mode.
test('a pack light ending on the selected chain button leaves the chain light on the launchpad', async ({ page }) => {
  await loadPack(page, await roundLightPack());
  await connectLaunchpadAndClear(page);
  await tapPad(page, '0,0', 1);
  await expect.poll(() => roundLightMessages(page, 89)).toEqual([[0xb0, 89, 3], [0xb0, 89, 3]]);
  await tapPad(page, '1,0', 2);
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 0], [0xb0, 79, 0]]);
});

test('in Pro light mode a pack light shows on a round button and turns off when it ends', async ({ page }) => {
  await loadPack(page, await roundLightPack());
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  // Turning Pro light mode on redraws the round buttons, and the changed setting the chain column,
  // both with the selected chain's light still on.
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 0], [0xb0, 79, 0]]);
  expect(await roundLightMessages(page, 89)).toEqual([[0xb0, 89, 3], [0xb0, 89, 3]]);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
  await tapPad(page, '0,0', 1);
  await expect.poll(() => roundLightMessages(page, 89)).toEqual([[0xb0, 89, 3], [0xb0, 89, 3]]);
  await tapPad(page, '1,0', 2);
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 21], [0xb0, 79, 0]]);
});

test('switching chains moves the chain light on the launchpad', async ({ page }) => {
  await loadPack(page, await roundLightPack());
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('F2');
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 3]]);
  expect(await roundLightMessages(page, 89)).toEqual([[0xb0, 89, 0]]);
});

// From the ninth chain on, the chain light sits on the bottom row (the tenth on CC 7), and hiding
// it redraws every round button as Android's chainBtnsRefresh does.
test('hiding the chain light turns it off on the launchpad from the ninth chain on', async ({ page }) => {
  await loadPack(page, await roundLightPack(12));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('F10');
  await expect.poll(() => roundLightMessages(page, 7)).toEqual([[0xb0, 7, 3]]);
  await page.keyboard.press('Alt+w');
  await expect.poll(async () => (await roundLightMessages(page, 7)).at(-1)).toEqual([0xb0, 7, 0]);
});

// Outside Pro light mode pack lights stay off the round buttons, so turning it off clears a pack
// light still on one (round button 20 is CC 5).
test('turning Pro light mode off clears a pack light left on a round button', async ({ page }) => {
  await loadPack(page, await roundLightPack(2, { '1 1 1 1': 'o mc 20 a 5\n' }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await tapPad(page, '0,0', 1);
  await expect.poll(async () => (await roundLightMessages(page, 5)).at(-1)).toEqual([0xb0, 5, 5]);
  await page.keyboard.press('Alt+p');
  await expect.poll(async () => (await roundLightMessages(page, 5)).at(-1)).toEqual([0xb0, 5, 0]);
});

// The open option panel shows the volume on the chain column; a pack light ending there leaves it.
test('a pack light ending under the open option panel leaves its volume lights', async ({ page }) => {
  await loadPack(page, await roundLightPack());
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await expect.poll(() => roundLightMessages(page, 79)).toEqual([[0xb0, 79, 0], [0xb0, 79, 0]]);
  await tapPad(page, '1,0', 1);
  await expect.poll(() => roundLightMessages(page, 79)).toContainEqual([0xb0, 79, 21]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await roundLightMessages(page, 79)).at(-1)).toEqual([0xb0, 79, 40]);
  await page.waitForTimeout(1500);
  expect((await roundLightMessages(page, 79)).at(-1)).toEqual([0xb0, 79, 40]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await roundLightMessages(page, 79)).at(-1)).toEqual([0xb0, 79, 0]);
});

// The watermark lights the top row's buttons 5 to 8 (button 5 is CC 95) and, as in Android and
// iOS, outranks a pack light there, so a pack light passing over it leaves the watermark on.
test('a pack light ending on a watermark button leaves the watermark light on the launchpad', async ({ page }) => {
  await loadPack(page, await roundLightPack(2, { '1 1 1 1': 'o mc 5 a 5\nd 1000\nf mc 5\n' }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await expect.poll(async () => (await roundLightMessages(page, 95)).at(-1)).toEqual([0xb0, 95, 61]);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
  await tapPad(page, '0,0', 1);
  await expect.poll(() => roundLightMessages(page, 95)).toEqual([[0xb0, 95, 61], [0xb0, 95, 61]]);
});

test('with the watermark off, a pack light on the top row turns off when it ends', async ({ page }) => {
  await loadPack(page, await roundLightPack(2, { '1 1 1 1': 'o mc 5 a 5\nd 1000\nf mc 5\n' }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await page.keyboard.press('Alt+w');
  await expect.poll(async () => (await roundLightMessages(page, 95)).at(-1)).toEqual([0xb0, 95, 0]);
  await page.evaluate(() => { window.browserProbe.midi.messages.length = 0; });
  await tapPad(page, '0,0', 1);
  await expect.poll(() => roundLightMessages(page, 95)).toEqual([[0xb0, 95, 5], [0xb0, 95, 0]]);
});

// The open option panel shows its settings on the top row (button 8, CC 98, is the quit light);
// a pack light ending there leaves it, and closing the panel brings the watermark back.
test('a pack light ending under the open option panel leaves its top-row lights', async ({ page }) => {
  await loadPack(page, await roundLightPack(2, { '1 1 1 1': 'o mc 8 a 21\nd 1000\nf mc 8\n' }));
  await connectLaunchpadAndClear(page);
  await page.keyboard.press('Alt+p');
  await tapPad(page, '0,0', 1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 5]);
  await page.waitForTimeout(1500);
  expect((await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 5]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await roundLightMessages(page, 98)).at(-1)).toEqual([0xb0, 98, 40]);
});

// Android 4.1.7 drew the pads off-centre (unipad-android#75); the web centred them in the space
// right of the menu, 61 px right of the screen's centre line on every landscape screen, and with
// the menu hidden it centred the pads together with the chain column, half a column to the left,
// and drew them at zero size, then at fractional sizes with seams between them.
const padGrid = (page: Page) => page.evaluate(() => {
  const pads = [...document.querySelectorAll('[data-pad]')].map(pad => pad.getBoundingClientRect());
  const left = Math.min(...pads.map(pad => pad.left));
  const right = Math.max(...pads.map(pad => pad.right));
  const top = Math.min(...pads.map(pad => pad.top));
  const bottom = Math.max(...pads.map(pad => pad.bottom));
  return {
    offCentre: Math.abs((left + right) / 2 - window.innerWidth / 2),
    heightShare: (bottom - top) / window.innerHeight,
    // Pads of a fractional width leave thin seams between neighbours.
    wholePixelPads: pads.every(pad => Number.isInteger(pad.width) && Number.isInteger(pad.height)),
  };
});

for (const [name, file] of [
  ['without a chain column', pack],
  ['with a chain column', resolve('meta/unipack-conformance/chain-release-v1/packs/manual.uni')],
]) {
  test(`pad grid sits on the screen centre line in landscape, ${name}`, async ({ page }) => {
    await page.goto('/play');
    await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(file);
    await expect(page.locator('[data-pad]')).toHaveCount(64);
    for (const hideUI of [false, true]) {
      if (hideUI) await page.keyboard.press('Alt+h');
      await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toHaveCount(hideUI ? 0 : 1);
      for (const [width, height] of [[915, 402], [844, 390], [1280, 720], [1920, 1080]]) {
        await page.setViewportSize({ width, height });
        const screen = `${width}x${height}${hideUI ? ' menu hidden' : ''}`;
        await expect.poll(async () => (await padGrid(page)).offCentre, screen).toBeLessThanOrEqual(1);
        await expect.poll(async () => (await padGrid(page)).heightShare, screen).toBeGreaterThan(0.8);
        await expect.poll(async () => (await padGrid(page)).wholePixelPads, screen).toBe(true);
      }
    }
  });
}
