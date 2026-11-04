import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { basicTone, openBasicWith } from './basic-pack';
import { test, expect, expectPads } from './browser';
import { pad } from './touch';

// Which sounds a pack loads is decided by reading each file before decoding it, under limits shared
// with the Android and iOS apps. What did not load is told once, by cause, with each file on request.

const messages = (locale: string) => JSON.parse(readFileSync(resolve(`src/i18n/messages/${locale}.json`), 'utf8')).play.soundLoad;

/** 8-bit mono PCM whose samples, and so its last byte, all equal `mark`. */
function wave(rate: number, frames: number, mark: number): Uint8Array {
  const b = Buffer.alloc(44 + frames, mark);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(frames, 40);
  return b;
}

// Fault injection: a browser refuses the decode of a file ending in DECODE_FAILS as it refuses a codec
// it lacks, and of one ending in OUT_OF_MEMORY as an allocation that failed. Real low memory is not
// produced here.
const DECODE_FAILS = 0xd1;
const OUT_OF_MEMORY = 0xd2;
async function injectDecodeFailures(page: Page) {
  await page.addInitScript(([decodeFails, outOfMemory]) => {
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (this: AudioContext, data: ArrayBuffer, ...rest: unknown[]) {
      const last = new Uint8Array(data).at(-1);
      if (last === decodeFails) return Promise.reject(new DOMException('Unable to decode audio data', 'EncodingError'));
      if (last === outOfMemory) return Promise.reject(new RangeError('Array buffer allocation failed'));
      return Reflect.apply(decode, this, [data, ...rest]);
    } as typeof decode;
  }, [DECODE_FAILS, OUT_OF_MEMORY]);
}

/** One file for each cause, on the first four pads of the first column; the fifth pad's tone plays. */
const everyCause = async () => ({
  keySound: '1 1 1 long.wav\n1 2 1 broken.wav\n1 3 1 refused.wav\n1 4 1 large.wav\n1 5 1 tone.wav\n',
  // Ten minutes and one second, a frame count read from the data itself.
  'sounds/long.wav': wave(8000, 601 * 8000, 0x80),
  'sounds/broken.wav': 'not audio',
  'sounds/refused.wav': wave(8000, 800, DECODE_FAILS),
  'sounds/large.wav': wave(8000, 800, OUT_OF_MEMORY),
  'sounds/tone.wav': await basicTone(),
});

const notice = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Details' }) });
const failure = (page: Page) => page.getByRole('alertdialog', { name: 'Cannot open this pack’s sounds', exact: true });
const details = (page: Page) => page.getByRole('dialog', { name: 'Details', exact: true });

test('some sounds left out or failed: the pack plays the rest and tells each cause once', async ({ page }, info) => {
  await injectDecodeFailures(page);
  // Files are read on a worker, so a long one cannot freeze the page; reading in place is only a fallback.
  const workers: string[] = [];
  const inPlace: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  page.on('console', message => { if (message.text().includes('Reading sound files on the page')) inPlace.push(message.text()); });
  await openBasicWith(page, await everyCause(), ['keyLED', 'autoPlay']);
  await expect(notice(page).locator('p')).toHaveText([
    '1 sound is too long or large and will not play',
    '1 sound file cannot be read',
    '1 sound cannot be played',
    'Device memory is low. 1 sound could not be loaded. Close other apps and reopen the pack.',
  ]);
  await info.attach('partial-notice', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  expect(workers.length, 'the files were read on a worker').toBe(1);
  expect(inPlace).toEqual([]);
  // Only the admitted files reached the decoder, and the one that decoded is the only one that plays.
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded)).toEqual([0.1]);
  for (const silent of ['0,0', '1,0', '2,0', '3,0']) {
    await pad(page, silent).hover();
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(0);
  await pad(page, '4,0').hover();
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(1);

  await notice(page).getByRole('button', { name: 'Details' }).click();
  await expect(details(page).getByRole('listitem')).toHaveText([
    'long.wavToo long or too large',
    'broken.wavFile cannot be read',
    'refused.wavSound cannot be played',
    'large.wavInsufficient device memory',
  ]);
  await info.attach('partial-details', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await details(page).getByRole('button', { name: 'Close' }).click();
  // Closing the list goes back to playing; the notice is not shown again for this open.
  await expect(details(page)).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);
  await expectPads(page);
});

