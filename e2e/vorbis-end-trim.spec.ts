import { readFile } from 'node:fs/promises';
import { test, expect } from './browser';
import { pad } from './touch';
import { formatAudio, observeFormatBuffers, openFormatPack, sha256 } from './sound-format-probe';

test('Vorbis with a short-block tail loads and plays exactly its inspected length', async ({ page, browser }, info) => {
  await observeFormatBuffers(page);
  const bytes = await readFile('e2e/fixtures/vorbis-short-tail.ogg');
  const [decoded] = await openFormatPack(page, {
    keySound: '1 1 1 tail.ogg 0\n', 'sounds/tail.ogg': bytes,
  }, 1);
  const rms = () => page.evaluate(() => window.browserProbe.audio.outputRms());
  await expect.poll(rms).toBe(0);
  await pad(page, '0,0').hover();
  await page.mouse.down();
  try {
    await expect.poll(async () => (await formatAudio(page)).starts.length).toBe(1);
    await expect.poll(rms).toBeGreaterThan(0.001);
    const [started] = (await formatAudio(page)).starts;
    await info.attach('vorbis-tail-audio', {
      body: JSON.stringify({ decoded, started, playingRms: await rms(), inspectedFrames: 17640,
        browser: info.project.name, browserVersion: browser.version(), humanListening: false }),
      contentType: 'application/json',
    });
    expect(decoded.encodedSha256).toBe(sha256(bytes));
    expect(started.duration).toBe(17640 / 44100);
    expect(started.loop).toBe(true);
  } finally { await page.mouse.up(); }
  await expect.poll(rms).toBe(0);
  await info.attach('vorbis-tail-screen', { body: await page.screenshot(), contentType: 'image/png' });
  expect(decoded.sampleRate).toBe(44100);
});
