import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openBasicWith } from './basic-pack';
import { test, expect } from './browser';
import { pad } from './touch';
import { formatAudio, observeFormatBuffers } from './sound-format-probe';

/**
 * Opus in an MP4 container, mono and 5.1: two-second 48 kHz sines from the shared corpus (see the README in
 * that folder). The corpus admits both, so every engine must decode them in the player's own context and
 * play them. Engines trim the stream differently (Chromium and Firefox keep 96,336 frames at 48 kHz, WebKit
 * keeps exactly 96,000), so the length is checked to about one Opus packet.
 */
const fixtures = 'src/lib/unipack/__fixtures__/audio-safety';
const cases = [['libopus-48000-1.m4a', 1], ['libopus-48000-6.m4a', 6]] as const;

for (const [file, channels] of cases) {
  test(`Opus in M4A with ${channels} channel${channels > 1 ? 's' : ''} decodes to two seconds and plays`, async ({ page, browser }, info) => {
    await observeFormatBuffers(page);
    const bytes = await readFile(`${fixtures}/${file}`);
    const encodedSha256 = createHash('sha256').update(bytes).digest('hex');
    await openBasicWith(page, { keySound: `1 1 1 ${file}\n`, [`sounds/${file}`]: bytes }, ['keyLED', 'autoPlay']);
    await expect.poll(async () => (await formatAudio(page)).decodedBuffers.length).toBe(1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const [decoded] = (await formatAudio(page)).decodedBuffers;
    expect(decoded.encodedSha256).toBe(encodedSha256);
    expect(decoded.channels).toBe(channels);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.duration).toBeGreaterThan(1.98);
    expect(decoded.duration).toBeLessThan(2.03);

    const rms = () => page.evaluate(() => window.browserProbe.audio.outputRms());
    await pad(page, '0,0').hover();
    await page.mouse.down();
    try {
      await expect.poll(async () => (await formatAudio(page)).starts.length).toBe(1);
      const [started] = (await formatAudio(page)).starts;
      expect(started.bufferId).toBe(decoded.id);
      let playingRms: number | null = null;
      await expect.poll(async () => {
        playingRms = await rms();
        return playingRms;
      }).toBeGreaterThan(0.001);
      await info.attach('opus-m4a-audio', {
        body: JSON.stringify({ file, decoded, started, playingRms, browser: info.project.name, browserVersion: browser.version() }),
        contentType: 'application/json',
      });
    } finally {
      await page.mouse.up();
    }
  });
}