test('the Korean notice and file list use the approved wording', async ({ page, baseURL }, info) => {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'ko', url: baseURL }]);
  await injectDecodeFailures(page);
  await openBasicWith(page, await everyCause(), ['keyLED', 'autoPlay']);
  const ko = messages('ko');
  const status = page.getByRole('status').filter({ has: page.getByRole('button', { name: ko.details }) });
  await expect(status.locator('p')).toHaveText([
    '너무 길거나 큰 소리 1개는 재생하지 않습니다',
    '소리 1개의 파일을 읽을 수 없습니다',
    '소리 1개를 재생할 수 없습니다',
    '기기 메모리가 부족해 소리 1개를 불러오지 못했습니다. 다른 앱을 닫고 팩을 다시 열어 보세요',
  ]);
  await info.attach('ko-partial-notice', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await status.getByRole('button', { name: '자세히 보기' }).click();
  const list = page.getByRole('dialog', { name: '자세히 보기', exact: true });
  await expect(list.getByRole('listitem')).toHaveText([
    'long.wav너무 길거나 큰 소리', 'broken.wav파일을 읽을 수 없습니다', 'refused.wav재생할 수 없습니다', 'large.wav기기 메모리 부족',
  ]);
  await info.attach('ko-partial-details', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await list.getByRole('button', { name: '닫기' }).click();
  await expect(list).toHaveCount(0);
});

test('a pack whose sounds all fail stays out of the player with details, retry and the pack list', async ({ page }, info) => {
  await injectDecodeFailures(page);
  const opens: string[] = [];
  page.on('console', message => { if (message.text().includes('Failed to load UniPack')) opens.push(message.text()); });
  await page.goto('/play');
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(readFileSync(resolve('e2e/fixtures/basic.uni')));
  zip.remove('keyLED');
  zip.remove('autoPlay');
  zip.file('keySound', '1 1 1 refused.wav\n1 1 2 broken.wav\n');
  zip.file('sounds/refused.wav', wave(8000, 800, DECODE_FAILS));
  zip.file('sounds/broken.wav', 'not audio');
  zip.remove('sounds/tone.wav');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({
    name: 'pack.uni', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(failure(page)).toContainText('1 sound file cannot be read1 sound cannot be played');
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('pack')).toBe(false);
  await info.attach('all-failed', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });

  await failure(page).getByRole('button', { name: 'Details' }).click();
  await expect(details(page).getByRole('listitem')).toHaveText(['refused.wavSound cannot be played', 'broken.wavFile cannot be read']);
  await info.attach('all-failed-details', { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await details(page).getByRole('button', { name: 'Close' }).click();
  await expect(failure(page)).toBeVisible();

  // Retry opens the stored pack again from the start, and it fails the same way.
  await expect(page.getByRole('listbox', { name: 'UniPack list' }).getByRole('option')).toHaveCount(1);
  await expect.poll(() => opens.length).toBe(1);
  await failure(page).getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => opens.length).toBe(2);
  await expect(failure(page)).toContainText('1 sound file cannot be read1 sound cannot be played');
  await expect(page.locator('[data-pad]')).toHaveCount(0);

  await failure(page).getByRole('button', { name: 'Pack list' }).click();
  await expect(failure(page)).toHaveCount(0);
  await expect(page.getByRole('listbox', { name: 'UniPack list' }).getByRole('option')).toHaveCount(1);
  await expect(page.locator('[data-pad]')).toHaveCount(0);
  expect(await page.evaluate(() => window.browserProbe.audio.starts.length)).toBe(0);
});

test('a pack of lights only opens without a sound notice', async ({ page }) => {
  await openBasicWith(page, { keySound: '' }, ['autoPlay']);
  await expect(page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Details' }) })).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
