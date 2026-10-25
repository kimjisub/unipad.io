import JSZip from 'jszip';
import { unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { test, expect, expectPads } from './browser';

// Opt-in diagnostic: generates original PCM data, never downloads a user's pack.
test.skip(!process.env.STORAGE_MEMORY_PROBE, 'Set STORAGE_MEMORY_PROBE=1 for the large-pack memory measurement.');
for (let round = 0; round < 3; round++) {
  for (const history of [false, true]) {
    test(`large pack memory: history ${history ? 'on' : 'off'}, round ${round + 1}`, async ({ page, context, browser }, info) => {
      test.setTimeout(120_000);
      const zip = new JSZip();
      zip.file('info', 'title=Memory Test Pack\nproducerName=Tests\nbuttonX=8\nbuttonY=8\nchain=1\n');
      const bytes = 3 * 1024 * 1024;
      const wav = Buffer.alloc(bytes + 44);
      wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
      wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
      let random = 12345;
      for (let i = 44; i < wav.length; i += 2) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        wav.writeInt16LE((random >>> 16) - 32768, i);
      }
      for (let i = 0; i < 32; i++) zip.file(`sounds/${i}.wav`, wav);
      zip.file('keySound', Array.from({ length: 32 }, (_, i) => `1 ${Math.floor(i / 8) + 1} ${i % 8 + 1} ${i}.wav 1`).join('\n'));
      const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
      const fixture = info.outputPath('memory-fixture.uni');
      await writeFile(fixture, archive);
      await page.goto('/play');
      try {
        await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles(fixture);
        await expectPads(page);
        await expect(page).toHaveURL(/pack=/);
      } finally {
        await unlink(fixture);
      }
      await page.goto('/play');
      const option = page.getByRole('option', { name: 'Memory Test Pack by Tests', exact: true });
      await expect(option).toBeVisible();
      if (!history) await page.evaluate(() => {
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof transaction>) {
          if (args[1] === 'readwrite' && (args[0] === 'unipacks' || args[0] === 'unipackMetadata')) throw new DOMException('History disabled for measurement.', 'AbortError');
          return Reflect.apply(transaction, this, args);
        } as typeof transaction;
      });
      await info.attach('before-open', { body: await page.screenshot(), contentType: 'image/png' });
      const cdp = await context.newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const root = await browser.newBrowserCDPSession();
      const { processInfo } = await root.send('SystemInfo.getProcessInfo');
      const pids = processInfo.filter(p => p.type === 'renderer').map(p => p.id);
      const samples: { ms: number; usedSize: number; backingStorageSize: number; rssKiB: number }[] = [];
      let sampling = true;
      const start = Date.now();
      const sample = async () => {
        while (sampling) {
          const heap = await cdp.send('Runtime.getHeapUsage');
          const rssKiB = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')], { encoding: 'utf8' }).trim().split(/\s+/).reduce((n, value) => n + Number(value), 0);
          samples.push({ ms: Date.now() - start, usedSize: heap.usedSize, backingStorageSize: heap.backingStorageSize ?? 0, rssKiB });
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      const samplingDone = sample();
      try {
        await option.press('Enter');
        await expectPads(page);
        await page.waitForTimeout(500);
        await info.attach('after-open', { body: await page.screenshot(), contentType: 'image/png' });
      } finally {
        sampling = false;
        await samplingDone;
        const result = { history, round: round + 1, archiveBytes: archive.length, decodedSounds: await page.evaluate(() => window.browserProbe.audio.decoded.length), chromium: browser.version(), baseline: samples[0], peakBackingBytes: Math.max(...samples.map(s => s.backingStorageSize)), peakRssKiB: Math.max(...samples.map(s => s.rssKiB)), samples };
        console.log(JSON.stringify({ ...result, samples: samples.length }));
        await info.attach('memory-measurement', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
      }
    });
  }
}
