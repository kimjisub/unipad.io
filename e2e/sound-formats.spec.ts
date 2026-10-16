import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { openBasicWith } from './basic-pack';
import { test, expect } from './browser';
import { pad } from './touch';

const audio = (page: Page) => page.evaluate(() => window.browserProbe.audio);

/**
 * basic.uni without its lights and auto play, with the given files written over it. tone.wav is basic.uni's
 * 100 ms 440 Hz PCM tone; e2e/fixtures/tone.m4a is that tone encoded as AAC by macOS:
 *   afconvert -f m4af -d aac -b 64000 tone.wav tone.m4a
 * and tone-440.mp3 is the conformance corpus's MP3 (see meta/unipack-conformance/lib.mjs).
 */
function loadPack(page: Page, files: Record<string, string | Uint8Array>) {
  return openBasicWith(page, files, ['keyLED', 'autoPlay']);
}

async function tap(page: Page, position: string) {
  await pad(page, position).hover();
  await page.mouse.down();
  await page.mouse.up();
}

test('WAV, MP3, M4A and an MP3 named .wav all decode and play', async ({ page }) => {
  const mp3 = await readFile('meta/unipack-conformance/assets/tone-440.mp3');
  await loadPack(page, {
    keySound: '1 1 1 tone.wav\n1 2 1 tone.mp3\n1 3 1 tone.m4a\n1 4 1 mp3-named.wav\n',
    'sounds/tone.mp3': mp3,
    'sounds/tone.m4a': await readFile('e2e/fixtures/tone.m4a'),
    'sounds/mp3-named.wav': mp3,
  });
  await expect.poll(async () => (await audio(page)).decoded.length).toBe(4);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  for (const [i, position] of ['0,0', '1,0', '2,0', '3,0'].entries()) {
    await tap(page, position);
    await expect.poll(async () => (await audio(page)).starts.length).toBe(i + 1);
  }
  for (const start of (await audio(page)).starts) expect(start.duration).toBeGreaterThan(0);
});

test('a sound that cannot be decoded is silent once and the pad goes on to its next sound', async ({ page }) => {
  await loadPack(page, {
    keySound: '1 1 1 broken.wav\n1 1 1 tone.wav\n',
    'sounds/broken.wav': 'not audio',
  });
  await expect(page.getByRole('alertdialog')).toContainText('1 audio file(s) failed to decode');
  await page.getByRole('alertdialog').getByRole('button').click();
  await expect.poll(async () => (await audio(page)).decoded).toEqual([0.1]);

  await tap(page, '0,0');
  await page.waitForTimeout(200);
  expect((await audio(page)).starts).toEqual([]);
  await tap(page, '0,0');
  await expect.poll(async () => (await audio(page)).starts.length).toBe(1);
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
