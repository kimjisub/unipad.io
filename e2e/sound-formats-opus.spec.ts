import { readFile } from 'node:fs/promises';
import { test, expect } from './browser';
import { expectHeldPadPlays, observeFormatBuffers, openFormatPack, sha256 } from './sound-format-probe';

/**
 * Opus in an MP4 container, mono and 5.1: two-second 48 kHz sines from the shared corpus (see the README in
 * that folder). The corpus admits them, so every engine must decode them in the player's own context and
 * play them. The corpus's short-table variants of these files, whose time table was cut on purpose, are not
 * covered here. Engines trim the stream differently (Chromium and Firefox keep 96,336 frames at 48 kHz,
 * WebKit keeps exactly 96,000), so the length is checked to about one Opus packet.
 */
const fixtures = 'src/lib/unipack/__fixtures__/audio-safety';
const cases = [['libopus-48000-1.m4a', 1], ['libopus-48000-6.m4a', 6]] as const;
// The player's output rate (src/lib/unipack/audioOutput.ts); decoding resamples to it.
const playerSampleRate = 44100;

for (const [file, channels] of cases) {
  test(`Opus in M4A with ${channels} channel${channels > 1 ? 's' : ''} decodes to two seconds and plays`, async ({ page, browser }, info) => {
    await observeFormatBuffers(page);
    const bytes = await readFile(`${fixtures}/${file}`);
    const encodedSha256 = sha256(bytes);
    const [decoded] = await openFormatPack(page, { keySound: `1 1 1 ${file} 0\n`, [`sounds/${file}`]: bytes }, 1);
    expect(decoded.encodedSha256).toBe(encodedSha256);
    expect(decoded.channels).toBe(channels);
    expect(decoded.sampleRate).toBe(playerSampleRate);
    expect(decoded.duration).toBeGreaterThan(1.98);
    expect(decoded.duration).toBeLessThan(2.03);
    await expectHeldPadPlays(page, '0,0', encodedSha256, async ({ started, playingRms }) => {
      await info.attach('opus-m4a-audio', {
        body: JSON.stringify({ file, decoded, started, playingRms, browser: info.project.name, browserVersion: browser.version() }),
        contentType: 'application/json',
      });
    });
  });
}
