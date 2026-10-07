import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { expect } from './browser';

// Reuse the original fixture tone, with a distinct duration for every pad and chain.
// No keyLED scripts: each held pad has the existing press overlay until release.
export const duration = (rows: number, cols: number, position: string, chain = 1) => {
  const [row, col] = position.split(',').map(Number);
  return (100 + (chain - 1) * rows * cols + row * cols + col) / 1000;
};

export async function loadInputPack(page: Page, rows = 8, cols = 8, square = true) {
  const original = await JSZip.loadAsync(await readFile('e2e/fixtures/multi-touch.uni'));
  const tone = await original.file('sounds/tone.wav')!.async('nodebuffer');
  const zip = new JSZip();
  const date = new Date('2020-01-01T00:00:00Z');
  zip.file('info', `title=Input Boundary Test Pack\nproducerName=UniPad Tests\nbuttonX=${rows}\nbuttonY=${cols}\nchain=2\nsquareButton=${square}\n`, { date });
  const mappings: string[] = [];
  for (let chain = 1; chain <= 2; chain++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = (chain - 1) * rows * cols + row * cols + col;
        const count = Math.round((100 + index) * 44100 / 1000);
        const wav = Buffer.alloc(44 + count * 2);
        tone.copy(wav, 0, 0, 44);
        wav.writeUInt32LE(wav.length - 8, 4);
        wav.writeUInt32LE(count * 2, 40);
        for (let sample = 0; sample < count; sample++) {
          wav.writeInt16LE(tone.readInt16LE(44 + (sample % 4410) * 2), 44 + sample * 2);
        }
        zip.file(`sounds/${index}.wav`, wav, { date });
        mappings.push(`${chain} ${row + 1} ${col + 1} ${index}.wav 0`);
      }
    }
  }
  zip.file('keySound', `${mappings.join('\n')}\n`, { date });
  await page.goto('/play');
  await page.locator('input[type=file][accept=".zip,.uni"]').setInputFiles({
    name: 'input-boundaries.uni', mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  });
  await expect(page.locator('[data-pad]')).toHaveCount(rows * cols);
  await expect.poll(() => page.evaluate(() => window.browserProbe.audio.decoded.length)).toBe(rows * cols * 2);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}
