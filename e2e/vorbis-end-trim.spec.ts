import { readFile } from 'node:fs/promises';
import { test, expect } from './browser';
import { pad } from './touch';
import { formatAudio, observeFormatBuffers, openFormatPack, sha256 } from './sound-format-probe';
import { shiftVorbisGranules } from './fixtures/vorbis-granules';

for (const leading of [0, 500]) {
test(`Vorbis short-block tail with ${leading} leading discard preserves actual sound`, async ({ page, browser }, info) => {
  await observeFormatBuffers(page);
  await page.addInitScript(() => {
    let decoded: AudioBuffer;
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (...args: Parameters<typeof decode>) {
      return decode.apply(this, args).then(buffer => { decoded = buffer; return buffer; });
    };
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = createSource.call(this);
      const start = source.start.bind(source);
      source.start = (...args) => {
        const played = source.buffer!;
        // Compare every played sample to the specific native decode, including a copied tail trim.
        const matches = played.numberOfChannels === decoded.numberOfChannels &&
          Array.from({ length: played.numberOfChannels }, (_, c) => {
            const original = decoded.getChannelData(c);
            return played.getChannelData(c).every((value, i) => value === original[i]);
          }).every(Boolean);
        document.documentElement.dataset.vorbisSamplesMatch = String(matches);
        start(...args);
      };
      return source;
    };
  });
  const bytes = shiftVorbisGranules(await readFile('e2e/fixtures/vorbis-short-tail.ogg'), leading);
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
        leadingDiscard: leading, samplesMatch: await page.locator('html').getAttribute('data-vorbis-samples-match'),
        browser: info.project.name, browserVersion: browser.version(), humanListening: false }),
      contentType: 'application/json',
    });
    expect(decoded.encodedSha256).toBe(sha256(bytes));
    expect(started.duration).toBe(leading ? decoded.duration : 17640 / 44100);
    await expect(page.locator('html')).toHaveAttribute('data-vorbis-samples-match', 'true');
    if (leading) expect(started.bufferId).toBe(decoded.id);
    expect(started.loop).toBe(true);
  } finally { await page.mouse.up(); }
  await expect.poll(rms).toBe(0);
  await info.attach('vorbis-tail-screen', { body: await page.screenshot(), contentType: 'image/png' });
  expect(decoded.sampleRate).toBe(44100);
});
}
