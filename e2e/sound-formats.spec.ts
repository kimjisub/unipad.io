import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { basicTone, openBasicWith, undecodablePack } from './basic-pack';
import { test, expect } from './browser';
import { savedRecords } from './saved-packs';
import { pad } from './touch';
import { formatAudio, observeFormatBuffers } from './sound-format-probe';

const audio = (page: Page) => page.evaluate(() => window.browserProbe.audio);

/**
 * basic.uni without its lights and auto play, with the given files written over it. tone.wav is basic.uni's
 * 100 ms 440 Hz PCM tone; e2e/fixtures/tone.m4a is that tone encoded as AAC by macOS:
 *   afconvert -f m4af -d aac -b 64000 tone.wav tone.m4a
 * tone.ogg is the same PCM tone encoded with FFmpeg native Vorbis (see fixtures/README.md);
 * tone-440.mp3 is the conformance corpus's MP3 (see meta/unipack-conformance/lib.mjs);
 * tone-660.mp3 is a distinct synthetic tone for the misleading-extension pad (see fixtures/README.md).
 */
function loadPack(page: Page, files: Record<string, string | Uint8Array>) {
  return openBasicWith(page, files, ['keyLED', 'autoPlay']);
}

async function tap(page: Page, position: string) {
  await pad(page, position).hover();
  await page.mouse.down();
  await page.mouse.up();
}

const formats = [
  ['A-01', 'WAV PCM', 'tone.wav', () => basicTone()],
  ['A-02', 'MP3', 'tone.mp3', () => readFile('meta/unipack-conformance/assets/tone-440.mp3')],
  ['A-03', 'OGG Vorbis', 'tone.ogg', () => readFile('e2e/fixtures/tone.ogg')],
  ['A-04', 'M4A AAC', 'tone.m4a', () => readFile('e2e/fixtures/tone.m4a')],
  ['A-05', 'MP3 named .wav', 'mp3-named.wav', () => readFile('e2e/fixtures/tone-660.mp3')],
] as const;

for (const [index, [item, format, filename, bytes]] of formats.entries()) {
  test(`${item} ${format} decodes and plays its own buffer with an output signal`, async ({ page, browser }, info) => {
    await observeFormatBuffers(page);
    const entries = await Promise.all(formats.map(async ([, , name, read]) => [name, await read()] as const));
    const hashes = entries.map(([, data]) => createHash('sha256').update(data).digest('hex'));
    expect(new Set(hashes).size, 'each pad must have distinguishable encoded bytes').toBe(formats.length);
    const expectedHash = createHash('sha256').update(await bytes()).digest('hex');
    await loadPack(page, {
      keySound: formats.map(([, , name], i) => `1 ${i + 1} 1 ${name} 0\n`).join(''),
      ...Object.fromEntries(entries.map(([name, data]) => [`sounds/${name}`, data])),
    });
    await expect.poll(async () => (await formatAudio(page)).decodedBuffers.length).toBe(5);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const decodedBuffers = (await formatAudio(page)).decodedBuffers;
    const decoded = decodedBuffers.find(buffer => buffer.encodedSha256 === expectedHash)!;
    expect(decoded, 'the expected encoded file must reach native decoding').toBeDefined();
    expect(decoded.duration).toBeGreaterThan(0);
    expect(decoded.duration).toBeLessThan(1);
    const rms = () => page.evaluate(() => window.browserProbe.audio.outputRms());
    await expect.poll(rms).toBe(0);
    await pad(page, `${index},0`).hover();
    await page.mouse.down();
    try {
      await expect.poll(async () => (await formatAudio(page)).starts.length).toBe(1);
      const [started] = (await formatAudio(page)).starts;
      const playedBuffer = decodedBuffers.find(buffer => buffer.id === started.bufferId);
      expect(playedBuffer?.encodedSha256).toBe(expectedHash);
      expect(started.duration).toBe(playedBuffer!.duration);
      expect(started.loop).toBe(true);
      let playingRms: number | null = null;
      await expect.poll(async () => {
        playingRms = await rms();
        return playingRms;
      }).toBeGreaterThan(0.001);
      await info.attach('grammar-audio', {
        body: JSON.stringify({ item, format, filename, decoded: playedBuffer, started, playingRms,
          browser: info.project.name, browserVersion: browser.version(),
          measurement: 'RMS after application output gain, before native destination', humanListening: false }),
        contentType: 'application/json',
      });
    } finally {
      await page.mouse.up();
    }
    await expect.poll(rms).toBe(0);
  });
}

test('a sound file that cannot be read is silent once and the pad goes on to its next sound', async ({ page }) => {
  await loadPack(page, {
    keySound: '1 1 1 broken.wav\n1 1 1 tone.wav\n',
    'sounds/broken.wav': 'not audio',
  });
  await expect(page.getByRole('status').filter({ hasText: '1 sound file cannot be read' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(async () => (await audio(page)).decoded).toEqual([0.1]);

  await tap(page, '0,0');
  await page.waitForTimeout(200);
  expect((await audio(page)).starts).toEqual([]);
  await tap(page, '0,0');
  await expect.poll(async () => (await audio(page)).starts.length).toBe(1);
});

/** Counts the pack opens that failed from now on. */
function countLoadFailures(page: Page) {
  const count = { failures: 0 };
  page.on('console', (message) => { if (message.text().includes('Failed to load UniPack')) count.failures += 1; });
  return count;
}

const loadError = (page: Page) => page.getByRole('alertdialog', { name: 'Error', exact: true });
const soundFailure = (page: Page) => page.getByRole('alertdialog', { name: 'Cannot open this pack’s sounds', exact: true });
const totalPlays = (page: Page) => page.getByText('Total Plays', { exact: true }).locator('xpath=preceding-sibling::div');

/** Leaves the notice of a pack whose sounds all failed and waits for the list to show again. */
async function quitLoadError(page: Page) {
  await soundFailure(page).getByRole('button', { name: 'Pack list', exact: true }).click();
  await expect(soundFailure(page)).toHaveCount(0);
}

test('a pack none of whose sounds can be read ends loading with the reason and a way back to the list', async ({ page }, info) => {
  const count = countLoadFailures(page);
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(await undecodablePack());
  try {
    await expect(soundFailure(page)).toContainText('1 sound file cannot be read');
    await expect(page.getByText(/Loading audio/)).toHaveCount(0);
  } finally {
    await info.attach('all-sounds-failed', { body: await page.screenshot(), contentType: 'image/png' });
  }
  // The failed pack is listed, but the address must not point at it: that would open it again.
  await expect(page.getByRole('listbox', { name: 'UniPack list' }).getByRole('option')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.has('pack')).toBe(false);
  await quitLoadError(page);
  await expect(totalPlays(page)).toHaveText('0');
  expect(count.failures).toBe(1);
  await info.attach('after-quit', { body: await page.screenshot(), contentType: 'image/png' });
});

test('a saved pack none of whose sounds can be read opens once from the list and counts one play', async ({ page }, info) => {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(await undecodablePack());
  await quitLoadError(page);
  await page.goto('/play');
  const count = countLoadFailures(page);
  const option = page.getByRole('listbox', { name: 'UniPack list' }).getByRole('option');
  await option.click();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  try {
    await expect(soundFailure(page)).toContainText('1 sound file cannot be read');
  } finally {
    await info.attach('opened-from-list', { body: await page.screenshot(), contentType: 'image/png' });
  }
  // An address naming the failed pack would open it a second time as soon as loading ends.
  expect(new URL(page.url()).searchParams.has('pack')).toBe(false);
  await quitLoadError(page);
  await expect(totalPlays(page)).toHaveText('1');
  expect(count.failures).toBe(1);
  await info.attach('after-quit', { body: await page.screenshot(), contentType: 'image/png' });
});

test('an address naming a saved pack none of whose sounds can be read opens it once and drops the pack', async ({ page }, info) => {
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(await undecodablePack());
  await quitLoadError(page);
  const [{ id }] = await savedRecords(page);
  const count = countLoadFailures(page);
  await page.goto(`/play?pack=${encodeURIComponent(id)}`);
  try {
    await expect(soundFailure(page)).toContainText('1 sound file cannot be read');
  } finally {
    await info.attach('opened-from-address', { body: await page.screenshot(), contentType: 'image/png' });
  }
  // Left in the address, the pack would open again on every reload.
  await expect(page).not.toHaveURL(/[?&]pack=/);
  await quitLoadError(page);
  await expect(totalPlays(page)).toHaveText('1');
  expect(count.failures).toBe(1);
});

test('a pack none of whose sounds can be read, dropped over a playing pack, keeps its reason and leaves the address', async ({ page }, info) => {
  await loadPack(page, {});
  await expect(page).toHaveURL(/[?&]pack=/);
  const count = countLoadFailures(page);
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(await undecodablePack());
  await expect(soundFailure(page)).toContainText('1 sound file cannot be read');
  // The playing pack closed when the new one began to open; its address would open it over the reason.
  await expect(page).not.toHaveURL(/[?&]pack=/);
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  await expect(soundFailure(page)).toBeVisible();
  await info.attach('dropped-over-playing', { body: await page.screenshot(), contentType: 'image/png' });
  await quitLoadError(page);
  expect(count.failures).toBe(1);
});

test('an archive that cannot be read, dropped over a playing pack, shows the reason and leaves the address', async ({ page }, info) => {
  await loadPack(page, {});
  await expect(page).toHaveURL(/[?&]pack=/);
  const count = countLoadFailures(page);
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({
    name: 'broken.uni', mimeType: 'application/zip', buffer: Buffer.from('not a zip archive'),
  });
  try {
    await expect(loadError(page)).toBeVisible();
  } finally {
    await info.attach('unreadable-dropped-over-playing', { body: await page.screenshot(), contentType: 'image/png' });
  }
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  // The playing pack closed when this one began to open; its address would open it on the next reload.
  await expect(page).not.toHaveURL(/[?&]pack=/);
  await page.reload();
  await expect(page.getByRole('listbox', { name: 'UniPack list' }).getByRole('option')).toHaveCount(1);
  // Give an address restore time to open the pack.
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  expect(count.failures).toBe(1);
});

test('a pack none of whose sounds can be read closes its audio when loading ends', async ({ page }) => {
  await page.addInitScript(() => {
    const contexts: AudioContext[] = [];
    Reflect.set(window, 'audioContexts', contexts);
    window.AudioContext = class extends AudioContext {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        contexts.push(this);
      }
    };
  });
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(await undecodablePack());
  await expect(soundFailure(page)).toContainText('1 sound file cannot be read');
  // A pack left behind would keep its audio and could hold the screen awake while the reason is shown.
  await expect.poll(() => page.evaluate(() =>
    (Reflect.get(window, 'audioContexts') as AudioContext[]).map(context => context.state))).toEqual(['closed']);
});

// touch is on + off in one line: the wormhole of the touched pad's sound moves the lines after it to
// that chain, as it does after on.
test('auto-play `touch` of a sound with a wormhole plays the following lines in that chain', async ({ page }) => {
  await loadPack(page, {
    info: 'title=Browser Test Pack\nproducerName=UniPad Tests\nbuttonX=8\nbuttonY=8\nchain=2\nsquareButton=true\n',
    keySound: '1 1 1 tone.wav 1 2\n2 1 1 tone.wav 2\n',
    autoPlay: 't 1 1\nd 500\no 1 1\nd 200\nf 1 1\nd 3000\n',
  });
  await expect.poll(async () => (await audio(page)).decoded).toEqual([0.1]);
  await page.getByRole('button', { name: 'Play mode: Auto', exact: true }).click();
  await expect.poll(async () => (await audio(page)).starts.length).toBe(2);
  // The second press is chain 2's sound, which repeats; chain 1's plays once.
  expect((await audio(page)).starts.map(start => start.loop)).toEqual([false, true]);
});
